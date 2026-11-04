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
	"testing"

	"github.com/gin-gonic/gin"
)

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
