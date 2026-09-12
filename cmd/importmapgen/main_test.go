package main

import (
	"strings"
	"testing"
)

const testHTML = `<!DOCTYPE html>
<html>
<head>
    <script type="importmap">
        {
            "imports": {
                "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.4",
                "dompurify": "https://esm.sh/dompurify@3.4.14",
                "driver.js": "https://esm.sh/driver.js@1.8.0"
            }
        }
    </script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/driver.js/1.8.0/driver.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css">
</head>
</html>`

var testDeps = map[string]string{
	"canvas-confetti": "1.9.4",
	"dompurify":       "3.4.14",
	"driver.js":       "1.9.0",
	"marked":          "18.0.11",
}

// buildPkg assembles a PackageJSON for tests.
func buildPkg(deps map[string]string, subpaths map[string][]string) PackageJSON {
	return PackageJSON{
		DevDependencies: deps,
		Importmap:       ImportmapConfig{Subpaths: subpaths},
	}
}

func TestUpdateIndexHTMLRewritesImportMap(t *testing.T) {
	out, err := updateIndexHTML([]byte(testHTML), buildPkg(testDeps, nil))
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	if !strings.Contains(string(out), `"driver.js": "https://esm.sh/driver.js@1.9.0"`) {
		t.Errorf("import map should contain bumped driver.js version, got:\n%s", out)
	}
	if !strings.Contains(string(out), `"marked": "https://esm.sh/marked@18.0.11"`) {
		t.Errorf("import map should contain all devDependencies, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLSyncsCdnJsLink(t *testing.T) {
	out, err := updateIndexHTML([]byte(testHTML), buildPkg(testDeps, nil))
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	if !strings.Contains(string(out), "ajax/libs/driver.js/1.9.0/driver.min.css") {
		t.Errorf("cdnjs link version should track the package.json version, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLLeavesUnrelatedCdnJsLinks(t *testing.T) {
	out, err := updateIndexHTML([]byte(testHTML), buildPkg(testDeps, nil))
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	// font-awesome is not a devDependency and must not be touched
	if !strings.Contains(string(out), "ajax/libs/font-awesome/7.0.1/") {
		t.Errorf("unrelated cdnjs links must keep their version, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLToleratesRangePrefixes(t *testing.T) {
	deps := map[string]string{
		"driver.js": "^1.9.0",
	}
	out, err := updateIndexHTML([]byte(testHTML), buildPkg(deps, nil))
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	if !strings.Contains(string(out), "ajax/libs/driver.js/1.9.0/") {
		t.Errorf("range prefixes should be stripped for cdnjs links, got:\n%s", out)
	}
	if !strings.Contains(string(out), "esm.sh/driver.js@1.9.0") {
		t.Errorf("range prefixes should be stripped for import map entries, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLAcceptsPrereleaseVersions(t *testing.T) {
	deps := map[string]string{
		"driver.js": "1.9.0-beta.1",
	}
	out, err := updateIndexHTML([]byte(testHTML), buildPkg(deps, nil))
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	if !strings.Contains(string(out), "esm.sh/driver.js@1.9.0-beta.1") {
		t.Errorf("prerelease versions should be emitted verbatim, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLRejectsInvalidVersions(t *testing.T) {
	invalid := []string{
		">=1.2.0",
		"1.x",
		"*",
		"latest",
		"workspace:*",
		"",
		"1.0\"><script>alert(1)</script>",
		"1.0/../../etc",
	}
	for _, ver := range invalid {
		deps := map[string]string{"driver.js": ver}
		if _, err := updateIndexHTML([]byte(testHTML), buildPkg(deps, nil)); err == nil {
			t.Errorf("expected error for invalid version %q", ver)
		}
	}
}

func TestBuildImportMapErrorsOnInvalidVersion(t *testing.T) {
	deps := map[string]string{"yace": ">=1.1.0"}
	if _, err := buildImportMap(deps, nil); err == nil {
		t.Fatal("expected error for a non-semver dependency version")
	}
}

func TestUpdateIndexHTMLNoVersionChurn(t *testing.T) {
	deps := map[string]string{
		"driver.js": "1.8.0",
	}
	out, err := updateIndexHTML([]byte(testHTML), buildPkg(deps, nil))
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	if strings.Count(string(out), "ajax/libs/driver.js/1.8.0/") != 1 {
		t.Errorf("matching versions should not alter the link, got:\n%s", out)
	}
}

func TestSyncCdnJsVersionsSplicesByVersionPosition(t *testing.T) {
	// The library slug contains the same digits as the old version; a
	// substring replace would rewrite the slug instead of the version.
	html := `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/foo1.9/1.8.0/style.css">`
	deps := map[string]string{
		"foo1.9": "1.9.0",
	}

	out := syncCdnJsVersions([]byte(html), deps)

	if !strings.Contains(string(out), "ajax/libs/foo1.9/1.9.0/style.css") {
		t.Errorf("version segment should be rewritten in place, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLErrorsWithoutImportMap(t *testing.T) {
	_, err := updateIndexHTML([]byte("<html><head></head></html>"), buildPkg(testDeps, nil))
	if err == nil {
		t.Fatal("expected error when the document has no import map block")
	}
}

func TestBuildImportMapEmitsDeclaredSubpaths(t *testing.T) {
	deps := map[string]string{"yace": "1.1.0"}
	subpaths := map[string][]string{
		"yace": {"plugins/tab", "plugins/preserveIndent"},
	}
	out, err := buildImportMap(deps, subpaths)
	if err != nil {
		t.Fatalf("buildImportMap returned error: %v", err)
	}

	if !strings.Contains(string(out), `"yace": "https://esm.sh/yace@1.1.0"`) {
		t.Errorf("subpath declarations must not remove the bare entry, got:\n%s", out)
	}
	if !strings.Contains(string(out), `"yace/plugins/tab": "https://esm.sh/yace@1.1.0/plugins/tab"`) {
		t.Errorf("declared subpath should get its own entry, got:\n%s", out)
	}
	if !strings.Contains(string(out), `"yace/plugins/preserveIndent": "https://esm.sh/yace@1.1.0/plugins/preserveIndent"`) {
		t.Errorf("declared subpath should get its own entry, got:\n%s", out)
	}
}

func TestBuildImportMapStripsRangePrefixesInSubpaths(t *testing.T) {
	deps := map[string]string{"yace": "~1.1.0"}
	subpaths := map[string][]string{"yace": {"plugins/tab"}}
	out, err := buildImportMap(deps, subpaths)
	if err != nil {
		t.Fatalf("buildImportMap returned error: %v", err)
	}

	if !strings.Contains(string(out), `"yace/plugins/tab": "https://esm.sh/yace@1.1.0/plugins/tab"`) {
		t.Errorf("subpath URL should carry the stripped version, got:\n%s", out)
	}
}

func TestBuildImportMapTrimsSlashesFromSubpaths(t *testing.T) {
	deps := map[string]string{"yace": "1.1.0"}
	subpaths := map[string][]string{"yace": {"/plugins/tab"}}
	out, err := buildImportMap(deps, subpaths)
	if err != nil {
		t.Fatalf("buildImportMap returned error: %v", err)
	}

	if !strings.Contains(string(out), `"yace/plugins/tab": "https://esm.sh/yace@1.1.0/plugins/tab"`) {
		t.Errorf("subpath URLs should not contain doubled slashes, got:\n%s", out)
	}
}

func TestBuildImportMapErrorsOnEmptySubpath(t *testing.T) {
	deps := map[string]string{"yace": "1.1.0"}
	subpaths := map[string][]string{"yace": {"/"}}
	if _, err := buildImportMap(deps, subpaths); err == nil {
		t.Fatal("expected error for an empty subpath entry")
	}
}

func TestBuildImportMapErrorsOnUnknownDependency(t *testing.T) {
	deps := map[string]string{"driver.js": "1.9.0"}
	subpaths := map[string][]string{"yace": {"plugins/tab"}}
	if _, err := buildImportMap(deps, subpaths); err == nil {
		t.Fatal("expected error when subpaths are declared for a missing devDependency")
	}
}
