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

package config

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
)

// AuthConfig holds the authentication configuration
type AuthConfig struct {
	Enabled       bool   `json:"enabled"`
	Issuer        string `json:"issuer"`
	DiscoveryURL  string `json:"discovery_url"`
	ClientID      string `json:"client_id"`
	Audience      string `json:"audience"`
	ShowImpressum bool   `json:"show_impressum"`
}

// RateLimitConfig holds the rate limiter configuration
type RateLimitConfig struct {
	Enabled        bool `json:"enabled"`
	APILimit       int  `json:"api_limit"`       // requests per second for /api endpoints
	FrontendLimit  int  `json:"frontend_limit"`  // requests per second for frontend
	WindowDuration int  `json:"window_duration"` // time window in seconds (default 1)
}

// Config holds all application configuration
type Config struct {
	Auth           AuthConfig
	RateLimit      RateLimitConfig
	TrustedProxies []string
	AllowedOrigin  string
	Port           string
	JWKS           keyfunc.Keyfunc
}

// Load loads configuration from environment variables
func Load() (*Config, error) {
	cfg := &Config{
		Auth: AuthConfig{
			Enabled:       os.Getenv("AUTH_ENABLED") == "true",
			Issuer:        os.Getenv("AUTH_ISSUER"),
			DiscoveryURL:  os.Getenv("AUTH_DISCOVERY_URL"),
			ClientID:      os.Getenv("AUTH_CLIENT_ID"),
			Audience:      os.Getenv("AUTH_AUDIENCE"),
			ShowImpressum: os.Getenv("SHOW_IMPRESSUM") == "true",
		},
		Port: os.Getenv("PORT"),
	}

	if cfg.Port == "" {
		cfg.Port = "8080"
	}

	// Parse rate limiter configuration
	if err := cfg.parseRateLimitConfig(); err != nil {
		return nil, err
	}

	// Parse Trusted Proxies
	if err := cfg.parseTrustedProxies(); err != nil {
		return nil, err
	}

	// Validate and set allowed origin
	if err := cfg.validateAllowedOrigin(); err != nil {
		return nil, err
	}

	// Initialize JWKS if auth is enabled
	if cfg.Auth.Enabled {
		if err := cfg.initializeJWKS(); err != nil {
			return nil, err
		}
		slog.Info("OIDC authentication enabled")
	}

	return cfg, nil
}

// parseRateLimitConfig parses and validates rate limiter configuration from environment variables
func (c *Config) parseRateLimitConfig() error {
	enabled := false
	if env := os.Getenv("RATE_LIMIT_ENABLED"); env != "" {
		var err error
		enabled, err = strconv.ParseBool(env)
		if err != nil {
			slog.Error("invalid RATE_LIMIT_ENABLED value", "error", err)
			os.Exit(1)
		}
	}

	// API limit: requests per second for /api endpoints (default: 5)
	apiLimit := 5
	if env := os.Getenv("RATE_LIMIT_API"); env != "" {
		var err error
		apiLimit64, err := strconv.ParseInt(env, 10, 64)
		if err != nil {
			slog.Error("invalid RATE_LIMIT_API value", "error", err)
			os.Exit(1)
		}
		apiLimit = int(apiLimit64)
	}

	// Frontend limit: requests per second for non-API endpoints (default: 50)
	frontendLimit := 50
	if env := os.Getenv("RATE_LIMIT_FRONTEND"); env != "" {
		var err error
		frontendLimit64, err := strconv.ParseInt(env, 10, 64)
		if err != nil {
			slog.Error("invalid RATE_LIMIT_FRONTEND value", "error", err)
			os.Exit(1)
		}
		frontendLimit = int(frontendLimit64)
	}

	// Window duration in seconds (default: 1)
	windowDuration := 1
	if env := os.Getenv("RATE_LIMIT_WINDOW"); env != "" {
		var err error
		windowDuration64, err := strconv.ParseInt(env, 10, 64)
		if err != nil {
			slog.Error("invalid RATE_LIMIT_WINDOW value", "error", err)
			os.Exit(1)
		}
		windowDuration = int(windowDuration64)
	}

	c.RateLimit = RateLimitConfig{
		Enabled:        enabled,
		APILimit:       apiLimit,
		FrontendLimit:  frontendLimit,
		WindowDuration: windowDuration,
	}

	if c.RateLimit.Enabled {
		slog.Info("rate limiting enabled",
			"api_limit", c.RateLimit.APILimit,
			"frontend_limit", c.RateLimit.FrontendLimit,
			"window_duration_seconds", c.RateLimit.WindowDuration)
	}

	return nil
}

// parseTrustedProxies parses and validates TRUSTED_PROXIES environment variable
func (c *Config) parseTrustedProxies() error {
	trustedProxiesEnv := os.Getenv("TRUSTED_PROXIES")
	if trustedProxiesEnv == "" {
		slog.Info("TRUSTED_PROXIES not set, using nil (no trusted proxies)")
		return nil
	}

	rawProxies := strings.Split(trustedProxiesEnv, ",")
	for _, proxy := range rawProxies {
		proxy = strings.TrimSpace(proxy)
		if proxy == "" {
			continue
		}

		// Validate CIDR format
		_, _, err := net.ParseCIDR(proxy)
		if err != nil {
			slog.Error("invalid CIDR range in TRUSTED_PROXIES", "proxy", proxy, "error", err)
			os.Exit(1)
		}

		c.TrustedProxies = append(c.TrustedProxies, proxy)
	}

	if len(c.TrustedProxies) > 0 {
		slog.Info("trusted proxies configured", "proxies", c.TrustedProxies)
	} else {
		slog.Info("TRUSTED_PROXIES set but no valid CIDR ranges found, using nil (no trusted proxies)")
	}

	return nil
}

// validateAllowedOrigin validates the DOMAIN environment variable
func (c *Config) validateAllowedOrigin() error {
	allowedOrigin := os.Getenv("DOMAIN")
	if allowedOrigin == "" {
		slog.Error("DOMAIN environment variable must be set")
		os.Exit(1)
	}

	if allowedOrigin == "*" {
		slog.Error("DOMAIN environment variable cannot be a wildcard (*). Please specify a valid origin URL")
		os.Exit(1)
	}

	parsedURL, err := url.Parse(allowedOrigin)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		slog.Error("DOMAIN environment variable must be a valid URL with scheme and host", "domain", allowedOrigin)
		os.Exit(1)
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		slog.Error("DOMAIN environment variable must use http or https scheme", "scheme", parsedURL.Scheme)
		os.Exit(1)
	}

	c.AllowedOrigin = allowedOrigin
	return nil
}

// initializeJWKS initializes the JWKS for JWT validation
func (c *Config) initializeJWKS() error {
	if c.Auth.DiscoveryURL == "" {
		slog.Error("AUTH_DISCOVERY_URL is required when AUTH_ENABLED is true")
		os.Exit(1)
	}

	// Fetch OIDC configuration to find jwks_uri
	resp, err := http.Get(c.Auth.DiscoveryURL)
	if err != nil {
		slog.Error("failed to fetch OIDC discovery", "error", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	var oidcConfig struct {
		JWKSURI string `json:"jwks_uri"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&oidcConfig); err != nil {
		slog.Error("failed to decode OIDC config", "error", err)
		os.Exit(1)
	}

	if oidcConfig.JWKSURI == "" {
		slog.Error("jwks_uri not found in OIDC discovery response")
		os.Exit(1)
	}

	// Initialize JWKS
	jwks, err := keyfunc.NewDefault([]string{oidcConfig.JWKSURI})
	if err != nil {
		slog.Error("failed to create JWKS from resource at given URL", "error", err)
		os.Exit(1)
	}

	c.JWKS = jwks
	return nil
}
