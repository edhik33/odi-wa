package models

import "time"

// Broadcast = satu kampanye pesan massal milik sebuah agent.
type Broadcast struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	TenantID  uint      `gorm:"index;not null" json:"tenant_id"`
	AgentID   uint      `gorm:"index;not null" json:"agent_id"`
	Message   string    `gorm:"type:text" json:"message"`
	Status    string    `gorm:"size:16;default:pending;index" json:"status"` // pending, running, done, failed
	Total     int       `json:"total"`
	Sent      int       `json:"sent"`
	Failed    int       `json:"failed"`
	Skipped   int       `json:"skipped"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// BroadcastRecipient = satu penerima dalam sebuah broadcast.
type BroadcastRecipient struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	BroadcastID uint       `gorm:"index;not null" json:"broadcast_id"`
	Number      string     `gorm:"size:32" json:"number"`
	Name        string     `json:"name"`
	Status      string     `gorm:"size:16;default:pending" json:"status"` // pending, sent, failed, skipped
	Error       string     `json:"error"`
	SentAt      *time.Time `json:"sent_at"`
}

// OptOut = kontak yang minta berhenti menerima pesan (balas STOP/BERHENTI).
type OptOut struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AgentID   uint      `gorm:"not null;uniqueIndex:idx_optout_agent_sender,priority:1" json:"agent_id"`
	Sender    string    `gorm:"not null;size:32;uniqueIndex:idx_optout_agent_sender,priority:2" json:"sender"`
	CreatedAt time.Time `json:"created_at"`
}
