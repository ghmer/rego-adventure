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

// String length validation constants for quest pack data structures.
// These constants define maximum character limits for various fields of quests.json.

// Note: keep in sync with constants defined in docu/quest-editor/app.js
// If you change these values, you MUST update the frontend validation constants as well.

const (
	// Pack Meta - Basic information about the quest pack
	MaxPackTitle       = 100 // Maximum length for pack title
	MaxPackDescription = 500 // Maximum length for pack description
	MaxPackGenre       = 50  // Maximum length for pack genre
	MaxPackObjective   = 500 // Maximum length for initial/final objectives

	// UI Labels - Customizable UI text labels
	MaxUIGrimoireTitle        = 100  // Maximum length for grimoire title
	MaxUIHintButton           = 100  // Maximum length for hint button text
	MaxUIVerifyButton         = 100  // Maximum length for verify button text
	MaxUIMessageSuccess       = 200  // Maximum length for success message
	MaxUIMessageFailure       = 200  // Maximum length for failure message
	MaxUIPerfectScoreMessage  = 1000 // Maximum length for perfect score message
	MaxUIPerfectScoreButton   = 100  // Maximum length for perfect score button text
	MaxUIBeginAdventureButton = 100  // Maximum length for begin adventure button text

	// Quest - Individual quest fields
	MaxQuestTitle           = 100   // Maximum length for quest title
	MaxQuestDescriptionTask = 1000  // Maximum length for quest task description
	MaxQuestDescriptionLore = 2000  // Maximum length for each lore entry
	MaxQuestHint            = 500   // Maximum length for each hint
	MaxQuestSolution        = 5000  // Maximum length for quest solution
	MaxQuestTemplate        = 10000 // Maximum length for quest template

	// Manual - Quest manual/documentation fields
	MaxManualDataModel    = 2000 // Maximum length for manual data model
	MaxManualRegoSnippet  = 5000 // Maximum length for manual Rego snippet
	MaxManualExternalLink = 500  // Maximum length for manual external link

	// Narrative - Prologue and epilogue entries
	MaxPrologueItem = 2000 // Maximum length for each prologue entry
	MaxEpilogueItem = 2000 // Maximum length for each epilogue entry

	// Test - Test case payload limits
	MaxTestPayloadBytes = 50000 // Maximum size in bytes for test payloads (50KB)
)
