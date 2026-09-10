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
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/ghmer/rego-adventure/backend/paths"
	"github.com/gin-gonic/gin"
)

// questCSSFiles lists the CSS files servable from a quest pack directory.
var questCSSFiles = map[string]bool{
	"theme.css":  true,
	"custom.css": true,
	"styles.css": true,
}

// validateQuestCSSFile reports whether filename is servable quest CSS.
func validateQuestCSSFile(filename string) bool {
	return questCSSFiles[filename]
}

// validateCSSAsset reports whether requestedPath is a servable asset type.
func validateCSSAsset(requestedPath string) bool {
	return filepath.Ext(requestedPath) == ".css"
}

// SetupRoutes configures all routes and middleware
func (s *Server) SetupRoutes() {
	// Apply middleware
	s.router.Use(SecurityHeaders(s.config))
	s.router.Use(BodySizeLimit())
	s.router.Use(setupCORS(s.config.AllowedOrigin))

	// Config endpoint
	s.router.GET("/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, s.config.Auth)
	})

	// Health check endpoint (public, no auth required)
	s.router.GET("/health", s.handler.HealthCheck)

	// API routes with auth middleware
	apiGroup := s.router.Group("/api")
	apiGroup.Use(Auth(s.config))
	s.handler.RegisterRoutes(apiGroup)

	// Quest assets routes
	s.setupQuestRoutes()

	// Frontend routes
	s.setupFrontendRoutes()
}

// setupQuestRoutes configures quest asset serving
func (s *Server) setupQuestRoutes() {
	// Serve static assets for quests (wildcard to support subdirectory assets)
	s.router.GET("/quests/:pack/assets/*assetpath", s.serveQuestAssets)

	// Serve quest pack CSS files (theme.css, custom.css, styles.css)
	s.router.GET("/quests/:pack/:csspath", s.serveQuestCSS)

	// Serve shared CSS files
	s.router.GET("/shared/css/:filepath", s.serveSharedCSS)
}

// setupFrontendRoutes configures frontend and SPA routes
func (s *Server) setupFrontendRoutes() {
	// Serve Frontend
	subFS := os.DirFS(paths.AdventureDir)

	// Handle SPA routes
	s.router.GET("/callback", func(c *gin.Context) {
		c.FileFromFS("index.html", http.FS(subFS))
	})

	s.router.NoRoute(createSPAHandler(subFS))
}

// serveQuestAssets handles serving quest asset files
func (s *Server) serveQuestAssets(c *gin.Context) {
	pack := c.Param("pack")
	// Gin wildcard params include a leading slash; strip it.
	requestedPath := strings.TrimPrefix(c.Param("assetpath"), "/")

	// Validate pack name
	if !isValidPackName(pack) {
		slog.Warn("security: invalid pack name rejected", "pack", pack)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	baseDir := filepath.Join(paths.QuestsDir, pack, "assets")
	validate := func(p string) bool {
		return isAllowedExtension(p) && !isSensitiveFile(p)
	}

	s.serveSafeFile(c, baseDir, requestedPath, validate, "")
}

// serveQuestCSS handles serving quest CSS files (theme.css, custom.css, styles.css)
func (s *Server) serveQuestCSS(c *gin.Context) {
	pack := c.Param("pack")
	requestedPath := c.Param("csspath")
	filename := filepath.Base(requestedPath)

	// Validate pack name
	if !isValidPackName(pack) {
		slog.Warn("security: invalid pack name rejected", "pack", pack)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	baseDir := filepath.Join(paths.QuestsDir, pack)
	validate := validateQuestCSSFile

	s.serveSafeFile(c, baseDir, filename, validate, "text/css; charset=utf-8")
}

// serveSharedCSS handles serving shared CSS files from frontend/shared/css/
func (s *Server) serveSharedCSS(c *gin.Context) {
	requestedPath := c.Param("filepath")
	baseDir := paths.SharedCSSDir
	validate := validateCSSAsset

	s.serveSafeFile(c, baseDir, requestedPath, validate, "text/css; charset=utf-8")
}

// serveSafeFile is a helper to serve files safely with path traversal protection and validation
func (s *Server) serveSafeFile(
	c *gin.Context,
	baseDir string,
	requestedPath string,
	validate func(string) bool,
	contentType string) {
	// Check for path traversal attempts
	if containsPathTraversal(requestedPath) {
		slog.Warn("security: path traversal attempt blocked", "path", requestedPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Clean the filepath to prevent traversal
	cleanPath := filepath.Clean(requestedPath)

	// Validate file
	if validate != nil && !validate(cleanPath) {
		slog.Warn("security: file validation failed", "path", cleanPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Construct safe path
	safePath := filepath.Join(baseDir, cleanPath)

	// Verify the resolved path is still within the expected directory
	absPath, err := filepath.Abs(safePath)
	if err != nil {
		slog.Warn("security: failed to resolve absolute path", "error", err)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	expectedPrefix, err := filepath.Abs(baseDir)
	if err != nil {
		slog.Warn("security: failed to resolve expected prefix", "error", err)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	if !strings.HasPrefix(absPath, expectedPrefix) {
		slog.Warn("security: path escape attempt blocked", "path", absPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Set Content-Type if provided
	if contentType != "" {
		c.Header("Content-Type", contentType)
	}

	// Serve the file
	c.File(absPath)
}

// createSPAHandler creates a handler for SPA routing
func createSPAHandler(subFS fs.FS) gin.HandlerFunc {
	// Read index.html once at handler creation; log but don't fatal — the
	// handler returns 500 if the file is missing.
	indexHTML, indexHTMLErr := fs.ReadFile(subFS, "index.html")
	if indexHTMLErr != nil {
		slog.Error("could not read index.html for SPA handler", "error", indexHTMLErr)
	}

	// serveIndex responds with the captured index.html bytes.
	serveIndex := func(c *gin.Context) {
		if indexHTMLErr != nil {
			slog.Error("index.html unavailable", "error", indexHTMLErr)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	}

	return func(c *gin.Context) {
		requestedPath := c.Request.URL.Path

		// Security: Validate and sanitize the requested path
		if containsPathTraversal(requestedPath) {
			slog.Warn("security: path traversal attempt in NoRoute blocked", "path", requestedPath)
			c.AbortWithStatus(http.StatusNotFound)
			return
		}

		// Clean the path
		cleanPath := path.Clean(requestedPath)

		// Remove leading slash for fs.FS compatibility
		cleanPath = strings.TrimPrefix(cleanPath, "/")

		// If cleanPath is empty (root path), serve index.html
		if cleanPath == "" || cleanPath == "." {
			serveIndex(c)
			return
		}

		// Try to open the file from sub FS
		file, err := subFS.Open(cleanPath)
		if err != nil {
			// File doesn't exist — serve index.html for SPA client-side routing
			serveIndex(c)
			return
		}
		defer func() {
			if err := file.Close(); err != nil {
				slog.Warn("failed to close file", "path", cleanPath, "error", err)
			}
		}()

		// If it's a directory, serve index.html
		stat, err := file.Stat()
		if err != nil {
			slog.Warn("failed to stat file, falling back to index.html", "path", cleanPath, "error", err)
			serveIndex(c)
			return
		}
		if stat.IsDir() {
			serveIndex(c)
			return
		}

		// Delegate to Gin's FileFromFS for full HTTP semantics (ETag, conditional GET, Range).
		c.FileFromFS(cleanPath, http.FS(subFS))
	}
}
