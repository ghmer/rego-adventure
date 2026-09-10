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

// normalizeValue canonicalizes value type representations without a JSON
// round-trip. It converts OPA-specific types (e.g. json.Number) to standard
// Go types (float64, string, bool, []any, map[string]any) so that
// reflect.DeepEqual compares them reliably against values decoded from
// the quests.json expected_value field.
func normalizeValue(v any) (any, error) {
	switch t := v.(type) {
	case nil:
		return nil, nil
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return nil, fmt.Errorf("normalizeValue number %s: %w", t.String(), err)
		}
		return f, nil
	case float64, string, bool:
		return t, nil
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			n, err := normalizeValue(e)
			if err != nil {
				return nil, err
			}
			out[i] = n
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, e := range t {
			n, err := normalizeValue(e)
			if err != nil {
				return nil, err
			}
			out[k] = n
		}
		return out, nil
	default:
		return t, nil
	}
}

// dataKey canonicalizes a data document so tests carrying equal data share
// one prepared query. json.Marshal sorts map keys, so the key is stable for
// equal documents.
func dataKey(data map[string]any) (string, error) {
	if data == nil {
		return "null", nil
	}
	b, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("canonicalize data document: %w", err)
	}
	return string(b), nil
}

// prepareForEval parses and compiles the user's module (plus the optional
// data store) once, producing a query that can be evaluated repeatedly
// with different inputs.
func prepareForEval(ctx context.Context, query string, compiledModule func(*rego.Rego),
	data map[string]any) (rego.PreparedEvalQuery, error) {
	options := []func(*rego.Rego){
		rego.Query(query),
		compiledModule,
		rego.UnsafeBuiltins(map[string]struct{}{
			"http.send":          {},
			"net.lookup_ip_addr": {},
			"opa.runtime":        {},
		}),
	}

	if data != nil {
		options = append(options, rego.Store(inmem.NewFromObject(data)))
	}

	return rego.New(options...).PrepareForEval(ctx)
}

// evalTestCase executes a single test case against the prepared query.
func evalTestCase(ctx context.Context, pq rego.PreparedEvalQuery, test TestCase) (*TestResult, error) {
	rs, err := pq.Eval(ctx, rego.EvalInput(test.Payload.Input))
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

	prepared := make(map[string]rego.PreparedEvalQuery)

	for _, test := range quest.Tests {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		key, err := dataKey(test.Payload.Data)
		if err != nil {
			return &VerificationResult{
				Passed: false,
				Error:  fmt.Sprintf("Compilation/Runtime error: %v", err),
			}, nil
		}

		pq, ok := prepared[key]
		if !ok {
			pq, err = prepareForEval(ctx, quest.Query, compiledModule, test.Payload.Data)
			if err != nil {
				return &VerificationResult{
					Passed: false,
					Error:  fmt.Sprintf("Compilation/Runtime error: %v", err),
				}, nil
			}
			prepared[key] = pq
		}

		result, err := evalTestCase(ctx, pq, test)
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
