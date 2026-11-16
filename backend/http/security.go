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
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ghmer/rego-adventure/v2/backend/paths"
	"github.com/ghmer/rego-adventure/v2/backend/quest"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// VendorDirName is the subdirectory of the adventure dir that carries
// the release's vendored browser libraries (cmd/vendorgen output).
const VendorDirName = "vendor"

// Origins the CSP allowlists while the release still loads its browser
// libraries from CDNs; a vendored release drops both.
const (
	esmShOrigin = "https://esm.sh"
	cdnJsOrigin = "https://cdnjs.cloudflare.com"
)

// vendoredAssets reports whether the release ships its browser libraries
// locally: the parseable vendorgen manifest in frontend/adventure/vendor
// decides, so a deployment flips modes by the files it ships and no
// configuration is needed.
func vendoredAssets() bool {
	return vendoredManifest(filepath.Join(paths.AdventureDir, VendorDirName))
}

// vendoredManifest reads one vendor directory's manifest and reports
// whether it records a real vendoring (module packages or redirecting
// stylesheets). Anything unreadable counts as "not vendored": a broken
// manifest must not silently strip the CDN origins a CDN release needs.
func vendoredManifest(vendorDir string) bool {
	manifestPath := filepath.Join(vendorDir, "manifest.json")
	content, err := os.ReadFile(manifestPath) // #nosec G304 -- path is a constant
	if err != nil {
		return false
	}
	var probe struct {
		Packages map[string]json.RawMessage `json:"packages"`
		CSS      map[string]json.RawMessage `json:"css"`
	}
	if json.Unmarshal(content, &probe) != nil {
		return false
	}
	return len(probe.Packages) > 0 || len(probe.CSS) > 0
}

// Allowed file extensions for quest assets
var allowedExtensions = map[string]bool{
	".jpg":  true,
	".png":  true,
	".css":  true,
	".m4a":  true,
	".webp": true,
	".svg":  true,
}

// isValidPackName validates a pack path parameter with the same rules the
// repository enforces when packs are loaded, so a pack that exists in the
// repository is always addressable and an invalid one never is.
func isValidPackName(pack string) bool {
	return quest.IsValidPackID(pack)
}

// isAllowedExtension checks if a file extension is in the whitelist
func isAllowedExtension(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return allowedExtensions[ext]
}

// containsPathTraversal detects path traversal attempts. The substring
// check is deliberately broad: names containing ".." anywhere (even "a..b")
// are rejected. That over-blocks a handful of legal file names in exchange
// for a simple, conservative rule.
func containsPathTraversal(p string) bool {
	// Clean the path and check for traversal patterns
	cleaned := filepath.Clean(p)
	return strings.Contains(p, "..") || strings.Contains(cleaned, "..")
}

// isSensitiveFile checks if a file should be blocked (solutions, READMEs, etc.)
func isSensitiveFile(filename string) bool {
	lower := strings.ToLower(filename)
	// Block solution files
	if strings.Contains(lower, "solution-") || strings.Contains(lower, "solution.") {
		return true
	}
	// Block README files
	if strings.Contains(lower, "readme") {
		return true
	}
	// Block .json files (quest definitions)
	if strings.HasSuffix(lower, ".json") {
		return true
	}
	return false
}

// setupCORS creates CORS middleware with the specified allowed origin
func setupCORS(allowedOrigin string) gin.HandlerFunc {
	return cors.New(cors.Config{
		AllowOrigins:     []string{allowedOrigin},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}
