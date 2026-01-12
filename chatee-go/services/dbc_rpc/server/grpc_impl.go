package server

import (
	"google.golang.org/grpc"

	"chatee-go/services/dbc_rpc/handler"
)

// DBCService holds all gRPC service implementations
type DBCService struct {
	svc *ServiceContext
}

// NewDBCService creates a new DBC service
func NewDBCService(svc *ServiceContext) *DBCService {
	return &DBCService{
		svc: svc,
	}
}

// RegisterGRPC registers all gRPC services with the server
func (s *DBCService) RegisterGRPC(server *grpc.Server) {
	// Initialize handlers
	userHandler := handler.NewUserHandler(s.svc.PoolManager, s.svc.Logger)
	sessionHandler := handler.NewSessionHandler(s.svc.PoolManager, s.svc.Logger)
	agentHandler := handler.NewAgentHandler(s.svc.PoolManager, s.svc.Logger)
	messageHandler := handler.NewMessageHandler(s.svc.PoolManager, s.svc.Logger)
	llmConfigHandler := handler.NewLLMConfigHandler(s.svc.PoolManager, s.svc.Logger)
	mcpServerHandler := handler.NewMCPServerHandler(s.svc.PoolManager, s.svc.Logger)
	hbaseThreadHandler := handler.NewHBaseThreadHandler(s.svc.PoolManager, s.svc.Logger)
	hbaseChatHandler := handler.NewHBaseChatHandler(s.svc.PoolManager, s.svc.Logger)
	cacheHandler := handler.NewCacheHandler(s.svc.PoolManager, s.svc.Logger)
	chromaHandler := handler.NewChromaHandler(s.svc.PoolManager, s.svc.Logger)

	// Register all services
	userHandler.Register(server)
	sessionHandler.Register(server)
	agentHandler.Register(server)
	messageHandler.Register(server)
	llmConfigHandler.Register(server)
	mcpServerHandler.Register(server)
	hbaseThreadHandler.Register(server)
	hbaseChatHandler.Register(server)
	cacheHandler.Register(server)
	chromaHandler.Register(server)
}
