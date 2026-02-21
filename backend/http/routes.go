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
	"io"
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
	s.router.GET("/quests/:pack/assets/:assetpath", s.serveQuestAssets)

	// Serve quest pack CSS files (theme.css, custom.css, styles.css)
	s.router.GET("/quests/:pack/:csspath", s.serveQuestCSS)

	// Serve shared CSS files
	s.router.GET("/shared/css/:filepath", s.serveSharedCSS)
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
func (s *Server) serveQuestAssets(c *gin.Context) {
	pack := c.Param("pack")
	requestedPath := c.Param("assetpath")

	// Validate pack name
	if !isValidPackName(pack) {
		slog.Warn("security: invalid pack name rejected", "pack", pack)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	baseDir := filepath.Join("./frontend/quests", pack, "assets")
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

	baseDir := filepath.Join("./frontend/quests", pack)
	validate := func(p string) bool {
		allowedFiles := map[string]bool{
			"theme.css":  true,
			"custom.css": true,
			"styles.css": true,
		}
		return allowedFiles[p]
	}

	s.serveSafeFile(c, baseDir, filename, validate, "text/css; charset=utf-8")
}

// serveSharedCSS handles serving shared CSS files from frontend/shared/css/
func (s *Server) serveSharedCSS(c *gin.Context) {
	requestedPath := c.Param("filepath")
	baseDir := "./frontend/shared/css"
	validate := func(p string) bool {
		return filepath.Ext(p) == ".css"
	}

	s.serveSafeFile(c, baseDir, requestedPath, validate, "text/css; charset=utf-8")
}

// serveSafeFile is a helper to serve files safely with path traversal protection and validation
func (s *Server) serveSafeFile(c *gin.Context, baseDir string, requestedPath string, validate func(string) bool, contentType string) {
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

		// Try to open the file from sub FS
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

		// reuse existing handle
		fileData, err := io.ReadAll(file)
		if err != nil {
			c.Data(http.StatusOK, "text/html; charset=utf-8", mustReadFile(subFS, "index.html"))
			return
		}

		// Determine content type based on file extension
		contentType := getContentType(cleanPath)

		c.Data(http.StatusOK, contentType, fileData)
	}
}
