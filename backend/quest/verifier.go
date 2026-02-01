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
	"context"
	"fmt"

	"github.com/open-policy-agent/opa/v1/rego"
	"github.com/open-policy-agent/opa/v1/storage/inmem"
)

// VerificationResult holds the outcome of a single test case verification.
type VerificationResult struct {
	TestID   int  `json:"test_id"`
	Passed   bool `json:"passed"`
	Expected bool `json:"expected"`
	Actual   bool `json:"actual"`
	Input    any  `json:"input"`
}

// QuestVerificationResult holds the overall result of verifying a quest solution.
type QuestVerificationResult struct {
	Passed  bool                 `json:"passed"`
	Error   string               `json:"error,omitempty"`
	Results []VerificationResult `json:"results"`
}

// Verifier handles the execution of Rego policies against test cases.
type Verifier struct{}

// NewVerifier creates a new Verifier.
func NewVerifier() *Verifier {
	return &Verifier{}
}

// Verify checks the user's Rego code against the provided quest's test cases.
func (v *Verifier) Verify(ctx context.Context, quest *Quest, regoCode string) (*QuestVerificationResult, error) {
	results := []VerificationResult{}
	allPassed := true

	// query to execute, defined in the quest
	query := quest.Query

	for _, test := range quest.Tests {
		options := []func(*rego.Rego){
			rego.Query(query),
			rego.Module("quest.rego", regoCode),
			rego.Input(test.Payload.Input),
			rego.UnsafeBuiltins(map[string]struct{}{
				"http.send":          {},
				"net.lookup_ip_addr": {},
				"opa.runtime":        {},
			}),
		}

		if test.Payload.Data != nil {
			store := inmem.NewFromObject(test.Payload.Data)
			options = append(options, rego.Store(store))
		}

		// Create a new Rego object for each test to ensure clean state and avoid
		// potential state pollution, especially when tests have different data stores.
		r := rego.New(options...)

		// Run evaluation
		rs, err := r.Eval(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return &QuestVerificationResult{
				Passed: false,
				Error:  fmt.Sprintf("Compilation/Runtime error: %v", err),
			}, nil
		}

		// Check results
		actual := false
		if len(rs) > 0 && len(rs[0].Expressions) > 0 {
			if val, ok := rs[0].Expressions[0].Value.(bool); ok {
				actual = val
			}
		}

		passed := actual == test.ExpectedOutcome
		if !passed {
			allPassed = false
		}

		results = append(results, VerificationResult{
			TestID:   test.ID,
			Passed:   passed,
			Expected: test.ExpectedOutcome,
			Actual:   actual,
			Input:    test.Payload.Input,
		})
	}

	return &QuestVerificationResult{
		Passed:  allPassed,
		Results: results,
	}, nil
}
