package handler

import (
	"context"
	"database/sql"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/commonlib/snowflake"
	dbc "chatee-go/gen/dbc"
	"chatee-go/services/dbc_rpc/repository/mysql"
)

// AgentHandler implements AgentService gRPC interface
type AgentHandler struct {
	dbc.UnimplementedAgentServiceServer

	logger log.Logger
	repo   mysql.AgentRepository
}

// NewAgentHandler creates a new agent handler
func NewAgentHandler(poolMgr *pool.PoolManager, logger log.Logger) *AgentHandler {
	return &AgentHandler{
		logger: logger,
		repo:   mysql.NewMySQLAgentRepository(poolMgr.GetGORM(), poolMgr.GetRedis()),
	}
}

// Register registers the handler with gRPC server
func (h *AgentHandler) Register(server *grpc.Server) {
	dbc.RegisterAgentServiceServer(server, h)
}

// CreateAgent creates a new agent
func (h *AgentHandler) CreateAgent(ctx context.Context, req *dbc.CreateAgentRequest) (*dbc.Agent, error) {
	logger := h.logger.WithContext(ctx)
	logger.Info("Creating new agent")
	agentID := snowflake.GenerateTypedID("agent")
	now := time.Now()

	description := sql.NullString{}
	if req.GetDescription() != "" {
		description = sql.NullString{String: req.GetDescription(), Valid: true}
	}

	agent := &mysql.Agent{
		ID:           agentID,
		UserID:       req.GetUserId(),
		Name:         req.GetName(),
		Description:  description,
		SystemPrompt: req.GetSystemPrompt(),
		Model:        req.GetModel(),
		Provider:     req.GetProvider(),
		Persona:      req.GetPersona(),
		MCPServers:   req.GetMcpServers(),
		IsDefault:    req.GetIsDefault(),
		IsPublic:     req.GetIsPublic(),
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := h.repo.Create(ctx, agent); err != nil {
		logger.Error("Failed to create agent", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create agent: %v", err)
	}

	return h.toProtoAgent(agent), nil
}

// GetAgent retrieves an agent by ID
func (h *AgentHandler) GetAgent(ctx context.Context, req *dbc.GetAgentRequest) (*dbc.Agent, error) {
	agent, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "agent not found: %s", req.GetId())
		}
		logger := h.logger.WithContext(ctx)
		logger.Error("Failed to get agent", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get agent: %v", err)
	}

	return h.toProtoAgent(agent), nil
}

// GetAgentsByUser retrieves agents for a user
func (h *AgentHandler) GetAgentsByUser(ctx context.Context, req *dbc.GetAgentsByUserRequest) (*dbc.GetAgentsByUserResponse, error) {
	agents, err := h.repo.GetByUserID(ctx, req.GetUserId())
	if err != nil {
		logger := h.logger.WithContext(ctx)
		logger.Error("Failed to get agents by user", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get agents: %v", err)
	}

	protoAgents := make([]*dbc.Agent, 0, len(agents))
	for _, agent := range agents {
		protoAgents = append(protoAgents, h.toProtoAgent(agent))
	}

	return &dbc.GetAgentsByUserResponse{
		Agents: protoAgents,
	}, nil
}

// ListAgents lists all agents
func (h *AgentHandler) ListAgents(ctx context.Context, req *dbc.ListAgentsRequest) (*dbc.ListAgentsResponse, error) {
	offset := int(req.GetOffset())
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 20 // Default limit
	}

	agents, err := h.repo.List(ctx, offset, limit)
	if err != nil {
		logger := h.logger.WithContext(ctx)
		logger.Error("Failed to list agents", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list agents: %v", err)
	}

	protoAgents := make([]*dbc.Agent, 0, len(agents))
	for _, agent := range agents {
		protoAgents = append(protoAgents, h.toProtoAgent(agent))
	}

	return &dbc.ListAgentsResponse{
		Agents: protoAgents,
	}, nil
}

// UpdateAgent updates an agent
func (h *AgentHandler) UpdateAgent(ctx context.Context, req *dbc.UpdateAgentRequest) (*dbc.Agent, error) {
	agent, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "agent not found: %s", req.GetId())
		}
		logger := h.logger.WithContext(ctx)
		logger.Error("Failed to get agent for update", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get agent: %v", err)
	}

	// Update fields
	if req.GetName() != "" {
		agent.Name = req.GetName()
	}
	if req.GetDescription() != "" {
		agent.Description = sql.NullString{String: req.GetDescription(), Valid: true}
	}
	if req.GetSystemPrompt() != "" {
		agent.SystemPrompt = req.GetSystemPrompt()
	}
	if req.GetModel() != "" {
		agent.Model = req.GetModel()
	}
	if req.GetProvider() != "" {
		agent.Provider = req.GetProvider()
	}
	if req.GetPersona() != nil {
		agent.Persona = req.GetPersona()
	}
	if req.GetMcpServers() != nil {
		agent.MCPServers = req.GetMcpServers()
	}
	agent.IsDefault = req.GetIsDefault()
	agent.IsPublic = req.GetIsPublic()
	agent.UpdatedAt = time.Now()

	if err := h.repo.Update(ctx, agent); err != nil {
		logger := h.logger.WithContext(ctx)
		logger.Error("Failed to update agent", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update agent: %v", err)
	}

	return h.toProtoAgent(agent), nil
}

// DeleteAgent deletes an agent
func (h *AgentHandler) DeleteAgent(ctx context.Context, req *dbc.DeleteAgentRequest) (*dbc.DeleteAgentResponse, error) {
	if err := h.repo.Delete(ctx, req.GetId()); err != nil {
		h.logger.Error("Failed to delete agent", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete agent: %v", err)
	}

	return &dbc.DeleteAgentResponse{Success: true}, nil
}

// toProtoAgent converts repository Agent to proto Agent
func (h *AgentHandler) toProtoAgent(agent *mysql.Agent) *dbc.Agent {
	description := ""
	if agent.Description.Valid {
		description = agent.Description.String
	}

	return &dbc.Agent{
		Id:           agent.ID,
		UserId:       agent.UserID,
		Name:         agent.Name,
		Description:  description,
		SystemPrompt: agent.SystemPrompt,
		Model:        agent.Model,
		Provider:     agent.Provider,
		Persona:      agent.Persona,
		McpServers:   agent.MCPServers,
		IsDefault:    agent.IsDefault,
		IsPublic:     agent.IsPublic,
		CreatedAt:    agent.CreatedAt.Unix(),
		UpdatedAt:    agent.UpdatedAt.Unix(),
	}
}
