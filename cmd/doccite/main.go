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
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
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
	NumFrom int    // offset of the line number inside DocLine's text
	NumTo   int    // offset just past the line number, range end included
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
				NumFrom: match[4],
				NumTo:   match[5],
			})
			if match[6] >= 0 {
				citations[len(citations)-1].NumTo = match[7]
			}
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

// anchorMissing names the one failure Repairs can act on: the cited line does
// not carry the identifier the document claims sits there. Naming it keeps the
// checker's message and the repair's trigger from drifting apart.
const anchorMissing = "does not mention"

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
				fmt.Sprintf("line %d of %s %s %q: %q",
					citation.Line, citation.Path, anchorMissing, citation.Anchor, firstNonEmpty(block))})
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

// updateWindow is how far from a cited line doccite -update may look for the
// anchor's new home. Drift in practice is a comment line or two; a candidate
// further away is a move a person should confirm, so it stays a failure.
const updateWindow = 12

// Repair is one failing citation together with where its anchor sits now.
// Line is 0 when the new home could not be decided: that case is reported
// rather than written, with the candidates that were seen.
type Repair struct {
	Citation   Citation
	Line       int   // the anchor's line the citation should carry (0: undecided)
	End        int   // range end to write; equals Line for a single-line citation
	Candidates []int // every line that declares the anchor, in file order
}

// Repairs decides, for each failing anchored citation, the line its anchor
// can be re-anchored to. Only an anchor failure can be repaired this way: a
// citation into a missing or ambiguous file has nothing to search.
//
// The candidate set is deliberately narrow. A line counts when it *declares*
// the anchor (see declares) and lies within the window of the cited range, and
// the citation is rewritten only when that set holds exactly one line. Two
// candidates is a decision about which occurrence the document means, and no
// candidate at all usually means the identifier was renamed or removed: both
// are left for a person.
func Repairs(citations []Citation, failures []Failure, resolver Resolver, window int) []Repair {
	if window < 1 {
		window = updateWindow
	}
	wanted := map[Citation]bool{}
	for _, failure := range failures {
		if failure.Citation.Anchor != "" && strings.Contains(failure.Reason, anchorMissing) {
			wanted[failure.Citation] = true
		}
	}

	var repairs []Repair
	cache := map[string][]string{}
	for _, citation := range citations {
		if !wanted[citation] {
			continue
		}
		lines, ok := cache[citation.Path]
		if !ok {
			resolved, err := resolver.Lines(citation.Path)
			if err != nil {
				continue
			}
			lines = resolved
			cache[citation.Path] = lines
		}
		declared := declaredLines(lines, citation.Anchor)
		repair := Repair{
			Citation:   citation,
			Line:       pickAnchorLine(declared, citation, window),
			Candidates: declared,
		}
		if repair.Line > 0 && citation.End > citation.Line {
			// A cited range keeps its extent: it moves so that its nearest
			// edge lands where the anchor moved to.
			shift := repair.Line - nearestEdge(citation, repair.Line)
			repair.Line, repair.End = citation.Line+shift, citation.End+shift
		}
		repairs = append(repairs, repair)
	}
	return repairs
}

// pickAnchorLine returns the sole declared anchor line within the window of
// the cited range, or 0 when there is none or more than one.
func pickAnchorLine(declared []int, citation Citation, window int) int {
	var within []int
	for _, line := range declared {
		if distance := line - nearestEdge(citation, line); distance >= -window && distance <= window {
			within = append(within, line)
		}
	}
	if len(within) != 1 {
		return 0
	}
	return within[0]
}

// nearestEdge is the cited line the anchor line moved away from: the closer
// end of the cited range.
func nearestEdge(citation Citation, anchorLine int) int {
	if anchorLine < citation.Line {
		return citation.Line
	}
	return citation.End
}

// declaredLines lists the lines that declare the anchor, in order.
func declaredLines(lines []string, anchor string) []int {
	var found []int
	for index, line := range lines {
		if declares(line, anchor) {
			found = append(found, index+1)
		}
	}
	return found
}

// declarationKeywords introduce a name on the same line: the words that may
// sit directly in front of a declaration's identifier.
var declarationKeywords = map[string]bool{
	"let": true, "const": true, "var": true, "function": true, "async": true,
	"class": true, "static": true, "get": true, "set": true, "export": true,
	"default": true, "func": true, "type": true, "interface": true, "enum": true,
}

// commentPrefixes mark a line as prose, which never declares anything; the
// comment markers also cover the JSDoc continuation lines a citation often
// lands on after drift.
var commentPrefixes = []string{"//", "/*", "*", "#"}

// declares reports whether a source line introduces the name rather than
// merely mentioning it: the name appears as a whole word, not after a dot, at
// the head of the line or behind a declaration keyword. The rule is
// intentionally simple; it only ever narrows the candidate set, so a line it
// misreads leaves the citation unrewritten rather than moving it wrongly.
func declares(line, name string) bool {
	trimmed := strings.TrimSpace(line)
	for _, prefix := range commentPrefixes {
		if strings.HasPrefix(trimmed, prefix) {
			return false
		}
	}
	lower, needle := strings.ToLower(line), strings.ToLower(name)
	for _, at := range wordHits(lower, needle) {
		before := strings.TrimSpace(lower[:at])
		if before == "" {
			return true // a method, a property, a struct field
		}
		fields := strings.Fields(before)
		if declarationKeywords[fields[len(fields)-1]] {
			return true
		}
		// A trailing = or : belongs to a form like `name = (` written across
		// lines, where the introducer sits on the previous line.
		if strings.HasSuffix(before, "=") || strings.HasSuffix(before, ":") {
			return true
		}
	}
	return false
}

// wordHits lists the offsets at which needle appears in lower as a whole word
// that is not a member access.
func wordHits(lower, needle string) []int {
	if needle == "" {
		return nil
	}
	var hits []int
	for from := 0; from+len(needle) <= len(lower); {
		at := strings.Index(lower[from:], needle)
		if at < 0 {
			break
		}
		at += from
		if !isWordByte(byteAt(lower, at-1)) && !isWordByte(byteAt(lower, at+len(needle))) &&
			byteAt(lower, at-1) != '.' {
			hits = append(hits, at)
		}
		from = at + 1
	}
	return hits
}

func byteAt(s string, index int) byte {
	if index < 0 || index >= len(s) {
		return 0
	}
	return s[index]
}

func isWordByte(c byte) bool {
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
}

// ApplyUpdates rewrites the document with the decided repairs, splicing each
// citation's number span from the last one backwards so the offsets of the
// citations before it stay valid.
func ApplyUpdates(content string, repairs []Repair) string {
	var writes []Repair
	for _, repair := range repairs {
		if repair.Line > 0 && repair.Line != repair.Citation.Line {
			writes = append(writes, repair)
		}
	}
	sort.Slice(writes, func(a, b int) bool {
		if writes[a].Citation.DocLine != writes[b].Citation.DocLine {
			return writes[a].Citation.DocLine > writes[b].Citation.DocLine
		}
		return writes[a].Citation.NumFrom > writes[b].Citation.NumFrom
	})

	lines := strings.Split(content, "\n")
	for _, repair := range writes {
		citation := repair.Citation
		text := lines[citation.DocLine-1]
		span := fmt.Sprintf("%d", repair.Line)
		if repair.End > repair.Line {
			span = fmt.Sprintf("%d-%d", repair.Line, repair.End)
		}
		lines[citation.DocLine-1] = text[:citation.NumFrom] + span + text[citation.NumTo:]
	}
	return strings.Join(lines, "\n")
}

func main() {
	update := flag.Bool("update", false,
		"rewrite the line number of a citation whose anchor has exactly one declaration within the window")
	window := flag.Int("window", updateWindow, "how far from the cited line -update may search for the anchor")
	flag.Parse()

	root := "."
	doc := filepath.Join(root, "docu", "state-machines.md")
	switch args := flag.Args(); len(args) {
	case 0:
	case 2:
		root = args[0]
		doc = args[1]
	default:
		fmt.Fprintln(os.Stderr, "usage: doccite [-update] [-window n] [repository-root document]")
		os.Exit(2)
	}
	if err := run(root, doc, *update, *window); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root, doc string, update bool, window int) error {
	content, err := os.ReadFile(filepath.Join(root, doc)) // #nosec G304,G703 -- paths come from the caller
	if err != nil {
		return fmt.Errorf("reading document: %w", err)
	}

	rewritten, leftover, err := updateDocument(root, doc, string(content), update, window)
	if err != nil {
		return err
	}
	if rewritten != string(content) {
		info, statErr := os.Stat(filepath.Join(root, doc)) // #nosec G304 -- the document the caller named
		if statErr != nil {
			return fmt.Errorf("stat %s: %w", doc, statErr)
		}
		// #nosec G304,G703 -- the document the caller named, rewritten in place
		if writeErr := os.WriteFile(filepath.Join(root, doc), []byte(rewritten), info.Mode()); writeErr != nil {
			return fmt.Errorf("writing %s: %w", doc, writeErr)
		}
	}

	failures := leftover
	if len(failures) > 0 {
		for _, failure := range failures {
			fmt.Printf("%s:%d: %s (%s)\n", doc, failure.Citation.DocLine,
				failure.Reason, failure.Citation.Ref)
		}
		return fmt.Errorf("%d citations failed", len(failures))
	}

	fmt.Printf("%d citations checked, all resolve\n", len(ExtractCitations(rewritten)))
	return nil
}

// updateDocument checks the document and, with -update, rewrites the citations
// whose anchor has one unambiguous new home. It returns the document text and
// the failures that remain afterwards, so a run reports what it fixed and what
// it refused to guess at.
func updateDocument(root, doc, content string, update bool, window int) (string, []Failure, error) {
	resolver, err := NewRepoResolver(root)
	if err != nil {
		return content, nil, err
	}
	citations := ExtractCitations(content)
	failures := Check(citations, resolver)
	if len(failures) == 0 || !update {
		return content, failures, nil
	}

	repairs := Repairs(citations, failures, resolver, window)
	for _, repair := range repairs {
		if repair.Line > 0 {
			fmt.Printf("%s:%d: re-anchored %s to line %d\n", doc, repair.Citation.DocLine,
				repair.Citation.Ref, repair.Line)
			continue
		}
		fmt.Printf("%s:%d: %s: %q is declared at %s, more than one candidate or none within %d lines"+
			" - left for a person\n", doc, repair.Citation.DocLine, repair.Citation.Ref,
			repair.Citation.Anchor, listLines(repair.Candidates), window)
	}

	rewritten := ApplyUpdates(content, repairs)
	rechecked := Check(ExtractCitations(rewritten), resolver)
	return rewritten, rechecked, nil
}

// listLines renders candidate line numbers compactly for the report.
func listLines(lines []int) string {
	if len(lines) == 0 {
		return "nowhere"
	}
	rendered := make([]string, len(lines))
	for index, line := range lines {
		rendered[index] = strconv.Itoa(line)
	}
	return strings.Join(rendered, ", ")
}
