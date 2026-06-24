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
	database.DB.Where("tenant_id = ? AND role = ?", tid, "owner").First(&owner)
	email := owner.Email
	if email == "" {
		email = fmt.Sprintf("tenant%d@wa-assistant.local", tid)
	}

	merchantRef := fmt.Sprintf("WAI-%d-%d", tid, time.Now().Unix())
	invoice := models.Invoice{
		TenantID: tid, PlanID: plan.ID, MerchantRef: merchantRef,
		Amount: plan.Price, Status: "pending", PaymentMethod: req.Method,
	}
	_ = database.DB.Create(&invoice).Error

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
		invoice.Status = "failed"
		_ = database.DB.Save(&invoice).Error
		billingError(c, err)
		return
	}

	invoice.TripayReference = result.Reference
	invoice.CheckoutURL = result.CheckoutURL
	_ = database.DB.Save(&invoice).Error

	c.JSON(200, gin.H{"data": gin.H{
		"checkout_url": result.CheckoutURL,
		"reference":    result.Reference,
		"merchant_ref": merchantRef,
	}})
}

// TripayCallback = webhook Tripay saat status pembayaran berubah (signature diverifikasi).
func TripayCallback(c *gin.Context) {
	rawBody, _ := io.ReadAll(c.Request.Body)
	if !services.VerifyTripayCallback(rawBody, c.GetHeader("X-Callback-Signature")) {
		c.JSON(401, gin.H{"success": false, "message": "Invalid signature"})
		return
	}

	var payload struct {
		MerchantRef string `json:"merchant_ref"`
		Reference   string `json:"reference"`
		Status      string `json:"status"` // PAID, EXPIRED, FAILED, UNPAID
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Bad payload"})
		return
	}

	var invoice models.Invoice
	if database.DB.Where("merchant_ref = ?", payload.MerchantRef).First(&invoice).Error != nil {
		c.JSON(404, gin.H{"success": false, "message": "Invoice not found"})
		return
	}
	if invoice.Status == "paid" { // idempoten: callback bisa terkirim lebih dari sekali
		c.JSON(200, gin.H{"success": true})
		return
	}

	switch payload.Status {
	case "PAID":
		now := time.Now()
		invoice.Status = "paid"
		invoice.PaidAt = &now
		_ = database.DB.Save(&invoice).Error
		activateSubscription(invoice.TenantID, invoice.PlanID)
	case "EXPIRED":
		invoice.Status = "expired"
		_ = database.DB.Save(&invoice).Error
	case "FAILED":
		invoice.Status = "failed"
		_ = database.DB.Save(&invoice).Error
	}
	c.JSON(200, gin.H{"success": true})
}

// activateSubscription mengaktifkan / memperpanjang langganan tenant setelah pembayaran lunas.
func activateSubscription(tenantID, planID uint) {
	var plan models.Plan
	if database.DB.First(&plan, planID).Error != nil {
		return
	}
	now := time.Now()

	var sub models.Subscription
	found := database.DB.Where("tenant_id = ?", tenantID).First(&sub).Error == nil

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
		_ = database.DB.Save(&sub).Error
	} else {
		_ = database.DB.Create(&models.Subscription{
			TenantID: tenantID, PlanID: planID, Status: "active", StartsAt: now, EndsAt: ends,
		})
	}

	database.DB.Model(&models.Tenant{}).Where("id = ?", tenantID).
		Updates(map[string]any{"status": models.TenantActive, "plan_id": planID})
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
