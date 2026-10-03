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
// The verify endpoint's own evaluation budget is 3s (handlers.go), so
// ReadTimeout must cover reading a body within the 1 MiB limit and the
// handler running to completion; WriteTimeout must cover writing the
// response after that. Both leave headroom above DefaultShutdownTimeout
// only via separate dimensions: they apply per request, not to the drain.
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

// NewTestServer returns a server configured with the production timeout
// budget, bound to addr. Shared by main and the shutdown tests so both
// exercise the same values.
func NewTestServer(addr string, handler nethttp.Handler) *nethttp.Server {
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

// RunWithGracefulShutdown starts the server and blocks until ctx is cancelled
// (e.g. by SIGTERM/SIGINT) or the server fails. On cancellation it drains
// active requests for up to timeout before returning nil. A server failure
// (including a listen error) is returned as-is.
func RunWithGracefulShutdown(ctx context.Context, server *nethttp.Server, timeout time.Duration) error {
	errCh := make(chan error, 1)
	go func() {
		err := server.ListenAndServe()
		if err != nil && !errors.Is(err, nethttp.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		if err := GracefulShutdown(server, timeout); err != nil {
			return fmt.Errorf("graceful shutdown failed: %w", err)
		}
		return nil
	}
}
