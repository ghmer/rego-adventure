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

	"github.com/ghmer/rego-adventure/backend/quest"
)

// verifyQuestPack processes and verifies all quests in a pack
func verifyQuestPack(ctx context.Context, verifier *quest.Verifier, pack *quest.QuestPack) (int, int) {
	totalTests := 0
	passedTests := 0

	for _, q := range pack.Quests {
		fmt.Printf("Quest %d: %s\n", q.ID, q.Title)

		regoCode := "package play\nimport rego.v1\n\n" + q.Solution
		result, err := verifier.Verify(ctx, &q, regoCode)
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

	pack, _ := repo.GetPack(packID)
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
