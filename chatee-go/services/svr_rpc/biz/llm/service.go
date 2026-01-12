package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/llm"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	dbc "chatee-go/gen/dbc"
	svrllm "chatee-go/gen/svr/llm"
)

// =============================================================================
// Service Configuration
// =============================================================================

// Config holds the LLM service configuration
type Config struct {
	Logger   log.Logger
	Pools    *pool.PoolManager
	Registry *llm.Registry
}

// =============================================================================
// Service Implementation
// =============================================================================

// Service implements the LLM gRPC service
type Service struct {
	cfg        Config
	dbcClient  dbc.LLMConfigServiceClient
	dbcConn    *grpc.ClientConn
}

// NewService creates a new LLM service
func NewService(cfg Config) *Service {
	// Initialize DBC client for LLM config operations
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
		cfg.Logger.Warn("Failed to connect to DBC service for LLM config", log.Err(err))
	} else {
		cfg.Logger.Info("DBC client initialized for LLM service", log.String("addr", dbcAddr))
	}

	return &Service{
		cfg:       cfg,
		dbcClient: dbc.NewLLMConfigServiceClient(dbcConn),
		dbcConn:   dbcConn,
	}
}

// RegisterGRPC registers the service with a gRPC server
func RegisterGRPC(server *grpc.Server, svc *Service) {
	svrllm.RegisterLLMServiceServer(server, svc)
}

// Close closes all resources
func (s *Service) Close() error {
	if s.dbcConn != nil {
		return s.dbcConn.Close()
	}
	return nil
}

// =============================================================================
// Configuration CRUD
// =============================================================================

// ListConfigs lists all LLM configurations
func (s *Service) ListConfigs(ctx context.Context, req *svrllm.ListConfigsRequest) (*svrllm.ListConfigsResponse, error) {
	// ListLLMConfigsRequest is empty in proto, we'll filter client-side
	dbcReq := &dbc.ListLLMConfigsRequest{}

	dbcResp, err := s.dbcClient.ListLLMConfigs(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to list LLM configs", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list configs: %v", err)
	}

	allConfigs := dbcResp.GetConfigs()
	filteredConfigs := make([]*svrllm.LLMConfig, 0)
	for _, dbcCfg := range allConfigs {
		// Filter by enabled if requested
		if req.GetEnabledOnly() && !dbcCfg.GetIsEnabled() {
			continue
		}
		// Filter by provider if requested
		if req.GetProvider() != "" && dbcCfg.GetProvider() != req.GetProvider() {
			continue
		}
		filteredConfigs = append(filteredConfigs, s.dbcConfigToProto(dbcCfg))
	}

	return &svrllm.ListConfigsResponse{Configs: filteredConfigs}, nil
}

// GetConfig retrieves an LLM configuration by ID
func (s *Service) GetConfig(ctx context.Context, req *svrllm.GetConfigRequest) (*svrllm.LLMConfig, error) {
	if req.GetConfigId() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "config_id is required")
	}

	dbcReq := &dbc.GetLLMConfigRequest{
		Id: req.GetConfigId(),
	}

	dbcResp, err := s.dbcClient.GetLLMConfig(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to get LLM config", log.String("config_id", req.GetConfigId()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get config: %v", err)
	}

	return s.dbcConfigToProto(dbcResp), nil
}

// CreateConfig creates a new LLM configuration
func (s *Service) CreateConfig(ctx context.Context, req *svrllm.CreateConfigRequest) (*svrllm.LLMConfig, error) {
	if req.GetName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "name is required")
	}
	if req.GetProvider() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "provider is required")
	}
	if req.GetModel() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "model is required")
	}

	// Convert settings
	settingsJSON, err := s.settingsToJSON(req.GetSettings())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid settings: %v", err)
	}

	// Convert model to JSON array
	modelsJSON, err := json.Marshal([]string{req.GetModel()})
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid model: %v", err)
	}

	dbcReq := &dbc.CreateLLMConfigRequest{
		Name:      req.GetName(),
		Provider:  req.GetProvider(),
		ApiKey:    req.GetApiKey(),
		BaseUrl:   req.GetApiUrl(),
		Models:    modelsJSON,
		IsEnabled: true, // Default to enabled
		Settings:  settingsJSON,
	}

	dbcResp, err := s.dbcClient.CreateLLMConfig(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to create LLM config", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create config: %v", err)
	}

	return s.dbcConfigToProto(dbcResp), nil
}

// UpdateConfig updates an LLM configuration
func (s *Service) UpdateConfig(ctx context.Context, req *svrllm.UpdateConfigRequest) (*svrllm.LLMConfig, error) {
	if req.GetConfigId() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "config_id is required")
	}

	// Convert settings
	var settingsJSON []byte
	if req.GetSettings() != nil {
		var err error
		settingsJSON, err = s.settingsToJSON(req.GetSettings())
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid settings: %v", err)
		}
	}

	// Convert model to JSON array if provided
	var modelsJSON []byte
	if req.GetModel() != "" {
		var err error
		modelsJSON, err = json.Marshal([]string{req.GetModel()})
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid model: %v", err)
		}
	}

	dbcReq := &dbc.UpdateLLMConfigRequest{
		Id:        req.GetConfigId(),
		Name:      req.GetName(),
		ApiKey:    req.GetApiKey(),
		BaseUrl:   req.GetApiUrl(),
		Models:    modelsJSON,
		IsEnabled: req.GetEnabled(),
		Settings:  settingsJSON,
	}

	dbcResp, err := s.dbcClient.UpdateLLMConfig(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to update LLM config", log.String("config_id", req.GetConfigId()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update config: %v", err)
	}

	return s.dbcConfigToProto(dbcResp), nil
}

// DeleteConfig deletes an LLM configuration
func (s *Service) DeleteConfig(ctx context.Context, req *svrllm.DeleteConfigRequest) (*svrllm.DeleteConfigResponse, error) {
	if req.GetConfigId() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "config_id is required")
	}

	dbcReq := &dbc.DeleteLLMConfigRequest{
		Id: req.GetConfigId(),
	}

	_, err := s.dbcClient.DeleteLLMConfig(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to delete LLM config", log.String("config_id", req.GetConfigId()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete config: %v", err)
	}

	return &svrllm.DeleteConfigResponse{Success: true}, nil
}

// =============================================================================
// Provider Management
// =============================================================================

// ListProviders lists all available LLM providers
func (s *Service) ListProviders(ctx context.Context, req *svrllm.ListProvidersRequest) (*svrllm.ListProvidersResponse, error) {
	providerNames := s.cfg.Registry.List()

	providers := make([]*svrllm.Provider, 0, len(providerNames))
	for _, name := range providerNames {
		provider, ok := s.cfg.Registry.Get(name)
		if !ok {
			continue
		}

		// Get default models for this provider
		models, err := provider.ListModels(ctx)
		defaultModels := make([]string, 0)
		if err == nil {
			for _, m := range models {
				defaultModels = append(defaultModels, m.ID)
			}
		}

		providers = append(providers, &svrllm.Provider{
			Name:            name,
			DisplayName:     s.getProviderDisplayName(name),
			SupportsStreaming: true, // Most providers support streaming
			SupportsTools:     true, // Most modern providers support tools
			SupportsVision:    s.supportsVision(name),
			DefaultModels:     defaultModels,
		})
	}

	return &svrllm.ListProvidersResponse{Providers: providers}, nil
}

// GetProviderModels lists available models for a provider
func (s *Service) GetProviderModels(ctx context.Context, req *svrllm.GetProviderModelsRequest) (*svrllm.GetProviderModelsResponse, error) {
	if req.GetProvider() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "provider is required")
	}

	// Create a temporary provider to fetch models
	providerConfig := llm.ProviderConfig{
		Type:    req.GetProvider(),
		APIKey:  req.GetApiKey(),
		BaseURL: req.GetApiUrl(),
	}

	provider, err := llm.CreateProvider(providerConfig)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to create provider: %v", err)
	}

	models, err := provider.ListModels(ctx)
	if err != nil {
		s.cfg.Logger.Error("Failed to list provider models", log.String("provider", req.GetProvider()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list models: %v", err)
	}

	protoModels := make([]*svrllm.ModelInfo, len(models))
	for i, m := range models {
		protoModels[i] = &svrllm.ModelInfo{
			ModelId:       m.ID,
			DisplayName:   m.Name,
			ContextLength: int32(m.ContextSize),
			SupportsTools: true, // Assume tools are supported
			SupportsVision: s.supportsVision(req.GetProvider()),
		}
	}

	return &svrllm.GetProviderModelsResponse{Models: protoModels}, nil
}

// TestConnection tests a connection to an LLM provider
func (s *Service) TestConnection(ctx context.Context, req *svrllm.TestConnectionRequest) (*svrllm.TestConnectionResponse, error) {
	if req.GetProvider() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "provider is required")
	}
	if req.GetApiKey() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "api_key is required")
	}

	startTime := time.Now()

	// Create provider
	providerConfig := llm.ProviderConfig{
		Type:    req.GetProvider(),
		APIKey:  req.GetApiKey(),
		BaseURL: req.GetApiUrl(),
	}

	provider, err := llm.CreateProvider(providerConfig)
	if err != nil {
		return &svrllm.TestConnectionResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to create provider: %v", err),
		}, nil
	}

	// Test with a simple request
	testReq := &llm.ChatRequest{
		Model: req.GetModel(),
		Messages: []llm.Message{
			{Role: "user", Content: "Hello"},
		},
		MaxTokens: intPtr(10),
	}

	_, err = provider.Chat(ctx, testReq)
	latency := time.Since(startTime).Milliseconds()

	if err != nil {
		return &svrllm.TestConnectionResponse{
			Success:   false,
			LatencyMs: latency,
			Error:     err.Error(),
		}, nil
	}

	// Get model name from provider
	modelName := req.GetModel()
	if modelName == "" {
		models, err := provider.ListModels(ctx)
		if err == nil && len(models) > 0 {
			modelName = models[0].ID
		}
	}

	return &svrllm.TestConnectionResponse{
		Success:   true,
		ModelName: modelName,
		LatencyMs: latency,
	}, nil
}

// =============================================================================
// Chat Completion
// =============================================================================

// Chat sends a chat completion request
func (s *Service) Chat(ctx context.Context, req *svrllm.ChatRequest) (*svrllm.ChatResponse, error) {
	if req.GetConfigId() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "config_id is required")
	}

	// Get LLM config from DBC
	config, err := s.getConfig(ctx, req.GetConfigId())
	if err != nil {
		return nil, err
	}

	// Get or create provider
	provider, err := s.getOrCreateProvider(ctx, config)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get provider: %v", err)
	}

	// Convert proto messages to llm messages
	messages := s.protoMessagesToLLM(req.GetMessages())

	// Parse model from Models JSON
	model, err := s.getModelFromConfig(config)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get model from config: %v", err)
	}

	// Build chat request
	chatReq := &llm.ChatRequest{
		Model:    model,
		Messages: messages,
	}

	// Apply settings
	if req.GetSettings() != nil {
		if req.GetSettings().Temperature > 0 {
			temp := float64(req.GetSettings().Temperature)
			chatReq.Temperature = &temp
		}
		if req.GetSettings().MaxTokens > 0 {
			maxTokens := int(req.GetSettings().MaxTokens)
			chatReq.MaxTokens = &maxTokens
		}
		if req.GetSettings().TopP > 0 {
			topP := float64(req.GetSettings().TopP)
			chatReq.TopP = &topP
		}
		if len(req.GetSettings().Stop) > 0 {
			chatReq.Stop = req.GetSettings().Stop
		}
	} else if config.GetSettings() != nil {
		// Use config settings
		settings, err := s.jsonToSettings(config.GetSettings())
		if err == nil {
			if settings.Temperature > 0 {
				temp := float64(settings.Temperature)
				chatReq.Temperature = &temp
			}
			if settings.MaxTokens > 0 {
				maxTokens := int(settings.MaxTokens)
				chatReq.MaxTokens = &maxTokens
			}
			if settings.TopP > 0 {
				topP := float64(settings.TopP)
				chatReq.TopP = &topP
			}
			if len(settings.Stop) > 0 {
				chatReq.Stop = settings.Stop
			}
		}
	}

	// Convert tools if provided
	if len(req.GetTools()) > 0 {
		chatReq.Tools = s.protoToolsToLLM(req.GetTools())
	}

	// Call provider
	resp, err := provider.Chat(ctx, chatReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to chat", log.String("config_id", req.GetConfigId()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to chat: %v", err)
	}

	// Convert response
	return s.llmResponseToProto(resp), nil
}

// ChatStream sends a streaming chat completion request
func (s *Service) ChatStream(req *svrllm.ChatRequest, stream svrllm.LLMService_ChatStreamServer) error {
	if req.GetConfigId() == "" {
		return status.Errorf(codes.InvalidArgument, "config_id is required")
	}

	ctx := stream.Context()

	// Get LLM config from DBC
	config, err := s.getConfig(ctx, req.GetConfigId())
	if err != nil {
		return err
	}

	// Get or create provider
	provider, err := s.getOrCreateProvider(ctx, config)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get provider: %v", err)
	}

	// Parse model from Models JSON
	model, err := s.getModelFromConfig(config)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get model from config: %v", err)
	}

	// Convert proto messages to llm messages
	messages := s.protoMessagesToLLM(req.GetMessages())

	// Build chat request
	chatReq := &llm.ChatRequest{
		Model:    model,
		Messages: messages,
		Stream:   true,
	}

	// Apply settings (same as Chat method)
	if req.GetSettings() != nil {
		if req.GetSettings().Temperature > 0 {
			temp := float64(req.GetSettings().Temperature)
			chatReq.Temperature = &temp
		}
		if req.GetSettings().MaxTokens > 0 {
			maxTokens := int(req.GetSettings().MaxTokens)
			chatReq.MaxTokens = &maxTokens
		}
		if req.GetSettings().TopP > 0 {
			topP := float64(req.GetSettings().TopP)
			chatReq.TopP = &topP
		}
		if len(req.GetSettings().Stop) > 0 {
			chatReq.Stop = req.GetSettings().Stop
		}
	}

	// Convert tools if provided
	if len(req.GetTools()) > 0 {
		chatReq.Tools = s.protoToolsToLLM(req.GetTools())
	}

	// Call provider stream
	eventChan, err := provider.ChatStream(ctx, chatReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to start chat stream", log.String("config_id", req.GetConfigId()), log.Err(err))
		return status.Errorf(codes.Internal, "failed to start stream: %v", err)
	}

	// Stream events
	for event := range eventChan {
		streamEvent := &svrllm.ChatStreamEvent{}

		switch event.Type {
		case "content":
			streamEvent.Event = &svrllm.ChatStreamEvent_Delta{
				Delta: &svrllm.StreamDelta{
					Content: event.Delta,
					Role:    "assistant",
				},
			}
		case "tool_call":
			if event.ToolCall != nil {
				streamEvent.Event = &svrllm.ChatStreamEvent_ToolCall{
					ToolCall: &svrllm.StreamToolCall{
						Id:            event.ToolCall.ID,
						Name:          event.ToolCall.Function.Name,
						ArgumentsDelta: event.ToolCall.Function.Arguments,
						IsComplete:    event.FinishReason != "",
					},
				}
			}
		case "done":
			// Get model name for complete event
			modelName, _ := s.getModelFromConfig(config)
			streamEvent.Event = &svrllm.ChatStreamEvent_Complete{
				Complete: &svrllm.StreamComplete{
					FinishReason: event.FinishReason,
					Model:        modelName,
				},
			}
		case "error":
			streamEvent.Event = &svrllm.ChatStreamEvent_Error{
				Error: &svrllm.StreamError{
					Code:      500,
					Message:   event.Error.Error(),
					Retryable: true,
				},
			}
		}

		if err := stream.Send(streamEvent); err != nil {
			s.cfg.Logger.Error("Failed to send stream event", log.Err(err))
			return err
		}
	}

	return nil
}

// =============================================================================
// Token Counting
// =============================================================================

// CountTokens counts tokens in messages
func (s *Service) CountTokens(ctx context.Context, req *svrllm.CountTokensRequest) (*svrllm.CountTokensResponse, error) {
	if req.GetConfigId() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "config_id is required")
	}

	// Get LLM config from DBC
	config, err := s.getConfig(ctx, req.GetConfigId())
	if err != nil {
		return nil, err
	}

	// Get or create provider
	provider, err := s.getOrCreateProvider(ctx, config)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get provider: %v", err)
	}

	// Convert proto messages to llm messages
	messages := s.protoMessagesToLLM(req.GetMessages())

	// Count tokens
	totalTokens, err := provider.CountTokens(ctx, messages)
	if err != nil {
		s.cfg.Logger.Error("Failed to count tokens", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to count tokens: %v", err)
	}

	// Calculate system vs message tokens (simple heuristic)
	systemTokens := 0
	messageTokens := totalTokens
	for _, msg := range messages {
		if msg.Role == "system" {
			// Rough estimate: ~4 tokens per word
			words := len(msg.Content) / 5
			systemTokens += words * 4
			messageTokens -= words * 4
		}
	}

	return &svrllm.CountTokensResponse{
		TotalTokens:    int32(totalTokens),
		MessagesTokens: int32(messageTokens),
		SystemTokens:   int32(systemTokens),
	}, nil
}

// =============================================================================
// Helper Methods
// =============================================================================

func (s *Service) getConfig(ctx context.Context, configID string) (*dbc.LLMConfig, error) {
	dbcReq := &dbc.GetLLMConfigRequest{
		Id: configID,
	}

	config, err := s.dbcClient.GetLLMConfig(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to get LLM config", log.String("config_id", configID), log.Err(err))
		return nil, status.Errorf(codes.NotFound, "config not found: %v", err)
	}

	if !config.GetIsEnabled() {
		return nil, status.Errorf(codes.FailedPrecondition, "config is disabled")
	}

	return config, nil
}

func (s *Service) getOrCreateProvider(ctx context.Context, config *dbc.LLMConfig) (llm.Provider, error) {
	providerName := config.GetProvider()

	// Try to get from registry first
	if provider, ok := s.cfg.Registry.Get(providerName); ok {
		return provider, nil
	}

	// Create new provider
	providerConfig := llm.ProviderConfig{
		Type:    providerName,
		APIKey:  config.GetApiKey(),
		BaseURL: config.GetBaseUrl(),
	}

	provider, err := llm.CreateProvider(providerConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create provider: %w", err)
	}

	// Register it for future use
	s.cfg.Registry.Register(providerName, provider)

	return provider, nil
}

func (s *Service) dbcConfigToProto(dbcCfg *dbc.LLMConfig) *svrllm.LLMConfig {
	settings, _ := s.jsonToSettings(dbcCfg.GetSettings())

	// Parse model from Models JSON
	model, _ := s.getModelFromConfig(dbcCfg)

	return &svrllm.LLMConfig{
		ConfigId: dbcCfg.GetId(),
		Name:     dbcCfg.GetName(),
		Provider: dbcCfg.GetProvider(),
		Model:    model,
		ApiKey:   dbcCfg.GetApiKey(), // Note: This should be encrypted in production
		ApiUrl:   dbcCfg.GetBaseUrl(),
		Enabled:  dbcCfg.GetIsEnabled(),
		Settings: s.settingsToProto(settings),
		CreatedAt: dbcCfg.GetCreatedAt(),
		UpdatedAt: dbcCfg.GetUpdatedAt(),
	}
}

// getModelFromConfig extracts the first model from Models JSON
func (s *Service) getModelFromConfig(config *dbc.LLMConfig) (string, error) {
	if len(config.GetModels()) == 0 {
		return "", fmt.Errorf("no models configured")
	}

	var models []string
	if err := json.Unmarshal(config.GetModels(), &models); err != nil {
		return "", fmt.Errorf("failed to parse models JSON: %w", err)
	}

	if len(models) == 0 {
		return "", fmt.Errorf("models array is empty")
	}

	return models[0], nil
}

func (s *Service) settingsToJSON(settings *svrllm.ModelSettings) ([]byte, error) {
	if settings == nil {
		return nil, nil
	}

	data := map[string]interface{}{
		"temperature":       settings.Temperature,
		"max_tokens":        settings.MaxTokens,
		"top_p":             settings.TopP,
		"frequency_penalty": settings.FrequencyPenalty,
		"presence_penalty":  settings.PresencePenalty,
		"stop":              settings.Stop,
		"extra":             settings.Extra,
	}

	return json.Marshal(data)
}

func (s *Service) jsonToSettings(data []byte) (*svrllm.ModelSettings, error) {
	if len(data) == 0 {
		return nil, nil
	}

	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}

	settings := &svrllm.ModelSettings{}

	if v, ok := m["temperature"].(float64); ok {
		settings.Temperature = float32(v)
	}
	if v, ok := m["max_tokens"].(float64); ok {
		settings.MaxTokens = int32(v)
	}
	if v, ok := m["top_p"].(float64); ok {
		settings.TopP = float32(v)
	}
	if v, ok := m["frequency_penalty"].(float64); ok {
		settings.FrequencyPenalty = float32(v)
	}
	if v, ok := m["presence_penalty"].(float64); ok {
		settings.PresencePenalty = float32(v)
	}
	if v, ok := m["stop"].([]interface{}); ok {
		settings.Stop = make([]string, len(v))
		for i, item := range v {
			if str, ok := item.(string); ok {
				settings.Stop[i] = str
			}
		}
	}
	if v, ok := m["extra"].(map[string]interface{}); ok {
		settings.Extra = make(map[string]string)
		for k, val := range v {
			if str, ok := val.(string); ok {
				settings.Extra[k] = str
			}
		}
	}

	return settings, nil
}

func (s *Service) settingsToProto(settings *svrllm.ModelSettings) *svrllm.ModelSettings {
	if settings == nil {
		return nil
	}
	return settings
}

func (s *Service) protoMessagesToLLM(protoMessages []*svrllm.Message) []llm.Message {
	messages := make([]llm.Message, len(protoMessages))
	for i, pm := range protoMessages {
		toolCalls := make([]llm.ToolCall, len(pm.GetToolCalls()))
		for j, tc := range pm.GetToolCalls() {
			toolCalls[j] = llm.ToolCall{
				ID:   tc.GetId(),
				Type: tc.GetType(),
				Function: llm.FunctionCall{
					Name:      tc.GetFunction().GetName(),
					Arguments: tc.GetFunction().GetArguments(),
				},
			}
		}

		messages[i] = llm.Message{
			Role:       pm.GetRole(),
			Content:    pm.GetContent(),
			Name:       pm.GetName(),
			ToolCalls:  toolCalls,
			ToolCallID: pm.GetToolCallId(),
		}
	}
	return messages
}

func (s *Service) protoToolsToLLM(protoTools []*svrllm.Tool) []llm.Tool {
	tools := make([]llm.Tool, len(protoTools))
	for i, pt := range protoTools {
		var params any
		if len(pt.GetFunction().GetParameters()) > 0 {
			if err := json.Unmarshal(pt.GetFunction().GetParameters(), &params); err != nil {
				s.cfg.Logger.Warn("Failed to parse tool parameters", log.Err(err))
			}
		}

		tools[i] = llm.Tool{
			Type: pt.GetType(),
			Function: llm.FunctionDef{
				Name:        pt.GetFunction().GetName(),
				Description: pt.GetFunction().GetDescription(),
				Parameters:  params,
			},
		}
	}
	return tools
}

func (s *Service) llmResponseToProto(resp *llm.ChatResponse) *svrllm.ChatResponse {
	toolCalls := make([]*svrllm.ToolCall, len(resp.Message.ToolCalls))
	for i, tc := range resp.Message.ToolCalls {
		toolCalls[i] = &svrllm.ToolCall{
			Id:   tc.ID,
			Type: tc.Type,
			Function: &svrllm.FunctionCall{
				Name:      tc.Function.Name,
				Arguments: tc.Function.Arguments,
			},
		}
	}

	return &svrllm.ChatResponse{
		Id:   resp.ID,
		Model: resp.Model,
		Message: &svrllm.Message{
			Role:      resp.Message.Role,
			Content:   resp.Message.Content,
			ToolCalls: toolCalls,
		},
		FinishReason: resp.FinishReason,
		Usage: &svrllm.Usage{
			PromptTokens:     int32(resp.Usage.PromptTokens),
			CompletionTokens: int32(resp.Usage.CompletionTokens),
			TotalTokens:      int32(resp.Usage.TotalTokens),
		},
	}
}

func (s *Service) getProviderDisplayName(name string) string {
	displayNames := map[string]string{
		"openai":     "OpenAI",
		"anthropic":  "Anthropic",
		"deepseek":   "DeepSeek",
		"openrouter": "OpenRouter",
		"ollama":     "Ollama",
	}
	if displayName, ok := displayNames[name]; ok {
		return displayName
	}
	return name
}

func (s *Service) supportsVision(provider string) bool {
	visionProviders := map[string]bool{
		"openai":    true,
		"anthropic": true,
		"deepseek":  false,
		"ollama":    false,
	}
	return visionProviders[provider]
}

func intPtr(i int) *int {
	return &i
}
