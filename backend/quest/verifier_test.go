package quest

import (
	"context"
	"testing"
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
