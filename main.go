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

package main

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/ghmer/rego-adventure/internal/config"
	"github.com/ghmer/rego-adventure/internal/http"
	_ "github.com/ghmer/rego-adventure/internal/logger"
	"github.com/ghmer/rego-adventure/internal/quest"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	// Initialize Quest Repository
	questRepo := quest.NewQuestRepository()

	// Scan quests folder
	questsDir := "frontend/quests"
	entries, err := os.ReadDir(questsDir)
	if err != nil {
		slog.Error("failed to read quests directory", "error", err)
		os.Exit(1)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			packID := entry.Name()
			jsonPath := filepath.Join(questsDir, packID, "quests.json")
			data, err := os.ReadFile(jsonPath)
			if err != nil {
				slog.Warn("skipping quest pack", "pack_id", packID, "error", err)
				continue
			}
			if err := questRepo.LoadPack(packID, data); err != nil {
				slog.Warn("failed to load quest pack", "pack_id", packID, "error", err)
				continue
			}
			slog.Info("loaded quest pack", "pack_id", packID)
		}
	}

	// Initialize Verifier
	verifier := quest.NewVerifier()

	// Initialize Handler
	handler := http.NewHandler(questRepo, verifier)

	// Setup Server
	srv := http.New(cfg, handler)
	srv.SetupRoutes()

	// Start Server
	addr := fmt.Sprintf("0.0.0.0:%s", cfg.Port)
	slog.Info("starting server", "address", addr)

	if err := srv.Router().Run(addr); err != nil {
		slog.Error("failed to start server", "error", err)
		os.Exit(1)
	}
}
