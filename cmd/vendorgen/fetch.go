package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"time"
)

// fetchTimeout bounds one tarball download.
const fetchTimeout = 60 * time.Second

// fetcher downloads a tarball by URL; the indirection keeps the download
// out of the unit tests, which build tarballs directly.
type fetcher interface {
	fetch(url string) ([]byte, error)
}

// httpFetcher fetches lockfile URLs with a plain, fixed client: registry
// responses are immutable by contract and the integrity check makes any
// substitution visible.
type httpFetcher struct{}

// fetch downloads one tarball, capped at maxTarballSize.
func (httpFetcher) fetch(url string) ([]byte, error) {
	client := &http.Client{Timeout: fetchTimeout}
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("building request for %s: %w", url, err)
	}
	resp, err := client.Do(request) // #nosec G107 -- only the lockfile's registry URLs
	if err != nil {
		return nil, fmt.Errorf("downloading %s: %w", url, err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("downloading %s: status %d", url, resp.StatusCode)
	}
	content, err := io.ReadAll(io.LimitReader(resp.Body, maxTarballSize+1))
	if err != nil {
		return nil, fmt.Errorf("downloading %s: %w", url, err)
	}
	if len(content) > maxTarballSize {
		return nil, fmt.Errorf("downloading %s: exceeds %d bytes", url, maxTarballSize)
	}
	return content, nil
}

// localFetcher serves the bytes of a pre-registered URL, for tests.
type localFetcher map[string][]byte

// fetch returns the registered bytes, or an error for anything unknown.
func (l localFetcher) fetch(url string) ([]byte, error) {
	if content, ok := l[url]; ok {
		return bytes.Clone(content), nil
	}
	return nil, fmt.Errorf("no content registered for %s", url)
}
