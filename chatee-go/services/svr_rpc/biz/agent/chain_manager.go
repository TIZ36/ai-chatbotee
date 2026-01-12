package agent

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/actor"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/snowflake"
	dbc "chatee-go/gen/dbc"
	infraactor "chatee-go/infrastructure/actor"
)

// ChainManager manages ActionChain execution
type ChainManager struct {
	svc       *agentmod.Service
	chains    map[string]*ChainExecution
	mu        sync.RWMutex
	executor  actor.ChainExecutor
	chromaClient dbc.ChromaServiceClient
	chromaConn   *grpc.ClientConn
	logger       log.Logger
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
func NewChainManager(svc *Service, logger log.Logger) *ChainManager {
	cm := &ChainManager{
		svc:    svc,
		chains: make(map[string]*ChainExecution),
		logger: logger,
	}
	
	// Initialize DBC client for ChromaDB operations
	dbcAddr := os.Getenv("CHATEE_GRPC_DBC_ADDR")
	if dbcAddr == "" {
		dbcAddr = "localhost:9091" // Default DBC RPC address
	}

	dbcConn, err := grpc.Dial(
		dbcAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                10 * time.Second,
			Timeout:             3 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		logger.Warn("Failed to connect to DBC service for ChromaDB", log.Err(err))
	} else {
		logger.Info("DBC client initialized for ChromaDB", log.String("addr", dbcAddr))
		cm.chromaClient = dbc.NewChromaServiceClient(dbcConn)
		cm.chromaConn = dbcConn
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
func (cm *ChainManager) createExecutor() actor.ChainExecutor {
	executor := infraactor.NewChainExecutor()

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

	provider, ok := cm.svc.cfg.LLMRegistry.Get("deepseek")
	if !ok {
		return fmt.Errorf("LLM provider 'deepseek' not found")
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
	collectionName := getStringParam(step.Params, "collection")
	if topK == 0 {
		topK = 5
	}
	if collectionName == "" {
		collectionName = "default" // Default collection name
	}

	if cm.chromaClient == nil {
		return fmt.Errorf("ChromaDB client not available")
	}

	// Step 1: Get embedding for the query using LLM provider
	embedding, err := cm.generateEmbedding(ctx.Context, query)
	if err != nil {
		cm.logger.Error("Failed to generate embedding", log.Err(err), log.String("query", query))
		return fmt.Errorf("failed to generate embedding: %w", err)
	}

	// Step 2: Query ChromaDB with the embedding
	// QueryEmbeddings in proto is repeated float, which maps to []float32 in Go
	queryReq := &dbc.QueryRequest{
		CollectionName: collectionName,
		QueryEmbeddings: embedding,
		NResults:       int32(topK),
		Include:        []string{"documents", "metadatas", "distances"},
	}

	queryResp, err := cm.chromaClient.Query(ctx.Context, queryReq)
	if err != nil {
		cm.logger.Error("Failed to query ChromaDB", log.Err(err))
		return fmt.Errorf("failed to query ChromaDB: %w", err)
	}

	// Step 3: Convert results to the expected format
	results := make([]map[string]interface{}, 0)
	if len(queryResp.GetResults()) > 0 {
		result := queryResp.GetResults()[0]
		ids := result.GetIds()
		documents := result.GetDocuments()
		metadatas := result.GetMetadatas()
		distances := result.GetDistances()

		for i := 0; i < len(ids) && i < int(topK); i++ {
			item := map[string]interface{}{
				"id":       ids[i],
				"content":  "",
				"score":    0.0,
				"metadata": make(map[string]string),
			}

			if i < len(documents) {
				item["content"] = documents[i]
			}
			if i < len(distances) {
				// Convert distance to score (1 - distance, assuming cosine distance)
				item["score"] = 1.0 - float64(distances[i])
			}
			if i < len(metadatas) && metadatas[i] != nil {
				item["metadata"] = metadatas[i]
			}

			results = append(results, item)
		}
	}

	ctx.Variables["rag_results"] = results
	ctx.Variables["rag_query"] = query
	ctx.Variables["rag_collection"] = collectionName
	cm.recordStepResult(ctx, step, results)

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

// generateEmbedding generates an embedding vector for text using LLM provider
// This implementation uses the LLM registry to find an embedding-capable provider
func (cm *ChainManager) generateEmbedding(ctx context.Context, text string) ([]float32, error) {
	// Try to get an embedding-capable provider from the registry
	// First, try OpenAI-compatible providers (OpenAI, DeepSeek, etc.)
	providers := []string{"openai", "deepseek", "openrouter"}
	
	var embeddingProvider llm.EmbeddingProvider
	for _, name := range providers {
		if provider, ok := cm.svc.cfg.LLMRegistry.Get(name); ok {
			if ep, ok := provider.(llm.EmbeddingProvider); ok {
				embeddingProvider = ep
				cm.logger.Debug("Using embedding provider", log.String("provider", name))
				break
			}
		}
	}
	
	if embeddingProvider == nil {
		// Fallback: try to find any provider that implements EmbeddingProvider
		cm.svc.cfg.LLMRegistry.mu.RLock()
		for _, provider := range cm.svc.cfg.LLMRegistry.providers {
			if ep, ok := provider.(llm.EmbeddingProvider); ok {
				embeddingProvider = ep
				break
			}
		}
		cm.svc.cfg.LLMRegistry.mu.RUnlock()
	}
	
	if embeddingProvider == nil {
		// If no embedding provider is available, log warning and use placeholder
		cm.logger.Warn("No embedding provider available, using placeholder", log.String("query", text))
		// Return placeholder embedding as fallback
		return cm.generatePlaceholderEmbedding(text), nil
	}
	
	// Use default embedding model (text-embedding-3-small)
	// This can be configured per agent or collection
	model := "" // Empty string will use provider's default
	
	resp, err := embeddingProvider.CreateEmbedding(ctx, []string{text}, model)
	if err != nil {
		cm.logger.Error("Failed to create embedding, using placeholder", log.Err(err))
		// Fallback to placeholder on error
		return cm.generatePlaceholderEmbedding(text), nil
	}
	
	if len(resp.Embeddings) == 0 {
		cm.logger.Warn("Empty embedding response, using placeholder")
		return cm.generatePlaceholderEmbedding(text), nil
	}
	
	return resp.Embeddings[0], nil
}

// generatePlaceholderEmbedding generates a simple hash-based embedding as fallback
// This is NOT suitable for production semantic search, but allows the system to continue
func (cm *ChainManager) generatePlaceholderEmbedding(text string) []float32 {
	dim := 384
	embedding := make([]float32, dim)
	hash := 0
	for _, char := range text {
		hash = hash*31 + int(char)
	}
	for i := 0; i < dim; i++ {
		val := float32((hash*(i+1))%1000) / 1000.0
		embedding[i] = val - 0.5
	}
	
	// Normalize
	sum := float32(0)
	for _, v := range embedding {
		sum += v * v
	}
	if sum > 0 {
		norm := float32(1.0 / float64(sum))
		for i := range embedding {
			embedding[i] *= norm
		}
	}
	
	return embedding
}
