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
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ghmer/rego-adventure/v2/backend/paths"
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

// importMapScriptRe captures the exact content of the inline import map
// script in index.html. The capture must be byte-exact: CSP hashes are
// computed over the inline script's text content, whitespace included
// (everything between the closing '>' of the opening tag and '</script>').
var importMapScriptRe = regexp.MustCompile(`(?s)<script type="importmap">(.*?)</script>`)

// inlineImportMapScriptHash reads the SPA's index.html and returns the
// CSP script-src source expression ("sha256-<base64>") for its inline
// import map. The SPA handler serves those same bytes, so the hash the
// browser computes over the received script matches this one. It is
// computed once at startup; the import map is static per deployment,
// and dependency bumps (importmapgen/Dependabot) flow through with no
// hash bookkeeping anywhere.
func inlineImportMapScriptHash(indexFile string) (string, error) {
	indexHTML, err := os.ReadFile(indexFile) // #nosec G304 -- deployment path built from the paths constant
	if err != nil {
		return "", fmt.Errorf("read index.html for CSP import map hash: %w", err)
	}

	match := importMapScriptRe.FindSubmatch(indexHTML)
	if match == nil {
		return "", fmt.Errorf("no inline <script type=\"importmap\"> found in %s", indexFile)
	}

	sum := sha256.Sum256(match[1])
	return "sha256-" + base64.StdEncoding.EncodeToString(sum[:]), nil
}

// SetupRoutes configures all routes and middleware.
//
// It returns an error when the inline import map CSP hash cannot be
// computed (missing or unreadable index.html, or a document without an
// import map block). Booting anyway would serve an SPA that the CSP
// then blocks in the browser: a broken-app state strictly harder to
// diagnose than refusing to start. This matches the fail-fast handling
// of configuration and LOG_LEVEL errors in main.
func (s *Server) SetupRoutes() error {
	importMapHash, err := inlineImportMapScriptHash(filepath.Join(paths.AdventureDir, "index.html"))
	if err != nil {
		return fmt.Errorf("security: cannot compute CSP hash for the inline import map: %w", err)
	}

	// Apply middleware
	s.router.Use(SecurityHeaders(s.config, importMapHash))
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

	return nil
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

// rejectPackName is the shared log line and status for rejecting an
// invalid pack name; the validity check stays in the handlers.
func rejectPackName(c *gin.Context, pack string) {
	slog.Warn("security: invalid pack name rejected", "pack", pack)
	c.AbortWithStatus(http.StatusForbidden)
}

// serveQuestAssets handles serving quest asset files
func (s *Server) serveQuestAssets(c *gin.Context) {
	pack := c.Param("pack")
	// Gin wildcard params include a leading slash; strip it.
	requestedPath := strings.TrimPrefix(c.Param("assetpath"), "/")

	// Validate pack name
	if !isValidPackName(pack) {
		rejectPackName(c, pack)
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
		rejectPackName(c, pack)
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

// resolveContained joins requestedPath under baseDir and verifies the
// result stays inside baseDir. Both sides are resolved through symlinks
// where possible: a purely lexical prefix check would let a symlink
// inside a quest pack reach outside it. A path whose final component is
// a symlink is rejected outright — an external link target cannot be
// resolved, and letting the lexical join stand would answer 404 for
// paths outside the base and leak their existence.
func resolveContained(baseDir, requested string) (string, bool) {
	absPath, err := filepath.Abs(filepath.Join(baseDir, requested))
	if err != nil {
		return "", false
	}

	if info, err := os.Lstat(absPath); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", false
		}
		// The target exists, so it fully resolves; use the resolved form.
		resolved, err := filepath.EvalSymlinks(absPath)
		if err != nil {
			return "", false
		}
		absPath = resolved
	}
	// A missing target keeps the lexical path: the caller answers 404
	// and makes no containment decision about a symlink.

	expectedPrefix, err := filepath.Abs(baseDir)
	if err != nil {
		return "", false
	}
	if resolved, err := filepath.EvalSymlinks(expectedPrefix); err == nil {
		expectedPrefix = resolved
	}

	if absPath != expectedPrefix && !strings.HasPrefix(absPath, expectedPrefix+string(os.PathSeparator)) {
		return "", false
	}
	return absPath, true
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

	// Construct safe path and verify the resolved path is still within
	// the expected directory (see resolveContained for the symlink rules)
	absPath, ok := resolveContained(baseDir, cleanPath)
	if !ok {
		slog.Warn("security: path escape attempt blocked", "path", requestedPath)
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Answer a missing target here instead of letting c.File resolve it:
	// a dangling symlink would otherwise leak the existence of a path
	// outside the base through ServeFile's error handling.
	if _, err := os.Lstat(absPath); err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	// SVG documents can carry scripts and execute them when navigated to
	// directly. Quest packs are operator content, but lock the document
	// down anyway: the CSP header on the SVG response itself disables
	// fetching, forms, and scripting for that resource.
	if strings.EqualFold(filepath.Ext(cleanPath), ".svg") {
		c.Header("Content-Security-Policy", "default-src 'none'; sandbox; form-action 'none'")
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
	// Read index.html once at handler creation; log but don't fatal - the
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

		// Unmatched /api/* paths must not fall through to the SPA: the
		// client asked for an API resource and must get a JSON 404, not a
		// 200 HTML page. The /api group's own middleware (auth) never runs
		// for unmatched routes, so answering here keeps the contract
		// uniform for every /api/* request.
		if requestedPath == "/api" || strings.HasPrefix(requestedPath, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
			return
		}

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
			// File doesn't exist - serve index.html for SPA client-side routing
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
