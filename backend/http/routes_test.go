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
	nethttp "net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ghmer/rego-adventure/v2/backend/config"
	"github.com/ghmer/rego-adventure/v2/backend/quest"
	"github.com/gin-gonic/gin"
)

// ==================== SetupRoutes ====================

func newSetupRoutesServer(t *testing.T) *Server {
	t.Helper()
	cfg := &config.Config{AllowedOrigin: "http://localhost:8080"}
	srv, err := New(cfg, NewHandler(quest.NewQuestRepository(), quest.NewVerifier()))
	if err != nil {
		t.Fatalf("New server: %v", err)
	}
	return srv
}

// TestSetupRoutes_FailsWithoutFrontendDir: go test runs with the working
// directory set to this package, where frontend/adventure does not
// exist; SetupRoutes must refuse to configure a server whose import map
// hash cannot be computed rather than set up a CSP-bricked SPA.
func TestSetupRoutes_FailsWithoutFrontendDir(t *testing.T) {
	err := newSetupRoutesServer(t).SetupRoutes()
	if err == nil {
		t.Fatal("expected SetupRoutes to fail when frontend/adventure/index.html is unavailable")
	}
	if !strings.Contains(err.Error(), "import map") {
		t.Errorf("expected the error to name the import map, got: %v", err)
	}
}

// TestSetupRoutes_OKFromRepoRoot: from the repository root the shipped
// index.html is present and hashable, so SetupRoutes must succeed.
func TestSetupRoutes_OKFromRepoRoot(t *testing.T) {
	t.Chdir("../..")

	if err := newSetupRoutesServer(t).SetupRoutes(); err != nil {
		t.Fatalf("SetupRoutes failed from the repository root: %v", err)
	}
}

// ==================== SPA handler ====================

// newSPATestRouter serves a temp-dir SPA with an /api group, mirroring
// how SetupRoutes composes the API group and the NoRoute SPA handler.
func newSPATestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>SPA</html>"), 0o600); err != nil {
		t.Fatalf("failed to write index.html: %v", err)
	}

	router := gin.New()
	api := router.Group("/api")
	api.GET("/packs", func(c *gin.Context) { c.JSON(nethttp.StatusOK, gin.H{}) })
	router.NoRoute(createSPAHandler(os.DirFS(dir)))
	return router
}

func TestSPAHandler_UnknownAPIPathsGetJSON404(t *testing.T) {
	router := newSPATestRouter(t)

	// Unmatched /api/* paths must not be shadowed by the SPA page: a
	// client that requested an API resource needs a JSON 404.
	for _, path := range []string{"/api/does-not-exist", "/api/", "/api/packs/x/y/z"} {
		w := httptest.NewRecorder()
		req, _ := nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, path, nil)
		router.ServeHTTP(w, req)

		if w.Code != nethttp.StatusNotFound {
			t.Errorf("%s: expected 404, got %d", path, w.Code)
			continue
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Errorf("%s: expected JSON body, got %q", path, w.Body.String())
		}
	}
}

func TestSPAHandler_NonAPIUnknownPathsServeIndex(t *testing.T) {
	router := newSPATestRouter(t)

	w := httptest.NewRecorder()
	req, _ := nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/some/client/route", nil)
	router.ServeHTTP(w, req)

	if w.Code != nethttp.StatusOK {
		t.Errorf("expected 200 with index.html for a client-side route, got %d", w.Code)
	}
	if w.Body.String() != "<html>SPA</html>" {
		t.Errorf("expected index.html body, got %q", w.Body.String())
	}
}

// ==================== resolveContained ====================

func TestResolveContained_BlocksTraversalAndSymlinkEscape(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()

	if err := os.WriteFile(filepath.Join(base, "good.png"), []byte("png"), 0o600); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}

	// Normal in-base path resolves. Compare against the symlink-resolved
	// base: on macOS the temp dir itself lives under a symlinked path.
	resolvedBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		t.Fatalf("failed to resolve base: %v", err)
	}
	got, ok := resolveContained(base, "good.png")
	if !ok || got != filepath.Join(resolvedBase, "good.png") {
		t.Errorf("expected good.png to resolve inside base, got %q ok=%v", got, ok)
	}

	// Lexical traversal is blocked.
	if _, ok := resolveContained(base, "../secret"); ok {
		t.Error("expected lexical traversal to be blocked")
	}

	// A symlink pointing outside the base directory is blocked even
	// though the lexical join stays inside.
	linkPath := filepath.Join(base, "link.png")
	if err := os.Symlink(filepath.Join(outside, "secret.png"), linkPath); err != nil {
		t.Skipf("symlinks not supported on this platform: %v", err)
	}
	if _, ok := resolveContained(base, "link.png"); ok {
		t.Error("expected symlink escaping the base directory to be blocked")
	}
}

// ==================== serveSafeFile ====================

func TestServeSafeFile_SVGGetsLockdownCSP(t *testing.T) {
	dir := t.TempDir()
	svgPath := filepath.Join(dir, "art.svg")
	if err := os.WriteFile(svgPath, []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), 0o600); err != nil {
		t.Fatalf("failed to write svg: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/quests/p/assets/art.svg", nil)

	(&Server{}).serveSafeFile(c, dir, "art.svg", isAllowedExtension, "")

	if w.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 serving an allowed svg, got %d", w.Code)
	}
	csp := w.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("expected a lockdown CSP header on svg responses")
	}
	want := "default-src 'none'; sandbox; form-action 'none'"
	if csp != want {
		t.Errorf("expected CSP %q, got %q", want, csp)
	}
}

func TestServeSafeFile_NonSVGHasNoPerResourceCSP(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pic.png"), []byte("png"), 0o600); err != nil {
		t.Fatalf("failed to write png: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/quests/p/assets/pic.png", nil)

	(&Server{}).serveSafeFile(c, dir, "pic.png", isAllowedExtension, "")

	if w.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 serving png, got %d", w.Code)
	}
	if csp := w.Header().Get("Content-Security-Policy"); csp != "" {
		t.Errorf("expected no per-resource CSP on png responses, got %q", csp)
	}
}

func TestServeSafeFile_SymlinkedAssetRejected(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()

	// A dangling symlink pointing at a path outside the base must not
	// leak that path's existence via c.File's error handling.
	linkPath := filepath.Join(dir, "escape.png")
	if err := os.Symlink(filepath.Join(outside, "secret.png"), linkPath); err != nil {
		t.Skipf("symlinks not supported on this platform: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/quests/p/assets/escape.png", nil)

	(&Server{}).serveSafeFile(c, dir, "escape.png", isAllowedExtension, "")

	// The symlink itself is rejected before serving (403).
	if w.Code != nethttp.StatusForbidden {
		t.Fatalf("expected 403 for a symlinked asset path, got %d", w.Code)
	}
}

// ==================== Route protection matrix ====================

// probePackName is the pack directory the route protection tests
// materialize under the gitignored frontend/quests directory.
const probePackName = "probe-pack"

// createProbePack writes the minimal pack media and stylesheet served by
// the quest asset routes.
func createProbePack(t *testing.T) {
	t.Helper()
	pack := filepath.Join("frontend", "quests", probePackName)
	t.Cleanup(func() { _ = os.RemoveAll(pack) })
	if err := os.MkdirAll(filepath.Join(pack, "assets"), 0o750); err != nil {
		t.Fatalf("failed to create probe pack directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(pack, "assets", "picture.png"), []byte("png"), 0o600); err != nil {
		t.Fatalf("failed to write probe pack asset: %v", err)
	}
	if err := os.WriteFile(filepath.Join(pack, "theme.css"), []byte("body{}"), 0o600); err != nil {
		t.Fatalf("failed to write probe pack stylesheet: %v", err)
	}
}

// newProtectedRoutesServer composes the real route setup with an auth
// enabled configuration and a probe pack on disk.
func newProtectedRoutesServer(t *testing.T) (*Server, string) {
	t.Helper()
	t.Chdir("../..")
	createProbePack(t)

	s := newAuthTestServer(t, []string{"RS256"})
	s.cfg.AllowedOrigin = "https://adventure.example.com"
	srv, err := New(s.cfg, NewHandler(quest.NewQuestRepository(), quest.NewVerifier()))
	if err != nil {
		t.Fatalf("New server: %v", err)
	}
	if err := srv.SetupRoutes(); err != nil {
		t.Fatalf("SetupRoutes: %v", err)
	}
	return srv, s.signRS256(t)
}

// TestPublicRoutesReachableWithoutAuthentication: the pre-login surface
// must answer without a bearer token. A want value of -1 asserts any
// answer except 401: /callback's exact code comes from FileFromFS
// redirect internals that this test does not pin. Unknown /api paths
// must answer a JSON body, because the SPA fallback never serves HTML
// for API requests.
func TestPublicRoutesReachableWithoutAuthentication(t *testing.T) {
	srv, _ := newProtectedRoutesServer(t)

	cases := []struct {
		path string
		want int
	}{
		{"/config", nethttp.StatusOK},
		{"/health", nethttp.StatusOK},
		{"/callback", -1},
		{"/", nethttp.StatusOK},
		{"/impressum.html", nethttp.StatusOK},
		{"/public/favicon.ico", nethttp.StatusOK},
		{"/styles/theme.css", nethttp.StatusOK},
		{"/shared/css/base.css", nethttp.StatusOK},
		{"/api/does-not-exist", nethttp.StatusNotFound},
	}

	for _, tc := range cases {
		w := httptest.NewRecorder()
		req, _ := nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, tc.path, nil)
		srv.router.ServeHTTP(w, req)
		if tc.want == -1 {
			if w.Code == nethttp.StatusUnauthorized {
				t.Errorf("%s: public route rejected with %d", tc.path, w.Code)
			}
			continue
		}
		if w.Code != tc.want {
			t.Errorf("%s: expected %d, got %d", tc.path, tc.want, w.Code)
			continue
		}
		if tc.path == "/api/does-not-exist" {
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Errorf("%s: expected a JSON body, got %q", tc.path, w.Body.String())
			}
		}
	}
}

// TestNewRegisteredRoutesDefaultToProtected: the deny-by-default
// property. A route registered outside publicRoutePaths is gated by the
// global auth middleware without any per-route wiring.
func TestNewRegisteredRoutesDefaultToProtected(t *testing.T) {
	srv, token := newProtectedRoutesServer(t)

	srv.router.GET("/future-admin", func(c *gin.Context) {
		c.Status(nethttp.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/future-admin", nil)
	srv.router.ServeHTTP(w, req)
	if w.Code != nethttp.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", w.Code)
	}

	w = httptest.NewRecorder()
	req, _ = nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/future-admin", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	srv.router.ServeHTTP(w, req)
	if w.Code != nethttp.StatusOK {
		t.Errorf("expected 200 with token, got %d", w.Code)
	}
}

// TestProtectedRoutesRequireBearerToken: registered data routes answer
// 401 without a token and 200 with a valid one.
func TestProtectedRoutesRequireBearerToken(t *testing.T) {
	srv, token := newProtectedRoutesServer(t)

	for _, path := range []string{
		"/api/packs",
		"/quests/" + probePackName + "/assets/picture.png",
		"/quests/" + probePackName + "/theme.css",
	} {
		w := httptest.NewRecorder()
		req, _ := nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, path, nil)
		srv.router.ServeHTTP(w, req)
		if w.Code != nethttp.StatusUnauthorized {
			t.Errorf("%s: expected 401 without token, got %d", path, w.Code)
		}

		w = httptest.NewRecorder()
		req, _ = nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		srv.router.ServeHTTP(w, req)
		if w.Code != nethttp.StatusOK {
			t.Errorf("%s: expected 200 with token, got %d", path, w.Code)
		}
	}
}

// TestProtectedMediaStaysOutOfSharedCaches: token-protected quest media
// must carry a private cache directive.
func TestProtectedMediaStaysOutOfSharedCaches(t *testing.T) {
	srv, token := newProtectedRoutesServer(t)

	w := httptest.NewRecorder()
	req, _ := nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/quests/"+probePackName+"/assets/picture.png", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	srv.router.ServeHTTP(w, req)

	if w.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 for probe asset, got %d", w.Code)
	}
	if cc := w.Header().Get("Cache-Control"); !strings.Contains(cc, "private") {
		t.Errorf("expected a private Cache-Control on protected media, got %q", cc)
	}
}

// TestOpenModeKeepsQuestMediaAccessible: with authentication disabled,
// quest media and the API serve without a token.
func TestOpenModeKeepsQuestMediaAccessible(t *testing.T) {
	t.Chdir("../..")
	createProbePack(t)

	cfg := &config.Config{
		AllowedOrigin: "https://adventure.example.com",
		Auth:          config.AuthConfig{Enabled: false},
	}
	srv, err := New(cfg, NewHandler(quest.NewQuestRepository(), quest.NewVerifier()))
	if err != nil {
		t.Fatalf("New server: %v", err)
	}
	if err := srv.SetupRoutes(); err != nil {
		t.Fatalf("SetupRoutes: %v", err)
	}

	for _, path := range []string{
		"/quests/" + probePackName + "/assets/picture.png",
		"/quests/" + probePackName + "/theme.css",
		"/api/packs",
	} {
		w := httptest.NewRecorder()
		req, _ := nethttp.NewRequestWithContext(t.Context(), nethttp.MethodGet, path, nil)
		srv.router.ServeHTTP(w, req)
		if w.Code != nethttp.StatusOK {
			t.Errorf("%s: expected 200 in open mode, got %d", path, w.Code)
		}
	}
}
