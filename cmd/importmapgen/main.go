package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

type PackageJSON struct {
	DevDependencies map[string]string `json:"devDependencies"`
}

type ImportMap struct {
	Imports map[string]string `json:"imports"`
}

var pkgPath string
var mapPath string

func init() {
	flag.StringVar(&pkgPath, "pkgPath", "frontend/adventure/package.json", "full path to package.json")
	flag.StringVar(&mapPath, "mapPath", "frontend/adventure/importmap.json", "full path to importmap.json")
	flag.Parse()
}

func main() {
	// 1. Read package.json
	pkgContent, err := os.ReadFile(pkgPath)
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
	mapContent, err := json.MarshalIndent(importMap, "", "  ")
	if err != nil {
		fmt.Printf("Error marshaling import map: %v\n", err)
		os.Exit(1)
	}

	// 3. Write importmap.json
	if err := os.WriteFile(mapPath, mapContent, 0644); err != nil {
		fmt.Printf("Error writing %s: %v\n", mapPath, err)
		os.Exit(1)
	}
	fmt.Printf("Generated %s\n", mapPath)
}
