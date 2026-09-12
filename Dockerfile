FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go module files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build for target architecture
ARG TARGETOS TARGETARCH
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags "-s -w" -trimpath -o bin/rego-adventure .

# Final stage
FROM alpine:3.24

WORKDIR /app

# Runtime dependencies and the non-root user in one layer; the fixed UID
# keeps ownership metadata stable across rebuilds.
RUN apk add --no-cache ca-certificates \
    && adduser -D -u 10001 appuser

# Copy the entire frontend directory, owned by the runtime user.
# The app only reads these files, so no post-copy chown layer is needed.
COPY --chown=appuser:appuser frontend ./frontend

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

# Health check against the public /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://localhost:8080/health || exit 1

# Run the application
CMD ["./rego-adventure"]