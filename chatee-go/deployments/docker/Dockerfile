# Build stage
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build all services
ARG SERVICE
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/service ./services/${SERVICE}/cmd

# Runtime stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Set timezone
ENV TZ=UTC

# Create non-root user
RUN adduser -D -g '' appuser

# Copy binary from builder
COPY --from=builder /bin/service /bin/service

# Copy configs
COPY configs /configs

# Set ownership
RUN chown -R appuser:appuser /bin/service /configs

# Switch to non-root user
USER appuser

# Expose ports (will be overridden per service)
EXPOSE 8080 9090

# Default command
ENTRYPOINT ["/bin/service"]
