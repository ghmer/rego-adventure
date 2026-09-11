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
	"errors"
	"fmt"
	"reflect"

	"github.com/open-policy-agent/opa/v1/ast"
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
	// Undefined reports that the policy query evaluated to undefined for
	// this test, i.e. no rule produced a value (distinct from null).
	Undefined bool `json:"undefined,omitempty"`
}

// PolicyError describes a single compile-time problem with the submitted
// policy, including its location in the user's code.
type PolicyError struct {
	Line    int    `json:"line,omitempty"`
	Col     int    `json:"col,omitempty"`
	Message string `json:"message"`
}

// VerificationResult holds the overall result of verifying a quest solution.
type VerificationResult struct {
	Passed  bool          `json:"passed"`
	Error   string        `json:"error,omitempty"`
	Details []PolicyError `json:"error_details,omitempty"`
	Results []TestResult  `json:"results"`
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
		return normalizeNumber(t)
	case float64, string, bool:
		return t, nil
	case []any:
		return normalizeSlice(t)
	case map[string]any:
		return normalizeMap(t)
	default:
		return t, nil
	}
}

// normalizeNumber converts an OPA json.Number to float64.
func normalizeNumber(n json.Number) (any, error) {
	f, err := n.Float64()
	if err != nil {
		return nil, fmt.Errorf("normalizeValue number %s: %w", n.String(), err)
	}
	return f, nil
}

// normalizeSlice canonicalizes each element of an array value.
func normalizeSlice(items []any) (any, error) {
	out := make([]any, len(items))
	for i, e := range items {
		n, err := normalizeValue(e)
		if err != nil {
			return nil, err
		}
		out[i] = n
	}
	return out, nil
}

// normalizeMap canonicalizes each value of an object.
func normalizeMap(m map[string]any) (any, error) {
	out := make(map[string]any, len(m))
	for k, e := range m {
		n, err := normalizeValue(e)
		if err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, nil
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

	// An empty result set means the query evaluated to undefined: no rule
	// produced a value. This differs from an explicit null result.
	undefined := len(rs) == 0 || len(rs[0].Expressions) == 0

	var rawActual any
	if !undefined {
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
		TestID:    test.ID,
		Passed:    passed,
		Expected:  expected,
		Actual:    actual,
		Input:     test.Payload.Input,
		Undefined: undefined,
	}, nil
}

// collectAstErrors unwraps the various error shapes OPA uses for compile
// problems (ast.Errors, rego.Errors wrapping *ast.Error elements, or a
// single *ast.Error) into a flat list.
func collectAstErrors(err error) []*ast.Error {
	if batched, ok := errors.AsType[ast.Errors](err); ok {
		out := make([]*ast.Error, 0, len(batched))
		for _, e := range batched {
			if e != nil {
				out = append(out, e)
			}
		}
		return out
	}

	if wrapped, ok := errors.AsType[rego.Errors](err); ok {
		var out []*ast.Error
		for _, e := range wrapped {
			if ae, ok := errors.AsType[*ast.Error](e); ok {
				out = append(out, ae)
			}
		}
		return out
	}

	if single, ok := errors.AsType[*ast.Error](err); ok {
		return []*ast.Error{single}
	}
	return nil
}

// policyErrors extracts structured compile errors with source locations
// from OPA errors. Compile errors arrive either as ast.Errors, as a single
// *ast.Error, or wrapped in rego.Errors. It returns nil for errors without
// structured details.
func policyErrors(err error) []PolicyError {
	astErrs := collectAstErrors(err)
	if len(astErrs) == 0 {
		return nil
	}

	details := make([]PolicyError, 0, len(astErrs))
	for _, e := range astErrs {
		details = append(details, newPolicyError(e))
	}
	return details
}

// newPolicyError converts a single OPA error into a PolicyError with
// 1-based source location.
func newPolicyError(e *ast.Error) PolicyError {
	detail := PolicyError{Message: fmt.Sprintf("%s: %s", e.Code, e.Message)}
	if e.Location != nil {
		detail.Line = e.Location.Row
		detail.Col = e.Location.Col
	}
	return detail
}

// verificationError converts a compile or runtime failure into a
// VerificationResult. Compile errors are reported as structured details
// with line/column locations in the user's code.
func verificationError(err error) *VerificationResult {
	if details := policyErrors(err); len(details) > 0 {
		return &VerificationResult{
			Passed:  false,
			Error:   "Compilation error",
			Details: details,
		}
	}
	return &VerificationResult{
		Passed: false,
		Error:  fmt.Sprintf("Runtime error: %v", err),
	}
}

// Verify checks the user's Rego code against the provided quest's test cases.
// Compilation problems are reported in the result's Error field with
// structured location details; runtime problems only in the Error field.
// The returned error is reserved for a cancelled or timed-out context.
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
			return verificationError(err), nil
		}

		pq, ok := prepared[key]
		if !ok {
			pq, err = prepareForEval(ctx, quest.Query, compiledModule, test.Payload.Data)
			if err != nil {
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				return verificationError(err), nil
			}
			prepared[key] = pq
		}

		result, err := evalTestCase(ctx, pq, test)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return verificationError(err), nil
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
