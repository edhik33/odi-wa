package models

import "time"

type User struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	TenantID     *uint     `gorm:"index" json:"tenant_id"` // nil untuk super admin (operator platform)
	Name         string    `json:"name"`
	Username     string    `gorm:"unique;not null" json:"username"`
	Email        string    `gorm:"unique" json:"email"`
	Password     string    `json:"-"`
	Role         string    `gorm:"size:16;default:owner" json:"role"` // owner, member
	IsSuperAdmin bool      `gorm:"not null;default:false" json:"is_super_admin"`
	CreatedAt    time.Time `json:"created_at"`
}

// Agent = satu CS / nomor WhatsApp, punya persona & knowledge sendiri. Milik satu tenant.
type Agent struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	TenantID     uint      `gorm:"index;not null" json:"tenant_id"`
	Name         string    `json:"name"`
	SystemPrompt string    `gorm:"type:text" json:"system_prompt"`
	Tone         string    `gorm:"default:ramah" json:"tone"`
	DeviceJID    string    `json:"device_jid"` // device whatsmeow yang ter-link
	Number       string    `json:"number"`     // nomor WA (cache untuk tampilan)

	// Sapaan otomatis untuk kontak baru.
	GreetingEnabled bool   `gorm:"not null;default:false" json:"greeting_enabled"`
	GreetingMessage string `gorm:"type:text" json:"greeting_message"`

	// Jam kerja: di luar jam ini bot tidak menjawab, hanya kirim pesan "away".
	BusinessHoursEnabled bool   `gorm:"not null;default:false" json:"business_hours_enabled"`
	BusinessStart        string `gorm:"size:5;default:'08:00'" json:"business_start"`
	BusinessEnd          string `gorm:"size:5;default:'21:00'" json:"business_end"`
	AwayMessage          string `gorm:"type:text" json:"away_message"`

	CreatedAt time.Time `json:"created_at"`
}

type ChatHistory struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"index" json:"agent_id"`
	Sender    string    `gorm:"index" json:"sender"`
	Message   string    `json:"message"`
	Reply     string    `json:"reply"`
	FromHuman bool      `gorm:"not null;default:false" json:"from_human"` // true = balasan dikirim manusia dari inbox
	// Lampiran media (kosong = pesan teks biasa).
	MediaType string    `gorm:"size:16" json:"media_type"` // image, document, audio, video, sticker
	MediaPath string    `json:"-"`                         // path file di server (diakses lewat endpoint media)
	FileName  string    `json:"file_name"`
	Mimetype  string    `json:"mimetype"`
	CreatedAt time.Time `json:"created_at"`
}

// Handoff = kontak yang sedang "diambil alih manusia" (bot berhenti auto-reply ke nomor ini).
type Handoff struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"index" json:"agent_id"`
	Sender    string    `gorm:"index" json:"sender"`
	LastMsg   string    `gorm:"type:text" json:"last_msg"`
	CreatedAt time.Time `json:"created_at"`
}

type Setting struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	SystemPrompt string `gorm:"type:text" json:"system_prompt"`
	AIModel      string `gorm:"default:deepseek-v4-pro" json:"ai_model"`
	Tone         string `gorm:"default:ramah" json:"tone"` // ramah, formal, santai, persuasif, custom
}

type Knowledge struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"index" json:"agent_id"`
	Question  string    `gorm:"type:text" json:"question"`
	Answer    string    `gorm:"type:text" json:"answer"`
	Tags      string    `json:"tags"`
	Embedding string    `gorm:"type:longtext" json:"-"` // vektor embedding (JSON []float32) untuk semantic search
	CreatedAt time.Time `json:"created_at"`
}
