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
	"maps"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// The validation constants in constants.go and the VALIDATION_LIMITS object
// in docu/quest-editor/app.js must carry identical values (see the "keep in
// sync" note in constants.go). This test enforces that contract by parsing
// both files, so a one-sided change fails CI instead of drifting silently.

const questEditorAppJS = "../../docu/quest-editor/app.js"

// jsLimitKey maps a Go constant name to its VALIDATION_LIMITS key in the
// quest editor. Every Go constant must appear here exactly once.
var jsLimitKey = map[string]string{
	"MaxPackTitle":              "PACK_TITLE",
	"MaxPackDescription":        "PACK_DESCRIPTION",
	"MaxPackGenre":              "PACK_GENRE",
	"MaxPackObjective":          "PACK_OBJECTIVE",
	"MaxUIGrimoireTitle":        "UI_GRIMOIRE_TITLE",
	"MaxUIHintButton":           "UI_HINT_BUTTON",
	"MaxUIVerifyButton":         "UI_VERIFY_BUTTON",
	"MaxUIVerifying":            "UI_VERIFYING",
	"MaxUIMessageSuccess":       "UI_MESSAGE_SUCCESS",
	"MaxUIMessageFailure":       "UI_MESSAGE_FAILURE",
	"MaxUIPerfectScoreMessage":  "UI_PERFECT_SCORE_MESSAGE",
	"MaxUIPerfectScoreButton":   "UI_PERFECT_SCORE_BUTTON",
	"MaxUIBeginAdventureButton": "UI_BEGIN_ADVENTURE_BUTTON",
	"MaxQuestTitle":             "QUEST_TITLE",
	"MaxQuestDescriptionTask":   "QUEST_DESCRIPTION_TASK",
	"MaxQuestDescriptionLore":   "QUEST_DESCRIPTION_LORE",
	"MaxQuestHint":              "QUEST_HINT",
	"MaxQuestSolution":          "QUEST_SOLUTION",
	"MaxQuestTemplate":          "QUEST_TEMPLATE",
	"MaxQuestSupportModule":     "QUEST_SUPPORT_MODULE",
	"MaxQuestSupportModules":    "QUEST_SUPPORT_MODULES_MAX",
	"MaxManualDataModel":        "MANUAL_DATA_MODEL",
	"MaxManualRegoSnippet":      "MANUAL_REGO_SNIPPET",
	"MaxManualExternalLink":     "MANUAL_EXTERNAL_LINK",
	"MaxPrologueItem":           "PROLOGUE_ITEM",
	"MaxEpilogueItem":           "EPILOGUE_ITEM",
	"MaxTestPayloadBytes":       "TEST_PAYLOAD_MAX_BYTES",
}

// goConstRe matches "MaxXxx = N" definition lines in constants.go.
var goConstRe = regexp.MustCompile(`^\s*(Max\w+)\s*=\s*(\d+)\s*$`)

// jsConstRe matches "KEY: N" entries inside the VALIDATION_LIMITS object.
var jsConstRe = regexp.MustCompile(`^\s*([A-Z][A-Z0-9_]+)\s*:\s*(\d+)\s*,?\s*$`)

// parseGoConstants extracts the constant values from constants.go.
func parseGoConstants(t *testing.T) map[string]int {
	t.Helper()

	data, err := os.ReadFile("constants.go") // #nosec G304 -- fixed test-relative path
	if err != nil {
		t.Fatalf("cannot read constants.go: %v", err)
	}

	consts := make(map[string]int)
	for i, line := range strings.Split(string(data), "\n") {
		m := goConstRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		value, err := strconv.Atoi(m[2])
		if err != nil {
			t.Fatalf("constants.go:%d: unparsable value %q: %v", i+1, m[2], err)
		}
		consts[m[1]] = value
	}
	return consts
}

// parseJSConstants extracts the VALIDATION_LIMITS entries from app.js.
func parseJSConstants(t *testing.T) map[string]int {
	t.Helper()

	data, err := os.ReadFile(questEditorAppJS) // #nosec G304 -- fixed test-relative path
	if err != nil {
		t.Fatalf("cannot read %s: %v", questEditorAppJS, err)
	}

	js := make(map[string]int)
	insideLimits := false
	for i, line := range strings.Split(string(data), "\n") {
		switch {
		case strings.Contains(line, "VALIDATION_LIMITS = {"):
			insideLimits = true
			continue
		case insideLimits && strings.HasPrefix(line, "};"):
			insideLimits = false
			continue
		case !insideLimits:
			continue
		}
		m := jsConstRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		value, err := strconv.Atoi(m[2])
		if err != nil {
			t.Fatalf("%s:%d: unparsable value %q: %v", questEditorAppJS, i+1, m[2], err)
		}
		js[m[1]] = value
	}
	if insideLimits {
		t.Fatalf("did not find the end of the VALIDATION_LIMITS object in %s", questEditorAppJS)
	}
	return js
}

func TestValidationConstants_StayInSyncWithQuestEditor(t *testing.T) {
	goConsts := parseGoConstants(t)
	jsConsts := parseJSConstants(t)

	// Every mapped pair must exist on both sides and carry the same value.
	for goName, jsKey := range jsLimitKey {
		goValue, ok := goConsts[goName]
		if !ok {
			t.Errorf("mapping references missing Go constant %q", goName)
			continue
		}
		jsValue, ok := jsConsts[jsKey]
		if !ok {
			t.Errorf("Go constant %s (%d) is missing from VALIDATION_LIMITS key %q in %s",
				goName, goValue, jsKey, questEditorAppJS)
			continue
		}
		if goValue != jsValue {
			t.Errorf("%s = %d but %s.%s = %d; update both files together",
				goName, goValue, questEditorAppJS, jsKey, jsValue)
		}
	}

	// A new JS key without a Go mapping must fail instead of silently
	// bypassing the sync check.
	for jsKey := range jsConsts {
		if !slices.Contains(slices.Collect(maps.Values(jsLimitKey)), jsKey) {
			t.Errorf("VALIDATION_LIMITS key %q in %s has no entry in jsLimitKey mapping",
				jsKey, questEditorAppJS)
		}
	}
}

// TestValidationConstants_MappingIsComplete guards against a Go constant
// being added without a JS counterpart.
func TestValidationConstants_MappingIsComplete(t *testing.T) {
	goConsts := parseGoConstants(t)

	if len(goConsts) < len(jsLimitKey) {
		t.Fatalf("expected at least %d Go constants, found %d", len(jsLimitKey), len(goConsts))
	}
	for goName := range goConsts {
		if _, ok := jsLimitKey[goName]; !ok {
			t.Errorf("Go constant %s is not covered by the jsLimitKey mapping; "+
				"add a VALIDATION_LIMITS entry to %s and map it here",
				goName, questEditorAppJS)
		}
	}
}
