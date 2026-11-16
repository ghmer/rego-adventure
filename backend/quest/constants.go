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

// The quest editor enforces the same limits from docu/quest-editor/rules.js,
// where they appear under these names; TestEditorLimitsMatchBackendConstants
// fails if either side changes without the other.

const (
	// FormatVersion is the quest pack format this build understands. A pack
	// whose quests.json carries no version key (the pre-v2 format) or a
	// different one is refused at load with a message pointing at
	// cmd/questmigrate. It appears in the editor's limit table because the
	// parity test pins every integer constant in this block.
	FormatVersion = 2

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
	// MaxUIVerifying is the maximum length for the verifying progress text.
	MaxUIVerifying = 100
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
	// MaxQuestTests is the maximum number of test cases per quest. Without
	// a cap, a single /api/verify request would loop over an unbounded
	// number of test cases and prepare a query per distinct data document.
	MaxQuestTests = 100
	// MaxQuestSupportModules is the maximum number of support modules per quest.
	MaxQuestSupportModules = 5
	// MaxQuestSupportModule is the maximum length for each support module.
	MaxQuestSupportModule = 10000

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

	// MaxPackNPCs is the maximum number of npc characters a pack may declare.
	// Without a cap the pack payload and the frontend's asset preload grow
	// without bound.
	MaxPackNPCs = 50
	// MaxNPCName is the maximum length of an npc key in the npcs section.
	MaxNPCName = 64
	// MaxImageName is the maximum length for an image path inside the pack:
	// an npc portrait or the pack background.
	MaxImageName = 500
)

// DefaultNPCKey is the npc key every pack must declare in its npcs section.
// It is the speaker the frontend shows for screens without a lore entry of
// their own - the quest task, hints, the modals - and the key the migration
// tool assigns to lore entries of pre-v2 packs, whose single quest-giver
// image speaks every line.
const DefaultNPCKey = "default_npc"

// NPCImagePrefix is the required prefix of an npc image path: images live in
// the pack's assets directory, which is what the asset route serves.
const NPCImagePrefix = "assets/"
