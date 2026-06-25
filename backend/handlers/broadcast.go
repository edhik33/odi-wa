package handlers

import (
	"encoding/json"
	"io"
	"log"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

// CheckNumbers memeriksa daftar nomor apakah terdaftar di WhatsApp sebelum broadcast.
func CheckNumbers(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var req struct {
		Numbers []string `json:"numbers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Numbers) == 0 {
		c.JSON(400, gin.H{"error": "Daftar nomor kosong"})
		return
	}
	if !services.WA(id).IsConnected() {
		c.JSON(400, gin.H{"error": "WhatsApp belum tersambung"})
		return
	}
	res, err := services.WA(id).CheckNumbers(req.Numbers)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	// Tandai kontak "hangat" = pernah ada percakapan tercatat dengan agent ini.
	// Riwayat lama bisa tersimpan sebagai LID, bukan nomor telepon — jadi cocokkan keduanya.
	keyByNumber := make(map[string][]string, len(res))
	allKeys := make([]string, 0, len(res)*2)
	for _, r := range res {
		keys := []string{r.Number}
		if lid := services.WA(id).LIDForPN(r.Number); lid != "" {
			keys = append(keys, lid)
		}
		keyByNumber[r.Number] = keys
		allKeys = append(allKeys, keys...)
	}
	warmKeySet := map[string]bool{}
	if len(allKeys) > 0 {
		var warm []string
		database.DB.Model(&models.ChatHistory{}).
			Where("agent_id = ? AND sender IN ?", id, allKeys).
			Distinct().Pluck("sender", &warm)
		for _, w := range warm {
			warmKeySet[w] = true
		}
	}
	isWarm := func(number string) bool {
		for _, k := range keyByNumber[number] {
			if warmKeySet[k] {
				return true
			}
		}
		return false
	}
	data := make([]gin.H, 0, len(res))
	for _, r := range res {
		data = append(data, gin.H{"input": r.Input, "number": r.Number, "registered": r.Registered, "warm": isWarm(r.Number)})
	}
	c.JSON(200, gin.H{
		"data": data,
		"summary": gin.H{
			"sent_today": dailySentCount(id),
			"daily_cap":  config.EnvInt("BROADCAST_DAILY_CAP", 200),
		},
	})
}

// CreateBroadcast membuat kampanye broadcast (multipart: bisa dengan lampiran) & menjalankannya di background.
func CreateBroadcast(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	tid := currentTenantID(c)

	message := c.PostForm("message")
	if strings.TrimSpace(message) == "" {
		c.JSON(400, gin.H{"error": "Pesan wajib diisi"})
		return
	}
	var reqRecipients []struct {
		Number string `json:"number"`
		Name   string `json:"name"`
	}
	if err := json.Unmarshal([]byte(c.PostForm("recipients")), &reqRecipients); err != nil || len(reqRecipients) == 0 {
		c.JSON(400, gin.H{"error": "Penerima wajib diisi"})
		return
	}
	if !services.WA(id).IsConnected() {
		c.JSON(400, gin.H{"error": "WhatsApp belum tersambung"})
		return
	}
	if len(reqRecipients) > 1000 {
		c.JSON(400, gin.H{"error": "Maksimal 1000 penerima per broadcast"})
		return
	}

	minD, _ := strconv.Atoi(c.PostForm("min_delay"))
	maxD, _ := strconv.Atoi(c.PostForm("max_delay"))
	if minD < 5 {
		minD = 10
	}
	if maxD < minD {
		maxD = minD + 20
	}

	b := models.Broadcast{TenantID: tid, AgentID: id, Message: message, Status: "pending"}

	// Lampiran opsional (gambar/file) untuk semua penerima.
	if fh, err := c.FormFile("file"); err == nil {
		if f, ferr := fh.Open(); ferr == nil {
			defer f.Close()
			data, _ := io.ReadAll(f)
			b.Mimetype = fh.Header.Get("Content-Type")
			if b.Mimetype == "" {
				b.Mimetype = "application/octet-stream"
			}
			b.FileName = fh.Filename
			b.MediaType = "document"
			if strings.HasPrefix(b.Mimetype, "image/") {
				b.MediaType = "image"
			}
			b.MediaPath = storeMedia(id, data, b.Mimetype, fh.Filename)
		}
	}

	// Normalisasi + dedupe penerima.
	seen := map[string]bool{}
	var recipients []models.BroadcastRecipient
	for _, r := range reqRecipients {
		num := services.NormalizePhone(r.Number)
		if num == "" || seen[num] {
			continue
		}
		seen[num] = true
		recipients = append(recipients, models.BroadcastRecipient{Number: num, Name: strings.TrimSpace(r.Name), Status: "pending"})
	}
	if len(recipients) == 0 {
		c.JSON(400, gin.H{"error": "Tidak ada nomor valid"})
		return
	}
	b.Total = len(recipients)
	if err := database.DB.Create(&b).Error; err != nil { log.Printf("Gagal Create Broadcast: %v", err); c.JSON(500, gin.H{"error": "Gagal"}); return }
	for i := range recipients {
		recipients[i].BroadcastID = b.ID
	}
	database.DB.Create(&recipients)

	go runBroadcast(b.ID, id, minD, maxD)
	c.JSON(200, gin.H{"data": b})
}

// CancelBroadcast membatalkan broadcast yang belum selesai.
// Dua tahap: running -> cancel_requested -> (worker cek) -> cancelled.
// Pending/interrupted langsung finalize karena tidak ada worker aktif.
func CancelBroadcast(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	bid, err := strconv.Atoi(c.Param("bid"))
	if err != nil || bid <= 0 {
		c.JSON(400, gin.H{"error": "ID broadcast tidak valid"})
		return
	}
	var b models.Broadcast
	if database.DB.Where("id = ? AND agent_id = ?", bid, id).First(&b).Error != nil {
		c.JSON(404, gin.H{"error": "Broadcast tidak ditemukan"})
		return
	}
	switch b.Status {
	case "done", "failed", models.BroadcastCancelled:
		c.JSON(400, gin.H{"error": "Broadcast sudah selesai dan tidak bisa dibatalkan"})
		return
	}
	// Kalau tidak ada worker aktif, finalize langsung.
	if b.Status == models.BroadcastPending || b.Status == models.BroadcastInterrupted {
		finalizeCancelledBroadcast(b.ID)
		c.JSON(200, gin.H{"message": "Broadcast dibatalkan", "status": models.BroadcastCancelled})
		return
	}
	// Kalau running, minta worker berhenti di checkpoint.
	res := database.DB.Model(&models.Broadcast{}).
		Where("id = ? AND agent_id = ? AND status = ?", b.ID, id, models.BroadcastRunning).
		Update("status", models.BroadcastCancelRequested)
	if res.Error != nil {
		c.JSON(500, gin.H{"error": "Gagal membatalkan broadcast"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(409, gin.H{"error": "Broadcast sudah berubah status. Silakan refresh."})
		return
	}
	c.JSON(200, gin.H{
		"message": "Permintaan cancel diterima. Broadcast akan berhenti setelah proses saat ini selesai.",
		"status":  models.BroadcastCancelRequested,
	})
}

// isBroadcastCancelRequested cek apakah broadcast sudah diminta cancel.
func isBroadcastCancelRequested(broadcastID uint) bool {
	var status string
	if err := database.DB.Model(&models.Broadcast{}).
		Where("id = ?", broadcastID).Select("status").Scan(&status).Error; err != nil {
		log.Printf("Gagal cek status cancel broadcast %d: %v", broadcastID, err)
		return false
	}
	return status == models.BroadcastCancelRequested || status == models.BroadcastCancelled
}

// finalizeCancelledBroadcast menandai recipient pending sebagai skipped,
// lalu set status broadcast final jadi cancelled.
func finalizeCancelledBroadcast(broadcastID uint) {
	database.DB.Model(&models.BroadcastRecipient{}).
		Where("broadcast_id = ? AND status = ?", broadcastID, "pending").
		Updates(map[string]any{"status": "skipped", "error": "broadcast dibatalkan user"})
	var sent, failed, skipped int64
	database.DB.Model(&models.BroadcastRecipient{}).Where("broadcast_id = ? AND status = ?", broadcastID, "sent").Count(&sent)
	database.DB.Model(&models.BroadcastRecipient{}).Where("broadcast_id = ? AND status = ?", broadcastID, "failed").Count(&failed)
	database.DB.Model(&models.BroadcastRecipient{}).Where("broadcast_id = ? AND status = ?", broadcastID, "skipped").Count(&skipped)
	finishBroadcast(broadcastID, models.BroadcastCancelled, int(sent), int(failed), int(skipped))
}

// sleepBroadcastDelay tidur 1 detik per iterasi sambil cek cancel.
// Return false jika broadcast sudah diminta cancel.
func sleepBroadcastDelay(broadcastID uint, d int) bool {
	for i := 0; i < d; i++ {
		if isBroadcastCancelRequested(broadcastID) {
			return false
		}
		time.Sleep(1 * time.Second)
	}
	return true
}

// ResumeBroadcasts melanjutkan broadcast yang masih punya penerima "pending"
// (mis. server sempat restart di tengah pengiriman). Dipanggil sekali saat startup.
func ResumeBroadcasts() {
	// Bereskan cancel_requested yang nyangkut (server mati setelah user klik cancel).
	var cancelReq []models.Broadcast
	database.DB.Where("status = ?", models.BroadcastCancelRequested).Find(&cancelReq)
	for _, b := range cancelReq {
		finalizeCancelledBroadcast(b.ID)
	}

	var bs []models.Broadcast
	database.DB.Where("status IN ?", []string{models.BroadcastRunning, models.BroadcastInterrupted, models.BroadcastPending}).Find(&bs)
	for _, b := range bs {
		var pending int64
		database.DB.Model(&models.BroadcastRecipient{}).Where("broadcast_id = ? AND status = ?", b.ID, "pending").Count(&pending)
		if pending == 0 {
			_ = database.DB.Model(&models.Broadcast{}).Where("id = ?", b.ID).Update("status", "done").Error
			continue
		}
		go resumeBroadcast(b.ID, b.AgentID)
	}
}

// resumeBroadcast menunggu WA agent tersambung (maks ~90 detik) lalu melanjutkan pengiriman.
func resumeBroadcast(broadcastID, agentID uint) {
	for i := 0; i < 18; i++ {
		if services.WA(agentID).IsConnected() {
			log.Printf("Melanjutkan broadcast %d (agent %d)", broadcastID, agentID)
			runBroadcast(broadcastID, agentID, 10, 30) // delay default (min/max tidak dipersistensikan)
			return
		}
		time.Sleep(5 * time.Second)
	}
	_ = database.DB.Model(&models.Broadcast{}).Where("id = ?", broadcastID).Update("status", "interrupted").Error
	log.Printf("Broadcast %d belum dilanjutkan: WA agent %d tidak tersambung", broadcastID, agentID)
}

// runBroadcast mengirim pesan ke tiap penerima dengan jeda acak (anti-banned).
func runBroadcast(broadcastID, agentID uint, minD, maxD int) {
	_ = database.DB.Model(&models.Broadcast{}).Where("id = ?", broadcastID).Update("status", "running").Error

	var b models.Broadcast
	database.DB.First(&b, broadcastID)
	var recipients []models.BroadcastRecipient
	database.DB.Where("broadcast_id = ? AND status = ?", broadcastID, "pending").Find(&recipients)

	// Baca lampiran sekali saja (kalau ada), dipakai untuk semua penerima.
	var mediaBytes []byte
	if b.MediaType != "" && b.MediaPath != "" {
		mediaBytes, _ = os.ReadFile(b.MediaPath)
	}

	dailyCap := config.EnvInt("BROADCAST_DAILY_CAP", 200)
	sent, failed, skipped := 0, 0, 0

	// Muat sekali di awal (bukan query per-penerima): himpunan opt-out + jumlah terkirim hari ini.
	optedOut := optedOutSet(agentID)
	daily := int(dailySentCount(agentID))

	for i, r := range recipients {
		// Cek cancel_requested di awal setiap iterasi.
		if isBroadcastCancelRequested(broadcastID) {
			finalizeCancelledBroadcast(broadcastID)
			log.Printf("Broadcast %d dibatalkan user sebelum kirim recipient berikutnya", broadcastID)
			return
		}
		// Pastikan WA tersambung; tunggu reconnect otomatis hingga ~60 detik. Kalau tetap putus,
		// JEDA broadcast (status interrupted) — sisa penerima tetap "pending" agar bisa dilanjutkan,
		// bukan ditandai gagal massal yang menyesatkan.
		if !waitConnected(agentID, 60*time.Second) {
			finishBroadcast(broadcastID, "interrupted", sent, failed, skipped)
			log.Printf("Broadcast %d dijeda: WA agent %d terputus (%d terkirim, sisa tetap pending)", broadcastID, agentID, sent)
			return
		}
		// Segarkan daftar opt-out berkala agar pelanggan yang baru kirim STOP di tengah jalan tetap dihormati.
		if i > 0 && i%25 == 0 {
			optedOut = optedOutSet(agentID)
		}
		// Lewati yang sudah opt-out.
		if optedOut[r.Number] {
			markRecipient(r.ID, "skipped", "opt-out")
			skipped++
			updateBroadcastCounters(broadcastID, sent, failed, skipped)
			continue
		}
		// Hormati batas harian (anti-banned).
		if daily >= dailyCap {
			markRecipient(r.ID, "skipped", "batas harian tercapai")
			skipped++
			updateBroadcastCounters(broadcastID, sent, failed, skipped)
			continue
		}

		msg := personalize(b.Message, r.Name)
		// Cek cancel_requested sebelum kirim.
		if isBroadcastCancelRequested(broadcastID) {
			finalizeCancelledBroadcast(broadcastID)
			log.Printf("Broadcast %d dibatalkan user sebelum pengiriman ke %s", broadcastID, r.Number)
			return
		}
		var sendErr error
		switch {
		case b.MediaType == "image" && len(mediaBytes) > 0:
			sendErr = services.WA(agentID).SendImage(r.Number, msg, b.Mimetype, mediaBytes)
		case b.MediaType == "document" && len(mediaBytes) > 0:
			sendErr = services.WA(agentID).SendDocument(r.Number, b.FileName, b.Mimetype, msg, mediaBytes)
		default:
			sendErr = services.WA(agentID).SendText(r.Number, msg)
		}
		if sendErr != nil {
			// Error karena koneksi putus saat kirim -> jeda broadcast, JANGAN tandai gagal
			// (penerima tetap pending agar bisa dilanjutkan saat WA tersambung lagi).
			if strings.Contains(sendErr.Error(), "tidak terhubung") {
				finishBroadcast(broadcastID, "interrupted", sent, failed, skipped)
				log.Printf("Broadcast %d dijeda saat kirim ke %s: WA terputus", broadcastID, r.Number)
				return
			}
			markRecipient(r.ID, "failed", sendErr.Error())
			failed++
		} else {
			now := time.Now()
			database.DB.Model(&models.BroadcastRecipient{}).Where("id = ?", r.ID).
				Updates(map[string]any{"status": "sent", "sent_at": &now, "error": ""})
			sent++
			daily++ // hitung pemakaian jatah harian secara in-memory
		}
		updateBroadcastCounters(broadcastID, sent, failed, skipped)

		// Jeda acak antar pesan (kecuali penerima terakhir), sambil cek cancel.
		if i < len(recipients)-1 {
			d := minD
			if maxD > minD {
				d = minD + rand.Intn(maxD-minD+1)
			}
			if !sleepBroadcastDelay(broadcastID, d) {
				finalizeCancelledBroadcast(broadcastID)
				log.Printf("Broadcast %d dibatalkan user saat jeda antar pesan", broadcastID)
				return
			}
		}
	}

	// Status akhir jujur: kalau tidak ada satu pun terkirim & ada yang gagal, ini "failed", bukan "done".
	finalStatus := "done"
	if sent == 0 && failed > 0 {
		finalStatus = "failed"
	}
	finishBroadcast(broadcastID, finalStatus, sent, failed, skipped)
	log.Printf("Broadcast %d %s: %d terkirim, %d gagal, %d dilewati", broadcastID, finalStatus, sent, failed, skipped)
}

// finishBroadcast menyetel status akhir broadcast sekaligus menyinkronkan jadwal pemicunya
// (kalau broadcast ini berasal dari scheduled message) agar status di kalender tidak menipu.
func finishBroadcast(broadcastID uint, status string, sent, failed, skipped int) {
	database.DB.Model(&models.Broadcast{}).Where("id = ?", broadcastID).
		Updates(map[string]any{"status": status, "sent": sent, "failed": failed, "skipped": skipped})
	_ = database.DB.Model(&models.ScheduledMessage{}).Where("broadcast_id = ?", broadcastID).Update("status", status).Error
}

// waitConnected menunggu socket WA agent benar-benar tersambung hingga max durasi (poll tiap 3 detik).
func waitConnected(agentID uint, max time.Duration) bool {
	deadline := time.Now().Add(max)
	for {
		if services.WA(agentID).IsConnected() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(3 * time.Second)
	}
}

func markRecipient(id uint, status, errMsg string) {
	database.DB.Model(&models.BroadcastRecipient{}).Where("id = ?", id).
		Updates(map[string]any{"status": status, "error": errMsg})
}

func updateBroadcastCounters(broadcastID uint, sent, failed, skipped int) {
	database.DB.Model(&models.Broadcast{}).Where("id = ?", broadcastID).
		Updates(map[string]any{"sent": sent, "failed": failed, "skipped": skipped})
}

func dailySentCount(agentID uint) int64 {
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var n int64
	database.DB.Model(&models.BroadcastRecipient{}).
		Joins("JOIN broadcasts ON broadcasts.id = broadcast_recipients.broadcast_id").
		Where("broadcasts.agent_id = ? AND broadcast_recipients.status = ? AND broadcast_recipients.sent_at >= ?", agentID, "sent", startOfDay).
		Count(&n)
	return n
}

func personalize(tmpl, name string) string {
	n := name
	if n == "" {
		n = "kak"
	}
	return strings.ReplaceAll(tmpl, "{nama}", n)
}

// ListBroadcasts mengembalikan riwayat broadcast agent (dipaginate).
func ListBroadcasts(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	const limit = 10
	var total int64
	database.DB.Model(&models.Broadcast{}).Where("agent_id = ?", id).Count(&total)
	var bs []models.Broadcast
	database.DB.Where("agent_id = ?", id).Order("created_at desc").
		Offset((page - 1) * limit).Limit(limit).Find(&bs)
	c.JSON(200, gin.H{"data": bs, "total": total, "page": page, "limit": limit})
}

// BroadcastDetail = detail satu broadcast beserta status tiap penerima.
func BroadcastDetail(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var b models.Broadcast
	if database.DB.Where("id = ? AND agent_id = ?", c.Param("bid"), id).First(&b).Error != nil {
		c.JSON(404, gin.H{"error": "Broadcast tidak ditemukan"})
		return
	}
	var recipients []models.BroadcastRecipient
	database.DB.Where("broadcast_id = ?", b.ID).Order("id asc").Find(&recipients)
	c.JSON(200, gin.H{"data": gin.H{"broadcast": b, "recipients": recipients}})
}

// optedOutSet mengembalikan himpunan nomor yang sudah opt-out untuk agent ini.
func optedOutSet(agentID uint) map[string]bool {
	var nums []string
	database.DB.Model(&models.OptOut{}).Where("agent_id = ?", agentID).Pluck("sender", &nums)
	set := make(map[string]bool, len(nums))
	for _, n := range nums {
		set[n] = true
	}
	return set
}

// contactNames = peta nomor -> nama profil (dari tabel Contact) untuk satu agent.
func contactNames(agentID uint) map[string]string {
	var cs []models.Contact
	database.DB.Where("agent_id = ?", agentID).Find(&cs)
	m := make(map[string]string, len(cs))
	for _, c := range cs {
		if c.Name != "" {
			m[c.Number] = c.Name
		}
	}
	return m
}

// OnAgentConnected mengisi tabel Contact dari buku alamat WA saat agent tersambung.
// Hanya menambah nomor yang belum punya nama (tidak menimpa nama hasil PushName/chat).
func OnAgentConnected(agentID uint) {
	contacts, err := services.WA(agentID).GetContacts()
	if err != nil || len(contacts) == 0 {
		return
	}
	var existing []models.Contact
	database.DB.Where("agent_id = ?", agentID).Find(&existing)
	have := make(map[string]bool, len(existing))
	for _, c := range existing {
		have[c.Number] = true
	}
	fresh := make([]models.Contact, 0)
	for _, ct := range contacts {
		if ct.Number == "" || ct.Name == "" || have[ct.Number] {
			continue
		}
		have[ct.Number] = true // cegah duplikat dalam batch yang sama
		fresh = append(fresh, models.Contact{AgentID: agentID, Number: ct.Number, Name: ct.Name})
	}
	if len(fresh) > 0 {
		database.DB.CreateInBatches(fresh, 200)
		log.Printf("Backfill kontak (agent %d): %d nama dari buku alamat WhatsApp", agentID, len(fresh))
	}
	// Rapikan data lama yang menyimpan pengirim sebagai LID -> nomor telepon.
	migrateLIDSenders(agentID)
}

// ChatContacts = kontak yang PERNAH chat agent ini (sumber broadcast paling aman). Tanpa yang opt-out.
func ChatContacts(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var senders []string
	database.DB.Model(&models.ChatHistory{}).Where("agent_id = ? AND sender <> ''", id).
		Distinct().Pluck("sender", &senders)
	out := optedOutSet(id)
	names := contactNames(id)
	res := make([]gin.H, 0, len(senders))
	for _, s := range senders {
		if !out[s] {
			res = append(res, gin.H{"number": s, "name": names[s]})
		}
	}
	c.JSON(200, gin.H{"data": res})
}

// WAContacts = buku alamat akun WhatsApp yang tertaut (lebih berisiko, banyak yang belum tentu opt-in).
func WAContacts(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	if !services.WA(id).IsConnected() {
		c.JSON(400, gin.H{"error": "WhatsApp belum tersambung"})
		return
	}
	contacts, err := services.WA(id).GetContacts()
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	out := optedOutSet(id)
	res := make([]services.WAContact, 0, len(contacts))
	for _, ct := range contacts {
		if !out[ct.Number] {
			res = append(res, ct)
		}
	}
	c.JSON(200, gin.H{"data": res})
}

// isOptOutKeyword mendeteksi permintaan berhenti (STOP/BERHENTI).
func isOptOutKeyword(text string) bool {
	switch strings.ToLower(strings.TrimSpace(text)) {
	case "stop", "berhenti", "unsub", "unsubscribe", "cancel":
		return true
	}
	return false
}
