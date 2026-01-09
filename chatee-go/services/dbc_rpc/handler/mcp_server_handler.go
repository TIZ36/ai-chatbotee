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

// MCPServerHandler implements MCPServerService gRPC interface
type MCPServerHandler struct {
	dbc.UnimplementedMCPServerServiceServer
	
	repo   repository.MCPServerRepository
	logger log.Logger
}

// NewMCPServerHandler creates a new MCP server handler
func NewMCPServerHandler(repo repository.MCPServerRepository, logger log.Logger) *MCPServerHandler {
	return &MCPServerHandler{
		repo:   repo,
		logger: logger,
	}
}

// Register registers the handler with gRPC server
func (h *MCPServerHandler) Register(server *grpc.Server) {
	dbc.RegisterMCPServerServiceServer(server, h)
}

// CreateMCPServer creates a new MCP server
func (h *MCPServerHandler) CreateMCPServer(ctx context.Context, req *dbc.CreateMCPServerRequest) (*dbc.MCPServer, error) {
	serverID := snowflake.GenerateTypedID("mcp_server")
	now := time.Now()
	
	url := sql.NullString{}
	if req.GetUrl() != "" {
		url = sql.NullString{String: req.GetUrl(), Valid: true}
	}
	
	command := sql.NullString{}
	if req.GetCommand() != "" {
		command = sql.NullString{String: req.GetCommand(), Valid: true}
	}
	
	description := sql.NullString{}
	if req.GetDescription() != "" {
		description = sql.NullString{String: req.GetDescription(), Valid: true}
	}
	
	server := &repository.MCPServer{
		ID:          serverID,
		UserID:      req.GetUserId(),
		Name:        req.GetName(),
		Description: description,
		Type:        req.GetType(),
		URL:         url,
		Command:     command,
		Args:        req.GetArgs(),
		Env:         req.GetEnv(),
		Headers:     req.GetHeaders(),
		AuthType:    req.GetAuthType(),
		AuthConfig:  req.GetAuthConfig(),
		IsEnabled:   req.GetIsEnabled(),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	
	if err := h.repo.Create(ctx, server); err != nil {
		h.logger.Error("Failed to create MCP server", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create MCP server: %v", err)
	}
	
	return h.toProtoMCPServer(server), nil
}

// GetMCPServer retrieves an MCP server by ID
func (h *MCPServerHandler) GetMCPServer(ctx context.Context, req *dbc.GetMCPServerRequest) (*dbc.MCPServer, error) {
	server, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "MCP server not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get MCP server", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get MCP server: %v", err)
	}
	
	return h.toProtoMCPServer(server), nil
}

// GetMCPServersByUser retrieves MCP servers for a user
func (h *MCPServerHandler) GetMCPServersByUser(ctx context.Context, req *dbc.GetMCPServersByUserRequest) (*dbc.GetMCPServersByUserResponse, error) {
	servers, err := h.repo.GetByUserID(ctx, req.GetUserId())
	if err != nil {
		h.logger.Error("Failed to get MCP servers by user", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get MCP servers: %v", err)
	}
	
	protoServers := make([]*dbc.MCPServer, 0, len(servers))
	for _, server := range servers {
		protoServers = append(protoServers, h.toProtoMCPServer(server))
	}
	
	return &dbc.GetMCPServersByUserResponse{
		Servers: protoServers,
	}, nil
}

// ListMCPServers lists all MCP servers
func (h *MCPServerHandler) ListMCPServers(ctx context.Context, req *dbc.ListMCPServersRequest) (*dbc.ListMCPServersResponse, error) {
	servers, err := h.repo.List(ctx)
	if err != nil {
		h.logger.Error("Failed to list MCP servers", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list MCP servers: %v", err)
	}
	
	protoServers := make([]*dbc.MCPServer, 0, len(servers))
	for _, server := range servers {
		protoServers = append(protoServers, h.toProtoMCPServer(server))
	}
	
	return &dbc.ListMCPServersResponse{
		Servers: protoServers,
	}, nil
}

// UpdateMCPServer updates an MCP server
func (h *MCPServerHandler) UpdateMCPServer(ctx context.Context, req *dbc.UpdateMCPServerRequest) (*dbc.MCPServer, error) {
	server, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "MCP server not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get MCP server for update", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get MCP server: %v", err)
	}
	
	// Update fields
	if req.GetName() != "" {
		server.Name = req.GetName()
	}
	if req.GetDescription() != "" {
		server.Description = sql.NullString{String: req.GetDescription(), Valid: true}
	}
	if req.GetType() != "" {
		server.Type = req.GetType()
	}
	if req.GetUrl() != "" {
		server.URL = sql.NullString{String: req.GetUrl(), Valid: true}
	}
	if req.GetCommand() != "" {
		server.Command = sql.NullString{String: req.GetCommand(), Valid: true}
	}
	if req.GetArgs() != nil {
		server.Args = req.GetArgs()
	}
	if req.GetEnv() != nil {
		server.Env = req.GetEnv()
	}
	if req.GetHeaders() != nil {
		server.Headers = req.GetHeaders()
	}
	if req.GetAuthType() != "" {
		server.AuthType = req.GetAuthType()
	}
	if req.GetAuthConfig() != nil {
		server.AuthConfig = req.GetAuthConfig()
	}
	server.IsEnabled = req.GetIsEnabled()
	server.UpdatedAt = time.Now()
	
	if err := h.repo.Update(ctx, server); err != nil {
		h.logger.Error("Failed to update MCP server", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update MCP server: %v", err)
	}
	
	return h.toProtoMCPServer(server), nil
}

// DeleteMCPServer deletes an MCP server
func (h *MCPServerHandler) DeleteMCPServer(ctx context.Context, req *dbc.DeleteMCPServerRequest) (*dbc.DeleteMCPServerResponse, error) {
	if err := h.repo.Delete(ctx, req.GetId()); err != nil {
		h.logger.Error("Failed to delete MCP server", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete MCP server: %v", err)
	}
	
	return &dbc.DeleteMCPServerResponse{Success: true}, nil
}

// toProtoMCPServer converts repository MCPServer to proto MCPServer
func (h *MCPServerHandler) toProtoMCPServer(server *repository.MCPServer) *dbc.MCPServer {
	url := ""
	if server.URL.Valid {
		url = server.URL.String
	}
	
	command := ""
	if server.Command.Valid {
		command = server.Command.String
	}
	
	description := ""
	if server.Description.Valid {
		description = server.Description.String
	}
	
	return &dbc.MCPServer{
		Id:          server.ID,
		UserId:      server.UserID,
		Name:        server.Name,
		Description: description,
		Type:        server.Type,
		Url:         url,
		Command:     command,
		Args:        server.Args,
		Env:         server.Env,
		Headers:     server.Headers,
		AuthType:    server.AuthType,
		AuthConfig:  server.AuthConfig,
		IsEnabled:   server.IsEnabled,
		CreatedAt:   server.CreatedAt.Unix(),
		UpdatedAt:   server.UpdatedAt.Unix(),
	}
}

