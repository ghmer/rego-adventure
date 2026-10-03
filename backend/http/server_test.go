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
	"testing"

	"github.com/ghmer/rego-adventure/v2/backend/config"
	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

// ==================== Server Construction ====================

// TestNew_AcceptsConfiguredTrustedProxies verifies that a valid trusted
// proxy list builds without error and is applied to the router.
func TestNew_AcceptsConfiguredTrustedProxies(t *testing.T) {
	cfg := &config.Config{
		TrustedProxies: []string{"10.0.0.0/8"},
		Port:           "8080",
	}
	handler := NewHandler(quest.NewQuestRepository(), quest.NewVerifier())

	srv, err := New(cfg, handler)
	if err != nil {
		t.Fatalf("New with valid trusted proxies failed: %v", err)
	}
	if srv.Router() == nil {
		t.Fatal("expected a configured router")
	}
}

// TestNew_ReturnsErrorForInvalidTrustedProxies verifies that an invalid
// CIDR is reported as an error instead of exiting the process.
func TestNew_ReturnsErrorForInvalidTrustedProxies(t *testing.T) {
	cfg := &config.Config{
		TrustedProxies: []string{"not-a-cidr"},
		Port:           "8080",
	}
	handler := NewHandler(quest.NewQuestRepository(), quest.NewVerifier())

	if _, err := New(cfg, handler); err == nil {
		t.Fatal("expected error for invalid trusted proxy CIDR, got nil")
	}
}
