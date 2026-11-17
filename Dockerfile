FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go module files
COPY go.mod go.sum ./
RUN go mod download

# Copy the source and resolve the frontend's browser libraries: vendorgen
# extracts the files the lockfile pins (integrity-verified) into
# frontend/adventure/vendor, and importmapgen's manifest mode rewires the
# import map to those same-origin files. The release image serves without
# any runtime network dependency; only the builder stage downloads.
COPY . .
RUN go run ./cmd/vendorgen -pkg frontend/adventure/package.json \
    && go run ./cmd/importmapgen -pkgPath frontend/adventure/package.json \
       -indexPath frontend/adventure/index.html \
       -manifest frontend/adventure/vendor/manifest.json

# Prune the development-only files the frontend ships with but that have no
# part in a release: the vitest suites and their config, and the npm
# postinstall hook that resolves the vendored tree (this image has no Node
# runtime - the vendored files above are that hook's resolved result).
# Nothing at runtime reads them, and the server would serve them as plain
# static modules. package.json and its lockfile stay: they are the reviewed
# dependency surface the vendored tree derives from, and keeping them lets
# SBOM and audit tooling read the image itself. rmdir fails if scripts/ ever
# gains a second file, which is the signal to revisit this list.
RUN find frontend/adventure -name '*.test.js' -delete \
    && rm -f frontend/adventure/vitest.config.mjs \
             frontend/adventure/scripts/vendor.cjs \
    && rmdir frontend/adventure/scripts

# Build for target architecture
ARG TARGETOS TARGETARCH
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags "-s -w" -trimpath -o bin/rego-adventure .

# Final stage
FROM alpine:3.24

WORKDIR /app

# Runtime dependencies and the non-root user in one layer; the fixed UID
# keeps ownership metadata stable across rebuilds.
# busybox adduser leaves the empty home directory 2755 (setgid plus world
# readable); 700 keeps it private to the account that never receives a file.
RUN apk add --no-cache ca-certificates \
    && adduser -D -u 10001 appuser \
    && chmod 700 /home/appuser

# Copy the frontend from the builder, where the vendored libraries were
# resolved and the import map was rewritten to the local files. The image is
# self-contained: nothing under frontend/ downloads anything at runtime.
COPY --from=builder --chown=appuser:appuser /app/frontend ./frontend

# Copy the binary. go build emits a mode-0755 executable, so no chmod
# layer is needed either.
COPY --from=builder --chown=appuser:appuser /app/bin/rego-adventure ./rego-adventure

# Switch to non-root user
USER appuser

# Set environment variables
ENV PORT=8080
ENV GIN_MODE=release

# Expose the port
EXPOSE 8080

# Health check against the public /health endpoint; shell form so a
# non-default PORT is honored (falls back to the documented default 8080).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- "http://localhost:${PORT:-8080}/health" || exit 1

# Run the application
CMD ["./rego-adventure"]