package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// lockPath builds the package-lock.json path next to package.json.
func lockPath(frontendDir string) string {
	return frontendDir + "/package-lock.json"
}

// packageLock models the fields of package-lock.json vendorgen needs:
// the resolved package table (hoisted keys "node_modules/<name>"), whose
// entries pin version, origin URL, integrity and runtime dependencies.
type packageLock struct {
	Packages map[string]lockEntry `json:"packages"`
}

// lockEntry is one resolved package: version, URL, integrity and its
// runtime dependencies.
type lockEntry struct {
	Version   string            `json:"version"`
	Resolved  string            `json:"resolved"`
	Integrity string            `json:"integrity"`
	Deps      map[string]string `json:"dependencies"`
}

// readPackageLock loads the lockfile the vendored set is pinned against.
func readPackageLock(path string) (*packageLock, error) {
	var lock packageLock
	content, err := os.ReadFile(path) // #nosec G304 -- derived from the flag path
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w (run npm ci in that directory)", path, err)
	}
	if err := json.Unmarshal(content, &lock); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if len(lock.Packages) == 0 {
		return nil, fmt.Errorf("%s records no packages", path)
	}
	return &lock, nil
}

// entry resolves a dependency name to its lockfile entry. Flat hoisted
// installs get an exact key; nested layouts are searched by suffix.
func (l *packageLock) entry(name string) *lockEntry {
	if entry, ok := l.Packages["node_modules/"+name]; ok {
		return &entry
	}
	for key, entry := range l.Packages {
		if strings.HasSuffix(key, "/node_modules/"+name) {
			return &entry
		}
	}
	return nil
}

// dependencyClosure returns the root dependencies and their transitive
// runtime dependencies, deterministically ordered breadth-first.
func dependencyClosure(roots map[string]string, lock *packageLock) ([]string, error) {
	seen := map[string]bool{}
	queue := make([]string, 0, len(roots))
	for name := range roots {
		queue = append(queue, name)
	}
	sortStrings(queue)

	queued := map[string]bool{}
	out := make([]string, 0, len(queue))
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)

		entry := lock.entry(name)
		if entry == nil {
			continue
		}
		next := make([]string, 0, len(entry.Deps))
		for dep := range entry.Deps {
			if seen[dep] || queued[dep] {
				continue
			}
			queued[dep] = true
			next = append(next, dep)
		}
		sortStrings(next)
		queue = append(queue, next...)
	}
	return out, nil
}

// sortStrings sorts a string slice in place, ascending.
func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}
