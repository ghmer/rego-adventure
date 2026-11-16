package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// licensePatterns are the root license and attribution files copied with
// every vendored package: distributing the code means distributing its
// license.
var licensePatterns = regexp.MustCompile(`^(?:LICEN[SC]E|NOTICE|AUTHORS|COPYING)[^/]*$`)

// collectFiles computes the member set a package extracts: the entry the
// bare name resolves to, the configured subpath and CSS files, the
// relative-import and CSS url() closures of all of them, and the package's
// license and package.json. Unknown relative references fail loudly
// instead of shipping an import the browser cannot resolve.
func collectFiles(pkg packageJSON, name string, ball *tarball) (map[string]bool, error) {
	configured := pkg.Vendoring.Dependencies[name]

	files := map[string]bool{"package.json": true}
	if configured.Entry != "" || configured.CSS == "" {
		entry, err := moduleEntry(pkg, name, configured, ball)
		if err != nil {
			return nil, err
		}
		files[entry] = true
	}
	if err := addConfiguredFiles(pkg, name, configured, ball, files); err != nil {
		return nil, err
	}
	if err := closeReferences(ball, files); err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	addLicenses(ball, files)
	return files, nil
}

// moduleEntry picks the entry file of a module package: an explicit
// override from the vendoring config wins, otherwise the package's own
// module metadata decides (exports import/default, then module).
func moduleEntry(_ packageJSON, name string, configured packageFiles, ball *tarball) (string, error) {
	var entry string
	if configured.Entry != "" {
		entry = configured.Entry
	} else {
		resolved, err := resolveEntry(ball.manifest)
		if err != nil {
			return "", fmt.Errorf("%s: %w", name, err)
		}
		entry = resolved
	}
	if _, ok := ball.files[entry]; !ok {
		return "", fmt.Errorf("%s: entry %s is not in the tarball", name, entry)
	}
	ball.entry = entry
	return entry, nil
}

// closeReferences walks the references of every copied file and adds
// referenced files from the tarball: modules close their relative ESM
// imports, stylesheets close their relative url() targets (the font
// files behind a font-face declaration, for example). Only the file
// layout inside the package is relevant: the vendor directory preserves
// it, so relative specifiers keep resolving the same way they do inside
// node_modules.
func closeReferences(ball *tarball, files map[string]bool) error {
	for {
		added := false
		for _, file := range mapKeyList(files) {
			specs := referencedSpecifiers(ball, file)
			for _, spec := range specs {
				target, ok := resolveRelative(ball.files, file, spec)
				if !ok {
					return fmt.Errorf("relative reference %q in %s is not in the tarball", spec, file)
				}
				if !files[target] {
					files[target] = true
					added = true
				}
			}
		}
		if !added {
			break
		}
	}
	return nil
}

// mapKeyList returns the keys of a set, in map order; callers only need
// coverage, not order.
func mapKeyList(files map[string]bool) []string {
	out := make([]string, 0, len(files))
	for file := range files {
		out = append(out, file)
	}
	return out
}

// relativeSpecifiers extracts the relative module specifiers one file
// imports.
func relativeSpecifiers(content []byte) []string {
	var specs []string
	for _, match := range relativeImportRe.FindAllSubmatch(content, -1) {
		specs = append(specs, string(match[1]))
	}
	return specs
}

// cssURLRe matches the relative url() targets a stylesheet can reference
// (font files, images); data: URLs are not file references.
var cssURLRe = regexp.MustCompile(`url\(\s*['"]?(\.{1,2}/[^'")\s]+)['"]?\s*\)`)

// referencedSpecifiers extracts the relative references of one copied
// file: ESM imports for modules, url() targets for stylesheets.
func referencedSpecifiers(ball *tarball, file string) []string {
	switch path.Ext(file) {
	case ".js", ".mjs":
		return relativeSpecifiers(ball.files[file])
	case ".css":
		var specs []string
		for _, match := range cssURLRe.FindAllSubmatch(ball.files[file], -1) {
			specs = append(specs, string(match[1]))
		}
		return specs
	default:
		return nil
	}
}

// addConfiguredFiles copies the files the vendoring config names for a
// package: each becomes a vendor file that must exist in the tarball.
func addConfiguredFiles(_ packageJSON, name string, configured packageFiles, ball *tarball, files map[string]bool) error {
	for _, file := range configured.Files {
		if _, ok := ball.files[file]; !ok {
			return fmt.Errorf("%s: configured file %s is not in the tarball", name, file)
		}
		files[file] = true
	}
	if configured.CSS != "" {
		if _, ok := ball.files[configured.CSS]; !ok {
			return fmt.Errorf("%s: configured css %s is not in the tarball", name, configured.CSS)
		}
		files[configured.CSS] = true
	}
	return nil
}

// resolveRelative maps one relative specifier from the importing file to
// a tarball member, trying the extensionless forms the npm ESM layout
// uses (explicit extension, then .js, then .mjs, then an index file).
func resolveRelative(members map[string][]byte, from string, spec string) (string, bool) {
	base := path.Join(path.Dir(from), spec)
	candidates := []string{base, base + ".js", base + ".mjs", path.Join(base, "index.js"), path.Join(base, "index.mjs")}
	for _, candidate := range candidates {
		if _, ok := members[candidate]; ok {
			return candidate, true
		}
	}
	return "", false
}

// addLicenses copies the package's license and attribution files; only
// root-level files match, because deeper paths like a README subfolder
// are none of the browser's business.
func addLicenses(ball *tarball, files map[string]bool) {
	for member := range ball.files {
		if strings.Contains(member, "/") {
			continue
		}
		if licensePatterns.MatchString(strings.ToUpper(member)) {
			files[member] = true
		}
	}
}

// mapSubpaths links the importmap.subpaths specifiers of one package to
// the dist file the package's exports map resolves the specifier to.
// A subpath that resolves to nothing (or to a file outside the copied
// set) is a broken vendoring contract: fail loudly.
func mapSubpaths(pkg packageJSON, name string, ball *tarball, files map[string]bool) (map[string]string, error) {
	declarations := pkg.Importmap.Subpaths[name]
	if len(declarations) == 0 {
		return nil, nil
	}
	out := map[string]string{}
	for _, spec := range declarations {
		file, err := resolveSubpath(ball.manifest, spec)
		if err != nil {
			return nil, fmt.Errorf("%s/%s: %w", name, spec, err)
		}
		if !files[file] {
			return nil, fmt.Errorf("%s/%s resolves to %s, which is not a copied file; list it in vendoring.packages.%s.files",
				name, spec, file, name)
		}
		out[name+"/"+spec] = file
	}
	return out, nil
}

// configuredCSS returns the stylesheet path a package contributes, if the
// vendoring config names one.
func configuredCSS(pkg packageJSON, name string) string {
	return pkg.Vendoring.Dependencies[name].CSS
}

// writeToDir writes the selected members under outDir/<dirName>,
// preserving the package's internal layout. The directory is created
// fresh, so a rerun cannot mix old and extracted files.
func (t tarball) write(outDir string, dirName string, files map[string]bool) error {
	target := filepath.Join(outDir, dirName)
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("clearing %s: %w", target, err)
	}
	for file, ok := range files {
		if !ok {
			continue
		}
		full := filepath.Join(target, filepath.FromSlash(file))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil { // #nosec G301 -- vendor files must stay servable
			return fmt.Errorf("creating %s: %w", filepath.Dir(full), err)
		}
		if err := os.WriteFile(full, t.files[file], 0644); err != nil { // #nosec G306 -- static assets are world-readable
			return fmt.Errorf("writing %s: %w", full, err)
		}
	}
	return nil
}

// pruneVendorDir removes every top-level entry of outDir that the current
// manifest does not own, so a dependency removal or rename leaves no
// stale files to serve.
func pruneVendorDir(outDir string, manifest Manifest) error {
	keep := map[string]bool{"manifest.json": true}
	for _, entry := range manifest.Packages {
		keep[entry.Dir] = true
	}
	for _, entry := range manifest.CSS {
		keep[entry.Dir] = true
	}
	entries, err := os.ReadDir(outDir)
	if err != nil {
		return fmt.Errorf("listing %s: %w", outDir, err)
	}
	for _, found := range entries {
		if keep[found.Name()] {
			continue
		}
		if err := os.RemoveAll(filepath.Join(outDir, found.Name())); err != nil {
			return fmt.Errorf("removing stale %s: %w", found.Name(), err)
		}
	}
	return nil
}

// writeManifest stores the manifest importmapgen's manifest mode reads,
// with sorted key output so reruns are byte-stable.
func writeManifest(path string, manifest Manifest) error {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(manifest); err != nil {
		return fmt.Errorf("encoding manifest: %w", err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0644); err != nil { // #nosec G306 -- static assets are world-readable
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}
