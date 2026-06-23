package handlers

import (
	"strings"
	"time"
	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var jwtSecret = []byte(config.Env("JWT_SECRET", "wa-assistant-secret-change-me"))

func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
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
		token, err := jwt.Parse(auth[7:], func(t *jwt.Token) (interface{}, error) { return jwtSecret, nil })
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(401, gin.H{"error": "Invalid token"})
			return
		}
		claims := token.Claims.(jwt.MapClaims)
		c.Set("user_id", uint(claims["user_id"].(float64)))
		if tid, ok := claims["tenant_id"].(float64); ok && tid > 0 {
			c.Set("tenant_id", uint(tid))
		}
		if r, ok := claims["role"].(string); ok {
			c.Set("role", r)
		}
		if sa, ok := claims["is_super_admin"].(bool); ok {
			c.Set("is_super_admin", sa)
		}
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
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) { return jwtSecret, nil })
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
		"exp":            time.Now().Add(24 * time.Hour).Unix(),
	}
	if u.TenantID != nil {
		claims["tenant_id"] = *u.TenantID
	}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
	return token
}

func userResponse(u models.User) gin.H {
	return gin.H{
		"id":             u.ID,
		"name":           u.Name,
		"username":       u.Username,
		"email":          u.Email,
		"role":           u.Role,
		"is_super_admin": u.IsSuperAdmin,
		"tenant_id":      u.TenantID,
	}
}

func Login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}
	var user models.User
	if database.DB.Where("username = ?", req.Username).First(&user).Error != nil {
		c.JSON(401, gin.H{"error": "Username atau password salah"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)) != nil {
		c.JSON(401, gin.H{"error": "Username atau password salah"})
		return
	}
	c.JSON(200, gin.H{"token": issueToken(user), "user": userResponse(user)})
}

// Register membuat tenant baru (masa trial) + user owner + 1 agent default.
func Register(c *gin.Context) {
	var req struct {
		Name         string `json:"name"`
		BusinessName string `json:"business_name"`
		Username     string `json:"username"`
		Email        string `json:"email"`
		Password     string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(req.Email)
	if req.Username == "" || req.Password == "" {
		c.JSON(400, gin.H{"error": "Username dan password wajib diisi"})
		return
	}
	var exists int64
	database.DB.Model(&models.User{}).Where("username = ? OR (email <> '' AND email = ?)", req.Username, req.Email).Count(&exists)
	if exists > 0 {
		c.JSON(409, gin.H{"error": "Username atau email sudah terdaftar"})
		return
	}

	trialEnds := time.Now().Add(time.Duration(config.EnvInt("TRIAL_DAYS", 7)) * 24 * time.Hour)
	tenant := models.Tenant{
		Name:        firstNonEmpty(req.BusinessName, req.Name, req.Username),
		Status:      models.TenantTrial,
		TrialEndsAt: &trialEnds,
	}
	if err := database.DB.Create(&tenant).Error; err != nil {
		c.JSON(500, gin.H{"error": "Gagal membuat akun"})
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	user := models.User{
		TenantID: &tenant.ID,
		Name:     firstNonEmpty(req.Name, req.Username),
		Username: req.Username,
		Email:    req.Email,
		Password: string(hash),
		Role:     "owner",
	}
	if err := database.DB.Create(&user).Error; err != nil {
		c.JSON(500, gin.H{"error": "Gagal membuat user"})
		return
	}

	// Agent default supaya pelanggan langsung bisa scan QR saat trial.
	database.DB.Create(&models.Agent{TenantID: tenant.ID, Name: "CS Utama", Tone: "ramah"})

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
