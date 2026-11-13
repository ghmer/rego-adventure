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

package config

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The environment contract lives in several places: the server reads the
// names, the README table documents them, and the shipped deploy manifests
// must be able to set them. This test reads the names out of the Go sources
// and fails when a name is missing from the README table or from either
// manifest, so a new variable cannot ship without its set-and-document
// sites (and the manifests cannot drift behind the code).

var envNamePattern = regexp.MustCompile(`(?:os\.Getenv|parseBoolEnv)\("([A-Z][A-Z0-9_]*)"\)`)

// envReaderFiles are the Go sources that read environment variables.
var envReaderFiles = []string{
	"backend/config/config.go",
	"backend/logger/logger.go",
	"main.go",
}

func readRepoFile(t *testing.T, rel string) string {
	t.Helper()
	path := filepath.Join("..", "..", rel)
	data, err := os.ReadFile(path) // #nosec G304 -- repo-relative path from the list above
	if err != nil {
		t.Fatalf("failed to read %s: %v", rel, err)
	}
	return string(data)
}

func readEnvNames(t *testing.T) []string {
	t.Helper()
	seen := map[string]bool{}
	var names []string
	for _, rel := range envReaderFiles {
		for _, match := range envNamePattern.FindAllStringSubmatch(readRepoFile(t, rel), -1) {
			if !seen[match[1]] {
				seen[match[1]] = true
				names = append(names, match[1])
			}
		}
	}
	if len(names) == 0 {
		t.Fatal("extracted no environment names; the reader pattern no longer matches the sources")
	}
	return names
}

func fileContainsLine(t *testing.T, rel string, lineMatcher *regexp.Regexp) bool {
	t.Helper()
	file, err := os.Open(filepath.Join("..", "..", rel)) // #nosec G304 -- repo-relative path from the caller
	if err != nil {
		t.Fatalf("failed to open %s: %v", rel, err)
	}
	defer func() { _ = file.Close() }()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if lineMatcher.MatchString(scanner.Text()) {
			return true
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("failed to scan %s: %v", rel, err)
	}
	return false
}

func TestDeployManifestsAndReadmeDocumentEveryEnv(t *testing.T) {
	for _, name := range readEnvNames(t) {
		t.Run(name, func(t *testing.T) {
			if !fileContainsLine(t, "README.md", regexp.MustCompile(`^\|\s*`+"`"+name+"`")) {
				t.Errorf("README variable table has no row for %s", name)
			}
			if !fileContainsLine(t, "docu/deploy/k8s/configmap.yaml",
				regexp.MustCompile(`^\s*`+name+`:`)) {
				t.Errorf("docu/deploy/k8s/configmap.yaml cannot set %s", name)
			}
			if !fileContainsLine(t, "docu/deploy/docker/docker-compose.yml",
				regexp.MustCompile(`^\s*-\s*`+name+`=`)) {
				t.Errorf("docu/deploy/docker/docker-compose.yml cannot set %s", name)
			}
		})
	}
}

// TestEnvContractTestSetup pins the scanner against an impossible name, so
// the failure above cannot silently report success for everything.
func TestEnvContractTestSetup(t *testing.T) {
	if fileContainsLine(t, "README.md", regexp.MustCompile(`^\|\s*`+"`NO_SUCH_ENV_VAR`")) {
		t.Error("the README scanner matched a variable that cannot exist")
	}
	if !strings.Contains(strings.Join(envReaderFiles, " "), "config.go") {
		t.Error("the reader list lost the config sources")
	}
}
