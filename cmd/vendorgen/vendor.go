package main

import (
	"fmt"
	"maps"
	"path/filepath"
	"sort"
	"strings"
)

// packageJSON models the frontend package.json: the dependency surface the
// import map and the vendored set are built from, the importmap subpath
// hints importmapgen consumes, and the vendoring file manifest.
type packageJSON struct {
	Dependencies map[string]string `json:"dependencies"`
	Importmap    importmapConfig   `json:"importmap"`
	Vendoring    vendoringConfig   `json:"vendoring"`
}

// importmapConfig carries the module subpaths an import needs besides the
// bare package name (see cmd/importmapgen).
type importmapConfig struct {
	Subpaths map[string][]string `json:"subpaths"`
}

// vendoringConfig is the "vendoring" section of the frontend package.json.
// Files are paths inside the package as shipped by npm; the entry is the
// file the package's bare name resolves to, files are the imports of the
// other declared module specifiers (the importmap.subpaths keys), and css
// names one stylesheet the document links to directly. The alias maps a
// cdnjs library slug (e.g. "font-awesome") to the dependency that ships it.
type vendoringConfig struct {
	Dependencies map[string]packageFiles `json:"packages"`
	CSSAlias     map[string]string       `json:"cssAlias"`
}

// packageFiles lists the files of one package that the browser fetches.
type packageFiles struct {
	Entry string   `json:"entry"`
	Files []string `json:"files,omitempty"`
	CSS   string   `json:"css,omitempty"`
}

// pkgManifest records what one vendored package contributes: the directory
// it is unpacked into, the file its bare name resolves to, the file for
// every declared subpath module, directly linked CSS, and every file
// written on disk (entry, subpaths, relative-import closure, LICENSE,
// package.json).
type pkgManifest struct {
	Dir          string            `json:"dir"`
	Entry        string            `json:"entry"`
	SubpathFiles map[string]string `json:"subpathFiles,omitempty"`
	CSS          string            `json:"css,omitempty"`
	Files        []string          `json:"files"`
}

// Manifest is the machine-readable contract between vendorgen and the
// manifest mode of importmapgen: everything needed to rewrite the import
// map and the document's cdnjs links to local paths.
type Manifest struct {
	Packages map[string]pkgManifest `json:"packages"`
	CSS      map[string]cssManifest `json:"css"`
}

// cssManifest is a stylesheet the document links to directly, keyed by its
// cdnjs library slug.
type cssManifest struct {
	Dir  string `json:"dir"`
	File string `json:"file"`
}

// vendoredDirName is the folder a package unpacks into under vendor/.
// Scoped package names lose their "@" and fold their scope with a dash;
// the mapping is deterministic, so vendor directories stay stable.
func vendoredDirName(name, version string) (string, error) {
	dir := strings.ReplaceAll(strings.TrimPrefix(name, "@"), "/", "-")
	if version == "" {
		return "", fmt.Errorf("package %s: missing version", name)
	}
	if dir == "" || strings.Contains(dir, "..") || strings.Contains(dir, "\\") {
		return "", fmt.Errorf("package %s: unusable vendor directory name", name)
	}
	return dir + "@" + version, nil
}

// vendorPackages drives the pipeline: the dependency closure is resolved
// against the lockfile, every tarball is fetched and integrity-checked,
// the configured files plus their within-package relative imports are
// extracted, and stale vendor directories are pruned.
func vendorPackages(pkg packageJSON, frontendDir, outDir string, downloads fetcher) (Manifest, error) {
	lock, err := readPackageLock(lockPath(frontendDir))
	if err != nil {
		return Manifest{}, err
	}

	if err := validateConfig(pkg, lock); err != nil {
		return Manifest{}, err
	}

	names, err := dependencyClosure(pkg.Dependencies, lock)
	if err != nil {
		return Manifest{}, err
	}

	manifest := Manifest{Packages: map[string]pkgManifest{}, CSS: map[string]cssManifest{}}
	for _, name := range names {
		entry, err := vendorgPackage(pkg, lock, name, outDir, downloads)
		if err != nil {
			return Manifest{}, fmt.Errorf("vendoring %s: %w", name, err)
		}
		if entry == nil {
			continue
		}
		manifest.Packages[name] = *entry
	}
	maps.Copy(manifest.CSS, resolveCSSAlias(pkg, lock))
	if err := pruneVendorDir(outDir, manifest); err != nil {
		return Manifest{}, err
	}
	if err := writeManifest(filepath.Join(outDir, "manifest.json"), manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

// validateConfig rejects a vendoring manifest that names packages nobody
// depends on, and CSS aliases that name unknown dependencies or packages
// that never declared a stylesheet to ship.
func validateConfig(pkg packageJSON, lock *packageLock) error {
	for name := range pkg.Vendoring.Dependencies {
		if _, ok := pkg.Dependencies[name]; !ok {
			return fmt.Errorf("vendoring entry %q is not a dependency", name)
		}
	}
	for slug, dep := range pkg.Vendoring.CSSAlias {
		if _, ok := pkg.Dependencies[dep]; !ok {
			return fmt.Errorf("css alias %q -> %q is not a dependency", slug, dep)
		}
		if lock.entry(dep) == nil {
			return fmt.Errorf("css alias %q -> %q: %q is not resolved in the lockfile", slug, dep, dep)
		}
		if pkg.Vendoring.Dependencies[dep].CSS == "" {
			return fmt.Errorf("css alias %q -> %q: %q declares no css file in vendoring.packages", slug, dep, dep)
		}
	}
	return nil
}

// resolveCSSAlias returns the vendor directory and stylesheet of every
// aliased stylesheet dependency, so the manifest can name both for
// importmapgen.
func resolveCSSAlias(pkg packageJSON, lock *packageLock) map[string]cssManifest {
	out := map[string]cssManifest{}
	for slug, dep := range pkg.Vendoring.CSSAlias {
		lockEntry := lock.entry(dep)
		if lockEntry == nil {
			continue
		}
		dir, err := vendoredDirName(dep, lockEntry.Version)
		if err != nil {
			continue
		}
		out[slug] = cssManifest{Dir: dir, File: pkg.Vendoring.Dependencies[dep].CSS}
	}
	return out
}

// vendorgPackage fetches one package's tarball, extracts the configured
// files plus the relative-import closure, and builds its manifest entry.
// A dependency whose vendoring config declares only a stylesheet ships no
// module at all: it returns a nil entry instead of a manifest row.
func vendorgPackage(pkg packageJSON, lock *packageLock, name, outDir string, downloads fetcher) (*pkgManifest, error) {
	entry := lock.entry(name)
	if entry == nil {
		return nil, fmt.Errorf("%s is not resolved in the lockfile (run npm ci)", name)
	}
	dirName, err := vendoredDirName(name, entry.Version)
	if err != nil {
		return nil, err
	}

	content, err := downloads.fetch(entry.Resolved)
	if err != nil {
		return nil, err
	}
	ball, err := loadTarball(content)
	if err != nil {
		return nil, err
	}
	if err := verifyIntegrity(ball.raw, entry.Integrity); err != nil {
		return nil, err
	}

	files, err := collectFiles(pkg, name, &ball)
	if err != nil {
		return nil, err
	}
	if ball.entry == "" && configuredCSS(pkg, name) != "" {
		// CSS-only contribution: no import map, one manifest row fewer.
		if err := ball.write(outDir, dirName, files); err != nil {
			return nil, err
		}
		return &pkgManifest{Dir: dirName, Files: sortedFiles(files), CSS: configuredCSS(pkg, name)}, nil
	}

	subpaths, err := mapSubpaths(pkg, name, &ball, files)
	if err != nil {
		return nil, err
	}

	if err := ball.write(outDir, dirName, files); err != nil {
		return nil, err
	}

	manifestEntry := pkgManifest{
		Dir:   dirName,
		Entry: ball.entry,
		Files: sortedFiles(files),
	}
	for key, file := range subpaths {
		if manifestEntry.SubpathFiles == nil {
			manifestEntry.SubpathFiles = map[string]string{}
		}
		manifestEntry.SubpathFiles[key] = file
	}
	manifestEntry.CSS = configuredCSS(pkg, name)
	return &manifestEntry, nil
}

// configureSubpathKeys sorts the subpath keys of one package, so error
// messages and manifests stay deterministic.
func sortedFiles(files map[string]bool) []string {
	out := make([]string, 0, len(files))
	for file := range files {
		out = append(out, file)
	}
	sort.Strings(out)
	return out
}
