package main

import (
	"log"
	"time"
	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/handlers"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load()
	config.Load()
	database.Init()
	services.InitAI()
	services.InitEmbedding()
	go services.BackfillEmbeddings()
	services.InitWA(config.Env("DB_PATH", "./wa-assistant.db"))
	services.SetHandlers(handlers.OnWAMessage, handlers.OnDeviceLinked)

	// Sambungkan ulang semua agent yang sudah ter-link.
	go handlers.StartAgents()

	// Cek langganan tiap jam: expire yang habis & suspend sesi WA tenant non-aktif.
	handlers.StartSubscriptionSweep(time.Hour)

	r := gin.Default()
	r.Use(handlers.CORS())

	api := r.Group("/api")
	{
		api.POST("/login", handlers.Login)
		api.POST("/register", handlers.Register)
		api.GET("/plans", handlers.PublicPlans)
		api.POST("/billing/tripay/callback", handlers.TripayCallback) // webhook Tripay (signature diverifikasi)
		api.GET("/agents/:id/media/:cid", handlers.ServeMedia)        // file media (auth via ?token=)
		api.GET("/me", handlers.AuthMiddleware(), handlers.Me)

		// Panel operator platform (super admin).
		admin := api.Group("/admin", handlers.AuthMiddleware(), handlers.AdminOnly())
		{
			admin.GET("/stats", handlers.AdminStats)
			admin.GET("/tenants", handlers.AdminTenants)
			admin.PUT("/tenants/:id", handlers.AdminUpdateTenant)
			admin.GET("/plans", handlers.AdminPlans)
			admin.POST("/plans", handlers.AdminCreatePlan)
			admin.PUT("/plans/:id", handlers.AdminUpdatePlan)
			admin.DELETE("/plans/:id", handlers.AdminDeletePlan)
		}

		auth := api.Group("", handlers.AuthMiddleware())
		{
			auth.GET("/usage", handlers.TenantUsage)
			auth.GET("/billing/channels", handlers.BillingChannels)
			auth.POST("/billing/checkout", handlers.Checkout)
			auth.GET("/billing/invoices", handlers.Invoices)
			// Endpoint lama (back-compat) -> beroperasi pada agent default (id 1).
			auth.GET("/wa/status", handlers.GetNumberStatus)
			auth.POST("/wa/connect", handlers.ConnectNumber)
			auth.POST("/wa/logout", handlers.LogoutNumber)
			auth.GET("/handoffs", handlers.ListHandoffs)
			auth.DELETE("/handoffs/:sender", handlers.ResumeHandoff)
			auth.GET("/chat-history", handlers.ChatHistory)
			auth.GET("/settings", handlers.GetSettings)
			auth.PUT("/settings", handlers.UpdateSettings)
			auth.GET("/knowledge", handlers.ListKnowledge)
			auth.POST("/knowledge", handlers.CreateKnowledge)
			auth.POST("/knowledge/generate", handlers.GenerateKnowledge)
			auth.POST("/knowledge/import", handlers.ImportKnowledge)
			auth.PUT("/knowledge/:kid", handlers.UpdateKnowledge)
			auth.DELETE("/knowledge/:kid", handlers.DeleteKnowledge)

			// Multi-agent (CS).
			auth.GET("/agents", handlers.ListAgents)
			auth.GET("/agents-status", handlers.AgentStatuses)
			auth.POST("/agents", handlers.CreateAgent)
			auth.PUT("/agents/:id", handlers.UpdateAgent)
			auth.DELETE("/agents/:id", handlers.DeleteAgent)
			auth.GET("/agents/:id/wa/status", handlers.GetNumberStatus)
			auth.POST("/agents/:id/wa/connect", handlers.ConnectNumber)
			auth.POST("/agents/:id/wa/logout", handlers.LogoutNumber)
			auth.GET("/agents/:id/handoffs", handlers.ListHandoffs)
			auth.DELETE("/agents/:id/handoffs/:sender", handlers.ResumeHandoff)
			auth.GET("/agents/:id/chat-history", handlers.ChatHistory)
			auth.GET("/agents/:id/settings", handlers.GetSettings)
			auth.PUT("/agents/:id/settings", handlers.UpdateSettings)
			auth.GET("/agents/:id/knowledge", handlers.ListKnowledge)
			auth.POST("/agents/:id/knowledge", handlers.CreateKnowledge)
			auth.POST("/agents/:id/knowledge/generate", handlers.GenerateKnowledge)
			auth.POST("/agents/:id/knowledge/import", handlers.ImportKnowledge)
			auth.PUT("/agents/:id/knowledge/:kid", handlers.UpdateKnowledge)
			auth.DELETE("/agents/:id/knowledge/:kid", handlers.DeleteKnowledge)

			// Fitur jualan: simulator, analitik, inbox.
			auth.POST("/agents/:id/test-chat", handlers.TestChat)
			auth.GET("/agents/:id/analytics", handlers.AgentAnalytics)
			auth.GET("/agents/:id/contacts", handlers.InboxContacts)
			auth.GET("/agents/:id/conversation", handlers.InboxConversation)
			auth.POST("/agents/:id/send", handlers.InboxSend)
			auth.POST("/agents/:id/send-media", handlers.InboxSendMedia)
			auth.POST("/agents/:id/check-numbers", handlers.CheckNumbers)
			auth.POST("/agents/:id/broadcast", handlers.CreateBroadcast)
			auth.GET("/agents/:id/broadcasts", handlers.ListBroadcasts)
		}
	}

	port := config.Env("PORT", "3030")
	log.Printf("WA Assistant server running on :%s", port)
	log.Fatal(r.Run(":" + port))
}
