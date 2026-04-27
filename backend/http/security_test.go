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

import "testing"

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
