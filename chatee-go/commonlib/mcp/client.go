package mcp

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
)

// =============================================================================
// MCP Client
// =============================================================================

// Client is an MCP client that communicates with MCP servers.
// Connection process:
// 1. Connect: Establish transport connection (stdio or HTTP)
// 2. Initialize: Send initialize request with client info and capabilities
// 3. Receive server info and capabilities
// 4. Send initialized notification
// 5. Load available tools/resources/prompts
type Client struct {
	transport  Transport
	serverInfo *ServerInfo
	tools      []Tool
	resources  []Resource
	prompts    []Prompt
	mu         sync.RWMutex
	requestID  atomic.Int64
}

// ClientConfig configures the MCP client.
type ClientConfig struct {
	Transport Transport
}

// NewClient creates a new MCP client.
func NewClient(transport Transport) *Client {
	return &Client{
		transport: transport,
	}
}

// Connect connects and initializes the client.
// Connection flow:
// 1. Establish transport connection (stdio starts process, HTTP validates endpoint)
// 2. Send initialize request with:
//   - protocolVersion: "2024-11-05"
//   - capabilities: client capabilities
//   - clientInfo: client name and version
//
// 3. Receive initialize response with server info
// 4. Send initialized notification
// 5. Load available tools if server supports them
func (c *Client) Connect(ctx context.Context, clientInfo map[string]string) (*ServerInfo, error) {
	// Step 1: Establish transport connection
	if err := c.transport.Connect(ctx); err != nil {
		return nil, err
	}

	// Step 2: Send initialize request
	resp, err := c.sendRequest(ctx, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo":      clientInfo,
	})
	if err != nil {
		return nil, err
	}

	// Step 3: Parse server info
	var serverInfo ServerInfo
	if err := json.Unmarshal(resp.Result, &serverInfo); err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.serverInfo = &serverInfo
	c.mu.Unlock()

	// Step 4: Send initialized notification
	// Notification failures are not critical
	_, err = c.sendRequest(ctx, "notifications/initialized", nil)
	if err != nil {
		// Log but don't fail
	}

	// Step 5: Load available tools if server supports them
	if serverInfo.Capabilities.Tools != nil {
		if tools, err := c.ListTools(ctx); err == nil {
			c.mu.Lock()
			c.tools = tools
			c.mu.Unlock()
		}
	}

	return &serverInfo, nil
}

// Close closes the client.
func (c *Client) Close() error {
	return c.transport.Close()
}

// sendRequest sends a JSON-RPC request.
func (c *Client) sendRequest(ctx context.Context, method string, params any) (*JSONRPCResponse, error) {
	id := c.requestID.Add(1)
	request := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	resp, err := c.transport.Send(ctx, request)
	if err != nil {
		return nil, err
	}

	if resp.Error != nil {
		return nil, resp.Error
	}

	return resp, nil
}

// =============================================================================
// Tool Operations
// =============================================================================

// ListTools lists available tools.
func (c *Client) ListTools(ctx context.Context) ([]Tool, error) {
	resp, err := c.sendRequest(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}

	var result struct {
		Tools []Tool `json:"tools"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, err
	}

	return result.Tools, nil
}

// CallTool calls a tool with arguments.
func (c *Client) CallTool(ctx context.Context, name string, arguments map[string]any) (*ToolResult, error) {
	resp, err := c.sendRequest(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": arguments,
	})
	if err != nil {
		return nil, err
	}

	var result ToolResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// =============================================================================
// Resource Operations
// =============================================================================

// ListResources lists available resources.
func (c *Client) ListResources(ctx context.Context) ([]Resource, error) {
	resp, err := c.sendRequest(ctx, "resources/list", nil)
	if err != nil {
		return nil, err
	}

	var result struct {
		Resources []Resource `json:"resources"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, err
	}

	return result.Resources, nil
}

// ReadResource reads a resource by URI.
func (c *Client) ReadResource(ctx context.Context, uri string) ([]ToolContent, error) {
	resp, err := c.sendRequest(ctx, "resources/read", map[string]any{
		"uri": uri,
	})
	if err != nil {
		return nil, err
	}

	var result struct {
		Contents []ToolContent `json:"contents"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, err
	}

	return result.Contents, nil
}

// =============================================================================
// Prompt Operations
// =============================================================================

// ListPrompts lists available prompts.
func (c *Client) ListPrompts(ctx context.Context) ([]Prompt, error) {
	resp, err := c.sendRequest(ctx, "prompts/list", nil)
	if err != nil {
		return nil, err
	}

	var result struct {
		Prompts []Prompt `json:"prompts"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, err
	}

	return result.Prompts, nil
}

// GetPrompt gets a prompt by name.
func (c *Client) GetPrompt(ctx context.Context, name string, arguments map[string]string) ([]map[string]any, error) {
	resp, err := c.sendRequest(ctx, "prompts/get", map[string]any{
		"name":      name,
		"arguments": arguments,
	})
	if err != nil {
		return nil, err
	}

	var result struct {
		Messages []map[string]any `json:"messages"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, err
	}

	return result.Messages, nil
}

// =============================================================================
// Utility Methods
// =============================================================================

// GetServerInfo returns the server info.
func (c *Client) GetServerInfo() *ServerInfo {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.serverInfo
}

// GetCachedTools returns cached tools.
func (c *Client) GetCachedTools() []Tool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.tools
}

// IsConnected returns true if connected.
func (c *Client) IsConnected() bool {
	return c.transport.IsConnected()
}
