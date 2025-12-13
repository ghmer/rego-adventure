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
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// SetupRoutes configures all routes and middleware
func (s *Server) SetupRoutes() {
	// Apply middleware
	s.router.Use(SecurityHeaders())
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
	// Serve static assets for quests
	s.router.GET("/quests/:pack/assets/*filepath", serveQuestAssets)

	// Serve quest pack CSS files (theme.css, custom.css, styles.css)
	s.router.GET("/quests/:pack/theme.css", serveQuestCSS)
	s.router.GET("/quests/:pack/custom.css", serveQuestCSS)
	s.router.GET("/quests/:pack/styles.css", serveQuestCSS)

	// Serve shared CSS files
	s.router.GET("/shared/css/*filepath", serveSharedCSS)
}

// setupFrontendRoutes configures frontend and SPA routes
func (s *Server) setupFrontendRoutes() {
	// Serve Frontend
	subFS := os.DirFS("frontend/adventure")

	// Handle SPA routes
	s.router.GET("/callback", func(c *gin.Context) {
		c.FileFromFS("index.html", http.FS(subFS))
	})

	s.router.NoRoute(createSPAHandler(subFS))
}

// serveQuestAssets handles serving quest asset files
func serveQuestAssets(c *gin.Context) {
	pack := c.Param("pack")
	requestedPath := c.Param("filepath")

	// Validate pack name
	if !isValidPackName(pack) {
		slog.Warn("security: invalid pack name rejected", "pack", pack)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Check for path traversal attempts
	if containsPathTraversal(requestedPath) {
		slog.Warn("security: path traversal attempt blocked", "path", requestedPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Clean the filepath to prevent traversal
	cleanPath := filepath.Clean(requestedPath)

	// Validate file extension
	if !isAllowedExtension(cleanPath) {
		slog.Warn("security: disallowed file extension rejected", "path", cleanPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Block sensitive files
	if isSensitiveFile(cleanPath) {
		slog.Warn("security: sensitive file access blocked", "path", cleanPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Construct safe path - only serve from assets subdirectory
	safePath := filepath.Join("./frontend/quests", pack, "assets", cleanPath)

	// Verify the resolved path is still within the expected directory
	absPath, err := filepath.Abs(safePath)
	if err != nil {
		slog.Warn("security: failed to resolve absolute path", "error", err)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	expectedPrefix, err := filepath.Abs(filepath.Join("./frontend/quests", pack, "assets"))
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

	// Serve the file
	c.File(safePath)
}

// serveQuestCSS handles serving quest CSS files (theme.css, custom.css, styles.css)
func serveQuestCSS(c *gin.Context) {
	pack := c.Param("pack")

	// Extract the CSS filename from the request path
	requestPath := c.Request.URL.Path
	filename := filepath.Base(requestPath)

	// Validate pack name
	if !isValidPackName(pack) {
		slog.Warn("security: invalid pack name rejected", "pack", pack)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Only allow specific CSS files
	allowedFiles := map[string]bool{
		"theme.css":  true,
		"custom.css": true,
		"styles.css": true,
	}

	if !allowedFiles[filename] {
		slog.Warn("security: disallowed CSS file rejected", "filename", filename)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Construct safe path for CSS file
	safePath := filepath.Join("./frontend/quests", pack, filename)

	// Verify the file exists and is within expected directory
	absPath, err := filepath.Abs(safePath)
	if err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	expectedPrefix, err := filepath.Abs(filepath.Join("./frontend/quests", pack))
	if err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	if !strings.HasPrefix(absPath, expectedPrefix) {
		slog.Warn("security: path escape attempt blocked", "path", absPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Set proper content type for CSS
	c.Header("Content-Type", "text/css; charset=utf-8")
	c.File(safePath)
}

// serveSharedCSS handles serving shared CSS files from frontend/shared/css/
func serveSharedCSS(c *gin.Context) {
	requestedPath := c.Param("filepath")

	// Check for path traversal attempts
	if containsPathTraversal(requestedPath) {
		slog.Warn("security: path traversal attempt blocked", "path", requestedPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Clean the filepath to prevent traversal
	cleanPath := filepath.Clean(requestedPath)

	// Only allow .css files
	if filepath.Ext(cleanPath) != ".css" {
		slog.Warn("security: non-CSS file rejected", "path", cleanPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Construct safe path - only serve from shared/css subdirectory
	safePath := filepath.Join("./frontend/shared/css", cleanPath)

	// Verify the resolved path is still within the expected directory
	absPath, err := filepath.Abs(safePath)
	if err != nil {
		slog.Warn("security: failed to resolve absolute path", "error", err)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	expectedPrefix, err := filepath.Abs("./frontend/shared/css")
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

	// Set proper content type for CSS
	c.Header("Content-Type", "text/css; charset=utf-8")
	c.File(safePath)
}

// createSPAHandler creates a handler for SPA routing
func createSPAHandler(subFS fs.FS) gin.HandlerFunc {
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
			cleanPath = "index.html"
		}

		// Try to open the file from embedded FS
		file, err := subFS.Open(cleanPath)
		if err != nil {
			// File doesn't exist, serve index.html for SPA routing
			c.Data(http.StatusOK, "text/html; charset=utf-8", mustReadFile(subFS, "index.html"))
			return
		}
		defer file.Close()

		// Get file info to check if it's a directory
		stat, err := file.Stat()
		if err != nil {
			c.Data(http.StatusOK, "text/html; charset=utf-8", mustReadFile(subFS, "index.html"))
			return
		}

		// If it's a directory, serve index.html
		if stat.IsDir() {
			c.Data(http.StatusOK, "text/html; charset=utf-8", mustReadFile(subFS, "index.html"))
			return
		}

		// Serve the requested file directly to avoid redirect loops
		fileData := mustReadFile(subFS, cleanPath)

		// Determine content type based on file extension
		contentType := getContentType(cleanPath)

		c.Data(http.StatusOK, contentType, fileData)
	}
}
