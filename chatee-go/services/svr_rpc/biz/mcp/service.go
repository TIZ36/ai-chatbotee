package mcp

import (
	"context"
	"encoding/json"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/mcp"
	"chatee-go/commonlib/pool"
	dbc "chatee-go/gen/dbc"
	svrmcp "chatee-go/gen/svr/mcp"
)

// =============================================================================
// Service Configuration
// =============================================================================

// Config holds the MCP service configuration
type Config struct {
	Logger  log.Logger
	Pools   *pool.PoolManager
	Manager *mcp.Manager
}

// =============================================================================
// Service Implementation
// =============================================================================

// Service implements the MCP gRPC service
type Service struct {
	svrmcp.UnimplementedMCPServiceServer
	cfg       Config
	dbcClient dbc.MCPServerServiceClient
	dbcConn   *grpc.ClientConn
}

// NewService creates a new MCP service
func NewService(cfg Config) *Service {
	// Initialize DBC client for MCP server config operations
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
		cfg.Logger.Warn("Failed to connect to DBC service for MCP config", log.Err(err))
	} else {
		cfg.Logger.Info("DBC client initialized for MCP service", log.String("addr", dbcAddr))
	}

	return &Service{
		cfg:       cfg,
		dbcClient: dbc.NewMCPServerServiceClient(dbcConn),
		dbcConn:   dbcConn,
	}
}

// RegisterGRPC registers the service with a gRPC server
func RegisterGRPC(server *grpc.Server, svc *Service) {
	svrmcp.RegisterMCPServiceServer(server, svc)
}

// Close closes all resources
func (s *Service) Close() error {
	if s.dbcConn != nil {
		return s.dbcConn.Close()
	}
	return nil
}

// =============================================================================
// Server Management
// =============================================================================

// ListServers lists MCP servers
func (s *Service) ListServers(ctx context.Context, req *svrmcp.ListServersRequest) (*svrmcp.ListServersResponse, error) {
	var dbcReq *dbc.ListMCPServersRequest
	if req.GetEnabledOnly() {
		// Filter enabled servers - we'll need to filter after getting all servers
		dbcReq = &dbc.ListMCPServersRequest{}
	} else {
		dbcReq = &dbc.ListMCPServersRequest{}
	}

	// Get servers from DBC
	dbcResp, err := s.dbcClient.ListMCPServers(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to list MCP servers from DBC", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list servers: %v", err)
	}

	// Convert to proto and filter if needed
	servers := make([]*svrmcp.MCPServer, 0)
	for _, dbcServer := range dbcResp.GetServers() {
		if req.GetEnabledOnly() && !dbcServer.GetIsEnabled() {
			continue
		}
		if req.GetUserId() != "" && dbcServer.GetUserId() != req.GetUserId() {
			continue
		}
		servers = append(servers, s.dbcServerToProto(dbcServer))
	}

	return &svrmcp.ListServersResponse{Servers: servers}, nil
}

// GetServer gets an MCP server by ID
func (s *Service) GetServer(ctx context.Context, req *svrmcp.GetServerRequest) (*svrmcp.MCPServer, error) {
	dbcServer, err := s.dbcClient.GetMCPServer(ctx, &dbc.GetMCPServerRequest{Id: req.GetServerId()})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, status.Errorf(codes.NotFound, "server not found: %s", req.GetServerId())
		}
		s.cfg.Logger.Error("Failed to get MCP server from DBC", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get server: %v", err)
	}

	return s.dbcServerToProto(dbcServer), nil
}

// CreateServer creates a new MCP server
func (s *Service) CreateServer(ctx context.Context, req *svrmcp.CreateServerRequest) (*svrmcp.MCPServer, error) {
	// Create in DBC
	dbcReq := &dbc.CreateMCPServerRequest{
		UserId:      req.GetUserId(),
		Name:        req.GetName(),
		Description: req.GetDescription(),
		Type:        s.transportTypeToDBCType(req.GetTransport()),
		Url:         req.GetUrl(),
		AuthType:    s.authTypeToDBCType(req.GetAuthType()),
		IsEnabled:   true,
	}

	// Convert settings to DBC format
	if req.GetSettings() != nil {
		settingsJSON, err := s.settingsToJSON(req.GetSettings())
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid settings: %v", err)
		}
		dbcReq.Headers = settingsJSON
	}

	dbcServer, err := s.dbcClient.CreateMCPServer(ctx, dbcReq)
	if err != nil {
		s.cfg.Logger.Error("Failed to create MCP server in DBC", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create server: %v", err)
	}

	// Add to Manager
	if err := s.addServerToManager(dbcServer); err != nil {
		s.cfg.Logger.Warn("Failed to add server to manager", log.Err(err))
	}

	return s.dbcServerToProto(dbcServer), nil
}

// UpdateServer updates an MCP server
func (s *Service) UpdateServer(ctx context.Context, req *svrmcp.UpdateServerRequest) (*svrmcp.MCPServer, error) {
	// Update in DBC
	dbcReq := &dbc.UpdateMCPServerRequest{
		Id:          req.GetServerId(),
		Name:        req.GetName(),
		Description: req.GetDescription(),
		Type:        s.transportTypeToDBCType(req.GetTransport()),
		Url:         req.GetUrl(),
		AuthType:    s.authTypeToDBCType(req.GetAuthType()),
		IsEnabled:   req.GetEnabled(),
	}

	if req.GetSettings() != nil {
		settingsJSON, err := s.settingsToJSON(req.GetSettings())
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid settings: %v", err)
		}
		dbcReq.Headers = settingsJSON
	}

	dbcServer, err := s.dbcClient.UpdateMCPServer(ctx, dbcReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, status.Errorf(codes.NotFound, "server not found: %s", req.GetServerId())
		}
		s.cfg.Logger.Error("Failed to update MCP server in DBC", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update server: %v", err)
	}

	// Update in Manager
	if err := s.updateServerInManager(dbcServer); err != nil {
		s.cfg.Logger.Warn("Failed to update server in manager", log.Err(err))
	}

	return s.dbcServerToProto(dbcServer), nil
}

// DeleteServer deletes an MCP server
func (s *Service) DeleteServer(ctx context.Context, req *svrmcp.DeleteServerRequest) (*svrmcp.DeleteServerResponse, error) {
	// Remove from Manager first
	if err := s.cfg.Manager.RemoveServer(req.GetServerId()); err != nil {
		s.cfg.Logger.Warn("Failed to remove server from manager", log.Err(err))
	}

	// Delete from DBC
	_, err := s.dbcClient.DeleteMCPServer(ctx, &dbc.DeleteMCPServerRequest{Id: req.GetServerId()})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, status.Errorf(codes.NotFound, "server not found: %s", req.GetServerId())
		}
		s.cfg.Logger.Error("Failed to delete MCP server from DBC", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete server: %v", err)
	}

	return &svrmcp.DeleteServerResponse{Success: true}, nil
}

// =============================================================================
// MCP Protocol Operations
// =============================================================================

// Initialize initializes a connection to an MCP server
func (s *Service) Initialize(ctx context.Context, req *svrmcp.InitializeRequest) (*svrmcp.InitializeResponse, error) {
	// Get server config from DBC
	dbcServer, err := s.dbcClient.GetMCPServer(ctx, &dbc.GetMCPServerRequest{Id: req.GetServerId()})
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "server not found: %s", req.GetServerId())
	}

	// Ensure server is in Manager
	if err := s.addServerToManager(dbcServer); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to add server to manager: %v", err)
	}

	// Connect to server
	if err := s.cfg.Manager.Connect(ctx, req.GetServerId()); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to connect: %v", err)
	}

	// Get connection info
	conn, exists := s.cfg.Manager.GetServer(req.GetServerId())
	if !exists || conn.Client == nil {
		return nil, status.Errorf(codes.Internal, "server connection not available")
	}

	serverInfo := conn.Client.GetServerInfo()
	if serverInfo == nil {
		return nil, status.Errorf(codes.Internal, "server info not available")
	}

	// Build response
	capabilities := &svrmcp.ServerCapabilities{
		Tools:     serverInfo.Capabilities.Tools != nil,
		Resources: serverInfo.Capabilities.Resources != nil,
		Prompts:   serverInfo.Capabilities.Prompts != nil,
	}

	return &svrmcp.InitializeResponse{
		ProtocolVersion: "2024-11-05",
		SessionId:       req.GetServerId(), // Use server ID as session ID
		Capabilities:    capabilities,
		ServerInfo: &svrmcp.ServerInfo{
			Name:    serverInfo.Name,
			Version: serverInfo.Version,
		},
	}, nil
}

// ListTools lists tools from an MCP server
func (s *Service) ListTools(ctx context.Context, req *svrmcp.ListToolsRequest) (*svrmcp.ListToolsResponse, error) {
	tools, err := s.cfg.Manager.ListTools(ctx, req.GetServerId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list tools: %v", err)
	}

	protoTools := make([]*svrmcp.Tool, 0, len(tools))
	for _, tool := range tools {
		protoTools = append(protoTools, &svrmcp.Tool{
			Name:        tool.Name,
			Description: tool.Description,
			InputSchema: tool.InputSchema,
		})
	}

	return &svrmcp.ListToolsResponse{
		Tools:    protoTools,
		CachedAt: time.Now().Unix(),
	}, nil
}

// CallTool calls a tool on an MCP server
func (s *Service) CallTool(ctx context.Context, req *svrmcp.CallToolRequest) (*svrmcp.CallToolResponse, error) {
	// Convert arguments
	args := make(map[string]any)
	if req.GetArgumentsJson() != nil {
		if err := json.Unmarshal(req.GetArgumentsJson(), &args); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid arguments JSON: %v", err)
		}
	} else {
		// Convert map[string]string to map[string]any
		for k, v := range req.GetArguments() {
			args[k] = v
		}
	}

	// Call tool
	startTime := time.Now()
	result, err := s.cfg.Manager.CallTool(ctx, req.GetServerId(), req.GetToolName(), args)
	duration := time.Since(startTime)

	if err != nil {
		return &svrmcp.CallToolResponse{
			Success:    false,
			Error:      err.Error(),
			DurationMs: duration.Milliseconds(),
		}, nil
	}

	// Convert result
	contents := make([]*svrmcp.ToolContent, 0, len(result.Content))
	for _, content := range result.Content {
		contents = append(contents, &svrmcp.ToolContent{
			Type:     content.Type,
			Text:     content.Text,
			Data:     []byte(content.Data),
			MimeType: content.MimeType,
		})
	}

	return &svrmcp.CallToolResponse{
		Success:    !result.IsError,
		Content:    contents,
		DurationMs: duration.Milliseconds(),
	}, nil
}

// CallToolStream calls a tool with streaming response
func (s *Service) CallToolStream(req *svrmcp.CallToolRequest, stream svrmcp.MCPService_CallToolStreamServer) error {
	// For now, we'll call the tool and stream the result
	// In the future, this could support actual streaming from the MCP server
	ctx := stream.Context()

	// Convert arguments
	args := make(map[string]any)
	if req.GetArgumentsJson() != nil {
		if err := json.Unmarshal(req.GetArgumentsJson(), &args); err != nil {
			return status.Errorf(codes.InvalidArgument, "invalid arguments JSON: %v", err)
		}
	} else {
		for k, v := range req.GetArguments() {
			args[k] = v
		}
	}

	// Call tool
	startTime := time.Now()
	result, err := s.cfg.Manager.CallTool(ctx, req.GetServerId(), req.GetToolName(), args)
	duration := time.Since(startTime)

	if err != nil {
		// Send error event
		return stream.Send(&svrmcp.ToolStreamEvent{
			Event: &svrmcp.ToolStreamEvent_Error{
				Error: &svrmcp.ToolError{
					Code:      int32(codes.Internal),
					Message:   err.Error(),
					Retryable: false,
				},
			},
		})
	}

	// Stream content
	for _, content := range result.Content {
		if err := stream.Send(&svrmcp.ToolStreamEvent{
			Event: &svrmcp.ToolStreamEvent_Content{
				Content: &svrmcp.ToolContent{
					Type:     content.Type,
					Text:     content.Text,
					Data:     []byte(content.Data),
					MimeType: content.MimeType,
				},
			},
		}); err != nil {
			return err
		}
	}

	// Send complete event
	return stream.Send(&svrmcp.ToolStreamEvent{
		Event: &svrmcp.ToolStreamEvent_Complete{
			Complete: &svrmcp.ToolComplete{
				Success:    !result.IsError,
				DurationMs: duration.Milliseconds(),
			},
		},
	})
}

// =============================================================================
// Resource Operations
// =============================================================================

// ListResources lists resources from an MCP server
func (s *Service) ListResources(ctx context.Context, req *svrmcp.ListResourcesRequest) (*svrmcp.ListResourcesResponse, error) {
	resources, err := s.cfg.Manager.ListResources(ctx, req.GetServerId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list resources: %v", err)
	}

	protoResources := make([]*svrmcp.Resource, 0, len(resources))
	for _, resource := range resources {
		protoResources = append(protoResources, &svrmcp.Resource{
			Uri:         resource.URI,
			Name:        resource.Name,
			Description: resource.Description,
			MimeType:    resource.MimeType,
		})
	}

	return &svrmcp.ListResourcesResponse{Resources: protoResources}, nil
}

// ReadResource reads a resource from an MCP server
func (s *Service) ReadResource(ctx context.Context, req *svrmcp.ReadResourceRequest) (*svrmcp.ReadResourceResponse, error) {
	contents, err := s.cfg.Manager.ReadResource(ctx, req.GetServerId(), req.GetUri())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read resource: %v", err)
	}

	protoContents := make([]*svrmcp.ResourceContent, 0, len(contents))
	for _, content := range contents {
		protoContent := &svrmcp.ResourceContent{
			Uri:     content.URI,
			MimeType: content.MimeType,
		}

		if content.Type == "text" {
			protoContent.Content = &svrmcp.ResourceContent_Text{Text: content.Text}
		} else {
			protoContent.Content = &svrmcp.ResourceContent_Blob{Blob: []byte(content.Data)}
		}

		protoContents = append(protoContents, protoContent)
	}

	return &svrmcp.ReadResourceResponse{Contents: protoContents}, nil
}

// =============================================================================
// Health and Status
// =============================================================================

// HealthCheck checks the health of an MCP server
func (s *Service) HealthCheck(ctx context.Context, req *svrmcp.HealthCheckRequest) (*svrmcp.HealthCheckResponse, error) {
	conn, exists := s.cfg.Manager.GetServer(req.GetServerId())
	if !exists {
		return &svrmcp.HealthCheckResponse{
			Healthy:   false,
			Status:   "not_found",
			Error:    "server not found",
		}, nil
	}

	startTime := time.Now()
	healthy := conn.Status == mcp.StatusConnected && conn.Client != nil && conn.Client.IsConnected()
	latency := time.Since(startTime).Milliseconds()

	statusStr := "unknown"
	if conn.Status == mcp.StatusConnected {
		statusStr = "connected"
	} else if conn.Status == mcp.StatusConnecting {
		statusStr = "connecting"
	} else if conn.Status == mcp.StatusError {
		statusStr = "error"
	} else {
		statusStr = "disconnected"
	}

	return &svrmcp.HealthCheckResponse{
		Healthy:   healthy,
		Status:    statusStr,
		LatencyMs: latency,
	}, nil
}

// GetConnectionStatus gets the connection status of an MCP server
func (s *Service) GetConnectionStatus(ctx context.Context, req *svrmcp.GetConnectionStatusRequest) (*svrmcp.ConnectionStatus, error) {
	conn, exists := s.cfg.Manager.GetServer(req.GetServerId())
	if !exists {
		return nil, status.Errorf(codes.NotFound, "server not found: %s", req.GetServerId())
	}

	status := &svrmcp.ConnectionStatus{
		ServerId:      req.GetServerId(),
		Connected:     conn.Status == mcp.StatusConnected,
		SessionId:     req.GetServerId(), // Use server ID as session ID
		ProtocolVersion: "2024-11-05",
	}

	if conn.Client != nil {
		serverInfo := conn.Client.GetServerInfo()
		if serverInfo != nil {
			status.ProtocolVersion = "2024-11-05" // MCP protocol version
		}
	}

	return status, nil
}

// =============================================================================
// OAuth
// =============================================================================

// GetAuthorizationURL gets the OAuth authorization URL
func (s *Service) GetAuthorizationURL(ctx context.Context, req *svrmcp.GetAuthURLRequest) (*svrmcp.GetAuthURLResponse, error) {
	// Get server config
	_, err := s.dbcClient.GetMCPServer(ctx, &dbc.GetMCPServerRequest{Id: req.GetServerId()})
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "server not found: %s", req.GetServerId())
	}

	// Parse OAuth settings from server config
	// This is a simplified implementation - in production, you'd use a proper OAuth library
	// For now, return an error indicating OAuth is not fully implemented
	return nil, status.Errorf(codes.Unimplemented, "OAuth flow not fully implemented")
}

// ExchangeToken exchanges an OAuth code for a token
func (s *Service) ExchangeToken(ctx context.Context, req *svrmcp.ExchangeTokenRequest) (*svrmcp.ExchangeTokenResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "OAuth token exchange not fully implemented")
}

// RefreshToken refreshes an OAuth token
func (s *Service) RefreshToken(ctx context.Context, req *svrmcp.RefreshTokenRequest) (*svrmcp.RefreshTokenResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "OAuth token refresh not fully implemented")
}

// =============================================================================
// Market
// =============================================================================

// ListMarketServers lists servers from the market
func (s *Service) ListMarketServers(ctx context.Context, req *svrmcp.ListMarketRequest) (*svrmcp.ListMarketResponse, error) {
	// Market functionality is not implemented yet
	return &svrmcp.ListMarketResponse{
		Servers: []*svrmcp.MarketServer{},
		Total:   0,
	}, nil
}

// InstallMarketServer installs a server from the market
func (s *Service) InstallMarketServer(ctx context.Context, req *svrmcp.InstallMarketRequest) (*svrmcp.MCPServer, error) {
	return nil, status.Errorf(codes.Unimplemented, "market installation not implemented")
}

// =============================================================================
// Helper Methods
// =============================================================================

// dbcServerToProto converts a DBC MCPServer to proto MCPServer
func (s *Service) dbcServerToProto(dbcServer *dbc.MCPServer) *svrmcp.MCPServer {
	// Convert transport type
	transport := s.dbcTypeToTransportType(dbcServer.GetType())

	// Convert auth type
	authType := s.dbcTypeToAuthType(dbcServer.GetAuthType())

	// Parse settings from headers
	settings := s.jsonToSettings(dbcServer.GetHeaders())

	// Build status
	conn, exists := s.cfg.Manager.GetServer(dbcServer.GetId())
	status := &svrmcp.ServerStatus{
		Connected:        exists && conn.Status == mcp.StatusConnected,
		ProtocolVersion:  "2024-11-05",
		SessionId:        dbcServer.GetId(),
		LastHealthCheck:  time.Now().Unix(),
		ToolCount:        0,
	}

	if exists && conn.Client != nil {
		tools := conn.Client.GetCachedTools()
		status.ToolCount = int32(len(tools))
	}

	return &svrmcp.MCPServer{
		ServerId:    dbcServer.GetId(),
		Name:        dbcServer.GetName(),
		Description: dbcServer.GetDescription(),
		Url:         dbcServer.GetUrl(),
		Transport:   transport,
		AuthType:    authType,
		Enabled:     dbcServer.GetIsEnabled(),
		Settings:    settings,
		Status:      status,
		CreatedAt:   dbcServer.GetCreatedAt(),
		UpdatedAt:   dbcServer.GetUpdatedAt(),
	}
}

// addServerToManager adds a server to the Manager
func (s *Service) addServerToManager(dbcServer *dbc.MCPServer) error {
	// Check if already exists
	_, exists := s.cfg.Manager.GetServer(dbcServer.GetId())
	if exists {
		return nil // Already exists
	}

	// Convert DBC server to Manager config
	config := mcp.ServerConfig{
		ID:          dbcServer.GetId(),
		Name:        dbcServer.GetName(),
		Description: dbcServer.GetDescription(),
		Type:        s.dbcTypeToTransportType(dbcServer.GetType()),
		URL:         dbcServer.GetUrl(),
		AutoConnect: dbcServer.GetIsEnabled(),
	}

	// Parse command/args/env/headers from DBC format
	if dbcServer.GetCommand() != "" {
		config.Command = dbcServer.GetCommand()
	}
	if dbcServer.GetArgs() != nil {
		var args []string
		if err := json.Unmarshal(dbcServer.GetArgs(), &args); err == nil {
			config.Args = args
		}
	}
	if dbcServer.GetEnv() != nil {
		var env map[string]string
		if err := json.Unmarshal(dbcServer.GetEnv(), &env); err == nil {
			config.Env = env
		}
	}
	if dbcServer.GetHeaders() != nil {
		var headers map[string]string
		if err := json.Unmarshal(dbcServer.GetHeaders(), &headers); err == nil {
			config.Headers = headers
		}
	}

	// Parse auth config
	if dbcServer.GetAuthConfig() != nil {
		var authConfig map[string]any
		if err := json.Unmarshal(dbcServer.GetAuthConfig(), &authConfig); err == nil {
			authTypeStr := dbcServer.GetAuthType()
			config.Auth = &mcp.AuthConfig{
				Type: mcp.AuthType(authTypeStr),
			}
			if token, ok := authConfig["token"].(string); ok {
				config.Auth.Token = token
			}
		}
	}

	return s.cfg.Manager.AddServer(config)
}

// updateServerInManager updates a server in the Manager
func (s *Service) updateServerInManager(dbcServer *dbc.MCPServer) error {
	// Remove old server
	if err := s.cfg.Manager.RemoveServer(dbcServer.GetId()); err != nil {
		// Ignore if not found
	}

	// Add updated server
	return s.addServerToManager(dbcServer)
}

// transportTypeToDBCType converts proto TransportType to DBC type string
func (s *Service) transportTypeToDBCType(transport svrmcp.TransportType) string {
	switch transport {
	case svrmcp.TransportType_TRANSPORT_HTTP:
		return "http"
	case svrmcp.TransportType_TRANSPORT_SSE:
		return "sse"
	case svrmcp.TransportType_TRANSPORT_STDIO:
		return "stdio"
	case svrmcp.TransportType_TRANSPORT_WEBSOCKET:
		return "websocket"
	default:
		return "http"
	}
}

// dbcTypeToTransportType converts DBC type string to proto TransportType
func (s *Service) dbcTypeToTransportType(dbcType string) svrmcp.TransportType {
	switch dbcType {
	case "http":
		return svrmcp.TransportType_TRANSPORT_HTTP
	case "sse":
		return svrmcp.TransportType_TRANSPORT_SSE
	case "stdio":
		return svrmcp.TransportType_TRANSPORT_STDIO
	case "websocket":
		return svrmcp.TransportType_TRANSPORT_WEBSOCKET
	default:
		return svrmcp.TransportType_TRANSPORT_HTTP
	}
}

// authTypeToDBCType converts proto AuthType to DBC type string
func (s *Service) authTypeToDBCType(authType svrmcp.AuthType) string {
	switch authType {
	case svrmcp.AuthType_AUTH_BEARER:
		return "bearer"
	case svrmcp.AuthType_AUTH_OAUTH:
		return "oauth"
	case svrmcp.AuthType_AUTH_API_KEY:
		return "api_key"
	default:
		return "none"
	}
}

// dbcTypeToAuthType converts DBC type string to proto AuthType
func (s *Service) dbcTypeToAuthType(dbcType string) svrmcp.AuthType {
	switch dbcType {
	case "bearer":
		return svrmcp.AuthType_AUTH_BEARER
	case "oauth":
		return svrmcp.AuthType_AUTH_OAUTH
	case "api_key":
		return svrmcp.AuthType_AUTH_API_KEY
	default:
		return svrmcp.AuthType_AUTH_NONE
	}
}

// settingsToJSON converts proto ServerSettings to JSON bytes
func (s *Service) settingsToJSON(settings *svrmcp.ServerSettings) ([]byte, error) {
	data := make(map[string]any)
	if settings.GetTimeoutMs() > 0 {
		data["timeout_ms"] = settings.GetTimeoutMs()
	}
	if settings.GetMaxRetries() > 0 {
		data["max_retries"] = settings.GetMaxRetries()
	}
	if settings.GetUseProxy() {
		data["use_proxy"] = settings.GetUseProxy()
	}
	if settings.GetProxyUrl() != "" {
		data["proxy_url"] = settings.GetProxyUrl()
	}
	if settings.GetOauth() != nil {
		oauth := make(map[string]any)
		oauth["client_id"] = settings.GetOauth().GetClientId()
		oauth["client_secret"] = settings.GetOauth().GetClientSecret()
		oauth["authorization_url"] = settings.GetOauth().GetAuthorizationUrl()
		oauth["token_url"] = settings.GetOauth().GetTokenUrl()
		oauth["scopes"] = settings.GetOauth().GetScopes()
		oauth["redirect_uri"] = settings.GetOauth().GetRedirectUri()
		data["oauth"] = oauth
	}
	if len(settings.GetHeaders()) > 0 {
		data["headers"] = settings.GetHeaders()
	}
	if len(settings.GetExtra()) > 0 {
		data["extra"] = settings.GetExtra()
	}
	return json.Marshal(data)
}

// jsonToSettings converts JSON bytes to proto ServerSettings
func (s *Service) jsonToSettings(data []byte) *svrmcp.ServerSettings {
	if len(data) == 0 {
		return &svrmcp.ServerSettings{}
	}

	var settingsMap map[string]any
	if err := json.Unmarshal(data, &settingsMap); err != nil {
		return &svrmcp.ServerSettings{}
	}

	settings := &svrmcp.ServerSettings{}
	if timeout, ok := settingsMap["timeout_ms"].(float64); ok {
		settings.TimeoutMs = int32(timeout)
	}
	if retries, ok := settingsMap["max_retries"].(float64); ok {
		settings.MaxRetries = int32(retries)
	}
	if useProxy, ok := settingsMap["use_proxy"].(bool); ok {
		settings.UseProxy = useProxy
	}
	if proxyURL, ok := settingsMap["proxy_url"].(string); ok {
		settings.ProxyUrl = proxyURL
	}
	if oauthMap, ok := settingsMap["oauth"].(map[string]any); ok {
		oauth := &svrmcp.OAuthSettings{}
		if clientID, ok := oauthMap["client_id"].(string); ok {
			oauth.ClientId = clientID
		}
		if clientSecret, ok := oauthMap["client_secret"].(string); ok {
			oauth.ClientSecret = clientSecret
		}
		if authURL, ok := oauthMap["authorization_url"].(string); ok {
			oauth.AuthorizationUrl = authURL
		}
		if tokenURL, ok := oauthMap["token_url"].(string); ok {
			oauth.TokenUrl = tokenURL
		}
		if scopes, ok := oauthMap["scopes"].([]interface{}); ok {
			oauth.Scopes = make([]string, 0, len(scopes))
			for _, scope := range scopes {
				if s, ok := scope.(string); ok {
					oauth.Scopes = append(oauth.Scopes, s)
				}
			}
		}
		if redirectURI, ok := oauthMap["redirect_uri"].(string); ok {
			oauth.RedirectUri = redirectURI
		}
		settings.Oauth = oauth
	}
	if headers, ok := settingsMap["headers"].(map[string]any); ok {
		settings.Headers = make(map[string]string)
		for k, v := range headers {
			if s, ok := v.(string); ok {
				settings.Headers[k] = s
			}
		}
	}
	if extra, ok := settingsMap["extra"].(map[string]any); ok {
		settings.Extra = make(map[string]string)
		for k, v := range extra {
			if s, ok := v.(string); ok {
				settings.Extra[k] = s
			}
		}
	}

	return settings
}

