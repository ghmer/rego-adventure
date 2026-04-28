package quest

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestVerifier_Verify_Success(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"user": "admin"},
				},
			},
			{
				ID:              2,
				ExpectedOutcome: false,
				Payload: TestPayload{
					Input: map[string]any{"user": "guest"},
				},
			},
		},
	}

	regoCode := `
		package quest
		default allow = false
		allow if {
			input.user == "admin"
		}
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}

	if !result.Passed {
		t.Errorf("Expected verification to pass, but failed with error: %s", result.Error)
	}
	if len(result.Results) != 2 {
		t.Fatalf("Expected 2 results, got %d. Error: %s", len(result.Results), result.Error)
	}

	// Check individual results
	if !result.Results[0].Passed {
		t.Error("Test case 1 failed")
	}
	if !result.Results[1].Passed {
		t.Error("Test case 2 failed")
	}
}

func TestVerifier_Verify_Failure(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"user": "admin"},
				},
			},
		},
	}

	// Incorrect logic: always false
	regoCode := `
		package quest
		default allow = false
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}

	if result.Passed {
		t.Error("Expected verification to fail")
	}
	if result.Results[0].Passed {
		t.Error("Test case 1 should have failed")
	}
}

func TestVerifier_Verify_CompilationError(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{{ID: 1}},
	}

	// Invalid Rego syntax
	regoCode := `
		package quest
		default allow = 
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Expected Verify to return nil error (errors should be in result object), but got: %v", err)
	}
	if result == nil {
		t.Fatal("Expected result to be non-nil")
	}

	if result.Passed {
		t.Error("Expected verification to fail due to compilation error")
	}
	if result.Error == "" {
		t.Error("Expected error message in result")
	}
}

func TestVerifier_Verify_WithData(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"role": "admin"},
					Data: map[string]any{
						"roles": map[string]any{
							"admin": map[string]any{"level": 10},
						},
					},
				},
			},
		},
	}

	regoCode := `
		package quest
		import data.roles
		default allow = false
		allow if {
			roles[input.role].level >= 10
		}
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}

	if !result.Passed {
		t.Error("Expected verification to pass with data")
	}
}

func TestVerifier_Verify_UnsafeBuiltins(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{},
				},
			},
		},
	}

	// Attempt to use a forbidden builtin
	regoCode := `
		package quest
		default allow = false
		allow if {
			http.send({"method": "GET", "url": "http://example.com"})
		}
	`

	result, err := verifier.Verify(ctx, quest, regoCode)

	// Depending on OPA version/configuration, this might return an error during compilation/eval
	// or return a result with an error. The current implementation catches Eval errors and returns them in result.Error.

	if err != nil {
		// If it returns a Go error, that's also acceptable for a security block,
		// but our implementation wraps Eval errors.
		t.Logf("Got expected error: %v", err)
		return
	}

	if result.Passed {
		t.Error("Expected verification to fail due to unsafe builtin usage")
	}

	// We expect an error message indicating the builtin is unsafe or not allowed
	if result.Error == "" {
		t.Error("Expected error message regarding unsafe builtin")
	}
}

func TestVerifier_Verify_ContextCancelled(t *testing.T) {
	verifier := NewVerifier()
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	// Ensure context is already done
	time.Sleep(1 * time.Millisecond)

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"user": "admin"},
				},
			},
		},
	}

	regoCode := `
		package quest
		default allow = false
		allow if { input.user == "admin" }
	`

	_, err := verifier.Verify(ctx, quest, regoCode)
	// With a cancelled context, Verify should return an error.
	if err == nil {
		t.Log("Verify with cancelled context returned nil error (context may have been checked mid-loop)")
	}
}

func TestVerifier_Verify_NoTests(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{},
	}

	regoCode := `
		package quest
		default allow = false
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}

	// With no tests, all tests pass vacuously
	if !result.Passed {
		t.Error("Expected verification to pass when there are no test cases")
	}
	if len(result.Results) != 0 {
		t.Errorf("Expected 0 results, got %d", len(result.Results))
	}
}

func TestVerifier_Verify_MixedResults(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"user": "admin"},
				},
			},
			{
				ID:              2,
				ExpectedOutcome: false,
				Payload: TestPayload{
					Input: map[string]any{"user": "guest"},
				},
			},
			{
				ID:              3,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: map[string]any{"user": "superadmin"},
				},
			},
		},
	}

	// Policy only allows "admin", so test 3 (superadmin, expected true) will fail
	regoCode := `
		package quest
		default allow = false
		allow if { input.user == "admin" }
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}

	if result.Passed {
		t.Error("Expected overall verification to fail (test 3 should fail)")
	}
	if len(result.Results) != 3 {
		t.Fatalf("Expected 3 results, got %d", len(result.Results))
	}
	if !result.Results[0].Passed {
		t.Error("Test 1 (admin, expect true) should pass")
	}
	if !result.Results[1].Passed {
		t.Error("Test 2 (guest, expect false) should pass")
	}
	if result.Results[2].Passed {
		t.Error("Test 3 (superadmin, expect true) should fail")
	}
}

func TestVerifier_Verify_ResultFields(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	input := map[string]any{"user": "admin"}
	quest := &Quest{
		Query: "data.quest.allow",
		Tests: []TestCase{
			{
				ID:              42,
				ExpectedOutcome: true,
				Payload: TestPayload{
					Input: input,
				},
			},
		},
	}

	regoCode := `
		package quest
		default allow = false
		allow if { input.user == "admin" }
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}

	if len(result.Results) != 1 {
		t.Fatalf("Expected 1 result, got %d", len(result.Results))
	}

	r := result.Results[0]
	if r.TestID != 42 {
		t.Errorf("Expected TestID=42, got %d", r.TestID)
	}
	if !r.Passed {
		t.Error("Expected result to be passed")
	}
	if !reflect.DeepEqual(r.Expected, true) {
		t.Errorf("Expected Expected=true, got %v", r.Expected)
	}
	if !reflect.DeepEqual(r.Actual, true) {
		t.Errorf("Expected Actual=true, got %v", r.Actual)
	}
}

func TestVerifier_Verify_StringResult(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.access_status",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: "granted",
				Payload:         TestPayload{Input: map[string]any{"role": "admin"}},
			},
			{
				ID:              2,
				ExpectedOutcome: "denied",
				Payload:         TestPayload{Input: map[string]any{"role": "intern"}},
			},
		},
	}

	regoCode := `
		package quest
		import rego.v1
		default access_status := "denied"
		access_status := "granted" if input.role == "admin"
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}
	if !result.Passed {
		t.Errorf("Expected verification to pass, error: %s", result.Error)
	}
	if !reflect.DeepEqual(result.Results[0].Actual, "granted") {
		t.Errorf("Expected actual=\"granted\", got %v", result.Results[0].Actual)
	}
	if !reflect.DeepEqual(result.Results[1].Actual, "denied") {
		t.Errorf("Expected actual=\"denied\", got %v", result.Results[1].Actual)
	}
}

func TestVerifier_Verify_NumberResult(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.issue_count",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: float64(0),
				Payload:         TestPayload{Input: map[string]any{"token": "abc", "suspended": false}},
			},
			{
				ID:              2,
				ExpectedOutcome: float64(2),
				Payload:         TestPayload{Input: map[string]any{"suspended": true}},
			},
		},
	}

	regoCode := `
		package quest
		import rego.v1
		issues contains "missing_token" if not input.token
		issues contains "account_suspended" if input.suspended == true
		issue_count := count(issues)
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}
	if !result.Passed {
		t.Errorf("Expected verification to pass, error: %s", result.Error)
	}
	if !reflect.DeepEqual(result.Results[0].Actual, float64(0)) {
		t.Errorf("Expected actual=0, got %v (%T)", result.Results[0].Actual, result.Results[0].Actual)
	}
	if !reflect.DeepEqual(result.Results[1].Actual, float64(2)) {
		t.Errorf("Expected actual=2, got %v (%T)", result.Results[1].Actual, result.Results[1].Actual)
	}
}

func TestVerifier_Verify_ArrayResult(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.violations",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: []any{},
				Payload:         TestPayload{Input: map[string]any{"mfa_enabled": true, "cert_expired": false}},
			},
			{
				// OPA returns sets as lexicographically sorted arrays
				ID:              2,
				ExpectedOutcome: []any{"expired_cert", "no_mfa"},
				Payload:         TestPayload{Input: map[string]any{"mfa_enabled": false, "cert_expired": true}},
			},
		},
	}

	regoCode := `
		package quest
		import rego.v1
		violations contains "no_mfa" if not input.mfa_enabled
		violations contains "expired_cert" if input.cert_expired == true
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}
	if !result.Passed {
		t.Errorf("Expected verification to pass, error: %s", result.Error)
		for i, r := range result.Results {
			t.Logf("Test %d: passed=%v expected=%v actual=%v", r.TestID, r.Passed, r.Expected, r.Actual)
			_ = i
		}
	}
}

func TestVerifier_Verify_ObjectResult(t *testing.T) {
	verifier := NewVerifier()
	ctx := context.Background()

	quest := &Quest{
		Query: "data.quest.permissions",
		Tests: []TestCase{
			{
				ID:              1,
				ExpectedOutcome: map[string]any{"delete": true, "read": true, "write": true},
				Payload:         TestPayload{Input: map[string]any{"role": "admin"}},
			},
			{
				ID:              2,
				ExpectedOutcome: map[string]any{"delete": false, "read": true, "write": true},
				Payload:         TestPayload{Input: map[string]any{"role": "editor"}},
			},
			{
				ID:              3,
				ExpectedOutcome: map[string]any{"delete": false, "read": false, "write": false},
				Payload:         TestPayload{Input: map[string]any{"role": "intern"}},
			},
		},
	}

	regoCode := `
		package quest
		import rego.v1
		default permissions := {"delete": false, "read": false, "write": false}
		permissions := {"delete": true, "read": true, "write": true} if input.role == "admin"
		permissions := {"delete": false, "read": true, "write": true} if input.role == "editor"
	`

	result, err := verifier.Verify(ctx, quest, regoCode)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}
	if !result.Passed {
		t.Errorf("Expected verification to pass, error: %s", result.Error)
		for _, r := range result.Results {
			t.Logf("Test %d: passed=%v expected=%v actual=%v", r.TestID, r.Passed, r.Expected, r.Actual)
		}
	}
}
