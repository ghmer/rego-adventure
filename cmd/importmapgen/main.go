// Package main generates import maps for frontend dependencies.
//
// It has two modes.
//
// Default mode rewrites the <script type="importmap"> block from the
// package.json dependencies (esm.sh URLs) and keeps cdnjs stylesheet
// links in sync: for every dependency whose name matches the cdnjs
// library slug of a <link> in the document (e.g. "driver.js"), the
// link's version segment is rewritten to the package.json version.
//
// Manifest mode (the -manifest flag) points the same module names at the
// files cmd/vendorgen wrote under frontend/adventure/vendor, and
// redirects the cdnjs links of every library the manifest aliased to its
// vendored stylesheet, so the browser loads no script or stylesheet from
// a CDN. Versions never appear in the interpolation path in this mode:
// they come from the vendored directory names the manifest records.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"maps"
	"os"
	"regexp"
	"strings"
)

type PackageJSON struct {
	Dependencies map[string]string `json:"dependencies"`
	Importmap    ImportmapConfig   `json:"importmap"`
}

// ImportmapConfig carries optional import-map hints that cannot be derived
// from the dependency list alone. Subpaths maps a dependency name to
// its package subpath modules (without the package name); each entry is
// emitted as an extra import-map key "<lib>/<subpath>" resolved to
// "https://esm.sh/<lib>@<version>/<subpath>".
type ImportmapConfig struct {
	Subpaths map[string][]string `json:"subpaths"`
}

type ImportMap struct {
	Imports map[string]string `json:"imports"`
}

// cdnjsLinkRe matches the origin part of a cdnjs stylesheet/script URL:
// https://cdnjs.cloudflare.com/ajax/libs/<lib>/<version>/
var cdnjsLinkRe = regexp.MustCompile(`https://cdnjs\.cloudflare\.com/ajax/libs/(?P<lib>[^/"']+)/?(?P<version>[^/"']*)/`)

// cdnjsHrefRe matches a complete cdnjs URL, including its path and file:
// manifest mode replaces the whole URL with the vendored file.
var cdnjsHrefRe = regexp.MustCompile(`https://cdnjs\.cloudflare\.com/ajax/libs/([^/"'\s]+)/[^"'\s]*`)

var importMapRe = regexp.MustCompile(`(?s)<script type="importmap">.*?</script>`)

// versionRe matches a strict semver version: two or three numeric
// components, an optional prerelease suffix, and optional build metadata.
// Range notation (>=1.2, 1.x, *), dist-tags, and anything carrying URL or
// HTML metacharacters must fail here, because versions are interpolated
// verbatim into esm.sh URLs and rewritten cdnjs links in index.html.
var versionRe = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)(\.(0|[1-9]\d*))?(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$`)

// Manifest mirrors the vendorgen manifest (see cmd/vendorgen): the
// import-map entries and the redirected stylesheets manifest mode emits.
type Manifest struct {
	Packages map[string]pkgManifest `json:"packages"`
	CSS      map[string]cssManifest `json:"css"`
}

// pkgManifest is one vendored package: the directory it unpacked into,
// the file its bare name resolves to, the files of its declared subpath
// modules, and one stylesheet the document links to through the package
// (a CSS contribution without an entry makes the package CSS-only).
type pkgManifest struct {
	Dir          string            `json:"dir"`
	Entry        string            `json:"entry"`
	SubpathFiles map[string]string `json:"subpathFiles"`
	CSS          string            `json:"css"`
}

// cssManifest is a stylesheet the document links to directly, keyed by
// its cdnjs library slug.
type cssManifest struct {
	Dir  string `json:"dir"`
	File string `json:"file"`
}

// cleanVersion strips the common npm range prefixes (~, ^) and validates
// the remainder as a strict semver version.
func cleanVersion(ver string) (string, error) {
	version := strings.TrimLeft(ver, "~^")
	if !versionRe.MatchString(version) {
		return "", fmt.Errorf("version %q is not a strict semver version (expected x.y[.z], optionally with -prerelease)", ver)
	}
	return version, nil
}

var pkgPath string
var indexPath string

// buildImportMap renders the import map JSON block from the dependencies
// and the optional subpath manifest.
func buildImportMap(deps map[string]string, subpaths map[string][]string) ([]byte, error) {
	imports := make(map[string]string)

	for lib, ver := range deps {
		// Strip common version prefixes like ~ and ^
		version, err := cleanVersion(ver)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", lib, err)
		}
		imports[lib] = fmt.Sprintf("https://esm.sh/%s@%s", lib, version)

		for _, sub := range subpaths[lib] {
			// A leading or trailing slash in the manifest would produce
			// malformed keys and URLs; fail instead of emitting them
			sub = strings.Trim(sub, "/")
			if sub == "" {
				return nil, fmt.Errorf("empty subpath declared for %q", lib)
			}
			imports[lib+"/"+sub] = fmt.Sprintf("https://esm.sh/%s@%s/%s", lib, version, sub)
		}
	}

	// A subpath may only be declared for a declared dependency; otherwise
	// the generated key would resolve to a dependency nobody audits
	for lib := range subpaths {
		if _, ok := deps[lib]; !ok {
			return nil, fmt.Errorf("subpaths declared for %q, which is not a dependency", lib)
		}
	}

	return json.MarshalIndent(ImportMap{Imports: imports}, "        ", "    ")
}

// buildVendoredImportMap renders the import map JSON block from the
// vendorgen manifest: every module-bearing package contributes its bare
// name and its declared subpath keys, all resolved to same-origin vendor
// URLs. CSS-only packages contribute nothing.
func buildVendoredImportMap(manifest *Manifest) ([]byte, error) {
	imports := make(map[string]string)
	for pkg, entry := range manifest.Packages {
		if entry.Entry == "" {
			continue
		}
		imports[pkg] = vendorURL(entry.Dir, entry.Entry)
		for key, file := range entry.SubpathFiles {
			imports[key] = vendorURL(entry.Dir, file)
		}
	}
	if len(imports) == 0 {
		return nil, fmt.Errorf("manifest records no module packages")
	}
	return json.MarshalIndent(ImportMap{Imports: imports}, "        ", "    ")
}

// vendorURL is the same-origin URL one vendored file loads from.
func vendorURL(dir, file string) string {
	return "/vendor/" + dir + "/" + file
}

// buildCSSAliases merges the stylesheets manifest mode redirects: the
// explicit cdnjs aliases (font-awesome) plus every package's own css
// contribution (driver.js), the package name being its cdnjs slug.
func buildCSSAliases(manifest *Manifest) map[string]cssManifest {
	out := make(map[string]cssManifest, len(manifest.CSS))
	maps.Copy(out, manifest.CSS)
	for pkg, entry := range manifest.Packages {
		if _, aliased := out[pkg]; entry.CSS != "" && entry.Dir != "" && !aliased {
			out[pkg] = cssManifest{Dir: entry.Dir, File: entry.CSS}
		}
	}
	return out
}

// redirectCdnJsLinks rewrites every cdnjs URL whose library slug the
// manifest aliased to the vendored stylesheet, replacing the whole URL:
// the cdnjs file name (driver.min.css) and the vendored file name
// (driver.css) need no longer agree.
func redirectCdnJsLinks(indexContent []byte, css map[string]cssManifest) []byte {
	return cdnjsHrefRe.ReplaceAllFunc(indexContent, func(match []byte) []byte {
		loc := cdnjsHrefRe.FindSubmatchIndex(match)
		if loc == nil || loc[2] == loc[3] {
			return match
		}
		aliased, ok := css[string(match[loc[2]:loc[3]])]
		if !ok {
			return match
		}
		return []byte(vendorURL(aliased.Dir, aliased.File))
	})
}

// syncCdnJsVersions rewrites the version segment of cdnjs URLs whose
// library slug matches a dependency, so stylesheet links track the
// versions imported through the import map.
func syncCdnJsVersions(indexContent []byte, deps map[string]string) []byte {
	return cdnjsLinkRe.ReplaceAllFunc(indexContent, func(match []byte) []byte {
		loc := cdnjsLinkRe.FindSubmatchIndex(match)
		if loc == nil {
			return match
		}

		// Group 2 spans the version segment.
		versionStart, versionEnd := loc[4], loc[5]

		// The version group can match empty (URL without a version
		// segment); splicing at an empty range would insert the new
		// version at the start of the URL and corrupt it
		if versionStart == versionEnd {
			return match
		}

		newVersion, ok := deps[string(match[loc[2]:loc[3]])]
		if !ok {
			return match
		}

		cleaned, err := cleanVersion(newVersion)
		if err != nil {
			// buildImportMap rejects invalid versions before this runs;
			// be defensive and leave the link untouched rather than
			// interpolating an unvalidated string into the URL.
			return match
		}

		// Splice by index instead of a substring replace, so a version
		// that also appears in the library slug or path is not mismatched.
		if string(match[versionStart:versionEnd]) == cleaned {
			return match
		}
		out := make([]byte, 0, len(match)-(versionEnd-versionStart)+len(cleaned))
		out = append(out, match[:versionStart]...)
		out = append(out, cleaned...)
		out = append(out, match[versionEnd:]...)
		return out
	})
}

// updateIndexHTML applies the import map and cdnjs handling to the
// document. It fails when no import map block is present. With a vendored
// manifest, the map resolves the module names to same-origin vendor URLs
// and the cdnjs links of aliased libraries are redirected to the vendored
// stylesheets; without one, the map uses esm.sh URLs and the cdnjs links
// keep tracking the package.json versions.
func updateIndexHTML(indexContent []byte, pkg PackageJSON, vendored ...*Manifest) ([]byte, error) {
	var mapContent []byte
	if len(vendored) > 0 && vendored[0] != nil {
		block, err := buildVendoredImportMap(vendored[0])
		if err != nil {
			return nil, fmt.Errorf("marshaling vendored import map: %w", err)
		}
		mapContent = block
	} else {
		block, err := buildImportMap(pkg.Dependencies, pkg.Importmap.Subpaths)
		if err != nil {
			return nil, fmt.Errorf("marshaling import map: %w", err)
		}
		mapContent = block
	}

	newScriptTag := fmt.Sprintf(`<script type="importmap">
        %s
    </script>`, string(mapContent))

	if !importMapRe.Match(indexContent) {
		return nil, fmt.Errorf("could not find <script type=\"importmap\"> in document")
	}

	newIndexContent := importMapRe.ReplaceAll(indexContent, []byte(newScriptTag))
	if len(vendored) > 0 && vendored[0] != nil {
		return redirectCdnJsLinks(newIndexContent, buildCSSAliases(vendored[0])), nil
	}
	return syncCdnJsVersions(newIndexContent, pkg.Dependencies), nil
}

func main() {
	flag.StringVar(&pkgPath, "pkgPath", "frontend/adventure/package.json", "full path to package.json")
	flag.StringVar(&indexPath, "indexPath", "frontend/adventure/index.html", "full path to index.html")
	manifest := flag.String("manifest", "",
		"path to the vendorgen manifest; enables vendored mode (local URLs instead of esm.sh)")
	flag.Parse()

	// 1. Read package.json
	pkgContent, err := os.ReadFile(pkgPath) // #nosec G304
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading %s: %v\n", pkgPath, err)
		os.Exit(1)
	}

	var pkg PackageJSON
	if err := json.Unmarshal(pkgContent, &pkg); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing %s: %v\n", pkgPath, err)
		os.Exit(1)
	}

	// Fail fast on an empty shipped surface: zero dependencies would
	// silently emit an empty import map and strip every synced cdnjs
	// version from index.html instead of surfacing the broken manifest.
	if len(pkg.Dependencies) == 0 {
		fmt.Fprintf(os.Stderr, "%s has no \"dependencies\": cannot generate the import map\n", pkgPath)
		os.Exit(1)
	}

	// 2. Read index.html
	indexContent, err := os.ReadFile(indexPath) // #nosec G304
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading %s: %v\n", indexPath, err)
		os.Exit(1)
	}

	// 3. Load the vendoring manifest, when vendored mode is requested
	var vendored *Manifest
	if *manifest != "" {
		content, err := os.ReadFile(*manifest) // #nosec G304 -- flag path
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading manifest %s: %v\n", *manifest, err)
			os.Exit(1)
		}
		vendored = &Manifest{}
		if err := json.Unmarshal(content, vendored); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing manifest %s: %v\n", *manifest, err)
			os.Exit(1)
		}
	}

	// 4. Rewrite import map and cdnjs links
	newIndexContent, err := updateIndexHTML(indexContent, pkg, vendored)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// 5. Write index.html, preserving the original file mode so running
	// the generator locally does not silently change permissions.
	mode := os.FileMode(0644)
	if fi, err := os.Stat(indexPath); err == nil {
		mode = fi.Mode().Perm()
	}
	if err := os.WriteFile(indexPath, newIndexContent, mode); err != nil { // #nosec G703 -- writes user-provided path
		fmt.Fprintf(os.Stderr, "Error writing %s: %v\n", indexPath, err)
		os.Exit(1)
	}
	fmt.Printf("Updated import map in %s\n", indexPath)
}
