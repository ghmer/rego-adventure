package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"regexp"
	"sort"
	"strings"
)

// maxMemberSize and maxTarballSize cap npm tarball handling; the largest
// runtime package today is under 2 MB, so generous caps still refuse any
// surprising download.
const (
	maxMemberSize  = 16 << 20
	maxTarballSize = 48 << 20
)

// npmPackage models the package.json inside a dependency tarball; its
// fields decide which file the package's bare name resolves to.
type npmPackage struct {
	Name    string                     `json:"name"`
	Exports map[string]json.RawMessage `json:"exports"`
	Module  string                     `json:"module"`
	Main    string                     `json:"main"`
}

// tarball holds an unpacked npm package in memory: raw bytes (for the
// integrity check), the inner file map keyed without the archive's
// leading "package/" component, and the package metadata.
type tarball struct {
	raw      []byte
	files    map[string][]byte
	manifest npmPackage
	entry    string
}

// relativeImportRe matches the relative-specifier import forms a browser
// ESM file can carry: `from "./x"`, `import "./x"`, `import("./x")` and
// `export ... from "./x"`. Bare specifiers are left alone: the browser
// resolves them through the import map, never against vendor files.
var relativeImportRe = regexp.MustCompile(`(?:\bfrom|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]`)

// loadTarball unpacks a gzipped npm tarball in memory and validates the
// member layout the extraction trusts: no escape paths, no directories
// beyond the leading package component, and a parseable package.json.
func loadTarball(content []byte) (tarball, error) {
	var ball tarball
	ball.raw = content
	reader, err := gzip.NewReader(bytes.NewReader(content))
	if err != nil {
		return ball, fmt.Errorf("opening tarball: %w", err)
	}
	archive := tar.NewReader(reader)
	ball.files = map[string][]byte{}
	for {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return ball, fmt.Errorf("reading tarball: %w", err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		if header.Size > maxMemberSize {
			return ball, fmt.Errorf("member %s exceeds %d bytes", header.Name, maxMemberSize)
		}
		data := make([]byte, header.Size)
		if _, err := io.ReadFull(archive, data); err != nil {
			return ball, fmt.Errorf("reading member %s: %w", header.Name, err)
		}
		inner, ok := innerPath(header.Name)
		if !ok {
			continue
		}
		ball.files[inner] = data
	}
	if len(ball.files) == 0 {
		return ball, fmt.Errorf("tarball contains no files")
	}
	rawManifest, ok := ball.files["package.json"]
	if !ok {
		return ball, fmt.Errorf("tarball has no package.json")
	}
	if err := json.Unmarshal(rawManifest, &ball.manifest); err != nil {
		return ball, fmt.Errorf("parsing the package manifest: %w", err)
	}
	return ball, nil
}

// innerPath strips the leading package directory npm tarballs use and
// rejects every path shape that could escape the vendor directory. A
// member outside "package/" is skipped: npm always packages one root
// directory, so anything else is a non-npm archive.
func innerPath(name string) (string, bool) {
	if !strings.HasPrefix(name, "package/") {
		return "", false
	}
	inner := strings.TrimPrefix(name, "package/")
	if inner == "" || strings.Contains(inner, "..") || path.IsAbs(inner) ||
		strings.Contains(name, "\\") || strings.Contains(inner, "\\") {
		return "", false
	}
	return inner, true
}

// verifyIntegrity checks the lockfile's sha512-<base64> integrity hash
// against the downloaded tarball.
func verifyIntegrity(content []byte, integrity string) error {
	algo, hash, ok := strings.Cut(integrity, "-")
	if !ok || algo != "sha512" {
		return fmt.Errorf("unsupported integrity algorithm in %q", integrity)
	}
	want, err := base64.StdEncoding.DecodeString(hash)
	if err != nil {
		return fmt.Errorf("decoding integrity hash: %w", err)
	}
	got := sha512.Sum512(content)
	for i := range got {
		if got[i] != want[i] {
			return fmt.Errorf("integrity mismatch: tarball is not the sha512 the lockfile pins")
		}
	}
	return nil
}

// resolveEntry picks the file a bare import of the package resolves to:
// the exports map's import condition, then its default, then the module
// field. A CommonJS main (the UMD builds) is never the entry.
func resolveEntry(npm npmPackage) (string, error) {
	if raw, ok := npm.Exports["."]; ok {
		entry := exportEntry(raw)
		if entry != "" {
			return strings.TrimPrefix(entry, "./"), nil
		}
	}
	if npm.Module != "" {
		return strings.TrimPrefix(npm.Module, "./"), nil
	}
	return "", fmt.Errorf("no ESM entry in exports/module; declare one in the vendoring config")
}

// exportEntry unwraps the "." export value: a plain string, or the object
// form whose import condition (itself possibly {types, default}) wins
// over the default condition.
func exportEntry(raw json.RawMessage) string {
	var plain string
	if err := json.Unmarshal(raw, &plain); err == nil {
		return plain
	}
	var conditions map[string]json.RawMessage
	if err := json.Unmarshal(raw, &conditions); err != nil {
		return ""
	}
	entry := exportCondition(conditions["import"])
	if entry != "" {
		return entry
	}
	return exportCondition(conditions["default"])
}

// exportCondition resolves one conditions object: a string value or the
// object form's default condition.
func exportCondition(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var plain string
	if err := json.Unmarshal(raw, &plain); err == nil {
		return plain
	}
	var nested map[string]json.RawMessage
	if err := json.Unmarshal(raw, &nested); err != nil {
		return ""
	}
	if inner, ok := nested["default"]; ok {
		if err := json.Unmarshal(inner, &plain); err == nil {
			return strings.TrimPrefix(plain, "./")
		}
	}
	return ""
}

// resolveSubpath maps a module subpath specifier (the part after the
// package name, without a leading slash) to its dist file via the
// package's exports map: a key of the form "./<dir>/*" captures the
// subpath's variable part, and the mapped value with exactly one "*"
// substitutes it back. Deterministic order: keys are sorted, and each key
// is used at most once.
func resolveSubpath(npm npmPackage, spec string) (string, error) {
	wanted := "./" + spec

	// An exact, non-wildcard key wins outright.
	if raw, ok := npm.Exports[wanted]; ok {
		entry := exportEntry(raw)
		if entry != "" {
			return strings.TrimPrefix(entry, "./"), nil
		}
	}

	keys := make([]string, 0, len(npm.Exports))
	for key := range npm.Exports {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !strings.Contains(key, "*") {
			continue
		}
		captured, ok := matchWildcardKey(key, wanted)
		if !ok {
			continue
		}
		raw := npm.Exports[key]
		entry := exportEntry(raw)
		if entry == "" {
			continue
		}
		if strings.Count(entry, "*") != 1 {
			continue
		}
		resolved := strings.Replace(entry, "*", captured, 1)
		return strings.TrimPrefix(resolved, "./"), nil
	}
	return "", fmt.Errorf("exports map has no match for module subpath %q", spec)
}

// matchWildcardKey matches a wanted specifier against an exports key that
// carries one "*", returning the captured variable part.
func matchWildcardKey(key, wanted string) (string, bool) {
	star := strings.Index(key, "*")
	prefix, suffix := key[:star], key[star+1:]
	if !strings.HasPrefix(wanted, prefix) || !strings.HasSuffix(wanted, suffix) {
		return "", false
	}
	captured := wanted[len(prefix) : len(wanted)-len(suffix)]
	if strings.Contains(captured, "/") {
		return "", false
	}
	return captured, true
}
