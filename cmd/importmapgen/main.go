// Package main generates import maps for frontend dependencies.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
)

type PackageJSON struct {
	DevDependencies map[string]string `json:"devDependencies"`
}

type ImportMap struct {
	Imports map[string]string `json:"imports"`
}

var pkgPath string
var indexPath string

func init() {
	flag.StringVar(&pkgPath, "pkgPath", "frontend/adventure/package.json", "full path to package.json")
	flag.StringVar(&indexPath, "indexPath", "frontend/adventure/index.html", "full path to index.html")
	flag.Parse()
}

func main() {
	// 1. Read package.json
	// pkgPath comes from a trusted CLI flag pointing to a local build file.
	pkgContent, err := os.ReadFile(pkgPath) //nolint:gosec // G304: intentional, path is from CLI flag
	if err != nil {
		fmt.Printf("Error reading %s: %v\n", pkgPath, err)
		os.Exit(1)
	}

	var pkg PackageJSON
	if err := json.Unmarshal(pkgContent, &pkg); err != nil {
		fmt.Printf("Error parsing %s: %v\n", pkgPath, err)
		os.Exit(1)
	}

	// 2. Generate import map
	imports := make(map[string]string)

	for lib, ver := range pkg.DevDependencies {
		// Strip common version prefixes like ~ and ^
		version := strings.TrimLeft(ver, "~^")
		imports[lib] = fmt.Sprintf("https://esm.sh/%s@%s", lib, version)
	}

	importMap := ImportMap{Imports: imports}
	mapContent, err := json.MarshalIndent(importMap, "        ", "    ")
	if err != nil {
		fmt.Printf("Error marshaling import map: %v\n", err)
		os.Exit(1)
	}

	// indexPath comes from a trusted CLI flag pointing to a local build file.
	indexContent, err := os.ReadFile(indexPath) //nolint:gosec // G304: intentional, path is from CLI flag
	if err != nil {
		fmt.Printf("Error reading %s: %v\n", indexPath, err)
		os.Exit(1)
	}

	// 4. Replace import map in index.html
	// We look for <script type="importmap"> ... </script>
	// and replace the content inside.
	re := regexp.MustCompile(`(?s)<script type="importmap">.*?</script>`)

	newScriptTag := fmt.Sprintf(`<script type="importmap">
        %s
    </script>`, string(mapContent))

	if !re.Match(indexContent) {
		fmt.Printf("Error: Could not find <script type=\"importmap\"> in %s\n", indexPath)
		os.Exit(1)
	}

	newIndexContent := re.ReplaceAll(indexContent, []byte(newScriptTag))

	// 5. Write index.html
	//nolint:gosec // G703: indexPath is a CLI flag; writing back the updated content to the same file is intentional
	if err := os.WriteFile(indexPath, newIndexContent, 0600); err != nil {
		fmt.Printf("Error writing %s: %v\n", indexPath, err)
		os.Exit(1)
	}
	fmt.Printf("Updated import map in %s\n", indexPath)
}
