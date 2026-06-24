package handlers

import (
	"errors"
	"log"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errAIQuotaExceeded = errors.New("ai quota exceeded")

// currentPeriod = bulan berjalan, format "2006-01" (kunci kuota AI bulanan).
func currentPeriod() string {
	return time.Now().Format("2006-01")
}

// aiReplyLimit = batas balasan AI per bulan untuk tenant. 0 = tanpa batas.
func aiReplyLimit(tenantID uint) int {
	var t models.Tenant
	if database.DB.Preload("Plan").First(&t, tenantID).Error != nil {
		return 0
	}
	if t.Plan != nil {
		return t.Plan.MaxAIRepliesMonthly // 0 = unlimited
	}
	// Tanpa plan (trial): batas wajar untuk cegah penyalahgunaan.
	return config.EnvInt("TRIAL_AI_REPLIES", 100)
}

// aiQuotaExceeded true bila tenant sudah melewati kuota balasan AI bulan ini.
// Ini hanya untuk display/early-check. Untuk konsumsi kuota sebenarnya gunakan consumeAIQuota.
func aiQuotaExceeded(tenantID uint) bool {
	limit := aiReplyLimit(tenantID)
	if limit <= 0 {
		return false
	}
	var usage models.AIUsage
	if err := database.DB.Where("tenant_id = ? AND period = ?", tenantID, currentPeriod()).First(&usage).Error; err != nil {
		return false
	}
	return usage.Replies >= limit
}

// consumeAIQuota melakukan check+increment secara atomic-ish dengan row lock.
// Return false,nil bila kuota habis. Return true,nil bila kuota berhasil dikonsumsi.
func consumeAIQuota(tenantID uint) (bool, error) {
	limit := aiReplyLimit(tenantID)
	if limit <= 0 {
		return true, incrementAIUsage(tenantID)
	}

	period := currentPeriod()
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		// Buat baris periode ini secara idempoten lebih dulu agar SELECT ... FOR UPDATE punya row untuk dikunci.
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "period"}},
			DoNothing: true,
		}).Create(&models.AIUsage{TenantID: tenantID, Period: period, Replies: 0, UpdatedAt: time.Now()}).Error; err != nil {
			return err
		}

		var usage models.AIUsage
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("tenant_id = ? AND period = ?", tenantID, period).
			First(&usage).Error; err != nil {
			return err
		}
		if usage.Replies >= limit {
			return errAIQuotaExceeded
		}
		return tx.Model(&usage).Updates(map[string]interface{}{
			"replies":    gorm.Expr("replies + 1"),
			"updated_at": time.Now(),
		}).Error
	})
	if errors.Is(err, errAIQuotaExceeded) {
		return false, nil
	}
	if err != nil {
		log.Printf("AI quota consume error (tenant %d): %v", tenantID, err)
		return false, err
	}
	return true, nil
}

// incrementAIUsage menambah satu hitungan balasan AI tenant pada bulan berjalan (upsert).
func incrementAIUsage(tenantID uint) error {
	period := currentPeriod()
	return database.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "period"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"replies":    gorm.Expr("replies + 1"),
			"updated_at": time.Now(),
		}),
	}).Create(&models.AIUsage{TenantID: tenantID, Period: period, Replies: 1, UpdatedAt: time.Now()}).Error
}
