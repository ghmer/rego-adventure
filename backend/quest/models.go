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
	"fmt"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Manual represents the structured manual content for a quest.
type Manual struct {
	DataModel    string `json:"data_model"`
	RegoSnippet  string `json:"rego_snippet"`
	ExternalLink string `json:"external_link"`
}

// LoreEntry is one page of narrative text, spoken by one of the npc
// characters declared in the pack's npcs section. Prologue, epilogue and
// quest lore are all lists of these, so a pack can give different lines of
// its story different speakers.
type LoreEntry struct {
	NPC  string `json:"npc"`
	Text string `json:"text"`
}

// Quest represents a single learning quest.
type Quest struct {
	ID              int         `json:"id"`
	Title           string      `json:"title"`
	DescriptionLore []LoreEntry `json:"description_lore"`
	DescriptionTask string      `json:"description_task"`
	Manual          Manual      `json:"manual"`
	Hints           []string    `json:"hints"`
	Solution        string      `json:"solution,omitempty"`
	Tests           []TestCase  `json:"tests"`
	ApplyTemplate   bool        `json:"apply_template"`
	Template        string      `json:"template"`
	Query           string      `json:"query"`
	// SupportModules are optional hidden Rego modules (e.g. a policy under
	// test) compiled alongside the player's policy during verification.
	// Each entry must be a complete Rego module including its package.
	SupportModules []string `json:"support_modules,omitempty"`
}

// TestCase represents a validation scenario for a quest.
type TestCase struct {
	ID              int         `json:"id"`
	Payload         TestPayload `json:"payload"`
	ExpectedOutcome any         `json:"expected_value"`
}

// TestPayload represents the payload structure with input and data
type TestPayload struct {
	Input any            `json:"input"`
	Data  map[string]any `json:"data,omitempty"`
}

// TestPayloadInfo represents the simplified test payload for the frontend.
type TestPayloadInfo struct {
	TestID          int `json:"test_id"`
	Payload         any `json:"payload"`
	ExpectedOutcome any `json:"expected_value"`
}

// GetTestPayloads returns the simplified test payloads for the quest.
func (q *Quest) GetTestPayloads() []TestPayloadInfo {
	payloads := make([]TestPayloadInfo, len(q.Tests))
	for i, test := range q.Tests {
		payloads[i] = TestPayloadInfo{
			TestID:          test.ID,
			Payload:         test.Payload,
			ExpectedOutcome: test.ExpectedOutcome,
		}
	}
	return payloads
}

// MetaData holds metadata about a quest pack.
type MetaData struct {
	Title            string `json:"title"`
	Description      string `json:"description"`
	Genre            string `json:"genre"`
	InitialObjective string `json:"initial_objective,omitempty"`
	FinalObjective   string `json:"final_objective,omitempty"`
}

// UILabels holds customizable UI text labels for a quest pack.
type UILabels struct {
	GrimoireTitle          string `json:"grimoire_title"`
	HintButton             string `json:"hint_button"`
	VerifyButton           string `json:"verify_button"`
	Verifying              string `json:"verifying"`
	MessageSuccess         string `json:"message_success"`
	MessageFailure         string `json:"message_failure"`
	PerfectScoreMessage    string `json:"perfect_score_message"`
	PerfectScoreButtonText string `json:"perfect_score_button_text"`
	BeginAdventureButton   string `json:"begin_adventure_button"`
}

// QuestPack represents a collection of quests (e.g., medieval, scifi).
type QuestPack struct { //nolint:revive // established public name; renaming to Pack would be a breaking API change
	ID string `json:"id"`
	// Version is the quest pack format marker. LoadPack refuses a pack whose
	// version is not FormatVersion before decoding it, so an old pack fails
	// with a migration message instead of a type error from the decoder.
	Version  int               `json:"version"`
	NPCs     map[string]string `json:"npcs"` // npc key -> image path inside the pack's assets directory
	Meta     MetaData          `json:"meta"`
	UILabels UILabels          `json:"ui_labels"`
	Prologue []LoreEntry       `json:"prologue"`
	Epilogue []LoreEntry       `json:"epilogue"`
	Quests   []Quest           `json:"quests"`
	questMap map[int]*Quest    // Internal map for O(1) quest lookup
}

// Security: Validation and Sanitization Functions

// validateStringLength checks if a string exceeds the maximum allowed
// number of characters (Unicode code points, not bytes), so multibyte
// content is not rejected earlier than its visible length warrants.
func validateStringLength(s string, maxLength int, fieldName string) error {
	if runes := utf8.RuneCountInString(s); runes > maxLength {
		return fmt.Errorf("%s exceeds maximum length of %d characters (got %d)", fieldName, maxLength, runes)
	}
	return nil
}

// validateNonEmpty checks if a required string field is non-empty.
func validateNonEmpty(s string, fieldName string) error {
	if strings.TrimSpace(s) == "" {
		return fmt.Errorf("%s cannot be empty", fieldName)
	}
	return nil
}

// Pre-compiled regex pattern for alphanumeric validation (compiled once at init)
var alphanumericPattern = regexp.MustCompile(`^[a-zA-Z0-9\s\-_.,!?']+$`)

// npcKeyPattern bounds npc keys: they name a lore entry's speaker and become
// frontend option labels, so they stay simple identifiers rather than free
// text. DefaultNPCKey must match it.
var npcKeyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]*$`)

// npcImageExtensions are the image types an npc may point at. They are the
// raster subset of the extensions the quest asset route serves: an svg can
// carry script content, so it stays out of a source that lands in an <img>.
var npcImageExtensions = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".webp": true,
}

// validateAlphanumericWithSpaces validates that a string contains only alphanumeric characters,
// spaces, and basic punctuation.
func validateAlphanumericWithSpaces(s string, fieldName string) error {
	if !alphanumericPattern.MatchString(s) {
		return fmt.Errorf("%s contains invalid characters (only alphanumeric and basic punctuation allowed)", fieldName)
	}
	return nil
}

// validateQuest validates a single quest's fields. npcs is the pack's npc
// roster, needed to resolve the speakers lore entries reference.
func validateQuest(quest *Quest, questIndex int, npcs map[string]string) error {
	p := fmt.Sprintf("quest %d", questIndex)

	if err := validateQuestNarrative(quest, p, npcs); err != nil {
		return err
	}
	if err := validateQuestHintsAndTemplate(quest, p); err != nil {
		return err
	}
	if err := validateQuestManual(quest, p); err != nil {
		return err
	}
	if err := validateQuestSupportModules(quest, p); err != nil {
		return err
	}
	if err := validateQuestTests(quest, p); err != nil {
		return err
	}
	// The query drives every verification evaluation; a missing one would
	// fail per request as a confusing "Compilation error" instead of
	// being rejected at pack load time.
	return validateNonEmpty(quest.Query, p+" query")
}

// validateQuestNarrative validates title, task, and lore entries. Each lore
// entry must name an npc the pack declares; a dangling reference would leave
// the frontend without an image for the speaker mid-story.
func validateQuestNarrative(quest *Quest, p string, npcs map[string]string) error {
	if err := validateNonEmpty(quest.Title, p+" title"); err != nil {
		return err
	}
	if err := validateStringLength(quest.Title, MaxQuestTitle, p+" title"); err != nil {
		return err
	}

	if err := validateNonEmpty(quest.DescriptionTask, p+" task"); err != nil {
		return err
	}
	if err := validateStringLength(quest.DescriptionTask, MaxQuestDescriptionTask, p+" task"); err != nil {
		return err
	}

	if len(quest.DescriptionLore) == 0 {
		return fmt.Errorf("%s must have at least one lore entry", p)
	}
	for i, entry := range quest.DescriptionLore {
		if err := validateNonEmpty(entry.NPC, fmt.Sprintf("%s lore[%d] npc", p, i)); err != nil {
			return err
		}
		if _, declared := npcs[entry.NPC]; !declared {
			return fmt.Errorf("%s lore[%d] references npc %q, which the pack does not declare", p, i, entry.NPC)
		}
		if err := validateStringLength(entry.Text, MaxQuestDescriptionLore, fmt.Sprintf("%s lore[%d]", p, i)); err != nil {
			return err
		}
	}
	return nil
}

// validateQuestHintsAndTemplate validates hint entries, solution, and template.
func validateQuestHintsAndTemplate(quest *Quest, p string) error {
	for i, hint := range quest.Hints {
		if err := validateStringLength(hint, MaxQuestHint, fmt.Sprintf("%s hint[%d]", p, i)); err != nil {
			return err
		}
	}
	if quest.Solution != "" {
		if err := validateStringLength(quest.Solution, MaxQuestSolution, p+" solution"); err != nil {
			return err
		}
	}
	if quest.Template != "" {
		if err := validateStringLength(quest.Template, MaxQuestTemplate, p+" template"); err != nil {
			return err
		}
	}
	return nil
}

// validateQuestManual validates manual content and the external link scheme.
func validateQuestManual(quest *Quest, p string) error {
	if err := validateStringLength(
		quest.Manual.DataModel, MaxManualDataModel, p+" manual.data_model"); err != nil {
		return err
	}
	if err := validateStringLength(
		quest.Manual.RegoSnippet, MaxManualRegoSnippet, p+" manual.rego_snippet"); err != nil {
		return err
	}
	if err := validateStringLength(
		quest.Manual.ExternalLink, MaxManualExternalLink, p+" manual.external_link"); err != nil {
		return err
	}
	if quest.Manual.ExternalLink != "" {
		if err := validateExternalLinkScheme(quest.Manual.ExternalLink, p); err != nil {
			return err
		}
	}
	return nil
}

// validateQuestSupportModules validates the optional support modules that
// are compiled alongside the player's policy during verification.
func validateQuestSupportModules(quest *Quest, p string) error {
	if len(quest.SupportModules) > MaxQuestSupportModules {
		return fmt.Errorf("%s has %d support modules, maximum is %d", p, len(quest.SupportModules), MaxQuestSupportModules)
	}
	for i, module := range quest.SupportModules {
		if err := validateNonEmpty(module, fmt.Sprintf("%s support_modules[%d]", p, i)); err != nil {
			return err
		}
		if err := validateStringLength(module, MaxQuestSupportModule, fmt.Sprintf("%s support_modules[%d]", p, i)); err != nil {
			return err
		}
	}
	return nil
}

// validateQuestTests validates that each test carries a bounded payload.
func validateQuestTests(quest *Quest, p string) error {
	if len(quest.Tests) == 0 {
		return fmt.Errorf("%s must have at least one test case", p)
	}
	if len(quest.Tests) > MaxQuestTests {
		return fmt.Errorf("%s has %d test cases, maximum is %d", p, len(quest.Tests), MaxQuestTests)
	}
	for i, test := range quest.Tests {
		payloadJSON, err := json.Marshal(test.Payload)
		if err != nil {
			return fmt.Errorf("%s test[%d] has invalid payload: %w", p, i, err)
		}
		if len(payloadJSON) > MaxTestPayloadBytes {
			return fmt.Errorf("%s test[%d] payload exceeds maximum size of %d bytes", p, i, MaxTestPayloadBytes)
		}
	}
	return nil
}

// validateExternalLinkScheme rejects external links whose URL scheme is not
// http(s), preventing e.g. javascript: or data: URLs from being rendered.
func validateExternalLinkScheme(link string, prefix string) error {
	u, err := url.Parse(link)
	if err != nil {
		return fmt.Errorf("%s manual.external_link is not a valid URL: %w", prefix, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%s manual.external_link must use http or https scheme, got %q", prefix, u.Scheme)
	}
	return nil
}

// validateUILabels checks presence and length of the customizable UI labels.
func validateUILabels(labels UILabels) error {
	type uiLabel struct {
		value    string
		maxLen   int
		name     string
		required bool
	}
	for _, l := range []uiLabel{
		{labels.GrimoireTitle, MaxUIGrimoireTitle, "ui_labels.grimoire_title", true},
		{labels.HintButton, MaxUIHintButton, "ui_labels.hint_button", true},
		{labels.VerifyButton, MaxUIVerifyButton, "ui_labels.verify_button", true},
		{labels.Verifying, MaxUIVerifying, "ui_labels.verifying", false},
		{labels.MessageSuccess, MaxUIMessageSuccess, "ui_labels.message_success", false},
		{labels.MessageFailure, MaxUIMessageFailure, "ui_labels.message_failure", false},
		{labels.PerfectScoreMessage, MaxUIPerfectScoreMessage, "ui_labels.perfect_score_message", false},
		{labels.PerfectScoreButtonText, MaxUIPerfectScoreButton, "ui_labels.perfect_score_button_text", false},
		{labels.BeginAdventureButton, MaxUIBeginAdventureButton, "ui_labels.begin_adventure_button", false},
	} {
		if l.required {
			if err := validateNonEmpty(l.value, l.name); err != nil {
				return err
			}
		}
		if err := validateStringLength(l.value, l.maxLen, l.name); err != nil {
			return err
		}
	}
	return nil
}

func validateQuestPack(pack *QuestPack) error {
	if pack.Version != FormatVersion {
		return fmt.Errorf("pack format version is %d, this build understands %d; run cmd/questmigrate to migrate the pack",
			pack.Version, FormatVersion)
	}
	if err := validatePackMeta(pack.Meta); err != nil {
		return err
	}
	if err := validatePackObjectives(pack.Meta); err != nil {
		return err
	}
	if err := validateUILabels(pack.UILabels); err != nil {
		return err
	}
	// The npc roster comes before the narrative lists and the quests: the
	// lore entries reference it, and refusing an unusable roster first keeps
	// every later message about a lore entry meaningful.
	if err := validatePackNPCs(pack); err != nil {
		return err
	}
	if err := validateNarrativeLists(pack); err != nil {
		return err
	}
	if len(pack.Quests) == 0 {
		return fmt.Errorf("pack must have at least one quest")
	}
	for i := range pack.Quests {
		if err := validateQuest(&pack.Quests[i], i+1, pack.NPCs); err != nil {
			return err
		}
	}
	return nil
}

// validatePackMeta validates the pack metadata fields.
func validatePackMeta(meta MetaData) error {
	if err := validateNonEmpty(meta.Title, "pack title"); err != nil {
		return err
	}
	if err := validateStringLength(meta.Title, MaxPackTitle, "pack title"); err != nil {
		return err
	}
	if err := validateNonEmpty(meta.Description, "pack description"); err != nil {
		return err
	}
	if err := validateStringLength(meta.Description, MaxPackDescription, "pack description"); err != nil {
		return err
	}
	if err := validateNonEmpty(meta.Genre, "pack genre"); err != nil {
		return err
	}
	if err := validateStringLength(meta.Genre, MaxPackGenre, "pack genre"); err != nil {
		return err
	}
	return validateAlphanumericWithSpaces(meta.Genre, "pack genre")
}

// validatePackObjectives validates the optional initial/final objectives.
func validatePackObjectives(meta MetaData) error {
	if meta.InitialObjective != "" {
		if err := validateStringLength(meta.InitialObjective, MaxPackObjective, "pack initial_objective"); err != nil {
			return err
		}
	}
	if meta.FinalObjective != "" {
		if err := validateStringLength(meta.FinalObjective, MaxPackObjective, "pack final_objective"); err != nil {
			return err
		}
	}
	return nil
}

// validatePackNPCs validates the npc roster a pack's lore entries draw their
// speakers from. Entries are visited in sorted key order so the same pack
// always produces the same message, map iteration order being what it is.
func validatePackNPCs(pack *QuestPack) error {
	if len(pack.NPCs) == 0 {
		return fmt.Errorf("pack must declare at least one npc character in the npcs section")
	}
	if len(pack.NPCs) > MaxPackNPCs {
		return fmt.Errorf("pack has %d npc characters, maximum is %d", len(pack.NPCs), MaxPackNPCs)
	}
	if _, ok := pack.NPCs[DefaultNPCKey]; !ok {
		return fmt.Errorf("pack npcs must declare %q as the fallback speaker", DefaultNPCKey)
	}

	names := make([]string, 0, len(pack.NPCs))
	for name := range pack.NPCs {
		names = append(names, name)
	}
	slices.Sort(names)

	for i, name := range names {
		if err := validateNonEmpty(name, fmt.Sprintf("npcs[%d] name", i)); err != nil {
			return err
		}
		if err := validateStringLength(name, MaxNPCName, fmt.Sprintf("npcs[%d] name", i)); err != nil {
			return err
		}
		if !npcKeyPattern.MatchString(name) {
			return fmt.Errorf("npcs[%d] name contains invalid characters "+
				"(must start with a letter and use only letters, numbers, hyphens and underscores)", i)
		}
		if err := validateNonEmpty(pack.NPCs[name], fmt.Sprintf("npcs[%d] image", i)); err != nil {
			return err
		}
		if err := validateStringLength(pack.NPCs[name], MaxNPCImage, fmt.Sprintf("npcs[%d] image", i)); err != nil {
			return err
		}
		if err := validateNPCImagePath(pack.NPCs[name], fmt.Sprintf("npcs[%d] image", i)); err != nil {
			return err
		}
	}
	return nil
}

// validateNPCImagePath requires an npc image to address a media file inside
// the pack's assets directory - the only place the asset route serves from.
// Path traversal, absolute paths, backslashes, whitespace and unlisted file
// extensions are refused so the frontend can use the path in an <img src>
// without escaping surprises.
func validateNPCImagePath(image string, prefix string) error {
	if !strings.HasPrefix(image, NPCImagePrefix) {
		return fmt.Errorf("%s must point inside the pack assets directory (must start with %q)", prefix, NPCImagePrefix)
	}
	rest := image[len(NPCImagePrefix):]
	if rest == "" {
		return fmt.Errorf("%s must name a file inside the pack assets directory", prefix)
	}
	if strings.Contains(rest, "..") || strings.Contains(rest, "\\") {
		return fmt.Errorf("%s must stay inside the pack assets directory (path traversal is not allowed)", prefix)
	}
	if strings.ContainsAny(rest, " \t\n") {
		return fmt.Errorf("%s must not contain whitespace (only URL-safe paths are allowed)", prefix)
	}
	ext := strings.ToLower(path.Ext(image))
	if !npcImageExtensions[ext] {
		return fmt.Errorf("%s must use one of the extensions: %s",
			prefix, strings.Join(sortedExtensionList(npcImageExtensions), ", "))
	}
	return nil
}

// sortedExtensionList renders a map of extensions as a stable, sorted, comma
// separated list for error messages.
func sortedExtensionList(exts map[string]bool) []string {
	list := make([]string, 0, len(exts))
	for ext := range exts {
		list = append(list, ext)
	}
	slices.Sort(list)
	return list
}

// validateNarrativeLists validates the prologue and epilogue entries, their
// npc references included.
func validateNarrativeLists(pack *QuestPack) error {
	if len(pack.Prologue) == 0 {
		return fmt.Errorf("pack must have at least one prologue entry")
	}
	for i, entry := range pack.Prologue {
		if err := validateNonEmpty(entry.NPC, fmt.Sprintf("prologue[%d] npc", i)); err != nil {
			return err
		}
		if _, declared := pack.NPCs[entry.NPC]; !declared {
			return fmt.Errorf("prologue[%d] references npc %q, which the pack does not declare", i, entry.NPC)
		}
		if err := validateStringLength(entry.Text, MaxPrologueItem, fmt.Sprintf("prologue[%d]", i)); err != nil {
			return err
		}
	}
	if len(pack.Epilogue) == 0 {
		return fmt.Errorf("pack must have at least one epilogue entry")
	}
	for i, entry := range pack.Epilogue {
		if err := validateNonEmpty(entry.NPC, fmt.Sprintf("epilogue[%d] npc", i)); err != nil {
			return err
		}
		if _, declared := pack.NPCs[entry.NPC]; !declared {
			return fmt.Errorf("epilogue[%d] references npc %q, which the pack does not declare", i, entry.NPC)
		}
		if err := validateStringLength(entry.Text, MaxEpilogueItem, fmt.Sprintf("epilogue[%d]", i)); err != nil {
			return err
		}
	}
	return nil
}
