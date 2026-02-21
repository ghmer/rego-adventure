/*
   Copyright 2025 Mario Enrico Ragucci

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

package http

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/ghmer/rego-adventure/backend/quest"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	questRepo *quest.QuestRepository
	verifier  *quest.Verifier
}

func NewHandler(questRepo *quest.QuestRepository, verifier *quest.Verifier) *Handler {
	return &Handler{
		questRepo: questRepo,
		verifier:  verifier,
	}
}

func (h *Handler) RegisterRoutes(r gin.IRouter) {
	r.GET("/packs", h.GetPacks)
	r.GET("/packs/:pack_id", h.GetPack)
	r.GET("/packs/:pack_id/quests/:quest_id/test-payload", h.GetTestPayload)
	r.POST("/verify", h.VerifySolution)
}

// GetPacks returns an array of info objects. Used on the frontpage to list all available adventures
func (h *Handler) GetPacks(c *gin.Context) {
	packs := h.questRepo.GetAllPacks()
	// Return simplified list for selection
	simplified := make([]gin.H, 0, len(packs))
	for _, p := range packs {
		simplified = append(simplified, gin.H{
			"id":          p.ID,
			"title":       p.Meta.Title,
			"description": p.Meta.Description,
			"genre":       p.Meta.Genre,
		})
	}
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, simplified)
}

// GetPack retrieves the complete quest-pack for the chosen adventure
func (h *Handler) GetPack(c *gin.Context) {
	packID := c.Param("pack_id")
	pack, found := h.questRepo.GetPack(packID)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quest pack not found"})
		return
	}
	// Add cache headers to reduce repeated serialization overhead
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, pack)
}

// GetTestPayload retrieves the configured tests for a given adventure and quest
func (h *Handler) GetTestPayload(c *gin.Context) {
	packID := c.Param("pack_id")
	questID := c.Param("quest_id")

	// Convert questID to int
	var qid int
	if _, err := fmt.Sscanf(questID, "%d", &qid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid quest ID"})
		return
	}

	quest, found := h.questRepo.GetQuestByID(packID, qid)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quest not found"})
		return
	}

	// Extract test payload data
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, quest.GetTestPayloads())
}

type VerifyRequest struct {
	PackID   string `json:"pack_id"`
	QuestID  int    `json:"quest_id"`
	RegoCode string `json:"rego_code"`
}

// VerifySolution evaluates the given input against the defined test scenarios
func (h *Handler) VerifySolution(c *gin.Context) {
	var req VerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Warn("error binding JSON", "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	quest, found := h.questRepo.GetQuestByID(req.PackID, req.QuestID)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quest not found"})
		return
	}

	result, err := h.verifier.Verify(c.Request.Context(), quest, req.RegoCode)
	if err != nil {
		// Verify currently handles all errors (compilation, runtime) by returning a result with Error field set.
		// The error return value is always nil in the current implementation.
		// This path would only be reached if Verify's implementation changes to return actual Go errors.
		slog.Error("error verifying solution", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, result)
}

// HealthCheck returns a simple health status response
func (h *Handler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":      "ok",
		"quest-packs": h.questRepo.GetNumberOfPacks(),
		"timestamp":   time.Now().Unix(),
	})
}
