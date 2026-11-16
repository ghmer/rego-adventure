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
	"io"
	"slices"
	"strings"

	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

// defaultNPCImage is the image the migration gives default_npc. Every pre-v2
// pack carries this placeholder as its single quest-giver portrait - the same
// image the frontend used for every lore screen - so a migrated pack looks
// exactly as it did before lore lines gained speakers.
const defaultNPCImage = quest.NPCImagePrefix + "npc-questgiver.png"

// errCurrentFormat reports a pack that already declares the format the
// server loads. It is not a failure: the caller reports "left alone".
var errCurrentFormat = errors.New("already at the current format")

// packReport counts what a migration changed, for the per-pack line the tool
// prints.
type packReport struct {
	PrologueEntries  int
	QuestLoreEntries int
	EpilogueEntries  int
	NPCSectionAdded  bool
	FallbackAdded    bool
}

// String renders the counts as one sentence. A pack that needed nothing
// beyond the format marker reads honestly: zero wrapped entries is a fact,
// not an error, and LoadPack has already refused a pack with no lore at all.
func (r packReport) String() string {
	parts := make([]string, 0, 3)
	switch {
	case r.NPCSectionAdded:
		parts = append(parts, fmt.Sprintf("npcs section added with %q -> %s", quest.DefaultNPCKey, defaultNPCImage))
	case r.FallbackAdded:
		parts = append(parts, fmt.Sprintf("npcs roster gained the fallback speaker %q", quest.DefaultNPCKey))
	}
	parts = append(parts, fmt.Sprintf(
		"%d prologue, %d quest and %d epilogue lore entries given %q as their speaker",
		r.PrologueEntries, r.QuestLoreEntries, r.EpilogueEntries, quest.DefaultNPCKey))
	return strings.Join(parts, "; ")
}

// migratePackJSON rewrites one pre-v2 quests.json to the current format.
// The transformation is structural, never interpretive: the version marker
// is set, an npc roster with default_npc is added, and every lore entry that
// is still a bare string becomes a lore object speaking as default_npc.
// Entries that are already objects are left exactly as they are, so running
// the tool on a half-handed pack cannot lose an authored speaker. The
// migrated bytes go through the server's own load path before they are
// returned: the tool refuses to hand back a pack the server would refuse,
// and says why.
func migratePackJSON(packID string, data []byte) ([]byte, packReport, error) {
	var report packReport

	var probe struct {
		Version *int `json:"version"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return nil, report, fmt.Errorf("quests.json is not a JSON object this tool can read: %w", err)
	}
	if probe.Version != nil {
		switch {
		case *probe.Version == quest.FormatVersion:
			return nil, report, errCurrentFormat
		case *probe.Version > quest.FormatVersion:
			return nil, report, fmt.Errorf(
				"quests.json format version %d is newer than the format %d this tool migrates to",
				*probe.Version, quest.FormatVersion)
		}
	}

	var root object
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, report, fmt.Errorf("quests.json must hold a JSON object: %w", err)
	}

	npcSectionAdded, fallbackAdded, err := ensureDefaultNPC(&root)
	if err != nil {
		return nil, report, err
	}
	report.NPCSectionAdded = npcSectionAdded
	report.FallbackAdded = fallbackAdded

	report.PrologueEntries, err = migrateLoreList(&root, "prologue")
	if err != nil {
		return nil, report, err
	}
	report.EpilogueEntries, err = migrateLoreList(&root, "epilogue")
	if err != nil {
		return nil, report, err
	}
	report.QuestLoreEntries, err = migrateQuestLore(&root)
	if err != nil {
		return nil, report, err
	}

	if err := root.putFirst("version", quest.FormatVersion); err != nil {
		return nil, report, err
	}
	if npcSectionAdded {
		// A roster this run created belongs beside the format marker it
		// describes; one the author already had keeps its own place.
		root.moveAfter("npcs", "version")
	}

	out, err := marshalLikeOriginal(data, &root)
	if err != nil {
		return nil, report, err
	}

	repo := quest.NewQuestRepository()
	if err := repo.LoadPack(packID, out); err != nil {
		return nil, report, fmt.Errorf("the migrated pack would not load: %w", err)
	}
	return out, report, nil
}

// ensureDefaultNPC makes sure the pack's npcs roster declares default_npc:
// the pre-v2 speaker. A pack without the section gets one (the first result
// reports that); a pack whose author already added characters keeps them and
// only gains the fallback (the second result reports that).
func ensureDefaultNPC(root *object) (bool, bool, error) {
	raw, present := root.get("npcs")
	if !present {
		roster := object{}
		if err := roster.put(quest.DefaultNPCKey, defaultNPCImage); err != nil {
			return false, false, err
		}
		return true, true, root.put("npcs", roster)
	}

	var roster object
	if err := json.Unmarshal(raw, &roster); err != nil {
		return false, false, fmt.Errorf("npcs must be a JSON object of character name to image path: %w", err)
	}
	if _, declared := roster.get(quest.DefaultNPCKey); declared {
		return false, false, nil
	}
	if err := roster.put(quest.DefaultNPCKey, defaultNPCImage); err != nil {
		return false, false, err
	}
	return false, true, root.put("npcs", roster)
}

// migrateQuestLore wraps the description_lore of every quest. It rebuilds
// each quest element as an ordered object so untouched keys keep their
// position in the file.
func migrateQuestLore(root *object) (int, error) {
	raw, present := root.get("quests")
	if !present {
		return 0, nil
	}
	var quests []json.RawMessage
	if err := json.Unmarshal(raw, &quests); err != nil {
		return 0, fmt.Errorf("quests must be an array: %w", err)
	}

	wrapped := 0
	for i, questRaw := range quests {
		var questObj object
		if err := json.Unmarshal(questRaw, &questObj); err != nil {
			return 0, fmt.Errorf("quests[%d] must be a JSON object: %w", i, err)
		}
		n, err := migrateLoreList(&questObj, "description_lore")
		if err != nil {
			return 0, fmt.Errorf("quest %d: %w", i+1, err)
		}
		if n == 0 {
			continue
		}
		wrapped += n
		rewritten, err := json.Marshal(questObj)
		if err != nil {
			return 0, err
		}
		quests[i] = rewritten
	}
	if wrapped == 0 {
		return 0, nil
	}
	return wrapped, root.put("quests", quests)
}

// migrateLoreList turns every bare string of one lore array into a lore
// object speaking as default_npc, and leaves objects alone. An element that
// is neither is neither a v1 pack nor a v2 one; refusing to guess keeps an
// author's typo from becoming a silent rewrite of their story.
func migrateLoreList(container *object, field string) (int, error) {
	raw, present := container.get(field)
	if !present {
		return 0, nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return 0, fmt.Errorf("%s must be an array: %w", field, err)
	}

	wrapped := 0
	for i, item := range items {
		if trimmed := bytes.TrimSpace(item); len(trimmed) > 0 && trimmed[0] == '{' {
			continue
		}
		var text string
		if err := json.Unmarshal(item, &text); err != nil {
			return 0, fmt.Errorf("%s[%d] is neither a v1 string nor a v2 lore object", field, i)
		}
		entry, err := loreEntryFor(defaultNPCKey, item)
		if err != nil {
			return 0, err
		}
		items[i] = entry
		wrapped++
	}
	if wrapped == 0 {
		return 0, nil
	}
	return wrapped, container.put(field, items)
}

// loreEntryFor builds one migrated lore object: the text is kept as the
// author wrote it (its bytes are the original element), and the speaker
// becomes the pack's default npc.
func loreEntryFor(speaker string, text json.RawMessage) (json.RawMessage, error) {
	entry := object{}
	if err := entry.put("npc", speaker); err != nil {
		return nil, err
	}
	if err := entry.put("text", text); err != nil {
		return nil, err
	}
	return json.Marshal(entry)
}

// defaultNPCKey names the speaker migrated entries get. quest.DefaultNPCKey
// is a string constant; the local keeps the lore builder readable.
const defaultNPCKey = quest.DefaultNPCKey

// marshalLikeOriginal re-indents the migrated pack the way the author wrote
// it: the indentation of the original file's first indented line, and its
// trailing newline or lack of one. Object key order is preserved by the
// object type itself, so the diff of a migrated pack shows the migration,
// not a reshuffle.
func marshalLikeOriginal(original []byte, v any) ([]byte, error) {
	compact, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, compact, "", detectIndent(original)); err != nil {
		return nil, err
	}
	indented := buf.Bytes()
	if bytes.HasSuffix(bytes.TrimRight(original, " \t\r\n"), []byte("}")) &&
		bytes.HasSuffix(original, []byte("\n")) {
		indented = append(indented, '\n')
	}
	return indented, nil
}

// detectIndent answers with the whitespace prefix of the first indented
// line, or two spaces for a file with no indented line to learn from.
func detectIndent(data []byte) string {
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		body := bytes.TrimLeft(line, " \t")
		if prefix := string(line[:len(line)-len(body)]); prefix != "" {
			return prefix
		}
	}
	return "  "
}

// object is a JSON object that remembers its key order. The migration keeps
// the author's layout so the result of migrating a pack stays reviewable in
// version control: only the lines the migration actually touched move.
// Invariant: keys is the ordered key list and holds each key exactly once;
// vals holds the same set. Only UnmarshalJSON and put may add keys.
type object struct {
	keys []string
	vals map[string]json.RawMessage
}

func (o *object) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	token, err := dec.Token()
	if err != nil {
		return err
	}
	if delim, ok := token.(json.Delim); !ok || delim != '{' {
		return errors.New("expected a JSON object")
	}
	o.vals = make(map[string]json.RawMessage)
	o.keys = nil
	for dec.More() {
		keyToken, err := dec.Token()
		if err != nil {
			return err
		}
		key, ok := keyToken.(string)
		if !ok {
			return fmt.Errorf("expected an object key, got %v", keyToken)
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return err
		}
		if _, seen := o.vals[key]; !seen {
			o.keys = append(o.keys, key)
		}
		// JSON's own rule for a duplicated key: the last one wins.
		o.vals[key] = raw
	}
	if _, err := dec.Token(); err != nil {
		return err
	}
	// Reject trailing junk the way encoding/json does: a clean EOF is the
	// only acceptable remainder.
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); err == nil {
		return errors.New("unexpected data after the JSON object")
	} else if !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func (o object) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, key := range o.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		keyJSON, err := json.Marshal(key)
		if err != nil {
			return nil, err
		}
		buf.Write(keyJSON)
		buf.WriteByte(':')
		valueJSON, err := json.Marshal(o.vals[key])
		if err != nil {
			return nil, err
		}
		buf.Write(valueJSON)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func (o *object) get(key string) (json.RawMessage, bool) {
	raw, ok := o.vals[key]
	return raw, ok
}

func (o *object) keyIndex(key string) int {
	return slices.Index(o.keys, key)
}

// put replaces a key in place, appending it when the object does not have it.
func (o *object) put(key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if o.vals == nil {
		o.vals = make(map[string]json.RawMessage)
	}
	if _, exists := o.vals[key]; !exists {
		o.keys = append(o.keys, key)
	}
	o.vals[key] = raw
	return nil
}

// putFirst writes a key at the very front of the object: the format marker
// reads first in every pack this project ships.
func (o *object) putFirst(key string, value any) error {
	if err := o.put(key, value); err != nil {
		return err
	}
	if i := o.keyIndex(key); i > 0 {
		o.keys = slices.Insert(slices.Delete(o.keys, i, i+1), 0, key)
	}
	return nil
}

// moveAfter places an existing key directly behind another one.
func (o *object) moveAfter(key, after string) {
	i := o.keyIndex(key)
	if i < 0 {
		return
	}
	o.keys = slices.Delete(o.keys, i, i+1)
	if j := o.keyIndex(after); j >= 0 {
		o.keys = slices.Insert(o.keys, j+1, key)
	} else {
		o.keys = append(o.keys, key)
	}
}
