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

package assetgen

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// The generated CSS is byte-compared against testdata goldens: the
// templates are composed from shared fragments, and this keeps the
// composition transparent — an edit that reshapes one fragment's output
// fails here instead of silently restyling every generated pack.
func TestGeneratedCSSMatchesGoldens(t *testing.T) {
	const packName = "golden"
	dir := t.TempDir()
	if err := GenerateTheme(packName, dir); err != nil {
		t.Fatalf("failed to generate theme: %v", err)
	}

	for name, golden := range map[string]string{
		"theme.css":  "golden-theme.css",
		"custom.css": "golden-custom.css",
	} {
		t.Run(name, func(t *testing.T) {
			got, err := os.ReadFile(filepath.Join(dir, packName, name)) // #nosec G304 -- generated file inside t.TempDir()
			if err != nil {
				t.Fatalf("failed to read generated %s: %v", name, err)
			}
			want, err := os.ReadFile(filepath.Join("testdata", golden)) // #nosec G304 -- repo-relative golden fixture named above
			if err != nil {
				t.Fatalf("failed to read golden %s: %v", golden, err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("generated %s drifted from testdata/%s (%d vs %d bytes); "+
					"regenerate the golden only when the change is intended",
					name, golden, len(got), len(want))
			}
		})
	}
}
