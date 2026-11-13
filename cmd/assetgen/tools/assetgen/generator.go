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

// Package assetgen handles generation of quest pack themes and assets.
package assetgen

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/ghmer/rego-adventure/v2/backend/quest"
)

// Asset represents an image asset to be generated.
type Asset struct {
	Filename string
	Width    int
	Height   int
	HexColor string
}

// placeholderMusic is a valid, silent 5 second AAC/M4A track written into
// every generated pack so the music control has something playable to load.
// A 0-byte placeholder is not playable: the media element rejects it and
// the player sees a music button that does nothing.
//
// Regenerate with:
//
//	ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -c:a aac -b:a 24k assets/bg-music.m4a
//
//go:embed assets/bg-music.m4a
var placeholderMusic []byte

// packScaffold records what a generation run changes, so a run that fails part
// way through can be taken back: a pack directory is either the complete pack or
// exactly what it held before the run started.
type packScaffold struct {
	created []string
	prior   map[string]priorContent
}

type priorContent struct {
	data []byte
	mode os.FileMode
}

// noteBefore records path just before a step writes to it. A path that was not
// there is removed again by undo. A path that was there belongs to the pack
// author: it is never removed, and what it held is kept so that a step which
// overwrote it can put the author's content back.
func (s *packScaffold) noteBefore(path string) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		s.created = append(s.created, path)
		return
	}
	if err != nil || !info.Mode().IsRegular() {
		return
	}
	if _, recorded := s.prior[path]; recorded {
		return
	}

	data, readErr := os.ReadFile(path) // #nosec G304 -- path from the run's own step list
	if readErr != nil {
		return
	}
	if s.prior == nil {
		s.prior = make(map[string]priorContent)
	}
	s.prior[path] = priorContent{data: data, mode: info.Mode().Perm()}
}

// undo removes the paths the run created, innermost first, and writes back the
// content of the files it overwrote. Errors are ignored: the point is to leave no
// half-written pack, not to report why a leftover could not be removed.
func (s *packScaffold) undo() {
	slices.Reverse(s.created)
	for _, path := range s.created {
		_ = os.RemoveAll(path)
	}
	s.created = nil

	for path, content := range s.prior {
		_ = os.WriteFile(path, content.data, content.mode) // #nosec G304 -- path noted before writing
	}
	s.prior = nil
}

// GenerateTheme creates a new quest pack theme with assets, quests.json, theme.css, custom.css, and README.md.
func GenerateTheme(themeName, outputDir string) error {
	if themeName == "" {
		return fmt.Errorf("theme name cannot be empty")
	}

	if outputDir == "" {
		return fmt.Errorf("output directory cannot be empty")
	}

	baseDir := filepath.Join(outputDir, themeName)
	// Guard against theme names that escape the output directory
	// (e.g. "../../somewhere"); a theme is a single directory name.
	if themeName != filepath.Base(themeName) || themeName == "." || themeName == ".." {
		return fmt.Errorf("theme name %q must be a single directory name", themeName)
	}

	// Nothing exists under baseDir yet when the run starts, so a failure at
	// any later step can remove the whole pack this run was building.
	scaffold := &packScaffold{}
	scaffold.noteBefore(baseDir)

	if err := generateAssets(filepath.Join(baseDir, "assets"), scaffold); err != nil {
		scaffold.undo()
		return err
	}

	steps := []struct {
		name string
		run  func() error
	}{
		{"quests.json", func() error { return generateQuestsJSON(baseDir, themeName) }},
		{"theme.css", func() error { return generateThemeCSS(baseDir) }},
		{"custom.css", func() error { return generateCustomCSS(baseDir) }},
		{"README.md", func() error { return generateREADME(baseDir, themeName) }},
	}
	for _, step := range steps {
		scaffold.noteBefore(filepath.Join(baseDir, step.name))
		if err := step.run(); err != nil {
			scaffold.undo()
			return fmt.Errorf("error generating %s: %w", step.name, err)
		}
		fmt.Printf("Generated %s\n", step.name)
	}

	fmt.Printf("\nQuest pack '%s' created successfully in %s\n", themeName, baseDir)
	fmt.Printf("\nNext steps:\n")
	fmt.Printf("1. Replace bg-music.m4a with your theme's background music\n")
	fmt.Printf("2. Customize the quest content in quests.json\n")
	fmt.Printf("3. Adjust colors and styling in theme.css\n")
	fmt.Printf("4. Add theme-specific effects in custom.css\n")
	fmt.Printf("5. Replace placeholder images in assets/ with theme-appropriate artwork\n")
	return nil
}

// generateAssets creates the assets directory with placeholder images and
// the silent placeholder background music track.
func generateAssets(assetsDir string, scaffold *packScaffold) error {
	scaffold.noteBefore(assetsDir)
	if err := os.MkdirAll(assetsDir, 0750); err != nil {
		return fmt.Errorf("error creating directory: %w", err)
	}

	assets := []Asset{
		{"bg-adventure.jpg", 1920, 1080, "#f8f6f3"}, // warm surface background
		{"hero-avatar.png", 128, 128, "#d97706"},    // amber accent
		{"npc-questgiver.png", 128, 128, "#b45309"}, // deep amber
		{"icon-success.png", 128, 128, "#16a34a"},   // fresh green success
		{"icon-failure.png", 128, 128, "#dc2626"},   // clear red failure
		{"perfect_score.png", 512, 512, "#f59e0b"},  // bright amber gold for perfect score
	}

	for _, asset := range assets {
		scaffold.noteBefore(filepath.Join(assetsDir, asset.Filename))
		if err := generateAsset(assetsDir, asset); err != nil {
			return fmt.Errorf("error generating %s: %w", asset.Filename, err)
		}
		fmt.Printf("Generated %s\n", asset.Filename)
	}

	// Silent placeholder track: decodes and plays, so the music control is
	// truthful until the pack author replaces it.
	audioPath := filepath.Join(assetsDir, "bg-music.m4a")
	scaffold.noteBefore(audioPath)
	if err := os.WriteFile(audioPath, placeholderMusic, 0600); err != nil {
		return fmt.Errorf("error creating placeholder audio: %w", err)
	}
	fmt.Printf("Generated bg-music.m4a (silent placeholder - replace with actual audio)\n")
	return nil
}

func generateAsset(dir string, asset Asset) error {
	c, err := parseHexColor(asset.HexColor)
	if err != nil {
		return err
	}

	img := image.NewRGBA(image.Rect(0, 0, asset.Width, asset.Height))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: c}, image.Point{}, draw.Src)

	path := filepath.Join(dir, asset.Filename)
	f, err := os.Create(path) // #nosec G304
	if err != nil {
		return err
	}
	defer func() {
		if err := f.Close(); err != nil {
			fmt.Printf("warning: failed to close file %s: %v\n", path, err)
		}
	}()

	ext := filepath.Ext(asset.Filename)
	switch ext {
	case ".jpg", ".jpeg":
		return jpeg.Encode(f, img, &jpeg.Options{Quality: 90})
	case ".png":
		return png.Encode(f, img)
	default:
		return fmt.Errorf("unsupported extension: %s", ext)
	}
}

func parseHexColor(s string) (color.RGBA, error) {
	if len(s) > 0 && s[0] == '#' {
		s = s[1:]
	}

	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return color.RGBA{}, err
	}

	return color.RGBA{
		R: uint8((v >> 16) & 0xFF),
		G: uint8((v >> 8) & 0xFF),
		B: uint8(v & 0xFF),
		A: 255,
	}, nil
}

// createQuestTest creates a test case with the given parameters.
func createQuestTest(id int, input any, data map[string]any, expected bool) quest.TestCase {
	return quest.TestCase{
		ID:              id,
		Payload:         quest.TestPayload{Input: input, Data: data},
		ExpectedOutcome: expected,
	}
}

// createFirstStepsQuest creates the "First Steps" tutorial quest.
func createFirstStepsQuest() quest.Quest {
	return quest.Quest{
		ID:    1,
		Title: "First Steps",
		DescriptionLore: []string{
			"You stand at the beginning of a new path.",
			"The gatekeeper asks for the password.",
		},
		DescriptionTask: "Allow access if the password is correct.",
		Query:           "data.play.allow",
		Manual: quest.Manual{
			DataModel: strings.Join([]string{
				"| Field | Description |",
				"|-------|-------------|",
				"| `input.password` | The password provided by the user |",
			}, "\n"),
			RegoSnippet: strings.Join([]string{
				"To check if a password matches:",
				"```rego",
				`allow if input.password == "secret"`,
				"```",
			}, "\n"),
			ExternalLink: "",
		},
		Hints: []string{
			"Use the `==` operator to compare the password.",
			"Access the password from `input.password`.",
			"The correct password is \"secret\".",
		},
		Solution: `default allow := false
allow if input.password == "secret"`,
		ApplyTemplate: true,
		Template: `package play

default allow := false

`,
		Tests: []quest.TestCase{
			createQuestTest(101, map[string]any{"password": "wrong"}, nil, false),
			createQuestTest(102, map[string]any{"password": "secret"}, nil, true),
		},
	}
}

// createInventoryQuest creates the "Inventory Check" quest.
func createInventoryQuest() quest.Quest {
	return quest.Quest{
		ID:    2,
		Title: "Inventory Check",
		DescriptionLore: []string{
			"The guard checks your bag.",
			"You need a pass to enter.",
		},
		DescriptionTask: "Allow access if user has a 'pass' in inventory.",
		Query:           "data.play.allow",
		Manual: quest.Manual{
			DataModel: strings.Join([]string{
				"| Field | Description |",
				"|-------|-------------|",
				"| `input.user.inventory` | A list of items the user is carrying |",
			}, "\n"),
			RegoSnippet: strings.Join([]string{
				"To check if an item is in a list:",
				"```rego",
				`allow if "item" in input.list`,
				"```",
				"Or using array iteration:",
				"```rego",
				"allow if input.list[_] == \"item\"",
				"```",
			}, "\n"),
		},
		Hints: []string{
			"Use array iteration with `[_]` to check each item in the inventory.",
			"Access the inventory at `input.user.inventory`.",
			"Check if any item equals \"pass\".",
		},
		Solution: `default allow := false
allow if input.user.inventory[_] == "pass"`,
		ApplyTemplate: true,
		Template: `package play

default allow := false

`,
		Tests: []quest.TestCase{
			createQuestTest(201,
				map[string]any{"user": map[string]any{"inventory": []string{"apple"}}},
				nil, false),
			createQuestTest(202,
				map[string]any{"user": map[string]any{"inventory": []string{"apple", "pass"}}},
				nil, true),
		},
	}
}

// createDataLookupQuest creates the "Data Lookup" quest.
func createDataLookupQuest() quest.Quest {
	return quest.Quest{
		ID:    3,
		Title: "Data Lookup",
		DescriptionLore: []string{
			"You need to check the registry.",
			"Only registered users can pass.",
		},
		DescriptionTask: "Allow access if user is in the registry.",
		Query:           "data.play.allow",
		Manual: quest.Manual{
			DataModel: strings.Join([]string{
				"| Field | Description |",
				"|-------|-------------|",
				"| `input.user.name` | The name of the user |",
				"| `data.registry` | A list of registered users |",
			}, "\n"),
			RegoSnippet: strings.Join([]string{
				"To check if a value exists in a data list:",
				"```rego",
				"allow if input.value == data.list[_]",
				"```",
			}, "\n"),
		},
		Hints: []string{
			"Compare the user's name against each entry in the registry.",
			"Use `data.registry[_]` to iterate through the registry list.",
			"The user name is at `input.user.name`.",
		},
		Solution: `default allow := false
allow if input.user.name == data.registry[_]`,
		ApplyTemplate: true,
		Template: `package play

default allow := false

`,
		Tests: []quest.TestCase{
			createQuestTest(301,
				map[string]any{"user": map[string]any{"name": "Stranger"}},
				map[string]any{"registry": []string{"Alice", "Bob"}}, false),
			createQuestTest(302,
				map[string]any{"user": map[string]any{"name": "Alice"}},
				map[string]any{"registry": []string{"Alice", "Bob"}}, true),
		},
	}
}

func createDefaultQuests() []quest.Quest {
	return []quest.Quest{
		createFirstStepsQuest(),
		createInventoryQuest(),
		createDataLookupQuest(),
	}
}

func generateQuestsJSON(dir, theme string) error {
	pack := quest.QuestPack{
		Meta: quest.MetaData{
			Title:            fmt.Sprintf("Quest Pack: %s", theme),
			Description:      "A new adventure awaits.",
			Genre:            theme,
			InitialObjective: "Read the instructions to begin your journey.",
			FinalObjective:   "Celebrate your mastery of Rego policies!",
		},
		UILabels: quest.UILabels{
			GrimoireTitle:          "Policy Grimoire",
			HintButton:             "Ask Advisor",
			VerifyButton:           "Apply Policy",
			Verifying:              "Verifying…",
			MessageSuccess:         "Quest Complete!",
			MessageFailure:         "Quest Failed",
			PerfectScoreMessage:    "You have achieved perfection in mastering Rego policies!",
			PerfectScoreButtonText: "A Secret Awaits...",
			BeginAdventureButton:   "Begin Adventure",
		},
		Prologue: []string{
			"Welcome to the new world.",
			"Your journey begins here.",
		},
		Epilogue: []string{
			"You have completed the journey.",
			"Well done.",
		},
		Quests: createDefaultQuests(),
	}

	data, err := json.MarshalIndent(pack, "", "    ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(dir, "quests.json"), data, 0600)
}

func generateThemeCSS(dir string) error {
	return renderTemplate(dir, "theme.css.tmpl", "theme.css", nil)
}

func generateCustomCSS(dir string) error {
	return renderTemplate(dir, "custom.css.tmpl", "custom.css", nil)
}

func generateREADME(dir, themeName string) error {
	return renderTemplate(dir, "README.md.tmpl", "README.md",
		map[string]string{"ThemeName": themeName})
}
