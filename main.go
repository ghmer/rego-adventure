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

// Package main is the entry point for the Rego adventure application.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/ghmer/rego-adventure/v2/backend/config"
	"github.com/ghmer/rego-adventure/v2/backend/http"
	"github.com/ghmer/rego-adventure/v2/backend/logger"
	"github.com/ghmer/rego-adventure/v2/backend/paths"
	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

func main() {
	// Initialize structured logging before anything can log. LOG_LEVEL
	// selects the level; an invalid value fails fast.
	if err := logger.Setup(os.Getenv("LOG_LEVEL")); err != nil {
		slog.Error("failed to configure logging", "error", err)
		os.Exit(1)
	}

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	// Initialize Quest Repository and scan the quests folder
	questRepo := quest.NewQuestRepository()
	loaded, warnings, err := quest.LoadPacksFromDir(questRepo, paths.QuestsDir)
	if err != nil {
		slog.Error("failed to load quest packs", "error", err)
		os.Exit(1)
	}
	for _, w := range warnings {
		slog.Warn("skipping quest pack", "pack_id", w.PackID, "error", w.Err)
	}
	if loaded > 0 {
		slog.Info("quest packs loaded", "count", loaded)
	}

	// Make an empty quests directory impossible to overlook: the app
	// would serve an unusable frontpage with no packs.
	if questRepo.GetNumberOfPacks() == 0 {
		slog.Warn("no quest packs loaded", "quests_dir", paths.QuestsDir)
	}

	// Initialize Verifier
	verifier := quest.NewVerifier()

	// Initialize Handler
	handler := http.NewHandler(questRepo, verifier)

	// Setup Server
	srv, err := http.New(cfg, handler)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}
	srv.SetupRoutes()

	// Start Server
	addr := fmt.Sprintf("0.0.0.0:%s", cfg.Port)
	slog.Info("starting server", "address", addr)

	// Handle SIGINT/SIGTERM so containers can stop us gracefully
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	server := http.NewServer(addr, srv.Router())
	if err := http.RunWithGracefulShutdown(ctx, server, http.DefaultShutdownTimeout); err != nil {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}

	slog.Info("server stopped gracefully")
}
