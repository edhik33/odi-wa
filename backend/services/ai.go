package services

import (
	"context"
	"log"
	"sort"
	"strings"
	"wa-assistant/backend/config"
	"wa-assistant/backend/models"

	openai "github.com/sashabaranov/go-openai"
)

// simThreshold = ambang minimal kemiripan kosinus agar sebuah knowledge dianggap relevan.
// topK = jumlah maksimal knowledge yang disisipkan ke prompt.
const (
	simThreshold = 0.35
	topK         = 3
)

var AIClient *openai.Client

func InitAI() {
	cfg := openai.DefaultConfig(config.EnvRequired("OPENAI_API_KEY"))
	cfg.BaseURL = config.Env("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
	AIClient = openai.NewClientWithConfig(cfg)
}

func ChatWithKnowledge(agentID uint, systemPrompt, tone, userMsg string, history []models.ChatHistory) (string, error) {
	relevant := searchKnowledge(agentID, userMsg)

	enhancedPrompt := systemPrompt +
		"\n\nGAYA JAWABAN: Balas seperti chat WhatsApp yang natural dan manusiawi—mengalir, tidak kaku, jangan seperti template. " +
		"Ringkas dan langsung menjawab, idealnya 1-3 kalimat, jangan mengulang pertanyaan, dan selesaikan kalimat terakhir dengan utuh. " +
		"PENTING: jangan mengarang detail spesifik (angka, persen, syarat, jam, harga, kebijakan) yang tidak ada di basis pengetahuan; " +
		"kalau tidak yakin atau informasinya tidak tersedia, arahkan untuk menghubungi admin." +
		toneInstruction(tone)

	if len(relevant) > 0 {
		var kb strings.Builder
		kb.WriteString("\n\nBASIS PENGETAHUAN (jadikan ini sumber utama jawaban; kalau pertanyaan tidak tercakup, jawab seadanya/jujur tidak tahu):\n")
		for _, k := range relevant {
			kb.WriteString("Q: " + k.Question + "\n")
			kb.WriteString("A: " + k.Answer + "\n\n")
		}
		enhancedPrompt += kb.String()
	}

	// Susun pesan: system prompt + riwayat percakapan (memori) + pesan terbaru.
	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: enhancedPrompt},
	}
	for _, h := range history {
		if h.Message != "" {
			messages = append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: h.Message})
		}
		if h.Reply != "" {
			messages = append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleAssistant, Content: h.Reply})
		}
	}
	messages = append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: userMsg})

	resp, err := AIClient.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:       config.Env("OPENAI_MODEL", "deepseek-v4-pro"),
		Messages:    messages,
		MaxTokens:   512, // cukup besar agar jawaban ringkas tidak terpotong di tengah; panjang dijaga lewat prompt
		Temperature: 0.7, // lebih luwes/natural seperti ngobrol
	})
	if err != nil {
		return "", err
	}
	if len(resp.Choices) == 0 {
		return "Maaf, saya tidak bisa menjawab.", nil
	}
	if string(resp.Choices[0].FinishReason) == "length" {
		log.Printf("WARN: jawaban kemungkinan terpotong (finish_reason=length) — pertimbangkan naikkan MaxTokens. Pesan: %q", userMsg)
	}
	reply := strings.TrimSpace(resp.Choices[0].Message.Content)
	if reply == "" {
		// Model sesekali balas kosong; jangan kirim pesan kosong ke WhatsApp.
		return "Maaf kak, boleh diulang pertanyaannya?", nil
	}
	return reply, nil
}

// searchKnowledge mencari knowledge paling relevan dengan pesan user.
// Utama: semantic search via embedding (cosine similarity). Kalau embedding
// nonaktif atau error, jatuh ke pencocokan kata kunci/tag (cara lama).
// toneInstruction menerjemahkan pilihan tone dari dashboard menjadi arahan gaya bahasa.
func toneInstruction(tone string) string {
	switch strings.ToLower(strings.TrimSpace(tone)) {
	case "formal":
		return " Pakai bahasa formal, sopan, dan profesional; hindari slang dan emoji."
	case "santai":
		return " Pakai gaya santai dan akrab seperti ngobrol dengan teman; boleh sedikit emoji."
	case "persuasif":
		return " Pakai gaya persuasif yang meyakinkan dan lembut mengajak (mis. mendorong untuk berdonasi), tetap sopan."
	case "ramah", "":
		return " Pakai gaya ramah dan hangat, sopan, boleh menyapa akrab seperti \"kak\"."
	default:
		return "" // tone custom: ikuti system prompt apa adanya
	}
}

func searchKnowledge(agentID uint, msg string) []models.Knowledge {
	items := KnowledgeFor(agentID) // dari cache memori (embedding sudah di-parse)
	if len(items) == 0 {
		return nil
	}

	if EmbeddingEnabled() {
		if relevant, ok := semanticSearch(msg, items); ok {
			return relevant
		}
	}
	return keywordSearch(msg, items)
}

func semanticSearch(msg string, items []KBItem) ([]models.Knowledge, bool) {
	qVec, err := Embed(msg)
	if err != nil {
		log.Printf("Embedding: query gagal, fallback keyword: %v", err)
		return nil, false
	}

	type scored struct {
		k   models.Knowledge
		sim float32
	}
	var ranked []scored
	for _, it := range items {
		if len(it.Vec) == 0 {
			continue
		}
		ranked = append(ranked, scored{it.K, cosineSim(qVec, it.Vec)})
	}
	if len(ranked) == 0 {
		return nil, false // belum ada yang ter-embed -> biar keyword yang jalan
	}

	sort.Slice(ranked, func(i, j int) bool { return ranked[i].sim > ranked[j].sim })

	var relevant []models.Knowledge
	for _, r := range ranked {
		if r.sim < simThreshold || len(relevant) >= topK {
			break
		}
		relevant = append(relevant, r.k)
	}
	return relevant, true
}

func keywordSearch(msg string, items []KBItem) []models.Knowledge {
	var relevant []models.Knowledge
	lower := strings.ToLower(msg)
	for _, it := range items {
		k := it.K
		tagMatch := false
		for _, tag := range strings.Split(k.Tags, ",") {
			t := strings.ToLower(strings.TrimSpace(tag))
			if t != "" && strings.Contains(lower, t) {
				tagMatch = true
				break
			}
		}
		if tagMatch || strings.Contains(lower, strings.ToLower(k.Question)) {
			relevant = append(relevant, k)
		}
	}
	if len(relevant) > topK {
		relevant = relevant[:topK]
	}
	return relevant
}
