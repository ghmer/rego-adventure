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
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ghmer/rego-adventure/v2/backend/quest"
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ==================== Test Helpers ====================

// newTestRouter creates a gin router with handler routes registered.
func newTestRouter(repo *quest.QuestRepository) *gin.Engine {
	verifier := quest.NewVerifier()
	handler := NewHandler(repo, verifier)

	router := gin.New()
	handler.RegisterRoutes(router)
	router.GET("/health", handler.HealthCheck)
	return router
}

// loadHandlerTestPack marshals and loads a minimal valid quest pack into repo.
func loadHandlerTestPack(t *testing.T, repo *quest.QuestRepository, packID string) {
	t.Helper()
	pack := quest.QuestPack{
		ID: packID,
		Meta: quest.MetaData{
			Title:       "Test Pack",
			Description: "A test pack description",
			Genre:       "fantasy",
		},
		UILabels: quest.UILabels{
			GrimoireTitle:          "The Grimoire",
			HintButton:             "Get Hint",
			VerifyButton:           "Verify",
			MessageSuccess:         "Well done!",
			MessageFailure:         "Try again!",
			PerfectScoreMessage:    "Perfect score!",
			PerfectScoreButtonText: "Continue",
			BeginAdventureButton:   "Begin",
		},
		Prologue: []string{"Welcome, adventurer!"},
		Epilogue: []string{"Congratulations!"},
		Quests: []quest.Quest{
			{
				ID:              1,
				Title:           "Quest 1",
				DescriptionTask: "Write a Rego policy",
				DescriptionLore: []string{"In the land of OPA..."},
				Query:           "data.quest.allow",
				Hints:           []string{"Think about roles.", "Compare the user string."},
				Solution:        "package quest\n\ndefault allow = false\n\nallow if input.user == \"admin\"\n",
				SupportModules:  []string{"package helpers\n\nimport rego.v1\n\nhelper if input.user != \"\"\n"},
				Manual: quest.Manual{
					DataModel:    `{"type": "object"}`,
					RegoSnippet:  "package quest",
					ExternalLink: "https://www.openpolicyagent.org/docs",
				},
				Tests: []quest.TestCase{
					{
						ID:              1,
						ExpectedOutcome: true,
						Payload: quest.TestPayload{
							Input: map[string]any{"user": "admin"},
						},
					},
					{
						ID:              2,
						ExpectedOutcome: false,
						Payload: quest.TestPayload{
							Input: map[string]any{"user": "guest"},
						},
					},
				},
			},
			{
				ID:              2,
				Title:           "Quest 2",
				DescriptionTask: "Write another Rego policy",
				DescriptionLore: []string{"Beyond the mountains..."},
				Query:           "data.quest.allow",
				Manual: quest.Manual{
					DataModel:    `{"type": "object"}`,
					RegoSnippet:  "package quest",
					ExternalLink: "https://www.openpolicyagent.org/docs",
				},
				Tests: []quest.TestCase{
					{
						ID:              1,
						ExpectedOutcome: true,
						Payload: quest.TestPayload{
							Input: map[string]any{"user": "root"},
						},
					},
				},
			},
		},
	}

	data, err := json.Marshal(pack)
	if err != nil {
		t.Fatalf("failed to marshal test pack: %v", err)
	}
	if err := repo.LoadPack(packID, data); err != nil {
		t.Fatalf("failed to load test pack: %v", err)
	}
}

// ==================== GetPacks Tests ====================

func TestGetPacks_EmptyRepository(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty list, got %d items", len(result))
	}
}

func TestGetPacks_WithPacks(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	loadHandlerTestPack(t, repo, "scifi")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if len(result) != 2 {
		t.Errorf("expected 2 packs, got %d", len(result))
	}

	// Verify required fields are present in each item
	for _, item := range result {
		for _, field := range []string{"id", "title", "description", "genre"} {
			if _, ok := item[field]; !ok {
				t.Errorf("pack item missing field %q", field)
			}
		}
	}
}

func TestGetPacks_HasCacheControlHeader(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs", nil)
	router.ServeHTTP(w, req)

	cc := w.Header().Get("Cache-Control")
	if cc == "" {
		t.Error("expected Cache-Control header to be set")
	}
}

// ==================== GetPack Tests ====================

func TestGetPack_Found(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["id"] != "fantasy" {
		t.Errorf("expected pack id 'fantasy', got %v", result["id"])
	}
}

func TestGetPack_NotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/nonexistent", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetPack_HasCacheControlHeader(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy", nil)
	router.ServeHTTP(w, req)

	if w.Header().Get("Cache-Control") == "" {
		t.Error("expected Cache-Control header to be set")
	}
}

// ==================== GetTestPayload Tests ====================

func TestGetTestPayload_Valid(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy/quests/1/test-payload", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if len(result) != 2 {
		t.Errorf("expected 2 test payloads, got %d", len(result))
	}
}

func TestGetTestPayload_QuestNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy/quests/999/test-payload", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetTestPayload_PackNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/nonexistent/quests/1/test-payload", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetTestPayload_InvalidQuestID(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/notanumber/test-payload", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestGetTestPayload_HasCacheControlHeader(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy/quests/1/test-payload", nil)
	router.ServeHTTP(w, req)

	if w.Header().Get("Cache-Control") == "" {
		t.Error("expected Cache-Control header to be set")
	}
}

// ==================== Pack Secret Gating Tests ====================

func TestGetPack_WithholdsSecrets(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	// The bulk pack payload must not contain solution, hint texts, or
	// hidden support modules - these are revealed by dedicated endpoints.
	body := w.Body.String()
	for _, secret := range []string{"Think about roles", "Compare the user string", "default allow", "package helpers"} {
		if strings.Contains(body, secret) {
			t.Errorf("pack payload leaks secret %q", secret)
		}
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	quests, ok := result["quests"].([]any)
	if !ok || len(quests) != 2 {
		t.Fatalf("expected 2 quests, got %v", result["quests"])
	}
	first, ok := quests[0].(map[string]any)
	if !ok {
		t.Fatalf("expected quest entry to be an object, got %T", quests[0])
	}
	for _, key := range []string{"solution", "hints", "support_modules"} {
		if _, exists := first[key]; exists {
			t.Errorf("quest payload must not contain key %q", key)
		}
	}
	if count, ok := first["hints_count"].(float64); !ok || int(count) != 2 {
		t.Errorf("expected hints_count=2, got %v", first["hints_count"])
	}
	if first["has_solution"] != true {
		t.Errorf("expected has_solution=true, got %v", first["has_solution"])
	}

	second, ok := quests[1].(map[string]any)
	if !ok {
		t.Fatalf("expected quest entry to be an object, got %T", quests[1])
	}
	if count, ok := second["hints_count"].(float64); !ok || int(count) != 0 {
		t.Errorf("expected hints_count=0, got %v", second["hints_count"])
	}
	if second["has_solution"] != false {
		t.Errorf("expected has_solution=false, got %v", second["has_solution"])
	}
}

// ==================== GetQuestHint Tests ====================

func TestGetQuestHint_Valid(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy/quests/1/hints/1", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["hint"] != "Think about roles." {
		t.Errorf("expected first hint text, got %v", result["hint"])
	}
}

func TestGetQuestHint_SecondHint(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/packs/fantasy/quests/1/hints/2", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["hint"] != "Compare the user string." {
		t.Errorf("expected second hint text, got %v", result["hint"])
	}
}

func TestGetQuestHint_OutOfRange(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	for _, hintID := range []string{"3", "0", "-1"} {
		w := httptest.NewRecorder()
		req, _ := http.NewRequestWithContext(context.Background(),
			http.MethodGet, "/packs/fantasy/quests/1/hints/"+hintID, nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404 for hint ID %q, got %d", hintID, w.Code)
		}
	}
}

func TestGetQuestHint_InvalidHintID(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/1/hints/notanumber", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestGetQuestHint_QuestNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/999/hints/1", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetQuestHint_PackNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/nonexistent/quests/1/hints/1", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetQuestHint_QuestWithoutHints(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/2/hints/1", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for quest without hints, got %d", w.Code)
	}
}

// ==================== GetQuestSolution Tests ====================

func TestGetQuestSolution_Valid(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/1/solution", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	solution, ok := result["solution"].(string)
	if !ok || !strings.Contains(solution, "default allow = false") {
		t.Errorf("expected solution Rego code, got %v", result["solution"])
	}
}

func TestGetQuestSolution_QuestWithoutSolution(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/2/solution", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for quest without solution, got %d", w.Code)
	}
}

func TestGetQuestSolution_QuestNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/999/solution", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetQuestSolution_PackNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/nonexistent/quests/1/solution", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// ==================== GetQuestSupportModules Tests ====================

func TestGetQuestSupportModules_Valid(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/1/support-modules", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	modules, ok := result["support_modules"].([]any)
	if !ok || len(modules) != 1 {
		t.Fatalf("expected 1 support module, got %v", result["support_modules"])
	}
	if module, ok := modules[0].(string); !ok || !strings.Contains(module, "package helpers") {
		t.Errorf("expected support module source, got %v", modules[0])
	}
}

func TestGetQuestSupportModules_QuestWithoutModules(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/2/support-modules", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for quest without support modules, got %d", w.Code)
	}
}

func TestGetQuestSupportModules_QuestNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/fantasy/quests/999/support-modules", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetQuestSupportModules_PackNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodGet, "/packs/nonexistent/quests/1/support-modules", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestRevealEndpoints_HaveNoStoreCacheControl(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	for _, path := range []string{
		"/packs/fantasy/quests/1/hints/1",
		"/packs/fantasy/quests/1/solution",
		"/packs/fantasy/quests/1/support-modules",
	} {
		w := httptest.NewRecorder()
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200 for %s, got %d", path, w.Code)
		}
		if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("expected Cache-Control no-store for %s, got %q", path, cc)
		}
	}
}

// ==================== VerifySolution Tests ====================

func TestVerifySolution_ValidAndPassing(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:  "fantasy",
		QuestID: 1,
		RegoCode: `
			package quest
			default allow = false
			allow if { input.user == "admin" }
		`,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["passed"] != true {
		t.Errorf("expected passed=true, got %v", result["passed"])
	}
}

func TestVerifySolution_ValidButFailing(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:  "fantasy",
		QuestID: 1,
		RegoCode: `
			package quest
			default allow = false
		`,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["passed"] != false {
		t.Errorf("expected passed=false, got %v", result["passed"])
	}
}

func TestVerifySolution_QuestNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:   "fantasy",
		QuestID:  999,
		RegoCode: "package quest\ndefault allow = false",
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestVerifySolution_PackNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:   "nonexistent",
		QuestID:  1,
		RegoCode: "package quest\ndefault allow = false",
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestVerifySolution_InvalidJSON(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodPost, "/verify", bytes.NewBufferString("{invalid-json"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestVerifySolution_EmptyBody(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", nil)
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestVerifySolution_OversizedBodyReturns413(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := gin.New()
	router.Use(BodySizeLimit())
	handler := NewHandler(repo, quest.NewVerifier())
	handler.RegisterRoutes(router)

	// 2 MiB body exceeds the 1 MiB BodySizeLimit; the MaxBytesReader error
	// must surface as 413, not as a generic 400 "Invalid request".
	oversized := strings.Repeat("a", 2*1024*1024)
	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodPost, "/verify", bytes.NewBufferString(`{"rego_code":"`+oversized+`"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected status 413 for oversized body, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifySolution_UnderLimitBodyDoesNotReturn413(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := gin.New()
	router.Use(BodySizeLimit())
	handler := NewHandler(repo, quest.NewVerifier())
	handler.RegisterRoutes(router)

	// The same route with a body inside the limit must not be rejected for
	// size; the pack is unknown, so 404 proves the body was parsed.
	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodPost, "/verify", bytes.NewBufferString(`{"pack_id":"nope","quest_id":1,"rego_code":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 (body parsed, pack unknown), got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifySolution_CompilationError(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:  "fantasy",
		QuestID: 1,
		RegoCode: `
			package quest
			default allow =
		`,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 (errors returned in body), got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["passed"] != false {
		t.Errorf("expected passed=false for compile error, got %v", result["passed"])
	}
}

func TestVerifySolution_CompilationErrorDetails(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:  "fantasy",
		QuestID: 1,
		RegoCode: `
			package quest
			default allow =
		`,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 (errors returned in body), got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["error"] != "Compilation error" {
		t.Errorf("expected error='Compilation error', got %v", result["error"])
	}

	details, ok := result["error_details"].([]any)
	if !ok || len(details) == 0 {
		t.Fatal("expected non-empty error_details for compile error")
	}
	detail, ok := details[0].(map[string]any)
	if !ok {
		t.Fatalf("expected error_details entries to be objects, got %T", details[0])
	}
	if detail["message"] == "" {
		t.Error("expected non-empty message in error detail")
	}
	if line, ok := detail["line"].(float64); !ok || line < 1 {
		t.Errorf("expected line >= 1 in error detail, got %v", detail["line"])
	}
}

func TestVerifySolution_UndefinedResultFlag(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	// No default rule: for "guest" (test 2) the query is undefined,
	// which must be flagged instead of being shown as a plain null.
	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:  "fantasy",
		QuestID: 1,
		RegoCode: `
			package quest
			allow if { input.user == "admin" }
		`,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	results, ok := result["results"].([]any)
	if !ok || len(results) != 2 {
		t.Fatalf("expected 2 results, got %v", result["results"])
	}
	second, ok := results[1].(map[string]any)
	if !ok {
		t.Fatalf("expected result entry to be an object, got %T", results[1])
	}
	if second["undefined"] != true {
		t.Errorf("expected undefined=true for test 2, got %v", second["undefined"])
	}
	if second["actual"] != nil {
		t.Errorf("expected actual=null for undefined result, got %v", second["actual"])
	}
}

func TestVerifySolution_TimeoutReturns408(t *testing.T) {
	originalTimeout := verifyTimeout
	verifyTimeout = 50 * time.Millisecond
	t.Cleanup(func() { verifyTimeout = originalTimeout })

	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	router := newTestRouter(repo)

	// Combinatorial comprehension that cannot finish within the budget.
	reqBody, _ := json.Marshal(VerifyRequest{
		PackID:  "fantasy",
		QuestID: 1,
		RegoCode: `
			package quest
			allow if {
				count([pair |
					some i in numbers.range(1, 2000)
					some j in numbers.range(1, 2000)
					pair := [i, j]
				]) > 0
			}
		`,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusRequestTimeout {
		t.Errorf("expected status 408 for policy timeout, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["error"] != "Verification timed out" {
		t.Errorf("expected error='Verification timed out', got %v", result["error"])
	}
	if result["message"] == "" {
		t.Error("expected player-facing message in timeout response")
	}
}

// ==================== HealthCheck Tests ====================

func TestHealthCheck_ReturnsOK(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if result["status"] != "ok" {
		t.Errorf("expected status='ok', got %v", result["status"])
	}
}

func TestHealthCheck_ReportsQuestPackCount(t *testing.T) {
	repo := quest.NewQuestRepository()
	loadHandlerTestPack(t, repo, "fantasy")
	loadHandlerTestPack(t, repo, "scifi")
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	// quest-packs is returned as a float64 when unmarshaled into map[string]any
	count, ok := result["quest-packs"].(float64)
	if !ok {
		t.Fatalf("expected quest-packs to be a number, got %T", result["quest-packs"])
	}
	if int(count) != 2 {
		t.Errorf("expected quest-packs=2, got %v", count)
	}
}

func TestHealthCheck_HasTimestamp(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	router.ServeHTTP(w, req)

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if _, ok := result["timestamp"]; !ok {
		t.Error("expected timestamp field in health response")
	}
}
