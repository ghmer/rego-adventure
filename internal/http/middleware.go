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
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/ghmer/rego-adventure/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// StructuredLogger is a middleware that logs HTTP requests using slog
func StructuredLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method

		c.Next()

		duration := time.Since(start)
		status := c.Writer.Status()
		clientIP := c.ClientIP()

		// Prepare structured log fields
		fields := []any{
			"method", method,
			"path", path,
			"status", status,
			"duration", duration.String(),
			"ip", clientIP,
		}

		// Log with appropriate level based on status code
		switch {
		case status >= 500:
			slog.Error("HTTP request", fields...)
		case status >= 400:
			slog.Warn("HTTP request", fields...)
		default:
			slog.Info("HTTP request", fields...)
		}
	}
}

// SecurityHeaders adds security headers to responses
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Next()
	}
}

// BodySizeLimit limits request body size to 1MB
func BodySizeLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
		c.Next()
	}
}

// Auth creates an authentication middleware
func Auth(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.Auth.Enabled {
			c.Next()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			return
		}

		tokenString := parts[1]
		token, err := jwt.Parse(tokenString, cfg.JWKS.Keyfunc)

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		if claims, ok := token.Claims.(jwt.MapClaims); ok {
			// Verify Audience
			aud, err := claims.GetAudience()
			if err != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid audience claim"})
				return
			}

			foundAud := slices.Contains(aud, cfg.Auth.Audience)
			if !foundAud {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid audience"})
				return
			}

			// Verify Issuer
			iss, err := claims.GetIssuer()
			if err != nil || iss != cfg.Auth.Issuer {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid issuer"})
				return
			}
		} else {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			return
		}

		c.Next()
	}
}
