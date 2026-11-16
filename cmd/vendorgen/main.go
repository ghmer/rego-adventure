// Command vendorgen vendors the frontend's browser libraries into
// frontend/adventure/vendor, replacing CDN imports with same-origin files.
//
// Run go run ./cmd/vendorgen whenever package.json changes a dependency:
// it re-reads the lockfile, re-downloads (and integrity-checks) every
// changed version, refreshes vendor/, and rewrites manifest.json, which
// importmapgen's manifest mode turns into the local import map.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// main downloads, verifies and extracts the vendored files and writes
// vendor/manifest.json for importmapgen's manifest mode.
func main() {
	pkgPath := flag.String("pkg", "frontend/adventure/package.json", "path to the frontend package.json")
	flag.Parse()

	frontendDir := filepath.Dir(*pkgPath)
	outDir := filepath.Join(frontendDir, "vendor")

	pkg, err := readPackageJSON(*pkgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	manifest, err := vendorPackages(pkg, frontendDir, outDir, httpFetcher{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	fmt.Printf("vendored %d packages into %s\n", len(manifest.Packages), outDir)
}

// readPackageJSON loads the frontend package.json and validates the two
// surfaces vendorgen depends on: exact semver dependencies (the lockfile
// pins the resolution) and the vendoring file manifest.
func readPackageJSON(pkgPath string) (packageJSON, error) {
	var pkg packageJSON
	content, err := os.ReadFile(pkgPath) // #nosec G304 -- flag path
	if err != nil {
		return pkg, fmt.Errorf("reading %s: %w", pkgPath, err)
	}
	if err := json.Unmarshal(content, &pkg); err != nil {
		return pkg, fmt.Errorf("parsing %s: %w", pkgPath, err)
	}

	deps := pkg.Dependencies
	if len(deps) == 0 {
		return pkg, fmt.Errorf("%s has no \"dependencies\": nothing to vendor", pkgPath)
	}

	for name, version := range deps {
		if strings.HasPrefix(version, "^") || strings.HasPrefix(version, "~") {
			return pkg, fmt.Errorf("dependency %s: version %q is a range; vendoring pins exact versions", name, version)
		}
	}

	if len(pkg.Vendoring.Dependencies) == 0 {
		return pkg, fmt.Errorf("%s has no \"vendoring.packages\": no file manifest to vendor from", pkgPath)
	}
	return pkg, nil
}
