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
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The shared stylesheet and the quest editor's stylesheet both declare CSS
// custom properties in :root blocks. A token declared in both is one
// contract maintained twice; this test fails when the two copies drift, in
// the same way rules_parity_test.go guards the validation rules. A token
// kept in a single file needs no parity and is not checked.

var cssTokenPattern = regexp.MustCompile(`^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);`)

func parseCSSTokens(t *testing.T, path string) map[string]string {
	t.Helper()
	data, err := os.ReadFile(path) // #nosec G304 -- repo-relative path from the caller
	if err != nil {
		t.Fatalf("failed to read %s: %v", path, err)
	}
	tokens := map[string]string{}
	for line := range strings.SplitSeq(string(data), "\n") {
		if match := cssTokenPattern.FindStringSubmatch(line); match != nil {
			tokens[match[1]] = strings.TrimSpace(match[2])
		}
	}
	return tokens
}

func TestSharedCSSTokensMatchQuestEditorTokens(t *testing.T) {
	base := parseCSSTokens(t, filepath.Join("..", "..", "frontend", "shared", "css", "base.css"))
	editor := parseCSSTokens(t, filepath.Join("..", "..", "docu", "quest-editor", "styles.css"))

	var shared []string
	for _, name := range sortedKeys(base) {
		if editorValue, ok := editor[name]; ok {
			shared = append(shared, name)
			if base[name] != editorValue {
				t.Errorf("token %s diverged: shared css has %q, quest editor has %q",
					name, base[name], editorValue)
			}
		}
	}
	t.Logf("%d tokens shared between the stylesheets: %v", len(shared), shared)
}

func sortedKeys(tokens map[string]string) []string {
	keys := make([]string, 0, len(tokens))
	for name := range tokens {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	return keys
}
