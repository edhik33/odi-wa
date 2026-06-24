package handlers

import (
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

// AdminGetAIModel = model AI aktif + daftar preset (untuk panel super-admin).
func AdminGetAIModel(c *gin.Context) {
	c.JSON(200, gin.H{"active": services.ActivePresetKey(), "presets": services.AIPresetList()})
}

// AdminSetAIModel mengganti model AI yang dipakai seluruh tenant.
func AdminSetAIModel(c *gin.Context) {
	var req struct {
		Preset string `json:"preset"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if !services.SetActivePreset(req.Preset) {
		c.JSON(400, gin.H{"error": "Preset model tidak dikenal"})
		return
	}
	c.JSON(200, gin.H{"active": req.Preset})
}

// AdminStats = ringkasan untuk dashboard operator platform.
func AdminStats(c *gin.Context) {
	var totalTenants, activeTenants, trialTenants int64
	database.DB.Model(&models.Tenant{}).Count(&totalTenants)
	database.DB.Model(&models.Tenant{}).Where("status = ?", models.TenantActive).Count(&activeTenants)
	database.DB.Model(&models.Tenant{}).Where("status = ?", models.TenantTrial).Count(&trialTenants)

	var revenue int64
	database.DB.Model(&models.Invoice{}).Where("status = ?", "paid").
		Select("COALESCE(SUM(amount),0)").Scan(&revenue)

	var aiRepliesMonth int64
	database.DB.Model(&models.AIUsage{}).Where("period = ?", currentPeriod()).
		Select("COALESCE(SUM(replies),0)").Scan(&aiRepliesMonth)

	c.JSON(200, gin.H{
		"total_tenants":    totalTenants,
		"active_tenants":   activeTenants,
		"trial_tenants":    trialTenants,
		"revenue_total":    revenue,
		"ai_replies_month": aiRepliesMonth,
		"period":           currentPeriod(),
	})
}

// AdminTenants = daftar semua tenant + plan + jumlah nomor + pemakaian AI bulan ini.
func AdminTenants(c *gin.Context) {
	var tenants []models.Tenant
	database.DB.Preload("Plan").Order("created_at desc").Find(&tenants)

	type tenantRow struct {
		models.Tenant
		NumbersUsed   int64 `json:"numbers_used"`
		AIRepliesUsed int   `json:"ai_replies_used"`
	}
	period := currentPeriod()
	out := make([]tenantRow, 0, len(tenants))
	for _, t := range tenants {
		var n int64
		database.DB.Model(&models.Agent{}).Where("tenant_id = ?", t.ID).Count(&n)
		var u models.AIUsage
		database.DB.Where("tenant_id = ? AND period = ?", t.ID, period).First(&u)
		out = append(out, tenantRow{Tenant: t, NumbersUsed: n, AIRepliesUsed: u.Replies})
	}
	c.JSON(200, gin.H{"data": out})
}

// AdminUpdateTenant = ubah status/plan tenant (suspend, aktifkan kembali, ganti plan).
func AdminUpdateTenant(c *gin.Context) {
	var t models.Tenant
	if database.DB.First(&t, c.Param("id")).Error != nil {
		c.JSON(404, gin.H{"error": "Tenant tidak ditemukan"})
		return
	}
	var req struct {
		Status *string `json:"status"`
		PlanID *uint   `json:"plan_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if req.Status != nil {
		t.Status = *req.Status
	}
	if req.PlanID != nil {
		t.PlanID = req.PlanID
	}
	database.DB.Save(&t)
	c.JSON(200, gin.H{"data": t})
}

// ---- Plans CRUD (admin) ----

func AdminPlans(c *gin.Context) {
	var plans []models.Plan
	database.DB.Order("sort_order asc").Find(&plans)
	c.JSON(200, gin.H{"data": plans})
}

func AdminCreatePlan(c *gin.Context) {
	var p models.Plan
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"error": "Data tidak valid"})
		return
	}
	if err := database.DB.Create(&p).Error; err != nil {
		c.JSON(400, gin.H{"error": "Gagal membuat plan (code mungkin sudah dipakai)"})
		return
	}
	c.JSON(201, gin.H{"data": p})
}

func AdminUpdatePlan(c *gin.Context) {
	var p models.Plan
	if database.DB.First(&p, c.Param("id")).Error != nil {
		c.JSON(404, gin.H{"error": "Plan tidak ditemukan"})
		return
	}
	var req models.Plan
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Data tidak valid"})
		return
	}
	// Code tidak diubah (jadi acuan stabil); perbarui sisanya.
	p.Name = req.Name
	p.Description = req.Description
	p.Price = req.Price
	p.BillingPeriod = req.BillingPeriod
	p.MaxNumbers = req.MaxNumbers
	p.MaxAIRepliesMonthly = req.MaxAIRepliesMonthly
	p.IsActive = req.IsActive
	p.IsPopular = req.IsPopular
	p.SortOrder = req.SortOrder
	database.DB.Save(&p)
	c.JSON(200, gin.H{"data": p})
}

func AdminDeletePlan(c *gin.Context) {
	database.DB.Delete(&models.Plan{}, c.Param("id"))
	c.JSON(200, gin.H{"message": "Deleted"})
}
