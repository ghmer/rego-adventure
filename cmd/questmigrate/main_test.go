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

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

// v1Pack is a complete pre-v2 pack: no version key, string lore, and the
// quest-giver placeholder image the format grew up with. It is valid in every
// other respect, so a migration of it must succeed.
const v1Pack = `{
  "meta": {
    "title": "The Policy Precinct",
    "description": "Solve crimes with logic.",
    "genre": "noir"
  },
  "ui_labels": {
    "grimoire_title": "The Grimoire",
    "hint_button": "Ask Advisor",
    "verify_button": "Apply Policy"
  },
  "prologue": [
    "The rain never stops in Rego City."
  ],
  "epilogue": [
    "The case is closed."
  ],
  "quests": [
    {
      "id": 1,
      "title": "The Leak",
      "description_lore": [
        "Spade, we got a problem.",
        "Someone is leaking case files."
      ],
      "description_task": "Keep the files shut.",
      "hints": ["Think about roles."],
      "apply_template": false,
      "template": "",
      "query": "data.play.allow",
      "tests": [
        { "id": 1, "payload": { "input": { "role": "traveller" } }, "expected_value": true }
      ]
    }
  ]
}
`

func TestMigratePackJSONAddsVersionRosterAndSpeakers(t *testing.T) {
	out, report, err := migratePackJSON("noir", []byte(v1Pack))
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	if !report.NPCSectionAdded || !report.FallbackAdded ||
		report.PrologueEntries != 1 || report.QuestLoreEntries != 2 || report.EpilogueEntries != 1 {
		t.Errorf("unexpected report: %+v", report)
	}

	var pack quest.QuestPack
	if err := json.Unmarshal(out, &pack); err != nil {
		t.Fatalf("migrated pack does not parse: %v", err)
	}
	if pack.Version != quest.FormatVersion {
		t.Errorf("version is %d, want %d", pack.Version, quest.FormatVersion)
	}
	if image, ok := pack.NPCs[quest.DefaultNPCKey]; !ok || image != defaultNPCImage {
		t.Errorf("npcs roster is %v, want %q -> %q", pack.NPCs, quest.DefaultNPCKey, defaultNPCImage)
	}
	wantPrologue := []quest.LoreEntry{{NPC: quest.DefaultNPCKey, Text: "The rain never stops in Rego City."}}
	if len(pack.Prologue) != len(wantPrologue) || pack.Prologue[0] != wantPrologue[0] {
		t.Errorf("prologue is %v, want %v", pack.Prologue, wantPrologue)
	}
	if pack.Epilogue[0].NPC != quest.DefaultNPCKey {
		t.Errorf("epilogue speaker is %q, want %q", pack.Epilogue[0].NPC, quest.DefaultNPCKey)
	}
	wantLore := []string{"Spade, we got a problem.", "Someone is leaking case files."}
	for i, entry := range pack.Quests[0].DescriptionLore {
		if entry.NPC != quest.DefaultNPCKey || entry.Text != wantLore[i] {
			t.Errorf("lore[%d] is %+v, want speaker %q and text %q", i, entry, quest.DefaultNPCKey, wantLore[i])
		}
	}
}

func TestMigratePackJSONKeepsTheAuthorsKeyOrder(t *testing.T) {
	out, _, err := migratePackJSON("noir", []byte(v1Pack))
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	// The ordered-object builder once produced duplicate keys (a pre-seeded
	// key list plus put); plain json.Unmarshal hides that behind last-wins.
	assertUniqueObjectKeys(t, out, "")

	var root object
	if err := json.Unmarshal(out, &root); err != nil {
		t.Fatalf("migrated pack does not parse as an ordered object: %v", err)
	}
	want := []string{"version", "npcs", "meta", "ui_labels", "prologue", "epilogue", "quests"}
	if strings.Join(root.keys, ",") != strings.Join(want, ",") {
		t.Errorf("top-level key order is %v, want %v", root.keys, want)
	}

	// And inside a quest: the migration touches description_lore's content,
	// not its position among the quest's keys.
	var quests []object
	if err := json.Unmarshal(root.vals["quests"], &quests); err != nil || len(quests) != 1 {
		t.Fatalf("quests do not parse: %v", err)
	}
	wantQuest := []string{"id", "title", "description_lore", "description_task", "hints",
		"apply_template", "template", "query", "tests"}
	if strings.Join(quests[0].keys, ",") != strings.Join(wantQuest, ",") {
		t.Errorf("quest key order is %v, want %v", quests[0].keys, wantQuest)
	}
}

func TestMigratePackJSONKeepsIndentationAndTrailingNewline(t *testing.T) {
	tabbed := strings.ReplaceAll(v1Pack, "  ", "\t")
	out, _, err := migratePackJSON("noir", []byte(tabbed))
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}
	if !strings.Contains(string(out), "\n\t\"meta\":") {
		t.Errorf("tab indentation was not preserved:\n%s", firstLines(out, 3))
	}
	if !strings.HasSuffix(string(out), "}\n") {
		t.Error("the trailing newline was not preserved")
	}

	noNewline := strings.TrimRight(v1Pack, "\n")
	out, _, err = migratePackJSON("noir", []byte(noNewline))
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}
	if strings.HasSuffix(string(out), "\n") {
		t.Error("a pack written without a trailing newline gained one")
	}
}

func TestMigratePackJSONRefusesPacksItCannotUnderstand(t *testing.T) {
	tests := []struct {
		name        string
		packJSON    string
		errFragment string
	}{
		{"current format already", `{"version": 2}`, "already at the current format"},
		{"newer format", `{"version": 3}`, "newer than the format"},
		{"not an object", `[1,2]`, "not a JSON object"},
		{"prologue entry is a number", `{"prologue": [7]}`, "prologue[0] is neither a v1 string nor a v2 lore object"},
		{"quests is not an array", `{"quests": {}}`, "quests must be an array"},
		{
			name: "a v1 pack the server itself refuses",
			packJSON: `{"meta": {"title": "T", "description": "D", "genre": "g"},` +
				`"ui_labels": {"grimoire_title": "G", "hint_button": "H", "verify_button": "V"},` +
				`"prologue": ["a"], "epilogue": ["b"],` +
				`"quests": [{"id": 1, "title": "Q", "description_lore": ["l"], "description_task": "t",` +
				`"tests": [{"id": 1, "payload": {"input": {}}, "expected_value": true}]}]}`,
			errFragment: "would not load",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := migratePackJSON("pack", []byte(tc.packJSON))
			if err == nil {
				t.Fatalf("expected an error mentioning %q, got none", tc.errFragment)
			}
			if !strings.Contains(err.Error(), tc.errFragment) {
				t.Errorf("expected an error mentioning %q, got: %v", tc.errFragment, err)
			}
		})
	}
}

func TestMigratePackJSONKeepsAuthoredSpeakersAndRoster(t *testing.T) {
	// A half-handed pack: a roster of its own (without the fallback speaker)
	// and a lore entry that is already an object. The migration adds the
	// fallback and wraps only the string entry.
	hybrid := `{
  "meta": {"title": "T", "description": "D", "genre": "g"},
  "ui_labels": {"grimoire_title": "G", "hint_button": "H", "verify_button": "V"},
  "npcs": {"chief": "assets/chief.png"},
  "prologue": [{ "npc": "chief", "text": "Rain again." }],
  "epilogue": ["And the rain stopped."],
  "quests": [{
    "id": 1, "title": "Q", "description_task": "t", "query": "data.play.allow",
    "description_lore": ["A string line."],
    "tests": [{"id": 1, "payload": {"input": {}}, "expected_value": true}]
  }]
}`

	out, report, err := migratePackJSON("pack", []byte(hybrid))
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}
	if report.NPCSectionAdded || !report.FallbackAdded {
		t.Errorf("report should record only the fallback addition: %+v", report)
	}
	if report.PrologueEntries != 0 {
		t.Errorf("an authored lore object was wrapped: %+v", report)
	}

	// The author's npcs section keeps its place in the file: only a roster
	// this run created moves next to the version marker.
	var root object
	if err := json.Unmarshal(out, &root); err != nil {
		t.Fatalf("migrated pack does not parse as an ordered object: %v", err)
	}
	wantOrder := []string{"meta", "ui_labels", "npcs", "prologue", "epilogue", "quests"}
	rootKeys := root.keys
	if i := root.keyIndex("version"); i == 0 {
		rootKeys = rootKeys[1:] // the marker is always first; the rest must keep their order
	}
	if strings.Join(rootKeys, ",") != strings.Join(wantOrder, ",") {
		t.Errorf("top-level key order is %v, want %v behind the version marker", rootKeys, wantOrder)
	}
	if report.PrologueEntries != 0 {
		t.Errorf("an authored lore object was wrapped: %+v", report)
	}

	var pack quest.QuestPack
	if err := json.Unmarshal(out, &pack); err != nil {
		t.Fatalf("migrated pack does not parse: %v", err)
	}
	if _, ok := pack.NPCs["chief"]; !ok {
		t.Errorf("the authored roster entry was lost: %v", pack.NPCs)
	}
	if pack.Prologue[0].NPC != "chief" {
		t.Errorf("the authored speaker changed: %+v", pack.Prologue[0])
	}
	if pack.Quests[0].DescriptionLore[0].NPC != quest.DefaultNPCKey {
		t.Errorf("the string entry did not gain the fallback speaker: %+v", pack.Quests[0].DescriptionLore[0])
	}
}

// writePack places a quests.json in dir and returns its path.
func writePack(t *testing.T, dir, content string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
	path := filepath.Join(dir, packFileName)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

func TestMigratePackDirReplacesInPlaceWithABackup(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "noir")
	packPath := writePack(t, dir, v1Pack)

	if err := migratePackDir(dir, false); err != nil {
		t.Fatalf("migratePackDir failed: %v", err)
	}

	migrated, err := os.ReadFile(packPath) // #nosec G304 -- path under t.TempDir()
	if err != nil {
		t.Fatalf("read migrated pack: %v", err)
	}
	var pack quest.QuestPack
	if err := json.Unmarshal(migrated, &pack); err != nil || pack.Version != quest.FormatVersion {
		t.Fatalf("quests.json was not migrated in place: %v (version %d)", err, pack.Version)
	}

	backup, err := os.ReadFile(packPath + backupSuffix) // #nosec G304 -- path under t.TempDir()
	if err != nil {
		t.Fatalf("the backup was not written: %v", err)
	}
	if string(backup) != v1Pack {
		t.Error("the backup does not hold the original bytes")
	}
	info, err := os.Stat(packPath)
	if err != nil {
		t.Fatalf("stat migrated pack: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("the migrated pack has mode %v, want the original -rw-------", info.Mode().Perm())
	}

	// Running again on a migrated pack is a no-op, not a clobbering.
	if err := migratePackDir(dir, false); !errors.Is(err, errCurrentFormat) {
		t.Errorf("second run returned %v, want errCurrentFormat", err)
	}
}

func TestMigratePackDirRefusesToOverwriteAnExistingBackup(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "noir")
	packPath := writePack(t, dir, v1Pack)
	if err := os.WriteFile(packPath+backupSuffix, []byte("someone else's original"), 0o600); err != nil {
		t.Fatalf("seed backup: %v", err)
	}

	err := migratePackDir(dir, false)
	if err == nil || !strings.Contains(err.Error(), backupSuffix) {
		t.Fatalf("expected an error pointing at the existing backup, got: %v", err)
	}
	untouched, _ := os.ReadFile(packPath) // #nosec G304 -- path under t.TempDir()
	if string(untouched) != v1Pack {
		t.Error("the pack file was touched although the run refused")
	}
}

func TestMigratePackDirDryRunWritesNothing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "noir")
	packPath := writePack(t, dir, v1Pack)

	if err := migratePackDir(dir, true); err != nil {
		t.Fatalf("dry run failed: %v", err)
	}

	untouched, _ := os.ReadFile(packPath) // #nosec G304 -- path under t.TempDir()
	if string(untouched) != v1Pack {
		t.Error("the dry run rewrote the pack")
	}
	if _, err := os.Stat(packPath + backupSuffix); !errors.Is(err, os.ErrNotExist) {
		t.Error("the dry run wrote a backup")
	}
}

func TestRunMigratesEveryPackOfAParentDirectory(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"noir", "fantasy"} {
		writePack(t, filepath.Join(root, name), v1Pack)
	}
	// A directory that is not a pack is left out of the scan, exactly as the
	// server's pack scan leaves it out.
	writePack(t, filepath.Join(root, "nested", "deeper"), v1Pack)

	if err := run(root, false); err != nil {
		t.Fatalf("run failed: %v", err)
	}

	for _, name := range []string{"noir", "fantasy"} {
		// #nosec G304 -- path under t.TempDir()
		content, err := os.ReadFile(filepath.Join(root, name, packFileName))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if !strings.Contains(string(content), `"version": 2`) {
			t.Errorf("pack %s was not migrated:\n%s", name, firstLines(content, 4))
		}
		if _, err := os.Stat(filepath.Join(root, name, packFileName+backupSuffix)); err != nil {
			t.Errorf("pack %s has no backup: %v", name, err)
		}
	}
}

func TestRunReportsThePacksThatCouldNotMigrate(t *testing.T) {
	root := t.TempDir()
	writePack(t, filepath.Join(root, "broken"), "{not json")
	writePack(t, filepath.Join(root, "noir"), v1Pack)

	err := run(root, false)
	if err == nil || !strings.Contains(err.Error(), "1 of 2 packs") {
		t.Fatalf("expected a summary counting one failure, got: %v", err)
	}
	// The healthy pack migrated although its sibling failed.
	// #nosec G304 -- path under t.TempDir()
	content, readErr := os.ReadFile(filepath.Join(root, "noir", packFileName))
	if readErr != nil || !strings.Contains(string(content), `"version": 2`) {
		t.Errorf("the sibling pack did not migrate: %v", readErr)
	}
}

func TestMigratePackJSONProducesTheDefaultSpeakerImageForGeneratedPacks(t *testing.T) {
	// The image the tool introduces is the one assetgen generates and the
	// old frontend hardcoded; both names must stay in lockstep.
	if defaultNPCImage != quest.NPCImagePrefix+"npc-questgiver.png" {
		t.Errorf("defaultNPCImage drifted: %q", defaultNPCImage)
	}
}

func firstLines(content []byte, n int) string {
	lines := strings.SplitN(string(content), "\n", n+1)
	if len(lines) > n {
		lines = lines[:n]
	}
	return strings.Join(lines, "\n")
}

// assertUniqueObjectKeys walks migrated JSON and reports any object whose
// key list carries the same key twice. Decoding with encoding/json cannot
// see the duplication (the decoder keeps the last value), so the walk reads
// through the tool's own ordered object.
func assertUniqueObjectKeys(t *testing.T, raw json.RawMessage, trail string) {
	t.Helper()

	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return
	}
	switch trimmed[0] {
	case '{':
		var obj object
		if err := json.Unmarshal(trimmed, &obj); err != nil {
			t.Fatalf("%s: %v", trail, err)
		}
		seen := make(map[string]bool, len(obj.keys))
		for _, key := range obj.keys {
			if seen[key] {
				t.Errorf("%s: duplicated key %q in %s", trail, key, trimmed)
				return
			}
			seen[key] = true
			assertUniqueObjectKeys(t, obj.vals[key], trail+"."+key)
		}
	case '[':
		var items []json.RawMessage
		if err := json.Unmarshal(trimmed, &items); err != nil {
			t.Fatalf("%s: %v", trail, err)
		}
		for i, item := range items {
			assertUniqueObjectKeys(t, item, fmt.Sprintf("%s[%d]", trail, i))
		}
	}
}
