package actor

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// ActionType - Types of actions in ActionChain
// =============================================================================

type ActionType string

const (
	// Response actions
	AG_ACCEPT      ActionType = "AG_ACCEPT"      // Accept and respond directly
	AG_REFUSE      ActionType = "AG_REFUSE"      // Refuse to answer
	AG_SELF_GEN    ActionType = "AG_SELF_GEN"    // Generate content from LLM
	AG_SELF_DECIDE ActionType = "AG_SELF_DECIDE" // AI decides next step

	// Tool/External actions
	AG_USE_MCP    ActionType = "AG_USE_MCP"    // Call MCP tool
	AG_CALL_AG    ActionType = "AG_CALL_AG"    // Call another agent
	AG_CALL_HUMAN ActionType = "AG_CALL_HUMAN" // Request human input
	AG_RAG        ActionType = "AG_RAG"        // RAG retrieval

	// Memory actions
	AG_MEMORY_LOAD  ActionType = "AG_MEMORY_LOAD"  // Load from memory
	AG_MEMORY_STORE ActionType = "AG_MEMORY_STORE" // Store to memory
)

// =============================================================================
// StepStatus - Status of an ActionStep
// =============================================================================

type StepStatus string

const (
	StepPending   StepStatus = "pending"
	StepRunning   StepStatus = "running"
	StepCompleted StepStatus = "completed"
	StepFailed    StepStatus = "failed"
	StepSkipped   StepStatus = "skipped"
)

// =============================================================================
// ChainStatus - Status of an ActionChain
// =============================================================================

type ChainStatus string

const (
	ChainPending   ChainStatus = "pending"
	ChainRunning   ChainStatus = "running"
	ChainCompleted ChainStatus = "completed"
	ChainFailed    ChainStatus = "failed"
	ChainAborted   ChainStatus = "aborted"
)

// =============================================================================
// ActionStep - A single step in the chain
// =============================================================================

// ActionStep represents a single action in the chain.
type ActionStep struct {
	ID          string         `json:"id"`
	Type        ActionType     `json:"type"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Params      map[string]any `json:"params,omitempty"`
	Status      StepStatus     `json:"status"`
	Result      *StepResult    `json:"result,omitempty"`
	StartTime   time.Time      `json:"start_time,omitempty"`
	EndTime     time.Time      `json:"end_time,omitempty"`
	RetryCount  int            `json:"retry_count"`
	MaxRetries  int            `json:"max_retries"`
}

// StepResult holds the result of an action step.
type StepResult struct {
	Success bool   `json:"success"`
	Data    any    `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
	Output  string `json:"output,omitempty"`
}

// Duration returns how long the step took.
func (s *ActionStep) Duration() time.Duration {
	if s.EndTime.IsZero() {
		return 0
	}
	return s.EndTime.Sub(s.StartTime)
}

// =============================================================================
// ActionChain - A chain of actions to execute
// =============================================================================

// ActionChain represents a sequence of actions to execute.
type ActionChain struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description,omitempty"`
	Status      ChainStatus   `json:"status"`
	Steps       []*ActionStep `json:"steps"`
	CurrentStep int           `json:"current_step"`
	Context     ChainContext  `json:"context,omitempty"`
	StartTime   time.Time     `json:"start_time,omitempty"`
	EndTime     time.Time     `json:"end_time,omitempty"`

	mu sync.RWMutex
}

// ChainContext holds context data passed through the chain.
type ChainContext struct {
	SessionID string         `json:"session_id,omitempty"`
	UserID    string         `json:"user_id,omitempty"`
	AgentID   string         `json:"agent_id,omitempty"`
	MessageID string         `json:"message_id,omitempty"`
	Input     string         `json:"input,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
	History   []StepHistory  `json:"history,omitempty"`
}

// StepHistory records the history of executed steps.
type StepHistory struct {
	StepID    string     `json:"step_id"`
	StepType  ActionType `json:"step_type"`
	Success   bool       `json:"success"`
	Output    string     `json:"output,omitempty"`
	Timestamp time.Time  `json:"timestamp"`
}

// NewActionChain creates a new action chain.
func NewActionChain(id, name string) *ActionChain {
	return &ActionChain{
		ID:     id,
		Name:   name,
		Status: ChainPending,
		Steps:  make([]*ActionStep, 0),
		Context: ChainContext{
			Data: make(map[string]any),
		},
	}
}

// AddStep adds a step to the chain.
func (c *ActionChain) AddStep(step *ActionStep) *ActionChain {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Steps = append(c.Steps, step)
	return c
}

// GetCurrentStep returns the current step.
func (c *ActionChain) GetCurrentStep() *ActionStep {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.CurrentStep >= len(c.Steps) {
		return nil
	}
	return c.Steps[c.CurrentStep]
}

// Advance moves to the next step.
func (c *ActionChain) Advance() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.CurrentStep++
	return c.CurrentStep < len(c.Steps)
}

// IsComplete returns true if all steps are done.
func (c *ActionChain) IsComplete() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.CurrentStep >= len(c.Steps)
}

// Duration returns how long the chain took.
func (c *ActionChain) Duration() time.Duration {
	if c.EndTime.IsZero() {
		return time.Since(c.StartTime)
	}
	return c.EndTime.Sub(c.StartTime)
}

// =============================================================================
// ChainBuilder - Fluent builder for ActionChain
// =============================================================================

// ChainBuilder provides a fluent interface for building chains.
type ChainBuilder struct {
	chain   *ActionChain
	stepIdx int
}

// NewChainBuilder creates a new chain builder.
func NewChainBuilder(id, name string) *ChainBuilder {
	return &ChainBuilder{
		chain: NewActionChain(id, name),
	}
}

// WithContext sets the chain context.
func (b *ChainBuilder) WithContext(ctx ChainContext) *ChainBuilder {
	b.chain.Context = ctx
	return b
}

// WithSession sets the session ID.
func (b *ChainBuilder) WithSession(sessionID string) *ChainBuilder {
	b.chain.Context.SessionID = sessionID
	return b
}

// WithUser sets the user ID.
func (b *ChainBuilder) WithUser(userID string) *ChainBuilder {
	b.chain.Context.UserID = userID
	return b
}

// WithAgent sets the agent ID.
func (b *ChainBuilder) WithAgent(agentID string) *ChainBuilder {
	b.chain.Context.AgentID = agentID
	return b
}

// WithInput sets the input message.
func (b *ChainBuilder) WithInput(input string) *ChainBuilder {
	b.chain.Context.Input = input
	return b
}

// AddStep adds a custom step.
func (b *ChainBuilder) AddStep(actionType ActionType, name string, params map[string]any) *ChainBuilder {
	b.stepIdx++
	step := &ActionStep{
		ID:     fmt.Sprintf("%s-step-%d", b.chain.ID, b.stepIdx),
		Type:   actionType,
		Name:   name,
		Params: params,
		Status: StepPending,
	}
	b.chain.AddStep(step)
	return b
}

// Think adds a self-generation step.
func (b *ChainBuilder) Think(prompt string) *ChainBuilder {
	return b.AddStep(AG_SELF_GEN, "Think", map[string]any{"prompt": prompt})
}

// Decide adds a decision step.
func (b *ChainBuilder) Decide(options []string) *ChainBuilder {
	return b.AddStep(AG_SELF_DECIDE, "Decide", map[string]any{"options": options})
}

// UseTool adds an MCP tool call step.
func (b *ChainBuilder) UseTool(serverID, toolName string, args map[string]any) *ChainBuilder {
	return b.AddStep(AG_USE_MCP, fmt.Sprintf("Call %s.%s", serverID, toolName), map[string]any{
		"server_id": serverID,
		"tool_name": toolName,
		"arguments": args,
	})
}

// CallAgent adds a call-another-agent step.
func (b *ChainBuilder) CallAgent(agentID string, message string) *ChainBuilder {
	return b.AddStep(AG_CALL_AG, fmt.Sprintf("Call Agent %s", agentID), map[string]any{
		"agent_id": agentID,
		"message":  message,
	})
}

// RAG adds a RAG retrieval step.
func (b *ChainBuilder) RAG(query string, topK int) *ChainBuilder {
	return b.AddStep(AG_RAG, "RAG Retrieval", map[string]any{
		"query": query,
		"top_k": topK,
	})
}

// LoadMemory adds a memory load step.
func (b *ChainBuilder) LoadMemory(keys []string) *ChainBuilder {
	return b.AddStep(AG_MEMORY_LOAD, "Load Memory", map[string]any{
		"keys": keys,
	})
}

// StoreMemory adds a memory store step.
func (b *ChainBuilder) StoreMemory(key string, value any) *ChainBuilder {
	return b.AddStep(AG_MEMORY_STORE, "Store Memory", map[string]any{
		"key":   key,
		"value": value,
	})
}

// Respond adds a direct response step.
func (b *ChainBuilder) Respond(content string) *ChainBuilder {
	return b.AddStep(AG_ACCEPT, "Respond", map[string]any{
		"content": content,
	})
}

// Build returns the built chain.
func (b *ChainBuilder) Build() *ActionChain {
	return b.chain
}

// =============================================================================
// ChainExecutor - Executes ActionChains
// =============================================================================

// StepHandler handles a specific action type.
type StepHandler func(ctx context.Context, chain *ActionChain, step *ActionStep) (*StepResult, error)

// ChainExecutor executes action chains.
type ChainExecutor struct {
	handlers map[ActionType]StepHandler
	mu       sync.RWMutex

	// Callbacks
	OnStepStart     func(chain *ActionChain, step *ActionStep)
	OnStepComplete  func(chain *ActionChain, step *ActionStep, result *StepResult)
	OnChainStart    func(chain *ActionChain)
	OnChainComplete func(chain *ActionChain)
}

// NewChainExecutor creates a new chain executor.
func NewChainExecutor() *ChainExecutor {
	return &ChainExecutor{
		handlers: make(map[ActionType]StepHandler),
	}
}

// RegisterHandler registers a handler for an action type.
func (e *ChainExecutor) RegisterHandler(actionType ActionType, handler StepHandler) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.handlers[actionType] = handler
}

// Execute runs the entire chain.
func (e *ChainExecutor) Execute(ctx context.Context, chain *ActionChain) error {
	chain.mu.Lock()
	chain.Status = ChainRunning
	chain.StartTime = time.Now()
	chain.mu.Unlock()

	if e.OnChainStart != nil {
		e.OnChainStart(chain)
	}

	defer func() {
		chain.mu.Lock()
		chain.EndTime = time.Now()
		chain.mu.Unlock()

		if e.OnChainComplete != nil {
			e.OnChainComplete(chain)
		}
	}()

	for !chain.IsComplete() {
		step := chain.GetCurrentStep()
		if step == nil {
			break
		}

		// Check context cancellation
		select {
		case <-ctx.Done():
			chain.mu.Lock()
			chain.Status = ChainAborted
			chain.mu.Unlock()
			return ctx.Err()
		default:
		}

		// Execute step
		if err := e.executeStep(ctx, chain, step); err != nil {
			chain.mu.Lock()
			chain.Status = ChainFailed
			chain.mu.Unlock()
			return err
		}

		// Record history
		chain.mu.Lock()
		chain.Context.History = append(chain.Context.History, StepHistory{
			StepID:    step.ID,
			StepType:  step.Type,
			Success:   step.Result != nil && step.Result.Success,
			Output:    step.Result.Output,
			Timestamp: time.Now(),
		})
		chain.mu.Unlock()

		// Advance to next step
		chain.Advance()
	}

	chain.mu.Lock()
	chain.Status = ChainCompleted
	chain.mu.Unlock()

	return nil
}

// executeStep executes a single step.
func (e *ChainExecutor) executeStep(ctx context.Context, chain *ActionChain, step *ActionStep) error {
	e.mu.RLock()
	handler, exists := e.handlers[step.Type]
	e.mu.RUnlock()

	if !exists {
		step.Status = StepFailed
		step.Result = &StepResult{
			Success: false,
			Error:   fmt.Sprintf("no handler for action type: %s", step.Type),
		}
		return fmt.Errorf("no handler for action type: %s", step.Type)
	}

	step.Status = StepRunning
	step.StartTime = time.Now()

	if e.OnStepStart != nil {
		e.OnStepStart(chain, step)
	}

	result, err := handler(ctx, chain, step)
	step.EndTime = time.Now()

	if err != nil {
		step.Status = StepFailed
		step.Result = &StepResult{
			Success: false,
			Error:   err.Error(),
		}

		// Retry logic
		if step.RetryCount < step.MaxRetries {
			step.RetryCount++
			return e.executeStep(ctx, chain, step)
		}

		return err
	}

	step.Status = StepCompleted
	step.Result = result

	if e.OnStepComplete != nil {
		e.OnStepComplete(chain, step, result)
	}

	return nil
}
