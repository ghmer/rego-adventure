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

// Package quest defines data structures and constants for quest pack management.
package quest

// String length validation constants for quest pack data structures.
// These constants define maximum character limits for various fields of quests.json.

// Note: keep in sync with constants defined in docu/quest-editor/app.js
// If you change these values, you MUST update the frontend validation constants as well.

const (
	// MaxPackTitle is the maximum length for pack title.
	MaxPackTitle = 100
	// MaxPackDescription is the maximum length for pack description.
	MaxPackDescription = 500
	// MaxPackGenre is the maximum length for pack genre.
	MaxPackGenre = 50
	// MaxPackObjective is the maximum length for initial/final objectives.
	MaxPackObjective = 500

	// MaxUIGrimoireTitle is the maximum length for grimoire title.
	MaxUIGrimoireTitle = 100
	// MaxUIHintButton is the maximum length for hint button text.
	MaxUIHintButton = 100
	// MaxUIVerifyButton is the maximum length for verify button text.
	MaxUIVerifyButton = 100
	// MaxUIMessageSuccess is the maximum length for success message.
	MaxUIMessageSuccess = 200
	// MaxUIMessageFailure is the maximum length for failure message.
	MaxUIMessageFailure = 200
	// MaxUIPerfectScoreMessage is the maximum length for perfect score message.
	MaxUIPerfectScoreMessage = 1000
	// MaxUIPerfectScoreButton is the maximum length for perfect score button text.
	MaxUIPerfectScoreButton = 100
	// MaxUIBeginAdventureButton is the maximum length for begin adventure button text.
	MaxUIBeginAdventureButton = 100

	// MaxQuestTitle is the maximum length for quest title.
	MaxQuestTitle = 100
	// MaxQuestDescriptionTask is the maximum length for quest task description.
	MaxQuestDescriptionTask = 1000
	// MaxQuestDescriptionLore is the maximum length for each lore entry.
	MaxQuestDescriptionLore = 2000
	// MaxQuestHint is the maximum length for each hint.
	MaxQuestHint = 500
	// MaxQuestSolution is the maximum length for quest solution.
	MaxQuestSolution = 5000
	// MaxQuestTemplate is the maximum length for quest template.
	MaxQuestTemplate = 10000

	// MaxManualDataModel is the maximum length for manual data model.
	MaxManualDataModel = 2000
	// MaxManualRegoSnippet is the maximum length for manual Rego snippet.
	MaxManualRegoSnippet = 5000
	// MaxManualExternalLink is the maximum length for manual external link.
	MaxManualExternalLink = 500

	// MaxPrologueItem is the maximum length for each prologue entry.
	MaxPrologueItem = 2000
	// MaxEpilogueItem is the maximum length for each epilogue entry.
	MaxEpilogueItem = 2000

	// MaxTestPayloadBytes is the maximum size in bytes for test payloads (50KB).
	MaxTestPayloadBytes = 50000
)
