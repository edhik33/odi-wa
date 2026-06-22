package main

import (
	"log"
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

	r := gin.Default()
	r.Use(handlers.CORS())

	api := r.Group("/api")
	{
		api.POST("/login", handlers.Login)
		api.GET("/me", handlers.AuthMiddleware(), handlers.Me)

		auth := api.Group("", handlers.AuthMiddleware())
		{
			// Endpoint lama (back-compat) -> beroperasi pada agent default (id 1).
			auth.GET("/wa/status", handlers.GetNumberStatus)
			auth.POST("/wa/connect", handlers.ConnectNumber)
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
			auth.GET("/agents/:id/chat-history", handlers.ChatHistory)
			auth.GET("/agents/:id/settings", handlers.GetSettings)
			auth.PUT("/agents/:id/settings", handlers.UpdateSettings)
			auth.GET("/agents/:id/knowledge", handlers.ListKnowledge)
			auth.POST("/agents/:id/knowledge", handlers.CreateKnowledge)
			auth.POST("/agents/:id/knowledge/generate", handlers.GenerateKnowledge)
			auth.POST("/agents/:id/knowledge/import", handlers.ImportKnowledge)
			auth.PUT("/agents/:id/knowledge/:kid", handlers.UpdateKnowledge)
			auth.DELETE("/agents/:id/knowledge/:kid", handlers.DeleteKnowledge)
		}
	}

	port := config.Env("PORT", "3030")
	log.Printf("WA Assistant server running on :%s", port)
	log.Fatal(r.Run(":" + port))
}
