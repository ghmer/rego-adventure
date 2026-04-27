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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ghmer/rego-adventure/backend/quest"
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
	req, _ := http.NewRequest(http.MethodGet, "/packs", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs/fantasy", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs/nonexistent", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs/fantasy", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs/fantasy/quests/1/test-payload", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs/fantasy/quests/999/test-payload", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetTestPayload_PackNotFound(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/packs/nonexistent/quests/1/test-payload", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs/fantasy/quests/notanumber/test-payload", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/packs/fantasy/quests/1/test-payload", nil)
	router.ServeHTTP(w, req)

	if w.Header().Get("Cache-Control") == "" {
		t.Error("expected Cache-Control header to be set")
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
	req, _ := http.NewRequest(http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
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
	req, _ := http.NewRequest(http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
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
	req, _ := http.NewRequest(http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
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
	req, _ := http.NewRequest(http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
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
	req, _ := http.NewRequest(http.MethodPost, "/verify", bytes.NewBufferString("{invalid-json"))
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
	req, _ := http.NewRequest(http.MethodPost, "/verify", nil)
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
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
	req, _ := http.NewRequest(http.MethodPost, "/verify", bytes.NewBuffer(reqBody))
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

// ==================== HealthCheck Tests ====================

func TestHealthCheck_ReturnsOK(t *testing.T) {
	repo := quest.NewQuestRepository()
	router := newTestRouter(repo)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
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
	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
	router.ServeHTTP(w, req)

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if _, ok := result["timestamp"]; !ok {
		t.Error("expected timestamp field in health response")
	}
}
