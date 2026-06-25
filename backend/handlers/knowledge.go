package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
	openai "github.com/sashabaranov/go-openai"
)

type GenerateReq struct {
	Text    string `json:"text"`
	Count   int    `json:"count"`
	BizType string `json:"biz_type"` // "produk_fisik", "produk_digital", "jasa", "" = generik
}

var bizPrompts = map[string]string{
	"produk_fisik":   "pelanggan yang ingin tahu harga, spesifikasi, bahan, ukuran, cara order, pengiriman, garansi, dan pembayaran produk fisik",
	"produk_digital": "pelanggan yang ingin tahu harga, format file, cara akses/download, lisensi, kompatibilitas, fitur, dan cara pembelian produk digital",
	"jasa":           "pelanggan yang ingin tahu harga, durasi, proses, syarat, output, revisi, dan cara booking jasa/layanan",
}

// GenerateKnowledge generates Q&A pairs from raw text using AI
func GenerateKnowledge(c *gin.Context) {
	var req GenerateReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Text) == "" {
		c.JSON(400, gin.H{"error": "Text is required"})
		return
	}
	if req.Count <= 0 { req.Count = 10 }
	if req.Count > 20 { req.Count = 20 }

	bizCtx := bizPrompts[req.BizType]
	if bizCtx == "" {
		bizCtx = "pelanggan yang ingin tahu informasi penting tentang produk/layanan"
	}

	prompt := `Buatkan ` + intToStr(req.Count) + ` pasangan Tanya-Jawab FAQ dalam format JSON dari teks berikut.
Fokus pada pertanyaan yang sering ditanyakan ` + bizCtx + `.
Gunakan bahasa Indonesia yang natural dan ramah, seolah kamu customer service yang membantu.
Format output HARUS JSON array persis seperti ini:
[{"question": "pertanyaan", "answer": "jawaban", "tags": "kata,kunci"}]

Teks sumber:
` + req.Text

	cfg := openai.DefaultConfig(config.EnvRequired("OPENAI_API_KEY"))
	cfg.BaseURL = config.Env("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
	client := openai.NewClientWithConfig(cfg)

	resp, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model: config.Env("OPENAI_MODEL", "deepseek-v4-pro"),
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: "Kamu adalah AI yang jago membuat FAQ knowledge base untuk bisnis. Pahami konteks bisnisnya, buat pertanyaan yang realistis dari sudut pandang pelanggan. Output HANYA JSON array."},
			{Role: openai.ChatMessageRoleUser, Content: prompt},
		},
		MaxTokens: 1000,
	})
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	content := strings.TrimSpace(resp.Choices[0].Message.Content)
	// Clean markdown code block if any
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")

	var items []struct {
		Question string `json:"question"`
		Answer   string `json:"answer"`
		Tags     string `json:"tags"`
	}
	if err := json.Unmarshal([]byte(content), &items); err != nil {
		c.JSON(500, gin.H{"error": "Failed to parse AI response", "raw": content})
		return
	}

	aid, ok := resolveAgent(c)
	if !ok {
		return
	}
	var created []models.Knowledge
	for _, item := range items {
		k := models.Knowledge{AgentID: aid, Question: item.Question, Answer: item.Answer, Tags: item.Tags}
		_ = database.DB.Create(&k).Error
		services.IndexKnowledge(&k)
		created = append(created, k)
	}

	c.JSON(201, gin.H{"data": created})
}

func intToStr(n int) string {
	return fmt.Sprintf("%d", n)
}

// ImportKnowledge mengimpor banyak Q&A sekaligus (format JSON) ke knowledge agent,
// lalu menghitung embedding-nya. Upsert berdasarkan (agent_id, question).
func ImportKnowledge(c *gin.Context) {
	aid, ok := resolveAgent(c)
	if !ok {
		return
	}
	var req struct {
		Items []struct {
			Question string `json:"question"`
			Answer   string `json:"answer"`
			Tags     string `json:"tags"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "JSON tidak valid"})
		return
	}

	created, updated := 0, 0
	for _, it := range req.Items {
		if strings.TrimSpace(it.Question) == "" {
			continue
		}
		var k models.Knowledge
		if database.DB.Where("agent_id = ? AND question = ?", aid, it.Question).First(&k).Error == nil {
			k.Answer = it.Answer
			k.Tags = it.Tags
			_ = database.DB.Save(&k).Error
			services.IndexKnowledge(&k)
			updated++
		} else {
			k = models.Knowledge{AgentID: aid, Question: it.Question, Answer: it.Answer, Tags: it.Tags}
			_ = database.DB.Create(&k).Error
			services.IndexKnowledge(&k)
			created++
		}
	}
	c.JSON(200, gin.H{"created": created, "updated": updated})
}

// SetupWizardReq = input profil bisnis dari user.
type SetupWizardReq struct {
	BizName    string `json:"biz_name"`
	BizType    string `json:"biz_type"`
	Products   string `json:"products"`
	PriceRange string `json:"price_range"`
	OrderFlow  string `json:"order_flow"`
	Shipping   string `json:"shipping"`
	Hours      string `json:"hours"`
	CSName     string `json:"cs_name"`
}

// SetupWizard — satu form profil bisnis, auto-generate System Prompt + Knowledge 15 Q&A.
func SetupWizard(c *gin.Context) {
	aid, ok := resolveAgent(c)
	if !ok {
		return
	}
	var req SetupWizardReq
	if err := c.ShouldBindJSON(&req); err != nil || req.BizName == "" {
		c.JSON(400, gin.H{"error": "Nama bisnis wajib diisi"})
		return
	}

	cfg := openai.DefaultConfig(config.EnvRequired("OPENAI_API_KEY"))
	cfg.BaseURL = config.Env("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
	client := openai.NewClientWithConfig(cfg)

	// 1. Generate System Prompt
	sysPrompt := buildWizardSystemPrompt(req)
	resp1, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:  config.Env("OPENAI_MODEL", "deepseek-v4-pro"),
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: "Kamu adalah prompt engineer. Buat persona AI customer service WhatsApp dalam bahasa Indonesia. Ramah, santai, jelas. Maks 6 kalimat."},
			{Role: openai.ChatMessageRoleUser, Content: sysPrompt},
		},
		MaxTokens: 500,
	})
	systemPrompt := ""
	if err == nil && len(resp1.Choices) > 0 {
		systemPrompt = strings.TrimSpace(resp1.Choices[0].Message.Content)
	}
	// Fallback: kalau AI gagal, build dari form langsung
	if systemPrompt == "" {
		systemPrompt = fmt.Sprintf("Kamu adalah %s, CS %s. Kami menjual %s. Harga %s. Cara order: %s. Pengiriman: %s. Jam operasional: %s. Ramah, panggil \"kak\". Saat customer mau beli, tanya nama, produk, alamat, dan metode bayar.", req.CSName, req.BizName, req.Products, req.PriceRange, req.OrderFlow, req.Shipping, req.Hours)
	}
	if systemPrompt != "" {
		database.DB.Model(&models.Agent{}).Where("id = ?", aid).
			Update("system_prompt", systemPrompt)
	}

	// 2. Generate Knowledge FAQ (15 Q&A)
	kbPrompt := fmt.Sprintf(`Buatkan 15 pasangan Tanya-Jawab FAQ knowledge base dari profil bisnis berikut.
Gunakan bahasa Indonesia natural dan ramah.
Fokus pada pertanyaan yang sering ditanyakan pelanggan.
Format output HARUS JSON array: [{"question": "...", "answer": "...", "tags": "kata,kunci"}]

Profil bisnis:
Nama: %s | Produk: %s | Harga: %s | Order: %s | Kirim: %s | Jam: %s`, req.BizName, req.Products, req.PriceRange, req.OrderFlow, req.Shipping, req.Hours)

	resp2, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:  config.Env("OPENAI_MODEL", "deepseek-v4-pro"),
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: "Kamu adalah generator knowledge base FAQ. Output HANYA JSON array."},
			{Role: openai.ChatMessageRoleUser, Content: kbPrompt},
		},
		MaxTokens: 3000,
	})
	if err != nil {
		c.JSON(500, gin.H{"error": "Gagal generate knowledge: " + err.Error()})
		return
	}

	content := strings.TrimSpace(resp2.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")

	var items []struct {
		Question string `json:"question"`
		Answer   string `json:"answer"`
		Tags     string `json:"tags"`
	}
	if err := json.Unmarshal([]byte(content), &items); err != nil {
		c.JSON(500, gin.H{"error": "Format AI tidak valid", "raw": content})
		return
	}

	var created int
	for _, item := range items {
		k := models.Knowledge{AgentID: aid, Question: item.Question, Answer: item.Answer, Tags: item.Tags}
		database.DB.Create(&k)
		services.IndexKnowledge(&k)
		created++
	}

	c.JSON(200, gin.H{
		"message":       "Setup selesai!",
		"system_prompt": systemPrompt,
		"knowledge":     created,
	})
}

func buildWizardSystemPrompt(req SetupWizardReq) string {
	return fmt.Sprintf(`Buat persona AI customer service WhatsApp untuk bisnis ini:
Nama Bisnis: %s
Jenis: %s
Produk: %s
Range Harga: %s
Cara Order: %s
Pengiriman: %s
Jam Operasional: %s
Nama CS: %s

Buat system prompt singkat (maks 6 kalimat) yang mencakup: siapa AI ini, produk apa yang dijual, cara order, gaya bicara (ramah, panggil "kak"), dan aturan closing (tanya nama+produk+nomer).`, req.BizName, req.BizType, req.Products, req.PriceRange, req.OrderFlow, req.Shipping, req.Hours, req.CSName)
}
