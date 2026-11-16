package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildTarball gzips a tar from an inner member map (npm layout: the
// leading "package/" component) and returns the bytes plus the
// sha512-<base64> integrity value a lockfile pins.
func buildTarball(t *testing.T, members map[string]string) ([]byte, string) {
	t.Helper()

	var raw bytes.Buffer
	gzipWriter := gzip.NewWriter(&raw)
	archive := tar.NewWriter(gzipWriter)
	for name, content := range members {
		if err := archive.WriteHeader(&tar.Header{Name: name, Mode: 0644, Size: int64(len(content))}); err != nil {
			t.Fatalf("writing header: %v", err)
		}
		if _, err := archive.Write([]byte(content)); err != nil {
			t.Fatalf("writing member: %v", err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("closing tar: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("closing gzip: %v", err)
	}

	digest := sha512.Sum512(raw.Bytes())
	return raw.Bytes(), "sha512-" + base64.StdEncoding.EncodeToString(digest[:])
}

// libaEntryJS is the entry module the closure test rides: it imports a
// sibling relative file and a bare specifier the transitive toolkit
// package must resolve.
const libaEntryJS = "import { helper } from './helper.js';\n" +
	"import { decode } from 'toolkit';\n" +
	"export { helper, decode };\n"

// pipelineFixture writes a frontend directory and serves its lockfile
// URLs from a localFetcher, the way vendorgen resolves npm packages.
type pipelineFixture struct {
	dir     string
	fetcher localFetcher
	pkg     map[string]any
	deps    map[string]string
	lock    map[string]lockEntry
}

// newPipelineFixture writes the package.json skeleton of the pipeline
// test: one explicitly configured root dependency and one auto-resolved
// root dependency.
func newPipelineFixture(t *testing.T) *pipelineFixture {
	f := &pipelineFixture{
		dir:     t.TempDir(),
		fetcher: localFetcher{},
		deps:    map[string]string{},
		lock:    map[string]lockEntry{},
	}
	f.pkg = map[string]any{
		"name":         "frontend",
		"dependencies": f.deps,
		"importmap":    map[string]any{"subpaths": map[string]any{}},
		"vendoring": map[string]any{
			"packages": map[string]any{},
		},
	}
	f.writePackage(t)
	return f
}

// writePackage flushes the package.json fixture to disk.
func (f *pipelineFixture) writePackage(t *testing.T) {
	t.Helper()
	content, err := json.MarshalIndent(f.pkg, "", "  ")
	if err != nil {
		t.Fatalf("marshal package fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(f.dir, "package.json"), content, 0644); err != nil { // #nosec G306 -- test fixture
		t.Fatalf("writing package.json: %v", err)
	}
}

// addDependency registers one npm package: dependency listing, vendoring
// config, tarball members and the lockfile entry pinning its integrity.
func (f *pipelineFixture) addDependency(
	t *testing.T, name, version, entry string, members map[string]string, deps map[string]string,
) {
	t.Helper()
	content, hash := buildTarball(t, members)
	url := "https://registry.test/" + name + ".tgz"

	f.deps[name] = version
	if entry != "" || len(f.vendoring(name)) > 0 {
		f.setVendoring(name, entry)
	}
	f.lock["node_modules/"+name] = lockEntry{
		Version: version, Resolved: url, Integrity: hash, Deps: deps,
	}
	f.fetcher[url] = content
}

// vendoring returns the current vendoring config of one package.
func (f *pipelineFixture) vendoring(name string) map[string]any {
	packages := f.pkg["vendoring"].(map[string]any)["packages"].(map[string]any)
	entry, ok := packages[name].(map[string]any)
	if !ok {
		return nil
	}
	return entry
}

// setVendoring writes the file manifest for one package.
func (f *pipelineFixture) setVendoring(name, entry string) {
	packages := f.pkg["vendoring"].(map[string]any)["packages"].(map[string]any)
	packages[name] = map[string]any{"entry": entry}
}

// writeLock flushes the lockfile fixture, after the last dependency was
// added.
func (f *pipelineFixture) writeLock(t *testing.T) {
	f.writePackage(t)
	packages := map[string]any{"": map[string]any{"dependencies": f.deps}}
	names := make([]string, 0, len(f.lock))
	for name := range f.lock {
		names = append(names, name)
	}
	sortStrings(names)
	for _, name := range names {
		packages[name] = map[string]any{
			"version":   f.lock[name].Version,
			"resolved":  f.lock[name].Resolved,
			"integrity": f.lock[name].Integrity,
		}
		if f.lock[name].Deps != nil {
			packages[name].(map[string]any)["dependencies"] = f.lock[name].Deps
		}
	}
	lock := map[string]any{"packages": packages}
	content, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		t.Fatalf("marshal lock fixture: %v", err)
	}
	target := filepath.Join(f.dir, "package-lock.json")
	// #nosec G306 -- test fixture
	if err := os.WriteFile(target, content, 0644); err != nil {
		t.Fatalf("writing package-lock.json: %v", err)
	}
}

// vendor runs vendorgen over the fixture's vendor directory.
func (f *pipelineFixture) vendor(t *testing.T) Manifest {
	t.Helper()
	var pkg packageJSON
	content := readFixture(t, filepath.Join(f.dir, "package.json"))
	if err := json.Unmarshal([]byte(content), &pkg); err != nil {
		t.Fatalf("parsing fixture package.json: %v", err)
	}
	manifest, err := vendorPackages(pkg, f.dir, filepath.Join(f.dir, "vendor"), f.fetcher)
	if err != nil {
		t.Fatalf("vendorPackages: %v", err)
	}
	return manifest
}

// readFixture reads one fixture file's bytes as text.
func readFixture(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path) // #nosec G304 -- test paths
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return string(content)
}

func TestLoadTarballStripsPackagePrefix(t *testing.T) {
	content, _ := buildTarball(t, map[string]string{
		"package/package.json": `{"name": "lib"}`,
		"package/lib/a.mjs":    "export {};",
	})
	ball, err := loadTarball(content)
	if err != nil {
		t.Fatalf("loadTarball: %v", err)
	}
	if ball.manifest.Name != "lib" {
		t.Errorf("package metadata should be readable, got %q", ball.manifest.Name)
	}
	if _, ok := ball.files["lib/a.mjs"]; !ok {
		t.Error("member should be stored under its inner path")
	}
}

func TestLoadTarballSkipsForeignAndEscapeMembers(t *testing.T) {
	content, _ := buildTarball(t, map[string]string{
		"package/package.json":   `{"name": "a"}`,
		"package/a.mjs":          "fine",
		"outer/lib/a.mjs":        "not an npm tarball member",
		"package/../lib/evil.js": "escape",
	})
	ball, err := loadTarball(content)
	if err != nil {
		t.Fatalf("loadTarball: %v", err)
	}
	if _, ok := ball.files["lib/a.mjs"]; ok {
		t.Error("members outside package/ must be skipped")
	}
	if _, ok := ball.files["../lib/evil.js"]; ok {
		t.Error("escape members must be skipped")
	}
	if _, ok := ball.files["a.mjs"]; !ok {
		t.Error("packaged members must load")
	}
}

func TestVerifyIntegrity(t *testing.T) {
	content := []byte("tarball-bytes")
	digest := sha512.Sum512(content)
	pinned := "sha512-" + base64.StdEncoding.EncodeToString(digest[:])

	if err := verifyIntegrity(content, pinned); err != nil {
		t.Errorf("matching integrity must pass: %v", err)
	}
	if err := verifyIntegrity([]byte("tampered"), pinned); err == nil {
		t.Error("a different payload must fail the integrity check")
	}
	if err := verifyIntegrity(content, "sha1-WfVLKtZ="); err == nil {
		t.Error("a non-sha512 algorithm must be rejected")
	}
}

func TestResolveEntryPrefersExportsImportCondition(t *testing.T) {
	npm := npmPackage{
		Exports: map[string]json.RawMessage{
			".": json.RawMessage(`{"import": {"types": "a.d.ts", "default": "./dist/es.mjs"}, "require": "./cjs.js"}`),
		},
		Module: "dist/wrong.mjs",
	}
	entry, err := resolveEntry(npm)
	if err != nil {
		t.Fatalf("resolveEntry: %v", err)
	}
	if entry != "dist/es.mjs" {
		t.Errorf("expected the exports import condition, got %q", entry)
	}
}

func TestResolveEntryFallsBackToModule(t *testing.T) {
	entry, err := resolveEntry(npmPackage{Module: "./dist/module.mjs", Main: "index.js"})
	if err != nil {
		t.Fatalf("resolveEntry: %v", err)
	}
	if entry != "dist/module.mjs" {
		t.Errorf("expected the module field, got %q", entry)
	}
}

func TestResolveEntryRejectsCommonJSOnlyPackage(t *testing.T) {
	if _, err := resolveEntry(npmPackage{Main: "dist/umd/bundle.js"}); err == nil {
		t.Error("a CJS-only package needs an explicit vendoring entry; must error")
	}
}

func TestResolveSubpathViaWildcardExports(t *testing.T) {
	npm := npmPackage{
		Exports: map[string]json.RawMessage{
			".":           json.RawMessage(`"./dist/index.js"`),
			"./plugins/*": json.RawMessage(`"./dist/plugins/*.js"`),
		},
	}
	file, err := resolveSubpath(npm, "plugins/tab")
	if err != nil {
		t.Fatalf("resolveSubpath: %v", err)
	}
	if file != "dist/plugins/tab.js" {
		t.Errorf("expected the wildcard substitution, got %q", file)
	}
}

func TestReadPackageJSONRejectsVersionRanges(t *testing.T) {
	dir := t.TempDir()
	content := `{"name": "f", "dependencies": {"marked": "^1.0.0"},
      "vendoring": {"packages": {"marked": {"entry": "m.js"}}}}`
	target := filepath.Join(dir, "package.json")
	// #nosec G306 -- test fixture
	if err := os.WriteFile(target, []byte(content), 0644); err != nil {
		t.Fatalf("writing package.json: %v", err)
	}
	if _, err := readPackageJSON(filepath.Join(dir, "package.json")); err == nil {
		t.Error("a ranged dependency breaks the vendoring pin; must error")
	}
}

// TestVendorgenPipeline is the end-to-end check: configured entry,
// relative-import closure, transitive dependency, manifest, and the
// removal of a stale vendor directory.
func TestVendorgenPipeline(t *testing.T) {
	f := newPipelineFixture(t)
	f.pkg["vendoring"].(map[string]any)["packages"].(map[string]any)["marked"] =
		map[string]string{"entry": "lib/marked.esm.js"}
	f.addDependency(t, "marked", "1.2.3", "lib/marked.esm.js", map[string]string{
		"package/package.json":      `{"name": "marked", "main": "lib/marked.cjs"}`,
		"package/lib/marked.esm.js": "export const marked = () => 42;",
		"package/LICENSE":           "MIT",
	}, nil)
	f.addDependency(t, "liba", "2.0.0", "", map[string]string{
		"package/package.json":  `{"name": "liba", "module": "esm/index.js", "dependencies": {"toolkit": "^1.5.0"}}`,
		"package/esm/index.js":  libaEntryJS,
		"package/esm/helper.js": "export const helper = () => 1;",
	}, map[string]string{"toolkit": "^1.5.0"})
	f.addDependency(t, "toolkit", "1.5.0", "", map[string]string{
		"package/package.json":   `{"name": "toolkit", "module": "esm/toolkit.js"}`,
		"package/esm/toolkit.js": "export const decode = () => true;",
		"package/LICENSE":        "MIT",
	}, nil)
	f.writeLock(t)

	// A leftover from a removed dependency: pruning must take it.
	stale := filepath.Join(f.dir, "vendor", "gone@0.0.9")
	if err := os.MkdirAll(stale, 0755); err != nil { // #nosec G301 -- test fixture
		t.Fatalf("seeding stale directory: %v", err)
	}

	manifest := f.vendor(t)

	for _, name := range []string{"marked", "liba", "toolkit"} {
		if _, ok := manifest.Packages[name]; !ok {
			t.Errorf("manifest should record %s", name)
		}
	}
	if manifest.Packages["liba"].Entry != "esm/index.js" {
		t.Errorf("auto-resolved entry expected, got %q", manifest.Packages["liba"].Entry)
	}
	for _, file := range []string{
		filepath.Join("vendor", "marked@1.2.3", "lib", "marked.esm.js"),
		filepath.Join("vendor", "liba@2.0.0", "esm", "index.js"),
		filepath.Join("vendor", "liba@2.0.0", "esm", "helper.js"),
		filepath.Join("vendor", "toolkit@1.5.0", "esm", "toolkit.js"),
		filepath.Join("vendor", "toolkit@1.5.0", "LICENSE"),
	} {
		if _, err := os.Stat(filepath.Join(f.dir, file)); err != nil {
			t.Errorf("%s should be vendored: %v", file, err)
		}
	}
	if strings.Contains(strings.Join(manifest.Packages["liba"].Files, ","), "liba@") {
		t.Error("manifest files are package-relative, not vendor-relative")
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Error("the stale vendor directory must be pruned")
	}

	// The written manifest is the contract importmapgen consumes.
	written := readFixture(t, filepath.Join(f.dir, "vendor", "manifest.json"))
	if !strings.Contains(written, `"toolkit": {`) {
		t.Error("the manifest on disk should carry the transitive package")
	}
}

// TestVendorgenPipelineCSSOnly: an aliased stylesheet dependency ships no
// module, closes its font files from url() targets, and its manifest row
// carries no entry.
func TestVendorgenPipelineCSSOnly(t *testing.T) {
	f := newPipelineFixture(t)
	f.addDependency(t, "@scope/styles", "3.0.0", "", map[string]string{
		"package/package.json":     `{"name": "@scope/styles"}`,
		"package/css/all.css":      "src: url(../webfonts/a.woff2) format('woff2');",
		"package/webfonts/a.woff2": "font-bytes",
		"package/LICENSE.txt":      "MIT-OF",
	}, nil)
	packages := f.pkg["vendoring"].(map[string]any)["packages"].(map[string]any)
	packages["@scope/styles"] = map[string]any{"css": "css/all.css"}
	f.pkg["vendoring"].(map[string]any)["cssAlias"] = map[string]string{"font-awesome": "@scope/styles"}
	f.writeLock(t)

	manifest := f.vendor(t)

	entry, ok := manifest.Packages["@scope/styles"]
	if !ok {
		t.Fatal("the CSS package should still be recorded")
	}
	if entry.Entry != "" {
		t.Errorf("a CSS-only package records no entry, got %q", entry.Entry)
	}
	if entry.Dir != "scope-styles@3.0.0" {
		t.Errorf("scoped names fold to a dashed directory, got %q", entry.Dir)
	}
	if manifest.CSS["font-awesome"].Dir != "scope-styles@3.0.0" {
		t.Errorf("the alias should point at the vendored stylesheet, got %v", manifest.CSS["font-awesome"])
	}
	for _, file := range []string{"css/all.css", "webfonts/a.woff2", "LICENSE.txt"} {
		full := filepath.Join(f.dir, "vendor", "scope-styles@3.0.0", filepath.FromSlash(file))
		if _, err := os.Stat(full); err != nil {
			t.Errorf("%s should be vendored: %v", file, err)
		}
	}
}
