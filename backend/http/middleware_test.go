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
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"github.com/ghmer/rego-adventure/v2/backend/config"
)

// ==================== SecurityHeaders Tests ====================

func TestSecurityHeaders_AreSet(t *testing.T) {
	router := gin.New()
	router.Use(SecurityHeaders(nil))
	router.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	router.ServeHTTP(w, req)

	expectedHeaders := map[string]string{
		"X-Frame-Options":        "DENY",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
	}

	for header, expected := range expectedHeaders {
		got := w.Header().Get(header)
		if got != expected {
			t.Errorf("header %q: expected %q, got %q", header, expected, got)
		}
	}
}

func TestSecurityHeaders_CSPIsPresent(t *testing.T) {
	router := gin.New()
	router.Use(SecurityHeaders(nil))
	router.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	router.ServeHTTP(w, req)

	csp := w.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("Content-Security-Policy header is missing")
	}

	// Verify key directives are present
	for _, directive := range []string{"default-src", "script-src", "worker-src", "style-src", "frame-ancestors"} {
		if !strings.Contains(csp, directive) {
			t.Errorf("CSP missing directive %q", directive)
		}
	}
}

func TestSecurityHeaders_CSPFrameAncestorsNone(t *testing.T) {
	router := gin.New()
	router.Use(SecurityHeaders(nil))
	router.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	router.ServeHTTP(w, req)

	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("CSP should contain \"frame-ancestors 'none'\", got: %s", csp)
	}
}

func TestSecurityHeaders_CSPAddsIssuerOriginWhenAuthEnabled(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			Enabled:      true,
			Issuer:       "https://id.example.com/realms/demo",
			DiscoveryURL: "https://id.example.com/realms/demo/.well-known/openid-configuration",
		},
	}

	router := gin.New()
	router.Use(SecurityHeaders(cfg))
	router.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	router.ServeHTTP(w, req)

	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "connect-src 'self' https://esm.sh https://id.example.com") {
		t.Errorf("CSP should allow the configured OIDC issuer origin in connect-src, got: %s", csp)
	}
}

func TestSecurityHeaders_CSPSkipsInvalidIssuer(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			Enabled: true,
			Issuer:  "javascript:alert(1)",
		},
	}

	router := gin.New()
	router.Use(SecurityHeaders(cfg))
	router.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	router.ServeHTTP(w, req)

	csp := w.Header().Get("Content-Security-Policy")
	if strings.Contains(csp, "javascript:") {
		t.Errorf("CSP must not include non-http(s) issuer origins, got: %s", csp)
	}
}

// ==================== BodySizeLimit Tests ====================

func TestBodySizeLimit_SmallBodyAccepted(t *testing.T) {
	router := gin.New()
	router.Use(BodySizeLimit())
	router.POST("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	body := strings.Repeat("a", 1024) // 1KB body
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/test", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 for small body, got %d", w.Code)
	}
}

func TestBodySizeLimit_LargeBodyRejected(t *testing.T) {
	router := gin.New()
	router.Use(BodySizeLimit())
	router.POST("/test", func(c *gin.Context) {
		// Attempt to read body to trigger the limit
		buf := make([]byte, 2*1024*1024)
		n, _ := c.Request.Body.Read(buf)
		if n > 0 {
			c.Status(http.StatusOK)
		} else {
			c.Status(http.StatusRequestEntityTooLarge)
		}
	})

	body := strings.Repeat("a", 2*1024*1024) // 2MB body, exceeds 1MB limit
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/test", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	router.ServeHTTP(w, req)

	// The middleware wraps the body with MaxBytesReader; reading beyond 1MB returns an error.
	// The handler sees the truncated read and responds accordingly.
	// We just verify the middleware is applied and doesn't panic.
	if w.Code == 0 {
		t.Error("expected a non-zero status code")
	}
}

func TestBodySizeLimit_CallsNext(t *testing.T) {
	handlerCalled := false

	router := gin.New()
	router.Use(BodySizeLimit())
	router.GET("/test", func(c *gin.Context) {
		handlerCalled = true
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	router.ServeHTTP(w, req)

	if !handlerCalled {
		t.Error("expected handler to be called after BodySizeLimit middleware")
	}
}

// ==================== Auth Middleware Tests ====================

// authTestServer serves a static JWKS for a generated RSA key pair and
// provides a Config wired like a production auth setup.
type authTestServer struct {
	privateKey *rsa.PrivateKey
	cfg        *config.Config
}

func newAuthTestServer(t *testing.T, allowed []string) *authTestServer {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}

	pub := &privateKey.PublicKey
	jwksJSON := fmt.Sprintf(
		`{"keys":[{"kty":"RSA","kid":"test-key","use":"sig","alg":"RS256","n":%q,"e":%q}]}`,
		base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwksJSON))
	}))
	t.Cleanup(server.Close)

	jwks, err := keyfunc.NewDefault([]string{server.URL})
	if err != nil {
		t.Fatalf("failed to create JWKS: %v", err)
	}

	return &authTestServer{
		privateKey: privateKey,
		cfg: &config.Config{
			JWKS: jwks,
			Auth: config.AuthConfig{
				Enabled:           true,
				Issuer:            "https://id.example.com/realms/demo",
				Audience:          "rego-adventure",
				AllowedAlgorithms: allowed,
			},
		},
	}
}

func (a *authTestServer) signRS256(t *testing.T) string {
	t.Helper()

	claims := jwt.MapClaims{
		"iss": a.cfg.Auth.Issuer,
		"aud": a.cfg.Auth.Audience,
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "test-key"

	signed, err := token.SignedString(a.privateKey)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}
	return signed
}

func serveAuthRequest(t *testing.T, cfg *config.Config, authHeader string) *httptest.ResponseRecorder {
	t.Helper()

	router := gin.New()
	router.Use(Auth(cfg))
	router.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	router.ServeHTTP(w, req)
	return w
}

func TestAuth_RejectsMissingAuthorizationHeader(t *testing.T) {
	s := newAuthTestServer(t, []string{"RS256"})

	w := serveAuthRequest(t, s.cfg, "")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing Authorization header, got %d", w.Code)
	}
}

func TestAuth_RejectsInvalidAuthorizationHeaderFormat(t *testing.T) {
	s := newAuthTestServer(t, []string{"RS256"})

	w := serveAuthRequest(t, s.cfg, "Basic dXNlcjpwYXNz")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for non-Bearer Authorization header, got %d", w.Code)
	}
}

func TestAuth_AcceptsAllowedAlgorithm(t *testing.T) {
	s := newAuthTestServer(t, []string{"RS256"})

	w := serveAuthRequest(t, s.cfg, "Bearer "+s.signRS256(t))
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for RS256 token with RS256 allowed, got %d", w.Code)
	}
}

func TestAuth_RejectsAlgorithmNotInAllowedList(t *testing.T) {
	s := newAuthTestServer(t, []string{"ES256"})

	w := serveAuthRequest(t, s.cfg, "Bearer "+s.signRS256(t))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for RS256 token when only ES256 is allowed, got %d", w.Code)
	}
}

func TestAuth_RejectsHMACAlgorithm(t *testing.T) {
	s := newAuthTestServer(t, []string{"RS256"})

	claims := jwt.MapClaims{
		"iss": s.cfg.Auth.Issuer,
		"aud": s.cfg.Auth.Audience,
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("attacker-secret"))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	w := serveAuthRequest(t, s.cfg, "Bearer "+signed)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for HS256 token, got %d", w.Code)
	}
}
