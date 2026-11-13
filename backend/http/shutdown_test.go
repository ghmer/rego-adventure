/*
   Copyright 2025 Mario Enrico Ragucci

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

package http

import (
	"context"
	"errors"
	"fmt"
	"net"
	nethttp "net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// freePort reserves a port so a server can bind to it and returns its address.
func freePort(t *testing.T) string {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to reserve port: %v", err)
	}
	addr := l.Addr().String()
	if err := l.Close(); err != nil {
		t.Fatalf("failed to release port: %v", err)
	}
	return addr
}

// addrFromReserve is like freePort but returns host and port separately.
func splitAddr(t *testing.T, addr string) (string, string) {
	t.Helper()
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("invalid address %q: %v", addr, err)
	}
	return "127.0.0.1", port
}

// newTestServer returns an unstarted server bound to a free port, built
// with the production timeout budget.
func newTestServer(t *testing.T, handler nethttp.Handler) *nethttp.Server {
	t.Helper()
	addr := freePort(t)
	return NewServer(addr, handler)
}

// ==================== RunWithGracefulShutdown ====================

// runResult carries what a backgrounded run of RunWithGracefulShutdown
// reported, so tests can assert on the outcome as well as the error.
type runResult struct {
	outcome RunOutcome
	err     error
}

// TestRunWithGracefulShutdown_ListenerClosedWithoutAShutdownRequest: a
// listener that stops on its own never served the shutdown the final log line
// claims. The run reports which of the two it was.
func TestRunWithGracefulShutdown_ListenerClosedWithoutAShutdownRequest(t *testing.T) {
	server := newTestServer(t, nethttp.HandlerFunc(func(nethttp.ResponseWriter, *nethttp.Request) {}))

	// Closing the listener before the run makes ListenAndServe report
	// ErrServerClosed without having served anything, and nothing in the run
	// asked for that.
	if err := server.Close(); err != nil {
		t.Fatalf("failed to close the listener: %v", err)
	}

	outcome, err := RunWithGracefulShutdown(context.Background(), server, DefaultShutdownTimeout)
	if err != nil {
		t.Fatalf("a listener closed by itself is not a failure: %v", err)
	}
	if outcome != OutcomeServerEnded {
		t.Errorf("outcome is %v, want %v", outcome, OutcomeServerEnded)
	}
}

// TestRunWithGracefulShutdown_StopsOnContextCancel verifies that cancelling
// the context stops the server and returns nil.
func TestRunWithGracefulShutdown_StopsOnContextCancel(t *testing.T) {
	server := newTestServer(t, nethttp.HandlerFunc(func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		w.WriteHeader(nethttp.StatusOK)
	}))

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan runResult, 1)
	go func() {
		outcome, err := RunWithGracefulShutdown(ctx, server, DefaultShutdownTimeout)
		done <- runResult{outcome: outcome, err: err}
	}()

	// Wait until the server is accepting connections.
	_, port := splitAddr(t, server.Addr)
	if !waitUntilListening(t, server.Addr, 2*time.Second) {
		t.Fatalf("server did not start listening on %s", port)
	}

	// A request must succeed while running.
	resp, err := getTestURL(t, "http://"+server.Addr+"/")
	if err != nil {
		t.Fatalf("request against running server failed: %v", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("failed to close response body: %v", err)
		}
	}()
	if resp.StatusCode != nethttp.StatusOK {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}

	cancel()

	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("RunWithGracefulShutdown returned error: %v", result.err)
		}
		// The context ended this run, so it is the drain that stopped the
		// server - not a listener that closed by itself.
		if result.outcome != OutcomeDrained {
			t.Errorf("outcome is %v, want %v", result.outcome, OutcomeDrained)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RunWithGracefulShutdown did not return after context cancel")
	}

	// The server must no longer accept connections.
	if conn, err := dialTimeout(server.Addr, 200*time.Millisecond); err == nil {
		if err := conn.Close(); err != nil {
			t.Errorf("failed to close probe connection: %v", err)
		}
		t.Fatal("server still accepts connections after shutdown")
	}
}

// TestRunWithGracefulShutdown_ReturnsListenError verifies that a failing
// ListenAndServe surfaces its error instead of blocking forever.
func TestRunWithGracefulShutdown_ReturnsListenError(t *testing.T) {
	// Occupy the port first so the server cannot bind.
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer func() {
		if err := l.Close(); err != nil {
			t.Errorf("failed to close occupying listener: %v", err)
		}
	}()

	server := NewServer(l.Addr().String(),
		nethttp.HandlerFunc(func(nethttp.ResponseWriter, *nethttp.Request) {}))

	outcome, err := RunWithGracefulShutdown(context.Background(), server, DefaultShutdownTimeout)
	if err == nil {
		t.Fatal("expected error when the port is already in use")
	}
	if outcome != OutcomeServerEnded {
		t.Errorf("outcome is %v, want %v", outcome, OutcomeServerEnded)
	}
	if !strings.Contains(err.Error(), "address already in use") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestRunWithGracefulShutdown_TimesOutOnStuckRequests verifies that a hung
// in-flight request forces a timeout error instead of blocking forever.
func TestRunWithGracefulShutdown_TimesOutOnStuckRequests(t *testing.T) {
	release := make(chan struct{})
	// entered signals that a request has reached the handler, so the test
	// never races on a fixed sleep to know the request is in flight.
	entered := make(chan struct{}, 1)
	server := newTestServer(t, nethttp.HandlerFunc(func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		<-release // hang until the test releases
		w.WriteHeader(nethttp.StatusOK)
	}))

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan runResult, 1)
	go func() {
		outcome, err := RunWithGracefulShutdown(ctx, server, 100*time.Millisecond)
		done <- runResult{outcome: outcome, err: err}
	}()

	if !waitUntilListening(t, server.Addr, 2*time.Second) {
		t.Fatal("server did not start listening")
	}

	// Open a connection that will hang inside the handler.
	reqDone := make(chan error, 1)
	go func() {
		resp, err := getTestURL(t, "http://"+server.Addr+"/")
		if err == nil {
			if cerr := resp.Body.Close(); cerr != nil {
				t.Errorf("failed to close response body: %v", cerr)
			}
		}
		reqDone <- err
	}()

	if !waitUntilListening(t, server.Addr, time.Second) {
		t.Fatal("server listener lost")
	}
	// Block until the client has actually reached the handler.
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("request never reached the handler")
	}

	cancel()

	select {
	case result := <-done:
		if result.err == nil {
			t.Fatal("expected timeout error for stuck in-flight request")
		}
		if !strings.Contains(result.err.Error(), "graceful shutdown failed") {
			t.Fatalf("unexpected error: %v", result.err)
		}
		if result.outcome != OutcomeDrained {
			t.Errorf("outcome is %v, want %v", result.outcome, OutcomeDrained)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RunWithGracefulShutdown did not return after timeout")
	}

	close(release)
	select {
	case err := <-reqDone:
		if err != nil {
			t.Logf("in-flight request failed after forced shutdown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("in-flight request never completed")
	}
}

// ==================== GracefulShutdown ====================

// TestGracefulShutdown_DrainsInFlightRequests verifies that an active request
// that completes while the shutdown is pending is allowed to finish.
func TestGracefulShutdown_DrainsInFlightRequests(t *testing.T) {
	var served atomic.Int32
	// handlerEntered signals that the slow request is in flight; no fixed
	// sleep is used to schedule the shutdown against it.
	handlerEntered := make(chan struct{}, 1)
	server := newTestServer(t, nethttp.HandlerFunc(func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		handlerEntered <- struct{}{}
		// Simulate work long enough that Shutdown must wait for it.
		time.Sleep(200 * time.Millisecond)
		served.Add(1)
		w.WriteHeader(nethttp.StatusOK)
	}))

	go func() {
		//nolint:errcheck,gosec // test server; a listen error here fails the waitUntilListening check below
		server.ListenAndServe()
	}()
	if !waitUntilListening(t, server.Addr, 2*time.Second) {
		t.Fatal("server did not start listening")
	}

	// Fire a slow request, then shut down while it is still in flight.
	reqDone := make(chan error, 1)
	go func() {
		resp, err := getTestURL(t, "http://"+server.Addr+"/")
		if err == nil {
			if cerr := resp.Body.Close(); cerr != nil {
				t.Errorf("failed to close response body: %v", cerr)
			}
		}
		reqDone <- err
	}()
	select {
	case <-handlerEntered:
	case <-time.After(5 * time.Second):
		t.Fatal("request never reached the handler")
	}

	if err := GracefulShutdown(server, 5*time.Second); err != nil {
		t.Fatalf("GracefulShutdown returned error: %v", err)
	}

	select {
	case err := <-reqDone:
		if err != nil {
			t.Fatalf("in-flight request failed during shutdown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("in-flight request never completed")
	}

	if served.Load() != 1 {
		t.Fatalf("expected handler to complete exactly once, got %d", served.Load())
	}
}

// waitUntilListening polls the address until a TCP connection succeeds.
func waitUntilListening(t *testing.T, addr string, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := (&net.Dialer{Timeout: 100 * time.Millisecond}).DialContext(context.Background(), "tcp", addr)
		if err == nil {
			if cerr := conn.Close(); cerr != nil {
				t.Errorf("failed to close probe connection: %v", cerr)
			}
			return true
		}
		if errors.Is(err, net.ErrClosed) {
			return false
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

// getTestURL performs a GET against a test server URL with the test's
// context, so the request cannot outlive the test.
func getTestURL(t *testing.T, url string) (*nethttp.Response, error) {
	t.Helper()
	req, err := nethttp.NewRequestWithContext(context.Background(), nethttp.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	return nethttp.DefaultClient.Do(req)
}

// dialTimeout dials addr with a bounded wait and returns the connection.
func dialTimeout(addr string, timeout time.Duration) (net.Conn, error) {
	return (&net.Dialer{Timeout: timeout}).DialContext(context.Background(), "tcp", addr)
}
