package actor

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// AIAgentActor - AI Agent Actor implementation
// =============================================================================

// AIAgentActor represents an AI agent that processes messages using ActionChains.
type AIAgentActor struct {
	id       string
	persona  *Persona
	executor *ChainExecutor
	state    AgentState
	mu       sync.RWMutex

	// Dependencies (injected)
	LLMProvider  LLMProvider
	MCPManager   MCPManager
	MemoryStore  MemoryStore
	RAGRetriever RAGRetriever

	// Callbacks
	OnChainCreated   func(chain *ActionChain)
	OnChainCompleted func(chain *ActionChain)
	OnMessageSent    func(msg *AgentMessage)
}

// Persona defines the AI agent's personality and capabilities.
type Persona struct {
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	SystemPrompt string            `json:"system_prompt"`
	Model        string            `json:"model"`
	Provider     string            `json:"provider"`
	Temperature  float64           `json:"temperature"`
	MaxTokens    int               `json:"max_tokens"`
	Voice        *VoiceConfig      `json:"voice,omitempty"`
	Memory       *MemoryConfig     `json:"memory,omitempty"`
	MCPServers   []string          `json:"mcp_servers,omitempty"`
	Capabilities []string          `json:"capabilities,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// VoiceConfig defines voice settings for the agent.
type VoiceConfig struct {
	Enabled bool    `json:"enabled"`
	VoiceID string  `json:"voice_id"`
	Speed   float64 `json:"speed"`
	Pitch   float64 `json:"pitch"`
}

// MemoryConfig defines memory settings for the agent.
type MemoryConfig struct {
	Enabled     bool `json:"enabled"`
	MaxHistory  int  `json:"max_history"`
	UseLongTerm bool `json:"use_long_term"`
}

// AgentState represents the current state of the agent.
type AgentState struct {
	Status       string                  `json:"status"`
	ActiveChains map[string]*ActionChain `json:"active_chains"`
	LastActivity time.Time               `json:"last_activity"`
	MessageCount int64                   `json:"message_count"`
}

// =============================================================================
// Message Types
// =============================================================================

// AgentMessage represents a message to/from the agent.
type AgentMessage struct {
	BaseMessage
	SessionID string `json:"session_id"`
	Role      string `json:"role"` // user, assistant, system
	Content   string `json:"content"`
	UserID    string `json:"user_id,omitempty"`
}

func (m *AgentMessage) Type() string {
	return "agent_message"
}

// ChainResultMessage contains the result of an action chain.
type ChainResultMessage struct {
	BaseMessage
	ChainID  string        `json:"chain_id"`
	Status   ChainStatus   `json:"status"`
	Result   string        `json:"result"`
	Duration time.Duration `json:"duration"`
}

func (m *ChainResultMessage) Type() string {
	return "chain_result"
}

// =============================================================================
// Dependency Interfaces
// =============================================================================

// LLMProvider provides LLM capabilities.
type LLMProvider interface {
	Chat(ctx context.Context, messages []LLMMessage, opts LLMOptions) (*LLMResponse, error)
	ChatStream(ctx context.Context, messages []LLMMessage, opts LLMOptions) (<-chan LLMStreamEvent, error)
}

// LLMMessage represents a message for the LLM.
type LLMMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// LLMOptions contains options for LLM calls.
type LLMOptions struct {
	Model       string   `json:"model"`
	Temperature float64  `json:"temperature"`
	MaxTokens   int      `json:"max_tokens"`
	Tools       []Tool   `json:"tools,omitempty"`
	StopWords   []string `json:"stop_words,omitempty"`
}

// LLMResponse contains the LLM response.
type LLMResponse struct {
	Content      string     `json:"content"`
	ToolCalls    []ToolCall `json:"tool_calls,omitempty"`
	FinishReason string     `json:"finish_reason"`
	Usage        TokenUsage `json:"usage"`
}

// LLMStreamEvent is an event from streaming LLM response.
type LLMStreamEvent struct {
	Type     string    `json:"type"`
	Content  string    `json:"content,omitempty"`
	ToolCall *ToolCall `json:"tool_call,omitempty"`
	Done     bool      `json:"done"`
	Error    error     `json:"error,omitempty"`
}

// Tool represents an available tool.
type Tool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"input_schema"`
}

// ToolCall represents a tool call request.
type ToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

// TokenUsage tracks token usage.
type TokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// MCPManager manages MCP server connections and tool calls.
type MCPManager interface {
	ListTools(ctx context.Context, serverID string) ([]Tool, error)
	CallTool(ctx context.Context, serverID, toolName string, args map[string]any) (any, error)
}

// MemoryStore provides memory storage capabilities.
type MemoryStore interface {
	Load(ctx context.Context, agentID string, keys []string) (map[string]any, error)
	Store(ctx context.Context, agentID string, key string, value any) error
}

// RAGRetriever provides RAG retrieval capabilities.
type RAGRetriever interface {
	Retrieve(ctx context.Context, query string, topK int) ([]RAGDocument, error)
}

// RAGDocument represents a retrieved document.
type RAGDocument struct {
	ID       string         `json:"id"`
	Content  string         `json:"content"`
	Score    float64        `json:"score"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// =============================================================================
// AIAgentActor Implementation
// =============================================================================

// NewAIAgentActor creates a new AI agent actor.
func NewAIAgentActor(id string, persona *Persona) *AIAgentActor {
	agent := &AIAgentActor{
		id:       id,
		persona:  persona,
		executor: NewChainExecutor(),
		state: AgentState{
			Status:       "idle",
			ActiveChains: make(map[string]*ActionChain),
			LastActivity: time.Now(),
		},
	}

	// Register default handlers
	agent.registerDefaultHandlers()

	return agent
}

// registerDefaultHandlers sets up the default action handlers.
func (a *AIAgentActor) registerDefaultHandlers() {
	// AG_SELF_GEN - Generate content using LLM
	a.executor.RegisterHandler(AG_SELF_GEN, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		if a.LLMProvider == nil {
			return nil, fmt.Errorf("LLM provider not configured")
		}

		prompt, _ := step.Params["prompt"].(string)
		messages := []LLMMessage{
			{Role: "system", Content: a.persona.SystemPrompt},
			{Role: "user", Content: prompt},
		}

		resp, err := a.LLMProvider.Chat(ctx, messages, LLMOptions{
			Model:       a.persona.Model,
			Temperature: a.persona.Temperature,
			MaxTokens:   a.persona.MaxTokens,
		})
		if err != nil {
			return nil, err
		}

		return &StepResult{
			Success: true,
			Output:  resp.Content,
			Data:    resp,
		}, nil
	})

	// AG_SELF_DECIDE - AI decides next action
	a.executor.RegisterHandler(AG_SELF_DECIDE, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		// Get decision options
		options, _ := step.Params["options"].([]string)

		// Build decision prompt
		prompt := fmt.Sprintf("Based on the context, decide which action to take from these options: %v\n\nContext: %s\n\nRespond with ONLY the chosen option.", options, chain.Context.Input)

		messages := []LLMMessage{
			{Role: "system", Content: "You are a decision-making assistant. Analyze the context and choose the best option."},
			{Role: "user", Content: prompt},
		}

		resp, err := a.LLMProvider.Chat(ctx, messages, LLMOptions{
			Model:       a.persona.Model,
			Temperature: 0.1, // Low temperature for decisions
			MaxTokens:   50,
		})
		if err != nil {
			return nil, err
		}

		return &StepResult{
			Success: true,
			Output:  resp.Content,
			Data:    map[string]any{"decision": resp.Content},
		}, nil
	})

	// AG_USE_MCP - Call MCP tool
	a.executor.RegisterHandler(AG_USE_MCP, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		if a.MCPManager == nil {
			return nil, fmt.Errorf("MCP manager not configured")
		}

		serverID, _ := step.Params["server_id"].(string)
		toolName, _ := step.Params["tool_name"].(string)
		args, _ := step.Params["arguments"].(map[string]any)

		result, err := a.MCPManager.CallTool(ctx, serverID, toolName, args)
		if err != nil {
			return nil, err
		}

		return &StepResult{
			Success: true,
			Data:    result,
			Output:  fmt.Sprintf("%v", result),
		}, nil
	})

	// AG_RAG - RAG retrieval
	a.executor.RegisterHandler(AG_RAG, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		if a.RAGRetriever == nil {
			return nil, fmt.Errorf("RAG retriever not configured")
		}

		query, _ := step.Params["query"].(string)
		topK := 5
		if k, ok := step.Params["top_k"].(int); ok {
			topK = k
		}

		docs, err := a.RAGRetriever.Retrieve(ctx, query, topK)
		if err != nil {
			return nil, err
		}

		// Combine documents into context
		var combined string
		for _, doc := range docs {
			combined += doc.Content + "\n\n"
		}

		return &StepResult{
			Success: true,
			Data:    docs,
			Output:  combined,
		}, nil
	})

	// AG_MEMORY_LOAD - Load from memory
	a.executor.RegisterHandler(AG_MEMORY_LOAD, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		if a.MemoryStore == nil {
			return nil, fmt.Errorf("memory store not configured")
		}

		keys, _ := step.Params["keys"].([]string)
		data, err := a.MemoryStore.Load(ctx, a.id, keys)
		if err != nil {
			return nil, err
		}

		return &StepResult{
			Success: true,
			Data:    data,
		}, nil
	})

	// AG_MEMORY_STORE - Store to memory
	a.executor.RegisterHandler(AG_MEMORY_STORE, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		if a.MemoryStore == nil {
			return nil, fmt.Errorf("memory store not configured")
		}

		key, _ := step.Params["key"].(string)
		value := step.Params["value"]

		err := a.MemoryStore.Store(ctx, a.id, key, value)
		if err != nil {
			return nil, err
		}

		return &StepResult{
			Success: true,
		}, nil
	})

	// AG_ACCEPT - Direct response
	a.executor.RegisterHandler(AG_ACCEPT, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		content, _ := step.Params["content"].(string)
		return &StepResult{
			Success: true,
			Output:  content,
		}, nil
	})

	// AG_REFUSE - Refuse to answer
	a.executor.RegisterHandler(AG_REFUSE, func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error) {
		reason, _ := step.Params["reason"].(string)
		if reason == "" {
			reason = "I'm sorry, I can't help with that request."
		}
		return &StepResult{
			Success: true,
			Output:  reason,
		}, nil
	})
}

// Receive handles incoming messages.
func (a *AIAgentActor) Receive(ctx context.Context, msg Message) error {
	a.mu.Lock()
	a.state.LastActivity = time.Now()
	a.state.MessageCount++
	a.mu.Unlock()

	switch m := msg.(type) {
	case *AgentMessage:
		return a.handleAgentMessage(ctx, m)
	default:
		return fmt.Errorf("unknown message type: %T", msg)
	}
}

// handleAgentMessage processes an agent message.
func (a *AIAgentActor) handleAgentMessage(ctx context.Context, msg *AgentMessage) error {
	// Create action chain for this message
	chainID := fmt.Sprintf("chain-%s-%d", msg.SessionID, time.Now().UnixNano())

	chain := NewChainBuilder(chainID, "ProcessMessage").
		WithSession(msg.SessionID).
		WithUser(msg.UserID).
		WithAgent(a.id).
		WithInput(msg.Content).
		Think(msg.Content). // Generate response
		Build()

	// Store active chain
	a.mu.Lock()
	a.state.Status = "processing"
	a.state.ActiveChains[chainID] = chain
	a.mu.Unlock()

	if a.OnChainCreated != nil {
		a.OnChainCreated(chain)
	}

	// Execute chain
	err := a.executor.Execute(ctx, chain)

	// Clean up
	a.mu.Lock()
	delete(a.state.ActiveChains, chainID)
	if len(a.state.ActiveChains) == 0 {
		a.state.Status = "idle"
	}
	a.mu.Unlock()

	if a.OnChainCompleted != nil {
		a.OnChainCompleted(chain)
	}

	return err
}

// OnStart is called when the actor starts.
func (a *AIAgentActor) OnStart(ctx context.Context) error {
	a.mu.Lock()
	a.state.Status = "active"
	a.mu.Unlock()
	return nil
}

// OnStop is called when the actor stops.
func (a *AIAgentActor) OnStop(ctx context.Context) error {
	a.mu.Lock()
	a.state.Status = "stopped"
	a.mu.Unlock()
	return nil
}

// GetState returns the current agent state.
func (a *AIAgentActor) GetState() AgentState {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.state
}

// GetPersona returns the agent's persona.
func (a *AIAgentActor) GetPersona() *Persona {
	return a.persona
}

// ExecuteChain executes a custom action chain.
func (a *AIAgentActor) ExecuteChain(ctx context.Context, chain *ActionChain) error {
	a.mu.Lock()
	a.state.ActiveChains[chain.ID] = chain
	a.mu.Unlock()

	err := a.executor.Execute(ctx, chain)

	a.mu.Lock()
	delete(a.state.ActiveChains, chain.ID)
	a.mu.Unlock()

	return err
}
