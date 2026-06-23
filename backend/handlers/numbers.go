package handlers

import (
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

func GetNumberStatus(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	m := services.WA(id)
	number, name := m.GetInfo()
	c.JSON(200, gin.H{"status": m.GetStatus(), "qr": m.GetQR(), "qr_ttl": m.GetQRTTL(), "number": number, "name": name})
}

func ConnectNumber(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	// Tolak konek jika langganan tenant tidak aktif (trial habis / expired / suspended).
	if !tenantWAActive(currentTenantID(c)) {
		c.JSON(403, gin.H{"error": "Langganan tidak aktif. Silakan perpanjang untuk menghubungkan nomor."})
		return
	}
	var a models.Agent
	database.DB.First(&a, id)
	status, err := services.WA(id).Connect(a.DeviceJID)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"status": status})
}

// LogoutNumber memutus & menghapus sesi WhatsApp agent, lalu mengosongkan device tersimpan
// supaya tidak auto-reconnect ke sesi lama. Untuk menyambung lagi perlu scan QR.
func LogoutNumber(c *gin.Context) {
	id, ok := resolveAgent(c)
	if !ok {
		return
	}
	_ = services.WA(id).Logout()
	var a models.Agent
	if database.DB.First(&a, id).Error == nil {
		a.DeviceJID = ""
		a.Number = ""
		database.DB.Save(&a)
	}
	c.JSON(200, gin.H{"status": "disconnected"})
}
