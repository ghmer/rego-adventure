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

func TestUpdateIndexHTMLRewritesImportMap(t *testing.T) {
	out, err := updateIndexHTML([]byte(testHTML), testDeps)
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
	out, err := updateIndexHTML([]byte(testHTML), testDeps)
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	if !strings.Contains(string(out), "ajax/libs/driver.js/1.9.0/driver.min.css") {
		t.Errorf("cdnjs link version should track the package.json version, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLLeavesUnrelatedCdnJsLinks(t *testing.T) {
	out, err := updateIndexHTML([]byte(testHTML), testDeps)
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
	out, err := updateIndexHTML([]byte(testHTML), deps)
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

func TestUpdateIndexHTMLNoVersionChurn(t *testing.T) {
	deps := map[string]string{
		"driver.js": "1.8.0",
	}
	out, err := updateIndexHTML([]byte(testHTML), deps)
	if err != nil {
		t.Fatalf("updateIndexHTML returned error: %v", err)
	}

	if strings.Count(string(out), "ajax/libs/driver.js/1.8.0/") != 1 {
		t.Errorf("matching versions should not alter the link, got:\n%s", out)
	}
}

func TestUpdateIndexHTMLErrorsWithoutImportMap(t *testing.T) {
	_, err := updateIndexHTML([]byte("<html><head></head></html>"), testDeps)
	if err == nil {
		t.Fatal("expected error when the document has no import map block")
	}
}
