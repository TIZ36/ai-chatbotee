package llm

import (
	"context"
	"strings"
	"sync"
)

// =============================================================================
// LLM Provider Interface
// =============================================================================

// Provider is the interface for LLM providers.
type Provider interface {
	// Name returns the provider name.
	Name() string
	// Chat sends a chat completion request.
	Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error)
	// ChatStream sends a streaming chat completion request.
	ChatStream(ctx context.Context, req *ChatRequest) (<-chan StreamEvent, error)
	// ListModels lists available models.
	ListModels(ctx context.Context) ([]ModelInfo, error)
	// CountTokens counts tokens in the messages.
	CountTokens(ctx context.Context, messages []Message) (int, error)
}

// =============================================================================
// Common Types
// =============================================================================

// Message represents a chat message.
type Message struct {
	Role       string     `json:"role"` // system, user, assistant, tool
	Content    string     `json:"content"`
	Name       string     `json:"name,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// ToolCall represents a tool call.
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"` // function
	Function FunctionCall `json:"function"`
}

// FunctionCall represents a function call.
type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// Tool represents an available tool.
type Tool struct {
	Type     string      `json:"type"` // function
	Function FunctionDef `json:"function"`
}

// FunctionDef defines a function.
type FunctionDef struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"` // JSON Schema
}

// ChatRequest represents a chat completion request.
type ChatRequest struct {
	Model       string         `json:"model"`
	Messages    []Message      `json:"messages"`
	Tools       []Tool         `json:"tools,omitempty"`
	Temperature *float64       `json:"temperature,omitempty"`
	MaxTokens   *int           `json:"max_tokens,omitempty"`
	TopP        *float64       `json:"top_p,omitempty"`
	Stop        []string       `json:"stop,omitempty"`
	Stream      bool           `json:"stream,omitempty"`
	Options     map[string]any `json:"options,omitempty"` // Provider-specific options
}

// ChatResponse represents a chat completion response.
type ChatResponse struct {
	ID           string  `json:"id"`
	Model        string  `json:"model"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"` // stop, length, tool_calls
	Usage        Usage   `json:"usage"`
}

// Usage represents token usage.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// StreamEvent represents a streaming event.
type StreamEvent struct {
	Type         string    `json:"type"` // content, tool_call, done, error
	Delta        string    `json:"delta,omitempty"`
	ToolCall     *ToolCall `json:"tool_call,omitempty"`
	FinishReason string    `json:"finish_reason,omitempty"`
	Error        error     `json:"error,omitempty"`
}

// ModelInfo represents model information.
type ModelInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	ContextSize int    `json:"context_size,omitempty"`
	MaxOutput   int    `json:"max_output,omitempty"`
}

// ProviderConfig is a generic provider configuration.
type ProviderConfig struct {
	Type    string            `json:"type"` // openai, anthropic, deepseek, etc.
	APIKey  string            `json:"api_key"`
	BaseURL string            `json:"base_url,omitempty"`
	Options map[string]string `json:"options,omitempty"`
}

// =============================================================================
// Provider Registry
// =============================================================================

// Registry manages LLM providers.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

// NewRegistry creates a new provider registry.
func NewRegistry() *Registry {
	return &Registry{
		providers: make(map[string]Provider),
	}
}

// Register registers a provider.
func (r *Registry) Register(name string, provider Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[strings.ToLower(name)] = provider
}

// Get returns a provider by name.
func (r *Registry) Get(name string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[strings.ToLower(name)]
	return p, ok
}

// List returns all registered provider names.
func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.providers))
	for name := range r.providers {
		names = append(names, name)
	}
	return names
}
