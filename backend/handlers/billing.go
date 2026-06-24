package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// BillingChannels = daftar metode pembayaran aktif dari Tripay.
func BillingChannels(c *gin.Context) {
	channels, err := services.ListTripayPaymentChannels()
	if err != nil {
		billingError(c, err)
		return
	}
	c.JSON(200, gin.H{"data": channels})
}

// Checkout = buat invoice + transaksi Tripay untuk plan yang dipilih tenant.
func Checkout(c *gin.Context) {
	tid := currentTenantID(c)
	var req struct {
		PlanID uint   `json:"plan_id"`
		Method string `json:"method"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanID == 0 || req.Method == "" {
		c.JSON(400, gin.H{"error": "Plan & metode pembayaran wajib dipilih"})
		return
	}
	var plan models.Plan
	if database.DB.First(&plan, req.PlanID).Error != nil {
		c.JSON(404, gin.H{"error": "Plan tidak ditemukan"})
		return
	}

	var owner models.User
	if err := database.DB.Where("tenant_id = ? AND role = ?", tid, "owner").First(&owner).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(500, gin.H{"error": "Gagal membaca owner tenant"})
		return
	}
	email := owner.Email
	if email == "" {
		email = fmt.Sprintf("tenant%d@wa-assistant.local", tid)
	}

	merchantRef := fmt.Sprintf("WAI-%d-%d", tid, time.Now().UnixNano())
	invoice := models.Invoice{
		TenantID: tid, PlanID: plan.ID, MerchantRef: merchantRef,
		Amount: plan.Price, Status: "pending", PaymentMethod: req.Method,
	}
	if err := database.DB.Create(&invoice).Error; err != nil {
		c.JSON(500, gin.H{"error": "Gagal membuat invoice"})
		return
	}

	result, err := services.CreateTripayTransaction(services.TripayTxParams{
		Method:        req.Method,
		MerchantRef:   merchantRef,
		Amount:        plan.Price,
		CustomerName:  firstNonEmpty(owner.Name, owner.Username, "Pelanggan"),
		CustomerEmail: email,
		ItemName:      "Langganan " + plan.Name,
		ReturnURL:     config.Env("TRIPAY_RETURN_URL", ""),
	})
	if err != nil {
		if saveErr := database.DB.Model(&invoice).Updates(map[string]any{"status": "failed"}).Error; saveErr != nil {
			billingError(c, fmt.Errorf("%w; gagal update invoice failed: %v", err, saveErr))
			return
		}
		billingError(c, err)
		return
	}

	if err := database.DB.Model(&invoice).Updates(map[string]any{
		"tripay_reference": result.Reference,
		"checkout_url":     result.CheckoutURL,
	}).Error; err != nil {
		c.JSON(500, gin.H{"error": "Transaksi Tripay dibuat, tetapi invoice gagal disimpan. Hubungi admin dengan merchant_ref: " + merchantRef})
		return
	}

	c.JSON(200, gin.H{"data": gin.H{
		"checkout_url": result.CheckoutURL,
		"reference":    result.Reference,
		"merchant_ref": merchantRef,
	}})
}

// TripayCallback = webhook Tripay saat status pembayaran berubah (signature diverifikasi).
func TripayCallback(c *gin.Context) {
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Bad payload"})
		return
	}
	if !services.VerifyTripayCallback(rawBody, c.GetHeader("X-Callback-Signature")) {
		c.JSON(401, gin.H{"success": false, "message": "Invalid signature"})
		return
	}

	var payload struct {
		MerchantRef string `json:"merchant_ref"`
		Reference   string `json:"reference"`
		Status      string `json:"status"` // PAID, EXPIRED, FAILED, UNPAID
		TotalAmount int64  `json:"total_amount"`
		Amount      int64  `json:"amount"`
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil || payload.MerchantRef == "" {
		c.JSON(400, gin.H{"success": false, "message": "Bad payload"})
		return
	}

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		var invoice models.Invoice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("merchant_ref = ?", payload.MerchantRef).First(&invoice).Error; err != nil {
			return err
		}
		if invoice.TripayReference != "" && payload.Reference != "" && invoice.TripayReference != payload.Reference {
			return fmt.Errorf("callback reference mismatch: invoice=%s payload=%s", invoice.TripayReference, payload.Reference)
		}
		if amount := firstPositiveInt64(payload.TotalAmount, payload.Amount); amount > 0 && amount != invoice.Amount {
			return fmt.Errorf("callback amount mismatch: invoice=%d payload=%d", invoice.Amount, amount)
		}

		// Idempotent: callback bisa dikirim lebih dari sekali. Status final tidak diproses ulang.
		if invoice.Status == "paid" || invoice.Status == "expired" || invoice.Status == "failed" {
			return nil
		}

		switch payload.Status {
		case "PAID":
			now := time.Now()
			invoice.Status = "paid"
			invoice.PaidAt = &now
			if err := tx.Save(&invoice).Error; err != nil {
				return err
			}
			return activateSubscriptionTx(tx, invoice.TenantID, invoice.PlanID)
		case "EXPIRED":
			invoice.Status = "expired"
			return tx.Save(&invoice).Error
		case "FAILED":
			invoice.Status = "failed"
			return tx.Save(&invoice).Error
		case "UNPAID", "":
			return nil
		default:
			return fmt.Errorf("unknown Tripay status: %s", payload.Status)
		}
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"success": false, "message": "Invoice not found"})
			return
		}
		c.JSON(400, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// activateSubscription mengaktifkan / memperpanjang langganan tenant setelah pembayaran lunas.
func activateSubscription(tenantID, planID uint) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		return activateSubscriptionTx(tx, tenantID, planID)
	})
}

func activateSubscriptionTx(tx *gorm.DB, tenantID, planID uint) error {
	var plan models.Plan
	if err := tx.First(&plan, planID).Error; err != nil {
		return err
	}
	now := time.Now()

	var sub models.Subscription
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ?", tenantID).First(&sub).Error
	found := err == nil
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	// Perpanjang dari sisa masa aktif bila masih berjalan, kalau tidak dari sekarang.
	base := now
	if found && sub.Status == "active" && sub.EndsAt.After(now) {
		base = sub.EndsAt
	}
	ends := base.AddDate(0, 1, 0)
	if plan.BillingPeriod == "yearly" {
		ends = base.AddDate(1, 0, 0)
	}

	if found {
		sub.PlanID = planID
		sub.Status = "active"
		sub.EndsAt = ends
		if sub.StartsAt.IsZero() {
			sub.StartsAt = now
		}
		if err := tx.Save(&sub).Error; err != nil {
			return err
		}
	} else {
		if err := tx.Create(&models.Subscription{
			TenantID: tenantID, PlanID: planID, Status: "active", StartsAt: now, EndsAt: ends,
		}).Error; err != nil {
			return err
		}
	}

	return tx.Model(&models.Tenant{}).Where("id = ?", tenantID).
		Updates(map[string]any{"status": models.TenantActive, "plan_id": planID}).Error
}

// Invoices = riwayat tagihan tenant.
func Invoices(c *gin.Context) {
	var inv []models.Invoice
	database.DB.Where("tenant_id = ?", currentTenantID(c)).Order("created_at desc").Find(&inv)
	c.JSON(200, gin.H{"data": inv})
}

func billingError(c *gin.Context, err error) {
	if errors.Is(err, services.ErrTripayNotConfigured) {
		c.JSON(503, gin.H{"error": "Pembayaran belum dikonfigurasi (Tripay)"})
		return
	}
	c.JSON(502, gin.H{"error": err.Error()})
}

func firstPositiveInt64(values ...int64) int64 {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}
