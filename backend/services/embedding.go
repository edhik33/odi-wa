package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"
	"sync"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"

	openai "github.com/sashabaranov/go-openai"
)

// KBItem = satu knowledge dengan vektor embedding yang sudah di-parse (siap pakai).
type KBItem struct {
	K   models.Knowledge
	Vec []float32
}

// Cache knowledge per-agent di memori: hindari query DB + unmarshal JSON tiap pesan masuk.
var (
	kbCache = map[uint][]KBItem{}
	kbDirty = map[uint]bool{}
	kbMu    sync.RWMutex
)

// InvalidateKB menandai cache knowledge sebuah agent perlu dimuat ulang (dipanggil saat ada perubahan).
func InvalidateKB(agentID uint) {
	kbMu.Lock()
	kbDirty[agentID] = true
	kbMu.Unlock()
}

// KnowledgeFor mengembalikan knowledge agent dari cache memori (embedding sudah di-parse).
// DB hanya di-query saat pertama kali atau setelah ada perubahan (create/update/delete).
func KnowledgeFor(agentID uint) []KBItem {
	kbMu.RLock()
	items, ok := kbCache[agentID]
	dirty := kbDirty[agentID]
	kbMu.RUnlock()
	if ok && !dirty {
		return items
	}

	var rows []models.Knowledge
	database.DB.Where("agent_id = ?", agentID).Find(&rows)
	items = make([]KBItem, 0, len(rows))
	for _, r := range rows {
		var vec []float32
		if r.Embedding != "" {
			_ = json.Unmarshal([]byte(r.Embedding), &vec)
		}
		r.Embedding = "" // hemat memori: vektor sudah disimpan terpisah di Vec
		items = append(items, KBItem{K: r, Vec: vec})
	}
	kbMu.Lock()
	kbCache[agentID] = items
	kbDirty[agentID] = false
	kbMu.Unlock()
	return items
}

var (
	embClient  *openai.Client
	embModel   string
	embDims    int
	embEnabled bool
)

// InitEmbedding menyiapkan client embedding (default: OpenAI text-embedding-3-small).
// Kalau EMBEDDING_API_KEY kosong, fitur semantic search nonaktif & sistem
// otomatis jatuh ke pencarian berbasis kata kunci.
func InitEmbedding() {
	key := config.Env("EMBEDDING_API_KEY", "")
	if key == "" {
		log.Println("Embedding: EMBEDDING_API_KEY kosong -> semantic search nonaktif (pakai keyword match)")
		return
	}
	cfg := openai.DefaultConfig(key)
	cfg.BaseURL = config.Env("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
	embClient = openai.NewClientWithConfig(cfg)
	embModel = config.Env("EMBEDDING_MODEL", "text-embedding-3-small")
	if d := config.Env("EMBEDDING_DIMENSIONS", ""); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n > 0 {
			embDims = n
		}
	}
	embEnabled = true
	log.Printf("Embedding aktif: model=%s", embModel)
}

func EmbeddingEnabled() bool { return embEnabled }

// Embed menghitung vektor embedding untuk satu teks.
func Embed(text string) ([]float32, error) {
	req := openai.EmbeddingRequest{
		Input: []string{text},
		Model: openai.EmbeddingModel(embModel),
	}
	if embDims > 0 {
		req.Dimensions = embDims
	}
	resp, err := embClient.CreateEmbeddings(context.Background(), req)
	if err != nil {
		return nil, err
	}
	if len(resp.Data) == 0 {
		return nil, fmt.Errorf("embedding kosong")
	}
	return resp.Data[0].Embedding, nil
}

// cosineSim menghitung kemiripan kosinus dua vektor (-1..1).
func cosineSim(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(na) * math.Sqrt(nb)))
}

func knowledgeText(k *models.Knowledge) string {
	return k.Question + "\n" + k.Answer + "\n" + k.Tags
}

// IndexKnowledge menghitung embedding satu knowledge lalu menyimpannya ke kolom embedding.
func IndexKnowledge(k *models.Knowledge) {
	InvalidateKB(k.AgentID) // isi knowledge berubah -> cache agent ini perlu di-refresh
	if !embEnabled {
		return
	}
	vec, err := Embed(knowledgeText(k))
	if err != nil {
		log.Printf("Embedding: gagal embed knowledge #%d: %v", k.ID, err)
		return
	}
	b, _ := json.Marshal(vec)
	k.Embedding = string(b)
	if err := database.DB.Model(k).Update("embedding", k.Embedding).Error; err != nil {
		log.Printf("Embedding: gagal simpan embedding knowledge #%d: %v", k.ID, err)
	}
}

// BackfillEmbeddings mengisi embedding untuk knowledge lama yang belum punya.
func BackfillEmbeddings() {
	if !embEnabled {
		return
	}
	var rows []models.Knowledge
	database.DB.Where("embedding = '' OR embedding IS NULL").Find(&rows)
	if len(rows) == 0 {
		return
	}
	log.Printf("Embedding: backfill %d knowledge...", len(rows))
	for i := range rows {
		IndexKnowledge(&rows[i])
	}
	log.Println("Embedding: backfill selesai")
}
