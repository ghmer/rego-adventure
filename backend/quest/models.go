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

// validateStringLength checks if a string exceeds the maximum allowed length.
func validateStringLength(s string, maxLength int, fieldName string) error {
	if len(s) > maxLength {
		return fmt.Errorf("%s exceeds maximum length of %d characters (got %d)", fieldName, maxLength, len(s))
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

// validateAlphanumericWithSpaces validates that a string contains only alphanumeric characters,
// spaces, and basic punctuation.
func validateAlphanumericWithSpaces(s string, fieldName string) error {
	if !alphanumericPattern.MatchString(s) {
		return fmt.Errorf("%s contains invalid characters (only alphanumeric and basic punctuation allowed)", fieldName)
	}
	return nil
}

// validateQuest validates a single quest's fields.
func validateQuest(quest *Quest, questIndex int) error {
	p := fmt.Sprintf("quest %d", questIndex)

	// Title
	if err := validateNonEmpty(quest.Title, p+" title"); err != nil {
		return err
	}
	if err := validateStringLength(quest.Title, MaxQuestTitle, p+" title"); err != nil {
		return err
	}

	// Description
	if err := validateNonEmpty(quest.DescriptionTask, p+" task"); err != nil {
		return err
	}
	if err := validateStringLength(quest.DescriptionTask, MaxQuestDescriptionTask, p+" task"); err != nil {
		return err
	}
	if len(quest.DescriptionLore) == 0 {
		return fmt.Errorf("%s must have at least one lore entry", p)
	}
	for i, lore := range quest.DescriptionLore {
		if err := validateStringLength(lore, MaxQuestDescriptionLore, fmt.Sprintf("%s lore[%d]", p, i)); err != nil {
			return err
		}
	}

	// Hints, solution, template
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

	// Manual
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

	// Tests
	if len(quest.Tests) == 0 {
		return fmt.Errorf("%s must have at least one test case", p)
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

// validateQuestPack validates the entire quest pack structure.
func validateQuestPack(pack *QuestPack) error {
	// Metadata
	if err := validateNonEmpty(pack.Meta.Title, "pack title"); err != nil {
		return err
	}
	if err := validateStringLength(pack.Meta.Title, MaxPackTitle, "pack title"); err != nil {
		return err
	}
	if err := validateNonEmpty(pack.Meta.Description, "pack description"); err != nil {
		return err
	}
	if err := validateStringLength(pack.Meta.Description, MaxPackDescription, "pack description"); err != nil {
		return err
	}
	if err := validateNonEmpty(pack.Meta.Genre, "pack genre"); err != nil {
		return err
	}
	if err := validateStringLength(pack.Meta.Genre, MaxPackGenre, "pack genre"); err != nil {
		return err
	}
	if err := validateAlphanumericWithSpaces(pack.Meta.Genre, "pack genre"); err != nil {
		return err
	}
	if pack.Meta.InitialObjective != "" {
		if err := validateStringLength(pack.Meta.InitialObjective, MaxPackObjective, "pack initial_objective"); err != nil {
			return err
		}
	}
	if pack.Meta.FinalObjective != "" {
		if err := validateStringLength(pack.Meta.FinalObjective, MaxPackObjective, "pack final_objective"); err != nil {
			return err
		}
	}

	// UI Labels
	type uiLabel struct {
		value    string
		maxLen   int
		name     string
		required bool
	}
	for _, l := range []uiLabel{
		{pack.UILabels.GrimoireTitle, MaxUIGrimoireTitle, "ui_labels.grimoire_title", true},
		{pack.UILabels.HintButton, MaxUIHintButton, "ui_labels.hint_button", true},
		{pack.UILabels.VerifyButton, MaxUIVerifyButton, "ui_labels.verify_button", true},
		{pack.UILabels.MessageSuccess, MaxUIMessageSuccess, "ui_labels.message_success", false},
		{pack.UILabels.MessageFailure, MaxUIMessageFailure, "ui_labels.message_failure", false},
		{pack.UILabels.PerfectScoreMessage, MaxUIPerfectScoreMessage, "ui_labels.perfect_score_message", false},
		{pack.UILabels.PerfectScoreButtonText, MaxUIPerfectScoreButton, "ui_labels.perfect_score_button_text", false},
		{pack.UILabels.BeginAdventureButton, MaxUIBeginAdventureButton, "ui_labels.begin_adventure_button", false},
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

	// Narrative (prologue / epilogue)
	if len(pack.Prologue) == 0 {
		return fmt.Errorf("pack must have at least one prologue entry")
	}
	for i, entry := range pack.Prologue {
		if err := validateStringLength(entry, MaxPrologueItem, fmt.Sprintf("prologue[%d]", i)); err != nil {
			return err
		}
	}
	if len(pack.Epilogue) == 0 {
		return fmt.Errorf("pack must have at least one epilogue entry")
	}
	for i, entry := range pack.Epilogue {
		if err := validateStringLength(entry, MaxEpilogueItem, fmt.Sprintf("epilogue[%d]", i)); err != nil {
			return err
		}
	}

	// Quests
	if len(pack.Quests) == 0 {
		return fmt.Errorf("pack must have at least one quest")
	}
	for i := range pack.Quests {
		if err := validateQuest(&pack.Quests[i], i+1); err != nil {
			return err
		}
	}

	return nil
}
