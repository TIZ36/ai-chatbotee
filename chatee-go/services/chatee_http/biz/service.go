package service

import (
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	dbc "chatee-go/gen/dbc"
	imchat "chatee-go/gen/im/chat/im"
	imthread "chatee-go/gen/im/thread/im"
	svragent "chatee-go/gen/svr/agent/svr"
	svrllm "chatee-go/gen/svr/llm/svr"
	svrmcp "chatee-go/gen/svr/mcp/svr"
	svruser "chatee-go/gen/svr/user/svr"
)

// HTTPService provides business logic for HTTP handlers
type HTTPService struct {
	Config *config.Config
	Logger log.Logger

	// gRPC clients to other services
	DBCConn   *grpc.ClientConn
	SVRConn   *grpc.ClientConn
	IMConn    *grpc.ClientConn
	ConnConn  *grpc.ClientConn // Connection service (for WebSocket status)

	// DBC service clients
	DBCUser    dbc.UserServiceClient
	DBCSession dbc.SessionServiceClient
	DBCAgent   dbc.AgentServiceClient
	DBCMessage dbc.MessageServiceClient
	DBCCache   dbc.CacheServiceClient
	DBCChroma  dbc.ChromaServiceClient
	DBCLLM     dbc.LLMConfigServiceClient
	DBCMCP     dbc.MCPServerServiceClient

	// SVR service clients
	SVRUser   svruser.UserServiceClient
	SVRAgent  svragent.AgentServiceClient
	SVRLLM    svrllm.LLMServiceClient
	SVRMCP    svrmcp.MCPServiceClient

	// IM service clients
	IMThread imthread.ThreadServiceClient
	IMChat   imchat.ChatServiceClient
}

// NewHTTPService creates a new HTTP service
func NewHTTPService(cfg *config.Config, logger log.Logger) (*HTTPService, error) {
	svc := &HTTPService{
		Config: cfg,
		Logger: logger,
	}

	// Initialize DBC gRPC client
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
		return nil, fmt.Errorf("failed to connect to DBC service: %w", err)
	}
	svc.DBCConn = dbcConn
	svc.DBCUser = dbc.NewUserServiceClient(dbcConn)
	svc.DBCSession = dbc.NewSessionServiceClient(dbcConn)
	svc.DBCAgent = dbc.NewAgentServiceClient(dbcConn)
	svc.DBCMessage = dbc.NewMessageServiceClient(dbcConn)
	svc.DBCCache = dbc.NewCacheServiceClient(dbcConn)
	svc.DBCChroma = dbc.NewChromaServiceClient(dbcConn)
	svc.DBCLLM = dbc.NewLLMConfigServiceClient(dbcConn)
	svc.DBCMCP = dbc.NewMCPServerServiceClient(dbcConn)
	logger.Info("DBC client initialized", log.String("addr", dbcAddr))

	// Initialize SVR gRPC client
	svrAddr := os.Getenv("CHATEE_GRPC_SVR_ADDR")
	if svrAddr == "" {
		svrAddr = "localhost:9092" // Default SVR RPC address
	}
	svrConn, err := grpc.Dial(
		svrAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                10 * time.Second,
			Timeout:             3 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to SVR service: %w", err)
	}
	svc.SVRConn = svrConn
	svc.SVRUser = svruser.NewUserServiceClient(svrConn)
	svc.SVRAgent = svragent.NewAgentServiceClient(svrConn)
	svc.SVRLLM = svrllm.NewLLMServiceClient(svrConn)
	svc.SVRMCP = svrmcp.NewMCPServiceClient(svrConn)
	logger.Info("SVR client initialized", log.String("addr", svrAddr))

	// Initialize IM gRPC client
	imAddr := os.Getenv("CHATEE_GRPC_IM_ADDR")
	if imAddr == "" {
		imAddr = "localhost:9093" // Default IM RPC address
	}
	imConn, err := grpc.Dial(
		imAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                10 * time.Second,
			Timeout:             3 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to IM service: %w", err)
	}
	svc.IMConn = imConn
	svc.IMThread = imthread.NewThreadServiceClient(imConn)
	svc.IMChat = imchat.NewChatServiceClient(imConn)
	logger.Info("IM client initialized", log.String("addr", imAddr))

	// Initialize Conn gRPC client (for WebSocket status queries)
	connAddr := os.Getenv("CHATEE_GRPC_CONN_ADDR")
	if connAddr == "" {
		connAddr = "localhost:9094" // Default Conn RPC address
	}
	connConn, err := grpc.Dial(
		connAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                10 * time.Second,
			Timeout:             3 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		logger.Warn("Failed to connect to Conn service, connection status features will be disabled", log.Err(err))
		connConn = nil
	} else {
		svc.ConnConn = connConn
		logger.Info("Conn client initialized", log.String("addr", connAddr))
	}

	return svc, nil
}

// Close closes all gRPC connections
func (s *HTTPService) Close() error {
	if s.DBCConn != nil {
		s.DBCConn.Close()
	}
	if s.SVRConn != nil {
		s.SVRConn.Close()
	}
	if s.IMConn != nil {
		s.IMConn.Close()
	}
	if s.ConnConn != nil {
		s.ConnConn.Close()
	}
	return nil
}
