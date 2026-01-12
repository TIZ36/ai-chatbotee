package mcp

import (
	"context"
	"fmt"
	"sync"
)

// =============================================================================
// MCP Server Manager
// =============================================================================

// Manager manages multiple MCP server connections.
// It handles:
// - Server configuration and lifecycle
// - Transport creation (stdio, HTTP, SSE)
// - Authentication (none, bearer token, OAuth)
// - Connection pooling and status tracking
type Manager struct {
	servers map[string]*ServerConnection
	mu      sync.RWMutex
}

// ServerConnection holds a connection to an MCP server.
type ServerConnection struct {
	Config ServerConfig
	Client *Client
	Status ConnectionStatus
}

// ServerConfig configures an MCP server connection.
type ServerConfig struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Type        TransportType     `json:"type"` // http, stdio, sse
	URL         string            `json:"url,omitempty"`
	Command     string            `json:"command,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	Auth        *AuthConfig       `json:"auth,omitempty"`
	AutoConnect bool              `json:"auto_connect"`
}

// NewManager creates a new MCP manager.
func NewManager() *Manager {
	return &Manager{
		servers: make(map[string]*ServerConnection),
	}
}

// AddServer adds a server configuration.
func (m *Manager) AddServer(config ServerConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.servers[config.ID]; exists {
		return fmt.Errorf("server %s already exists", config.ID)
	}

	m.servers[config.ID] = &ServerConnection{
		Config: config,
		Status: StatusDisconnected,
	}

	return nil
}

// RemoveServer removes a server.
func (m *Manager) RemoveServer(id string) error {
	m.mu.Lock()
	conn, exists := m.servers[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("server %s not found", id)
	}
	delete(m.servers, id)
	m.mu.Unlock()

	if conn.Client != nil {
		return conn.Client.Close()
	}
	return nil
}

// Connect connects to a server.
// Connection process:
// 1. Create transport based on config type (stdio or HTTP)
// 2. Handle authentication (add token to headers if bearer auth)
// 3. Create client with transport
// 4. Connect and initialize client
// 5. Update connection status
func (m *Manager) Connect(ctx context.Context, id string) error {
	m.mu.Lock()
	conn, exists := m.servers[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("server %s not found", id)
	}
	conn.Status = StatusConnecting
	m.mu.Unlock()

	// Create transport based on config
	transport, err := m.createTransport(conn.Config)
	if err != nil {
		m.mu.Lock()
		conn.Status = StatusError
		m.mu.Unlock()
		return err
	}

	// Create client
	client := NewClient(transport)

	// Connect and initialize
	clientInfo := map[string]string{
		"name":    "chatee",
		"version": "1.0.0",
	}

	_, err = client.Connect(ctx, clientInfo)
	if err != nil {
		m.mu.Lock()
		conn.Status = StatusError
		m.mu.Unlock()
		return err
	}

	m.mu.Lock()
	conn.Client = client
	conn.Status = StatusConnected
	m.mu.Unlock()

	return nil
}

// Disconnect disconnects from a server.
func (m *Manager) Disconnect(id string) error {
	m.mu.Lock()
	conn, exists := m.servers[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("server %s not found", id)
	}

	if conn.Client != nil {
		err := conn.Client.Close()
		conn.Client = nil
		conn.Status = StatusDisconnected
		m.mu.Unlock()
		return err
	}

	conn.Status = StatusDisconnected
	m.mu.Unlock()
	return nil
}

// createTransport creates a transport based on config.
// Transport types:
// - stdio: Creates StdioTransport for local process communication
// - http/sse: Creates HTTPTransport for HTTP/SSE communication
//
// Authentication handling:
// - No auth: Direct connection
// - Bearer token: Adds "Authorization: Bearer <token>" header
// - OAuth: Requires token exchange (not implemented in transport, handled by manager)
func (m *Manager) createTransport(config ServerConfig) (Transport, error) {
	switch config.Type {
	case TransportHTTP, TransportSSE:
		headers := make(map[string]string)
		// Copy existing headers
		for k, v := range config.Headers {
			headers[k] = v
		}

		// Add auth header if configured
		// Bearer token: Add Authorization header
		// No token: No additional headers
		if config.Auth != nil && config.Auth.Type == AuthBearer {
			headers["Authorization"] = "Bearer " + config.Auth.Token
		}

		return NewHTTPTransport(HTTPTransportConfig{
			BaseURL:   config.URL,
			Headers:   headers,
			EnableSSE: config.Type == TransportSSE,
		}), nil

	case TransportStdio:
		// Create stdio transport for local process
		return NewStdioTransport(StdioTransportConfig{
			Command: config.Command,
			Args:    config.Args,
			Env:     config.Env,
		}), nil

	default:
		return nil, fmt.Errorf("unknown transport type: %s", config.Type)
	}
}

// =============================================================================
// Tool Operations
// =============================================================================

// ListTools lists tools from a server.
func (m *Manager) ListTools(ctx context.Context, serverID string) ([]Tool, error) {
	client, err := m.getClient(serverID)
	if err != nil {
		return nil, err
	}
	return client.ListTools(ctx)
}

// CallTool calls a tool on a server.
func (m *Manager) CallTool(ctx context.Context, serverID, toolName string, args map[string]any) (*ToolResult, error) {
	client, err := m.getClient(serverID)
	if err != nil {
		return nil, err
	}
	return client.CallTool(ctx, toolName, args)
}

// ListAllTools lists tools from all connected servers.
func (m *Manager) ListAllTools(ctx context.Context) (map[string][]Tool, error) {
	m.mu.RLock()
	serverIDs := make([]string, 0, len(m.servers))
	for id, conn := range m.servers {
		if conn.Status == StatusConnected {
			serverIDs = append(serverIDs, id)
		}
	}
	m.mu.RUnlock()

	result := make(map[string][]Tool)
	for _, id := range serverIDs {
		tools, err := m.ListTools(ctx, id)
		if err != nil {
			continue
		}
		result[id] = tools
	}

	return result, nil
}

// =============================================================================
// Resource Operations
// =============================================================================

// ListResources lists resources from a server.
func (m *Manager) ListResources(ctx context.Context, serverID string) ([]Resource, error) {
	client, err := m.getClient(serverID)
	if err != nil {
		return nil, err
	}
	return client.ListResources(ctx)
}

// ReadResource reads a resource from a server.
func (m *Manager) ReadResource(ctx context.Context, serverID, uri string) ([]ToolContent, error) {
	client, err := m.getClient(serverID)
	if err != nil {
		return nil, err
	}
	return client.ReadResource(ctx, uri)
}

// =============================================================================
// Status Methods
// =============================================================================

// GetServer returns a server connection.
func (m *Manager) GetServer(id string) (*ServerConnection, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	conn, exists := m.servers[id]
	return conn, exists
}

// GetServers returns all servers.
func (m *Manager) GetServers() map[string]*ServerConnection {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make(map[string]*ServerConnection, len(m.servers))
	for k, v := range m.servers {
		result[k] = v
	}
	return result
}

// GetConnectedServers returns connected server IDs.
func (m *Manager) GetConnectedServers() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []string
	for id, conn := range m.servers {
		if conn.Status == StatusConnected {
			result = append(result, id)
		}
	}
	return result
}

// getClient returns a connected client.
func (m *Manager) getClient(serverID string) (*Client, error) {
	m.mu.RLock()
	conn, exists := m.servers[serverID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("server %s not found", serverID)
	}

	if conn.Status != StatusConnected || conn.Client == nil {
		return nil, fmt.Errorf("server %s not connected", serverID)
	}

	return conn.Client, nil
}

// ConnectAll connects to all servers that have AutoConnect enabled.
func (m *Manager) ConnectAll(ctx context.Context) error {
	m.mu.RLock()
	var serverIDs []string
	for id, conn := range m.servers {
		if conn.Config.AutoConnect {
			serverIDs = append(serverIDs, id)
		}
	}
	m.mu.RUnlock()

	var lastErr error
	for _, id := range serverIDs {
		if err := m.Connect(ctx, id); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

// DisconnectAll disconnects from all servers.
func (m *Manager) DisconnectAll() error {
	m.mu.RLock()
	var serverIDs []string
	for id := range m.servers {
		serverIDs = append(serverIDs, id)
	}
	m.mu.RUnlock()

	var lastErr error
	for _, id := range serverIDs {
		if err := m.Disconnect(id); err != nil {
			lastErr = err
		}
	}
	return lastErr
}
