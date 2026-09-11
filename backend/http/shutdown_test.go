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
	l, err := net.Listen("tcp", "127.0.0.1:0")
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

// newTestServer returns an unstarted server bound to a free port.
func newTestServer(t *testing.T, handler nethttp.Handler) *nethttp.Server {
	t.Helper()
	addr := freePort(t)
	return &nethttp.Server{
		Addr:    addr,
		Handler: handler,
	}
}

// ==================== RunWithGracefulShutdown ====================

// TestRunWithGracefulShutdown_StopsOnContextCancel verifies that cancelling
// the context stops the server and returns nil.
func TestRunWithGracefulShutdown_StopsOnContextCancel(t *testing.T) {
	server := newTestServer(t, nethttp.HandlerFunc(func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		w.WriteHeader(nethttp.StatusOK)
	}))

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- RunWithGracefulShutdown(ctx, server, DefaultShutdownTimeout)
	}()

	// Wait until the server is accepting connections.
	_, port := splitAddr(t, server.Addr)
	if !waitUntilListening(t, server.Addr, 2*time.Second) {
		t.Fatalf("server did not start listening on %s", port)
	}

	// A request must succeed while running.
	resp, err := nethttp.Get("http://" + server.Addr + "/")
	if err != nil {
		t.Fatalf("request against running server failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != nethttp.StatusOK {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}

	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RunWithGracefulShutdown returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RunWithGracefulShutdown did not return after context cancel")
	}

	// The server must no longer accept connections.
	if conn, err := net.DialTimeout("tcp", server.Addr, 200*time.Millisecond); err == nil {
		conn.Close()
		t.Fatal("server still accepts connections after shutdown")
	}
}

// TestRunWithGracefulShutdown_ReturnsListenError verifies that a failing
// ListenAndServe surfaces its error instead of blocking forever.
func TestRunWithGracefulShutdown_ReturnsListenError(t *testing.T) {
	// Occupy the port first so the server cannot bind.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer l.Close()

	server := &nethttp.Server{
		Addr:    l.Addr().String(),
		Handler: nethttp.HandlerFunc(func(nethttp.ResponseWriter, *nethttp.Request) {}),
	}

	err = RunWithGracefulShutdown(context.Background(), server, DefaultShutdownTimeout)
	if err == nil {
		t.Fatal("expected error when the port is already in use")
	}
	if !strings.Contains(err.Error(), "address already in use") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestRunWithGracefulShutdown_TimesOutOnStuckRequests verifies that a hung
// in-flight request forces a timeout error instead of blocking forever.
func TestRunWithGracefulShutdown_TimesOutOnStuckRequests(t *testing.T) {
	release := make(chan struct{})
	server := newTestServer(t, nethttp.HandlerFunc(func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		<-release // hang until the test releases
		w.WriteHeader(nethttp.StatusOK)
	}))

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- RunWithGracefulShutdown(ctx, server, 100*time.Millisecond)
	}()

	if !waitUntilListening(t, server.Addr, 2*time.Second) {
		t.Fatal("server did not start listening")
	}

	// Open a connection that will hang inside the handler.
	reqDone := make(chan error, 1)
	go func() {
		resp, err := nethttp.Get("http://" + server.Addr + "/")
		if err == nil {
			resp.Body.Close()
		}
		reqDone <- err
	}()

	if !waitUntilListening(t, server.Addr, time.Second) {
		t.Fatal("server listener lost")
	}
	// Give the client time to reach the handler.
	time.Sleep(100 * time.Millisecond)

	cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected timeout error for stuck in-flight request")
		}
		if !strings.Contains(err.Error(), "graceful shutdown failed") {
			t.Fatalf("unexpected error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RunWithGracefulShutdown did not return after timeout")
	}

	close(release)
	<-reqDone
}

// ==================== GracefulShutdown ====================

// TestGracefulShutdown_DrainsInFlightRequests verifies that an active request
// that completes while the shutdown is pending is allowed to finish.
func TestGracefulShutdown_DrainsInFlightRequests(t *testing.T) {
	var served atomic.Int32
	server := newTestServer(t, nethttp.HandlerFunc(func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		time.Sleep(200 * time.Millisecond)
		served.Add(1)
		w.WriteHeader(nethttp.StatusOK)
	}))

	go func() {
		//nolint:errcheck // test server
		server.ListenAndServe()
	}()
	if !waitUntilListening(t, server.Addr, 2*time.Second) {
		t.Fatal("server did not start listening")
	}

	// Fire a slow request, then shut down while it is still in flight.
	reqDone := make(chan error, 1)
	go func() {
		resp, err := nethttp.Get("http://" + server.Addr + "/")
		if err == nil {
			resp.Body.Close()
		}
		reqDone <- err
	}()
	time.Sleep(50 * time.Millisecond)

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
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return true
		}
		if errors.Is(err, net.ErrClosed) {
			return false
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}
