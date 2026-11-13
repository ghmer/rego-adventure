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
	"bytes"
	"context"
	"os"
	"strings"
	"testing"

	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

func TestPackageFromQuery(t *testing.T) {
	cases := []struct {
		query string
		want  string
	}{
		{"data.play.allow", "play"},
		{"data.quest.allow", "quest"},
		{"data.foo.bar.allow", "foo.bar"},
		{"data.play", "play"},
		{" data.play.allow ", "play"},
	}
	for _, tc := range cases {
		got, err := packageFromQuery(tc.query)
		if err != nil {
			t.Errorf("packageFromQuery(%q) returned error: %v", tc.query, err)
			continue
		}
		if got != tc.want {
			t.Errorf("packageFromQuery(%q) = %q, want %q", tc.query, got, tc.want)
		}
	}

	for _, query := range []string{"", "allow", "data.", "data..allow"} {
		if _, err := packageFromQuery(query); err == nil {
			t.Errorf("packageFromQuery(%q) should have failed", query)
		}
	}
}

func TestSolutionModule(t *testing.T) {
	// Solution without a package declaration gets the package derived
	// from the query, not a hardcoded "play".
	got, err := solutionModule("data.quest.allow", "default allow := false\nallow if input.x")
	if err != nil {
		t.Fatalf("solutionModule failed: %v", err)
	}
	if !strings.HasPrefix(got, "package quest\n") {
		t.Errorf("expected derived package quest, got %q", got)
	}

	// A solution that already declares its package is used verbatim; no
	// duplicated package header.
	solution := "package play\n\ndefault allow := false"
	got, err = solutionModule("data.play.allow", solution)
	if err != nil {
		t.Fatalf("solutionModule failed: %v", err)
	}
	if got != solution {
		t.Errorf("expected verbatim solution, got %q", got)
	}

	// Multi-segment packages are honored.
	got, err = solutionModule("data.foo.bar.allow", "default allow := false")
	if err != nil {
		t.Fatalf("solutionModule failed: %v", err)
	}
	if !strings.HasPrefix(got, "package foo.bar\n") {
		t.Errorf("expected derived package foo.bar, got %q", got)
	}

	if _, err := solutionModule("data.play.allow", "  "); err == nil {
		t.Error("expected error for empty solution")
	}
}

func TestSolutionModuleIgnoresBlockComments(t *testing.T) {
	// A "package" line that exists only inside a block comment must not
	// count as a package declaration; the real package is still derived.
	solution := "/*\npackage play\nThis solution allows admins.\n*/\n\ndefault allow := false"
	got, err := solutionModule("data.quest.allow", solution)
	if err != nil {
		t.Fatalf("solutionModule failed: %v", err)
	}
	if !strings.HasPrefix(got, "package quest\n") {
		t.Errorf("expected derived package quest for comment-only package line, got %q", got)
	}

	// A real declaration after a block comment is still detected.
	solution = "/* helper notes */\npackage play\n\ndefault allow := false"
	got, err = solutionModule("data.quest.allow", solution)
	if err != nil {
		t.Fatalf("solutionModule failed: %v", err)
	}
	if !strings.HasPrefix(got, "/* helper notes */\npackage play") {
		t.Errorf("expected verbatim solution when a real package declaration follows a comment, got %q", got)
	}

	// '#' line comments never match the line-start pattern.
	solution = "# package play\n# (package omitted here)\ndefault allow := false"
	got, err = solutionModule("data.quest.allow", solution)
	if err != nil {
		t.Fatalf("solutionModule failed: %v", err)
	}
	if !strings.HasPrefix(got, "package quest\n") {
		t.Errorf("expected derived package for '#'-commented package line, got %q", got)
	}
}

// passingQuest builds a quest whose solution passes all of its tests.
func passingQuest(tests int) quest.Quest {
	cases := make([]quest.TestCase, 0, tests)
	for id := 1; id <= tests; id++ {
		cases = append(cases, quest.TestCase{
			ID:              id,
			Payload:         quest.TestPayload{Input: map[string]any{"n": id}},
			ExpectedOutcome: true,
		})
	}
	return quest.Quest{
		ID:       1,
		Title:    "passing quest",
		Query:    "data.play.allow",
		Solution: "package play\n\ndefault allow := true\n",
		Tests:    cases,
	}
}

// captureStdout runs fn with os.Stdout redirected and returns what it printed.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()

	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to open pipe: %v", err)
	}
	original := os.Stdout
	os.Stdout = writer

	collected := make(chan string, 1)
	go func() {
		var buf bytes.Buffer
		if _, err := buf.ReadFrom(reader); err != nil {
			t.Errorf("failed to read captured output: %v", err)
		}
		collected <- buf.String()
	}()

	fn()

	if err := writer.Close(); err != nil {
		t.Errorf("failed to close capture writer: %v", err)
	}
	os.Stdout = original
	output := <-collected
	if err := reader.Close(); err != nil {
		t.Errorf("failed to close capture reader: %v", err)
	}
	return output
}

// TestVerifyQuestPackPassingQuest keeps the denominator honest: a quest whose
// verification ran to completion contributes exactly its own test count.
func TestVerifyQuestPackPassingQuest(t *testing.T) {
	pack := &quest.QuestPack{Quests: []quest.Quest{passingQuest(3)}}

	var total, passed int
	output := captureStdout(t, func() {
		total, passed = verifyQuestPack(context.Background(), quest.NewVerifier(), pack)
	})
	_ = output

	if total != 3 || passed != 3 {
		t.Errorf("got %d/%d passed, want 3/3", passed, total)
	}
}

// TestVerifyQuestPackCountsErroredEvaluation is the invariant the summary
// depends on: when verifier.Verify itself fails (deadline, cancellation), the
// quest's tests still count towards the total with none of them passed, so the
// run cannot report "All tests PASSED!" over a quest it never checked.
func TestVerifyQuestPackCountsErroredEvaluation(t *testing.T) {
	pack := &quest.QuestPack{Quests: []quest.Quest{passingQuest(4)}}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var total, passed int
	output := captureStdout(t, func() {
		total, passed = verifyQuestPack(ctx, quest.NewVerifier(), pack)
	})

	if total != 4 {
		t.Errorf("denominator is %d, want 4: an errored quest must not shrink it", total)
	}
	if passed != 0 {
		t.Errorf("passed is %d, want 0", passed)
	}
	if !strings.Contains(output, "ERROR:") {
		t.Errorf("the evaluation error was not printed, got:\n%s", output)
	}
}

// TestVerifyQuestPackCountsCompileError holds the same line for the other
// error shape: a solution that does not compile reports through the result
// rather than the error, and its tests count too.
func TestVerifyQuestPackCountsCompileError(t *testing.T) {
	q := passingQuest(2)
	q.Solution = "package play\n\ndefault allow := "
	pack := &quest.QuestPack{Quests: []quest.Quest{q}}

	var total, passed int
	output := captureStdout(t, func() {
		total, passed = verifyQuestPack(context.Background(), quest.NewVerifier(), pack)
	})

	if total != 2 {
		t.Errorf("denominator is %d, want 2", total)
	}
	if passed != 0 {
		t.Errorf("passed is %d, want 0", passed)
	}
	if !strings.Contains(output, "Quest error:") {
		t.Errorf("the quest error was not printed, got:\n%s", output)
	}
}

// TestVerifyQuestPackCountsUnassemblableSolution holds the line a third time:
// a solution that cannot even be turned into a module.
func TestVerifyQuestPackCountsUnassemblableSolution(t *testing.T) {
	q := passingQuest(3)
	q.Solution = ""
	pack := &quest.QuestPack{Quests: []quest.Quest{q}}

	var total, passed int
	output := captureStdout(t, func() {
		total, passed = verifyQuestPack(context.Background(), quest.NewVerifier(), pack)
	})

	if total != 3 {
		t.Errorf("denominator is %d, want 3", total)
	}
	if passed != 0 {
		t.Errorf("passed is %d, want 0", passed)
	}
	if !strings.Contains(output, "ERROR:") {
		t.Errorf("the failure was not printed, got:\n%s", output)
	}
}
