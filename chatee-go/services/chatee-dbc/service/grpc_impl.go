package service

import (
	"context"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/snowflake"
	pb "chatee-go/gen/dbc"
	"chatee-go/services/chatee-dbc/repository"
)

// =============================================================================
// UserService Implementation
// =============================================================================

func (s *DBCService) CreateUser(ctx context.Context, req *pb.CreateUserRequest) (*pb.User, error) {
	user := &repository.User{
		ID:          snowflake.Generate().String(),
		Email:       req.Email,
		Name:        req.Name,
		Avatar:      repository.NullString{String: req.Avatar, Valid: req.Avatar != ""},
		Role:        req.Role,
		Preferences: req.Preferences,
		Metadata:    req.Metadata,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.repos.User.Create(ctx, user); err != nil {
		s.logger.Error("Failed to create user", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to create user: %v", err)
	}

	return toProtoUser(user), nil
}

func (s *DBCService) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
	user, err := s.repos.User.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get user", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}

	return toProtoUser(user), nil
}

func (s *DBCService) GetUserByEmail(ctx context.Context, req *pb.GetUserByEmailRequest) (*pb.User, error) {
	user, err := s.repos.User.GetByEmail(ctx, req.Email)
	if err != nil {
		s.logger.Error("Failed to get user by email", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}

	return toProtoUser(user), nil
}

func (s *DBCService) UpdateUser(ctx context.Context, req *pb.UpdateUserRequest) (*pb.User, error) {
	user, err := s.repos.User.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get user for update", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}

	if req.Name != "" {
		user.Name = req.Name
	}
	if req.Avatar != "" {
		user.Avatar = repository.NullString{String: req.Avatar, Valid: true}
	}
	if req.Role != "" {
		user.Role = req.Role
	}
	if req.Preferences != nil {
		user.Preferences = req.Preferences
	}
	if req.Metadata != nil {
		user.Metadata = req.Metadata
	}
	user.UpdatedAt = time.Now()

	if err := s.repos.User.Update(ctx, user); err != nil {
		s.logger.Error("Failed to update user", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to update user: %v", err)
	}

	return toProtoUser(user), nil
}

func (s *DBCService) DeleteUser(ctx context.Context, req *pb.DeleteUserRequest) (*pb.DeleteUserResponse, error) {
	if err := s.repos.User.Delete(ctx, req.Id); err != nil {
		s.logger.Error("Failed to delete user", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to delete user: %v", err)
	}

	return &pb.DeleteUserResponse{Success: true}, nil
}

func (s *DBCService) ListUsers(ctx context.Context, req *pb.ListUsersRequest) (*pb.ListUsersResponse, error) {
	users, err := s.repos.User.List(ctx, int(req.Offset), int(req.Limit))
	if err != nil {
		s.logger.Error("Failed to list users", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to list users: %v", err)
	}

	protoUsers := make([]*pb.User, len(users))
	for i, user := range users {
		protoUsers[i] = toProtoUser(user)
	}

	return &pb.ListUsersResponse{
		Users: protoUsers,
		Total: int32(len(protoUsers)),
	}, nil
}

// =============================================================================
// SessionService Implementation
// =============================================================================

func (s *DBCService) CreateSession(ctx context.Context, req *pb.CreateSessionRequest) (*pb.Session, error) {
	session := &repository.Session{
		ID:        snowflake.Generate().String(),
		UserID:    req.UserId,
		AgentID:   req.AgentId,
		Title:     req.Title,
		Status:    "active",
		Metadata:  req.Metadata,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.repos.Session.Create(ctx, session); err != nil {
		s.logger.Error("Failed to create session", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to create session: %v", err)
	}

	return toProtoSession(session), nil
}

func (s *DBCService) GetSession(ctx context.Context, req *pb.GetSessionRequest) (*pb.Session, error) {
	session, err := s.repos.Session.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get session", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get session: %v", err)
	}

	return toProtoSession(session), nil
}

func (s *DBCService) GetSessionsByUser(ctx context.Context, req *pb.GetSessionsByUserRequest) (*pb.GetSessionsByUserResponse, error) {
	sessions, err := s.repos.Session.GetByUserID(ctx, req.UserId, int(req.Offset), int(req.Limit))
	if err != nil {
		s.logger.Error("Failed to get sessions by user", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get sessions: %v", err)
	}

	protoSessions := make([]*pb.Session, len(sessions))
	for i, session := range sessions {
		protoSessions[i] = toProtoSession(session)
	}

	return &pb.GetSessionsByUserResponse{
		Sessions: protoSessions,
		Total:    int32(len(protoSessions)),
	}, nil
}

func (s *DBCService) UpdateSession(ctx context.Context, req *pb.UpdateSessionRequest) (*pb.Session, error) {
	session, err := s.repos.Session.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get session for update", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get session: %v", err)
	}

	if req.Title != "" {
		session.Title = req.Title
	}
	if req.Status != "" {
		session.Status = req.Status
	}
	if req.Metadata != nil {
		session.Metadata = req.Metadata
	}
	session.UpdatedAt = time.Now()

	if err := s.repos.Session.Update(ctx, session); err != nil {
		s.logger.Error("Failed to update session", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to update session: %v", err)
	}

	return toProtoSession(session), nil
}

func (s *DBCService) DeleteSession(ctx context.Context, req *pb.DeleteSessionRequest) (*pb.DeleteSessionResponse, error) {
	if err := s.repos.Session.Delete(ctx, req.Id); err != nil {
		s.logger.Error("Failed to delete session", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to delete session: %v", err)
	}

	return &pb.DeleteSessionResponse{Success: true}, nil
}

// =============================================================================
// Helper Functions - Convert between repository and proto types
// =============================================================================

func toProtoUser(user *repository.User) *pb.User {
	return &pb.User{
		Id:          user.ID,
		Email:       user.Email,
		Name:        user.Name,
		Avatar:      user.Avatar.String,
		Role:        user.Role,
		Preferences: user.Preferences,
		Metadata:    user.Metadata,
		CreatedAt:   user.CreatedAt.UnixMilli(),
		UpdatedAt:   user.UpdatedAt.UnixMilli(),
	}
}

func toProtoSession(session *repository.Session) *pb.Session {
	return &pb.Session{
		Id:        session.ID,
		UserId:    session.UserID,
		AgentId:   session.AgentID,
		Title:     session.Title,
		Status:    session.Status,
		Metadata:  session.Metadata,
		CreatedAt: session.CreatedAt.UnixMilli(),
		UpdatedAt: session.UpdatedAt.UnixMilli(),
	}
}

// =============================================================================
// AgentService Implementation
// =============================================================================

func (s *DBCService) CreateAgent(ctx context.Context, req *pb.CreateAgentRequest) (*pb.Agent, error) {
	agent := &repository.Agent{
		ID:           snowflake.Generate().String(),
		UserID:       req.UserId,
		Name:         req.Name,
		Description:  repository.NullString{String: req.Description, Valid: req.Description != ""},
		SystemPrompt: req.SystemPrompt,
		Model:        req.Model,
		Provider:     req.Provider,
		Persona:      req.Persona,
		MCPServers:   req.McpServers,
		IsDefault:    req.IsDefault,
		IsPublic:     req.IsPublic,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := s.repos.Agent.Create(ctx, agent); err != nil {
		s.logger.Error("Failed to create agent", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to create agent: %v", err)
	}

	return toProtoAgent(agent), nil
}

func (s *DBCService) GetAgent(ctx context.Context, req *pb.GetAgentRequest) (*pb.Agent, error) {
	agent, err := s.repos.Agent.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get agent", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get agent: %v", err)
	}

	return toProtoAgent(agent), nil
}

func (s *DBCService) GetAgentsByUser(ctx context.Context, req *pb.GetAgentsByUserRequest) (*pb.GetAgentsByUserResponse, error) {
	agents, err := s.repos.Agent.GetByUserID(ctx, req.UserId)
	if err != nil {
		s.logger.Error("Failed to get agents by user", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get agents: %v", err)
	}

	protoAgents := make([]*pb.Agent, len(agents))
	for i, agent := range agents {
		protoAgents[i] = toProtoAgent(agent)
	}

	return &pb.GetAgentsByUserResponse{Agents: protoAgents}, nil
}

func (s *DBCService) ListAgents(ctx context.Context, req *pb.ListAgentsRequest) (*pb.ListAgentsResponse, error) {
	agents, err := s.repos.Agent.List(ctx, int(req.Offset), int(req.Limit))
	if err != nil {
		s.logger.Error("Failed to list agents", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to list agents: %v", err)
	}

	protoAgents := make([]*pb.Agent, len(agents))
	for i, agent := range agents {
		protoAgents[i] = toProtoAgent(agent)
	}

	return &pb.ListAgentsResponse{
		Agents: protoAgents,
		Total:  int32(len(protoAgents)),
	}, nil
}

func (s *DBCService) UpdateAgent(ctx context.Context, req *pb.UpdateAgentRequest) (*pb.Agent, error) {
	agent, err := s.repos.Agent.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get agent for update", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get agent: %v", err)
	}

	if req.Name != "" {
		agent.Name = req.Name
	}
	if req.Description != "" {
		agent.Description = repository.NullString{String: req.Description, Valid: true}
	}
	if req.SystemPrompt != "" {
		agent.SystemPrompt = req.SystemPrompt
	}
	if req.Model != "" {
		agent.Model = req.Model
	}
	if req.Provider != "" {
		agent.Provider = req.Provider
	}
	if req.Persona != nil {
		agent.Persona = req.Persona
	}
	if req.McpServers != nil {
		agent.MCPServers = req.McpServers
	}
	agent.IsDefault = req.IsDefault
	agent.IsPublic = req.IsPublic
	agent.UpdatedAt = time.Now()

	if err := s.repos.Agent.Update(ctx, agent); err != nil {
		s.logger.Error("Failed to update agent", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to update agent: %v", err)
	}

	return toProtoAgent(agent), nil
}

func (s *DBCService) DeleteAgent(ctx context.Context, req *pb.DeleteAgentRequest) (*pb.DeleteAgentResponse, error) {
	if err := s.repos.Agent.Delete(ctx, req.Id); err != nil {
		s.logger.Error("Failed to delete agent", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to delete agent: %v", err)
	}

	return &pb.DeleteAgentResponse{Success: true}, nil
}

// =============================================================================
// MessageService Implementation
// =============================================================================

func (s *DBCService) CreateMessage(ctx context.Context, req *pb.CreateMessageRequest) (*pb.Message, error) {
	message := &repository.Message{
		ID:         snowflake.Generate().String(),
		SessionID:  req.SessionId,
		Role:       req.Role,
		Content:    req.Content,
		ToolCalls:  req.ToolCalls,
		ToolCallID: repository.NullString{String: req.ToolCallId, Valid: req.ToolCallId != ""},
		Metadata:   req.Metadata,
		CreatedAt:  time.Now(),
	}

	if err := s.repos.Message.Create(ctx, message); err != nil {
		s.logger.Error("Failed to create message", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to create message: %v", err)
	}

	return toProtoMessage(message), nil
}

func (s *DBCService) GetMessage(ctx context.Context, req *pb.GetMessageRequest) (*pb.Message, error) {
	message, err := s.repos.Message.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get message", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get message: %v", err)
	}

	return toProtoMessage(message), nil
}

func (s *DBCService) GetMessagesBySession(ctx context.Context, req *pb.GetMessagesBySessionRequest) (*pb.GetMessagesBySessionResponse, error) {
	messages, err := s.repos.Message.GetBySessionID(ctx, req.SessionId, int(req.Offset), int(req.Limit))
	if err != nil {
		s.logger.Error("Failed to get messages by session", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get messages: %v", err)
	}

	protoMessages := make([]*pb.Message, len(messages))
	for i, msg := range messages {
		protoMessages[i] = toProtoMessage(msg)
	}

	return &pb.GetMessagesBySessionResponse{
		Messages: protoMessages,
		Total:    int32(len(protoMessages)),
	}, nil
}

func (s *DBCService) UpdateMessage(ctx context.Context, req *pb.UpdateMessageRequest) (*pb.Message, error) {
	message, err := s.repos.Message.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get message for update", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get message: %v", err)
	}

	if req.Content != "" {
		message.Content = req.Content
	}
	if req.Metadata != nil {
		message.Metadata = req.Metadata
	}

	if err := s.repos.Message.Update(ctx, message); err != nil {
		s.logger.Error("Failed to update message", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to update message: %v", err)
	}

	return toProtoMessage(message), nil
}

func (s *DBCService) DeleteMessage(ctx context.Context, req *pb.DeleteMessageRequest) (*pb.DeleteMessageResponse, error) {
	if err := s.repos.Message.Delete(ctx, req.Id); err != nil {
		s.logger.Error("Failed to delete message", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to delete message: %v", err)
	}

	return &pb.DeleteMessageResponse{Success: true}, nil
}

// =============================================================================
// LLMConfigService Implementation
// =============================================================================

func (s *DBCService) CreateLLMConfig(ctx context.Context, req *pb.CreateLLMConfigRequest) (*pb.LLMConfig, error) {
	config := &repository.LLMConfig{
		ID:        snowflake.Generate().String(),
		Name:      req.Name,
		Provider:  req.Provider,
		APIKey:    req.ApiKey,
		BaseURL:   repository.NullString{String: req.BaseUrl, Valid: req.BaseUrl != ""},
		Models:    req.Models,
		IsDefault: req.IsDefault,
		IsEnabled: req.IsEnabled,
		Settings:  req.Settings,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.repos.LLMConfig.Create(ctx, config); err != nil {
		s.logger.Error("Failed to create LLM config", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to create LLM config: %v", err)
	}

	return toProtoLLMConfig(config), nil
}

func (s *DBCService) GetLLMConfig(ctx context.Context, req *pb.GetLLMConfigRequest) (*pb.LLMConfig, error) {
	config, err := s.repos.LLMConfig.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get LLM config", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get LLM config: %v", err)
	}

	return toProtoLLMConfig(config), nil
}

func (s *DBCService) GetDefaultLLMConfig(ctx context.Context, req *pb.GetDefaultLLMConfigRequest) (*pb.LLMConfig, error) {
	config, err := s.repos.LLMConfig.GetDefault(ctx)
	if err != nil {
		s.logger.Error("Failed to get default LLM config", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get default LLM config: %v", err)
	}

	return toProtoLLMConfig(config), nil
}

func (s *DBCService) GetLLMConfigsByProvider(ctx context.Context, req *pb.GetLLMConfigsByProviderRequest) (*pb.GetLLMConfigsByProviderResponse, error) {
	configs, err := s.repos.LLMConfig.GetByProvider(ctx, req.Provider)
	if err != nil {
		s.logger.Error("Failed to get LLM configs by provider", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get LLM configs: %v", err)
	}

	protoConfigs := make([]*pb.LLMConfig, len(configs))
	for i, config := range configs {
		protoConfigs[i] = toProtoLLMConfig(config)
	}

	return &pb.GetLLMConfigsByProviderResponse{Configs: protoConfigs}, nil
}

func (s *DBCService) ListLLMConfigs(ctx context.Context, req *pb.ListLLMConfigsRequest) (*pb.ListLLMConfigsResponse, error) {
	configs, err := s.repos.LLMConfig.List(ctx)
	if err != nil {
		s.logger.Error("Failed to list LLM configs", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to list LLM configs: %v", err)
	}

	protoConfigs := make([]*pb.LLMConfig, len(configs))
	for i, config := range configs {
		protoConfigs[i] = toProtoLLMConfig(config)
	}

	return &pb.ListLLMConfigsResponse{Configs: protoConfigs}, nil
}

func (s *DBCService) UpdateLLMConfig(ctx context.Context, req *pb.UpdateLLMConfigRequest) (*pb.LLMConfig, error) {
	config, err := s.repos.LLMConfig.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get LLM config for update", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get LLM config: %v", err)
	}

	if req.Name != "" {
		config.Name = req.Name
	}
	if req.ApiKey != "" {
		config.APIKey = req.ApiKey
	}
	if req.BaseUrl != "" {
		config.BaseURL = repository.NullString{String: req.BaseUrl, Valid: true}
	}
	if req.Models != nil {
		config.Models = req.Models
	}
	config.IsDefault = req.IsDefault
	config.IsEnabled = req.IsEnabled
	if req.Settings != nil {
		config.Settings = req.Settings
	}
	config.UpdatedAt = time.Now()

	if err := s.repos.LLMConfig.Update(ctx, config); err != nil {
		s.logger.Error("Failed to update LLM config", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to update LLM config: %v", err)
	}

	return toProtoLLMConfig(config), nil
}

func (s *DBCService) DeleteLLMConfig(ctx context.Context, req *pb.DeleteLLMConfigRequest) (*pb.DeleteLLMConfigResponse, error) {
	if err := s.repos.LLMConfig.Delete(ctx, req.Id); err != nil {
		s.logger.Error("Failed to delete LLM config", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to delete LLM config: %v", err)
	}

	return &pb.DeleteLLMConfigResponse{Success: true}, nil
}

// =============================================================================
// MCPServerService Implementation
// =============================================================================

func (s *DBCService) CreateMCPServer(ctx context.Context, req *pb.CreateMCPServerRequest) (*pb.MCPServer, error) {
	server := &repository.MCPServer{
		ID:          snowflake.Generate().String(),
		UserID:      req.UserId,
		Name:        req.Name,
		Description: repository.NullString{String: req.Description, Valid: req.Description != ""},
		Type:        req.Type,
		URL:         repository.NullString{String: req.Url, Valid: req.Url != ""},
		Command:     repository.NullString{String: req.Command, Valid: req.Command != ""},
		Args:        req.Args,
		Env:         req.Env,
		Headers:     req.Headers,
		AuthType:    req.AuthType,
		AuthConfig:  req.AuthConfig,
		IsEnabled:   req.IsEnabled,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.repos.MCPServer.Create(ctx, server); err != nil {
		s.logger.Error("Failed to create MCP server", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to create MCP server: %v", err)
	}

	return toProtoMCPServer(server), nil
}

func (s *DBCService) GetMCPServer(ctx context.Context, req *pb.GetMCPServerRequest) (*pb.MCPServer, error) {
	server, err := s.repos.MCPServer.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get MCP server", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get MCP server: %v", err)
	}

	return toProtoMCPServer(server), nil
}

func (s *DBCService) GetMCPServersByUser(ctx context.Context, req *pb.GetMCPServersByUserRequest) (*pb.GetMCPServersByUserResponse, error) {
	servers, err := s.repos.MCPServer.GetByUserID(ctx, req.UserId)
	if err != nil {
		s.logger.Error("Failed to get MCP servers by user", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get MCP servers: %v", err)
	}

	protoServers := make([]*pb.MCPServer, len(servers))
	for i, server := range servers {
		protoServers[i] = toProtoMCPServer(server)
	}

	return &pb.GetMCPServersByUserResponse{Servers: protoServers}, nil
}

func (s *DBCService) ListMCPServers(ctx context.Context, req *pb.ListMCPServersRequest) (*pb.ListMCPServersResponse, error) {
	servers, err := s.repos.MCPServer.List(ctx)
	if err != nil {
		s.logger.Error("Failed to list MCP servers", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to list MCP servers: %v", err)
	}

	protoServers := make([]*pb.MCPServer, len(servers))
	for i, server := range servers {
		protoServers[i] = toProtoMCPServer(server)
	}

	return &pb.ListMCPServersResponse{Servers: protoServers}, nil
}

func (s *DBCService) UpdateMCPServer(ctx context.Context, req *pb.UpdateMCPServerRequest) (*pb.MCPServer, error) {
	server, err := s.repos.MCPServer.GetByID(ctx, req.Id)
	if err != nil {
		s.logger.Error("Failed to get MCP server for update", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to get MCP server: %v", err)
	}

	if req.Name != "" {
		server.Name = req.Name
	}
	if req.Description != "" {
		server.Description = repository.NullString{String: req.Description, Valid: true}
	}
	if req.Type != "" {
		server.Type = req.Type
	}
	if req.Url != "" {
		server.URL = repository.NullString{String: req.Url, Valid: true}
	}
	if req.Command != "" {
		server.Command = repository.NullString{String: req.Command, Valid: true}
	}
	if req.Args != nil {
		server.Args = req.Args
	}
	if req.Env != nil {
		server.Env = req.Env
	}
	if req.Headers != nil {
		server.Headers = req.Headers
	}
	if req.AuthType != "" {
		server.AuthType = req.AuthType
	}
	if req.AuthConfig != nil {
		server.AuthConfig = req.AuthConfig
	}
	server.IsEnabled = req.IsEnabled
	server.UpdatedAt = time.Now()

	if err := s.repos.MCPServer.Update(ctx, server); err != nil {
		s.logger.Error("Failed to update MCP server", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to update MCP server: %v", err)
	}

	return toProtoMCPServer(server), nil
}

func (s *DBCService) DeleteMCPServer(ctx context.Context, req *pb.DeleteMCPServerRequest) (*pb.DeleteMCPServerResponse, error) {
	if err := s.repos.MCPServer.Delete(ctx, req.Id); err != nil {
		s.logger.Error("Failed to delete MCP server", log.Error(err))
		return nil, status.Errorf(codes.Internal, "failed to delete MCP server: %v", err)
	}

	return &pb.DeleteMCPServerResponse{Success: true}, nil
}

// =============================================================================
// Additional Helper Functions
// =============================================================================

func toProtoAgent(agent *repository.Agent) *pb.Agent {
	return &pb.Agent{
		Id:           agent.ID,
		UserId:       agent.UserID,
		Name:         agent.Name,
		Description:  agent.Description.String,
		SystemPrompt: agent.SystemPrompt,
		Model:        agent.Model,
		Provider:     agent.Provider,
		Persona:      agent.Persona,
		McpServers:   agent.MCPServers,
		IsDefault:    agent.IsDefault,
		IsPublic:     agent.IsPublic,
		CreatedAt:    agent.CreatedAt.UnixMilli(),
		UpdatedAt:    agent.UpdatedAt.UnixMilli(),
	}
}

func toProtoMessage(message *repository.Message) *pb.Message {
	return &pb.Message{
		Id:         message.ID,
		SessionId:  message.SessionID,
		Role:       message.Role,
		Content:    message.Content,
		ToolCalls:  message.ToolCalls,
		ToolCallId: message.ToolCallID.String,
		Metadata:   message.Metadata,
		CreatedAt:  message.CreatedAt.UnixMilli(),
	}
}

func toProtoLLMConfig(config *repository.LLMConfig) *pb.LLMConfig {
	return &pb.LLMConfig{
		Id:        config.ID,
		Name:      config.Name,
		Provider:  config.Provider,
		ApiKey:    config.APIKey,
		BaseUrl:   config.BaseURL.String,
		Models:    config.Models,
		IsDefault: config.IsDefault,
		IsEnabled: config.IsEnabled,
		Settings:  config.Settings,
		CreatedAt: config.CreatedAt.UnixMilli(),
		UpdatedAt: config.UpdatedAt.UnixMilli(),
	}
}

func toProtoMCPServer(server *repository.MCPServer) *pb.MCPServer {
	return &pb.MCPServer{
		Id:          server.ID,
		UserId:      server.UserID,
		Name:        server.Name,
		Description: server.Description.String,
		Type:        server.Type,
		Url:         server.URL.String,
		Command:     server.Command.String,
		Args:        server.Args,
		Env:         server.Env,
		Headers:     server.Headers,
		AuthType:    server.AuthType,
		AuthConfig:  server.AuthConfig,
		IsEnabled:   server.IsEnabled,
		CreatedAt:   server.CreatedAt.UnixMilli(),
		UpdatedAt:   server.UpdatedAt.UnixMilli(),
	}
}
