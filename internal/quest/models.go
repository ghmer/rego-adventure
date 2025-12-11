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

// QuestManual represents the structured manual content for a quest.
type QuestManual struct {
	DataModel    string `json:"data_model"`
	RegoSnippet  string `json:"rego_snippet"`
	ExternalLink string `json:"external_link"`
}

// Quest represents a single learning quest.
type Quest struct {
	ID              int         `json:"id"`
	Title           string      `json:"title"`
	DescriptionLore []string    `json:"description_lore"`
	DescriptionTask string      `json:"description_task"`
	Manual          QuestManual `json:"manual"`
	Hints           []string    `json:"hints"`
	Solution        string      `json:"solution,omitempty"`
	Tests           []TestCase  `json:"tests"`
	ApplyTemplate   bool        `json:"apply_template"`
	Template        string      `json:"template"`
	Query           string      `json:"query"`
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

// QuestMeta holds metadata about a quest pack.
type QuestMeta struct {
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
type QuestPack struct {
	ID       string         `json:"id"`
	Meta     QuestMeta      `json:"meta"`
	UILabels UILabels       `json:"ui_labels"`
	Prologue []string       `json:"prologue"`
	Epilogue []string       `json:"epilogue"`
	Quests   []Quest        `json:"quests"`
	questMap map[int]*Quest // Internal map for O(1) quest lookup
}

// Security: Validation and Sanitization Functions

// validateStringLength checks if a string exceeds the maximum allowed length
func validateStringLength(s string, max int, fieldName string) error {
	if len(s) > max {
		return fmt.Errorf("%s exceeds maximum length of %d characters (got %d)", fieldName, max, len(s))
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

// validateAlphanumericWithSpaces validates that a string contains only alphanumeric characters, spaces, and basic punctuation
func validateAlphanumericWithSpaces(s string, fieldName string) error {
	// Allow alphanumeric, spaces, hyphens, underscores, and basic punctuation
	pattern := regexp.MustCompile(`^[a-zA-Z0-9\s\-_.,!?']+$`)
	if !pattern.MatchString(s) {
		return fmt.Errorf("%s contains invalid characters (only alphanumeric and basic punctuation allowed)", fieldName)
	}
	return nil
}

// validateQuest validates a single quest's fields
func validateQuest(quest *Quest, questIndex int) error {
	prefix := fmt.Sprintf("quest %d", questIndex)

	// Validate and sanitize title
	if err := validateNonEmpty(quest.Title, prefix+" title"); err != nil {
		return err
	}
	if err := validateStringLength(quest.Title, 100, prefix+" title"); err != nil {
		return err
	}

	// Validate and sanitize description_task
	if err := validateNonEmpty(quest.DescriptionTask, prefix+" task"); err != nil {
		return err
	}
	if err := validateStringLength(quest.DescriptionTask, 1000, prefix+" task"); err != nil {
		return err
	}

	// Validate description_lore array
	if len(quest.DescriptionLore) == 0 {
		return fmt.Errorf("%s must have at least one lore entry", prefix)
	}
	for i, lore := range quest.DescriptionLore {
		if err := validateStringLength(lore, 2000, fmt.Sprintf("%s lore[%d]", prefix, i)); err != nil {
			return err
		}
	}

	// Validate hints (optional but if present, must be valid)
	for i, hint := range quest.Hints {
		if err := validateStringLength(hint, 500, fmt.Sprintf("%s hint[%d]", prefix, i)); err != nil {
			return err
		}
	}

	// Validate solution (optional)
	if quest.Solution != "" {
		if err := validateStringLength(quest.Solution, 5000, prefix+" solution"); err != nil {
			return err
		}
	}

	// Validate template (optional)
	if quest.Template != "" {
		if err := validateStringLength(quest.Template, 10000, prefix+" template"); err != nil {
			return err
		}
	}

	// Validate manual fields
	if err := validateStringLength(quest.Manual.DataModel, 2000, prefix+" manual.data_model"); err != nil {
		return err
	}
	if err := validateStringLength(quest.Manual.RegoSnippet, 5000, prefix+" manual.rego_snippet"); err != nil {
		return err
	}
	if err := validateStringLength(quest.Manual.ExternalLink, 500, prefix+" manual.external_link"); err != nil {
		return err
	}

	// Validate tests
	if len(quest.Tests) == 0 {
		return fmt.Errorf("%s must have at least one test case", prefix)
	}

	// Validate test payload sizes to prevent DoS
	for i, test := range quest.Tests {
		// Convert payload to JSON to check size
		payloadJSON, err := json.Marshal(test.Payload)
		if err != nil {
			return fmt.Errorf("%s test[%d] has invalid payload: %w", prefix, i, err)
		}
		if len(payloadJSON) > 50000 { // 50KB limit for test payloads
			return fmt.Errorf("%s test[%d] payload exceeds maximum size of 50KB", prefix, i)
		}

		// Validate input field if present
		if test.Payload.Input != nil {
			inputJSON, err := json.Marshal(test.Payload.Input)
			if err != nil {
				return fmt.Errorf("%s test[%d] has invalid input: %w", prefix, i, err)
			}
			if len(inputJSON) > 50000 { // 50KB limit for test input
				return fmt.Errorf("%s test[%d] input exceeds maximum size of 50KB", prefix, i)
			}
		}

		// Validate data field if present
		if test.Payload.Data != nil {
			dataJSON, err := json.Marshal(test.Payload.Data)
			if err != nil {
				return fmt.Errorf("%s test[%d] has invalid data: %w", prefix, i, err)
			}
			if len(dataJSON) > 50000 { // 50KB limit for test data
				return fmt.Errorf("%s test[%d] data exceeds maximum size of 50KB", prefix, i)
			}
		}
	}

	return nil
}

// validateQuestPack validates the entire quest pack structure
func validateQuestPack(pack *QuestPack) error {
	// Validate metadata
	if err := validateNonEmpty(pack.Meta.Title, "pack title"); err != nil {
		return err
	}
	if err := validateStringLength(pack.Meta.Title, 100, "pack title"); err != nil {
		return err
	}

	if err := validateNonEmpty(pack.Meta.Description, "pack description"); err != nil {
		return err
	}
	if err := validateStringLength(pack.Meta.Description, 500, "pack description"); err != nil {
		return err
	}

	if err := validateNonEmpty(pack.Meta.Genre, "pack genre"); err != nil {
		return err
	}
	if err := validateStringLength(pack.Meta.Genre, 50, "pack genre"); err != nil {
		return err
	}
	if err := validateAlphanumericWithSpaces(pack.Meta.Genre, "pack genre"); err != nil {
		return err
	}

	// Validate optional metadata fields
	if pack.Meta.InitialObjective != "" {
		if err := validateStringLength(pack.Meta.InitialObjective, 500, "pack initial_objective"); err != nil {
			return err
		}
	}
	if pack.Meta.FinalObjective != "" {
		if err := validateStringLength(pack.Meta.FinalObjective, 500, "pack final_objective"); err != nil {
			return err
		}
	}

	// Validate UI labels
	if err := validateNonEmpty(pack.UILabels.GrimoireTitle, "ui_labels.grimoire_title"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.GrimoireTitle, 100, "ui_labels.grimoire_title"); err != nil {
		return err
	}
	if err := validateNonEmpty(pack.UILabels.HintButton, "ui_labels.hint_button"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.HintButton, 100, "ui_labels.hint_button"); err != nil {
		return err
	}
	if err := validateNonEmpty(pack.UILabels.VerifyButton, "ui_labels.verify_button"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.VerifyButton, 100, "ui_labels.verify_button"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.MessageSuccess, 200, "ui_labels.message_success"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.MessageFailure, 200, "ui_labels.message_failure"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.PerfectScoreMessage, 1000, "ui_labels.perfect_score_message"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.PerfectScoreButtonText, 100, "ui_labels.perfect_score_button_text"); err != nil {
		return err
	}
	if err := validateStringLength(pack.UILabels.BeginAdventureButton, 100, "ui_labels.begin_adventure_button"); err != nil {
		return err
	}

	// Validate prologue and epilogue
	if len(pack.Prologue) == 0 {
		return fmt.Errorf("pack must have at least one prologue entry")
	}
	for i, entry := range pack.Prologue {
		if err := validateStringLength(entry, 2000, fmt.Sprintf("prologue[%d]", i)); err != nil {
			return err
		}
	}

	if len(pack.Epilogue) == 0 {
		return fmt.Errorf("pack must have at least one epilogue entry")
	}
	for i, entry := range pack.Epilogue {
		if err := validateStringLength(entry, 2000, fmt.Sprintf("epilogue[%d]", i)); err != nil {
			return err
		}
	}

	// Validate quests
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
