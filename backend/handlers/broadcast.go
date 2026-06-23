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
	if services.WA(id).GetStatus() != "connected" {
		c.JSON(400, gin.H{"error": "WhatsApp belum tersambung"})
		return
	}
	res, err := services.WA(id).CheckNumbers(req.Numbers)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": res})
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
	if services.WA(id).GetStatus() != "connected" {
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
	database.DB.Create(&b)
	for i := range recipients {
		recipients[i].BroadcastID = b.ID
	}
	database.DB.Create(&recipients)

	go runBroadcast(b.ID, id, minD, maxD)
	c.JSON(200, gin.H{"data": b})
}

// CleanupStuckBroadcasts menandai broadcast yang masih "running" saat server mati sebagai interrupted.
func CleanupStuckBroadcasts() {
	database.DB.Model(&models.Broadcast{}).Where("status = ?", "running").Update("status", "interrupted")
}

// runBroadcast mengirim pesan ke tiap penerima dengan jeda acak (anti-banned).
func runBroadcast(broadcastID, agentID uint, minD, maxD int) {
	database.DB.Model(&models.Broadcast{}).Where("id = ?", broadcastID).Update("status", "running")

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

	for i, r := range recipients {
		// Lewati yang sudah opt-out.
		var oc int64
		database.DB.Model(&models.OptOut{}).Where("agent_id = ? AND sender = ?", agentID, r.Number).Count(&oc)
		if oc > 0 {
			markRecipient(r.ID, "skipped", "opt-out")
			skipped++
			updateBroadcastCounters(broadcastID, sent, failed, skipped)
			continue
		}
		// Hormati batas harian (anti-banned).
		if dailySentCount(agentID) >= int64(dailyCap) {
			markRecipient(r.ID, "skipped", "batas harian tercapai")
			skipped++
			updateBroadcastCounters(broadcastID, sent, failed, skipped)
			continue
		}

		msg := personalize(b.Message, r.Name)
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
			markRecipient(r.ID, "failed", sendErr.Error())
			failed++
		} else {
			now := time.Now()
			database.DB.Model(&models.BroadcastRecipient{}).Where("id = ?", r.ID).
				Updates(map[string]any{"status": "sent", "sent_at": &now, "error": ""})
			sent++
		}
		updateBroadcastCounters(broadcastID, sent, failed, skipped)

		// Jeda acak antar pesan (kecuali penerima terakhir).
		if i < len(recipients)-1 {
			d := minD
			if maxD > minD {
				d = minD + rand.Intn(maxD-minD+1)
			}
			time.Sleep(time.Duration(d) * time.Second)
		}
	}

	database.DB.Model(&models.Broadcast{}).Where("id = ?", broadcastID).
		Updates(map[string]any{"status": "done", "sent": sent, "failed": failed, "skipped": skipped})
	log.Printf("Broadcast %d selesai: %d terkirim, %d gagal, %d dilewati", broadcastID, sent, failed, skipped)
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

// ListBroadcasts mengembalikan riwayat broadcast agent (dengan progres terkini).
func ListBroadcasts(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var bs []models.Broadcast
	database.DB.Where("agent_id = ?", id).Order("created_at desc").Limit(50).Find(&bs)
	c.JSON(200, gin.H{"data": bs})
}

// isOptOutKeyword mendeteksi permintaan berhenti (STOP/BERHENTI).
func isOptOutKeyword(text string) bool {
	switch strings.ToLower(strings.TrimSpace(text)) {
	case "stop", "berhenti", "unsub", "unsubscribe", "cancel":
		return true
	}
	return false
}
