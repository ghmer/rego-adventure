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

// Package main migrates quest packs to the quest pack format this server
// loads. The server itself carries no migration logic: a quests.json that
// does not honour the current format is refused at load, and its log line
// names this tool as the remedy.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

const (
	packFileName = "quests.json"
	// backupSuffix is appended to the original quests.json before the
	// migrated file takes its place.
	backupSuffix = ".v1.bak"
)

const usage = `usage: questmigrate -dir <pack-dir|parent-dir> [-dry-run]

  -dir  -point at one pack (a directory containing quests.json), or at a
          directory whose immediate subdirectories are packs
  -dry-run  report what would change; write nothing

Each pre-v2 pack's quests.json is rewritten in place; the original is kept
next to it as quests.json.v1.bak, and a run refuses to overwrite an
existing backup. Packs that already declare the current format (version %d)
are left alone.`

func main() {
	dir := flag.String("dir", "", "pack directory, or a directory whose immediate subdirectories are packs")
	dryRun := flag.Bool("dry-run", false, "report what would change without writing")
	flag.Usage = func() {
		// The usage text is the exit path's last word; nowhere useful to
		// take its error.
		_, _ = fmt.Fprintf(flag.CommandLine.Output(), usage+"\n", quest.FormatVersion)
		flag.PrintDefaults()
	}
	flag.Parse()

	if *dir == "" {
		flag.Usage()
		os.Exit(2)
	}

	if err := run(*dir, *dryRun); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// run migrates every pack found under dir and reports per pack. A pack that
// fails is named on stderr and the run continues: one broken pack in a tree
// of nine must not cost the author the other eight. The exit code still
// reports the failure.
func run(dir string, dryRun bool) error {
	packs, err := findPacks(dir)
	if err != nil {
		return err
	}
	if len(packs) == 0 {
		return fmt.Errorf("%s: no %s here or in its immediate subdirectories", dir, packFileName)
	}

	failed := 0
	for _, pack := range packs {
		switch err := migratePackDir(pack, dryRun); {
		case errors.Is(err, errCurrentFormat):
			fmt.Printf("%s: format version %d already, left alone\n", filepath.Base(pack), quest.FormatVersion)
		case err != nil:
			failed++
			fmt.Fprintf(os.Stderr, "%s: %v\n", filepath.Base(pack), err)
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d packs could not be migrated", failed, len(packs))
	}
	return nil
}

// findPacks answers with the pack directories under dir. dir itself is a
// pack when it holds quests.json; otherwise its immediate subdirectories
// that hold one are the packs - the same discovery the server's own pack
// scan performs, minus the pack-ID rules, which migratePackDir applies.
func findPacks(dir string) ([]string, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", dir)
	}
	if hasPackFile(dir) {
		return []string{dir}, nil
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var packs []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		candidate := filepath.Join(dir, entry.Name())
		if hasPackFile(candidate) {
			packs = append(packs, candidate)
		}
	}
	slices.Sort(packs)
	return packs, nil
}

func hasPackFile(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, packFileName))
	return err == nil && info.Mode().IsRegular()
}

// migratePackDir migrates one pack in place: quests.json is replaced by the
// migrated bytes and the original kept as quests.json.v1.bak. The backup is
// written before the new file, and the new file arrives through a rename
// from a temporary in the same directory, so an interrupted run leaves
// either the original or the migration, never half of either.
func migratePackDir(dir string, dryRun bool) error {
	packID := filepath.Base(dir)
	if !quest.IsValidPackID(packID) {
		return fmt.Errorf("directory name %q is not a valid pack ID", packID)
	}

	packPath := filepath.Join(dir, packFileName)
	original, err := os.ReadFile(packPath) // #nosec G304 -- path built from a scanned directory entry
	if err != nil {
		return err
	}

	migrated, report, err := migratePackJSON(packID, original)
	if err != nil {
		return err
	}

	if dryRun {
		fmt.Printf("%s: would migrate (%s) [dry run, nothing written]\n", packID, report)
		return nil
	}

	info, err := os.Stat(packPath)
	if err != nil {
		return err
	}
	backupPath := packPath + backupSuffix
	if _, err := os.Stat(backupPath); !errors.Is(err, os.ErrNotExist) {
		if err != nil {
			return err
		}
		return fmt.Errorf("%s already exists: resolve it before migrating this pack again", filepath.Base(backupPath))
	}
	// #nosec G703 -- the path is the pack file's own name plus a fixed
	// suffix, inside the directory the operator pointed -dir at
	if err := os.WriteFile(backupPath, original, info.Mode().Perm()); err != nil {
		return fmt.Errorf("write the backup: %w", err)
	}

	tempPath := packPath + ".new"
	// #nosec G703 -- same reasoning as the backup: a fixed suffix on the
	// pack file's own name, inside the operator-supplied pack directory
	if err := os.WriteFile(tempPath, migrated, info.Mode().Perm()); err != nil {
		_ = os.Remove(tempPath) // best effort: the pack file itself was never touched
		return fmt.Errorf("write the migrated pack: %w", err)
	}
	if err := os.Rename(tempPath, packPath); err != nil {
		_ = os.Remove(tempPath) // best effort: the pack file itself was never touched
		return fmt.Errorf("replace quests.json: %w", err)
	}

	fmt.Printf("%s: migrated (%s)\n", packID, report)
	fmt.Printf("%s: the original is kept as %s\n", packID, filepath.Base(backupPath))
	return nil
}
