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
	"strings"
	"testing"
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
