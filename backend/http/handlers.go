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

	"github.com/ghmer/rego-adventure/v2/backend/quest"

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

// revealCacheControl keeps revealed hints and solutions out of every cache:
// their delivery is part of the game's scoring semantics.
const revealCacheControl = "no-store"

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
	r.GET("/packs/:pack_id/quests/:quest_id/hints/:hint_id", h.GetQuestHint)
	r.GET("/packs/:pack_id/quests/:quest_id/solution", h.GetQuestSolution)
	r.GET("/packs/:pack_id/quests/:quest_id/support-modules", h.GetQuestSupportModules)
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

// GetPack retrieves the complete quest-pack for the chosen adventure. The
// response is a client-facing projection: solutions, hint texts, and hidden
// support modules are withheld and revealed only through dedicated endpoints.
func (h *Handler) GetPack(c *gin.Context) {
	packID := c.Param("pack_id")
	pack, found := h.questRepo.GetPack(packID)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quest pack not found"})
		return
	}
	// Add cache headers to reduce repeated serialization overhead
	c.Header("Cache-Control", apiCacheControl)
	c.JSON(http.StatusOK, pack.PublicView())
}

// questFromParams resolves the pack_id and quest_id path parameters to a
// quest, writing the corresponding error response and reporting failure.
func (h *Handler) questFromParams(c *gin.Context) (*quest.Quest, bool) {
	packID := c.Param("pack_id")
	questID, err := strconv.Atoi(c.Param("quest_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid quest ID"})
		return nil, false
	}
	q, found := h.questRepo.GetQuestByID(packID, questID)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quest not found"})
		return nil, false
	}
	return q, true
}

// GetTestPayload retrieves the configured tests for a given adventure and quest
func (h *Handler) GetTestPayload(c *gin.Context) {
	q, ok := h.questFromParams(c)
	if !ok {
		return
	}

	// Extract test payload data
	c.Header("Cache-Control", apiCacheControl)
	c.JSON(http.StatusOK, q.GetTestPayloads())
}

// GetQuestHint reveals a single hint by its 1-based ID. Hint texts are not
// part of the pack payload; the frontend asks for them one at a time.
func (h *Handler) GetQuestHint(c *gin.Context) {
	q, ok := h.questFromParams(c)
	if !ok {
		return
	}

	hintID, err := strconv.Atoi(c.Param("hint_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid hint ID"})
		return
	}

	hint, found := q.HintByID(hintID)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Hint not found"})
		return
	}

	c.Header("Cache-Control", revealCacheControl)
	c.JSON(http.StatusOK, gin.H{"hint": hint})
}

// GetQuestSolution reveals the quest's reference solution. Solutions are not
// part of the pack payload; the frontend asks for them explicitly.
func (h *Handler) GetQuestSolution(c *gin.Context) {
	q, ok := h.questFromParams(c)
	if !ok {
		return
	}

	if q.Solution == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Solution not found"})
		return
	}

	c.Header("Cache-Control", revealCacheControl)
	c.JSON(http.StatusOK, gin.H{"solution": q.Solution})
}

// GetQuestSupportModules reveals the quest's hidden support modules (e.g.
// the policy under test). The sources are not part of the pack payload; the
// frontend fetches them when the player opens the support modules modal.
func (h *Handler) GetQuestSupportModules(c *gin.Context) {
	q, ok := h.questFromParams(c)
	if !ok {
		return
	}

	if len(q.SupportModules) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Support modules not found"})
		return
	}

	c.Header("Cache-Control", revealCacheControl)
	c.JSON(http.StatusOK, gin.H{"support_modules": q.SupportModules})
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
		// A body beyond the MaxBytesReader limit is a size problem, not a
		// syntax problem; report it as 413 so clients can tell them apart.
		if _, oversized := errors.AsType[*http.MaxBytesError](err); oversized {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Request body too large"})
			return
		}
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
