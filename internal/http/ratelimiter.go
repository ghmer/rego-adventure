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
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ghmer/rego-adventure/internal/config"
	"github.com/gin-gonic/gin"
)

// clientLimit tracks the request count for a single window
type clientLimit struct {
	count       int
	windowStart time.Time
}

// RateLimiter provides per-IP rate limiting using a Fixed Window Counter
type RateLimiter struct {
	mu             sync.Mutex
	clients        map[string]*clientLimit
	apiLimit       int
	frontendLimit  int
	windowDuration time.Duration
	enabled        bool
}

// NewRateLimiter creates a new rate limiter and starts the cleanup routine
func NewRateLimiter(cfg config.RateLimitConfig) *RateLimiter {
	rl := &RateLimiter{
		clients:        make(map[string]*clientLimit),
		apiLimit:       cfg.APILimit,
		frontendLimit:  cfg.FrontendLimit,
		windowDuration: time.Duration(cfg.WindowDuration) * time.Second,
		enabled:        cfg.Enabled,
	}

	// Start background cleanup to prevent memory leaks
	if rl.enabled {
		go rl.cleanupLoop()
	}

	return rl
}

// cleanupLoop periodically removes stale entries
func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(1 * time.Minute)
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		// Remove clients that haven't been active for 2x the window duration
		expiration := max(rl.windowDuration*2, time.Minute)

		for ip, client := range rl.clients {
			if now.Sub(client.windowStart) > expiration {
				delete(rl.clients, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// checkLimit checks if the request is within the rate limit
func (rl *RateLimiter) checkLimit(clientKey string, limit int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	client, exists := rl.clients[clientKey]

	// New client or existing client with expired window
	if !exists || now.Sub(client.windowStart) >= rl.windowDuration {
		rl.clients[clientKey] = &clientLimit{
			count:       1,
			windowStart: now,
		}
		return true
	}

	// Check limit for current window
	if client.count >= limit {
		return false
	}

	client.count++
	return true
}

// Middleware returns a Gin middleware function for rate limiting
func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !rl.enabled {
			c.Next()
			return
		}

		// Determine which limit to apply based on path
		limit := rl.frontendLimit
		endpointType := "frontend"
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			limit = rl.apiLimit
			endpointType = "api"
		}

		// Create separate client keys for API and frontend endpoints
		clientKey := c.ClientIP() + ":" + endpointType

		if !rl.checkLimit(clientKey, limit) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
			return
		}
		c.Next()
	}
}
