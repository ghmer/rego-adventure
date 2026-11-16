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
	"os"
	"path/filepath"
	"testing"
)

// ==================== isValidPackName Tests ====================

func TestIsValidPackName(t *testing.T) {
	tests := []struct {
		name     string
		pack     string
		expected bool
	}{
		{"Simple lowercase", "fantasy", true},
		{"With hyphen", "sci-fi", true},
		{"With underscore", "my_pack", true},
		{"Alphanumeric", "pack123", true},
		{"Mixed case", "FantasyPack", true},
		{"Empty string", "", false},
		{"Parent dir traversal", "../etc/passwd", false},
		{"Embedded traversal", "packs/../secret", false},
		{"Forward slash", "pack/dir", false},
		{"Backslash", `pack\dir`, false},
		{"Hidden file dot prefix", ".hidden", false},
		{"Whitespace in name", "pack name", false},
		{"Tab in name", "pack\tname", false},
		{"Just dots", "..", false},
		{"Single dot", ".", false},
		{"Traversal at end", "pack/..", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isValidPackName(tt.pack)
			if result != tt.expected {
				t.Errorf("isValidPackName(%q) = %v, want %v", tt.pack, result, tt.expected)
			}
		})
	}
}

// ==================== isAllowedExtension Tests ====================

func TestIsAllowedExtension(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		expected bool
	}{
		{"JPG file", "image.jpg", true},
		{"PNG file", "image.png", true},
		{"CSS file", "styles.css", true},
		{"M4A audio file", "audio.m4a", true},
		{"WebP image", "image.webp", true},
		{"SVG image", "image.svg", true},
		{"Uppercase JPG", "IMAGE.JPG", true},
		{"Mixed case PNG", "Image.PNG", true},
		{"Mixed case WebP", "photo.WebP", true},
		{"JSON file blocked", "data.json", false},
		{"Rego file blocked", "policy.rego", false},
		{"Go source blocked", "main.go", false},
		{"Text file blocked", "readme.txt", false},
		{"No extension", "filename", false},
		{"Shell script blocked", "script.sh", false},
		{"Markdown blocked", "README.md", false},
		{"Binary blocked", "file.exe", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isAllowedExtension(tt.filename)
			if result != tt.expected {
				t.Errorf("isAllowedExtension(%q) = %v, want %v", tt.filename, result, tt.expected)
			}
		})
	}
}

// ==================== containsPathTraversal Tests ====================

func TestContainsPathTraversal(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{"Normal path", "fantasy/assets/image.jpg", false},
		{"Simple filename", "image.jpg", false},
		{"Subdirectory path", "assets/icons/logo.svg", false},
		{"Parent directory at start", "../etc/passwd", true},
		{"Embedded traversal", "valid/../../etc/passwd", true},
		{"Double dot at end", "valid/..", true},
		{"Double dot only", "..", true},
		{"Double dot in middle", "a/../b", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := containsPathTraversal(tt.path)
			if result != tt.expected {
				t.Errorf("containsPathTraversal(%q) = %v, want %v", tt.path, result, tt.expected)
			}
		})
	}
}

// ==================== isSensitiveFile Tests ====================

func TestIsSensitiveFile(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		expected bool
	}{
		{"Normal image", "image.jpg", false},
		{"CSS file", "styles.css", false},
		{"Audio file", "background.m4a", false},
		{"SVG file", "logo.svg", false},
		{"Solution file with dash", "solution-fantasy.md", true},
		{"Solution file with dot", "solution.md", true},
		{"Solution uppercase", "Solution-Pack.md", true},
		{"README uppercase", "README.md", true},
		{"readme lowercase", "readme.txt", true},
		{"Readme mixed case", "Readme.md", true},
		{"JSON quest file", "quests.json", true},
		{"Uppercase JSON", "QUESTS.JSON", true},
		{"Config JSON", "config.json", true},
		{"PNG not sensitive", "background.png", false},
		{"WebP not sensitive", "hero.webp", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isSensitiveFile(tt.filename)
			if result != tt.expected {
				t.Errorf("isSensitiveFile(%q) = %v, want %v", tt.filename, result, tt.expected)
			}
		})
	}
}

// TestVendoredManifestDetection: the vendorgen manifest flips the CSP into
// its vendored mode; a missing, empty or broken manifest leaves the
// CDN-allowlisting mode untouched.
func TestVendoredManifestDetection(t *testing.T) {
	vendorDir := func(t *testing.T, content string, writeManifest bool) string {
		t.Helper()
		dir := t.TempDir()
		if writeManifest {
			name := filepath.Join(dir, "manifest.json")
			// #nosec G306 -- test fixture
			if err := os.WriteFile(name, []byte(content), 0644); err != nil {
				t.Fatalf("writing manifest: %v", err)
			}
		}
		return dir
	}

	if vendored, _ := vendorStatusDir(vendorDir(t, "", false)); vendored {
		t.Error("no manifest file must not count as vendored")
	}
	if vendored, _ := vendorStatusDir(vendorDir(t, "{", true)); vendored {
		t.Error("an unparseable manifest must not count as vendored")
	}
	if vendored, _ := vendorStatusDir(vendorDir(t, `{"packages": {}, "css": {}}`, true)); vendored {
		t.Error("a manifest recording nothing must not count as vendored")
	}
	cssFixture := `{"packages": {}, "css": {"font-awesome": {"dir": "fa@1", "file": "css/all.min.css"}}}`
	if vendored, missing := vendorStatusDir(vendorDir(t, cssFixture, true)); vendored || missing != nil {
		t.Error("a css-alias-only manifest without files must not flip the mode")
	}
}

// TestVendorStatusRequiresEntryFiles: a manifest whose module packages
// all exist on disk is vendored; any missing entry file is reported by
// name and flips the mode.
func TestVendorStatusRequiresEntryFiles(t *testing.T) {
	base := t.TempDir()
	// #nosec G306 -- test fixture
	if err := os.WriteFile(filepath.Join(base, "manifest.json"), []byte(
		`{"packages": {"marked": {"dir": "marked@1", "entry": "m.js", "files": ["m.js"]},
		  "fonts": {"dir": "fonts@1", "entry": "", "files": []}}}`), 0644); err != nil {
		t.Fatalf("writing manifest: %v", err)
	}
	target := filepath.Join(base, "marked@1")
	// #nosec G301 -- test fixture
	if err := os.MkdirAll(target, 0755); err != nil {
		t.Fatalf("creating package dir: %v", err)
	}
	// #nosec G306 -- test fixture
	if err := os.WriteFile(filepath.Join(target, "m.js"), []byte("export {};"), 0644); err != nil {
		t.Fatalf("writing module: %v", err)
	}

	vendored, missing := vendorStatusDir(base)
	if !vendored || len(missing) != 0 {
		t.Errorf("a complete tree must count as vendored, got vendored=%v missing=%v", vendored, missing)
	}

	// #nosec G306 -- test fixture
	if err := os.Remove(filepath.Join(target, "m.js")); err != nil {
		t.Fatalf("removing module: %v", err)
	}
	vendored, missing = vendorStatusDir(base)
	if vendored {
		t.Error("a missing entry file must flip the mode off")
	}
	if len(missing) != 1 || missing[0] != "marked" {
		t.Errorf("the missing package should be named, got %v", missing)
	}
}
