package database

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"
	"wa-assistant/backend/config"
	"wa-assistant/backend/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Init() {
	host := config.Env("DB_HOST", "localhost")
	port := config.Env("DB_PORT", "3306")
	user := config.Env("DB_USER", "root")
	pass := config.Env("DB_PASS", "")
	name := config.Env("DB_NAME", "wa_assistant")
	// Validasi nama DB (hanya huruf/angka/underscore) sebelum dipakai di query CREATE DATABASE.
	if !validDBName(name) {
		log.Printf("DB_NAME tidak valid (%q) — pakai default 'wa_assistant'", name)
		name = "wa_assistant"
	}

	// Buat database-nya kalau belum ada (connect tanpa nama DB dulu).
	rootDSN := fmt.Sprintf("%s:%s@tcp(%s:%s)/?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, port)
	if rootDB, err := gorm.Open(mysql.Open(rootDSN), &gorm.Config{}); err == nil {
		rootDB.Exec("CREATE DATABASE IF NOT EXISTS `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
		if sqlDB, e := rootDB.DB(); e == nil {
			sqlDB.Close()
		}
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, port, name)
	var err error
	DB, err = gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("DB error (MySQL): ", err)
	}

	// Batasi connection pool agar lonjakan traffic tidak menghabiskan koneksi MySQL
	// (penting di VPS yang dipakai bersama situs lain). Semua bisa diatur via env.
	if sqlDB, e := DB.DB(); e == nil {
		sqlDB.SetMaxOpenConns(config.EnvInt("DB_MAX_OPEN_CONNS", 25))
		sqlDB.SetMaxIdleConns(config.EnvInt("DB_MAX_IDLE_CONNS", 5))
		sqlDB.SetConnMaxLifetime(time.Duration(config.EnvInt("DB_CONN_MAX_LIFETIME_MIN", 30)) * time.Minute)
	}

	DB.AutoMigrate(
		&models.User{}, &models.LoginThrottle{}, &models.Agent{}, &models.ChatHistory{}, &models.Setting{},
		&models.Knowledge{}, &models.Handoff{}, &models.Contact{},
		&models.Plan{}, &models.Tenant{}, &models.Subscription{}, &models.Invoice{}, &models.AIUsage{},
		&models.Broadcast{}, &models.BroadcastRecipient{}, &models.OptOut{},
		&models.ScheduledMessage{}, &models.Label{}, &models.ChatLabel{}, &models.AutoReply{},
		&models.Template{},
		&models.FollowUp{}, &models.FollowUpStep{}, &models.FollowUpEnrollment{},
		&models.AppSetting{},
		&models.ClosingForm{}, &models.ClosingRecord{},
		&models.ShippingProvince{}, &models.ShippingCity{}, &models.ShippingDistrict{},
	)

	seedPlans()
	seedSuperAdmin()
	migrateLegacyTenant()

	log.Println("Database ready")
}

// validDBName memastikan nama database hanya berisi huruf/angka/underscore
// (mencegah injeksi pada query CREATE DATABASE yang merangkai nama).
func validDBName(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_'
		if !ok {
			return false
		}
	}
	return true
}

// seedPlans mengisi paket langganan awal (idempoten).
func seedPlans() {
	var n int64
	DB.Model(&models.Plan{}).Count(&n)
	if n > 0 {
		return
	}
	plans := []models.Plan{
		{Code: "starter", Name: "Starter", Description: "1 nomor WhatsApp, cocok untuk mulai.", Price: 99000, BillingPeriod: "monthly", MaxNumbers: 1, MaxAIRepliesMonthly: 1000, SortOrder: 1},
		{Code: "growth", Name: "Growth", Description: "3 nomor, untuk tim yang berkembang.", Price: 249000, BillingPeriod: "monthly", MaxNumbers: 3, MaxAIRepliesMonthly: 5000, IsPopular: true, SortOrder: 2},
		{Code: "pro", Name: "Pro", Description: "10 nomor, untuk bisnis serius.", Price: 699000, BillingPeriod: "monthly", MaxNumbers: 10, MaxAIRepliesMonthly: 20000, SortOrder: 3},
	}
	DB.Create(&plans)
	log.Println("Seeder: plans dibuat (starter, growth, pro)")
}

// seedSuperAdmin memastikan ada satu operator platform (login ke /admin).
func seedSuperAdmin() {
	var n int64
	DB.Model(&models.User{}).Where("is_super_admin = ?", true).Count(&n)
	if n > 0 {
		syncSuperAdminPassword() // jaga password/username super-admin sinkron dengan env
		return
	}
	username := config.Env("SUPERADMIN_USERNAME", "superadmin")
	pw := os.Getenv("SUPERADMIN_PASSWORD")
	if pw == "" {
		log.Println("Seeder: SUPERADMIN_PASSWORD tidak diset — skip superadmin")
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	DB.Create(&models.User{
		Name: "Super Admin", Username: username, Email: "super@wa-assistant.local",
		Password: string(hash), IsSuperAdmin: true, Role: "admin",
	})
	log.Printf("Seeder: super admin '%s' dibuat", username)
}

// syncSuperAdminPassword memperbarui kredensial super-admin agar cocok dengan env
// SUPERADMIN_PASSWORD / SUPERADMIN_USERNAME (kalau diisi). Cara aman ganti password
// super-admin TANPA lewat chat: set SUPERADMIN_PASSWORD di .env lalu restart service.
// Kalau env kosong, kredensial yang ada dibiarkan apa adanya.
func syncSuperAdminPassword() {
	pw := os.Getenv("SUPERADMIN_PASSWORD")
	if pw == "" {
		return
	}
	username := config.Env("SUPERADMIN_USERNAME", "superadmin")
	var u models.User
	if DB.Where("is_super_admin = ?", true).First(&u).Error != nil {
		return
	}
	// Sudah cocok → cukup pastikan username sinkron (hindari re-hash tiap restart).
	if bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(pw)) == nil {
		if u.Username != username {
			DB.Model(&u).Update("username", username)
		}
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	DB.Model(&u).Updates(map[string]any{"password": string(hash), "username": username})
	log.Printf("Super admin '%s': kredensial disinkronkan dari env", username)
}

// migrateLegacyTenant memindahkan data single-tenant lama ke satu tenant default.
// Hanya berjalan sekali (saat belum ada tenant sama sekali).
func migrateLegacyTenant() {
	var n int64
	DB.Model(&models.Tenant{}).Count(&n)
	if n > 0 {
		return
	}

	var pro models.Plan
	DB.Where("code = ?", "pro").First(&pro)
	tenant := models.Tenant{Name: "Default", Status: models.TenantActive}
	if pro.ID != 0 {
		tenant.PlanID = &pro.ID
	}
	DB.Create(&tenant)

	// Pindahkan agent lama (single-tenant) ke tenant default.
	DB.Model(&models.Agent{}).Where("tenant_id = 0 OR tenant_id IS NULL").Update("tenant_id", tenant.ID)

	// Lampirkan user non-super yang belum punya tenant sebagai owner.
	DB.Model(&models.User{}).
		Where("is_super_admin = ? AND (tenant_id IS NULL OR tenant_id = 0)", false).
		Updates(map[string]interface{}{"tenant_id": tenant.ID, "role": "owner"})

	// Instalasi baru: belum ada owner sama sekali → buat owner dari env (DEFAULT_OWNER_USERNAME / DEFAULT_OWNER_PASSWORD).
	var owners int64
	DB.Model(&models.User{}).Where("tenant_id = ?", tenant.ID).Count(&owners)
	if owners == 0 {
		ownerUser := strings.TrimSpace(os.Getenv("DEFAULT_OWNER_USERNAME"))
		ownerPass := os.Getenv("DEFAULT_OWNER_PASSWORD")
		if ownerUser == "" {
			ownerUser = "admin"
		}
		if ownerUser == "" || ownerPass == "" {
			log.Println("Seeder: default owner tidak dibuat; set DEFAULT_OWNER_USERNAME/DEFAULT_OWNER_PASSWORD di .env")
			return
		}
		hash, _ := bcrypt.GenerateFromPassword([]byte(ownerPass), bcrypt.DefaultCost)
		DB.Create(&models.User{
			TenantID: &tenant.ID, Name: "Admin", Username: ownerUser,
			Email: "admin@wa-assistant.local", Password: string(hash), Role: "owner",
		})
		log.Printf("Seeder: owner '%s' dibuat", ownerUser)
	}

	// Pastikan tenant punya minimal 1 agent; adopsi knowledge/chat lama yang yatim.
	var agentCount int64
	DB.Model(&models.Agent{}).Where("tenant_id = ?", tenant.ID).Count(&agentCount)
	if agentCount == 0 {
		def := models.Agent{TenantID: tenant.ID, Name: "CS Utama", Tone: "ramah"}
		DB.Create(&def)
		DB.Model(&models.Knowledge{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", def.ID)
		DB.Model(&models.ChatHistory{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", def.ID)
	}

	// Langganan aktif jangka panjang untuk tenant default.
	if pro.ID != 0 {
		DB.Create(&models.Subscription{
			TenantID: tenant.ID, PlanID: pro.ID, Status: "active",
			StartsAt: time.Now(), EndsAt: time.Now().AddDate(10, 0, 0),
		})
	}
	log.Printf("Migrasi: tenant default (id=%d) dibuat, data lama dipindahkan", tenant.ID)
}
