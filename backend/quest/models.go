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
	"regexp"
	"strings"
)

// Manual represents the structured manual content for a quest.
type Manual struct {
	DataModel    string `json:"data_model"`
	RegoSnippet  string `json:"rego_snippet"`
	ExternalLink string `json:"external_link"`
}

// Quest represents a single learning quest.
type Quest struct {
	ID              int        `json:"id"`
	Title           string     `json:"title"`
	DescriptionLore []string   `json:"description_lore"`
	DescriptionTask string     `json:"description_task"`
	Manual          Manual     `json:"manual"`
	Hints           []string   `json:"hints"`
	Solution        string     `json:"solution,omitempty"`
	Tests           []TestCase `json:"tests"`
	ApplyTemplate   bool       `json:"apply_template"`
	Template        string     `json:"template"`
	Query           string     `json:"query"`
}

// TestCase represents a validation scenario for a quest.
type TestCase struct {
	ID              int         `json:"id"`
	Payload         TestPayload `json:"payload"`
	ExpectedOutcome bool        `json:"expected_outcome"`
}

// TestPayload represents the payload structure with input and data
type TestPayload struct {
	Input any            `json:"input"`
	Data  map[string]any `json:"data,omitempty"`
}

// TestPayloadInfo represents the simplified test payload for the frontend.
type TestPayloadInfo struct {
	TestID          int  `json:"test_id"`
	Payload         any  `json:"payload"`
	ExpectedOutcome bool `json:"expected_outcome"`
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
	MessageSuccess         string `json:"message_success"`
	MessageFailure         string `json:"message_failure"`
	PerfectScoreMessage    string `json:"perfect_score_message"`
	PerfectScoreButtonText string `json:"perfect_score_button_text"`
	BeginAdventureButton   string `json:"begin_adventure_button"`
}

// QuestPack represents a collection of quests (e.g., medieval, scifi).
type QuestPack struct { //nolint
	ID       string         `json:"id"`
	Meta     MetaData       `json:"meta"`
	UILabels UILabels       `json:"ui_labels"`
	Prologue []string       `json:"prologue"`
	Epilogue []string       `json:"epilogue"`
	Quests   []Quest        `json:"quests"`
	questMap map[int]*Quest // Internal map for O(1) quest lookup
}

// Security: Validation and Sanitization Functions

// validateStringLength checks if a string exceeds the maximum allowed length
func validateStringLength(s string, maxLength int, fieldName string) error {
	if len(s) > maxLength {
		return fmt.Errorf("%s exceeds maximum length of %d characters (got %d)", fieldName, maxLength, len(s))
	}
	return nil
}

// validateNonEmpty checks if a required string field is non-empty
func validateNonEmpty(s string, fieldName string) error {
	if strings.TrimSpace(s) == "" {
		return fmt.Errorf("%s cannot be empty", fieldName)
	}
	return nil
}

// Pre-compiled regex pattern for alphanumeric validation (compiled once at init)
var alphanumericPattern = regexp.MustCompile(`^[a-zA-Z0-9\s\-_.,!?']+$`)

// validateAlphanumericWithSpaces validates that a string contains only alphanumeric characters,
// spaces, and basic punctuation
func validateAlphanumericWithSpaces(s string, fieldName string) error {
	// Allow alphanumeric, spaces, hyphens, underscores, and basic punctuation
	if !alphanumericPattern.MatchString(s) {
		return fmt.Errorf("%s contains invalid characters (only alphanumeric and basic punctuation allowed)", fieldName)
	}
	return nil
}

// validateQuestTitle validates the quest title
func validateQuestTitle(quest *Quest, prefix string) error {
	if err := validateNonEmpty(quest.Title, prefix+" title"); err != nil {
		return err
	}
	return validateStringLength(quest.Title, MaxQuestTitle, prefix+" title")
}

// validateQuestDescription validates the quest description fields
func validateQuestDescription(quest *Quest, prefix string) error {
	if err := validateNonEmpty(quest.DescriptionTask, prefix+" task"); err != nil {
		return err
	}
	if err := validateStringLength(quest.DescriptionTask, MaxQuestDescriptionTask, prefix+" task"); err != nil {
		return err
	}
	if len(quest.DescriptionLore) == 0 {
		return fmt.Errorf("%s must have at least one lore entry", prefix)
	}
	for i, lore := range quest.DescriptionLore {
		if err := validateStringLength(lore, MaxQuestDescriptionLore, fmt.Sprintf("%s lore[%d]", prefix, i)); err != nil {
			return err
		}
	}
	return nil
}

// validateQuestContent validates quest content fields (hints, solution, template)
func validateQuestContent(quest *Quest, prefix string) error {
	for i, hint := range quest.Hints {
		if err := validateStringLength(hint, MaxQuestHint, fmt.Sprintf("%s hint[%d]", prefix, i)); err != nil {
			return err
		}
	}
	if quest.Solution != "" {
		if err := validateStringLength(quest.Solution, MaxQuestSolution, prefix+" solution"); err != nil {
			return err
		}
	}
	if quest.Template != "" {
		if err := validateStringLength(quest.Template, MaxQuestTemplate, prefix+" template"); err != nil {
			return err
		}
	}
	return nil
}

// validateQuestManual validates the quest manual/documentation
func validateQuestManual(quest *Quest, prefix string) error {
	if err := validateStringLength(quest.Manual.DataModel, MaxManualDataModel, prefix+" manual.data_model"); err != nil {
		return err
	}
	if err := validateStringLength(quest.Manual.RegoSnippet, MaxManualRegoSnippet,
		prefix+" manual.rego_snippet"); err != nil {
		return err
	}
	return validateStringLength(quest.Manual.ExternalLink, MaxManualExternalLink, prefix+" manual.external_link")
}

// validateQuestTests validates the quest test cases
func validateQuestTests(quest *Quest, prefix string) error {
	if len(quest.Tests) == 0 {
		return fmt.Errorf("%s must have at least one test case", prefix)
	}
	for i, test := range quest.Tests {
		payloadJSON, err := json.Marshal(test.Payload)
		if err != nil {
			return fmt.Errorf("%s test[%d] has invalid payload: %w", prefix, i, err)
		}
		if len(payloadJSON) > MaxTestPayloadBytes {
			return fmt.Errorf("%s test[%d] payload exceeds maximum size of %d bytes", prefix, i, MaxTestPayloadBytes)
		}
	}
	return nil
}

// validateQuest validates a single quest's fields
func validateQuest(quest *Quest, questIndex int) error {
	prefix := fmt.Sprintf("quest %d", questIndex)

	if err := validateQuestTitle(quest, prefix); err != nil {
		return err
	}
	if err := validateQuestDescription(quest, prefix); err != nil {
		return err
	}
	if err := validateQuestContent(quest, prefix); err != nil {
		return err
	}
	if err := validateQuestManual(quest, prefix); err != nil {
		return err
	}
	return validateQuestTests(quest, prefix)
}

// validatePackMetadata validates the quest pack metadata
func validatePackMetadata(meta MetaData) error {
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
	if err := validateAlphanumericWithSpaces(meta.Genre, "pack genre"); err != nil {
		return err
	}
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

// validatePackUILabels validates the UI labels section
func validatePackUILabels(labels UILabels) error {
	type labelDef struct {
		value  string
		maxLen int
		name   string
		empty  bool
	}

	requiredLabels := []labelDef{
		{labels.GrimoireTitle, MaxUIGrimoireTitle, "ui_labels.grimoire_title", true},
		{labels.HintButton, MaxUIHintButton, "ui_labels.hint_button", true},
		{labels.VerifyButton, MaxUIVerifyButton, "ui_labels.verify_button", true},
		{labels.MessageSuccess, MaxUIMessageSuccess, "ui_labels.message_success", false},
		{labels.MessageFailure, MaxUIMessageFailure, "ui_labels.message_failure", false},
		{labels.PerfectScoreMessage, MaxUIPerfectScoreMessage, "ui_labels.perfect_score_message", false},
		{labels.PerfectScoreButtonText, MaxUIPerfectScoreButton, "ui_labels.perfect_score_button_text", false},
		{labels.BeginAdventureButton, MaxUIBeginAdventureButton, "ui_labels.begin_adventure_button", false},
	}

	for _, label := range requiredLabels {
		if label.empty {
			if err := validateNonEmpty(label.value, label.name); err != nil {
				return err
			}
		}
		if err := validateStringLength(label.value, label.maxLen, label.name); err != nil {
			return err
		}
	}
	return nil
}

// validatePackNarrative validates the prologue and epilogue
func validatePackNarrative(prologue, epilogue []string) error {
	if len(prologue) == 0 {
		return fmt.Errorf("pack must have at least one prologue entry")
	}
	for i, entry := range prologue {
		if err := validateStringLength(entry, MaxPrologueItem, fmt.Sprintf("prologue[%d]", i)); err != nil {
			return err
		}
	}

	if len(epilogue) == 0 {
		return fmt.Errorf("pack must have at least one epilogue entry")
	}
	for i, entry := range epilogue {
		if err := validateStringLength(entry, MaxEpilogueItem, fmt.Sprintf("epilogue[%d]", i)); err != nil {
			return err
		}
	}
	return nil
}

// validateQuestPack validates the entire quest pack structure
func validateQuestPack(pack *QuestPack) error {
	if err := validatePackMetadata(pack.Meta); err != nil {
		return err
	}
	if err := validatePackUILabels(pack.UILabels); err != nil {
		return err
	}
	if err := validatePackNarrative(pack.Prologue, pack.Epilogue); err != nil {
		return err
	}

	if len(pack.Quests) == 0 {
		return fmt.Errorf("pack must have at least one quest")
	}

	for i, quest := range pack.Quests {
		if err := validateQuest(&quest, i+1); err != nil {
			return err
		}
	}

	return nil
}
