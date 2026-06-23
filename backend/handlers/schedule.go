package handlers

import (
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"time"

	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

type scheduleRecipient struct {
	Number string `json:"number"`
	Name   string `json:"name"`
}

// CreateSchedule menjadwalkan broadcast untuk waktu tertentu (multipart, bisa dengan lampiran).
func CreateSchedule(c *gin.Context) {
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
	runAt, err := time.Parse(time.RFC3339, c.PostForm("run_at"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Waktu jadwal tidak valid"})
		return
	}
	if runAt.Before(time.Now().Add(-time.Minute)) {
		c.JSON(400, gin.H{"error": "Waktu jadwal sudah lewat"})
		return
	}

	var reqRecipients []scheduleRecipient
	if json.Unmarshal([]byte(c.PostForm("recipients")), &reqRecipients) != nil || len(reqRecipients) == 0 {
		c.JSON(400, gin.H{"error": "Penerima wajib diisi"})
		return
	}
	seen := map[string]bool{}
	clean := make([]scheduleRecipient, 0, len(reqRecipients))
	for _, r := range reqRecipients {
		num := services.NormalizePhone(r.Number)
		if num == "" || seen[num] {
			continue
		}
		seen[num] = true
		clean = append(clean, scheduleRecipient{Number: num, Name: strings.TrimSpace(r.Name)})
	}
	if len(clean) == 0 {
		c.JSON(400, gin.H{"error": "Tidak ada nomor valid"})
		return
	}
	recJSON, _ := json.Marshal(clean)

	minD, _ := strconv.Atoi(c.PostForm("min_delay"))
	maxD, _ := strconv.Atoi(c.PostForm("max_delay"))
	if minD < 5 {
		minD = 10
	}
	if maxD < minD {
		maxD = minD + 20
	}

	s := models.ScheduledMessage{
		TenantID: tid, AgentID: id, RunAt: runAt, Message: message,
		Recipients: string(recJSON), RecipientCount: len(clean),
		MinDelay: minD, MaxDelay: maxD, Status: "scheduled",
	}
	if fh, ferr := c.FormFile("file"); ferr == nil {
		if f, e := fh.Open(); e == nil {
			defer f.Close()
			data, _ := io.ReadAll(f)
			s.Mimetype = fh.Header.Get("Content-Type")
			if s.Mimetype == "" {
				s.Mimetype = "application/octet-stream"
			}
			s.FileName = fh.Filename
			s.MediaType = "document"
			if strings.HasPrefix(s.Mimetype, "image/") {
				s.MediaType = "image"
			}
			s.MediaPath = storeMedia(id, data, s.Mimetype, fh.Filename)
		}
	}
	database.DB.Create(&s)
	c.JSON(200, gin.H{"data": s})
}

// ListSchedules = daftar jadwal agent.
func ListSchedules(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var ss []models.ScheduledMessage
	database.DB.Where("agent_id = ?", id).Order("run_at asc").Limit(300).Find(&ss)
	c.JSON(200, gin.H{"data": ss})
}

// CancelSchedule membatalkan jadwal yang belum jalan.
func CancelSchedule(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	database.DB.Model(&models.ScheduledMessage{}).
		Where("id = ? AND agent_id = ? AND status = ?", c.Param("sid"), id, "scheduled").
		Update("status", "cancelled")
	c.JSON(200, gin.H{"ok": true})
}

// StartScheduler mengecek jadwal & follow-up yang jatuh tempo tiap menit & menjalankannya.
func StartScheduler() {
	go func() {
		processDueSchedules()
		go processDueFollowUps()
		t := time.NewTicker(1 * time.Minute)
		for range t.C {
			processDueSchedules()
			// Follow-up dijalankan terpisah (bisa menyelipkan jeda antar kirim) agar tak menahan jadwal.
			go processDueFollowUps()
		}
	}()
}

func processDueSchedules() {
	var due []models.ScheduledMessage
	database.DB.Where("status = ? AND run_at <= ?", "scheduled", time.Now()).Find(&due)
	for _, s := range due {
		if !tenantWAActive(s.TenantID) {
			continue // tenant tidak aktif -> tunda (tetap scheduled)
		}
		if !services.WA(s.AgentID).IsConnected() {
			continue // WA belum tersambung -> tunda, coba lagi menit berikutnya (jangan kirim ke ruang hampa)
		}
		database.DB.Model(&models.ScheduledMessage{}).Where("id = ?", s.ID).Update("status", "running")
		fireScheduled(s)
	}
}

// fireScheduled membuat broadcast dari jadwal lalu menjalankannya.
func fireScheduled(s models.ScheduledMessage) {
	var recs []scheduleRecipient
	json.Unmarshal([]byte(s.Recipients), &recs)

	b := models.Broadcast{
		TenantID: s.TenantID, AgentID: s.AgentID, Message: s.Message, Status: "pending",
		MediaType: s.MediaType, MediaPath: s.MediaPath, FileName: s.FileName, Mimetype: s.Mimetype,
	}
	var recipients []models.BroadcastRecipient
	for _, r := range recs {
		recipients = append(recipients, models.BroadcastRecipient{Number: r.Number, Name: r.Name, Status: "pending"})
	}
	b.Total = len(recipients)
	database.DB.Create(&b)
	for i := range recipients {
		recipients[i].BroadcastID = b.ID
	}
	if len(recipients) > 0 {
		database.DB.Create(&recipients)
	}
	// Status jadwal tetap "running"; disinkronkan ke hasil akhir broadcast oleh finishBroadcast.
	database.DB.Model(&models.ScheduledMessage{}).Where("id = ?", s.ID).Update("broadcast_id", b.ID)

	go runBroadcast(b.ID, s.AgentID, s.MinDelay, s.MaxDelay)
}

// CleanupStuckSchedules menandai jadwal yang "running" saat server mati sebagai interrupted.
func CleanupStuckSchedules() {
	database.DB.Model(&models.ScheduledMessage{}).Where("status = ?", "running").Update("status", "interrupted")
}
