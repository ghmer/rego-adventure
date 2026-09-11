// Package main generates import maps for frontend dependencies.
//
// In addition to rewriting the <script type="importmap"> block from the
// package.json devDependencies, it keeps cdnjs stylesheet links in sync:
// for every devDependency whose name matches the cdnjs library slug of a
// <link> in the document (e.g. "driver.js"), the link's version segment
// is rewritten to the package.json version. This keeps the imported ES
// module and its stylesheet aligned without manual edits.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
)

type PackageJSON struct {
	DevDependencies map[string]string `json:"devDependencies"`
	Importmap       ImportmapConfig   `json:"importmap"`
}

// ImportmapConfig carries optional import-map hints that cannot be derived
// from the devDependency list alone. Subpaths maps a devDependency name to
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

var importMapRe = regexp.MustCompile(`(?s)<script type="importmap">.*?</script>`)

var pkgPath string
var indexPath string

// buildImportMap renders the import map JSON block from the devDependencies
// and the optional subpath manifest.
func buildImportMap(deps map[string]string, subpaths map[string][]string) ([]byte, error) {
	imports := make(map[string]string)

	for lib, ver := range deps {
		// Strip common version prefixes like ~ and ^
		version := strings.TrimLeft(ver, "~^")
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
			return nil, fmt.Errorf("subpaths declared for %q, which is not a devDependency", lib)
		}
	}

	return json.MarshalIndent(ImportMap{Imports: imports}, "        ", "    ")
}

// syncCdnJsVersions rewrites the version segment of cdnjs URLs whose
// library slug matches a devDependency, so stylesheet links track the
// versions imported through the import map.
func syncCdnJsVersions(indexContent []byte, deps map[string]string) []byte {
	return cdnjsLinkRe.ReplaceAllFunc(indexContent, func(match []byte) []byte {
		sub := cdnjsLinkRe.FindSubmatch(match)
		currentVersion := string(sub[2])

		// The version group can match empty (URL without a version
		// segment); bytes.Replace with an empty old would insert the new
		// version at offset 0 and corrupt the URL
		if currentVersion == "" {
			return match
		}

		newVersion, ok := deps[string(sub[1])]
		if !ok {
			return match
		}

		newVersion = strings.TrimLeft(newVersion, "~^")
		if newVersion == currentVersion {
			return match
		}

		return bytes.Replace(match, sub[2], []byte(newVersion), 1)
	})
}

// updateIndexHTML applies the import map and cdnjs version sync to the
// document. It fails when no import map block is present.
func updateIndexHTML(indexContent []byte, pkg PackageJSON) ([]byte, error) {
	mapContent, err := buildImportMap(pkg.DevDependencies, pkg.Importmap.Subpaths)
	if err != nil {
		return nil, fmt.Errorf("marshaling import map: %w", err)
	}

	newScriptTag := fmt.Sprintf(`<script type="importmap">
        %s
    </script>`, string(mapContent))

	if !importMapRe.Match(indexContent) {
		return nil, fmt.Errorf("could not find <script type=\"importmap\"> in document")
	}

	newIndexContent := importMapRe.ReplaceAll(indexContent, []byte(newScriptTag))
	return syncCdnJsVersions(newIndexContent, pkg.DevDependencies), nil
}

func main() {
	flag.StringVar(&pkgPath, "pkgPath", "frontend/adventure/package.json", "full path to package.json")
	flag.StringVar(&indexPath, "indexPath", "frontend/adventure/index.html", "full path to index.html")
	flag.Parse()

	// 1. Read package.json
	pkgContent, err := os.ReadFile(pkgPath) // #nosec G304
	if err != nil {
		fmt.Printf("Error reading %s: %v\n", pkgPath, err)
		os.Exit(1)
	}

	var pkg PackageJSON
	if err := json.Unmarshal(pkgContent, &pkg); err != nil {
		fmt.Printf("Error parsing %s: %v\n", pkgPath, err)
		os.Exit(1)
	}

	// 2. Read index.html
	indexContent, err := os.ReadFile(indexPath) // #nosec G304
	if err != nil {
		fmt.Printf("Error reading %s: %v\n", indexPath, err)
		os.Exit(1)
	}

	// 3. Rewrite import map and synced cdnjs links
	newIndexContent, err := updateIndexHTML(indexContent, pkg)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	// 4. Write index.html
	if err := os.WriteFile(indexPath, newIndexContent, 0600); err != nil { // #nosec G703 -- writes user-provided path
		fmt.Printf("Error writing %s: %v\n", indexPath, err)
		os.Exit(1)
	}
	fmt.Printf("Updated import map in %s\n", indexPath)
}
