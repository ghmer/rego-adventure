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

// TestGenerateThemeRollsBackAFailedStep: a later step that cannot write must
// not leave the earlier steps' output behind as a half-written pack, and must
// not touch what was already in the pack directory.
func TestGenerateThemeRollsBackAFailedStep(t *testing.T) {
	out := t.TempDir()
	theme := "rollbackpack"
	pack := filepath.Join(out, theme)

	// A directory where theme.css belongs: quests.json and the assets are
	// generated first, then theme.css fails to open.
	blocker := filepath.Join(pack, "theme.css")
	if err := os.MkdirAll(blocker, 0750); err != nil {
		t.Fatalf("failed to place the blocker: %v", err)
	}

	if err := GenerateTheme(theme, out); err == nil {
		t.Fatal("GenerateTheme succeeded although theme.css cannot be written")
	}

	for _, name := range []string{
		"quests.json",
		filepath.Join("assets", "bg-adventure.jpg"),
		filepath.Join("assets", "hero-avatar.png"),
		filepath.Join("assets", "bg-music.m4a"),
	} {
		if _, err := os.Stat(filepath.Join(pack, name)); !os.IsNotExist(err) {
			t.Errorf("%s survived the failed run (stat: %v)", name, err)
		}
	}

	if _, err := os.Stat(blocker); err != nil {
		t.Errorf("the pack directory that was there before the run is gone: %v", err)
	}
}

// TestGenerateThemeRestoresAnOverwrittenFile: a step that wrote into a file the
// pack author already had must give its content back when a later step fails.
func TestGenerateThemeRestoresAnOverwrittenFile(t *testing.T) {
	out := t.TempDir()
	theme := "restorepack"
	pack := filepath.Join(out, theme)

	authored := []byte("{\"authored\":true}")
	if err := os.MkdirAll(pack, 0750); err != nil {
		t.Fatalf("failed to create pack directory: %v", err)
	}
	authoredPath := filepath.Join(pack, "quests.json")
	if err := os.WriteFile(authoredPath, authored, 0600); err != nil { // #nosec G304 -- path under t.TempDir()
		t.Fatalf("failed to place the authored file: %v", err)
	}
	blocker := filepath.Join(pack, "theme.css")
	if err := os.MkdirAll(blocker, 0750); err != nil {
		t.Fatalf("failed to place the blocker: %v", err)
	}

	if err := GenerateTheme(theme, out); err == nil {
		t.Fatal("GenerateTheme succeeded although theme.css cannot be written")
	}

	got, err := os.ReadFile(authoredPath) // #nosec G304 -- path under t.TempDir()
	if err != nil {
		t.Fatalf("the authored file is gone: %v", err)
	}
	if string(got) != string(authored) {
		t.Errorf("the authored file holds %q, want %q", got, authored)
	}
	info, err := os.Stat(authoredPath)
	if err != nil {
		t.Fatalf("failed to stat the authored file: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("the authored file has mode %v, want -rw-------", info.Mode().Perm())
	}
}

// TestGenerateThemeLeavesPackContentsOnAnEarlyFailure: when the very first
// step fails, the pack directory keeps exactly what it held before.
func TestGenerateThemeLeavesPackContentsOnAnEarlyFailure(t *testing.T) {
	out := t.TempDir()
	theme := "earlyfailpack"
	pack := filepath.Join(out, theme)

	blocker := filepath.Join(pack, "assets")
	if err := os.MkdirAll(pack, 0750); err != nil {
		t.Fatalf("failed to create pack directory: %v", err)
	}
	if err := os.WriteFile(blocker, []byte("not a directory"), 0600); err != nil { // #nosec G304 -- path under t.TempDir()
		t.Fatalf("failed to place the blocker: %v", err)
	}

	if err := GenerateTheme(theme, out); err == nil {
		t.Fatal("GenerateTheme succeeded although the assets directory cannot be created")
	}

	entries, err := os.ReadDir(pack)
	if err != nil {
		t.Fatalf("failed to read the pack directory: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "assets" {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("pack directory holds %v, want only the pre-existing assets file", names)
	}
}
