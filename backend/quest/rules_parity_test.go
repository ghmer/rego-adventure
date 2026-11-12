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
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// The quest editor validates a pack before exporting it and the backend
// validates it again on load. The editor's rules are declarative data in
// docu/quest-editor/rules.js; these tests compare that list against the
// server's own checks in three ways:
//
//   - the length limits are the same numbers under the same names;
//   - every rule has a fixture pack that the server really refuses, and every
//     fixture belongs to a rule that exists;
//   - every field label the server's validation functions use is claimed by an
//     editor rule, and every label an editor rule claims is really used by the
//     server.
//
// docu/quest-editor/rules.test.js runs the same fixture packs through the
// editor's validatePack, so a pack is accepted or refused by both halves or by
// neither.

const (
	editorRulesPath  = "../../docu/quest-editor/rules.js"
	editorFixtureDir = "../../docu/quest-editor/testdata"

	// questLabelPrefix is how models.go addresses a quest inside a validation
	// message: the local variable p holds "quest %d". The test asserting the
	// convention below fails if that construction changes.
	questLabelPrefix = "quest {n}"
)

type editorRule struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Path        string   `json:"path"`
	Host        string   `json:"host"`
	Field       string   `json:"field"`
	Limit       string   `json:"limit"`
	ServerLabel string   `json:"serverLabel"`
	Optional    bool     `json:"optional"`
	Schemes     []string `json:"schemes"`
}

type editorRules struct {
	Limits map[string]int `json:"limits"`
	Rules  []editorRule   `json:"rules"`
}

// loadEditorRules reads the rule block out of the editor's rules.js. The block
// is a JSON string literal on purpose so it can be read without evaluating the
// script.
func loadEditorRules(t *testing.T) editorRules {
	t.Helper()

	source := readEditorRulesSource(t)
	const marker = "const PACK_RULES = JSON.parse(`"
	_, rest, found := strings.Cut(source, marker)
	if !found {
		t.Fatalf("%s: rule block marker %q not found", editorRulesPath, marker)
	}
	block, _, found := strings.Cut(rest, "`)")
	if !found {
		t.Fatalf("%s: rule block is not closed by a backtick", editorRulesPath)
	}

	var rules editorRules
	if err := json.Unmarshal([]byte(block), &rules); err != nil {
		t.Fatalf("%s: rule block is not valid JSON: %v", editorRulesPath, err)
	}
	if len(rules.Rules) == 0 || len(rules.Limits) == 0 {
		t.Fatalf("%s: rule block carries no rules or limits", editorRulesPath)
	}
	return rules
}

func readEditorRulesSource(t *testing.T) string {
	t.Helper()

	content, err := os.ReadFile(editorRulesPath)
	if err != nil {
		t.Fatalf("read %s: %v", editorRulesPath, err)
	}
	return string(content)
}

// goNumericConstants returns the integer constants declared in a file, keyed by
// name.
func goNumericConstants(t *testing.T, path string) map[string]int {
	t.Helper()

	file := parseGoFile(t, path)
	values := map[string]int{}
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok {
			return true
		}
		for i, name := range spec.Names {
			if i >= len(spec.Values) {
				continue
			}
			literal, ok := spec.Values[i].(*ast.BasicLit)
			if !ok || literal.Kind != token.INT {
				continue
			}
			number, err := strconv.Atoi(literal.Value)
			if err != nil {
				continue
			}
			values[name.Name] = number
		}
		return true
	})
	return values
}

func parseGoFile(t *testing.T, path string) *ast.File {
	t.Helper()

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return file
}

func TestEditorLimitsMatchBackendConstants(t *testing.T) {
	rules := loadEditorRules(t)
	constantsPath := filepath.Join(".", "constants.go")
	constants := goNumericConstants(t, constantsPath)
	if len(constants) == 0 {
		t.Fatalf("%s: no integer constants found", constantsPath)
	}

	for name, value := range constants {
		got, ok := rules.Limits[name]
		if !ok {
			t.Errorf("%s declares %s = %d but %s has no such limit", constantsPath, name, value, editorRulesPath)
			continue
		}
		if got != value {
			t.Errorf("%s limit %s is %d in %s and %d in %s",
				name, name, got, editorRulesPath, value, constantsPath)
		}
	}
	for name := range rules.Limits {
		if _, ok := constants[name]; !ok {
			t.Errorf("%s limit %s has no constant in %s", editorRulesPath, name, constantsPath)
		}
	}
}

// questLabelConstruction pins the convention the label comparison relies on: a
// quest is addressed as "quest %d" in a variable named p.
func TestQuestValidationLabelPrefixConvention(t *testing.T) {
	source, err := os.ReadFile(filepath.Join(".", "models.go"))
	if err != nil {
		t.Fatalf("read models.go: %v", err)
	}
	const want = `p := fmt.Sprintf("quest %d", questIndex)`
	if got := strings.Count(string(source), want); got != 1 {
		t.Fatalf("models.go states the quest label prefix %q %d times; "+
			"update the label convention in rules_parity_test.go and the serverLabel values in %s",
			want, got, editorRulesPath)
	}
}

// serverFieldLabels collects the field labels the server's validation helpers
// are called with. Labels built from the quest prefix or with fmt.Sprintf are
// normalized to the same shape the editor rule list uses: {n} for a quest
// number, {i} for an index.
func serverFieldLabels(t *testing.T) map[string]bool {
	t.Helper()

	labels := map[string]bool{}
	for _, name := range []string{"models.go"} {
		file := parseGoFile(t, filepath.Join(".", name))
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			function, ok := call.Fun.(*ast.Ident)
			if !ok {
				return true
			}
			switch function.Name {
			case "validateNonEmpty", "validateStringLength", "validateAlphanumericWithSpaces":
			default:
				return true
			}
			label := call.Args[len(call.Args)-1]
			normalized, ok, fromTable := normalizeLabel(label)
			if fromTable {
				// The UI label table carries these labels as literals and the
				// table itself is scanned below.
				return true
			}
			if !ok {
				t.Errorf("validation helper in %s uses a label this test cannot read: %s",
					name, formatNode(label))
				return true
			}
			labels[normalized] = true
			return true
		})
	}

	// The UI labels are validated through a table whose rows carry the label as
	// a string literal, so those literals are collected as well.
	models := parseGoFile(t, filepath.Join(".", "models.go"))
	ast.Inspect(models, func(node ast.Node) bool {
		composite, ok := node.(*ast.CompositeLit)
		if !ok {
			return true
		}
		if !isUILabelTable(composite) {
			return true
		}
		for _, row := range composite.Elts {
			fields, ok := row.(*ast.CompositeLit)
			if !ok {
				continue
			}
			for _, field := range fields.Elts {
				literal, ok := field.(*ast.BasicLit)
				if ok && literal.Kind == token.STRING {
					labels[unquote(literal.Value)] = true
				}
			}
		}
		return true
	})

	return labels
}

// isUILabelTable recognises the UI label table in validateUILabels, whose rows
// carry the label the validation helpers are called with.
func isUILabelTable(composite *ast.CompositeLit) bool {
	if composite.Type == nil {
		return false
	}
	array, ok := composite.Type.(*ast.ArrayType)
	if !ok {
		return false
	}
	element, ok := array.Elt.(*ast.Ident)
	return ok && element.Name == "uiLabel"
}

// normalizeLabel turns the label argument of a validation helper call into the
// shape the editor rule list uses. The third result reports a label read from
// the UI label table, which the table scan supplies instead.
func normalizeLabel(expr ast.Expr) (string, bool, bool) {
	switch value := expr.(type) {
	case *ast.BasicLit:
		if value.Kind != token.STRING {
			return "", false, false
		}
		return unquote(value.Value), true, false
	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return "", false, false
		}
		prefix, ok := identPrefix(value.X)
		if !ok {
			return "", false, false
		}
		literal, ok := value.Y.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return "", false, false
		}
		return prefix + " " + strings.TrimSpace(unquote(literal.Value)), true, false
	case *ast.CallExpr:
		label, ok := normalizeSprintfLabel(value)
		return label, ok, false
	case *ast.SelectorExpr:
		if value.Sel != nil && value.Sel.Name == "name" {
			return "", false, true
		}
		return "", false, false
	default:
		return "", false, false
	}
}

func identPrefix(expr ast.Expr) (string, bool) {
	ident, ok := expr.(*ast.Ident)
	if !ok || ident.Name != "p" {
		return "", false
	}
	return questLabelPrefix, true
}

func normalizeSprintfLabel(call *ast.CallExpr) (string, bool) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Sprintf" {
		return "", false
	}
	format, ok := call.Args[0].(*ast.BasicLit)
	if !ok || format.Kind != token.STRING {
		return "", false
	}
	label := unquote(format.Value)
	for _, arg := range call.Args[1:] {
		if prefix, ok := identPrefix(arg); ok {
			label = strings.Replace(label, "%s", prefix, 1)
			continue
		}
		label = strings.Replace(label, "%d", "{i}", 1)
	}
	if strings.Contains(label, "%") {
		return "", false
	}
	return label, true
}

func unquote(literal string) string {
	value, err := strconv.Unquote(literal)
	if err != nil {
		return strings.Trim(literal, `"`)
	}
	return value
}

func formatNode(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.BasicLit:
		return value.Value
	case *ast.Ident:
		return value.Name
	case *ast.SelectorExpr:
		return formatNode(value.X) + "." + value.Sel.Name
	case *ast.BinaryExpr:
		return formatNode(value.X) + " + " + formatNode(value.Y)
	case *ast.CallExpr:
		return "fmt.Sprintf(...)"
	default:
		return fmt.Sprintf("%T", expr)
	}
}

func TestEditorRulesCoverEveryServerFieldLabel(t *testing.T) {
	rules := loadEditorRules(t)
	labels := serverFieldLabels(t)
	if len(labels) == 0 {
		t.Fatal("no server validation labels found; the scan stopped working")
	}

	claimed := map[string]int{}
	for _, rule := range rules.Rules {
		if rule.ServerLabel == "" {
			continue
		}
		claimed[rule.ServerLabel]++
	}

	for label := range labels {
		if claimed[label] == 0 {
			t.Errorf("the backend validates %q but %s claims no rule for it; add the rule to the editor's rule list",
				label, editorRulesPath)
		}
	}
	for label, count := range claimed {
		if !labels[label] {
			t.Errorf("%s claims the server label %q (%d rule(s)) but no backend validation call uses it; "+
				"check the server and update the rule list", editorRulesPath, label, count)
		}
	}
}

type fixturePatch struct {
	Path   string `json:"path"`
	Value  any    `json:"value"`
	Remove bool   `json:"remove"`
}

type fixtureCase struct {
	RuleID  string         `json:"ruleId"`
	Name    string         `json:"name"`
	Valid   bool           `json:"valid"`
	Patches []fixturePatch `json:"patches"`
}

type fixtureFile struct {
	BasePack map[string]any `json:"basePack"`
	Cases    []fixtureCase  `json:"cases"`
}

func loadFixtures(t *testing.T) (map[string]any, []fixtureCase) {
	t.Helper()

	path := filepath.Join(editorFixtureDir, "pack-validation-fixtures.json")
	content, err := os.ReadFile(path) // #nosec G304 -- fixed test-relative path
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var file fixtureFile
	if err := json.Unmarshal(content, &file); err != nil {
		t.Fatalf("parse fixtures %s: %v", path, err)
	}
	if file.BasePack == nil || len(file.Cases) == 0 {
		t.Fatalf("fixtures %s carry no base pack or no cases", path)
	}
	return file.BasePack, file.Cases
}

// buildFixturePack applies a case's patches to a copy of the base pack.
func buildFixturePack(t *testing.T, base map[string]any, patches []fixturePatch) map[string]any {
	t.Helper()

	raw, err := json.Marshal(base)
	if err != nil {
		t.Fatalf("copy base pack: %v", err)
	}
	var pack map[string]any
	if err := json.Unmarshal(raw, &pack); err != nil {
		t.Fatalf("copy base pack: %v", err)
	}
	for _, patch := range patches {
		applyFixturePatch(t, pack, patch)
	}
	return pack
}

func applyFixturePatch(t *testing.T, pack map[string]any, patch fixturePatch) {
	t.Helper()

	segments := strings.Split(patch.Path, ".")
	if len(segments) == 0 || segments[0] == "" {
		t.Fatalf("fixture patch path %q is empty", patch.Path)
	}

	container := any(pack)
	for i, segment := range segments {
		last := i == len(segments)-1
		name := segment

		if index, err := strconv.Atoi(segment); err == nil {
			list, ok := container.([]any)
			if !ok {
				t.Fatalf("fixture patch path %q: %q is not an array", patch.Path, strings.Join(segments[:i+1], "."))
			}
			if index < 0 || index >= len(list) {
				t.Fatalf("fixture patch path %q: index %d out of range", patch.Path, index)
			}
			if last {
				if patch.Remove {
					list = append(list[:index], list[index+1:]...)
					replaceAt(t, pack, segments[:i], any(list))
					return
				}
				list[index] = expandFixtureValue(patch.Value)
				return
			}
			container = list[index]
			continue
		}

		object, ok := container.(map[string]any)
		if !ok {
			t.Fatalf("fixture patch path %q: %q is not an object", patch.Path, strings.Join(segments[:i+1], "."))
		}
		if last {
			if patch.Remove {
				t.Fatalf("fixture patch path %q: remove needs an array position", patch.Path)
			}
			object[name] = expandFixtureValue(patch.Value)
			return
		}
		container = object[name]
	}
	t.Fatalf("fixture patch path %q walks off the end of the pack", patch.Path)
}

// replaceAt writes a whole array back after an element was removed.
func replaceAt(t *testing.T, pack map[string]any, segments []string, value any) {
	t.Helper()

	if len(segments) == 0 {
		t.Fatalf("fixture patch removes the top level of the pack")
	}
	container := any(pack)
	for i, segment := range segments {
		last := i == len(segments)-1
		if index, err := strconv.Atoi(segment); err == nil {
			list := container.([]any)
			if !last {
				container = list[index]
				continue
			}
			list[index] = value
			return
		}
		object, ok := container.(map[string]any)
		if !ok {
			t.Fatalf("fixture patch cannot write back %q", strings.Join(segments, "."))
		}
		if last {
			object[segment] = value
			return
		}
		container = object[segment]
	}
}

// expandFixtureValue expands the two generator forms the fixture file uses:
// {"count": n, "value": v} and {"$repeatChars": n, "char": c}.
func expandFixtureValue(value any) any {
	object, ok := value.(map[string]any)
	if !ok {
		if list, ok := value.([]any); ok {
			for i, item := range list {
				list[i] = expandFixtureValue(item)
			}
		}
		return value
	}

	if count, ok := object["count"]; ok {
		total, _ := count.(float64)
		repeated := make([]any, 0, int(total))
		for i := 0; i < int(total); i++ {
			repeated = append(repeated, expandFixtureValue(object["value"]))
		}
		return repeated
	}

	if repeat, ok := object["$repeatChars"]; ok {
		total, _ := repeat.(float64)
		char, _ := object["char"].(string)
		if char == "" {
			char = "x"
		}
		return strings.Repeat(char, int(total))
	}

	for key, item := range object {
		object[key] = expandFixtureValue(item)
	}
	return object
}

func TestEditorRulesAndServerRefuseTheSamePacks(t *testing.T) {
	rules := loadEditorRules(t)
	base, cases := loadFixtures(t)

	byRule := map[string]bool{}
	for _, rule := range rules.Rules {
		byRule[rule.ID] = true
	}
	fixtureRules := map[string]bool{}
	for _, testCase := range cases {
		if testCase.RuleID == "" {
			continue
		}
		if !byRule[testCase.RuleID] {
			t.Errorf("fixture case %q targets rule %q, which %s does not declare",
				testCase.Name, testCase.RuleID, editorRulesPath)
		}
		fixtureRules[testCase.RuleID] = true
	}
	for id := range byRule {
		if !fixtureRules[id] {
			t.Errorf("rule %q has no fixture pack, so nothing shows the backend refuses what it refuses", id)
		}
	}

	for _, testCase := range cases {
		name := testCase.Name
		if name == "" {
			name = testCase.RuleID
		}
		pack := buildFixturePack(t, base, testCase.Patches)
		body, err := json.Marshal(pack)
		if err != nil {
			t.Fatalf("fixture %q: encode pack: %v", name, err)
		}

		repo := NewQuestRepository()
		err = repo.LoadPack("parity", body)
		if testCase.Valid && err != nil {
			t.Errorf("fixture %q should load but the backend refused it: %v", name, err)
		}
		if !testCase.Valid && err == nil {
			t.Errorf("fixture %q should be refused but the backend accepted it; rule %s is not enforced",
				name, testCase.RuleID)
		}
	}
}
