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

// Package main verifies quest solutions against test cases.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

// questVerifyTimeout bounds the evaluation of one quest's solution so a
// pathological policy (unbounded loops, oversized comprehensions) cannot
// hang the CLI. It uses the same budget as the HTTP verify endpoint.
const questVerifyTimeout = quest.DefaultVerifyTimeout

// packageDeclRe matches a Rego package declaration at the start of a
// line with only whitespace before it (literal tabs/spaces in the
// character classes).
var packageDeclRe = regexp.MustCompile(`(?m)^[ 	]*package[ 	]+[A-Za-z0-9_.]+`)

// blockCommentRe matches Rego /* ... */ block comments; they are
// stripped before testing for a package declaration.
var blockCommentRe = regexp.MustCompile(`(?s)/\*.*?\*/`)

// solutionHasPackageDeclaration reports whether the solution declares a
// package of its own. '#' line comments cannot produce a false hit (the
// pattern requires the line to start with whitespace then 'package'),
// but Rego block comments can hide a line that looks like a
// declaration, so they are stripped before the check.
func solutionHasPackageDeclaration(solution string) bool {
	return packageDeclRe.MatchString(blockCommentRe.ReplaceAllString(solution, " "))
}

// solutionModule builds the Rego module to verify for a quest, mirroring
// how players submit code: the editor content normally carries its own
// package declaration, and stored solutions either do the same or omit
// it. When the package is omitted it is derived from the quest's query
// (data.<package-path>.<rule>), so packs using a package other than
// "play" verify correctly too.
func solutionModule(query, solution string) (string, error) {
	if strings.TrimSpace(solution) == "" {
		return "", fmt.Errorf("quest has no solution")
	}
	if solutionHasPackageDeclaration(solution) {
		return solution, nil
	}

	pkg, err := packageFromQuery(query)
	if err != nil {
		return "", err
	}
	return "package " + pkg + "\n\n" + solution, nil
}

// packageFromQuery derives the Rego package path from an evaluation
// query such as "data.play.allow" (package "play") or
// "data.foo.bar.allow" (package "foo.bar"). The final query segment is
// the rule path, so it is dropped; for a bare "data.<pkg>" query the
// whole remainder is the package.
func packageFromQuery(query string) (string, error) {
	rest, found := strings.CutPrefix(strings.TrimSpace(query), "data.")
	if !found || rest == "" {
		return "", fmt.Errorf("cannot derive package from query %q: expected a data.<package>.<rule> form", query)
	}

	segments := strings.Split(rest, ".")
	packagePath := segments[0]
	if len(segments) > 1 {
		packagePath = strings.Join(segments[:len(segments)-1], ".")
	}
	if packagePath == "" {
		return "", fmt.Errorf("cannot derive package from query %q", query)
	}
	return packagePath, nil
}

// verifyQuestPack processes and verifies all quests in a pack
func verifyQuestPack(ctx context.Context, verifier *quest.Verifier, pack *quest.QuestPack) (int, int) {
	totalTests := 0
	passedTests := 0

	for _, q := range pack.Quests {
		fmt.Printf("Quest %d: %s\n", q.ID, q.Title)

		regoCode, err := solutionModule(q.Query, q.Solution)
		if err != nil {
			fmt.Printf("  ERROR: %v\n\n", err)
			// The solution could not even be assembled; count its tests
			// towards the total without passing any, as for compile errors.
			totalTests += len(q.Tests)
			continue
		}
		verifyCtx, cancel := context.WithTimeout(ctx, questVerifyTimeout)
		result, err := verifier.Verify(verifyCtx, &q, regoCode)
		cancel()
		if err != nil {
			fmt.Printf("  ERROR: %v\n\n", err)
			continue
		}

		passedCount := 0
		for _, tr := range result.Results {
			totalTests++
			if tr.Passed {
				fmt.Printf("  Test %d: PASSED (expected=%v, actual=%v)\n", tr.TestID, tr.Expected, tr.Actual)
				passedTests++
				passedCount++
			} else {
				fmt.Printf("  Test %d: FAILED (expected=%v, actual=%v)\n", tr.TestID, tr.Expected, tr.Actual)
			}
		}

		if result.Error != "" {
			// The quest's solution failed to compile or run, so none of its
			// test cases were executed. Count them towards the total without
			// counting any as passed, so the pack summary reflects the
			// failure instead of silently dropping the quest from the count.
			totalTests += len(q.Tests)
			fmt.Printf("  Quest error: %s\n", result.Error)
		}
		fmt.Printf("  Quest %d result: %d/%d tests passed\n\n", q.ID, passedCount, len(result.Results))
	}

	return totalTests, passedTests
}

func main() {
	questsFile := flag.String("questsfile", "", "Path to the quests.json file")
	flag.Parse()

	if *questsFile == "" {
		fmt.Fprintln(os.Stderr, "Error: -questsfile flag is required")
		flag.Usage()
		os.Exit(1)
	}

	data, err := os.ReadFile(*questsFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading file: %v\n", err)
		os.Exit(1)
	}

	repo := quest.NewQuestRepository()
	packID := "test-pack"
	if err := repo.LoadPack(packID, data); err != nil {
		fmt.Fprintf(os.Stderr, "Error loading quest pack: %v\n", err)
		os.Exit(1)
	}

	pack, ok := repo.GetPack(packID)
	if !ok {
		fmt.Fprintln(os.Stderr, "Error: loaded quest pack not found in repository")
		os.Exit(1)
	}
	fmt.Printf("Testing quest pack: %s\n\n", pack.Meta.Title)

	verifier := quest.NewVerifier()
	totalTests, passedTests := verifyQuestPack(context.Background(), verifier, pack)

	fmt.Printf("Overall: %d/%d tests passed\n", passedTests, totalTests)

	if totalTests == 0 {
		fmt.Println("No tests were executed!")
		os.Exit(1)
	}
	if passedTests == totalTests {
		fmt.Println("All tests PASSED!")
		os.Exit(0)
	}
	fmt.Println("Some tests FAILED!")
	os.Exit(1)
}
