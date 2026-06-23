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
	services.SetLabelHandlers(handlers.OnLabelEdit, handlers.OnLabelAssoc)
	services.SetConnectedHandler(handlers.OnAgentConnected)

	// Sambungkan ulang semua agent yang sudah ter-link.
	go handlers.StartAgents()
	// Watchdog: pantau & sambungkan ulang sesi WA yang terputus diam-diam (tiap 90 detik).
	services.StartReconnectWatchdog(90 * time.Second)

	// Lanjutkan broadcast yang sempat terhenti saat server mati; tandai jadwal yang nyangkut.
	go handlers.ResumeBroadcasts()
	handlers.CleanupStuckSchedules()

	// Scheduler pesan terjadwal + pembersihan media lama.
	handlers.StartScheduler()
	handlers.StartMediaCleanup(config.EnvInt("MEDIA_RETENTION_DAYS", 30))

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
			auth.GET("/agents/:id/auto-replies", handlers.ListAutoReplies)
			auth.POST("/agents/:id/auto-replies", handlers.CreateAutoReply)
			auth.PUT("/agents/:id/auto-replies/:rid", handlers.UpdateAutoReply)
			auth.DELETE("/agents/:id/auto-replies/:rid", handlers.DeleteAutoReply)
			auth.GET("/agents/:id/templates", handlers.ListTemplates)
			auth.POST("/agents/:id/templates", handlers.CreateTemplate)
			auth.PUT("/agents/:id/templates/:tid", handlers.UpdateTemplate)
			auth.DELETE("/agents/:id/templates/:tid", handlers.DeleteTemplate)
			auth.GET("/agents/:id/crm/contacts", handlers.ListSavedContacts)
			auth.POST("/agents/:id/crm/contacts", handlers.CreateSavedContact)
			auth.PUT("/agents/:id/crm/contacts/:cid", handlers.UpdateSavedContact)
			auth.DELETE("/agents/:id/crm/contacts/:cid", handlers.DeleteSavedContact)
			auth.POST("/agents/:id/check-numbers", handlers.CheckNumbers)
			auth.POST("/agents/:id/broadcast", handlers.CreateBroadcast)
			auth.GET("/agents/:id/broadcasts", handlers.ListBroadcasts)
			auth.GET("/agents/:id/broadcasts/:bid", handlers.BroadcastDetail)
			auth.GET("/agents/:id/chat-contacts", handlers.ChatContacts)
			auth.GET("/agents/:id/wa-contacts", handlers.WAContacts)
			auth.GET("/agents/:id/groups", handlers.Groups)
			auth.GET("/agents/:id/group-members", handlers.GroupMembers)
			auth.GET("/agents/:id/labels", handlers.Labels)
			auth.GET("/agents/:id/label-contacts", handlers.LabelContacts)
			auth.POST("/agents/:id/schedule", handlers.CreateSchedule)
			auth.GET("/agents/:id/schedules", handlers.ListSchedules)
			auth.DELETE("/agents/:id/schedule/:sid", handlers.CancelSchedule)
		}
	}

	port := config.Env("PORT", "3030")
	log.Printf("WA Assistant server running on :%s", port)
	log.Fatal(r.Run(":" + port))
}
