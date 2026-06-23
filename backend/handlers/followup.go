package handlers

import (
	"sync"
	"time"

	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

type followUpStepReq struct {
	DelayHours int    `json:"delay_hours"`
	Message    string `json:"message"`
}

// stepsWithCounts merangkai respons follow-up lengkap dengan langkah & ringkasan pendaftaran.
func followUpResponse(fu models.FollowUp) gin.H {
	var steps []models.FollowUpStep
	database.DB.Where("follow_up_id = ?", fu.ID).Order("step_order asc, id asc").Find(&steps)
	var active, completed, stopped int64
	database.DB.Model(&models.FollowUpEnrollment{}).Where("follow_up_id = ? AND status = ?", fu.ID, "active").Count(&active)
	database.DB.Model(&models.FollowUpEnrollment{}).Where("follow_up_id = ? AND status = ?", fu.ID, "completed").Count(&completed)
	database.DB.Model(&models.FollowUpEnrollment{}).Where("follow_up_id = ? AND status = ?", fu.ID, "stopped").Count(&stopped)
	return gin.H{
		"id": fu.ID, "name": fu.Name, "enabled": fu.Enabled, "stop_on_reply": fu.StopOnReply,
		"steps": steps,
		"counts": gin.H{"active": active, "completed": completed, "stopped": stopped},
	}
}

func ListFollowUps(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var fus []models.FollowUp
	database.DB.Where("agent_id = ?", id).Order("id desc").Find(&fus)
	out := make([]gin.H, 0, len(fus))
	for _, fu := range fus {
		out = append(out, followUpResponse(fu))
	}
	c.JSON(200, gin.H{"data": out})
}

func saveSteps(followUpID uint, steps []followUpStepReq) {
	database.DB.Where("follow_up_id = ?", followUpID).Delete(&models.FollowUpStep{})
	for i, s := range steps {
		if s.Message == "" {
			continue
		}
		delay := s.DelayHours
		if delay < 0 {
			delay = 0
		}
		database.DB.Create(&models.FollowUpStep{FollowUpID: followUpID, StepOrder: i, DelayHours: delay, Message: s.Message})
	}
}

func CreateFollowUp(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	tid := currentTenantID(c)
	var req struct {
		Name        string            `json:"name"`
		StopOnReply *bool             `json:"stop_on_reply"`
		Steps       []followUpStepReq `json:"steps"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if req.Name == "" {
		c.JSON(400, gin.H{"error": "Nama urutan wajib diisi"})
		return
	}
	if !anyStep(req.Steps) {
		c.JSON(400, gin.H{"error": "Minimal satu langkah dengan pesan"})
		return
	}
	stop := true
	if req.StopOnReply != nil {
		stop = *req.StopOnReply
	}
	fu := models.FollowUp{TenantID: tid, AgentID: id, Name: req.Name, Enabled: true, StopOnReply: stop}
	database.DB.Create(&fu)
	saveSteps(fu.ID, req.Steps)
	c.JSON(201, gin.H{"data": followUpResponse(fu)})
}

func UpdateFollowUp(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var fu models.FollowUp
	if database.DB.Where("agent_id = ?", id).First(&fu, c.Param("fid")).Error != nil {
		c.JSON(404, gin.H{"error": "Urutan tidak ditemukan"})
		return
	}
	var req struct {
		Name        *string            `json:"name"`
		Enabled     *bool              `json:"enabled"`
		StopOnReply *bool              `json:"stop_on_reply"`
		Steps       *[]followUpStepReq `json:"steps"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if req.Name != nil {
		fu.Name = *req.Name
	}
	if req.Enabled != nil {
		fu.Enabled = *req.Enabled
	}
	if req.StopOnReply != nil {
		fu.StopOnReply = *req.StopOnReply
	}
	database.DB.Save(&fu)
	if req.Steps != nil {
		saveSteps(fu.ID, *req.Steps)
	}
	c.JSON(200, gin.H{"data": followUpResponse(fu)})
}

func DeleteFollowUp(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var fu models.FollowUp
	if database.DB.Where("agent_id = ?", id).First(&fu, c.Param("fid")).Error != nil {
		c.JSON(404, gin.H{"error": "Urutan tidak ditemukan"})
		return
	}
	database.DB.Where("follow_up_id = ?", fu.ID).Delete(&models.FollowUpStep{})
	database.DB.Where("follow_up_id = ?", fu.ID).Delete(&models.FollowUpEnrollment{})
	database.DB.Delete(&fu)
	c.JSON(200, gin.H{"message": "Deleted"})
}

// EnrollFollowUp mendaftarkan kontak ke sebuah urutan. Lewati nomor yang sudah opt-out
// atau sudah aktif di urutan ini. Kontak yang dulu pernah ikut & sudah selesai bisa diikutkan lagi.
func EnrollFollowUp(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	tid := currentTenantID(c)
	var fu models.FollowUp
	if database.DB.Where("agent_id = ?", id).First(&fu, c.Param("fid")).Error != nil {
		c.JSON(404, gin.H{"error": "Urutan tidak ditemukan"})
		return
	}
	var req struct {
		Recipients []scheduleRecipient `json:"recipients"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Recipients) == 0 {
		c.JSON(400, gin.H{"error": "Penerima wajib diisi"})
		return
	}
	optedOut := optedOutSet(id)
	now := time.Now()
	var added, skipped int
	seen := map[string]bool{}
	for _, r := range req.Recipients {
		num := services.NormalizePhone(r.Number)
		if num == "" || seen[num] {
			continue
		}
		seen[num] = true
		if optedOut[num] {
			skipped++
			continue
		}
		// Sudah aktif di urutan ini? lewati.
		var existing models.FollowUpEnrollment
		if database.DB.Where("follow_up_id = ? AND number = ?", fu.ID, num).First(&existing).Error == nil {
			if existing.Status == "active" {
				skipped++
				continue
			}
			// daftar ulang: reset enrollment lama.
			database.DB.Model(&existing).Updates(map[string]any{
				"name": r.Name, "enrolled_at": now, "next_step": 0,
				"status": "active", "stopped_reason": "", "last_sent_at": nil,
			})
			added++
			continue
		}
		database.DB.Create(&models.FollowUpEnrollment{
			FollowUpID: fu.ID, Number: num, TenantID: tid, AgentID: id,
			Name: r.Name, EnrolledAt: now, NextStep: 0, Status: "active",
		})
		added++
	}
	c.JSON(200, gin.H{"added": added, "skipped": skipped})
}

func anyStep(steps []followUpStepReq) bool {
	for _, s := range steps {
		if s.Message != "" {
			return true
		}
	}
	return false
}

// ---- Worker ----

var followUpSweeping sync.Mutex

// processDueFollowUps mengirim langkah follow-up yang jatuh tempo. Dipanggil tiap menit
// dari scheduler. Dijaga mutex agar tidak ada dua sweep berbarengan (cegah dobel kirim).
func processDueFollowUps() {
	if !followUpSweeping.TryLock() {
		return
	}
	defer followUpSweeping.Unlock()

	var enrolls []models.FollowUpEnrollment
	database.DB.Where("status = ?", "active").Order("id asc").Find(&enrolls)

	const maxPerSweep = 40
	sent := 0
	for _, e := range enrolls {
		if sent >= maxPerSweep {
			break
		}
		var fu models.FollowUp
		if database.DB.First(&fu, e.FollowUpID).Error != nil || !fu.Enabled {
			continue
		}
		if !tenantWAActive(e.TenantID) {
			continue
		}

		var steps []models.FollowUpStep
		database.DB.Where("follow_up_id = ?", fu.ID).Order("step_order asc, id asc").Find(&steps)
		if e.NextStep >= len(steps) {
			database.DB.Model(&models.FollowUpEnrollment{}).Where("id = ?", e.ID).Update("status", "completed")
			continue
		}
		step := steps[e.NextStep]
		if time.Now().Before(e.EnrolledAt.Add(time.Duration(step.DelayHours) * time.Hour)) {
			continue // belum waktunya
		}
		// Opt-out -> stop.
		if followUpOptedOut(e.AgentID, e.Number) {
			stopEnrollment(e.ID, "opt-out")
			continue
		}
		// Kontak sudah membalas setelah didaftarkan -> stop (kalau diaktifkan).
		if fu.StopOnReply && repliedSince(e.AgentID, e.Number, e.EnrolledAt) {
			stopEnrollment(e.ID, "dibalas")
			continue
		}
		if !services.WA(e.AgentID).IsConnected() {
			continue // tunda, coba menit berikutnya
		}

		msg := personalize(step.Message, e.Name)
		if err := services.WA(e.AgentID).SendText(e.Number, msg); err != nil {
			continue // gagal kirim -> jangan maju, coba lagi nanti
		}
		logTurn(e.AgentID, e.Number, "", msg, true)
		sent++

		now := time.Now()
		nextStep := e.NextStep + 1
		status := "active"
		if nextStep >= len(steps) {
			status = "completed"
		}
		database.DB.Model(&models.FollowUpEnrollment{}).Where("id = ?", e.ID).
			Updates(map[string]any{"next_step": nextStep, "status": status, "last_sent_at": &now})

		// Jeda kecil antar kirim agar lembut (anti-banned).
		time.Sleep(6 * time.Second)
	}
}

func followUpOptedOut(agentID uint, number string) bool {
	var n int64
	database.DB.Model(&models.OptOut{}).Where("agent_id = ? AND sender = ?", agentID, number).Count(&n)
	return n > 0
}

// repliedSince = true bila ada pesan MASUK dari kontak setelah waktu tertentu.
func repliedSince(agentID uint, number string, since time.Time) bool {
	var n int64
	database.DB.Model(&models.ChatHistory{}).
		Where("agent_id = ? AND sender = ? AND message <> '' AND created_at > ?", agentID, number, since).
		Count(&n)
	return n > 0
}

func stopEnrollment(enrollID uint, reason string) {
	database.DB.Model(&models.FollowUpEnrollment{}).Where("id = ?", enrollID).
		Updates(map[string]any{"status": "stopped", "stopped_reason": reason})
}
