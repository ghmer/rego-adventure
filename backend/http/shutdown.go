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
	nethttp "net/http"
	"time"
)

// DefaultShutdownTimeout bounds how long in-flight requests may take to
// complete during a graceful shutdown before the server is closed forcibly.
const DefaultShutdownTimeout = 10 * time.Second

// Server timeout budget. The read and write timeouts bound the request
// lifecycle so slow clients (slowloris, slow bodies, stalled uploads)
// cannot hold connections and handlers indefinitely; IdleTimeout reaps
// keep-alive connections between requests.
//
// The clocks of one request and of one boot, and where each is set. They are
// independent values; changing one means re-checking the others against it.
//
//	clock                                    value   set in
//	------------------------------------------------------------------
//	request, headers only                    5s      shutdown.go
//	request, whole request including body    15s     shutdown.go
//	response write                           15s     shutdown.go
//	keep-alive connection between requests   120s    shutdown.go
//	graceful shutdown drain                  10s     shutdown.go, main.go
//	one solution verification                3s      quest.DefaultVerifyTimeout, used by Verify
//	OIDC discovery at boot                   10s     config/config.go
//	SPA request before it gives up           30s     services/api-service.js
//
// Interplay: the verify budget is the shortest handler bound and sits well
// inside the read and write windows, so a verifying request is answered long
// before the drain window matters. The drain bounds how long those per-request
// windows may still be finishing when the process is asked to stop. The SPA
// waits longer than any server-side window, so a request the server abandoned
// is reported by the browser as a client timeout instead of an open spinner.
// OIDC discovery runs before ListenAndServe and is not on a request path: its
// failure stops the process rather than a response.
const (
	// ServerReadTimeout bounds reading an entire request, including the body.
	ServerReadTimeout = 15 * time.Second
	// ServerWriteTimeout bounds writing the response.
	ServerWriteTimeout = 15 * time.Second
	// ServerIdleTimeout bounds how long an idle keep-alive connection is kept.
	ServerIdleTimeout = 120 * time.Second
	// ServerReadHeaderTimeout bounds reading the request headers only; it is
	// deliberately short to cut slowloris-style header dribbles early.
	ServerReadHeaderTimeout = 5 * time.Second
)

// NewServer returns a server configured with the production timeout
// budget, bound to addr. Shared by main and the shutdown tests so both
// exercise the same values.
func NewServer(addr string, handler nethttp.Handler) *nethttp.Server {
	return &nethttp.Server{
		Addr:              addr,
		Handler:           handler,
		ReadTimeout:       ServerReadTimeout,
		ReadHeaderTimeout: ServerReadHeaderTimeout,
		WriteTimeout:      ServerWriteTimeout,
		IdleTimeout:       ServerIdleTimeout,
	}
}

// GracefulShutdown shuts the server down without interrupting any active
// connections, waiting up to timeout for them to finish. It closes idle
// connections immediately.
func GracefulShutdown(server *nethttp.Server, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return server.Shutdown(ctx)
}

// RunOutcome says how a run of RunWithGracefulShutdown ended, so the process
// can say what actually stopped the server instead of claiming a drain that
// never happened.
type RunOutcome int

const (
	// OutcomeDrained means the context ended the run and in-flight requests
	// were given the drain window (a drain that timed out is an error).
	OutcomeDrained RunOutcome = iota
	// OutcomeServerEnded means ListenAndServe returned without any shutdown
	// being requested, so the server stopped rather than being stopped.
	OutcomeServerEnded
)

// RunWithGracefulShutdown starts the server and blocks until ctx is cancelled
// (e.g. by SIGTERM/SIGINT) or the server fails. On cancellation it drains
// active requests for up to timeout before returning nil. A server failure
// (including a listen error) is returned as-is. The outcome distinguishes the
// drain it performed from a ListenAndServe that ended by itself: that case
// reports no error, because ErrServerClosed is how the listener says it was
// closed, but it was not this function that closed it.
func RunWithGracefulShutdown(ctx context.Context, server *nethttp.Server, timeout time.Duration) (RunOutcome, error) {
	errCh := make(chan error, 1)
	go func() {
		// ErrServerClosed is reported as it comes; whether the stop was the
		// shutdown requested here is decided by which branch below wakes up.
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, nethttp.ErrServerClosed) {
			return OutcomeServerEnded, nil
		}
		return OutcomeServerEnded, err
	case <-ctx.Done():
		if err := GracefulShutdown(server, timeout); err != nil {
			return OutcomeDrained, fmt.Errorf("graceful shutdown failed: %w", err)
		}
		return OutcomeDrained, nil
	}
}
