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

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestStateMachinesCitations checks the repository's central reference
// document; this is the probe the Go CI runs on every docu/ state change.
func TestStateMachinesCitations(t *testing.T) {
	root := "../.."
	resolver, err := NewRepoResolver(root)
	if err != nil {
		t.Fatalf("failed to scan the repository: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(root, "docu", "state-machines.md"))
	if err != nil {
		t.Fatalf("failed to read the document: %v", err)
	}
	citations := ExtractCitations(string(content))
	if len(citations) < 200 {
		t.Fatalf("expected the document to carry its citation set, got %d", len(citations))
	}

	failures := Check(citations, resolver)
	for _, failure := range failures {
		t.Errorf("state-machines.md:%d: %s (%s)",
			failure.Citation.DocLine, failure.Reason, failure.Citation.Ref)
	}
}

// writeFixtureRepo builds a miniature repository: a source file, a document
// full of citations, and nothing else.
func writeFixtureRepo(t *testing.T, docContent string, sourceContent string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "pkg"), 0o750); err != nil {
		t.Fatalf("failed to create pkg dir: %v", err)
	}
	source := "package pkg\n" + sourceContent
	if err := os.WriteFile(filepath.Join(root, "pkg", "widget.go"),
		[]byte(source), 0o600); err != nil {
		t.Fatalf("failed to write widget.go: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "doc.md"),
		[]byte(docContent), 0o600); err != nil {
		t.Fatalf("failed to write doc.md: %v", err)
	}
	return root
}

func runFixture(t *testing.T, docContent, sourceContent string) []Failure {
	t.Helper()
	root := writeFixtureRepo(t, docContent, sourceContent)
	resolver, err := NewRepoResolver(root)
	if err != nil {
		t.Fatalf("failed to scan the fixture repository: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(root, "doc.md")) // #nosec G304,G703 -- fixture root built by this test
	if err != nil {
		t.Fatalf("failed to read the fixture document: %v", err)
	}
	return Check(ExtractCitations(string(content)), resolver)
}

// TestCheckRejectsSyntheticDrift proves the checker goes red for each way a
// citation can rot, using a fixture document instead of the real one.
func TestCheckRejectsSyntheticDrift(t *testing.T) {
	// package pkg / comment / func createWidget / return 7 / }
	// pkg/widget.go line layout: 1 "package pkg", 2 comment, 3 func
	// createWidget, 4 return, 5 closing brace, 6 empty (trailing newline).
	source := "// The file is not a real package doc.\nfunc createWidget() int {\n\treturn 7\n}\n"

	tests := []struct {
		name       string
		docLine    string
		wantReason string // substring of the expected failure reason; "" when valid
	}{
		{"anchored citation on the identifier line",
			"The factory is `createWidget` (`pkg/widget.go:3`).", ""},
		{"anchored citation across a valid range",
			"`createWidget` (`pkg/widget.go:3-5`).", ""},
		{"unanchored citation on a non-empty line",
			"See `pkg/widget.go:2` for the rationale.", ""},
		{"anchored citation whose line drifted",
			"The factory is `createWidget` (`pkg/widget.go:4`).",
			"does not mention \"createWidget\""},
		{"anchored citation whose range drifted",
			"`createWidget` (`pkg/widget.go:1-2`).", "does not mention"},
		{"citation past the end of the file",
			"The factory is `createWidget` (`pkg/widget.go:42`).", "exceeds"},
		{"citation on an empty line",
			"Blank at `pkg/widget.go:6`.", "is empty"},
		{"citation into a missing file",
			"See `pkg/absent.go:1`.", "does not exist"},
		{"prose between the anchor and the citation carries no claim",
			"The factory is `createWidget`, described at `pkg/widget.go:2`.", ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			failures := runFixture(t, test.docLine+"\n", source)
			if test.wantReason == "" {
				if len(failures) != 0 {
					t.Errorf("expected the citation to resolve, got %v", failures)
				}
				return
			}
			if len(failures) != 1 {
				t.Fatalf("expected exactly one failure, got %v", failures)
			}
			if !strings.Contains(failures[0].Reason, test.wantReason) {
				t.Errorf("reason %q does not contain %q", failures[0].Reason, test.wantReason)
			}
		})
	}
}

// TestCheckRejectsAmbiguousBareName requires a bare file name to name
// exactly one file, or the repository root file itself.
func TestCheckRejectsAmbiguousBareName(t *testing.T) {
	root := t.TempDir()
	dirs := []string{"a", "b", "."}
	for _, dir := range dirs {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o750); err != nil {
			t.Fatalf("failed to create %s: %v", dir, err)
		}
	}
	files := []string{filepath.Join(root, "a", "main.go"), filepath.Join(root, "b", "main.go"),
		filepath.Join(root, "doc.md"), filepath.Join(root, "main.go")}
	for _, file := range files {
		if err := os.WriteFile(file, []byte("package p\n"), 0o600); err != nil {
			t.Fatalf("failed to write %s: %v", file, err)
		}
	}
	doc := "The root file is `main.go:1`. The subdir is `a/main.go:1`. And `b/main.go:1`.\n"
	resolver, err := NewRepoResolver(root)
	if err != nil {
		t.Fatalf("failed to scan: %v", err)
	}
	failures := Check(ExtractCitations(doc), resolver)
	if len(failures) != 0 {
		t.Errorf("expected all three citations to resolve, got %v", failures)
	}
}
