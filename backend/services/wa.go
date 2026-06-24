package services

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"os"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	_ "github.com/mattn/go-sqlite3"
)

// IncomingMessage = isi pesan masuk (teks dan/atau media).
type IncomingMessage struct {
	Text      string // teks chat biasa atau caption media
	MediaType string // "", image, document, audio, video, sticker
	Mimetype  string
	FileName  string
	Data      []byte
	WAMsgID   string // ID pesan asli dari WhatsApp (untuk reply-to)
	ReplyTo   string // ID pesan yg di-reply (dari ContextInfo)
	PushName  string // nama profil pengirim (dari WA), untuk disimpan ke Contact
}

// MessageHandler dipanggil tiap pesan masuk, membawa ID agent (CS) penerima.
type MessageHandler func(agentID uint, sender types.JID, in IncomingMessage)

// DeviceLinkedHandler dipanggil saat agent berhasil login via QR.
type DeviceLinkedHandler func(agentID uint, jid, number string)

type waInstance struct {
	mu             sync.Mutex
	agentID        uint
	client         *whatsmeow.Client
	qrCode         string
	qrExpiry       time.Time // kapan kode QR saat ini akan diputar whatsmeow (untuk countdown akurat)
	status         string    // "disconnected", "qr", "connecting", "connected", "expired"
	contactsSynced bool      // true setelah backfill nama kontak dari buku alamat (sekali per proses)
}

var (
	instances    = make(map[uint]*waInstance)
	globalMu     sync.Mutex
	legacyDBPath = "./wa-assistant.db"
	onMessage    MessageHandler
	onLinked     DeviceLinkedHandler
	waLogger     waLog.Logger = waLog.Noop // logger whatsmeow (default senyap; diaktifkan via WA_LOG_LEVEL)
)

func InitWA(dbPath string) {
	if dbPath != "" {
		legacyDBPath = dbPath
	}
	// Aktifkan log whatsmeow (disconnect/stream-error/reconnect) untuk diagnosa koneksi.
	// WA_LOG_LEVEL: WARN (default), INFO untuk lebih detail, atau NONE/OFF untuk senyap.
	if lvl := strings.ToUpper(strings.TrimSpace(os.Getenv("WA_LOG_LEVEL"))); lvl == "" || (lvl != "NONE" && lvl != "OFF") {
		if lvl == "" {
			lvl = "WARN"
		}
		waLogger = waLog.Stdout("WA", lvl, false)
	}
}

// SetHandlers mendaftarkan callback global (dipanggil sekali dari main).
func SetHandlers(msg MessageHandler, linked DeviceLinkedHandler) {
	onMessage = msg
	onLinked = linked
}

// Handler event label WhatsApp (Business).
type LabelEditHandler func(agentID uint, labelID, name string, color int, deleted bool)
type LabelAssocHandler func(agentID uint, sender, labelID string, labeled bool)

var (
	onLabelEdit  LabelEditHandler
	onLabelAssoc LabelAssocHandler
)

func SetLabelHandlers(edit LabelEditHandler, assoc LabelAssocHandler) {
	onLabelEdit = edit
	onLabelAssoc = assoc
}

// ConnectedHandler dipanggil sekali saat agent tersambung (untuk backfill nama kontak dari buku alamat).
type ConnectedHandler func(agentID uint)

var onConnected ConnectedHandler

func SetConnectedHandler(h ConnectedHandler) { onConnected = h }

// WA mengembalikan instance WhatsApp untuk satu agent, membuatnya jika belum ada.
func WA(agentID uint) *waInstance {
	globalMu.Lock()
	defer globalMu.Unlock()
	if w, ok := instances[agentID]; ok {
		return w
	}
	w := &waInstance{agentID: agentID, status: "disconnected"}
	instances[agentID] = w
	return w
}

// RemoveWA memutus sesi WA agent, mengeluarkannya dari memori (map instances), dan menghapus
// file sesinya. Dipanggil saat agent dihapus agar tidak bocor memori/koneksi/file descriptor.
func RemoveWA(agentID uint) {
	globalMu.Lock()
	w, ok := instances[agentID]
	delete(instances, agentID)
	globalMu.Unlock()
	if ok {
		_ = w.Logout() // putus client + lepas koneksi/goroutine
	}
	// Hapus file sesi SQLite per-agent. Agent 1 memakai file lama bersama — jangan dihapus.
	if agentID != 1 {
		base := fmt.Sprintf("data/wa-session-agent-%d.db", agentID)
		for _, suffix := range []string{"", "-wal", "-shm"} {
			os.Remove(base + suffix)
		}
	}
}

// sessionDSN: tiap agent punya file sesi SQLite sendiri (di-key per-agent, bukan per-JID
// yang mengandung ':'/'@'). Agent 1 memakai file lama agar sesi yang sudah login tidak hilang.
func sessionDSN(agentID uint) string {
	path := legacyDBPath
	if agentID != 1 {
		os.MkdirAll("data", 0o755)
		path = fmt.Sprintf("data/wa-session-agent-%d.db", agentID)
	}
	return "file:" + path + "?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000"
}

// FirstDeviceJID membaca device pada file sesi agent 1 (untuk migrasi single-number lama).
func FirstDeviceJID() string {
	container, err := sqlstore.New(context.Background(), "sqlite3", sessionDSN(1), waLog.Noop)
	if err != nil {
		return ""
	}
	defer container.Close()
	devices, err := container.GetAllDevices(context.Background())
	if err != nil || len(devices) == 0 || devices[0].ID == nil {
		return ""
	}
	return devices[0].ID.String()
}

// Connect menyambungkan agent. Param deviceJID tidak dipakai untuk path (file di-key per-agent);
// dipertahankan agar pemanggil lama kompatibel.
func (w *waInstance) Connect(_ string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.client != nil {
		// Masih ter-pair → cukup sambung ulang tanpa QR.
		if w.client.Store.ID != nil {
			if !w.client.IsConnected() {
				_ = w.client.Connect()
			}
			return w.status, nil
		}
		// Client lama tapi sesi sudah tidak ter-pair (mis. setelah logout/dicabut) →
		// buang supaya jalur pembuatan QR di bawah berjalan.
		w.client.Disconnect()
		w.client = nil
	}

	ctx := context.Background()
	container, err := sqlstore.New(ctx, "sqlite3", sessionDSN(w.agentID), waLog.Noop)
	if err != nil {
		return "", fmt.Errorf("gagal buat store: %w", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return "", fmt.Errorf("gagal ambil device: %w", err)
	}

	w.client = whatsmeow.NewClient(device, waLogger)
	w.client.AddEventHandler(w.handleEvent)

	if w.client.Store.ID == nil {
		qrChan, _ := w.client.GetQRChannel(ctx)
		if err := w.client.Connect(); err != nil {
			return "", fmt.Errorf("gagal connect: %w", err)
		}
		go w.watchQR(qrChan)
		w.status = "qr"
		return "qr", nil
	}

	if err := w.client.Connect(); err != nil {
		return "", fmt.Errorf("gagal connect existing: %w", err)
	}
	w.status = "connected"
	return "connected", nil
}

func (w *waInstance) watchQR(qrChan <-chan whatsmeow.QRChannelItem) {
	for evt := range qrChan {
		if evt.Event == "code" {
			w.mu.Lock()
			w.qrCode = evt.Code
			w.qrExpiry = time.Now().Add(evt.Timeout) // durasi asli kode ini (kode pertama ~60s, berikutnya ~20s)
			w.status = "qr"
			w.mu.Unlock()
			continue
		}
		w.mu.Lock()
		w.qrCode = ""
		var jid *types.JID
		if w.client != nil {
			jid = w.client.Store.ID
		}
		if jid != nil {
			w.status = "connected"
		} else {
			// Jendela pairing whatsmeow habis (event "timeout"/"error") tanpa tertaut.
			// Tandai "expired" agar frontend bisa menampilkan "QR kedaluwarsa, muat ulang".
			w.status = "expired"
		}
		w.mu.Unlock()
		if jid != nil && onLinked != nil {
			onLinked(w.agentID, jid.String(), jid.User)
		}
		return
	}
}

func (w *waInstance) handleEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Connected:
		// Tersambung / berhasil reconnect.
		w.mu.Lock()
		w.status = "connected"
		w.qrCode = ""
		firstSync := !w.contactsSynced
		w.contactsSynced = true
		w.mu.Unlock()
		log.Printf("WA agent %d: connected", w.agentID)
		// Backfill nama kontak dari buku alamat WA sekali per proses (di goroutine agar tak blok event).
		if firstSync && onConnected != nil {
			go onConnected(w.agentID)
		}

	case *events.Disconnected:
		// Putus sementara (jaringan) — whatsmeow akan auto-reconnect sendiri.
		log.Printf("WA agent %d: disconnected (mencoba reconnect otomatis)", w.agentID)

	case *events.LoggedOut:
		// Sesi dicabut/di-logout dari HP atau di-banned — TIDAK bisa auto-recover, perlu scan ulang.
		// Hapus sesi basi & buang client supaya Connect berikutnya bisa membuat QR baru.
		w.mu.Lock()
		if w.client != nil {
			if w.client.Store != nil && w.client.Store.ID != nil {
				_ = w.client.Store.Delete(context.Background())
			}
			w.client.Disconnect()
			w.client = nil
		}
		w.status = "disconnected"
		w.qrCode = ""
		w.mu.Unlock()
		log.Printf("WA agent %d: LOGGED OUT (reason=%v) — sesi dibersihkan, perlu scan QR ulang", w.agentID, v.Reason)

	case *events.LabelEdit:
		if onLabelEdit != nil && v.Action != nil {
			onLabelEdit(w.agentID, v.LabelID, v.Action.GetName(), int(v.Action.GetColor()), v.Action.GetDeleted())
		}

	case *events.LabelAssociationChat:
		if onLabelAssoc != nil && v.Action != nil {
			onLabelAssoc(w.agentID, v.JID.User, v.LabelID, v.Action.GetLabeled())
		}

	case *events.Message:
		// Lewati pesan grup & pesan yang kita kirim sendiri (cegah balas ke diri sendiri / loop).
		if v.Info.IsGroup || v.Info.IsFromMe {
			return
		}
		_ = w.client.MarkRead(context.Background(), []types.MessageID{v.Info.ID}, time.Now(), v.Info.Chat, v.Info.Sender)

		in, ok := w.extractIncoming(v)
		if !ok || onMessage == nil {
			return
		}
		in.WAMsgID = v.Info.ID
		in.PushName = v.Info.PushName
		// Kontak modern bisa beralamat LID (privasi). Pakai nomor telepon asli (SenderAlt)
		// agar yang tersimpan & ditampilkan adalah nomor WA betulan, bukan angka LID.
		contact := v.Info.Sender
		if contact.Server == types.HiddenUserServer && !v.Info.SenderAlt.IsEmpty() {
			contact = v.Info.SenderAlt
		}
		go onMessage(w.agentID, contact, in)
	}
}

func (w *waInstance) GetQR() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.qrCode
}

// GetQRTTL = sisa detik sebelum kode QR saat ini diputar whatsmeow (0 bila bukan status qr).
func (w *waInstance) GetQRTTL() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.status != "qr" || w.qrExpiry.IsZero() {
		return 0
	}
	if s := int(time.Until(w.qrExpiry).Seconds()); s > 0 {
		return s
	}
	return 0
}

func (w *waInstance) GetStatus() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	// Kalau cache bilang "connected" tapi socket sebenarnya turun, laporkan "connecting"
	// supaya dashboard tidak menipu "Online" padahal tidak bisa kirim.
	if w.status == "connected" && (w.client == nil || !w.client.IsConnected()) {
		return "connecting"
	}
	return w.status
}

// IsConnected melaporkan apakah socket WA benar-benar hidup & ter-login (bukan sekadar
// status cache). Dipakai broadcast: w.status bisa basi "connected" walau koneksi sudah turun.
func (w *waInstance) IsConnected() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.client != nil && w.client.IsConnected() && w.client.IsLoggedIn()
}

// reconnectIfNeeded menyambung ulang bila sesi SEHARUSNYA tersambung (intent status "connected",
// device sudah login) tapi socket-nya terputus. Aman: sesi yang di-suspend/logout punya status
// "disconnected" + client nil, jadi dilewati (watchdog tidak melawan disconnect yang disengaja).
func (w *waInstance) reconnectIfNeeded() {
	w.mu.Lock()
	client, intend := w.client, w.status == "connected"
	w.mu.Unlock()
	if !intend || client == nil || client.Store.ID == nil || client.IsConnected() {
		return
	}
	log.Printf("Watchdog: WA agent %d terputus — mencoba menyambung ulang", w.agentID)
	if err := client.Connect(); err != nil {
		log.Printf("Watchdog: reconnect agent %d gagal: %v", w.agentID, err)
	}
}

// StartReconnectWatchdog memantau semua sesi WA tiap interval & menyambung ulang yang terputus
// tanpa perlu restart server (menutup celah "bot diam-diam offline").
func StartReconnectWatchdog(interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		for range t.C {
			globalMu.Lock()
			list := make([]*waInstance, 0, len(instances))
			for _, w := range instances {
				list = append(list, w)
			}
			globalMu.Unlock()
			for _, w := range list {
				w.reconnectIfNeeded()
			}
		}
	}()
}

// GetInfo mengembalikan nomor & nama profil WhatsApp yang sedang terhubung.
func (w *waInstance) GetInfo() (number, name string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.client == nil || w.client.Store.ID == nil {
		return "", ""
	}
	return w.client.Store.ID.User, w.client.Store.PushName
}

// Logout memutus & menghapus sesi WhatsApp (unlink). Setelah ini perlu scan QR lagi untuk relink.
func (w *waInstance) Logout() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.client != nil {
		ctx := context.Background()
		if w.client.IsLoggedIn() {
			_ = w.client.Logout(ctx)
		} else {
			w.client.Disconnect()
		}
		w.client = nil
	}
	w.qrCode = ""
	w.status = "disconnected"
	return nil
}

// SendReply mengirim balasan yang mengutip pesan tertentu (reply-to).
func (w *waInstance) SendReply(toNumber, message, replyToID string) error {
	return w.SendMessage(types.NewJID(toNumber, types.DefaultUserServer), message, replyToID)
}

// Typing mengirim indikator "mengetik" ke kontak.
func (w *waInstance) Typing(toNumber string, composing bool) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	jid := types.NewJID(toNumber, types.DefaultUserServer)
	state := types.ChatPresenceComposing
	if !composing {
		state = types.ChatPresencePaused
	}
	return client.SendChatPresence(context.Background(), jid, state, types.ChatPresenceMediaText)
}

// SendText mengirim pesan ke nomor bare (mis "628123") tanpa pemanggil perlu menyusun JID.
func (w *waInstance) SendText(toNumber, message string) error {
	return w.SendMessage(types.NewJID(toNumber, types.DefaultUserServer), message)
}

// NormalizePhone membersihkan nomor jadi format digit internasional (mis. "08.." -> "628..").
func NormalizePhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	switch {
	case d == "":
		return ""
	case strings.HasPrefix(d, "0"):
		return "62" + d[1:]
	case strings.HasPrefix(d, "8"): // nomor lokal tanpa awalan 0/62
		return "62" + d
	default:
		return d
	}
}

// WAGroup = grup yang diikuti akun WhatsApp tertaut.
type WAGroup struct {
	JID          string `json:"jid"`
	Name         string `json:"name"`
	Participants int    `json:"participants"`
}

// GetGroups mengambil daftar grup yang diikuti.
func (w *waInstance) GetGroups() ([]WAGroup, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	groups, err := client.GetJoinedGroups(context.Background())
	if err != nil {
		return nil, err
	}
	out := make([]WAGroup, 0, len(groups))
	for _, g := range groups {
		out = append(out, WAGroup{JID: g.JID.String(), Name: g.Name, Participants: len(g.Participants)})
	}
	return out, nil
}

// GetGroupMembers mengambil nomor anggota sebuah grup (untuk dijadikan penerima).
func (w *waInstance) GetGroupMembers(jidStr string) ([]WAContact, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return nil, err
	}
	gi, err := client.GetGroupInfo(context.Background(), jid)
	if err != nil {
		return nil, err
	}
	out := make([]WAContact, 0, len(gi.Participants))
	for _, p := range gi.Participants {
		num := ""
		if p.PhoneNumber.User != "" {
			num = p.PhoneNumber.User
		} else if p.JID.Server == types.DefaultUserServer {
			num = p.JID.User
		}
		if num == "" {
			continue
		}
		out = append(out, WAContact{Number: num, Name: p.DisplayName})
	}
	return out, nil
}

// WAContact = satu kontak dari buku alamat akun WhatsApp yang tertaut.
type WAContact struct {
	Number string `json:"number"`
	Name   string `json:"name"`
}

// GetContacts mengambil daftar kontak (buku alamat) dari akun WhatsApp yang tertaut.
func (w *waInstance) GetContacts() ([]WAContact, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	all, err := client.Store.Contacts.GetAllContacts(context.Background())
	if err != nil {
		return nil, err
	}
	out := make([]WAContact, 0, len(all))
	for jid, info := range all {
		if jid.Server != types.DefaultUserServer || jid.User == "" {
			continue // hanya nomor telepon (bukan LID/grup)
		}
		name := info.FullName
		for _, alt := range []string{info.FirstName, info.PushName, info.BusinessName} {
			if name == "" {
				name = alt
			}
		}
		out = append(out, WAContact{Number: jid.User, Name: name})
	}
	return out, nil
}

// NumberCheck = hasil pengecekan satu nomor di WhatsApp.
type NumberCheck struct {
	Input      string `json:"input"`
	Number     string `json:"number"` // nomor ternormalisasi untuk dikirim
	Registered bool   `json:"registered"`
}

// CheckNumbers memeriksa daftar nomor apakah terdaftar di WhatsApp (IsOnWhatsApp).
func (w *waInstance) CheckNumbers(numbers []string) ([]NumberCheck, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	queries := make([]string, 0, len(numbers))
	for _, n := range numbers {
		if d := NormalizePhone(n); d != "" {
			queries = append(queries, "+"+d)
		}
	}
	if len(queries) == 0 {
		return nil, nil
	}
	resp, err := client.IsOnWhatsApp(context.Background(), queries)
	if err != nil {
		return nil, err
	}
	out := make([]NumberCheck, 0, len(resp))
	for _, r := range resp {
		num := strings.TrimPrefix(r.Query, "+")
		if r.IsIn && r.JID.User != "" {
			num = r.JID.User
		}
		out = append(out, NumberCheck{Input: r.Query, Number: num, Registered: r.IsIn})
	}
	return out, nil
}

// LIDForPN mengembalikan LID (angka) untuk satu nomor telepon, bila whatsmeow punya pemetaannya.
// Dipakai mencocokkan riwayat chat lama yang tersimpan sebagai LID, bukan nomor telepon.
func (w *waInstance) LIDForPN(phone string) string {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || client.Store == nil {
		return ""
	}
	lid, err := client.Store.LIDs.GetLIDForPN(context.Background(), types.NewJID(phone, types.DefaultUserServer))
	if err != nil || lid.IsEmpty() {
		return ""
	}
	return lid.User
}

// PNForLID mengembalikan nomor telepon untuk sebuah LID (kebalikan LIDForPN).
// Dipakai merapikan data lama yang menyimpan pengirim sebagai LID.
func (w *waInstance) PNForLID(lid string) string {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || client.Store == nil {
		return ""
	}
	pn, err := client.Store.LIDs.GetPNForLID(context.Background(), types.NewJID(lid, types.HiddenUserServer))
	if err != nil || pn.IsEmpty() {
		return ""
	}
	return pn.User
}

// extractIncoming mengubah pesan WA jadi IncomingMessage (teks atau media yang sudah di-download).
func (w *waInstance) extractIncoming(v *events.Message) (IncomingMessage, bool) {
	m := v.Message
	if t := m.GetConversation(); t != "" {
		return IncomingMessage{Text: t}, true
	}
	if ext := m.GetExtendedTextMessage(); ext != nil && ext.GetText() != "" {
		var replyTo string
		if ci := ext.GetContextInfo(); ci != nil { replyTo = ci.GetStanzaID() }
		return IncomingMessage{Text: ext.GetText(), ReplyTo: replyTo}, true
	}
	ctx := context.Background()
	switch {
	case m.GetImageMessage() != nil:
		img := m.GetImageMessage()
		data, err := w.client.Download(ctx, img)
		if err != nil {
			log.Printf("WA agent %d: gagal download gambar: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{Text: img.GetCaption(), MediaType: "image", Mimetype: img.GetMimetype(), Data: data}, true
	case m.GetDocumentMessage() != nil:
		doc := m.GetDocumentMessage()
		data, err := w.client.Download(ctx, doc)
		if err != nil {
			log.Printf("WA agent %d: gagal download dokumen: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{Text: doc.GetCaption(), MediaType: "document", Mimetype: doc.GetMimetype(), FileName: doc.GetFileName(), Data: data}, true
	case m.GetVideoMessage() != nil:
		vid := m.GetVideoMessage()
		data, err := w.client.Download(ctx, vid)
		if err != nil {
			log.Printf("WA agent %d: gagal download video: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{Text: vid.GetCaption(), MediaType: "video", Mimetype: vid.GetMimetype(), Data: data}, true
	case m.GetAudioMessage() != nil:
		aud := m.GetAudioMessage()
		data, err := w.client.Download(ctx, aud)
		if err != nil {
			log.Printf("WA agent %d: gagal download audio: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{MediaType: "audio", Mimetype: aud.GetMimetype(), Data: data}, true
	case m.GetStickerMessage() != nil:
		st := m.GetStickerMessage()
		data, err := w.client.Download(ctx, st)
		if err != nil {
			return IncomingMessage{}, false
		}
		return IncomingMessage{MediaType: "sticker", Mimetype: st.GetMimetype(), Data: data}, true
	}
	return IncomingMessage{}, false // tipe pesan lain diabaikan
}

// SendImage mengunggah & mengirim gambar ke nomor.
func (w *waInstance) SendImage(toNumber, caption, mimetype string, data []byte) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	ctx := context.Background()
	up, err := client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return fmt.Errorf("gagal upload gambar: %w", err)
	}
	_, err = client.SendMessage(ctx, types.NewJID(toNumber, types.DefaultUserServer), &waProto.Message{
		ImageMessage: &waProto.ImageMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimetype),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(up.FileLength),
		},
	})
	return err
}

// SendDocument mengunggah & mengirim file/dokumen ke nomor (caption opsional).
func (w *waInstance) SendDocument(toNumber, fileName, mimetype, caption string, data []byte) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	ctx := context.Background()
	up, err := client.Upload(ctx, data, whatsmeow.MediaDocument)
	if err != nil {
		return fmt.Errorf("gagal upload dokumen: %w", err)
	}
	_, err = client.SendMessage(ctx, types.NewJID(toNumber, types.DefaultUserServer), &waProto.Message{
		DocumentMessage: &waProto.DocumentMessage{
			FileName:      proto.String(fileName),
			Title:         proto.String(fileName),
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimetype),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(up.FileLength),
		},
	})
	return err
}

// Suspend memutus socket WA tanpa menghapus sesi (device tetap tersimpan di store).
// Dipakai saat langganan tenant tidak aktif; cukup Connect() lagi untuk menyambung tanpa scan QR.
func (w *waInstance) Suspend() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.client != nil {
		w.client.Disconnect()
		w.client = nil
	}
	w.qrCode = ""
	w.status = "disconnected"
}

func (w *waInstance) SendMessage(to types.JID, message string, replyToID ...string) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}

	ctx := context.Background()
	// Humanisasi: tampilkan "mengetik...", beri jeda wajar, lalu kirim (kurangi risiko banned).
	_ = client.SendPresence(ctx, types.PresenceAvailable)
	_ = client.SendChatPresence(ctx, to, types.ChatPresenceComposing, types.ChatPresenceMediaText)
	time.Sleep(humanDelay(message))
	_ = client.SendChatPresence(ctx, to, types.ChatPresencePaused, types.ChatPresenceMediaText)

	msg := &waProto.Message{
		Conversation: proto.String(message),
	}
	// Reply native: gunakan ExtendedTextMessage dengan ContextInfo.
	if len(replyToID) > 0 && replyToID[0] != "" {
		msg = &waProto.Message{
			ExtendedTextMessage: &waProto.ExtendedTextMessage{
				Text: proto.String(message),
				ContextInfo: &waProto.ContextInfo{
					StanzaID:    proto.String(replyToID[0]),
					Participant: proto.String(to.ToNonAD().String()),
				},
			},
		}
	}
	_, err := client.SendMessage(ctx, to, msg)
	return err
}

// humanDelay meniru kecepatan mengetik manusia: jeda dasar acak + proporsional panjang pesan, dibatasi 6 detik.
func humanDelay(msg string) time.Duration {
	ms := 1500 + rand.Intn(1500) + len([]rune(msg))*25
	if ms > 6000 {
		ms = 6000
	}
	return time.Duration(ms) * time.Millisecond
}
