package handlers

import (
	"log"
	"math/rand"
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

// CreateBroadcast membuat kampanye broadcast & menjalankannya di background (dengan throttle).
func CreateBroadcast(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	tid := currentTenantID(c)
	var req struct {
		Message    string `json:"message"`
		Recipients []struct {
			Number string `json:"number"`
			Name   string `json:"name"`
		} `json:"recipients"`
		MinDelay int `json:"min_delay"`
		MaxDelay int `json:"max_delay"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Message) == "" || len(req.Recipients) == 0 {
		c.JSON(400, gin.H{"error": "Pesan & penerima wajib diisi"})
		return
	}
	if services.WA(id).GetStatus() != "connected" {
		c.JSON(400, gin.H{"error": "WhatsApp belum tersambung"})
		return
	}
	if len(req.Recipients) > 1000 {
		c.JSON(400, gin.H{"error": "Maksimal 1000 penerima per broadcast"})
		return
	}

	// Throttle aman (detik). Default 10-30, minimal 5.
	minD, maxD := req.MinDelay, req.MaxDelay
	if minD < 5 {
		minD = 10
	}
	if maxD < minD {
		maxD = minD + 20
	}

	// Normalisasi + dedupe penerima.
	seen := map[string]bool{}
	b := models.Broadcast{TenantID: tid, AgentID: id, Message: req.Message, Status: "pending"}
	var recipients []models.BroadcastRecipient
	for _, r := range req.Recipients {
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

// runBroadcast mengirim pesan ke tiap penerima dengan jeda acak (anti-banned).
func runBroadcast(broadcastID, agentID uint, minD, maxD int) {
	database.DB.Model(&models.Broadcast{}).Where("id = ?", broadcastID).Update("status", "running")

	var b models.Broadcast
	database.DB.First(&b, broadcastID)
	var recipients []models.BroadcastRecipient
	database.DB.Where("broadcast_id = ? AND status = ?", broadcastID, "pending").Find(&recipients)

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
		if err := services.WA(agentID).SendText(r.Number, msg); err != nil {
			markRecipient(r.ID, "failed", err.Error())
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
