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
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// Allowed file extensions for quest assets
var allowedExtensions = map[string]bool{
	".jpg":  true,
	".png":  true,
	".css":  true,
	".m4a":  true,
	".webp": true,
	".svg":  true,
}

// isValidPackName validates that a pack name doesn't contain path traversal characters
func isValidPackName(pack string) bool {
	if pack == "" {
		return false
	}
	// Reject any pack name containing path separators or parent directory references
	if strings.Contains(pack, "..") || strings.Contains(pack, "/") || strings.Contains(pack, "\\") {
		return false
	}
	// Reject hidden files/directories
	if strings.HasPrefix(pack, ".") {
		return false
	}
	return true
}

// isAllowedExtension checks if a file extension is in the whitelist
func isAllowedExtension(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return allowedExtensions[ext]
}

// containsPathTraversal detects path traversal attempts
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
