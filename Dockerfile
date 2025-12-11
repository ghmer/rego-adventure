FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder

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
FROM alpine:latest

WORKDIR /app

# Install ca-certificates
RUN apk add --no-cache ca-certificates

# Copy the entire frontend directory
COPY frontend ./frontend

# Copy the binary
COPY --from=builder /app/bin/rego-adventure ./rego-adventure

# Ensure the binary is executable
RUN chmod +x rego-adventure

# Create a non-root user
RUN adduser -D -u 10001 appuser

# Set ownership of the application directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Set environment variables
ENV PORT=8080
ENV GIN_MODE=release

# Expose the port
EXPOSE 8080

# Run the application
CMD ["./rego-adventure"]