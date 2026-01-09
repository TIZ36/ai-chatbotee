package agent

import (
	"context"
	"fmt"
	"sync"
	"time"

	"chatee-go/commonlib/actor"
	"chatee-go/commonlib/snowflake"
)

// ChainManager manages ActionChain execution
type ChainManager struct {
	svc      *agentmod.Service
	chains   map[string]*ChainExecution
	mu       sync.RWMutex
	executor *actor.ChainExecutor
}

// ChainExecution tracks a running chain
type ChainExecution struct {
	ID        string
	AgentID   string
	SessionID string
	Chain     *actor.ActionChain
	Context   *actor.ChainContext
	Status    ChainStatus
	StartTime time.Time
	EndTime   time.Time
	Steps     []ChainStepResult
	Error     string
}

// ChainStatus represents the status of a chain
type ChainStatus string

const (
	ChainStatusPending   ChainStatus = "pending"
	ChainStatusRunning   ChainStatus = "running"
	ChainStatusCompleted ChainStatus = "completed"
	ChainStatusFailed    ChainStatus = "failed"
	ChainStatusCancelled ChainStatus = "cancelled"
)

// NewChainManager creates a new chain manager
func NewChainManager(svc *Service) *ChainManager {
	cm := &ChainManager{
		svc:    svc,
		chains: make(map[string]*ChainExecution),
	}
	cm.executor = cm.createExecutor()
	return cm
}

// Execute executes an ActionChain
func (cm *ChainManager) Execute(ctx context.Context, req *ExecuteChainRequest) (*ExecuteChainResponse, error) {
	// Generate chain ID if not provided
	chainID := req.ChainID
	if chainID == "" {
		chainID = snowflake.GenerateTypedID("chn")
	}

	// Build the chain from steps
	chain, err := cm.buildChain(req.Steps)
	if err != nil {
		return nil, fmt.Errorf("failed to build chain: %w", err)
	}

	// Create chain context
	chainCtx := &actor.ChainContext{
		Context:   ctx,
		AgentID:   req.AgentID,
		SessionID: req.SessionID,
		Variables: req.Input,
		History:   make([]actor.StepHistory, 0),
	}

	// Create execution record
	execution := &ChainExecution{
		ID:        chainID,
		AgentID:   req.AgentID,
		SessionID: req.SessionID,
		Chain:     chain,
		Context:   chainCtx,
		Status:    ChainStatusPending,
		StartTime: time.Now(),
		Steps:     make([]ChainStepResult, 0),
	}

	cm.mu.Lock()
	cm.chains[chainID] = execution
	cm.mu.Unlock()

	// Execute the chain
	execution.Status = ChainStatusRunning
	err = cm.executor.Execute(chain, chainCtx)
	execution.EndTime = time.Now()

	if err != nil {
		execution.Status = ChainStatusFailed
		execution.Error = err.Error()
		return &ExecuteChainResponse{
			ChainID: chainID,
			Steps:   execution.Steps,
			Output:  chainCtx.Variables,
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	execution.Status = ChainStatusCompleted
	return &ExecuteChainResponse{
		ChainID: chainID,
		Steps:   execution.Steps,
		Output:  chainCtx.Variables,
		Success: true,
	}, nil
}

// buildChain builds an ActionChain from step specifications
func (cm *ChainManager) buildChain(specs []ChainStepSpec) (*actor.ActionChain, error) {
	builder := actor.NewChainBuilder()

	for _, spec := range specs {
		switch spec.ActionType {
		case actor.AG_ACCEPT:
			builder.Accept(getStringParam(spec.Params, "message"))
		case actor.AG_REFUSE:
			builder.Refuse(getStringParam(spec.Params, "reason"))
		case actor.AG_SELF_GEN:
			builder.Think(getStringParam(spec.Params, "prompt"))
		case actor.AG_SELF_DECIDE:
			builder.Decide(getStringParam(spec.Params, "question"), getStringSliceParam(spec.Params, "options"))
		case actor.AG_USE_MCP:
			builder.UseTool(
				getStringParam(spec.Params, "server"),
				getStringParam(spec.Params, "tool"),
				getMapParam(spec.Params, "arguments"),
			)
		case actor.AG_CALL_AG:
			builder.CallAgent(
				getStringParam(spec.Params, "target_agent"),
				getStringParam(spec.Params, "message"),
			)
		case actor.AG_CALL_HUMAN:
			builder.RequestHumanInput(
				getStringParam(spec.Params, "prompt"),
				getStringSliceParam(spec.Params, "options"),
			)
		case actor.AG_RAG:
			builder.RAG(getStringParam(spec.Params, "query"), getIntParam(spec.Params, "top_k"))
		case actor.AG_MEMORY_LOAD:
			builder.LoadMemory(getStringSliceParam(spec.Params, "keys"))
		case actor.AG_MEMORY_STORE:
			builder.StoreMemory(getMapParam(spec.Params, "data"))
		default:
			return nil, fmt.Errorf("unknown action type: %s", spec.ActionType)
		}
	}

	return builder.Build(), nil
}

// createExecutor creates a ChainExecutor with handlers
func (cm *ChainManager) createExecutor() *actor.ChainExecutor {
	executor := actor.NewChainExecutor()

	// Register handlers for each action type
	executor.RegisterHandler(actor.AG_SELF_GEN, cm.handleSelfGen)
	executor.RegisterHandler(actor.AG_SELF_DECIDE, cm.handleSelfDecide)
	executor.RegisterHandler(actor.AG_USE_MCP, cm.handleUseMCP)
	executor.RegisterHandler(actor.AG_CALL_AG, cm.handleCallAgent)
	executor.RegisterHandler(actor.AG_RAG, cm.handleRAG)
	executor.RegisterHandler(actor.AG_MEMORY_LOAD, cm.handleMemoryLoad)
	executor.RegisterHandler(actor.AG_MEMORY_STORE, cm.handleMemoryStore)
	executor.RegisterHandler(actor.AG_ACCEPT, cm.handleAccept)
	executor.RegisterHandler(actor.AG_REFUSE, cm.handleRefuse)
	executor.RegisterHandler(actor.AG_CALL_HUMAN, cm.handleCallHuman)

	return executor
}

// Handler implementations
func (cm *ChainManager) handleSelfGen(ctx *actor.ChainContext, step *actor.ActionStep) error {
	prompt := getStringParam(step.Params, "prompt")

	// Get agent's LLM provider
	wrapper, err := cm.svc.GetOrCreateAgent(ctx.Context, ctx.AgentID, ctx.SessionID)
	if err != nil {
		return err
	}

	// Get the AI actor and generate response
	// For now, use direct LLM call
	provider, err := cm.svc.cfg.LLMRegistry.Get("deepseek")
	if err != nil {
		return err
	}

	systemPrompt := "You are a helpful AI assistant."
	if sp, ok := ctx.Variables["system_prompt"].(string); ok {
		systemPrompt = sp
	}

	adapter := &llmProviderAdapter{provider: provider, model: "deepseek-chat"}
	result, err := adapter.GenerateText(ctx.Context, prompt, systemPrompt)
	if err != nil {
		return err
	}

	ctx.Variables["last_response"] = result
	cm.recordStepResult(ctx, step, result)

	_ = wrapper // Used for logging/metrics
	return nil
}

func (cm *ChainManager) handleSelfDecide(ctx *actor.ChainContext, step *actor.ActionStep) error {
	question := getStringParam(step.Params, "question")
	options := getStringSliceParam(step.Params, "options")

	optionsPrompt := ""
	for i, opt := range options {
		optionsPrompt += fmt.Sprintf("\n%d. %s", i+1, opt)
	}

	prompt := fmt.Sprintf("Question: %s\n\nOptions:%s\n\nChoose the best option and explain your reasoning.", question, optionsPrompt)

	provider, err := cm.svc.cfg.LLMRegistry.Get("deepseek")
	if err != nil {
		return err
	}

	adapter := &llmProviderAdapter{provider: provider, model: "deepseek-chat"}
	result, err := adapter.GenerateText(ctx.Context, prompt, "You are a decision-making assistant. Analyze the options and choose the best one.")
	if err != nil {
		return err
	}

	ctx.Variables["decision"] = result
	cm.recordStepResult(ctx, step, result)
	return nil
}

func (cm *ChainManager) handleUseMCP(ctx *actor.ChainContext, step *actor.ActionStep) error {
	serverName := getStringParam(step.Params, "server")
	toolName := getStringParam(step.Params, "tool")
	args := getMapParam(step.Params, "arguments")

	result, err := cm.svc.cfg.MCPManager.CallTool(ctx.Context, serverName, toolName, args)
	if err != nil {
		return fmt.Errorf("MCP tool call failed: %w", err)
	}

	ctx.Variables["tool_result"] = result
	cm.recordStepResult(ctx, step, result)
	return nil
}

func (cm *ChainManager) handleCallAgent(ctx *actor.ChainContext, step *actor.ActionStep) error {
	targetAgent := getStringParam(step.Params, "target_agent")
	message := getStringParam(step.Params, "message")

	// Get or create the target agent
	wrapper, err := cm.svc.GetOrCreateAgent(ctx.Context, targetAgent, ctx.SessionID)
	if err != nil {
		return fmt.Errorf("failed to get target agent: %w", err)
	}

	// Send message to target agent
	respChan := make(chan actor.Message, 1)
	wrapper.Ref.Send(actor.NewAskMessage("agent_call", &actor.ChatMessage{
		Role:    "agent",
		Content: message,
	}, respChan))

	select {
	case resp := <-respChan:
		if chatResp, ok := resp.Payload().(*actor.ChatMessage); ok {
			ctx.Variables["agent_response"] = chatResp.Content
			cm.recordStepResult(ctx, step, chatResp.Content)
		}
	case <-ctx.Context.Done():
		return ctx.Context.Err()
	case <-time.After(30 * time.Second):
		return fmt.Errorf("timeout waiting for agent response")
	}

	return nil
}

func (cm *ChainManager) handleRAG(ctx *actor.ChainContext, step *actor.ActionStep) error {
	query := getStringParam(step.Params, "query")
	topK := getIntParam(step.Params, "top_k")
	if topK == 0 {
		topK = 5
	}

	// TODO: Implement RAG retrieval via Chroma
	// For now, return empty results
	results := []map[string]interface{}{
		{"content": "RAG retrieval placeholder", "score": 0.95},
	}

	ctx.Variables["rag_results"] = results
	ctx.Variables["rag_query"] = query
	cm.recordStepResult(ctx, step, results)

	_ = topK
	return nil
}

func (cm *ChainManager) handleMemoryLoad(ctx *actor.ChainContext, step *actor.ActionStep) error {
	keys := getStringSliceParam(step.Params, "keys")

	// Load from Redis
	redis := cm.svc.cfg.Pools.GetRedis()
	memory := make(map[string]interface{})

	for _, key := range keys {
		fullKey := fmt.Sprintf("memory:%s:%s:%s", ctx.AgentID, ctx.SessionID, key)
		val, err := redis.Get(ctx.Context, fullKey).Result()
		if err == nil {
			memory[key] = val
		}
	}

	ctx.Variables["memory"] = memory
	cm.recordStepResult(ctx, step, memory)
	return nil
}

func (cm *ChainManager) handleMemoryStore(ctx *actor.ChainContext, step *actor.ActionStep) error {
	data := getMapParam(step.Params, "data")

	// Store in Redis
	redis := cm.svc.cfg.Pools.GetRedis()

	for key, val := range data {
		fullKey := fmt.Sprintf("memory:%s:%s:%s", ctx.AgentID, ctx.SessionID, key)
		valStr := fmt.Sprintf("%v", val)
		err := redis.Set(ctx.Context, fullKey, valStr, 24*time.Hour).Err()
		if err != nil {
			return fmt.Errorf("failed to store memory key %s: %w", key, err)
		}
	}

	cm.recordStepResult(ctx, step, data)
	return nil
}

func (cm *ChainManager) handleAccept(ctx *actor.ChainContext, step *actor.ActionStep) error {
	message := getStringParam(step.Params, "message")
	ctx.Variables["accepted"] = true
	ctx.Variables["accept_message"] = message
	cm.recordStepResult(ctx, step, message)
	return nil
}

func (cm *ChainManager) handleRefuse(ctx *actor.ChainContext, step *actor.ActionStep) error {
	reason := getStringParam(step.Params, "reason")
	ctx.Variables["refused"] = true
	ctx.Variables["refuse_reason"] = reason
	cm.recordStepResult(ctx, step, reason)
	return nil
}

func (cm *ChainManager) handleCallHuman(ctx *actor.ChainContext, step *actor.ActionStep) error {
	prompt := getStringParam(step.Params, "prompt")
	options := getStringSliceParam(step.Params, "options")

	// Store human request in context for external handling
	ctx.Variables["human_request"] = map[string]interface{}{
		"prompt":  prompt,
		"options": options,
		"pending": true,
	}
	cm.recordStepResult(ctx, step, map[string]interface{}{"prompt": prompt, "options": options})
	return nil
}

// recordStepResult records the result of a chain step
func (cm *ChainManager) recordStepResult(ctx *actor.ChainContext, step *actor.ActionStep, result interface{}) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	for _, exec := range cm.chains {
		if exec.Context == ctx {
			exec.Steps = append(exec.Steps, ChainStepResult{
				StepID:     step.ID,
				ActionType: step.Type,
				Status:     "completed",
				Result:     result,
			})
			break
		}
	}
}

// GetExecution returns a chain execution by ID
func (cm *ChainManager) GetExecution(chainID string) (*ChainExecution, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	exec, ok := cm.chains[chainID]
	return exec, ok
}

// Helper functions
func getStringParam(params map[string]interface{}, key string) string {
	if v, ok := params[key].(string); ok {
		return v
	}
	return ""
}

func getStringSliceParam(params map[string]interface{}, key string) []string {
	if v, ok := params[key].([]string); ok {
		return v
	}
	if v, ok := params[key].([]interface{}); ok {
		result := make([]string, len(v))
		for i, item := range v {
			result[i] = fmt.Sprintf("%v", item)
		}
		return result
	}
	return nil
}

func getIntParam(params map[string]interface{}, key string) int {
	if v, ok := params[key].(int); ok {
		return v
	}
	if v, ok := params[key].(float64); ok {
		return int(v)
	}
	return 0
}

func getMapParam(params map[string]interface{}, key string) map[string]interface{} {
	if v, ok := params[key].(map[string]interface{}); ok {
		return v
	}
	return nil
}
