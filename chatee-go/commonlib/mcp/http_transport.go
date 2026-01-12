package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// =============================================================================
// HTTP/SSE Transport
// =============================================================================

// HTTPTransportConfig configures the HTTP transport.
type HTTPTransportConfig struct {
	BaseURL   string            // Base URL for the MCP server
	Headers   map[string]string // Additional HTTP headers
	Timeout   time.Duration     // Request timeout
	EnableSSE bool              // Enable Server-Sent Events for streaming
}

// HTTPTransport implements Transport over HTTP with optional SSE for streaming.
// Connection process:
// 1. For HTTP: validates endpoint is reachable (GET request)
// 2. For requests: sends POST with JSON-RPC payload
// 3. For SSE: streams responses via text/event-stream
//
// Authentication:
// - No token: direct connection
// - Bearer token: Authorization header with "Bearer <token>"
// - OAuth: requires token exchange first (handled by manager)
type HTTPTransport struct {
	baseURL    string
	headers    map[string]string
	httpClient *http.Client
	connected  atomic.Bool
	mu         sync.Mutex
}

// NewHTTPTransport creates a new HTTP transport.
func NewHTTPTransport(config HTTPTransportConfig) *HTTPTransport {
	timeout := config.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	return &HTTPTransport{
		baseURL: config.BaseURL,
		headers: config.Headers,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

// Connect establishes the HTTP connection (validates endpoint).
// For HTTP, we just validate the endpoint is reachable.
// No token: simple GET request
// With token: GET request with Authorization header
func (t *HTTPTransport) Connect(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.connected.Load() {
		return nil // Already connected
	}

	// Create a simple GET request to validate the endpoint
	req, err := http.NewRequestWithContext(ctx, "GET", t.baseURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers (including auth if configured)
	for k, v := range t.headers {
		req.Header.Set(k, v)
	}

	// Send request
	resp, err := t.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer resp.Body.Close()

	// Accept any 2xx status code
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(body))
	}

	t.connected.Store(true)
	return nil
}

// Send sends a JSON-RPC request over HTTP.
// Process:
// 1. Marshal request to JSON
// 2. Create POST request with JSON body
// 3. Set headers (Content-Type, Authorization if token provided)
// 4. Send request and read response
// 5. Unmarshal JSON-RPC response
func (t *HTTPTransport) Send(ctx context.Context, request *JSONRPCRequest) (*JSONRPCResponse, error) {
	if !t.connected.Load() {
		return nil, fmt.Errorf("not connected")
	}

	// Marshal request
	body, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create POST request
	req, err := http.NewRequestWithContext(ctx, "POST", t.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	for k, v := range t.headers {
		req.Header.Set(k, v)
	}

	// Send request
	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// Check status code
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(body))
	}

	// Decode response
	var response JSONRPCResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}

// SendWithSSE sends a request and receives SSE stream.
// This is used for streaming responses (e.g., tool calls with progress).
// Process:
// 1. Send POST request with Accept: text/event-stream
// 2. Read SSE stream (data: <json> format)
// 3. Parse each event as JSON-RPC response
// 4. Return channel of responses
func (t *HTTPTransport) SendWithSSE(ctx context.Context, request *JSONRPCRequest) (<-chan *JSONRPCResponse, error) {
	if !t.connected.Load() {
		return nil, fmt.Errorf("not connected")
	}

	// Marshal request
	body, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create POST request
	req, err := http.NewRequestWithContext(ctx, "POST", t.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers for SSE
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	for k, v := range t.headers {
		req.Header.Set(k, v)
	}

	// Send request
	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(body))
	}

	// Create response channel
	ch := make(chan *JSONRPCResponse, 100)

	// Read SSE stream in goroutine
	go func() {
		defer resp.Body.Close()
		defer close(ch)

		reader := bufio.NewReader(resp.Body)
		for {
			select {
			case <-ctx.Done():
				return
			default:
				line, err := reader.ReadString('\n')
				if err != nil {
					if err != io.EOF {
						// Send error response
						ch <- &JSONRPCResponse{
							Error: &JSONRPCError{Code: -1, Message: err.Error()},
						}
					}
					return
				}

				// Parse SSE format: "data: <json>\n"
				if len(line) > 6 && line[:6] == "data: " {
					data := line[6:]
					var response JSONRPCResponse
					if err := json.Unmarshal([]byte(data), &response); err == nil {
						ch <- &response
					}
				}
			}
		}
	}()

	return ch, nil
}

// Close closes the transport.
func (t *HTTPTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.connected.Store(false)
	return nil
}

// IsConnected returns the connection status.
func (t *HTTPTransport) IsConnected() bool {
	return t.connected.Load()
}
