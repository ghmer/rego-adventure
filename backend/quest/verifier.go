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
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/open-policy-agent/opa/v1/rego"
	"github.com/open-policy-agent/opa/v1/storage/inmem"
)

// TestResult holds the outcome of a single test case verification.
type TestResult struct {
	TestID   int  `json:"test_id"`
	Passed   bool `json:"passed"`
	Expected any  `json:"expected"`
	Actual   any  `json:"actual"`
	Input    any  `json:"input"`
}

// VerificationResult holds the overall result of verifying a quest solution.
type VerificationResult struct {
	Passed  bool         `json:"passed"`
	Error   string       `json:"error,omitempty"`
	Results []TestResult `json:"results"`
}

// Verifier handles the execution of Rego policies against test cases.
type Verifier struct{}

// NewVerifier creates a new Verifier.
func NewVerifier() *Verifier {
	return &Verifier{}
}

// normalizeValue round-trips v through JSON encoding to canonicalize its type
// representation. This converts OPA-specific types (e.g. json.Number) to standard
// Go types (float64, string, bool, []any, map[string]any) so that
// reflect.DeepEqual compares them reliably against values decoded from
// the quests.json expected_value field.
func normalizeValue(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("normalizeValue marshal: %w", err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("normalizeValue unmarshal: %w", err)
	}
	return out, nil
}

// runTestCase executes a single test case and returns the result.
func runTestCase(ctx context.Context, query string, compiledModule func(*rego.Rego),
	test TestCase) (*TestResult, error) {
	options := []func(*rego.Rego){
		rego.Query(query),
		compiledModule,
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

	r := rego.New(options...)
	rs, err := r.Eval(ctx)
	if err != nil {
		return nil, err
	}

	var rawActual any
	if len(rs) > 0 && len(rs[0].Expressions) > 0 {
		rawActual = rs[0].Expressions[0].Value
	}

	actual, err := normalizeValue(rawActual)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize actual value: %w", err)
	}

	expected, err := normalizeValue(test.ExpectedOutcome)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize expected value: %w", err)
	}

	passed := reflect.DeepEqual(actual, expected)
	return &TestResult{
		TestID:   test.ID,
		Passed:   passed,
		Expected: expected,
		Actual:   actual,
		Input:    test.Payload.Input,
	}, nil
}

// Verify checks the user's Rego code against the provided quest's test cases.
func (v *Verifier) Verify(ctx context.Context, quest *Quest, regoCode string) (*VerificationResult, error) {
	results := make([]TestResult, 0, len(quest.Tests))
	allPassed := true

	compiledModule := rego.Module("quest.rego", regoCode)

	for _, test := range quest.Tests {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		result, err := runTestCase(ctx, quest.Query, compiledModule, test)
		if err != nil {
			return &VerificationResult{
				Passed: false,
				Error:  fmt.Sprintf("Compilation/Runtime error: %v", err),
			}, nil
		}

		if !result.Passed {
			allPassed = false
		}
		results = append(results, *result)
	}

	return &VerificationResult{
		Passed:  allPassed,
		Results: results,
	}, nil
}
