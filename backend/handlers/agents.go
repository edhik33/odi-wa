package handlers

import (
	"fmt"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
	"go.mau.fi/whatsmeow/types"
)

// currentAgentID mengembalikan id agent dari path (:id), divalidasi milik tenant pemanggil.
// Endpoint lama tanpa :id memakai agent pertama milik tenant. 0 = tidak ada / bukan milik tenant.
func currentAgentID(c *gin.Context) uint {
	tid := currentTenantID(c)
	if tid == 0 {
		return 0
	}
	if p := c.Param("id"); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil {
			return 0
		}
		var a models.Agent
		if database.DB.Select("id").Where("id = ? AND tenant_id = ?", n, tid).First(&a).Error != nil {
			return 0
		}
		return a.ID
	}
	var a models.Agent
	database.DB.Select("id").Where("tenant_id = ?", tid).Order("id asc").First(&a)
	return a.ID
}

// resolveAgent memastikan agent valid & milik tenant; bila tidak, tulis 404 dan return false.
func resolveAgent(c *gin.Context) (uint, bool) {
	id := currentAgentID(c)
	if id == 0 {
		c.JSON(404, gin.H{"error": "Agent tidak ditemukan"})
		return 0, false
	}
	return id, true
}

// planMaxNumbers = batas jumlah nomor untuk tenant (default 1 saat trial / tanpa plan).
func planMaxNumbers(tenantID uint) int {
	var t models.Tenant
	if database.DB.Preload("Plan").First(&t, tenantID).Error != nil {
		return trialMaxNumbers()
	}
	if t.Plan != nil && t.Plan.MaxNumbers > 0 {
		return t.Plan.MaxNumbers
	}
	return trialMaxNumbers() // tenant trial / tanpa plan
}

// trialMaxNumbers = batas nomor untuk tenant trial (default 1, bisa diatur via env TRIAL_MAX_NUMBERS).
func trialMaxNumbers() int {
	if n := config.EnvInt("TRIAL_MAX_NUMBERS", 1); n > 0 {
		return n
	}
	return 1
}

// tenantWAActive menentukan apakah sesi WA tenant boleh aktif (langganan aktif / trial belum habis).
func tenantWAActive(tenantID uint) bool {
	var t models.Tenant
	if database.DB.First(&t, tenantID).Error != nil {
		return false
	}
	switch t.Status {
	case models.TenantActive:
		return true
	case models.TenantTrial:
		return t.TrialEndsAt == nil || t.TrialEndsAt.After(time.Now())
	default:
		return false
	}
}

// deferMessage = balasan saat bot ragu (eskalasi). Konsisten sebagai admin, bukan oper ke orang lain.
const deferMessage = "Mohon maaf kak, untuk yang ini saya cek dulu ya biar infonya pasti — sebentar lagi kami kabari 🙏"

// quotaMessage = balasan saat kuota AI bulan ini habis (kontak dialihkan ke CS manusia).
const quotaMessage = "Halo kak 🙏 pesan kakak sudah kami terima, CS kami akan segera membalas ya."

// ---- Debounce: gabungkan pesan teks beruntun jadi satu sebelum diproses ----
// Lebih manusiawi (bot tidak membalas tiap baris) & hemat panggilan AI.

const debounceWindow = 5 * time.Second

type pendingText struct {
	timer *time.Timer
	texts []string
	tmpl  services.IncomingMessage // simpan PushName dll. dari pesan pertama
}

var (
	debounceMu sync.Mutex
	pending    = map[string]*pendingText{}
)

func debounceKey(agentID uint, sender types.JID) string {
	return fmt.Sprintf("%d|%s", agentID, sender.User)
}

// enqueueText menampung pesan teks; bila ada pesan lain dalam jeda singkat, digabung & timer di-reset.
func enqueueText(agentID uint, sender types.JID, in services.IncomingMessage) {
	key := debounceKey(agentID, sender)
	debounceMu.Lock()
	defer debounceMu.Unlock()
	if p := pending[key]; p != nil {
		p.texts = append(p.texts, in.Text)
		p.timer.Reset(debounceWindow)
		return
	}
	p := &pendingText{tmpl: in, texts: []string{in.Text}}
	p.timer = time.AfterFunc(debounceWindow, func() { flushText(agentID, sender, false) })
	pending[key] = p
}

// flushText memproses pesan teks tertunda. stopTimer=true saat dipanggil manual (mis. ada media menyusul).
func flushText(agentID uint, sender types.JID, stopTimer bool) {
	key := debounceKey(agentID, sender)
	debounceMu.Lock()
	p := pending[key]
	delete(pending, key)
	debounceMu.Unlock()
	if p == nil {
		return
	}
	if stopTimer {
		p.timer.Stop()
	}
	combined := p.tmpl
	combined.Text = strings.TrimSpace(strings.Join(p.texts, "\n"))
	processMessage(agentID, sender, combined)
}

// OnWAMessage dipanggil saat ada pesan masuk untuk agent tertentu.
func OnWAMessage(agentID uint, sender types.JID, in services.IncomingMessage) {
	num := sender.User

	// Simpan/segarkan nama profil kontak (dipakai inbox & sumber broadcast).
	if name := strings.TrimSpace(in.PushName); name != "" {
		database.DB.Where(models.Contact{AgentID: agentID, Number: num}).
			Assign(models.Contact{Name: name}).
			FirstOrCreate(&models.Contact{})
	}

	// Media diproses langsung; flush dulu teks tertunda kontak ini agar urutannya benar.
	if in.MediaType != "" {
		flushText(agentID, sender, true)
		processMessage(agentID, sender, in)
		return
	}
	if strings.TrimSpace(in.Text) == "" {
		return // tipe pesan lain (mis. teks kosong) diabaikan
	}
	enqueueText(agentID, sender, in)
}

// processMessage menjalankan pipeline balasan (opt-out, handoff, jam kerja, sapaan, keyword, AI).
func processMessage(agentID uint, sender types.JID, in services.IncomingMessage) {
	num := sender.User

	var agent models.Agent
	prompt := "Kamu adalah asisten AI yang ramah. Jawab dalam bahasa Indonesia."
	tone := "ramah"
	if database.DB.First(&agent, agentID).Error == nil {
		if agent.SystemPrompt != "" {
			prompt = agent.SystemPrompt
		}
		if agent.Tone != "" {
			tone = agent.Tone
		}
		// Long-term memory: inject ringkasan percakapan lama ke prompt.
		if agent.ConversationSummary != "" {
			prompt = "PERCAKAPAN SEBELUMNYA: " + agent.ConversationSummary + "\n\n" + prompt
		}
	}

	// Simpan media ke disk dulu (kalau ada).
	mediaPath := ""
	if in.MediaType != "" && len(in.Data) > 0 {
		mediaPath = storeMedia(agentID, in.Data, in.Mimetype, in.FileName)
	}
	// Teks tampilan: caption, atau placeholder kalau media tanpa caption.
	displayText := in.Text
	if displayText == "" && in.MediaType != "" {
		displayText = mediaPlaceholder(in.MediaType, in.FileName)
	}
	// logRow mencatat satu baris percakapan beserta lampiran media (bila ada).
	logRow := func(message, reply string, sendErr error) {
		status, errMsg, nextRetryAt := deliveryFields(sendErr)
		if strings.TrimSpace(reply) == "" {
			status, errMsg, nextRetryAt = "sent", "", nil
		}
		if err := database.DB.Create(&models.ChatHistory{
			AgentID: agentID, Sender: num, Message: message, Reply: reply,
			MediaType: in.MediaType, MediaPath: mediaPath, FileName: in.FileName, Mimetype: in.Mimetype,
			WAMsgID: in.WAMsgID, ReplyTo: in.ReplyTo,
			DeliveryStatus: status, SendError: errMsg, NextRetryAt: nextRetryAt,
		}).Error; err != nil {
			log.Printf("Gagal mencatat ChatHistory (agent %d, %s): %v", agentID, num, err)
		}
	}
	send := func(text string) error {
		err := services.WA(agentID).SendMessage(sender, text)
		if err != nil {
			log.Printf("WA send gagal (agent %d, %s): %v", agentID, num, err)
		}
		return err
	}

	// 0. Permintaan berhenti (opt-out) -> catat agar tidak ikut broadcast lagi, lalu konfirmasi.
	if in.Text != "" && isOptOutKeyword(in.Text) {
		_ = database.DB.Where(models.OptOut{AgentID: agentID, Sender: num}).FirstOrCreate(&models.OptOut{AgentID: agentID, Sender: num}).Error
		ack := "Baik kak 🙏 nomor ini tidak akan kami kirimi pesan promosi lagi. Terima kasih."
		logRow(in.Text, ack, send(ack))
		return
	}

	// 1. Kontak sedang diambil alih manusia -> bot diam, catat pesan masuk untuk inbox.
	var ho models.Handoff
	if database.DB.Where("agent_id = ? AND sender = ?", agentID, num).First(&ho).Error == nil {
		logRow(displayText, "", nil)
		return
	}

	// 2. Di luar jam kerja -> kirim pesan away (sekali), jangan panggil AI.
	if !withinBusinessHours(agent) {
		away := agent.AwayMessage
		if away == "" {
			away = "Mohon maaf, saat ini di luar jam operasional. Pesan kakak sudah kami terima dan akan kami balas pada jam kerja ya 🙏"
		}
		var last models.ChatHistory
		database.DB.Where("agent_id = ? AND sender = ?", agentID, num).Order("created_at desc").First(&last)
		if last.Reply != away {
			logRow(displayText, away, send(away))
		} else {
			logRow(displayText, "", nil)
		}
		return
	}

	// 3. Sapaan untuk kontak baru.
	if agent.GreetingEnabled && agent.GreetingMessage != "" && isNewContact(agentID, num) {
		if err := send(agent.GreetingMessage); err != nil {
			logRow(displayText, agent.GreetingMessage, err)
		}
	}

	// 3b. Auto-reply kata kunci (instan, tanpa AI) -> dicek sebelum AI agar cepat & hemat biaya.
	if reply, matched := matchAutoReply(agentID, in.Text); matched {
		logRow(displayText, reply, send(reply))
		return
	}

	// 3c. Balasan AI dimatikan -> bot tidak menjawab, pesan dicatat ke inbox untuk dibalas manual.
	if !agent.AIEnabled {
		logRow(displayText, "", nil)
		return
	}

	// 4. Media apa pun (foto/file/video/audio) -> AI teks tidak bisa "melihat" isinya,
	//    jadi JANGAN kirim caption-nya ke AI (kalau dikirim, AI jujur bilang "tidak bisa
	//    melihat foto" -> user merasa dibohongi). Selalu beri ack ramah + alihkan ke CS,
	//    baik media polos maupun media yang disertai caption.
	if in.MediaType != "" {
		ack := "Terima kasih kak 🙏 fotonya sudah kami terima dan kelihatan kok. Sebentar ya, langsung kami cek dan dibalas. 😊"
		if in.MediaType != "image" {
			ack = "Terima kasih kak 🙏 file/medianya sudah kami terima, akan segera kami cek ya."
		}
		_ = database.DB.Create(&models.Handoff{AgentID: agentID, Sender: num, LastMsg: displayText}).Error
		logRow(displayText, ack, send(ack))
		log.Printf("Media (%s) dari %s (agent %d) -> dialihkan ke CS (AI teks tak bisa lihat media)", in.MediaType, num, agentID)
		return
	}

	// 5. Kuota balasan AI habis -> alihkan ke CS manusia.
	if aiQuotaExceeded(agent.TenantID) {
		_ = database.DB.Create(&models.Handoff{AgentID: agentID, Sender: num, LastMsg: displayText}).Error
		logRow(displayText, quotaMessage, send(quotaMessage))
		log.Printf("Kuota AI habis (tenant %d, agent %d) — dialihkan ke CS untuk %s", agent.TenantID, agentID, num)
		return
	}

	// 6. Jawaban AI (teks biasa; media sudah dialihkan ke CS sebelum sampai sini).
	var history []models.ChatHistory
	database.DB.Where("agent_id = ? AND sender = ? AND created_at > ?", agentID, num, time.Now().AddDate(0, 0, -7)).
		Order("created_at desc").Limit(20).Find(&history)
	for i, j := 0, len(history)-1; i < j; i, j = i+1, j-1 {
		history[i], history[j] = history[j], history[i]
	}

	// Inject konteks ongkir realtime kalau user tanya ongkir.
	enhancedPrompt := prompt
	if shippingCtx := maybeBuildShippingContext(agent, in.Text); shippingCtx != "" {
		enhancedPrompt = prompt + "\n\n" + shippingCtx
	}

	reply, escalate, _, err := services.ChatWithKnowledge(agentID, enhancedPrompt, tone, in.Text, history)
	if err != nil {
		log.Printf("AI error (agent %d) dari %s: %v", agentID, num, err)
		reply = "Maaf, ada kendala teknis."
		escalate = false
	}
	if escalate {
		// Ganti fallback generik dengan AI call kontekstual — biar nyambung topik.
		ctxReply, err := services.ContextualFallback(agentID, prompt, tone, in.Text, history)
		if err == nil && ctxReply != "" {
			reply = ctxReply
		} else {
			reply = deferMessage
		}
		_ = database.DB.Create(&models.Handoff{AgentID: agentID, Sender: num, LastMsg: displayText}).Error
		log.Printf("Eskalasi (agent %d) dari %s: %q", agentID, num, in.Text)
	}
	sendErr := sendChunked(agentID, sender, reply) // balasan panjang dipecah jadi beberapa bubble (lebih manusiawi)
	if sendErr != nil {
		log.Printf("WA send chunked gagal (agent %d, %s): %v", agentID, num, sendErr)
	}
	logRow(displayText, reply, sendErr)
	incrementAIUsage(agent.TenantID) // hitung pemakaian kuota bulanan tenant

	// Long-term memory: auto-summary setelah percakapan (jeda >30 menit).
	go maybeSummarize(agent, num)

	// Export data closing ke Google Sheets (async, non-blocking).
	go maybeExtractAndExportClosing(agentID, num)
}

// sendChunked mengirim balasan AI dalam 1-3 bubble (per paragraf), masing-masing dengan
// jeda "mengetik" alami dari SendMessage — terasa seperti manusia, bukan satu dinding teks.
func sendChunked(agentID uint, to types.JID, text string) error {
	for _, part := range splitReply(text) {
		if err := services.WA(agentID).SendMessage(to, part); err != nil {
			return err
		}
	}
	return nil
}

// splitReply memecah teks per paragraf (baris kosong), maksimal 3 bubble; sisanya digabung ke bubble terakhir.
func splitReply(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	var parts []string
	for _, p := range strings.Split(text, "\n\n") {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return []string{text}
	}
	if len(parts) > 3 {
		parts = append(parts[:2], strings.Join(parts[2:], "\n\n"))
	}
	return parts
}

// withinBusinessHours true bila jam kerja nonaktif, atau waktu sekarang berada dalam rentang jam kerja.
func withinBusinessHours(a models.Agent) bool {
	if !a.BusinessHoursEnabled || a.BusinessStart == "" || a.BusinessEnd == "" {
		return true
	}
	cur := time.Now().Format("15:04")
	if a.BusinessStart <= a.BusinessEnd {
		return cur >= a.BusinessStart && cur <= a.BusinessEnd
	}
	return cur >= a.BusinessStart || cur <= a.BusinessEnd // rentang melewati tengah malam
}

func isNewContact(agentID uint, num string) bool {
	var n int64
	database.DB.Model(&models.ChatHistory{}).Where("agent_id = ? AND sender = ?", agentID, num).Count(&n)
	return n == 0
}

// storeMedia menyimpan byte media ke disk dan mengembalikan path-nya (kosong bila gagal).
func storeMedia(agentID uint, data []byte, mimetype, fileName string) string {
	dir := fmt.Sprintf("data/media/agent-%d", agentID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Printf("gagal buat folder media: %v", err)
		return ""
	}
	full := filepath.Join(dir, fmt.Sprintf("%d%s", time.Now().UnixNano(), mediaExt(mimetype, fileName)))
	if err := os.WriteFile(full, data, 0o600); err != nil {
		log.Printf("gagal simpan media: %v", err)
		return ""
	}
	return full
}

func mediaExt(mimetype, fileName string) string {
	if fileName != "" {
		if e := filepath.Ext(fileName); e != "" {
			return e
		}
	}
	mt := mimetype
	if i := strings.IndexByte(mt, ';'); i >= 0 {
		mt = mt[:i]
	}
	if exts, _ := mime.ExtensionsByType(strings.TrimSpace(mt)); len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}

func mediaPlaceholder(mediaType, fileName string) string {
	switch mediaType {
	case "image":
		return "📷 Foto"
	case "video":
		return "🎥 Video"
	case "audio":
		return "🎤 Pesan suara"
	case "sticker":
		return "🌟 Stiker"
	case "document":
		if fileName != "" {
			return "📎 " + fileName
		}
		return "📎 Dokumen"
	}
	return ""
}

func logTurn(agentID uint, num, msg, reply string, fromHuman bool, replyTo string, replyText string) {
	if err := database.DB.Create(&models.ChatHistory{
		AgentID: agentID, Sender: num, Message: msg, Reply: reply, FromHuman: fromHuman,
		ReplyTo: replyTo, ReplyText: replyText,
	}).Error; err != nil {
		log.Printf("Gagal logTurn (agent %d, %s): %v", agentID, num, err)
	}
}

// --- Cek Ongkir Realtime via RajaOngkir ---

var shippingKeywords = []string{"ongkir", "ongkos kirim", "biaya kirim", "kirim ke", "pengiriman ke", "berapa kirim", "cek ongkir", "ongkos"}

func detectShippingIntent(msg string) bool {
	lower := strings.ToLower(msg)
	for _, kw := range shippingKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func extractDestinationCity(msg string) string {
	msg = strings.ToLower(msg)
	patterns := []string{"ke ", "tujuan ", "ongkir ", "kirim "}
	stopWords := map[string]bool{"berapa": true, "kak": true, "ya": true, "berapa?": true, "dong": true, "sih": true, "nih": true}
	for _, p := range patterns {
		if idx := strings.Index(msg, p); idx >= 0 {
			rest := msg[idx+len(p):]
			words := strings.Fields(rest)
			if len(words) > 0 {
				candidate := words[0]
				// Ambil kata kedua kalau bukan stop word
				if len(words) > 1 && !stopWords[words[1]] {
					candidate = words[0] + " " + words[1]
				}
				return strings.TrimSpace(candidate)
			}
		}
	}
	return ""
}

func maybeBuildShippingContext(agent models.Agent, msg string) string {
	if agent.OriginCityID == 0 || !detectShippingIntent(msg) {
		return ""
	}
	destText := extractDestinationCity(msg)
	if destText == "" {
		return ""
	}

	cities := services.ResolveCity(destText)
	if len(cities) == 0 {
		return "\n\nONGKIR_NOTFOUND: Kota \"" + destText + "\" tidak ditemukan. JANGAN eskalasi. Bilang ke customer: \"Maaf kak, kota \"" + destText + "\" belum tersedia di sistem kami. Boleh sebutkan kota/kabupaten yang lebih spesifik ya.\""
	}
	if len(cities) > 1 {
		// Ambiguous — kasih pilihan ke AI
		var sb strings.Builder
		sb.WriteString("\n\nONGKIR_AMBIGUOUS:\nBeberapa kota ditemukan:\n")
		for i, c := range cities {
			sb.WriteString(fmt.Sprintf("%d. %s (%s)\n", i+1, c.FullName, c.Province))
		}
		sb.WriteString("Tanyakan customer pilih yang mana (balas dengan nomor).\n")
		return sb.String()
	}

	city := cities[0]
	couriers := strings.Split(agent.EnabledCouriers, ",")
	if len(couriers) == 0 || couriers[0] == "" {
		couriers = []string{"jne", "jnt", "sicepat"}
	}

	results, err := services.CheckShippingCost(agent.OriginCityID, city.RajaOngkirID, agent.DefaultWeightGram, couriers)
	if err != nil {
		// API gagal (rate limit / error) — kasih konteks ke AI biar jawab jujur, bukan eskalasi.
		return "\n\nONGKIR_ERROR: Cek ongkir realtime sedang gangguan. JANGAN eskalasi. Bilang ke customer: \"Maaf kak, cek ongkir realtime sedang gangguan. Boleh kirim detail pesanan (produk + alamat), nanti kami bantu cek manual ya.\""
	}

	var sb strings.Builder
	sb.WriteString("\n\nONGKIR_REALTIME:\n")
	sb.WriteString(fmt.Sprintf("Kota asal: %s\n", agent.OriginCityName))
	sb.WriteString(fmt.Sprintf("Tujuan: %s\n", city.FullName))
	sb.WriteString(fmt.Sprintf("Berat: %dg\n", agent.DefaultWeightGram))
	for _, r := range results {
		sb.WriteString(fmt.Sprintf("%s %s: Rp%d (%s hari)\n", r.Courier, r.Service, r.Cost, r.Estimate))
	}
	sb.WriteString("\nAturan: jawab hanya berdasarkan data ini. Jangan mengarang ekspedisi atau harga lain. Bilang 'estimasi' dan bisa berubah.")
	return sb.String()
}

// ListHandoffs: daftar kontak yang sedang butuh ditangani manusia (bot pause).
func ListHandoffs(c *gin.Context) {
	var hs []models.Handoff
	database.DB.Where("agent_id = ?", currentAgentID(c)).Order("created_at desc").Find(&hs)
	c.JSON(200, gin.H{"data": hs})
}

// ResumeHandoff: hapus handoff -> bot lanjut auto-reply ke kontak itu lagi.
func ResumeHandoff(c *gin.Context) {
	database.DB.Where("agent_id = ? AND sender = ?", currentAgentID(c), c.Param("sender")).Delete(&models.Handoff{})
	c.JSON(200, gin.H{"message": "resumed"})
}

// OnDeviceLinked menyimpan device JID & nomor saat agent berhasil login via QR.
func OnDeviceLinked(agentID uint, jid, number string) {
	var a models.Agent
	if database.DB.First(&a, agentID).Error != nil {
		return
	}
	a.DeviceJID = jid
	a.Number = number
	if err := database.DB.Save(&a).Error; err != nil {
		log.Printf("Gagal menyimpan device agent %d: %v", agentID, err)
		return
	}
	log.Printf("Agent %d ter-link ke nomor %s", agentID, number)
}

// StartAgents menyambungkan ulang semua agent yang sudah punya device saat startup.
func StartAgents() {
	var agents []models.Agent
	if err := database.DB.Find(&agents).Error; err != nil {
		log.Printf("Gagal mengambil agent saat startup: %v", err)
		return
	}
	for i := range agents {
		a := agents[i]
		// Hemat resource: hanya sambungkan ulang nomor milik tenant yang langganannya aktif.
		if !tenantWAActive(a.TenantID) {
			continue
		}
		// Migrasi single-number lama: agent default (id 1) adopsi device yang sudah ter-link.
		if a.ID == 1 && a.DeviceJID == "" {
			if jid := services.FirstDeviceJID(); jid != "" {
				a.DeviceJID = jid
				if idx := strings.IndexAny(jid, ":@"); idx >= 0 {
					a.Number = jid[:idx]
				}
				if err := database.DB.Save(&a).Error; err != nil {
					log.Printf("Gagal migrasi device agent %d: %v", a.ID, err)
				}
			}
		}
		if a.DeviceJID != "" {
			go func(ag models.Agent) {
				status, err := services.WA(ag.ID).Connect(ag.DeviceJID)
				if err != nil {
					log.Printf("Agent %d gagal connect: %v", ag.ID, err)
					return
				}
				// Lengkapi cache nomor kalau belum ada.
				if status == "connected" && ag.Number == "" {
					if num, _ := services.WA(ag.ID).GetInfo(); num != "" {
						ag.Number = num
						if err := database.DB.Save(&ag).Error; err != nil {
							log.Printf("Gagal menyimpan nomor agent %d: %v", ag.ID, err)
						}
					}
				}
			}(a)
		}
	}
}

// ---- Agent CRUD ----

func ListAgents(c *gin.Context) {
	var agents []models.Agent
	database.DB.Where("tenant_id = ?", currentTenantID(c)).Order("id asc").Find(&agents)
	c.JSON(200, gin.H{"data": agents})
}

// AgentStatuses mengembalikan status koneksi live tiap agent: { "1": "connected", ... }.
// Dipakai dashboard untuk titik indikator hijau/kuning/merah tanpa menimpa form.
func AgentStatuses(c *gin.Context) {
	var agents []models.Agent
	database.DB.Where("tenant_id = ?", currentTenantID(c)).Order("id asc").Find(&agents)
	out := map[uint]string{}
	for _, a := range agents {
		out[a.ID] = services.WA(a.ID).GetStatus()
	}
	c.JSON(200, gin.H{"data": out})
}

func CreateAgent(c *gin.Context) {
	tid := currentTenantID(c)
	var count int64
	database.DB.Model(&models.Agent{}).Where("tenant_id = ?", tid).Count(&count)
	if int(count) >= planMaxNumbers(tid) {
		c.JSON(403, gin.H{"error": "Batas jumlah nomor pada plan Anda sudah tercapai. Silakan upgrade plan."})
		return
	}
	var req struct {
		Name         string `json:"name"`
		SystemPrompt string `json:"system_prompt"`
		Tone         string `json:"tone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		c.JSON(400, gin.H{"error": "Nama CS wajib diisi"})
		return
	}
	if req.Tone == "" {
		req.Tone = "ramah"
	}
	a := models.Agent{TenantID: tid, Name: strings.TrimSpace(req.Name), SystemPrompt: req.SystemPrompt, Tone: req.Tone, AIEnabled: true}
	if err := database.DB.Create(&a).Error; err != nil {
		log.Printf("Gagal membuat agent tenant %d: %v", tid, err)
		c.JSON(500, gin.H{"error": "Gagal membuat agent"})
		return
	}
	c.JSON(201, gin.H{"data": a})
}

func UpdateAgent(c *gin.Context) {
	var a models.Agent
	if database.DB.Where("tenant_id = ?", currentTenantID(c)).First(&a, c.Param("id")).Error != nil {
		c.JSON(404, gin.H{"error": "Agent tidak ditemukan"})
		return
	}
	var req struct {
		Name                 string  `json:"name"`
		SystemPrompt         *string `json:"system_prompt"`
		Tone                 string  `json:"tone"`
		AIEnabled            *bool   `json:"ai_enabled"`
		GreetingEnabled      *bool   `json:"greeting_enabled"`
		GreetingMessage      *string `json:"greeting_message"`
		BusinessHoursEnabled *bool   `json:"business_hours_enabled"`
		BusinessStart        *string `json:"business_start"`
		BusinessEnd          *string `json:"business_end"`
		AwayMessage          *string `json:"away_message"`
		SpreadsheetURL       *string `json:"spreadsheet_url"`
		SpreadsheetSheetName *string `json:"spreadsheet_sheet_name"`
		SheetSyncEnabled     *bool   `json:"sheet_sync_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if req.Name != "" {
		a.Name = req.Name
	}
	if req.SystemPrompt != nil {
		a.SystemPrompt = *req.SystemPrompt
	}
	if req.Tone != "" {
		a.Tone = req.Tone
	}
	if req.AIEnabled != nil {
		a.AIEnabled = *req.AIEnabled
	}
	if req.GreetingEnabled != nil {
		a.GreetingEnabled = *req.GreetingEnabled
	}
	if req.GreetingMessage != nil {
		a.GreetingMessage = *req.GreetingMessage
	}
	if req.BusinessHoursEnabled != nil {
		a.BusinessHoursEnabled = *req.BusinessHoursEnabled
	}
	if req.BusinessStart != nil {
		a.BusinessStart = *req.BusinessStart
	}
	if req.BusinessEnd != nil {
		a.BusinessEnd = *req.BusinessEnd
	}
	if req.AwayMessage != nil {
		a.AwayMessage = *req.AwayMessage
	}
	if req.SpreadsheetURL != nil {
		a.SpreadsheetURL = *req.SpreadsheetURL
	}
	if req.SpreadsheetSheetName != nil {
		a.SpreadsheetSheetName = *req.SpreadsheetSheetName
	}
	if req.SheetSyncEnabled != nil {
		a.SheetSyncEnabled = *req.SheetSyncEnabled
	}
	if err := database.DB.Save(&a).Error; err != nil {
		log.Printf("Gagal menyimpan agent %d: %v", a.ID, err)
		c.JSON(500, gin.H{"error": "Gagal menyimpan data"})
		return
	}
	c.JSON(200, gin.H{"data": a})
}

// maybeSummarize: trigger ringkasan percakapan kalau jeda >30 menit dari summary terakhir.
// Dijalankan di background goroutine supaya tidak blocking reply ke user.
func maybeSummarize(agent models.Agent, senderNum string) {
	if agent.LastSummaryAt != nil && time.Since(*agent.LastSummaryAt) < 30*time.Minute {
		return // belum waktunya
	}
	// Ambil 30 pesan terakhir untuk konteks ringkasan.
	var msgs []models.ChatHistory
	database.DB.Where("agent_id = ? AND sender = ?", agent.ID, senderNum).
		Order("created_at desc").Limit(30).Find(&msgs)
	if len(msgs) < 4 {
		return // terlalu sedikit untuk diringkas
	}
	summary, err := services.SummarizeConversation(agent.ID, msgs)
	if err != nil {
		log.Printf("Summarize gagal (agent %d, %s): %v", agent.ID, senderNum, err)
		return
	}
	// Merge dengan summary lama (kalau ada) -> prepend.
	if agent.ConversationSummary != "" {
		summary = summary + " | " + agent.ConversationSummary
	}
	// Potong max 300 karakter.
	if len(summary) > 300 {
		summary = summary[:300]
	}
	now := time.Now()
	if err := database.DB.Model(&agent).Updates(map[string]any{
		"conversation_summary": summary,
		"last_summary_at":      now,
	}).Error; err != nil {
		log.Printf("Gagal menyimpan summary agent %d: %v", agent.ID, err)
		return
	}
	log.Printf("Summarized (agent %d, %s): %s", agent.ID, senderNum, summary)
}

func DeleteAgent(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	// Bebaskan sesi WA dari memori (client, goroutine, file sesi) agar tidak bocor.
	services.RemoveWA(id)
	// Bersihkan data milik agent agar tidak jadi baris yatim di DB.
	database.DB.Where("agent_id = ?", id).Delete(&models.Knowledge{})
	database.DB.Where("agent_id = ?", id).Delete(&models.ChatHistory{})
	database.DB.Where("agent_id = ?", id).Delete(&models.Contact{})
	database.DB.Where("agent_id = ?", id).Delete(&models.Handoff{})
	database.DB.Where("agent_id = ?", id).Delete(&models.AutoReply{})
	database.DB.Where("tenant_id = ?", currentTenantID(c)).Delete(&models.Agent{}, id)
	c.JSON(200, gin.H{"message": "Deleted"})
}
