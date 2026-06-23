package handlers

import (
	"strings"

	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

func ChatHistory(c *gin.Context) {
	var chats []models.ChatHistory
	database.DB.Where("agent_id = ?", currentAgentID(c)).Order("created_at desc").Limit(50).Find(&chats)
	c.JSON(200, gin.H{"data": chats})
}

// Settings = persona & tone milik agent (back-compat: tanpa :id pakai agent default 1).
func GetSettings(c *gin.Context) {
	var a models.Agent
	database.DB.First(&a, currentAgentID(c))
	c.JSON(200, gin.H{"data": gin.H{"system_prompt": a.SystemPrompt, "tone": a.Tone, "ai_model": "deepseek-v4-pro"}})
}

func UpdateSettings(c *gin.Context) {
	var req struct {
		SystemPrompt string `json:"system_prompt"`
		Tone         string `json:"tone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	var a models.Agent
	if database.DB.First(&a, currentAgentID(c)).Error != nil {
		c.JSON(404, gin.H{"error": "Agent tidak ditemukan"})
		return
	}
	a.SystemPrompt = req.SystemPrompt
	if req.Tone != "" {
		a.Tone = req.Tone
	}
	database.DB.Save(&a)
	c.JSON(200, gin.H{"data": gin.H{"system_prompt": a.SystemPrompt, "tone": a.Tone}})
}

func ListKnowledge(c *gin.Context) {
	var kb []models.Knowledge
	database.DB.Where("agent_id = ?", currentAgentID(c)).Order("created_at desc").Find(&kb)
	c.JSON(200, gin.H{"data": kb})
}

func CreateKnowledge(c *gin.Context) {
	aid, ok := resolveAgent(c)
	if !ok {
		return
	}
	var req struct {
		Question string `json:"question"`
		Answer   string `json:"answer"`
		Tags     string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if strings.TrimSpace(req.Question) == "" || strings.TrimSpace(req.Answer) == "" {
		c.JSON(400, gin.H{"error": "Pertanyaan & jawaban wajib diisi"})
		return
	}
	k := models.Knowledge{AgentID: aid, Question: req.Question, Answer: req.Answer, Tags: req.Tags}
	database.DB.Create(&k)
	services.IndexKnowledge(&k)
	c.JSON(201, gin.H{"data": k})
}

func UpdateKnowledge(c *gin.Context) {
	var k models.Knowledge
	if database.DB.Where("agent_id = ?", currentAgentID(c)).First(&k, c.Param("kid")).Error != nil {
		c.JSON(404, gin.H{"error": "Not found"})
		return
	}
	var req struct {
		Question string `json:"question"`
		Answer   string `json:"answer"`
		Tags     string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format data tidak valid"})
		return
	}
	if req.Question != "" {
		k.Question = req.Question
	}
	if req.Answer != "" {
		k.Answer = req.Answer
	}
	if req.Tags != "" {
		k.Tags = req.Tags
	}
	database.DB.Save(&k)
	services.IndexKnowledge(&k) // re-embed karena isi berubah
	c.JSON(200, gin.H{"data": k})
}

func DeleteKnowledge(c *gin.Context) {
	aid := currentAgentID(c)
	database.DB.Where("agent_id = ?", aid).Delete(&models.Knowledge{}, c.Param("kid"))
	services.InvalidateKB(aid) // refresh cache memori
	c.JSON(200, gin.H{"message": "Deleted"})
}
