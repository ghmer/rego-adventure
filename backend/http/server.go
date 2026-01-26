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
	"log/slog"
	"os"

	"github.com/ghmer/rego-adventure/backend/config"

	"github.com/gin-gonic/gin"
)

// Server holds the HTTP server configuration
type Server struct {
	router  *gin.Engine
	config  *config.Config
	handler *Handler
}

// New creates a new server instance
func New(cfg *config.Config, handler *Handler) *Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	// Add Recovery middleware to handle panics
	r.Use(gin.Recovery())

	// Add structured logging middleware
	r.Use(StructuredLogger())

	// Configure trusted proxies
	if len(cfg.TrustedProxies) > 0 {
		if err := r.SetTrustedProxies(cfg.TrustedProxies); err != nil {
			slog.Error("failed to set trusted proxies", "error", err)
			os.Exit(1)
		}
	} else {
		r.SetTrustedProxies(nil)
	}

	// Disable automatic redirects that cause loops
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false

	return &Server{
		router:  r,
		config:  cfg,
		handler: handler,
	}
}

// Router returns the configured Gin router
func (s *Server) Router() *gin.Engine {
	return s.router
}
