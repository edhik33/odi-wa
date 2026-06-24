package database

import (
	"errors"
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
		if err := rootDB.Exec("CREATE DATABASE IF NOT EXISTS `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci").Error; err != nil {
			log.Fatal("DB create database error: ", err)
		}
		if sqlDB, e := rootDB.DB(); e == nil {
			if err := sqlDB.Close(); err != nil {
				log.Printf("DB root close warning: %v", err)
			}
		}
	} else {
		log.Printf("DB root connection warning: %v", err)
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
	} else {
		log.Fatal("DB pool error: ", e)
	}

	if err := DB.AutoMigrate(
		&models.User{}, &models.Agent{}, &models.ChatHistory{}, &models.Setting{},
		&models.Knowledge{}, &models.Handoff{}, &models.Contact{},
		&models.Plan{}, &models.Tenant{}, &models.Subscription{}, &models.Invoice{}, &models.AIUsage{},
		&models.Broadcast{}, &models.BroadcastRecipient{}, &models.OptOut{},
		&models.ScheduledMessage{}, &models.Label{}, &models.ChatLabel{}, &models.AutoReply{},
		&models.Template{},
		&models.FollowUp{}, &models.FollowUpStep{}, &models.FollowUpEnrollment{},
		&models.AppSetting{},
	).Error; err != nil {
		log.Fatal("DB migration error: ", err)
	}

	if err := seedPlans(); err != nil {
		log.Fatal("DB seed plans error: ", err)
	}
	if err := seedSuperAdmin(); err != nil {
		log.Fatal("DB seed super admin error: ", err)
	}
	if err := migrateLegacyTenant(); err != nil {
		log.Fatal("DB legacy tenant migration error: ", err)
	}

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

func isUnsafeDefaultCredential(v string) bool {
	v = strings.TrimSpace(strings.ToLower(v))
	switch v {
	case "", "admin123", "superadmin123", "password", "changeme", "change-me", "secret", "wa-assistant-secret-change-me", "ganti_dengan_string_acak_min_32_char":
		return true
	default:
		return false
	}
}

func validateAdminPassword(envKey, password string) error {
	if isUnsafeDefaultCredential(password) || len(password) < 12 {
		return fmt.Errorf("%s tidak aman; set minimal 12 karakter dan jangan gunakan default password", envKey)
	}
	return nil
}

// seedPlans mengisi paket langganan awal (idempoten).
func seedPlans() error {
	var n int64
	if err := DB.Model(&models.Plan{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	plans := []models.Plan{
		{Code: "starter", Name: "Starter", Description: "1 nomor WhatsApp, cocok untuk mulai.", Price: 99000, BillingPeriod: "monthly", MaxNumbers: 1, MaxAIRepliesMonthly: 1000, SortOrder: 1},
		{Code: "growth", Name: "Growth", Description: "3 nomor, untuk tim yang berkembang.", Price: 249000, BillingPeriod: "monthly", MaxNumbers: 3, MaxAIRepliesMonthly: 5000, IsPopular: true, SortOrder: 2},
		{Code: "pro", Name: "Pro", Description: "10 nomor, untuk bisnis serius.", Price: 699000, BillingPeriod: "monthly", MaxNumbers: 10, MaxAIRepliesMonthly: 20000, SortOrder: 3},
	}
	if err := DB.Create(&plans).Error; err != nil {
		return err
	}
	log.Println("Seeder: plans dibuat (starter, growth, pro)")
	return nil
}

// seedSuperAdmin memastikan ada satu operator platform (login ke /admin).
func seedSuperAdmin() error {
	var n int64
	if err := DB.Model(&models.User{}).Where("is_super_admin = ?", true).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return syncSuperAdminPassword() // jaga password/username super-admin sinkron dengan env
	}
	username := config.EnvRequired("SUPERADMIN_USERNAME")
	password := config.EnvRequired("SUPERADMIN_PASSWORD")
	if err := validateAdminPassword("SUPERADMIN_PASSWORD", password); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := DB.Create(&models.User{
		Name: "Super Admin", Username: username, Email: "super@wa-assistant.local",
		Password: string(hash), IsSuperAdmin: true, Role: "admin",
	}).Error; err != nil {
		return err
	}
	log.Printf("Seeder: super admin '%s' dibuat", username)
	return nil
}

// syncSuperAdminPassword memperbarui kredensial super-admin agar cocok dengan env
// SUPERADMIN_PASSWORD / SUPERADMIN_USERNAME (kalau diisi). Cara aman ganti password
// super-admin TANPA lewat chat: set SUPERADMIN_PASSWORD di .env lalu restart service.
// Kalau env kosong, kredensial yang ada dibiarkan apa adanya.
func syncSuperAdminPassword() error {
	pw := os.Getenv("SUPERADMIN_PASSWORD")
	if pw == "" {
		return nil
	}
	if err := validateAdminPassword("SUPERADMIN_PASSWORD", pw); err != nil {
		return err
	}
	username := config.Env("SUPERADMIN_USERNAME", "superadmin")
	var u models.User
	if err := DB.Where("is_super_admin = ?", true).First(&u).Error; err != nil {
		return err
	}
	// Sudah cocok → cukup pastikan username sinkron (hindari re-hash tiap restart).
	if bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(pw)) == nil {
		if u.Username != username {
			if err := DB.Model(&u).Update("username", username).Error; err != nil {
				return err
			}
		}
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := DB.Model(&u).Updates(map[string]any{"password": string(hash), "username": username}).Error; err != nil {
		return err
	}
	log.Printf("Super admin '%s': kredensial disinkronkan dari env", username)
	return nil
}

// migrateLegacyTenant memindahkan data single-tenant lama ke satu tenant default.
// Hanya berjalan sekali (saat belum ada tenant sama sekali).
func migrateLegacyTenant() error {
	var n int64
	if err := DB.Model(&models.Tenant{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		var pro models.Plan
		if err := tx.Where("code = ?", "pro").First(&pro).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		tenant := models.Tenant{Name: "Default", Status: models.TenantActive}
		if pro.ID != 0 {
			tenant.PlanID = &pro.ID
		}
		if err := tx.Create(&tenant).Error; err != nil {
			return err
		}

		// Pindahkan agent lama (single-tenant) ke tenant default.
		if err := tx.Model(&models.Agent{}).Where("tenant_id = 0 OR tenant_id IS NULL").Update("tenant_id", tenant.ID).Error; err != nil {
			return err
		}

		// Lampirkan user non-super yang belum punya tenant sebagai owner.
		if err := tx.Model(&models.User{}).
			Where("is_super_admin = ? AND (tenant_id IS NULL OR tenant_id = 0)", false).
			Updates(map[string]interface{}{"tenant_id": tenant.ID, "role": "owner"}).Error; err != nil {
			return err
		}

		// Instalasi baru: jangan buat admin/admin123 otomatis. Pakai env eksplisit kalau memang butuh default owner.
		var owners int64
		if err := tx.Model(&models.User{}).Where("tenant_id = ?", tenant.ID).Count(&owners).Error; err != nil {
			return err
		}
		if owners == 0 {
			ownerUsername := strings.TrimSpace(os.Getenv("DEFAULT_OWNER_USERNAME"))
			ownerPassword := os.Getenv("DEFAULT_OWNER_PASSWORD")
			if ownerUsername == "" || ownerPassword == "" {
				log.Println("Seeder: default owner tidak dibuat; set DEFAULT_OWNER_USERNAME/DEFAULT_OWNER_PASSWORD atau gunakan /api/register")
			} else {
				if err := validateAdminPassword("DEFAULT_OWNER_PASSWORD", ownerPassword); err != nil {
					return err
				}
				hash, err := bcrypt.GenerateFromPassword([]byte(ownerPassword), bcrypt.DefaultCost)
				if err != nil {
					return err
				}
				if err := tx.Create(&models.User{
					TenantID: &tenant.ID, Name: "Admin", Username: ownerUsername,
					Email: "admin@wa-assistant.local", Password: string(hash), Role: "owner",
				}).Error; err != nil {
					return err
				}
				log.Printf("Seeder: owner default '%s' dibuat dari env", ownerUsername)
			}
		}

		// Pastikan tenant punya minimal 1 agent; adopsi knowledge/chat lama yang yatim.
		var agentCount int64
		if err := tx.Model(&models.Agent{}).Where("tenant_id = ?", tenant.ID).Count(&agentCount).Error; err != nil {
			return err
		}
		if agentCount == 0 {
			def := models.Agent{TenantID: tenant.ID, Name: "CS Utama", Tone: "ramah"}
			if err := tx.Create(&def).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.Knowledge{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", def.ID).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.ChatHistory{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", def.ID).Error; err != nil {
				return err
			}
		}

		// Langganan aktif jangka panjang untuk tenant default.
		if pro.ID != 0 {
			if err := tx.Create(&models.Subscription{
				TenantID: tenant.ID, PlanID: pro.ID, Status: "active",
				StartsAt: time.Now(), EndsAt: time.Now().AddDate(10, 0, 0),
			}).Error; err != nil {
				return err
			}
		}
		log.Printf("Migrasi: tenant default (id=%d) dibuat, data lama dipindahkan", tenant.ID)
		return nil
	})
}
