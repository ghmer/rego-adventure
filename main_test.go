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
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// TestGoListBuildsOnlyRepositoryPackages guards the fact that Go resolves
// packages by directory: a stray package that vendors Go code under a
// node_modules directory enters go list, go vet and go test as a repository
// package. It fails for an offender git tracks, because that is what a fresh
// checkout inherits. An offender that git does not track cannot reach CI, so it
// is reported as a skip carrying its remediation: node_modules is ignored, and
// failing every developer's suite for the shape of an npm release (flatted
// ships golang/pkg/flatted) only trains people to ignore a red run. A file that
// is neither tracked nor ignored is a third case: somebody put Go code in an odd
// place locally, and that is worth saying out loud too.
func TestGoListBuildsOnlyRepositoryPackages(t *testing.T) {
	packages := strings.Fields(goRun(t, ".", "list", "./..."))
	module := goRun(t, ".", "list", "-m")
	tracked, ignored, untracked := classifyOffenders(t, ".", module, packages)

	if len(ignored) > 0 && len(tracked) == 0 && len(untracked) == 0 {
		t.Skipf("go list ./... resolves packages installed by npm:\n%s\n"+
			"they are ignored, so CI never sees them. Delete the vendored copies"+
			" (rm -rf <package>) or run the Go commands with the documented patterns\n"+
			"  go test ./backend/... ./cmd/... .",
			strings.Join(ignored, "\n"))
	}
	if len(tracked) > 0 || len(untracked) > 0 {
		t.Fatalf("go list ./... resolves packages outside the repository:\ntracked: %s\nuntracked: %s\n"+
			"npm packages under frontend/adventure/node_modules can vendor Go code "+
			"(flatted ships golang/pkg/flatted). Remove the stray copy, e.g.\n"+
			"  rm -rf frontend/adventure/node_modules/<package>\n"+
			"or run the Go commands with the documented patterns\n"+
			"  go test ./backend/... ./cmd/... .",
			strings.Join(tracked, ", "), strings.Join(untracked, ", "))
	}
}

// classifyOffenders splits the packages go list resolved into the repository
// but that live under a node_modules directory, because the three kinds are
// worth reporting differently: tracked is what the index holds (a repository
// problem), ignored is what git excludes (a local environment problem), and
// untracked-but-not-ignored is somebody's stray copy that has not been
// committed yet.
func classifyOffenders(t *testing.T, root, module string, packages []string) (tracked, ignored, untracked []string) {
	t.Helper()
	// One listing of the index, matched by prefix. Asking git about a single
	// ignored directory with a pathspec answers nothing even when its files are
	// tracked, which would misread a committed vendored package as local noise.
	trackedFiles := strings.Fields(gitRun(t, root, "ls-files"))
	for _, pkg := range packages {
		if !strings.Contains(pkg, "node_modules") {
			continue
		}
		dir := strings.TrimPrefix(pkg, module+"/")
		switch {
		case holdsPathUnder(trackedFiles, dir):
			tracked = append(tracked, dir)
		case gitIgnored(t, root, dir):
			ignored = append(ignored, dir)
		default:
			untracked = append(untracked, dir)
		}
	}
	return tracked, ignored, untracked
}

// holdsPathUnder reports whether any tracked file sits inside the directory.
func holdsPathUnder(files []string, dir string) bool {
	for _, file := range files {
		if strings.HasPrefix(file, dir+"/") {
			return true
		}
	}
	return false
}

// gitRun runs git in root and answers with its stdout, empty when it failed:
// a failing ls-files simply means the index is empty.
func gitRun(t *testing.T, root string, args ...string) string {
	t.Helper()
	out, _ := runIn(t, root, "git", args...)
	return out
}

// gitIgnored asks git whether the path is excluded by .gitignore. Exit 1 is
// git's answer for "not ignored"; any other failure is git itself failing, and
// a classification the test cannot vouch for must fail loudly: the untracked
// verdict the failure would otherwise imitate fails the suite with the remediation.
func gitIgnored(t *testing.T, root, path string) bool {
	t.Helper()
	_, err := runIn(t, root, "git", "check-ignore", "-q", "--", path)
	if err == nil {
		return true
	}
	if exitErr, ok := errors.AsType[*exec.ExitError](err); ok && exitErr.ExitCode() == 1 {
		return false
	}
	t.Fatalf("git check-ignore could not classify %s: %v", path, err)
	return false
}

// goRun runs go in root and answers with its stdout, failing the test when the
// tool itself refuses: an unrunnable go is not a finding about the tree.
func goRun(t *testing.T, root string, args ...string) string {
	t.Helper()
	out, err := runIn(t, root, "go", args...)
	if err != nil {
		t.Fatalf("go %s failed: %v: %s", strings.Join(args, " "), err, stderrOf(err))
	}
	return out
}

// runIn runs one command in a directory and answers with its trimmed stdout.
func runIn(t *testing.T, root, name string, args ...string) (string, error) {
	t.Helper()
	cmd := exec.CommandContext(context.Background(), name, args...) // #nosec G204 -- commands fixed here
	cmd.Dir = root
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// stderrOf pulls the stderr out of a failed command error, for a message that
// says what the tool complained about.
func stderrOf(err error) string {
	if exitErr, ok := errors.AsType[*exec.ExitError](err); ok {
		return string(exitErr.Stderr)
	}
	return ""
}

// TestClassifyOffenders tells the three kinds of vendored Go code apart on a
// fixture repository: an npm install git ignores, a package committed into the
// repository, and a stray copy that is neither.
func TestClassifyOffenders(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		// Three rules, one per kind of offender: npm installed and ignored, a
		// vendored copy the ignore rule would exclude but git tracks anyway,
		// and a stray copy no rule speaks about.
		".gitignore": "frontend/adventure/node_modules/\nvendored/node_modules/\n",
		"frontend/adventure/node_modules/flatted/golang/pkg/flatted/flatted.go": "package flatted\n",
		"other/node_modules/straycopy/pkg/stray/stray.go":                       "package stray\n",
		"vendored/node_modules/committedpkg/pkg/inner/inner.go":                 "package inner\n",
	}
	for file, content := range files {
		path := filepath.Join(root, file)
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatalf("failed to create %s: %v", file, err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatalf("failed to write %s: %v", file, err)
		}
	}
	if out, err := runIn(t, root, "git", "init", "-q"); err != nil {
		t.Fatalf("git init failed: %v: %s", err, out)
	}
	// One offender is tracked, forced past the ignore rule the way a real
	// commit of a vendored package would be.
	out, err := runIn(t, root, "git", "add", "-f", "--", ".gitignore",
		"vendored/node_modules/committedpkg/pkg/inner/inner.go")
	if err != nil {
		t.Fatalf("git add failed: %v: %s", err, out)
	}

	packages := []string{
		"fixture/frontend/adventure/node_modules/flatted/golang/pkg/flatted",
		"fixture/other/node_modules/straycopy/pkg/stray",
		"fixture/vendored/node_modules/committedpkg/pkg/inner",
		"fixture/backend/http",
	}
	tracked, ignored, untracked := classifyOffenders(t, root, "fixture", packages)

	if diff := sameAs(tracked, []string{"vendored/node_modules/committedpkg/pkg/inner"}); diff != "" {
		t.Errorf("tracked offenders: %s", diff)
	}
	if diff := sameAs(ignored, []string{"frontend/adventure/node_modules/flatted/golang/pkg/flatted"}); diff != "" {
		t.Errorf("ignored offenders: %s", diff)
	}
	if diff := sameAs(untracked, []string{"other/node_modules/straycopy/pkg/stray"}); diff != "" {
		t.Errorf("untracked offenders: %s", diff)
	}
}

// sameAs compares two string slices and answers with a description of the
// difference, empty when they hold the same entries in the same order.
func sameAs(got, want []string) string {
	if slices.Equal(got, want) {
		return ""
	}
	return fmt.Sprintf("got %v, want %v", got, want)
}
