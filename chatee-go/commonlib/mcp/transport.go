package mcp

import (
	"context"
)

// =============================================================================
// Transport Interfaces
// =============================================================================

// Transport defines the interface for MCP transports.
// MCP supports two main transport types:
// 1. stdio - Standard input/output for local process communication
// 2. http/httpstream - HTTP transport with optional SSE streaming
type Transport interface {
	// Connect establishes the connection.
	// For stdio: starts the process and establishes stdin/stdout pipes
	// For HTTP: validates the endpoint is reachable
	Connect(ctx context.Context) error

	// Send sends a request and returns the response.
	// For stdio: writes JSON-RPC request to stdin, reads response from stdout
	// For HTTP: sends POST request with JSON-RPC payload
	Send(ctx context.Context, request *JSONRPCRequest) (*JSONRPCResponse, error)

	// Close closes the connection.
	// For stdio: closes pipes and terminates the process
	// For HTTP: closes any persistent connections
	Close() error

	// IsConnected returns true if connected.
	IsConnected() bool
}
