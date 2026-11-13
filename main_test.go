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
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
)

// Go resolves packages by directory, so a stray npm package that vendors Go
// code under frontend/adventure/node_modules (flatted used to ship
// golang/pkg/flatted) enters go list, go vet and go test as repository
// packages. This test fails when that happens, with the remediation.
func TestGoListBuildsOnlyRepositoryPackages(t *testing.T) {
	out, err := exec.CommandContext(context.Background(), "go", "list", "./...").Output()
	if err != nil {
		if exitErr, ok := errors.AsType[*exec.ExitError](err); ok {
			t.Fatalf("go list ./... failed: %v: %s", err, exitErr.Stderr)
		}
		t.Fatalf("go list ./... failed: %v", err)
	}

	var offenders []string
	for pkg := range strings.FieldsSeq(string(out)) {
		if strings.Contains(pkg, "node_modules") {
			offenders = append(offenders, pkg)
		}
	}
	if len(offenders) > 0 {
		t.Fatalf("go list ./... resolves packages outside the repository:\n%s\n"+
			"npm packages under frontend/adventure/node_modules can vendor Go code "+
			"(flatted ships golang/pkg/flatted). Remove the stray copy, e.g.\n"+
			"  rm -rf frontend/adventure/node_modules/<package>\n"+
			"or run the Go commands with the documented patterns\n"+
			"  go test ./backend/... ./cmd/... .",
			strings.Join(offenders, "\n"))
	}
}
