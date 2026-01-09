package service

import (
	"google.golang.org/grpc"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/services/dbc_rpc/handler"
	"chatee-go/services/dbc_rpc/repository"
)

// DBCService holds all gRPC service implementations
type DBCService struct {
	repos   *repository.Repositories
	poolMgr *pool.PoolManager
	logger  log.Logger
}

// NewDBCService creates a new DBC service
func NewDBCService(repos *repository.Repositories, poolMgr *pool.PoolManager, logger log.Logger) *DBCService {
	return &DBCService{
		repos:   repos,
		poolMgr: poolMgr,
		logger:  logger,
	}
}

// RegisterGRPC registers all gRPC services with the server
func (s *DBCService) RegisterGRPC(server *grpc.Server) {
	// Initialize handlers
	userHandler := handler.NewUserHandler(s.repos.User, s.logger)
	sessionHandler := handler.NewSessionHandler(s.repos.Session, s.logger)
	agentHandler := handler.NewAgentHandler(s.repos.Agent, s.logger)
	messageHandler := handler.NewMessageHandler(s.repos.Message, s.logger)
	llmConfigHandler := handler.NewLLMConfigHandler(s.repos.LLMConfig, s.logger)
	mcpServerHandler := handler.NewMCPServerHandler(s.repos.MCPServer, s.logger)

	// HBase handlers (using memory implementation for now)
	hbaseRepo := repository.NewMemoryHBaseRepository()
	hbaseThreadHandler := handler.NewHBaseThreadHandler(hbaseRepo, s.logger)
	hbaseChatHandler := handler.NewHBaseChatHandler(hbaseRepo, s.logger)

	// Cache handler (Redis)
	redisClient := s.poolMgr.Redis()
	if redisClient == nil {
		s.logger.Warn("Redis client not available, cache handler will not work")
	}
	cacheHandler := handler.NewCacheHandler(redisClient, s.logger)

	// Chroma handler (placeholder)
	chromaHandler := handler.NewChromaHandler(s.logger)

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
