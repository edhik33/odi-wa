package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
	openai "github.com/sashabaranov/go-openai"
)

// maybeExtractAndExportClosing dijalankan async setelah AI membalas customer.
// Mengecek apakah agent punya closing form + sheet sync enabled,
// lalu memanggil AI extractor untuk mendapatkan data terstruktur,
// validasi, simpan ke DB, dan append ke Google Sheets.
func maybeExtractAndExportClosing(agentID uint, sender string) {
	var agent models.Agent
	if database.DB.First(&agent, agentID).Error != nil {
		return
	}
	if !agent.SheetSyncEnabled || agent.SpreadsheetURL == "" {
		return
	}

	var form models.ClosingForm
	if database.DB.Where("agent_id = ? AND enabled = ?", agentID, true).First(&form).Error != nil {
		return
	}

	sheetID := services.ParseSpreadsheetID(agent.SpreadsheetURL)
	if sheetID == "" {
		log.Printf("[closing] Agent %d: URL spreadsheet tidak valid", agentID)
		return
	}
	sheetName := agent.SpreadsheetSheetName
	if sheetName == "" {
		sheetName = "Leads"
	}

	// Bangun prompt extractor dari schema + summary + chat history.
	prompt := buildExtractorPrompt(agentID, sender, agent, form)

	cfg := openai.DefaultConfig(config.EnvRequired("OPENAI_API_KEY"))
	cfg.BaseURL = config.Env("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
	client := openai.NewClientWithConfig(cfg)

	resp, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model: config.Env("OPENAI_MODEL", "deepseek-v4-pro"),
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: `Kamu adalah data extractor. Tugasmu membaca riwayat percakapan dan mengekstrak data sesuai schema. Output HANYA JSON. Kalau data belum lengkap, tetap berikan JSON dengan field yang ada. Jangan menambah field di luar schema.`},
			{Role: openai.ChatMessageRoleUser, Content: prompt},
		},
		MaxTokens: 500,
	})
	if err != nil {
		log.Printf("[closing] Agent %d: AI extractor error: %v", agentID, err)
		return
	}

	content := strings.TrimSpace(resp.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")

	var result ClosingResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		log.Printf("[closing] Agent %d: gagal parse extractor JSON: %v", agentID, err)
		return
	}
	if result.Confidence < 0.7 {
		log.Printf("[closing] Agent %d: confidence rendah %.2f, skip", agentID, result.Confidence)
		return
	}

	// Validasi required fields.
	if !validateRequiredFields(form.SchemaJSON, result.Data) {
		log.Printf("[closing] Agent %d: required field belum lengkap", agentID)
		return
	}

	dataJSON, _ := json.Marshal(result.Data)
	summaryJSON, _ := json.Marshal(result)
	idempotencyKey := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%d-%s-%s", agentID, sender, string(dataJSON)))))

	// Cek duplikat.
	var existing models.ClosingRecord
	if database.DB.Where("idempotency_key = ?", idempotencyKey[:64]).First(&existing).Error == nil {
		log.Printf("[closing] Agent %d: duplicate closing record untuk sender %s", agentID, sender)
		return
	}

	rec := models.ClosingRecord{
		AgentID:        agentID,
		Sender:         sender,
		Status:         "detected",
		Confidence:     result.Confidence,
		DataJSON:       string(dataJSON),
		RawSummary:     string(summaryJSON),
		IdempotencyKey: idempotencyKey[:64],
	}
	database.DB.Create(&rec)

	// Append ke Google Sheets.
	row := buildSheetRow(form.SchemaJSON, result.Data, agent, sender)
	go func() {
		sheetErr := services.AppendRow(sheetID, sheetName, row)
		now := time.Now()
		updates := map[string]any{"exported_at": &now}
		if sheetErr != nil {
			log.Printf("[closing] Agent %d: gagal append sheet: %v", agentID, sheetErr)
			updates["status"] = "failed"
			updates["sheet_error"] = sheetErr.Error()
		} else {
			updates["status"] = "exported"
		}
		database.DB.Model(&rec).Updates(updates)
	}()
}

// ClosingResult = output AI extractor.
type ClosingResult struct {
	Confidence float64                `json:"confidence"`
	Data       map[string]interface{} `json:"data"`
}

// buildExtractorPrompt membuat prompt untuk AI extractor.
func buildExtractorPrompt(agentID uint, sender string, agent models.Agent, form models.ClosingForm) string {
	var chats []models.ChatHistory
	database.DB.Where("agent_id = ? AND sender = ?", agentID, sender).
		Order("created_at desc").Limit(10).Find(&chats)

	var sb strings.Builder
	sb.WriteString("Schema data yang harus diekstrak:\n")
	sb.WriteString(form.SchemaJSON)
	sb.WriteString("\n\nRingkasan percakapan sebelumnya:\n")
	if agent.ConversationSummary != "" {
		sb.WriteString(agent.ConversationSummary)
	}
	sb.WriteString("\n\n10 chat terakhir:\n")
	for i := len(chats) - 1; i >= 0; i-- {
		c := chats[i]
		prefix := "Customer"
		if c.Reply != "" {
			prefix = "AI"
		}
		sb.WriteString(fmt.Sprintf("%s: %s\n", prefix, c.Message))
	}
	sb.WriteString("\nEkstrak data sesuai schema di atas. Output JSON: {\"confidence\": 0.0-1.0, \"data\": {...}}")
	return sb.String()
}

// validateRequiredFields cek apakah semua field required ada isinya.
func validateRequiredFields(schemaJSON string, data map[string]interface{}) bool {
	var schema struct {
		Fields []struct {
			Key      string `json:"key"`
			Required bool   `json:"required"`
		} `json:"fields"`
	}
	if err := json.Unmarshal([]byte(schemaJSON), &schema); err != nil {
		return false
	}
	for _, f := range schema.Fields {
		if !f.Required {
			continue
		}
		val, ok := data[f.Key]
		if !ok || val == nil || val == "" {
			return false
		}
	}
	return true
}

// buildSheetRow membuat baris spreadsheet dari data + schema.
func buildSheetRow(schemaJSON string, data map[string]interface{}, agent models.Agent, sender string) []string {
	var schema struct {
		Fields []struct {
			Key string `json:"key"`
		} `json:"fields"`
	}
	json.Unmarshal([]byte(schemaJSON), &schema)

	row := make([]string, 0, len(schema.Fields)+3)
	row = append(row, time.Now().Format("2006-01-02 15:04"))
	row = append(row, agent.Name)
	row = append(row, sender)
	for _, f := range schema.Fields {
		v := fmt.Sprintf("%v", data[f.Key])
		if v == "<nil>" {
			v = ""
		}
		row = append(row, v)
	}
	return row
}

// TestSheetConnection menguji koneksi ke Google Sheet.
func TestSheetConnection(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var agent models.Agent
	if database.DB.First(&agent, id).Error != nil {
		c.JSON(404, gin.H{"error": "Agent tidak ditemukan"})
		return
	}
	if agent.SpreadsheetURL == "" {
		c.JSON(400, gin.H{"error": "URL spreadsheet belum diisi"})
		return
	}
	sheetID := services.ParseSpreadsheetID(agent.SpreadsheetURL)
	if sheetID == "" {
		c.JSON(400, gin.H{"error": "URL spreadsheet tidak valid"})
		return
	}
	sheetName := agent.SpreadsheetSheetName
	if sheetName == "" {
		sheetName = "Leads"
	}
	email := os.Getenv("GOOGLE_SERVICE_ACCOUNT_EMAIL")
	if email == "" {
		email = "(set GOOGLE_SERVICE_ACCOUNT_EMAIL di .env)"
	}
	if err := services.TestConnection(sheetID, sheetName); err != nil {
		c.JSON(200, gin.H{
			"status":  "gagal",
			"message": "Gagal koneksi. Pastikan spreadsheet sudah di-share ke: " + email,
			"error":   err.Error(),
		})
		return
	}
	c.JSON(200, gin.H{"status": "ok", "message": "Koneksi berhasil!"})
}

// ListSheetNames mengembalikan daftar nama tab/sheet dari URL sheet agent.
func ListSheetNames(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	var agent models.Agent
	if database.DB.First(&agent, id).Error != nil {
		c.JSON(404, gin.H{"error": "Agent tidak ditemukan"})
		return
	}
	if agent.SpreadsheetURL == "" {
		c.JSON(400, gin.H{"error": "URL spreadsheet belum diisi"})
		return
	}
	sheetID := services.ParseSpreadsheetID(agent.SpreadsheetURL)
	if sheetID == "" {
		c.JSON(400, gin.H{"error": "URL spreadsheet tidak valid"})
		return
	}
	names, err := services.GetSheetNames(sheetID)
	if err != nil {
		c.JSON(502, gin.H{"error": "Gagal membaca sheet: " + err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": names})
}
