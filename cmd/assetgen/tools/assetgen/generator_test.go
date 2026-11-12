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

package assetgen

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// generateTo runs GenerateTheme into a fresh temporary directory.
func generateTo(t *testing.T, themeName string) string {
	t.Helper()

	out := t.TempDir()
	if err := GenerateTheme(themeName, out); err != nil {
		t.Fatalf("GenerateTheme(%q) returned error: %v", themeName, err)
	}
	return filepath.Join(out, themeName)
}

func TestGenerateThemeWritesPlayablePlaceholderTrack(t *testing.T) {
	pack := generateTo(t, "placeholderpack")

	data, err := os.ReadFile(filepath.Join(pack, "assets", "bg-music.m4a")) // #nosec G304 -- path under t.TempDir()
	if err != nil {
		t.Fatalf("reading placeholder track: %v", err)
	}

	// An empty file is what generated packs shipped before: the media
	// element refuses it, so the music control can never play.
	if len(data) < 16 {
		t.Fatalf("placeholder track is %d bytes, want a playable container", len(data))
	}
	if got := string(data[4:8]); got != "ftyp" {
		t.Errorf("bytes 4-8 are %q, want the ftyp box type", got)
	}
	if size := binary.BigEndian.Uint32(data[0:4]); int(size) > len(data) {
		t.Errorf("first box declares size %d but the file holds %d bytes", size, len(data))
	}
	for _, box := range []string{"moov", "mdat", "mp4a"} {
		if !bytes.Contains(data, []byte(box)) {
			t.Errorf("placeholder track has no %q box, it cannot decode to audio", box)
		}
	}
}

func TestGenerateThemeWritesPackScaffolding(t *testing.T) {
	pack := generateTo(t, "scaffoldpack")

	for _, name := range []string{
		"quests.json",
		"theme.css",
		"custom.css",
		"README.md",
		filepath.Join("assets", "bg-adventure.jpg"),
		filepath.Join("assets", "hero-avatar.png"),
		filepath.Join("assets", "npc-questgiver.png"),
		filepath.Join("assets", "icon-success.png"),
		filepath.Join("assets", "icon-failure.png"),
		filepath.Join("assets", "perfect_score.png"),
	} {
		if _, err := os.Stat(filepath.Join(pack, name)); err != nil {
			t.Errorf("expected %s to exist: %v", name, err)
		}
	}
}

func TestGenerateThemeRejectsEmptyArguments(t *testing.T) {
	if err := GenerateTheme("", t.TempDir()); err == nil {
		t.Error("GenerateTheme with an empty theme name returned no error")
	}
	if err := GenerateTheme("somepack", ""); err == nil {
		t.Error("GenerateTheme with an empty output directory returned no error")
	}
}

func TestGenerateThemeRejectsNamesEscapingOutputDir(t *testing.T) {
	out := t.TempDir()

	for _, themeName := range []string{"..", ".", "../escape", "a/b"} {
		if err := GenerateTheme(themeName, out); err == nil {
			t.Errorf("GenerateTheme(%q) accepted a name that escapes the output directory", themeName)
		}
	}
}
