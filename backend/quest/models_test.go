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
	"strings"
	"testing"
)

// ==================== Helper Functions ====================

func createValidQuest() Quest {
	return Quest{
		ID:              1,
		Title:           "Test Quest",
		DescriptionLore: []string{"Lore entry 1", "Lore entry 2"},
		DescriptionTask: "This is the task description",
		Manual: QuestManual{
			DataModel:    `{"type": "object"}`,
			RegoSnippet:  `package test`,
			ExternalLink: "http://example.com/docs",
		},
		Hints:    []string{"Hint 1", "Hint 2"},
		Solution: "solution code",
		Template: "template code",
		Query:    "data.test.allow",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"user": "admin"},
				},
			},
			{
				ID:              2,
				ExpectedOutcome: false,
				Payload: TestPayload{
					Input: map[string]any{"user": "guest"},
				},
			},
		},
		ApplyTemplate: true,
	}
}

func createValidQuestPack() QuestPack {
	return QuestPack{
		ID: "test-pack",
		Meta: QuestMeta{
			Title:            "Test Pack Title",
			Description:      "A test quest pack description",
			Genre:            "fantasy",
			InitialObjective: "Complete all quests",
			FinalObjective:   "Become the hero",
		},
		UILabels: UILabels{
			GrimoireTitle:          "The Grimoire",
			HintButton:             "Get Hint",
			VerifyButton:           "Verify Solution",
			MessageSuccess:         "Well done!",
			MessageFailure:         "Try again!",
			PerfectScoreMessage:    "Perfect score! You are a master!",
			PerfectScoreButtonText: "Continue",
			BeginAdventureButton:   "Begin Adventure",
		},
		Prologue: []string{"Welcome, adventurer!", "Your journey begins here."},
		Epilogue: []string{"Congratulations!", "You have completed all quests."},
		Quests:   []Quest{createValidQuest()},
	}
}

// ==================== validateStringLength Tests ====================

func TestValidateStringLength_Valid(t *testing.T) {
	tests := []struct {
		name      string
		s         string
		max       int
		fieldName string
	}{
		{"Empty string", "", 100, "field"},
		{"Exact length", strings.Repeat("a", 50), 50, "field"},
		{"Under max", "hello", 100, "field"},
		{"Unicode chars", "héllo wörld", 50, "field"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateStringLength(tt.s, tt.max, tt.fieldName)
			if err != nil {
				t.Errorf("validateStringLength(%q, %d, %q) unexpected error: %v", tt.s, tt.max, tt.fieldName, err)
			}
		})
	}
}

func TestValidateStringLength_ExceedsMax(t *testing.T) {
	tests := []struct {
		name       string
		s          string
		max        int
		fieldName  string
		wantLength int
	}{
		{"One over", "hello", 4, "field", 5},
		{"Way over", strings.Repeat("a", 200), 100, "field", 200},
		{"Single char over", "ab", 1, "field", 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateStringLength(tt.s, tt.max, tt.fieldName)
			if err == nil {
				t.Errorf("validateStringLength(%q, %d, %q) expected error, got nil", tt.s, tt.max, tt.fieldName)
			}
			// Check error message contains expected info
			if err != nil && !strings.Contains(err.Error(), tt.fieldName) {
				t.Errorf("error should contain field name %q, got: %v", tt.fieldName, err)
			}
		})
	}
}

// ==================== validateNonEmpty Tests ====================

func TestValidateNonEmpty_Valid(t *testing.T) {
	tests := []struct {
		name      string
		s         string
		fieldName string
	}{
		{"Regular string", "hello", "field"},
		{"String with spaces", "  hello  ", "field"},
		{"String with tabs", "\thello\t", "field"},
		{"String with newlines", "\nhello\n", "field"},
		{"Unicode", "héllo", "field"},
		{"Alphanumeric", "abc123", "field"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateNonEmpty(tt.s, tt.fieldName)
			if err != nil {
				t.Errorf("validateNonEmpty(%q, %q) unexpected error: %v", tt.s, tt.fieldName, err)
			}
		})
	}
}

func TestValidateNonEmpty_Empty(t *testing.T) {
	tests := []struct {
		name      string
		s         string
		fieldName string
	}{
		{"Empty string", "", "field"},
		{"Only spaces", "   ", "field"},
		{"Only tabs", "\t\t", "field"},
		{"Only newlines", "\n\n", "field"},
		{"Mixed whitespace", " \t \n ", "field"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateNonEmpty(tt.s, tt.fieldName)
			if err == nil {
				t.Errorf("validateNonEmpty(%q, %q) expected error, got nil", tt.s, tt.fieldName)
			}
			if err != nil && !strings.Contains(err.Error(), tt.fieldName) {
				t.Errorf("error should contain field name %q, got: %v", tt.fieldName, err)
			}
		})
	}
}

// ==================== validateAlphanumericWithSpaces Tests ====================

func TestValidateAlphanumericWithSpaces_Valid(t *testing.T) {
	tests := []struct {
		name      string
		s         string
		fieldName string
	}{
		{"Simple alphanumeric", "hello123", "field"},
		{"With spaces", "hello world", "field"},
		{"With hyphen", "test-case", "field"},
		{"With underscore", "test_case", "field"},
		{"With comma", "a, b, c", "field"},
		{"With period", "Hello. World.", "field"},
		{"With question mark", "What?", "field"},
		{"With exclamation", "Wow!", "field"},
		{"With apostrophe", "It's", "field"},
		{"Mixed", "Hello, world! Test_123", "field"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAlphanumericWithSpaces(tt.s, tt.fieldName)
			if err != nil {
				t.Errorf("validateAlphanumericWithSpaces(%q, %q) unexpected error: %v", tt.s, tt.fieldName, err)
			}
		})
	}
}

func TestValidateAlphanumericWithSpaces_Invalid(t *testing.T) {
	tests := []struct {
		name      string
		s         string
		fieldName string
	}{
		{"Ampersand", "test & value", "field"},
		{"At sign", "test@example", "field"},
		{"Hash", "test#value", "field"},
		{"Dollar", "test$value", "field"},
		{"Percent", "test%value", "field"},
		{"Caret", "test^value", "field"},
		{"Asterisk", "test*value", "field"},
		{"Plus", "test+value", "field"},
		{"Equals", "test=value", "field"},
		{"Pipe", "test|value", "field"},
		{"Backslash", "test\\value", "field"},
		{"Forward slash", "test/value", "field"},
		{"Angle brackets", "test<value>", "field"},
		{"Square brackets", "test[value]", "field"},
		{"Curly braces", "test{value}", "field"},
		{"Tilde", "test~value", "field"},
		{"Backtick", "test`value", "field"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAlphanumericWithSpaces(tt.s, tt.fieldName)
			if err == nil {
				t.Errorf("validateAlphanumericWithSpaces(%q, %q) expected error, got nil", tt.s, tt.fieldName)
			}
		})
	}
}

// ==================== validateQuest Tests ====================

func TestValidateQuest_Valid(t *testing.T) {
	quest := createValidQuest()
	err := validateQuest(&quest, 1)
	if err != nil {
		t.Errorf("validateQuest with valid quest returned error: %v", err)
	}
}

func TestValidateQuest_MissingTitle(t *testing.T) {
	quest := createValidQuest()
	quest.Title = ""
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with empty title expected error")
	}
}

func TestValidateQuest_TitleTooLong(t *testing.T) {
	quest := createValidQuest()
	quest.Title = strings.Repeat("a", MaxQuestTitle+1)
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with too long title expected error")
	}
}

func TestValidateQuest_MissingTaskDescription(t *testing.T) {
	quest := createValidQuest()
	quest.DescriptionTask = ""
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with empty task description expected error")
	}
}

func TestValidateQuest_TaskDescriptionTooLong(t *testing.T) {
	quest := createValidQuest()
	quest.DescriptionTask = strings.Repeat("a", MaxQuestDescriptionTask+1)
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with too long task description expected error")
	}
}

func TestValidateQuest_EmptyLore(t *testing.T) {
	quest := createValidQuest()
	quest.DescriptionLore = []string{}
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with empty lore expected error")
	}
}

func TestValidateQuest_LoreEntryTooLong(t *testing.T) {
	quest := createValidQuest()
	quest.DescriptionLore = []string{strings.Repeat("a", MaxQuestDescriptionLore+1)}
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with too long lore entry expected error")
	}
}

func TestValidateQuest_HintTooLong(t *testing.T) {
	quest := createValidQuest()
	quest.Hints = []string{strings.Repeat("a", MaxQuestHint+1)}
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with too long hint expected error")
	}
}

func TestValidateQuest_SolutionTooLong(t *testing.T) {
	quest := createValidQuest()
	quest.Solution = strings.Repeat("a", MaxQuestSolution+1)
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with too long solution expected error")
	}
}

func TestValidateQuest_TemplateTooLong(t *testing.T) {
	quest := createValidQuest()
	quest.Template = strings.Repeat("a", MaxQuestTemplate+1)
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with too long template expected error")
	}
}

func TestValidateQuest_ManualFieldsTooLong(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Quest)
	}{
		{
			name: "data_model too long",
			modify: func(q *Quest) {
				q.Manual.DataModel = strings.Repeat("a", MaxManualDataModel+1)
			},
		},
		{
			name: "rego_snippet too long",
			modify: func(q *Quest) {
				q.Manual.RegoSnippet = strings.Repeat("a", MaxManualRegoSnippet+1)
			},
		},
		{
			name: "external_link too long",
			modify: func(q *Quest) {
				q.Manual.ExternalLink = strings.Repeat("a", MaxManualExternalLink+1)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			quest := createValidQuest()
			tt.modify(&quest)
			err := validateQuest(&quest, 1)
			if err == nil {
				t.Error("validateQuest with too long manual field expected error")
			}
		})
	}
}

func TestValidateQuest_NoTests(t *testing.T) {
	quest := createValidQuest()
	quest.Tests = []TestCase{}
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with no tests expected error")
	}
}

func TestValidateQuest_InvalidPayloadJSON(t *testing.T) {
	quest := createValidQuest()
	// Create a payload that can't be marshaled
	quest.Tests[0].Payload = TestPayload{
		Input: func() {}, // Functions can't be JSON marshaled
	}
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with invalid payload expected error")
	}
}

func TestValidateQuest_PayloadTooLarge(t *testing.T) {
	quest := createValidQuest()
	// Create a payload that exceeds max size
	largeData := make(map[string]any)
	largeData["data"] = strings.Repeat("x", MaxTestPayloadBytes+1)
	quest.Tests[0].Payload = TestPayload{Input: largeData}
	err := validateQuest(&quest, 1)
	if err == nil {
		t.Error("validateQuest with too large payload expected error")
	}
}

// ==================== validateQuestPack Tests ====================

func TestValidateQuestPack_Valid(t *testing.T) {
	pack := createValidQuestPack()
	err := validateQuestPack(&pack)
	if err != nil {
		t.Errorf("validateQuestPack with valid pack returned error: %v", err)
	}
}

func TestValidateQuestPack_MissingTitle(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.Title = ""
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with empty title expected error")
	}
}

func TestValidateQuestPack_TitleTooLong(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.Title = strings.Repeat("a", MaxPackTitle+1)
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with too long title expected error")
	}
}

func TestValidateQuestPack_MissingDescription(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.Description = ""
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with empty description expected error")
	}
}

func TestValidateQuestPack_DescriptionTooLong(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.Description = strings.Repeat("a", MaxPackDescription+1)
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with too long description expected error")
	}
}

func TestValidateQuestPack_MissingGenre(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.Genre = ""
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with empty genre expected error")
	}
}

func TestValidateQuestPack_GenreTooLong(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.Genre = strings.Repeat("a", MaxPackGenre+1)
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with too long genre expected error")
	}
}

func TestValidateQuestPack_InvalidGenreCharacters(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.Genre = "Fantasy & Adventure" // & is not allowed
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with invalid genre characters expected error")
	}
}

func TestValidateQuestPack_InitialObjectiveTooLong(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.InitialObjective = strings.Repeat("a", MaxPackObjective+1)
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with too long initial objective expected error")
	}
}

func TestValidateQuestPack_FinalObjectiveTooLong(t *testing.T) {
	pack := createValidQuestPack()
	pack.Meta.FinalObjective = strings.Repeat("a", MaxPackObjective+1)
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with too long final objective expected error")
	}
}

// UI Labels Tests
func TestValidateQuestPack_MissingUILabels(t *testing.T) {
	tests := []struct {
		name       string
		modifyPack func(*QuestPack)
	}{
		{
			name: "missing grimoire title",
			modifyPack: func(p *QuestPack) {
				p.UILabels.GrimoireTitle = ""
			},
		},
		{
			name: "missing hint button",
			modifyPack: func(p *QuestPack) {
				p.UILabels.HintButton = ""
			},
		},
		{
			name: "missing verify button",
			modifyPack: func(p *QuestPack) {
				p.UILabels.VerifyButton = ""
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pack := createValidQuestPack()
			tt.modifyPack(&pack)
			err := validateQuestPack(&pack)
			if err == nil {
				t.Error("validateQuestPack with missing UI label expected error")
			}
		})
	}
}

func TestValidateQuestPack_UILabelsTooLong(t *testing.T) {
	tests := []struct {
		name       string
		maxLen     int
		modifyPack func(*QuestPack)
	}{
		{
			name:   "grimoire title too long",
			maxLen: MaxUIGrimoireTitle,
			modifyPack: func(p *QuestPack) {
				p.UILabels.GrimoireTitle = strings.Repeat("a", MaxUIGrimoireTitle+1)
			},
		},
		{
			name:   "hint button too long",
			maxLen: MaxUIHintButton,
			modifyPack: func(p *QuestPack) {
				p.UILabels.HintButton = strings.Repeat("a", MaxUIHintButton+1)
			},
		},
		{
			name:   "verify button too long",
			maxLen: MaxUIVerifyButton,
			modifyPack: func(p *QuestPack) {
				p.UILabels.VerifyButton = strings.Repeat("a", MaxUIVerifyButton+1)
			},
		},
		{
			name:   "message success too long",
			maxLen: MaxUIMessageSuccess,
			modifyPack: func(p *QuestPack) {
				p.UILabels.MessageSuccess = strings.Repeat("a", MaxUIMessageSuccess+1)
			},
		},
		{
			name:   "message failure too long",
			maxLen: MaxUIMessageFailure,
			modifyPack: func(p *QuestPack) {
				p.UILabels.MessageFailure = strings.Repeat("a", MaxUIMessageFailure+1)
			},
		},
		{
			name:   "perfect score message too long",
			maxLen: MaxUIPerfectScoreMessage,
			modifyPack: func(p *QuestPack) {
				p.UILabels.PerfectScoreMessage = strings.Repeat("a", MaxUIPerfectScoreMessage+1)
			},
		},
		{
			name:   "perfect score button text too long",
			maxLen: MaxUIPerfectScoreButton,
			modifyPack: func(p *QuestPack) {
				p.UILabels.PerfectScoreButtonText = strings.Repeat("a", MaxUIPerfectScoreButton+1)
			},
		},
		{
			name:   "begin adventure button too long",
			maxLen: MaxUIBeginAdventureButton,
			modifyPack: func(p *QuestPack) {
				p.UILabels.BeginAdventureButton = strings.Repeat("a", MaxUIBeginAdventureButton+1)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pack := createValidQuestPack()
			tt.modifyPack(&pack)
			err := validateQuestPack(&pack)
			if err == nil {
				t.Error("validateQuestPack with too long UI label expected error")
			}
		})
	}
}

func TestValidateQuestPack_EmptyPrologue(t *testing.T) {
	pack := createValidQuestPack()
	pack.Prologue = []string{}
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with empty prologue expected error")
	}
}

func TestValidateQuestPack_PrologueEntryTooLong(t *testing.T) {
	pack := createValidQuestPack()
	pack.Prologue = []string{strings.Repeat("a", MaxPrologueItem+1)}
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with too long prologue entry expected error")
	}
}

func TestValidateQuestPack_EmptyEpilogue(t *testing.T) {
	pack := createValidQuestPack()
	pack.Epilogue = []string{}
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with empty epilogue expected error")
	}
}

func TestValidateQuestPack_EpilogueEntryTooLong(t *testing.T) {
	pack := createValidQuestPack()
	pack.Epilogue = []string{strings.Repeat("a", MaxEpilogueItem+1)}
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with too long epilogue entry expected error")
	}
}

func TestValidateQuestPack_NoQuests(t *testing.T) {
	pack := createValidQuestPack()
	pack.Quests = []Quest{}
	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("validateQuestPack with no quests expected error")
	}
}

// ==================== GetTestPayloads Tests ====================

func TestGetTestPayloads_Valid(t *testing.T) {
	quest := createValidQuest()
	payloads := quest.GetTestPayloads()

	if len(payloads) != len(quest.Tests) {
		t.Errorf("Expected %d payloads, got %d", len(quest.Tests), len(payloads))
	}

	for i, payload := range payloads {
		if payload.TestID != quest.Tests[i].ID {
			t.Errorf("Expected test ID %d, got %d", quest.Tests[i].ID, payload.TestID)
		}
		if payload.ExpectedOutcome != quest.Tests[i].ExpectedOutcome {
			t.Errorf("Expected outcome %v, got %v", quest.Tests[i].ExpectedOutcome, payload.ExpectedOutcome)
		}
	}
}

func TestGetTestPayloads_EmptyTests(t *testing.T) {
	quest := Quest{
		Tests: []TestCase{},
	}
	payloads := quest.GetTestPayloads()

	if len(payloads) != 0 {
		t.Errorf("Expected 0 payloads, got %d", len(payloads))
	}
}

func TestGetTestPayloads_PayloadPreservation(t *testing.T) {
	quest := Quest{
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"key": "value"},
					Data:  map[string]any{"extra": "data"},
				},
			},
		},
	}

	payloads := quest.GetTestPayloads()

	if len(payloads) != 1 {
		t.Fatalf("Expected 1 payload, got %d", len(payloads))
	}

	// Verify the payload is preserved
	payloadBytes, err := json.Marshal(payloads[0].Payload)
	if err != nil {
		t.Fatalf("Failed to marshal payload: %v", err)
	}

	expectedBytes, err := json.Marshal(quest.Tests[0].Payload)
	if err != nil {
		t.Fatalf("Failed to marshal expected: %v", err)
	}

	if string(payloadBytes) != string(expectedBytes) {
		t.Errorf("Payload not preserved correctly")
	}
}

// ==================== Edge Cases and Integration Tests ====================

func TestValidateQuestPack_MultipleValidationErrors(t *testing.T) {
	pack := QuestPack{
		ID: "test",
		Meta: QuestMeta{
			Title:       "",
			Description: "",
			Genre:       "",
		},
		UILabels: UILabels{
			GrimoireTitle: "",
			HintButton:    "",
			VerifyButton:  "",
		},
		Prologue: []string{},
		Epilogue: []string{},
		Quests:   []Quest{},
	}

	err := validateQuestPack(&pack)
	if err == nil {
		t.Error("Expected error for multiple validation failures")
	}
	// The validation should fail on the first error, not accumulate all
}

func TestValidateQuest_OptionalFields(t *testing.T) {
	// Test that optional fields can be empty
	quest := Quest{
		ID:              1,
		Title:           "Test",
		DescriptionLore: []string{"Lore"},
		DescriptionTask: "Task",
		Manual: QuestManual{
			DataModel:    "",
			RegoSnippet:  "",
			ExternalLink: "",
		},
		Hints:    []string{},
		Solution: "",
		Template: "",
		Query:    "data.test",
		Tests: []TestCase{
			{ID: 1, ExpectedOutcome: true, Payload: TestPayload{Input: nil}},
		},
	}

	err := validateQuest(&quest, 1)
	if err != nil {
		t.Errorf("validateQuest with optional fields empty should pass: %v", err)
	}
}

func TestValidateQuestPack_OptionalFields(t *testing.T) {
	// Test that optional fields can be empty
	pack := QuestPack{
		ID: "test",
		Meta: QuestMeta{
			Title:       "Title",
			Description: "Description",
			Genre:       "genre",
		},
		UILabels: UILabels{
			GrimoireTitle:          "Grimoire",
			HintButton:             "Hint",
			VerifyButton:           "Verify",
			MessageSuccess:         "",
			MessageFailure:         "",
			PerfectScoreMessage:    "",
			PerfectScoreButtonText: "",
			BeginAdventureButton:   "",
		},
		Prologue: []string{"Intro"},
		Epilogue: []string{"Outro"},
		Quests:   []Quest{createValidQuest()},
	}

	err := validateQuestPack(&pack)
	if err != nil {
		t.Errorf("validateQuestPack with optional fields empty should pass: %v", err)
	}
}

func TestValidateQuest_ManyHints(t *testing.T) {
	// Test with many hints
	quest := createValidQuest()
	hints := make([]string, 10)
	for i := range hints {
		hints[i] = "Hint"
	}
	quest.Hints = hints

	err := validateQuest(&quest, 1)
	if err != nil {
		t.Errorf("validateQuest with many valid hints should pass: %v", err)
	}
}

func TestValidateQuest_ManyLoreEntries(t *testing.T) {
	// Test with many lore entries
	quest := createValidQuest()
	lore := make([]string, 20)
	for i := range lore {
		lore[i] = "Lore entry"
	}
	quest.DescriptionLore = lore

	err := validateQuest(&quest, 1)
	if err != nil {
		t.Errorf("validateQuest with many valid lore entries should pass: %v", err)
	}
}

func TestValidateQuest_ManyTests(t *testing.T) {
	// Test with many test cases
	quest := createValidQuest()
	tests := make([]TestCase, 50)
	for i := range tests {
		tests[i] = TestCase{
			ID:              i + 1,
			ExpectedOutcome: i%2 == 0,
			Payload: TestPayload{
				Input: map[string]any{"index": i},
			},
		}
	}
	quest.Tests = tests

	err := validateQuest(&quest, 1)
	if err != nil {
		t.Errorf("validateQuest with many valid tests should pass: %v", err)
	}
}

func TestValidateQuestPack_MultipleQuests(t *testing.T) {
	// Test with multiple quests
	pack := createValidQuestPack()
	quests := make([]Quest, 5)
	for i := range quests {
		quest := createValidQuest()
		quest.ID = i + 1
		quest.Title = "Quest " + string(rune('A'+i))
		quests[i] = quest
	}
	pack.Quests = quests

	err := validateQuestPack(&pack)
	if err != nil {
		t.Errorf("validateQuestPack with multiple valid quests should pass: %v", err)
	}
}

func TestValidateQuestPack_ValidGenreExamples(t *testing.T) {
	validGenres := []string{"fantasy", "sci-fi", "horror", "mystery", "adventure", "medieval", "modern", "cyberpunk"}

	for _, genre := range validGenres {
		t.Run(genre, func(t *testing.T) {
			pack := createValidQuestPack()
			pack.Meta.Genre = genre
			err := validateQuestPack(&pack)
			if err != nil {
				t.Errorf("validateQuestPack with genre %q should pass: %v", genre, err)
			}
		})
	}
}

func TestValidateQuest_ValidQuery(t *testing.T) {
	quest := createValidQuest()
	queries := []string{
		"data.test.allow",
		"data.policy.allow",
		"data.quest.result",
		"input.user.role",
	}

	for _, query := range queries {
		t.Run(query, func(t *testing.T) {
			quest.Query = query
			err := validateQuest(&quest, 1)
			if err != nil {
				t.Errorf("validateQuest with query %q should pass: %v", query, err)
			}
		})
	}
}
