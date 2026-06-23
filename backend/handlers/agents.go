package handlers

import (
	"log"
	"strconv"
	"strings"
	"time"

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
		return 1
	}
	if t.Plan != nil && t.Plan.MaxNumbers > 0 {
		return t.Plan.MaxNumbers
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

// OnWAMessage dipanggil saat ada pesan masuk untuk agent tertentu.
func OnWAMessage(agentID uint, sender types.JID, msg string) {
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
	}

	// Kontak sedang diambil alih manusia -> bot diam, cukup catat pesan masuk untuk inbox.
	var ho models.Handoff
	if database.DB.Where("agent_id = ? AND sender = ?", agentID, num).First(&ho).Error == nil {
		logInbound(agentID, num, msg)
		return
	}

	// Di luar jam kerja -> kirim pesan away (sekali), jangan panggil AI.
	if !withinBusinessHours(agent) {
		away := agent.AwayMessage
		if away == "" {
			away = "Mohon maaf, saat ini di luar jam operasional. Pesan kakak sudah kami terima dan akan kami balas pada jam kerja ya 🙏"
		}
		// Jangan ulang pesan away kalau balasan terakhir ke kontak ini sudah pesan away.
		var last models.ChatHistory
		database.DB.Where("agent_id = ? AND sender = ?", agentID, num).Order("created_at desc").First(&last)
		if last.Reply != away {
			_ = services.WA(agentID).SendMessage(sender, away)
			logTurn(agentID, num, msg, away, false)
		} else {
			logInbound(agentID, num, msg) // tetap catat pesan masuk untuk inbox
		}
		return
	}

	// Sapaan untuk kontak baru (belum pernah ada riwayat).
	if agent.GreetingEnabled && agent.GreetingMessage != "" && isNewContact(agentID, num) {
		_ = services.WA(agentID).SendMessage(sender, agent.GreetingMessage)
	}

	// Kuota balasan AI bulan ini habis -> alihkan kontak ke CS manusia (sekali), bot berhenti.
	if aiQuotaExceeded(agent.TenantID) {
		database.DB.Create(&models.Handoff{AgentID: agentID, Sender: num, LastMsg: msg})
		_ = services.WA(agentID).SendMessage(sender, quotaMessage)
		logTurn(agentID, num, msg, quotaMessage, false)
		log.Printf("Kuota AI habis (tenant %d, agent %d) — dialihkan ke CS untuk %s", agent.TenantID, agentID, num)
		return
	}

	// Ambil 5 percakapan terakhir agent+nomor ini sebagai memori (urutkan kronologis).
	var history []models.ChatHistory
	database.DB.Where("agent_id = ? AND sender = ?", agentID, num).
		Order("created_at desc").Limit(5).Find(&history)
	for i, j := 0, len(history)-1; i < j; i, j = i+1, j-1 {
		history[i], history[j] = history[j], history[i]
	}

	reply, escalate, err := services.ChatWithKnowledge(agentID, prompt, tone, msg, history)
	if err != nil {
		log.Printf("AI error (agent %d) dari %s: %v", agentID, num, err)
		reply = "Maaf, ada kendala teknis."
		escalate = false
	}

	if escalate {
		// Bot tidak yakin -> balas menunda + tandai kontak butuh manusia + bot berhenti utk kontak ini.
		reply = deferMessage
		database.DB.Create(&models.Handoff{AgentID: agentID, Sender: num, LastMsg: msg})
		log.Printf("Eskalasi (agent %d) dari %s: %q", agentID, num, msg)
	}

	if err := services.WA(agentID).SendMessage(sender, reply); err != nil {
		log.Printf("Gagal kirim (agent %d) ke %s: %v", agentID, num, err)
		return
	}

	logTurn(agentID, num, msg, reply, false)
	incrementAIUsage(agent.TenantID) // hitung pemakaian kuota bulanan tenant
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

func logInbound(agentID uint, num, msg string) {
	database.DB.Create(&models.ChatHistory{AgentID: agentID, Sender: num, Message: msg})
}

func logTurn(agentID uint, num, msg, reply string, fromHuman bool) {
	database.DB.Create(&models.ChatHistory{AgentID: agentID, Sender: num, Message: msg, Reply: reply, FromHuman: fromHuman})
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
	database.DB.Save(&a)
	log.Printf("Agent %d ter-link ke nomor %s", agentID, number)
}

// StartAgents menyambungkan ulang semua agent yang sudah punya device saat startup.
func StartAgents() {
	var agents []models.Agent
	database.DB.Find(&agents)
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
				database.DB.Save(&a)
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
						database.DB.Save(&ag)
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
	c.ShouldBindJSON(&req)
	if req.Tone == "" {
		req.Tone = "ramah"
	}
	a := models.Agent{TenantID: tid, Name: req.Name, SystemPrompt: req.SystemPrompt, Tone: req.Tone}
	database.DB.Create(&a)
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
		SystemPrompt         string  `json:"system_prompt"`
		Tone                 string  `json:"tone"`
		GreetingEnabled      *bool   `json:"greeting_enabled"`
		GreetingMessage      *string `json:"greeting_message"`
		BusinessHoursEnabled *bool   `json:"business_hours_enabled"`
		BusinessStart        *string `json:"business_start"`
		BusinessEnd          *string `json:"business_end"`
		AwayMessage          *string `json:"away_message"`
	}
	c.ShouldBindJSON(&req)
	if req.Name != "" {
		a.Name = req.Name
	}
	a.SystemPrompt = req.SystemPrompt
	if req.Tone != "" {
		a.Tone = req.Tone
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
	database.DB.Save(&a)
	c.JSON(200, gin.H{"data": a})
}

func DeleteAgent(c *gin.Context) {
	database.DB.Where("tenant_id = ?", currentTenantID(c)).Delete(&models.Agent{}, c.Param("id"))
	c.JSON(200, gin.H{"message": "Deleted"})
}
