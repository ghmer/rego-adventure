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

// Shared test fixtures for the quest package. Tests that need variations
// should start from these builders and modify the returned value, so the
// fixtures stay in one place.

func createValidQuest() Quest {
	return Quest{
		ID:              1,
		Title:           "Test Quest",
		DescriptionLore: []string{"Lore entry 1", "Lore entry 2"},
		DescriptionTask: "This is the task description",
		Manual: Manual{
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
		Meta: MetaData{
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
