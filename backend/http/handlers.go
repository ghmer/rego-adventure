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

// Package http contains HTTP server setup and routing logic.
package http

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/ghmer/rego-adventure/backend/quest"

	"github.com/gin-gonic/gin"
)

// verifyTimeout bounds a single solution verification. Well-formed quest
// policies evaluate in milliseconds; the timeout only catches pathological
// policies (unbounded loops, oversized comprehensions).
var verifyTimeout = 3 * time.Second

// timeoutMessage explains to players why verification stopped early.
const timeoutMessage = "Your policy took too long to evaluate. " +
	"Check for unbounded loops, very large comprehensions, or expensive built-in functions."

// verifyErrorResponse maps a verifier error to an HTTP status and JSON body.
// A policy exceeding the evaluation budget is a client-side problem and is
// reported as 408 instead of a generic server error.
func verifyErrorResponse(err error) (int, gin.H) {
	if errors.Is(err, context.DeadlineExceeded) {
		return http.StatusRequestTimeout, gin.H{
			"error":   "Verification timed out",
			"message": timeoutMessage,
		}
	}
	return http.StatusInternalServerError, gin.H{"error": "Internal server error"}
}

// apiCacheControl prevents shared caches from storing responses that may be
// authenticated; per-user (browser) caching is still allowed.
const apiCacheControl = "private, max-age=300"

// Handler handles HTTP requests for quest operations.
type Handler struct {
	questRepo *quest.QuestRepository
	verifier  *quest.Verifier
}

// NewHandler creates a new quest handler with the given repository and verifier.
func NewHandler(questRepo *quest.QuestRepository, verifier *quest.Verifier) *Handler {
	return &Handler{
		questRepo: questRepo,
		verifier:  verifier,
	}
}

// RegisterRoutes registers all quest-related routes.
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
	c.Header("Cache-Control", apiCacheControl)
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
	c.Header("Cache-Control", apiCacheControl)
	c.JSON(http.StatusOK, pack)
}

// GetTestPayload retrieves the configured tests for a given adventure and quest
func (h *Handler) GetTestPayload(c *gin.Context) {
	packID := c.Param("pack_id")
	questID := c.Param("quest_id")

	// Convert questID to int
	qid, err := strconv.Atoi(questID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid quest ID"})
		return
	}

	quest, found := h.questRepo.GetQuestByID(packID, qid)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quest not found"})
		return
	}

	// Extract test payload data
	c.Header("Cache-Control", apiCacheControl)
	c.JSON(http.StatusOK, quest.GetTestPayloads())
}

// VerifyRequest contains the data needed to verify a quest solution.
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

	q, found := h.questRepo.GetQuestByID(req.PackID, req.QuestID)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quest not found"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), verifyTimeout)
	defer cancel()

	result, err := h.verifier.Verify(ctx, q, req.RegoCode)
	if err != nil {
		slog.Error("error verifying solution", "error", err)
		status, body := verifyErrorResponse(err)
		c.JSON(status, body)
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
