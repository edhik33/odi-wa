package services

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"os"
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
}

// MessageHandler dipanggil tiap pesan masuk, membawa ID agent (CS) penerima.
type MessageHandler func(agentID uint, sender types.JID, in IncomingMessage)

// DeviceLinkedHandler dipanggil saat agent berhasil login via QR.
type DeviceLinkedHandler func(agentID uint, jid, number string)

type waInstance struct {
	mu      sync.Mutex
	agentID uint
	client  *whatsmeow.Client
	qrCode  string
	status  string // "disconnected", "qr", "connected"
}

var (
	instances    = make(map[uint]*waInstance)
	globalMu     sync.Mutex
	legacyDBPath = "./wa-assistant.db"
	onMessage    MessageHandler
	onLinked     DeviceLinkedHandler
)

func InitWA(dbPath string) {
	if dbPath != "" {
		legacyDBPath = dbPath
	}
}

// SetHandlers mendaftarkan callback global (dipanggil sekali dari main).
func SetHandlers(msg MessageHandler, linked DeviceLinkedHandler) {
	onMessage = msg
	onLinked = linked
}

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
		if !w.client.IsConnected() {
			_ = w.client.Connect()
		}
		return w.status, nil
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

	w.client = whatsmeow.NewClient(device, waLog.Noop)
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
			w.status = "disconnected"
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
		w.mu.Unlock()
		log.Printf("WA agent %d: connected", w.agentID)

	case *events.Disconnected:
		// Putus sementara (jaringan) — whatsmeow akan auto-reconnect sendiri.
		log.Printf("WA agent %d: disconnected (mencoba reconnect otomatis)", w.agentID)

	case *events.LoggedOut:
		// Sesi dicabut/di-logout dari HP atau di-banned — TIDAK bisa auto-recover, perlu scan ulang.
		w.mu.Lock()
		w.status = "disconnected"
		w.qrCode = ""
		w.mu.Unlock()
		log.Printf("WA agent %d: LOGGED OUT (reason=%v) — perlu scan QR ulang", w.agentID, v.Reason)

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

func (w *waInstance) GetStatus() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.status
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

// SendText mengirim pesan ke nomor bare (mis "628123") tanpa pemanggil perlu menyusun JID.
func (w *waInstance) SendText(toNumber, message string) error {
	return w.SendMessage(types.NewJID(toNumber, types.DefaultUserServer), message)
}

// extractIncoming mengubah pesan WA jadi IncomingMessage (teks atau media yang sudah di-download).
func (w *waInstance) extractIncoming(v *events.Message) (IncomingMessage, bool) {
	m := v.Message
	if t := m.GetConversation(); t != "" {
		return IncomingMessage{Text: t}, true
	}
	if ext := m.GetExtendedTextMessage(); ext != nil && ext.GetText() != "" {
		return IncomingMessage{Text: ext.GetText()}, true
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

// SendDocument mengunggah & mengirim file/dokumen ke nomor.
func (w *waInstance) SendDocument(toNumber, fileName, mimetype string, data []byte) error {
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

func (w *waInstance) SendMessage(to types.JID, message string) error {
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

	_, err := client.SendMessage(ctx, to, &waProto.Message{
		Conversation: proto.String(message),
	})
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
