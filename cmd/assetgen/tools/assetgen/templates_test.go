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

package assetgen

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The generator ships CSS that reads design tokens: a generated pack
// declares its own palette in :root, and some tokens (for example the
// modal z-index) come from the shared stylesheet every pack is served
// with. This test fails when a template emits var(--token) that neither
// the generated pack nor the shared stylesheet defines: the browser would
// silently fall back to nothing and the pack would render wrong.

var (
	cssVarUsePattern = regexp.MustCompile(`var\((--[a-z0-9-]+)\)`)
	cssTokenPattern  = regexp.MustCompile(`^\s*(--[a-z0-9-]+)\s*:\s*[^;]+;`)
)

func parseTokenNames(t *testing.T, path string) map[string]bool {
	t.Helper()
	data, err := os.ReadFile(path) // #nosec G304 -- path is a package sibling or a repo-relative constant
	if err != nil {
		t.Fatalf("failed to read %s: %v", path, err)
	}
	tokens := map[string]bool{}
	for line := range strings.SplitSeq(string(data), "\n") {
		if match := cssTokenPattern.FindStringSubmatch(line); match != nil {
			tokens[match[1]] = true
		}
	}
	return tokens
}

func TestEmittedCSSVariablesResolve(t *testing.T) {
	packTokens := map[string]bool{}
	cssTemplateFiles, err := filepath.Glob("templates/*.css.tmpl")
	if err != nil {
		t.Fatalf("failed to list templates: %v", err)
	}
	if len(cssTemplateFiles) == 0 {
		t.Fatal("no css templates found; the generator lost its skeletons")
	}
	for _, templateFile := range cssTemplateFiles {
		for token := range parseTokenNames(t, templateFile) {
			packTokens[token] = true
		}
	}
	sharedTokens := parseTokenNames(t, filepath.Join("..", "..", "..", "..",
		"frontend", "shared", "css", "base.css"))

	used := map[string]bool{}
	for _, templateFile := range append(cssTemplateFiles, "templates/README.md.tmpl") {
		data, err := os.ReadFile(templateFile) // #nosec G304 -- glob result from this test's own listing
		if err != nil {
			t.Fatalf("failed to read %s: %v", templateFile, err)
		}
		for _, match := range cssVarUsePattern.FindAllStringSubmatch(string(data), -1) {
			used[match[1]] = true
		}
	}

	var unresolved []string
	for _, token := range sortedNames(used) {
		if !packTokens[token] && !sharedTokens[token] {
			unresolved = append(unresolved, token)
		}
	}
	if len(unresolved) > 0 {
		t.Errorf("templates emit undefined var() references: %s (neither the "+
			"generated pack nor frontend/shared/css/base.css defines them)",
			strings.Join(unresolved, ", "))
	}
	if len(used) == 0 {
		t.Error("no var() usage found in the embedded templates; the extraction no longer matches the template source")
	}
}

func sortedNames(tokens map[string]bool) []string {
	names := make([]string, 0, len(tokens))
	for name := range tokens {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
