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
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ==================== parseAllowedAlgorithms Tests ====================

func TestParseAllowedAlgorithms_DefaultsToRS256(t *testing.T) {
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", "")

	cfg := &Config{}
	if err := cfg.parseAllowedAlgorithms(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []string{"RS256"}
	if strings.Join(cfg.Auth.AllowedAlgorithms, ",") != strings.Join(want, ",") {
		t.Errorf("expected default %v, got %v", want, cfg.Auth.AllowedAlgorithms)
	}
}

func TestParseAllowedAlgorithms_ParsesTrimmedList(t *testing.T) {
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", " es256 , RS384,EdDSA ,, ")

	cfg := &Config{}
	if err := cfg.parseAllowedAlgorithms(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []string{"ES256", "RS384", "EdDSA"}
	if strings.Join(cfg.Auth.AllowedAlgorithms, ",") != strings.Join(want, ",") {
		t.Errorf("expected %v, got %v", want, cfg.Auth.AllowedAlgorithms)
	}
}

func TestParseAllowedAlgorithms_DeduplicatesEntries(t *testing.T) {
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", "RS256,rs256,RS256")

	cfg := &Config{}
	if err := cfg.parseAllowedAlgorithms(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []string{"RS256"}
	if strings.Join(cfg.Auth.AllowedAlgorithms, ",") != strings.Join(want, ",") {
		t.Errorf("expected %v, got %v", want, cfg.Auth.AllowedAlgorithms)
	}
}

func TestParseAllowedAlgorithms_RejectsSymmetricAlgorithms(t *testing.T) {
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", "RS256,HS256")

	cfg := &Config{}
	err := cfg.parseAllowedAlgorithms()
	if err == nil {
		t.Fatal("expected error for symmetric algorithm, got nil")
	}
	if !strings.Contains(err.Error(), "HS256") {
		t.Errorf("error should mention the rejected algorithm, got: %v", err)
	}
}

func TestParseAllowedAlgorithms_RejectsUnknownNames(t *testing.T) {
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", "FAKE512")

	cfg := &Config{}
	err := cfg.parseAllowedAlgorithms()
	if err == nil {
		t.Fatal("expected error for unknown algorithm, got nil")
	}
}

func TestParseAllowedAlgorithms_RejectsEmptyEntriesOnly(t *testing.T) {
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", ", , ,")

	cfg := &Config{}
	if err := cfg.parseAllowedAlgorithms(); err == nil {
		t.Fatal("expected error for empty algorithm list, got nil")
	}
}

// ==================== validateAuthRequirements Tests ====================

func TestValidateAuthRequirements_AllSet(t *testing.T) {
	cfg := &Config{Auth: AuthConfig{
		Issuer:       "https://id.example.com/realms/demo",
		Audience:     "rego-adventure",
		DiscoveryURL: "https://id.example.com/realms/demo/.well-known/openid-configuration",
	}}
	if err := cfg.validateAuthRequirements(); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidateAuthRequirements_MissingIssuer(t *testing.T) {
	cfg := &Config{Auth: AuthConfig{
		Audience:     "rego-adventure",
		DiscoveryURL: "https://id.example.com/realms/demo/.well-known/openid-configuration",
	}}
	err := cfg.validateAuthRequirements()
	if err == nil || !strings.Contains(err.Error(), "AUTH_ISSUER") {
		t.Errorf("expected AUTH_ISSUER requirement error, got: %v", err)
	}
}

func TestValidateAuthRequirements_MissingAudience(t *testing.T) {
	cfg := &Config{Auth: AuthConfig{
		Issuer:       "https://id.example.com/realms/demo",
		DiscoveryURL: "https://id.example.com/realms/demo/.well-known/openid-configuration",
	}}
	err := cfg.validateAuthRequirements()
	if err == nil || !strings.Contains(err.Error(), "AUTH_AUDIENCE") {
		t.Errorf("expected AUTH_AUDIENCE requirement error, got: %v", err)
	}
}

func TestValidateAuthRequirements_MissingDiscoveryURL(t *testing.T) {
	cfg := &Config{Auth: AuthConfig{
		Issuer:   "https://id.example.com/realms/demo",
		Audience: "rego-adventure",
	}}
	err := cfg.validateAuthRequirements()
	if err == nil || !strings.Contains(err.Error(), "AUTH_DISCOVERY_URL") {
		t.Errorf("expected AUTH_DISCOVERY_URL requirement error, got: %v", err)
	}
}

// ==================== Load Integration Tests ====================

func TestLoad_ParsesAllowedAlgorithms(t *testing.T) {
	t.Setenv("DOMAIN", "http://localhost:8080")
	t.Setenv("AUTH_ENABLED", "false")
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", "ES256, RS384")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	want := []string{"ES256", "RS384"}
	if strings.Join(cfg.Auth.AllowedAlgorithms, ",") != strings.Join(want, ",") {
		t.Errorf("expected %v, got %v", want, cfg.Auth.AllowedAlgorithms)
	}
}

func TestLoad_DefaultsAllowedAlgorithms(t *testing.T) {
	t.Setenv("DOMAIN", "http://localhost:8080")
	t.Setenv("AUTH_ENABLED", "false")
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	want := []string{"RS256"}
	if strings.Join(cfg.Auth.AllowedAlgorithms, ",") != strings.Join(want, ",") {
		t.Errorf("expected default %v, got %v", want, cfg.Auth.AllowedAlgorithms)
	}
}

func TestLoad_RejectsUnsupportedAlgorithm(t *testing.T) {
	t.Setenv("DOMAIN", "http://localhost:8080")
	t.Setenv("AUTH_ENABLED", "false")
	t.Setenv("AUTH_ALLOWED_ALGORITHMS", "none")

	if _, err := Load(); err == nil {
		t.Fatal("expected Load to fail for unsupported algorithm, got nil")
	}
}

func TestLoad_RequiresIssuerAndAudienceWhenAuthEnabled(t *testing.T) {
	t.Setenv("DOMAIN", "http://localhost:8080")
	t.Setenv("AUTH_ENABLED", "true")
	t.Setenv("AUTH_DISCOVERY_URL", "https://id.example.com/realms/demo/.well-known/openid-configuration")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "AUTH_ISSUER") {
		t.Errorf("expected AUTH_ISSUER requirement error, got: %v", err)
	}

	t.Setenv("AUTH_ISSUER", "https://id.example.com/realms/demo")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "AUTH_AUDIENCE") {
		t.Errorf("expected AUTH_AUDIENCE requirement error, got: %v", err)
	}
}

func TestInitializeJWKS_ReportsNonOKDiscoveryStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("<html>gateway error</html>"))
	}))
	t.Cleanup(server.Close)

	cfg := &Config{Auth: AuthConfig{DiscoveryURL: server.URL + "/.well-known/openid-configuration"}}
	err := cfg.initializeJWKS()
	if err == nil {
		t.Fatal("expected initializeJWKS to fail for a non-200 discovery response, got nil")
	}
	if !strings.Contains(err.Error(), "status 503") {
		t.Errorf("expected error to report the HTTP status, got: %v", err)
	}
	if strings.Contains(err.Error(), "decode") {
		t.Errorf("expected a status error, not a decode error, got: %v", err)
	}
}
