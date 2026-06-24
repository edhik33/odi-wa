package models

import "time"

// Agent merepresentasikan satu sesi WhatsApp yang tertaut — satu CS/AI per nomor.
type Agent struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	TenantID     uint      `gorm:"index;not null" json:"tenant_id"`
	Name         string    `json:"name"`
	SystemPrompt string    `gorm:"type:text" json:"system_prompt"`
	Tone         string    `gorm:"default:ramah" json:"tone"`
	AIEnabled    bool      `gorm:"not null;default:true" json:"ai_enabled"` // master switch balasan otomatis AI
	DeviceJID    string    `json:"device_jid"`
	Number       string    `json:"number"`

	GreetingEnabled bool   `gorm:"not null;default:false" json:"greeting_enabled"`
	GreetingMessage string `gorm:"type:text" json:"greeting_message"`

	BusinessHoursEnabled bool   `gorm:"not null;default:false" json:"business_hours_enabled"`
	BusinessStart        string `gorm:"size:5;default:'08:00'" json:"business_start"`
	BusinessEnd          string `gorm:"size:5;default:'21:00'" json:"business_end"`
	AwayMessage          string `gorm:"type:text" json:"away_message"`

	ConversationSummary string    `gorm:"type:text" json:"conversation_summary"`
	LastSummaryAt       time.Time `json:"last_summary_at"`

	CreatedAt time.Time `json:"created_at"`
}

type ChatHistory struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"index" json:"agent_id"`
	Sender    string    `gorm:"index;size:32" json:"sender"`
	Message   string    `json:"message"`
	Reply     string    `json:"reply"`
	FromHuman bool      `gorm:"not null;default:false" json:"from_human"`
	MediaType string    `gorm:"size:16" json:"media_type"`
	MediaPath string    `json:"-"`
	FileName  string    `json:"file_name"`
	Mimetype  string    `json:"mimetype"`
	WAMsgID   string    `gorm:"size:64" json:"wa_msg_id"`
	ReplyTo   string    `json:"reply_to"`
	ReplyText string    `gorm:"size:200" json:"reply_text"`
	CreatedAt time.Time `json:"created_at"`
}

type Contact struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"uniqueIndex:idx_contact_agent_number;not null" json:"agent_id"`
	Number    string    `gorm:"uniqueIndex:idx_contact_agent_number;size:32;not null" json:"number"`
	Name      string    `json:"name"`
	Notes     string    `gorm:"type:text" json:"notes"`
	Tags      string    `gorm:"type:text" json:"tags"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Handoff struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"index" json:"agent_id"`
	Sender    string    `gorm:"index;size:32" json:"sender"`
	LastMsg   string    `gorm:"type:text" json:"last_msg"`
	CreatedAt time.Time `json:"created_at"`
}

type Setting struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	SystemPrompt string `gorm:"type:text" json:"system_prompt"`
	AIModel      string `gorm:"default:deepseek-v4-pro" json:"ai_model"`
	Tone         string `gorm:"default:ramah" json:"tone"`
}

type Knowledge struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"index" json:"agent_id"`
	Question  string    `gorm:"type:text" json:"question"`
	Answer    string    `gorm:"type:text" json:"answer"`
	Tags      string    `json:"tags"`
	Embedding string    `gorm:"type:longtext" json:"-"`
	CreatedAt time.Time `json:"created_at"`
}

type User struct {
	ID           uint    `gorm:"primaryKey" json:"id"`
	Username     string  `gorm:"uniqueIndex;size:64;not null" json:"username"`
	Password     string  `json:"-"`
	Role         string  `gorm:"size:24;default:owner" json:"role"`
	Name         string  `json:"name"`
	Email        string  `json:"email"`
	TenantID     *uint   `gorm:"index" json:"tenant_id"`
	IsSuperAdmin bool    `gorm:"default:false" json:"is_super_admin"`
}

