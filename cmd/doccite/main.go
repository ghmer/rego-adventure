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

// Command doccite checks that the file:line citations in a Markdown
// document still describe the code they point at. Each citation must
// resolve to an existing line; a citation anchored to an identifier must
// land on a line containing it. Run against docu/state-machines.md in the
// Go CI, so edits to the code or to the document fail loudly instead of
// letting the central reference document rot.
package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// citationPattern matches repo-relative citations. An optional range end
// (:15-22) is part of the citation: every line of the range is checked.
var citationPattern = regexp.MustCompile(
	`([A-Za-z0-9_./-]+\.(?:js|go|html|py|json|css|cjs)):(\d+)(?:-(\d+))?`)

// identifierPattern accepts plain and dotted names, optionally followed by
// an empty argument list (as in `fetchPacks()`).
var identifierPattern = regexp.MustCompile(`^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*(?:\(\))?$`)

// skippedDirectories are never considered when resolving bare file names.
var skippedDirectories = map[string]bool{
	".git": true, "bin": true, "node_modules": true, "__pycache__": true,
}

// Citation is one extracted reference from the document.
type Citation struct {
	Ref     string // as written, e.g. backend/http/routes.go:154
	Path    string // file part of Ref
	Line    int    // first cited line, 1-based
	End     int    // last cited line, 1-based; equals Line when no range
	DocLine int    // 1-based line in the document carrying the citation
	Anchor  string // identifier the citation claims to point at; may be empty
}

// Failure describes one citation that does not hold against the sources.
type Failure struct {
	Citation Citation
	Reason   string
}

// ExtractCitations parses the document into citations in document order.
func ExtractCitations(content string) []Citation {
	var citations []Citation
	for i, docLine := range strings.Split(content, "\n") {
		for _, match := range citationPattern.FindAllStringSubmatchIndex(docLine, -1) {
			path := docLine[match[2]:match[3]]
			line := atoi(docLine[match[4]:match[5]])
			end := line
			if match[6] >= 0 {
				end = atoi(docLine[match[6]:match[7]])
			}
			citations = append(citations, Citation{
				Ref:     fmt.Sprintf("%s:%d", path, line),
				Path:    path,
				Line:    line,
				End:     end,
				DocLine: i + 1,
				Anchor:  anchorFor(docLine, match[0], match[1]),
			})
		}
	}
	return citations
}

// anchorFor inspects the text directly in front of a citation. Both the
// citation and the identifier it claims to point at are wrapped in
// backticks (for example `createWidget` (`pkg/widget.go:2`)); whitespace
// and parentheses may sit between them, prose may not. A dotted span
// claims its member (UIManager.renderInteractionGate renders as
// renderInteractionGate); receivers and constant tables are not repeated
// on the cited line. Spans that are not identifiers carry no claim.
func anchorFor(docLine string, start, end int) string {
	if start < 1 || end >= len(docLine) || docLine[end] != '`' || docLine[start-1] != '`' {
		return ""
	}
	pos := start - 2
	for pos >= 0 && isAnchorSeparator(docLine[pos]) {
		pos--
	}
	if pos < 1 || docLine[pos] != '`' {
		return ""
	}
	closeTick := pos
	openTick := strings.LastIndexByte(docLine[:closeTick], '`')
	if openTick < 0 {
		return ""
	}
	span := docLine[openTick+1 : closeTick]
	if !identifierPattern.MatchString(span) {
		return ""
	}
	anchor := strings.TrimSuffix(strings.TrimSuffix(span, "()"), ")")
	if dot := strings.LastIndexByte(anchor, '.'); dot >= 0 {
		anchor = anchor[dot+1:]
	}
	return anchor
}

func isAnchorSeparator(c byte) bool {
	return c == ' ' || c == '\t' || c == '(' || c == ')'
}

// Resolver maps a cited path to the lines of its source. It errors when a
// path stays ambiguous or does not exist.
type Resolver interface {
	Lines(path string) ([]string, error)
}

// NewRepoResolver builds a resolver over a repository root. A bare file
// name must be unique in the repository, unless the repository's own root
// file has that name, which then wins. A slash-carrying path is resolved
// from the root when it hits exactly, and otherwise by its unique location
// inside the repository, which covers the document's tree-relative
// citation style (managers/ui-manager.js is cited without frontend/
// adventure/src).
func NewRepoResolver(root string) (Resolver, error) {
	byName := map[string][]string{}
	var all []string
	// #nosec G703 -- root is the caller's repository root; nothing outside it is read
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if skippedDirectories[entry.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if sourceExtensions[filepath.Ext(entry.Name())] {
			rel, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return relErr
			}
			byName[entry.Name()] = append(byName[entry.Name()], rel)
			all = append(all, rel)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("scanning %s: %w", root, err)
	}
	return &repoResolver{root: root, byName: byName, all: all}, nil
}

var sourceExtensions = map[string]bool{
	".js": true, ".go": true, ".html": true, ".py": true,
	".json": true, ".css": true, ".cjs": true,
}

type repoResolver struct {
	root   string
	byName map[string][]string
	all    []string
}

// Lines resolves one cited path against the repository.
func (r *repoResolver) Lines(path string) ([]string, error) {
	rel, err := r.locate(path)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(r.root, rel)) // #nosec G304,G703 -- paths come from the resolved document citations
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	return strings.Split(string(data), "\n"), nil
}

// locate maps a citation to a repository-relative file. A slash-carrying
// path is resolved exactly from the root when possible, and otherwise by
// its unique repository location, because the document cites sources also
// relative to their own tree (managers/ui-manager.js inside
// frontend/adventure/src). A bare file name must name exactly one file,
// unless it names the unique root file, which then wins.
func (r *repoResolver) locate(path string) (string, error) {
	if strings.ContainsRune(path, '/') {
		if _, err := os.Stat(filepath.Join(r.root, path)); err == nil {
			return path, nil
		}
		var matches []string
		for _, rel := range r.all {
			if strings.HasSuffix(rel, "/"+path) {
				matches = append(matches, rel)
			}
		}
		switch len(matches) {
		case 1:
			return matches[0], nil
		case 0:
			return "", fmt.Errorf("cited file %s does not exist", path)
		default:
			return "", fmt.Errorf("ambiguous path %s: %s", path, strings.Join(matches, ", "))
		}
	}
	candidates := r.byName[path]
	switch {
	case len(candidates) == 1:
		return candidates[0], nil
	case len(candidates) == 0:
		return "", fmt.Errorf("no file named %s in the repository", path)
	default:
		var rootOnly []string
		for _, candidate := range candidates {
			if !strings.ContainsRune(candidate, '/') {
				rootOnly = append(rootOnly, candidate)
			}
		}
		if len(rootOnly) == 1 {
			return rootOnly[0], nil
		}
		return "", fmt.Errorf("ambiguous bare file name %s: %s",
			path, strings.Join(candidates, ", "))
	}
}

// Check verifies every extracted citation and returns its failures. The
// anchor match is case-insensitive: the document names machine states in
// prose spelling (critical) that the sources spell as constants
// (ErrorLevel.CRITICAL).
func Check(citations []Citation, resolver Resolver) []Failure {
	var failures []Failure
	for _, citation := range citations {
		lines, err := resolver.Lines(citation.Path)
		if err != nil {
			failures = append(failures, Failure{citation, err.Error()})
			continue
		}
		if citation.Line < 1 || citation.End < citation.Line || citation.End > len(lines) {
			failures = append(failures, Failure{citation,
				fmt.Sprintf("cited range %d-%d exceeds %s (%d lines)",
					citation.Line, citation.End, citation.Path, len(lines))})
			continue
		}
		var block []string
		for i := citation.Line - 1; i < citation.End; i++ {
			block = append(block, strings.TrimSpace(lines[i]))
		}
		quoted := strings.ToLower(strings.Join(block, "\n"))
		anchor := strings.ToLower(citation.Anchor)
		if citation.Anchor != "" && !strings.Contains(quoted, anchor) {
			failures = append(failures, Failure{citation,
				fmt.Sprintf("line %d of %s does not mention %q: %q",
					citation.Line, citation.Path, citation.Anchor, firstNonEmpty(block))})
			continue
		}
		if firstNonEmpty(block) == "" {
			failures = append(failures, Failure{citation,
				fmt.Sprintf("line %d of %s is empty", citation.Line, citation.Path)})
		}
	}
	return failures
}

func firstNonEmpty(lines []string) string {
	for _, line := range lines {
		if line != "" {
			return line
		}
	}
	return ""
}

func atoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

func main() {
	root := "."
	doc := filepath.Join(root, "docu", "state-machines.md")
	switch len(os.Args) {
	case 1:
	case 3:
		root = os.Args[1]
		doc = os.Args[2]
	default:
		fmt.Fprintln(os.Stderr, "usage: doccite [repository-root document]")
		os.Exit(2)
	}
	if err := run(root, doc); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root, doc string) error {
	resolver, err := NewRepoResolver(root)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(filepath.Join(root, doc)) // #nosec G304,G703 -- paths come from the caller
	if err != nil {
		return fmt.Errorf("reading document: %w", err)
	}
	citations := ExtractCitations(string(content))
	failures := Check(citations, resolver)
	for _, failure := range failures {
		fmt.Printf("%s:%d: %s (%s)\n", doc, failure.Citation.DocLine,
			failure.Reason, failure.Citation.Ref)
	}
	if len(failures) > 0 {
		return fmt.Errorf("%d of %d citations failed", len(failures), len(citations))
	}
	fmt.Printf("%d citations checked, all resolve\n", len(citations))
	return nil
}
