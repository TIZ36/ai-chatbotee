package handler

import (
	"context"
	"database/sql"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/snowflake"
	dbc "chatee-go/gen/dbc"
	"chatee-go/services/dbc_rpc/repository"
)

// LLMConfigHandler implements LLMConfigService gRPC interface
type LLMConfigHandler struct {
	dbc.UnimplementedLLMConfigServiceServer
	
	repo   repository.LLMConfigRepository
	logger log.Logger
}

// NewLLMConfigHandler creates a new LLM config handler
func NewLLMConfigHandler(repo repository.LLMConfigRepository, logger log.Logger) *LLMConfigHandler {
	return &LLMConfigHandler{
		repo:   repo,
		logger: logger,
	}
}

// Register registers the handler with gRPC server
func (h *LLMConfigHandler) Register(server *grpc.Server) {
	dbc.RegisterLLMConfigServiceServer(server, h)
}

// CreateLLMConfig creates a new LLM config
func (h *LLMConfigHandler) CreateLLMConfig(ctx context.Context, req *dbc.CreateLLMConfigRequest) (*dbc.LLMConfig, error) {
	configID := snowflake.GenerateTypedID("llm_config")
	now := time.Now()
	
	baseURL := sql.NullString{}
	if req.GetBaseUrl() != "" {
		baseURL = sql.NullString{String: req.GetBaseUrl(), Valid: true}
	}
	
	config := &repository.LLMConfig{
		ID:         configID,
		Name:       req.GetName(),
		Provider:   req.GetProvider(),
		APIKey:     req.GetApiKey(),
		BaseURL:    baseURL,
		Models:     req.GetModels(),
		IsDefault:  req.GetIsDefault(),
		IsEnabled:  req.GetIsEnabled(),
		Settings:   req.GetSettings(),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	
	if err := h.repo.Create(ctx, config); err != nil {
		h.logger.Error("Failed to create LLM config", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create LLM config: %v", err)
	}
	
	return h.toProtoLLMConfig(config), nil
}

// GetLLMConfig retrieves an LLM config by ID
func (h *LLMConfigHandler) GetLLMConfig(ctx context.Context, req *dbc.GetLLMConfigRequest) (*dbc.LLMConfig, error) {
	config, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "LLM config not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get LLM config", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get LLM config: %v", err)
	}
	
	return h.toProtoLLMConfig(config), nil
}

// GetDefaultLLMConfig retrieves the default LLM config
func (h *LLMConfigHandler) GetDefaultLLMConfig(ctx context.Context, req *dbc.GetDefaultLLMConfigRequest) (*dbc.LLMConfig, error) {
	config, err := h.repo.GetDefault(ctx)
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "default LLM config not found")
		}
		h.logger.Error("Failed to get default LLM config", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get default LLM config: %v", err)
	}
	
	return h.toProtoLLMConfig(config), nil
}

// GetLLMConfigsByProvider retrieves LLM configs by provider
func (h *LLMConfigHandler) GetLLMConfigsByProvider(ctx context.Context, req *dbc.GetLLMConfigsByProviderRequest) (*dbc.GetLLMConfigsByProviderResponse, error) {
	configs, err := h.repo.GetByProvider(ctx, req.GetProvider())
	if err != nil {
		h.logger.Error("Failed to get LLM configs by provider", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get LLM configs: %v", err)
	}
	
	protoConfigs := make([]*dbc.LLMConfig, 0, len(configs))
	for _, config := range configs {
		protoConfigs = append(protoConfigs, h.toProtoLLMConfig(config))
	}
	
	return &dbc.GetLLMConfigsByProviderResponse{
		Configs: protoConfigs,
	}, nil
}

// ListLLMConfigs lists all LLM configs
func (h *LLMConfigHandler) ListLLMConfigs(ctx context.Context, req *dbc.ListLLMConfigsRequest) (*dbc.ListLLMConfigsResponse, error) {
	configs, err := h.repo.List(ctx)
	if err != nil {
		h.logger.Error("Failed to list LLM configs", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list LLM configs: %v", err)
	}
	
	protoConfigs := make([]*dbc.LLMConfig, 0, len(configs))
	for _, config := range configs {
		protoConfigs = append(protoConfigs, h.toProtoLLMConfig(config))
	}
	
	return &dbc.ListLLMConfigsResponse{
		Configs: protoConfigs,
	}, nil
}

// UpdateLLMConfig updates an LLM config
func (h *LLMConfigHandler) UpdateLLMConfig(ctx context.Context, req *dbc.UpdateLLMConfigRequest) (*dbc.LLMConfig, error) {
	config, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "LLM config not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get LLM config for update", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get LLM config: %v", err)
	}
	
	// Update fields
	if req.GetName() != "" {
		config.Name = req.GetName()
	}
	if req.GetApiKey() != "" {
		config.APIKey = req.GetApiKey()
	}
	if req.GetBaseUrl() != "" {
		config.BaseURL = sql.NullString{String: req.GetBaseUrl(), Valid: true}
	}
	if req.GetModels() != nil {
		config.Models = req.GetModels()
	}
	config.IsDefault = req.GetIsDefault()
	config.IsEnabled = req.GetIsEnabled()
	if req.GetSettings() != nil {
		config.Settings = req.GetSettings()
	}
	config.UpdatedAt = time.Now()
	
	if err := h.repo.Update(ctx, config); err != nil {
		h.logger.Error("Failed to update LLM config", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update LLM config: %v", err)
	}
	
	return h.toProtoLLMConfig(config), nil
}

// DeleteLLMConfig deletes an LLM config
func (h *LLMConfigHandler) DeleteLLMConfig(ctx context.Context, req *dbc.DeleteLLMConfigRequest) (*dbc.DeleteLLMConfigResponse, error) {
	if err := h.repo.Delete(ctx, req.GetId()); err != nil {
		h.logger.Error("Failed to delete LLM config", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete LLM config: %v", err)
	}
	
	return &dbc.DeleteLLMConfigResponse{Success: true}, nil
}

// toProtoLLMConfig converts repository LLMConfig to proto LLMConfig
func (h *LLMConfigHandler) toProtoLLMConfig(config *repository.LLMConfig) *dbc.LLMConfig {
	baseURL := ""
	if config.BaseURL.Valid {
		baseURL = config.BaseURL.String
	}
	
	return &dbc.LLMConfig{
		Id:        config.ID,
		Name:      config.Name,
		Provider:  config.Provider,
		ApiKey:    config.APIKey,
		BaseUrl:   baseURL,
		Models:    config.Models,
		IsDefault: config.IsDefault,
		IsEnabled: config.IsEnabled,
		Settings:  config.Settings,
		CreatedAt: config.CreatedAt.Unix(),
		UpdatedAt: config.UpdatedAt.Unix(),
	}
}

