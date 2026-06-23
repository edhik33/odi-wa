package handlers

import (
	"io"
	"strconv"
	"strings"
	"time"

	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

// TestChat menjalankan AI agent tanpa WhatsApp (simulator "coba chat" di dashboard).
func TestChat(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var req struct {
		Message string `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Message) == "" {
		c.JSON(400, gin.H{"error": "Pesan kosong"})
		return
	}
	var agent models.Agent
	database.DB.First(&agent, id)
	if aiQuotaExceeded(agent.TenantID) {
		c.JSON(200, gin.H{"reply": "(Kuota balasan AI bulan ini sudah habis. Upgrade plan untuk lanjut.)", "escalate": false})
		return
	}
	prompt := agent.SystemPrompt
	if prompt == "" {
		prompt = "Kamu adalah asisten AI yang ramah. Jawab dalam bahasa Indonesia."
	}
	tone := agent.Tone
	if tone == "" {
		tone = "ramah"
	}
	reply, escalate, err := services.ChatWithKnowledge(id, prompt, tone, req.Message, nil)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	incrementAIUsage(agent.TenantID)
	c.JSON(200, gin.H{"reply": reply, "escalate": escalate})
}

// AgentAnalytics mengembalikan ringkasan + tren 7 hari untuk satu agent.
func AgentAnalytics(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var totalIn, aiReplies, humanReplies, contacts, openHandoffs int64
	database.DB.Model(&models.ChatHistory{}).Where("agent_id = ? AND message <> ''", id).Count(&totalIn)
	database.DB.Model(&models.ChatHistory{}).Where("agent_id = ? AND reply <> '' AND from_human = ?", id, false).Count(&aiReplies)
	database.DB.Model(&models.ChatHistory{}).Where("agent_id = ? AND from_human = ?", id, true).Count(&humanReplies)
	database.DB.Model(&models.ChatHistory{}).Where("agent_id = ?", id).Distinct("sender").Count(&contacts)
	database.DB.Model(&models.Handoff{}).Where("agent_id = ?", id).Count(&openHandoffs)

	pct := 0
	if totalIn > 0 {
		pct = int(aiReplies * 100 / totalIn)
	}

	// Tren pesan masuk 7 hari terakhir.
	type dayRow struct {
		Day string
		Cnt int
	}
	var rows []dayRow
	since := time.Now().AddDate(0, 0, -6).Format("2006-01-02")
	database.DB.Model(&models.ChatHistory{}).
		Select("DATE_FORMAT(created_at, '%Y-%m-%d') as day, COUNT(*) as cnt").
		Where("agent_id = ? AND message <> '' AND created_at >= ?", id, since+" 00:00:00").
		Group("day").Scan(&rows)
	counts := map[string]int{}
	for _, r := range rows {
		counts[r.Day] = r.Cnt
	}
	trend := make([]gin.H, 0, 7)
	for i := 6; i >= 0; i-- {
		d := time.Now().AddDate(0, 0, -i).Format("2006-01-02")
		trend = append(trend, gin.H{"day": d, "count": counts[d]})
	}

	c.JSON(200, gin.H{
		"total_incoming": totalIn,
		"ai_replies":     aiReplies,
		"human_replies":  humanReplies,
		"contacts":       contacts,
		"open_handoffs":  openHandoffs,
		"ai_handled_pct": pct,
		"trend":          trend,
	})
}

// InboxContacts = daftar kontak (diurutkan dari yang terbaru) + penanda butuh manusia.
func InboxContacts(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	type contactRow struct {
		Sender string    `json:"sender"`
		LastAt time.Time `json:"last_at"`
	}
	var rows []contactRow
	database.DB.Model(&models.ChatHistory{}).
		Select("sender, MAX(created_at) as last_at").
		Where("agent_id = ?", id).
		Group("sender").Order("last_at DESC").Limit(100).Scan(&rows)

	var hs []models.Handoff
	database.DB.Where("agent_id = ?", id).Find(&hs)
	needsHuman := map[string]bool{}
	for _, h := range hs {
		needsHuman[h.Sender] = true
	}

	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{"sender": r.Sender, "last_at": r.LastAt, "needs_human": needsHuman[r.Sender]})
	}
	c.JSON(200, gin.H{"data": out})
}

// InboxConversation = seluruh percakapan dengan satu kontak.
func InboxConversation(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	sender := c.Query("sender")
	if sender == "" {
		c.JSON(400, gin.H{"error": "sender wajib"})
		return
	}
	var msgs []models.ChatHistory
	database.DB.Where("agent_id = ? AND sender = ?", id, sender).Order("created_at asc").Limit(200).Find(&msgs)
	var h int64
	database.DB.Model(&models.Handoff{}).Where("agent_id = ? AND sender = ?", id, sender).Count(&h)
	c.JSON(200, gin.H{"data": msgs, "needs_human": h > 0})
}

// InboxSend mengirim pesan manual dari dashboard ke kontak (ambil alih dari bot).
func InboxSend(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var req struct {
		To      string `json:"to"`
		Message string `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.To == "" || strings.TrimSpace(req.Message) == "" {
		c.JSON(400, gin.H{"error": "Nomor & pesan wajib diisi"})
		return
	}
	if err := services.WA(id).SendText(req.To, req.Message); err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	logTurn(id, req.To, "", req.Message, true)

	// Kirim manual = ambil alih percakapan: pastikan bot berhenti untuk kontak ini.
	var cnt int64
	database.DB.Model(&models.Handoff{}).Where("agent_id = ? AND sender = ?", id, req.To).Count(&cnt)
	if cnt == 0 {
		database.DB.Create(&models.Handoff{AgentID: id, Sender: req.To, LastMsg: req.Message})
	}
	c.JSON(200, gin.H{"ok": true})
}

// InboxSendMedia mengirim gambar/file dari dashboard ke kontak (ambil alih dari bot).
func InboxSendMedia(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	to := c.PostForm("to")
	caption := c.PostForm("caption")
	if to == "" {
		c.JSON(400, gin.H{"error": "Nomor tujuan wajib"})
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"error": "File wajib diunggah"})
		return
	}
	f, err := fh.Open()
	if err != nil {
		c.JSON(400, gin.H{"error": "Gagal membaca file"})
		return
	}
	defer f.Close()
	data, _ := io.ReadAll(f)

	mimetype := fh.Header.Get("Content-Type")
	if mimetype == "" {
		mimetype = "application/octet-stream"
	}
	isImage := strings.HasPrefix(mimetype, "image/")

	var sendErr error
	if isImage {
		sendErr = services.WA(id).SendImage(to, caption, mimetype, data)
	} else {
		sendErr = services.WA(id).SendDocument(to, fh.Filename, mimetype, data)
	}
	if sendErr != nil {
		c.JSON(502, gin.H{"error": sendErr.Error()})
		return
	}

	mediaType := "document"
	if isImage {
		mediaType = "image"
	}
	reply := caption
	if reply == "" {
		reply = mediaPlaceholder(mediaType, fh.Filename)
	}
	database.DB.Create(&models.ChatHistory{
		AgentID: id, Sender: to, Reply: reply, FromHuman: true,
		MediaType: mediaType, MediaPath: storeMedia(id, data, mimetype, fh.Filename),
		FileName: fh.Filename, Mimetype: mimetype,
	})

	var cnt int64
	database.DB.Model(&models.Handoff{}).Where("agent_id = ? AND sender = ?", id, to).Count(&cnt)
	if cnt == 0 {
		database.DB.Create(&models.Handoff{AgentID: id, Sender: to, LastMsg: reply})
	}
	c.JSON(200, gin.H{"ok": true})
}

// ServeMedia menyajikan file media sebuah pesan. Auth lewat ?token= (header tak bisa di <img>/<a>).
func ServeMedia(c *gin.Context) {
	tid, ok := tenantFromToken(c.Query("token"))
	if !ok {
		c.AbortWithStatus(401)
		return
	}
	agentID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.AbortWithStatus(400)
		return
	}
	var agent models.Agent
	if database.DB.Select("id").Where("id = ? AND tenant_id = ?", agentID, tid).First(&agent).Error != nil {
		c.AbortWithStatus(404)
		return
	}
	var ch models.ChatHistory
	if database.DB.Where("id = ? AND agent_id = ?", c.Param("cid"), agentID).First(&ch).Error != nil || ch.MediaPath == "" {
		c.AbortWithStatus(404)
		return
	}
	c.File(ch.MediaPath)
}
