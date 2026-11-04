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

package quest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writePackFixture creates a pack directory containing quests.json.
func writePackFixture(t *testing.T, dir, packID string, pack QuestPack) {
	t.Helper()
	packDir := filepath.Join(dir, packID)
	if err := os.MkdirAll(packDir, 0o750); err != nil {
		t.Fatalf("failed to create pack dir: %v", err)
	}
	data, err := json.Marshal(pack)
	if err != nil {
		t.Fatalf("failed to marshal pack: %v", err)
	}
	if err := os.WriteFile(filepath.Join(packDir, "quests.json"), data, 0o600); err != nil {
		t.Fatalf("failed to write quests.json: %v", err)
	}
}

func TestLoadPacksFromDir_LoadsValidPacks(t *testing.T) {
	dir := t.TempDir()
	writePackFixture(t, dir, "alpha", createValidQuestPack())
	writePackFixture(t, dir, "beta", createValidQuestPack())

	repo := NewQuestRepository()
	loaded, warnings, err := LoadPacksFromDir(repo, dir)
	if err != nil {
		t.Fatalf("LoadPacksFromDir failed: %v", err)
	}
	if loaded != 2 {
		t.Errorf("expected 2 loaded packs, got %d", loaded)
	}
	if len(warnings) != 0 {
		t.Errorf("expected no warnings, got %v", warnings)
	}
	if repo.GetNumberOfPacks() != 2 {
		t.Errorf("expected 2 packs in repository, got %d", repo.GetNumberOfPacks())
	}
}

func TestLoadPacksFromDir_SkipsInvalidEntriesWithWarnings(t *testing.T) {
	dir := t.TempDir()
	writePackFixture(t, dir, "good", createValidQuestPack())

	// Hidden directory: invalid pack ID, must be skipped.
	writePackFixture(t, dir, ".hidden", createValidQuestPack())
	// Directory name with whitespace: invalid pack ID.
	writePackFixture(t, dir, "bad name", createValidQuestPack())
	// Directory without quests.json.
	if err := os.MkdirAll(filepath.Join(dir, "no-json"), 0o750); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	// Invalid pack content.
	packDir := filepath.Join(dir, "broken")
	if err := os.MkdirAll(packDir, 0o750); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(packDir, "quests.json"), []byte("{not-json"), 0o600); err != nil {
		t.Fatalf("failed to write quests.json: %v", err)
	}
	// A plain file at the top level is not a pack directory at all.
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("text"), 0o600); err != nil {
		t.Fatalf("failed to write README: %v", err)
	}

	repo := NewQuestRepository()
	loaded, warnings, err := LoadPacksFromDir(repo, dir)
	if err != nil {
		t.Fatalf("LoadPacksFromDir failed: %v", err)
	}
	if loaded != 1 {
		t.Errorf("expected 1 loaded pack, got %d", loaded)
	}
	// .hidden, "bad name", no-json, broken -> four warnings
	if len(warnings) != 4 {
		t.Errorf("expected 4 warnings, got %d: %v", len(warnings), warnings)
	}
	if _, ok := repo.GetPack("good"); !ok {
		t.Error("expected the valid pack to be loaded despite invalid siblings")
	}
}

func TestLoadPacksFromDir_MissingDirectoryIsFatal(t *testing.T) {
	repo := NewQuestRepository()
	_, _, err := LoadPacksFromDir(repo, filepath.Join(t.TempDir(), "does-not-exist"))
	if err == nil {
		t.Fatal("expected an error for a missing quests directory, got nil")
	}
}
