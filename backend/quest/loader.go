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
	"fmt"
	"os"
	"path/filepath"
)

// PackLoadWarning describes one quest pack directory that could not be
// loaded. Loading the remaining packs continues after a warning; the
// caller decides how to surface them (the server logs them at startup).
type PackLoadWarning struct {
	PackID string
	Err    error
}

// Unwrap returns the underlying error, so errors.Is/As work on warnings.
func (w PackLoadWarning) Unwrap() error { return w.Err }

// LoadPacksFromDir scans dir for subdirectories containing quests.json and
// loads each as a quest pack. The directory name is the pack ID. Packs
// that fail to read or validate produce PackLoadWarnings and do not stop
// the scan; only a failure to read dir itself is returned as a fatal
// error. It returns the number of packs successfully loaded.
func LoadPacksFromDir(repo *QuestRepository, dir string) (int, []PackLoadWarning, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, nil, fmt.Errorf("failed to read quests directory %q: %w", dir, err)
	}

	loaded := 0
	var warnings []PackLoadWarning
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		packID := entry.Name()
		if !IsValidPackID(packID) {
			warnings = append(warnings, PackLoadWarning{
				PackID: packID,
				Err:    fmt.Errorf("directory name is not a valid pack ID; skipping"),
			})
			continue
		}

		jsonPath := filepath.Join(dir, packID, "quests.json")
		data, err := os.ReadFile(jsonPath) // #nosec G304 -- path built from a scanned directory entry
		if err != nil {
			warnings = append(warnings, PackLoadWarning{PackID: packID, Err: err})
			continue
		}
		if err := repo.LoadPack(packID, data); err != nil {
			warnings = append(warnings, PackLoadWarning{PackID: packID, Err: err})
			continue
		}
		loaded++
	}

	return loaded, warnings, nil
}
