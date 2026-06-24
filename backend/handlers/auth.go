package handlers

import (
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var jwtSecret = mustJWTSecret()

const (
	loginMaxPairFailures = 5
	loginMaxIPFailures   = 25
	loginGenericError    = "Login belum berhasil"
)

// Durasi yang bisa diatur via env (default sama seperti sebelumnya).
var (
	loginWindow       = time.Duration(config.EnvInt("LOGIN_WINDOW_MIN", 10)) * time.Minute
	loginLockDuration = time.Duration(config.EnvInt("LOGIN_LOCK_MIN", 10)) * time.Minute
	dummyLoginHash    = []byte("$2a$10$QEUEZpKWWd3xV1qX7Q9BceA5.CgHCMOaOy3MpF8M/OIWYK8MKioJm")
)

type loginThrottleKey struct {
	key string
	max int
}

func mustJWTSecret() []byte {
	secret := strings.TrimSpace(config.EnvRequired("JWT_SECRET"))
	lower := strings.ToLower(secret)
	if len(secret) < 32 || lower == "wa-assistant-secret-change-me" || lower == "ganti_dengan_string_acak_min_32_char" || lower == "changeme" || lower == "change-me" || lower == "secret" {
		log.Fatal("ERROR: JWT_SECRET tidak aman; set minimal 32 karakter random dan jangan gunakan default")
	}
	return []byte(secret)
}

// CORS membatasi origin lewat env CORS_ALLOWED_ORIGINS (daftar dipisah koma).
// Default "*" hanya untuk development; di production wajib set origin asli.
func CORS() gin.HandlerFunc {
	allowed := config.Env("CORS_ALLOWED_ORIGINS", "*")
	if strings.EqualFold(config.Env("APP_ENV", "development"), "production") && allowed == "*" {
		log.Fatal("ERROR: CORS_ALLOWED_ORIGINS tidak boleh '*' saat APP_ENV=production")
	}
	var origins []string
	if allowed != "*" {
		for _, o := range strings.Split(allowed, ",") {
			if o = strings.TrimSpace(o); o != "" {
				origins = append(origins, o)
			}
		}
	}
	return func(c *gin.Context) {
		if allowed == "*" {
			c.Header("Access-Control-Allow-Origin", "*")
		} else if origin := c.GetHeader("Origin"); origin != "" {
			for _, o := range origins {
				if origin == o {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Vary", "Origin")
					break
				}
			}
		}
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

// AuthMiddleware memvalidasi JWT dan menaruh identitas (user, tenant, role) ke context.
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			c.AbortWithStatusJSON(401, gin.H{"error": "Unauthorized"})
			return
		}
		token, err := jwt.Parse(auth[7:], func(t *jwt.Token) (interface{}, error) { return jwtSecret, nil }, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(401, gin.H{"error": "Invalid token"})
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(401, gin.H{"error": "Invalid token claims"})
			return
		}
		uidFloat, ok := claims["user_id"].(float64)
		if !ok || uidFloat <= 0 {
			c.AbortWithStatusJSON(401, gin.H{"error": "Invalid token claims"})
			return
		}

		var user models.User
		if err := database.DB.First(&user, uint(uidFloat)).Error; err != nil {
			c.AbortWithStatusJSON(401, gin.H{"error": "User tidak valid"})
			return
		}

		c.Set("user_id", user.ID)
		if user.TenantID != nil && *user.TenantID > 0 {
			c.Set("tenant_id", *user.TenantID)
		}
		c.Set("role", user.Role)
		c.Set("is_super_admin", user.IsSuperAdmin)
		c.Next()
	}
}

// AdminOnly membatasi endpoint hanya untuk super admin (operator platform).
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isSuperAdmin(c) {
			c.AbortWithStatusJSON(403, gin.H{"error": "Khusus admin platform"})
			return
		}
		c.Next()
	}
}

// currentTenantID = tenant pemilik request (0 untuk super admin tanpa tenant).
func currentTenantID(c *gin.Context) uint {
	if v, ok := c.Get("tenant_id"); ok {
		if id, ok := v.(uint); ok {
			return id
		}
	}
	return 0
}

func isSuperAdmin(c *gin.Context) bool {
	v, _ := c.Get("is_super_admin")
	b, _ := v.(bool)
	return b
}

// tenantFromToken memvalidasi JWT (string) & mengembalikan tenant_id.
// Dipakai endpoint media karena <img>/<a> tidak bisa mengirim header Authorization.
func tenantFromToken(tokenStr string) (uint, bool) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) { return jwtSecret, nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !token.Valid {
		return 0, false
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, false
	}
	if tid, ok := claims["tenant_id"].(float64); ok && tid > 0 {
		return uint(tid), true
	}
	return 0, false
}

// issueToken membuat JWT berisi identitas user (24 jam).
func issueToken(u models.User) string {
	claims := jwt.MapClaims{
		"user_id":        u.ID,
		"role":           u.Role,
		"is_super_admin": u.IsSuperAdmin,
		"exp":            time.Now().Add(time.Duration(config.EnvInt("TOKEN_TTL_HOURS", 24)) * time.Hour).Unix(),
	}
	if u.TenantID != nil {
		claims["tenant_id"] = *u.TenantID
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
	if err != nil {
		log.Printf("JWT issue token error: %v", err)
		return ""
	}
	return token
}

// issueMediaToken membuat JWT berumur pendek (30 menit) khusus akses media.
// Dipakai di URL <img>/<a> agar token utama (24 jam) tidak ikut bocor ke log/Referer.
func issueMediaToken(tenantID uint) string {
	claims := jwt.MapClaims{
		"tenant_id": tenantID,
		"scope":     "media",
		"exp":       time.Now().Add(time.Duration(config.EnvInt("MEDIA_TOKEN_TTL_MIN", 30)) * time.Minute).Unix(),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
	if err != nil {
		log.Printf("JWT issue media token error: %v", err)
		return ""
	}
	return token
}

func userResponse(u models.User) gin.H {
	return gin.H{
		"id":             u.ID,
		"name":           u.Name,
		"username":       u.Username,
		"email":          u.Email,
		"email_verified": u.EmailVerified,
		"role":           u.Role,
		"is_super_admin": u.IsSuperAdmin,
		"tenant_id":      u.TenantID,
	}
}

func loginThrottleKeys(ip, username string) []loginThrottleKey {
	username = strings.ToLower(strings.TrimSpace(username))
	keys := make([]loginThrottleKey, 0, 2)
	if ip != "" {
		keys = append(keys, loginThrottleKey{key: "ip:" + ip, max: loginMaxIPFailures})
	}
	if ip != "" && username != "" {
		keys = append(keys, loginThrottleKey{key: "pair:" + ip + ":" + username, max: loginMaxPairFailures})
	}
	return keys
}

func checkLoginThrottle(ip, username string, now time.Time) time.Duration {
	var wait time.Duration
	for _, k := range loginThrottleKeys(ip, username) {
		var entry models.LoginThrottle
		err := database.DB.Where("`key` = ?", k.key).First(&entry).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			log.Printf("login throttle read error (%s): %v", k.key, err)
			continue
		}
		expired := now.Sub(entry.FirstSeen) > loginWindow && now.After(entry.LockedUntil)
		if expired {
			_ = database.DB.Delete(&entry).Error
			continue
		}
		if now.Before(entry.LockedUntil) {
			if w := entry.LockedUntil.Sub(now); w > wait {
				wait = w
			}
		}
	}
	return wait
}

func recordLoginFailure(ip, username string, now time.Time) {
	for _, k := range loginThrottleKeys(ip, username) {
		if err := database.DB.Transaction(func(tx *gorm.DB) error {
			var entry models.LoginThrottle
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("`key` = ?", k.key).First(&entry).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				entry = models.LoginThrottle{Key: k.key, FirstSeen: now}
			} else if err != nil {
				return err
			} else if now.Sub(entry.FirstSeen) > loginWindow && now.After(entry.LockedUntil) {
				entry.Failures = 0
				entry.FirstSeen = now
				entry.LockedUntil = time.Time{}
			}

			entry.Failures++
			if entry.Failures >= k.max {
				entry.LockedUntil = now.Add(loginLockDuration)
			}
			if entry.ID == 0 {
				return tx.Create(&entry).Error
			}
			return tx.Save(&entry).Error
		}); err != nil {
			log.Printf("login throttle write error (%s): %v", k.key, err)
		}
	}
}

func clearLoginPairThrottle(ip, username string) {
	username = strings.ToLower(strings.TrimSpace(username))
	if ip == "" || username == "" {
		return
	}
	_ = database.DB.Where("`key` = ?", "pair:"+ip+":"+username).Delete(&models.LoginThrottle{}).Error
}

// StartLoginThrottleSweeper menghapus entry throttle yang sudah kadaluarsa secara berkala,
// supaya tabel tidak tumbuh tanpa batas saat diserang banyak IP/username unik (botnet).
func StartLoginThrottleSweeper() {
	go func() {
		cleanupLoginThrottle()
		t := time.NewTicker(loginWindow)
		defer t.Stop()
		for range t.C {
			cleanupLoginThrottle()
		}
	}()
}

func cleanupLoginThrottle() {
	now := time.Now()
	cutoff := now.Add(-loginWindow)
	if err := database.DB.Where("first_seen < ? AND locked_until < ?", cutoff, now).Delete(&models.LoginThrottle{}).Error; err != nil {
		log.Printf("login throttle cleanup error: %v", err)
	}
}

func throttleLogin(c *gin.Context, wait time.Duration) {
	seconds := int(wait.Round(time.Second).Seconds())
	if seconds < 1 {
		seconds = 1
	}
	c.Header("Retry-After", strconv.Itoa(seconds))
	c.JSON(429, gin.H{"error": "Terlalu banyak percobaan. Coba lagi nanti."})
}

func Login(c *gin.Context) {
	start := time.Now()
	var req struct {
		Username  string `json:"username"`
		Password  string `json:"password"`
		Turnstile string `json:"turnstile"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": loginGenericError})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	ip := c.ClientIP()
	if wait := checkLoginThrottle(ip, req.Username, start); wait > 0 {
		throttleLogin(c, wait)
		return
	}
	if req.Username == "" || req.Password == "" {
		c.JSON(400, gin.H{"error": loginGenericError})
		return
	}

	var user models.User
	passwordHash := dummyLoginHash
	foundUser := false
	if err := database.DB.Where("username = ?", req.Username).First(&user).Error; err == nil {
		foundUser = true
		passwordHash = []byte(user.Password)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("Login DB lookup error: %v", err)
		c.JSON(500, gin.H{"error": loginGenericError})
		return
	}
	passwordOK := bcrypt.CompareHashAndPassword(passwordHash, []byte(req.Password)) == nil
	if !foundUser || !passwordOK {
		recordLoginFailure(ip, req.Username, start)
		c.JSON(401, gin.H{"error": loginGenericError})
		return
	}

	clearLoginPairThrottle(ip, req.Username)
	c.JSON(200, gin.H{"token": issueToken(user), "user": userResponse(user)})
}

// Register membuat tenant baru (masa trial) + user owner + 1 agent default.
func Register(c *gin.Context) {
	var req struct {
		Name         string `json:"name"`
		BusinessName string `json:"business_name"`
		Phone        string `json:"phone"`
		Email        string `json:"email"`
		Password     string `json:"password"`
		Turnstile    string `json:"turnstile"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}
	if !verifyTurnstile(req.Turnstile) {
		c.JSON(400, gin.H{"error": "Verifikasi keamanan gagal, coba lagi"})
		return
	}
	req.Phone = services.NormalizePhone(req.Phone)
	req.Email = strings.TrimSpace(req.Email)
	username := req.Email // Username = email (auto)
	if username == "" || req.Password == "" {
		c.JSON(400, gin.H{"error": "Email dan password wajib diisi"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(400, gin.H{"error": "Password minimal 8 karakter"})
		return
	}
	var exists int64
	if err := database.DB.Model(&models.User{}).Where("username = ? OR email = ?", username, req.Email).Count(&exists).Error; err != nil {
		log.Printf("Register duplicate check DB error: %v", err)
		c.JSON(500, gin.H{"error": "Gagal membuat akun"})
		return
	}
	if exists > 0 {
		c.JSON(409, gin.H{"error": "Email sudah terdaftar"})
		return
	}

	trialEnds := time.Now().Add(time.Duration(config.EnvInt("TRIAL_DAYS", 7)) * 24 * time.Hour)
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Register password hash error: %v", err)
		c.JSON(500, gin.H{"error": "Gagal membuat akun"})
		return
	}

	var user models.User
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		tenant := models.Tenant{
			Name:        firstNonEmpty(req.BusinessName, req.Name, req.Email),
			Status:      models.TenantTrial,
			TrialEndsAt: &trialEnds,
		}
		if err := tx.Create(&tenant).Error; err != nil {
			return err
		}

		user = models.User{
			TenantID:         &tenant.ID,
			Name:             firstNonEmpty(req.Name, req.Email),
			Username:         username,
			Email:            req.Email,
			Phone:            req.Phone,
			Password:         string(passwordHash),
			Role:             "owner",
			EmailVerifyToken: generateVerifyToken(),
		}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}

		// Agent default supaya pelanggan langsung bisa scan QR saat trial.
		if err := tx.Create(&models.Agent{TenantID: tenant.ID, Name: "CS Utama", Tone: "ramah"}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		log.Printf("Register transaction error: %v", err)
		c.JSON(500, gin.H{"error": "Gagal membuat akun"})
		return
	}

	// Kirim email verifikasi (async — jangan block response)
	go func() {
		verifyURL := config.Env("APP_URL", "http://103.181.143.107:8080") + "/api/verify-email?token=" + user.EmailVerifyToken
		err := services.SendEmail(user.Email, "Verifikasi Email ChatLoop",
			`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#16a34a">Verifikasi Email</h2><p>Terima kasih sudah mendaftar di ChatLoop! Klik tombol di bawah untuk mengaktifkan akun kamu:</p><a href="`+verifyURL+`" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Verifikasi Email</a><p style="color:#6b7280;font-size:14px;margin-top:16px">Kalau kamu tidak mendaftar, abaikan email ini.</p></div>`)
		if err != nil {
			log.Printf("Gagal kirim email verifikasi ke %s: %v", user.Email, err)
		}
	}()

	c.JSON(201, gin.H{"token": issueToken(user), "user": userResponse(user)})
}

func Me(c *gin.Context) {
	var user models.User
	if database.DB.First(&user, c.GetUint("user_id")).Error != nil {
		c.JSON(404, gin.H{"error": "User tidak ditemukan"})
		return
	}
	resp := userResponse(user)
	if user.TenantID != nil {
		var t models.Tenant
		if database.DB.Preload("Plan").First(&t, *user.TenantID).Error == nil {
			resp["tenant"] = t
		}
	}
	c.JSON(200, resp)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
