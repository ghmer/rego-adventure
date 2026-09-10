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

// Package config handles application configuration loading and management.
package config

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
)

// AuthConfig holds the authentication configuration
type AuthConfig struct {
	Enabled           bool     `json:"enabled"`
	Issuer            string   `json:"issuer"`
	DiscoveryURL      string   `json:"discovery_url"`
	ClientID          string   `json:"client_id"`
	Audience          string   `json:"audience"`
	AllowedAlgorithms []string `json:"allowed_algorithms"`
	ShowImpressum     bool     `json:"show_impressum"`
}

// Config holds all application configuration
type Config struct {
	Auth           AuthConfig
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

	// Parse Trusted Proxies
	if err := cfg.parseTrustedProxies(); err != nil {
		return nil, err
	}

	// Validate and set allowed origin
	if err := cfg.validateAllowedOrigin(); err != nil {
		return nil, err
	}

	// Parse and validate the allowed JWT signing algorithms
	if err := cfg.parseAllowedAlgorithms(); err != nil {
		return nil, err
	}

	// Initialize JWKS if auth is enabled
	if cfg.Auth.Enabled {
		if err := cfg.validateAuthRequirements(); err != nil {
			return nil, err
		}
		if err := cfg.initializeJWKS(); err != nil {
			return nil, err
		}
		slog.Info("OIDC authentication enabled")
	}

	return cfg, nil
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
			return fmt.Errorf("invalid CIDR range %q in TRUSTED_PROXIES: %w", proxy, err)
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
		return fmt.Errorf("DOMAIN environment variable must be set")
	}

	if allowedOrigin == "*" {
		return fmt.Errorf("DOMAIN environment variable cannot be a wildcard (*); please specify a valid origin URL")
	}

	parsedURL, err := url.Parse(allowedOrigin)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return fmt.Errorf("DOMAIN environment variable must be a valid URL with scheme and host, got %q", allowedOrigin)
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("DOMAIN environment variable must use http or https scheme, got %q", parsedURL.Scheme)
	}

	c.AllowedOrigin = allowedOrigin
	return nil
}

// allowedJWTAlgorithms lists the JWT signing algorithms this server accepts.
// Only asymmetric algorithms are supported, because verification keys come
// from a JWKS endpoint; symmetric algorithms (HS*) cannot be verified
// against published public keys.
var allowedJWTAlgorithms = []string{
	"RS256", "RS384", "RS512",
	"PS256", "PS384", "PS512",
	"ES256", "ES384", "ES512",
	"EdDSA",
}

// parseAllowedAlgorithms parses and validates AUTH_ALLOWED_ALGORITHMS.
// Unset or empty, the list defaults to RS256.
func (c *Config) parseAllowedAlgorithms() error {
	raw := os.Getenv("AUTH_ALLOWED_ALGORITHMS")
	if raw == "" {
		c.Auth.AllowedAlgorithms = []string{"RS256"}
		return nil
	}

	for _, alg := range strings.Split(raw, ",") {
		alg = strings.TrimSpace(alg)
		if alg == "" {
			continue
		}

		canonical, supported := supportedAlgorithm(alg)
		if !supported {
			return fmt.Errorf("unsupported algorithm %q in AUTH_ALLOWED_ALGORITHMS; supported: %s",
				alg, strings.Join(allowedJWTAlgorithms, ", "))
		}

		if !slices.Contains(c.Auth.AllowedAlgorithms, canonical) {
			c.Auth.AllowedAlgorithms = append(c.Auth.AllowedAlgorithms, canonical)
		}
	}

	if len(c.Auth.AllowedAlgorithms) == 0 {
		return fmt.Errorf("AUTH_ALLOWED_ALGORITHMS contains no algorithm names; supported: %s",
			strings.Join(allowedJWTAlgorithms, ", "))
	}

	return nil
}

// supportedAlgorithm reports the canonical name of alg if it is supported.
func supportedAlgorithm(alg string) (string, bool) {
	for _, candidate := range allowedJWTAlgorithms {
		if strings.EqualFold(candidate, alg) {
			return candidate, true
		}
	}
	return "", false
}

// validateAuthRequirements ensures the required OIDC settings are present
// when authentication is enabled, so misconfiguration fails at startup
// instead of rejecting every request at runtime.
func (c *Config) validateAuthRequirements() error {
	if c.Auth.Issuer == "" {
		return fmt.Errorf("AUTH_ISSUER is required when AUTH_ENABLED is true")
	}
	if c.Auth.Audience == "" {
		return fmt.Errorf("AUTH_AUDIENCE is required when AUTH_ENABLED is true")
	}
	if c.Auth.DiscoveryURL == "" {
		return fmt.Errorf("AUTH_DISCOVERY_URL is required when AUTH_ENABLED is true")
	}
	return nil
}

// HTTP client with connection pooling and timeout
var httpClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        10,
		MaxIdleConnsPerHost: 5,
		IdleConnTimeout:     30 * time.Second,
	},
}

// initializeJWKS initializes the JWKS for JWT validation
func (c *Config) initializeJWKS() error {
	// Fetch OIDC configuration to find jwks_uri
	fetchCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, c.Auth.DiscoveryURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create OIDC discovery request: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch OIDC discovery document: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			slog.Error("failed to close response body", "error", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("OIDC discovery request failed: status %s", resp.Status)
	}

	var oidcConfig struct {
		JWKSURI string `json:"jwks_uri"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&oidcConfig); err != nil {
		return fmt.Errorf("failed to decode OIDC discovery response: %w", err)
	}

	if oidcConfig.JWKSURI == "" {
		return fmt.Errorf("jwks_uri not found in OIDC discovery response")
	}

	// Initialize JWKS
	jwks, err := keyfunc.NewDefault([]string{oidcConfig.JWKSURI})
	if err != nil {
		return fmt.Errorf("failed to create JWKS from %q: %w", oidcConfig.JWKSURI, err)
	}

	c.JWKS = jwks
	return nil
}
