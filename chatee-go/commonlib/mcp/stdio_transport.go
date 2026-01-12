package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"sync/atomic"
)

// =============================================================================
// Stdio Transport
// =============================================================================

// StdioTransportConfig configures the stdio transport.
type StdioTransportConfig struct {
	Command string            // Command to execute
	Args    []string          // Command arguments
	Env     map[string]string // Environment variables
}

// StdioTransport implements Transport over stdio (standard input/output).
// This transport starts a local process and communicates via stdin/stdout.
// Each JSON-RPC message is sent as a single line (newline-delimited JSON).
type StdioTransport struct {
	config    StdioTransportConfig
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	connected atomic.Bool
	mu        sync.Mutex
	scanner   *bufio.Scanner
}

// NewStdioTransport creates a new stdio transport.
func NewStdioTransport(config StdioTransportConfig) *StdioTransport {
	return &StdioTransport{
		config: config,
	}
}

// Connect establishes the stdio connection by starting the process.
// Connection process:
// 1. Start the command as a subprocess
// 2. Establish stdin/stdout pipes
// 3. Start reading from stdout in a goroutine
func (t *StdioTransport) Connect(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.connected.Load() {
		return fmt.Errorf("already connected")
	}

	// Create command
	t.cmd = exec.CommandContext(ctx, t.config.Command, t.config.Args...)

	// Set environment variables
	if len(t.config.Env) > 0 {
		env := t.cmd.Environ()
		for k, v := range t.config.Env {
			env = append(env, fmt.Sprintf("%s=%s", k, v))
		}
		t.cmd.Env = env
	}

	// Get stdin pipe
	stdin, err := t.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	t.stdin = stdin

	// Get stdout pipe
	stdout, err := t.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	t.stdout = stdout

	// Start the process
	if err := t.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}

	// Create scanner for reading stdout
	t.scanner = bufio.NewScanner(t.stdout)

	t.connected.Store(true)
	return nil
}

// Send sends a JSON-RPC request over stdio.
// Process:
// 1. Marshal request to JSON
// 2. Write to stdin with newline delimiter
// 3. Read response from stdout (newline-delimited)
// 4. Unmarshal JSON response
func (t *StdioTransport) Send(ctx context.Context, request *JSONRPCRequest) (*JSONRPCResponse, error) {
	if !t.connected.Load() {
		return nil, fmt.Errorf("not connected")
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	// Marshal request
	data, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Write to stdin with newline delimiter
	// MCP stdio protocol: each message is a single line, newline-delimited JSON
	if _, err := t.stdin.Write(append(data, '\n')); err != nil {
		return nil, fmt.Errorf("failed to write to stdin: %w", err)
	}

	// Read response from stdout
	// Wait for next line (newline-delimited JSON)
	if !t.scanner.Scan() {
		if err := t.scanner.Err(); err != nil {
			return nil, fmt.Errorf("failed to read from stdout: %w", err)
		}
		return nil, fmt.Errorf("stdout closed unexpectedly")
	}

	line := t.scanner.Bytes()
	if len(line) == 0 {
		return nil, fmt.Errorf("empty response")
	}

	// Unmarshal response
	var response JSONRPCResponse
	if err := json.Unmarshal(line, &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return &response, nil
}

// Close closes the stdio connection.
// Process:
// 1. Close stdin pipe
// 2. Wait for process to terminate
// 3. Close stdout pipe
func (t *StdioTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if !t.connected.Load() {
		return nil
	}

	t.connected.Store(false)

	var errs []error

	// Close stdin
	if t.stdin != nil {
		if err := t.stdin.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close stdin: %w", err))
		}
	}

	// Wait for process to terminate
	if t.cmd != nil {
		if err := t.cmd.Wait(); err != nil {
			// Process may have already terminated, ignore if it's an exit error
			if _, ok := err.(*exec.ExitError); !ok {
				errs = append(errs, fmt.Errorf("process wait error: %w", err))
			}
		}
	}

	// Close stdout
	if t.stdout != nil {
		if err := t.stdout.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close stdout: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("close errors: %v", errs)
	}

	return nil
}

// IsConnected returns the connection status.
func (t *StdioTransport) IsConnected() bool {
	return t.connected.Load()
}
