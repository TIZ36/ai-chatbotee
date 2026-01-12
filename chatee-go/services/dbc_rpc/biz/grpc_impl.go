package service

import (
	"google.golang.org/grpc"

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/services/dbc_rpc/handler"
	"chatee-go/services/dbc_rpc/repository"
)

// DBCService holds all gRPC service implementations
type DBCService struct {
	repos   *repository.Repositories
	poolMgr *pool.PoolManager
	config  *config.Config
	logger  log.Logger
}

// NewDBCService creates a new DBC service
func NewDBCService(repos *repository.Repositories, poolMgr *pool.PoolManager, cfg *config.Config, logger log.Logger) *DBCService {
	return &DBCService{
		repos:   repos,
		poolMgr: poolMgr,
		config:  cfg,
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

	// HBase handlers (using real HBase implementation)
	var hbaseRepo repository.HBaseRepository
	if s.poolMgr.HBase() != nil {
		// Use real HBase repository
		tablePrefix := ""
		if s.config != nil {
			tablePrefix = s.config.HBase.TablePrefix
		}
		hbaseRepo = repository.NewGHBaseRepository(
			s.poolMgr.HBase(),
			tablePrefix,
			s.logger,
		)
		s.logger.Info("Using real HBase repository", log.String("table_prefix", tablePrefix))
	} else {
		// Fallback to memory implementation if HBase is not configured
		hbaseRepo = repository.NewMemoryHBaseRepository()
		s.logger.Warn("HBase not configured, using memory implementation")
	}
	hbaseThreadHandler := handler.NewHBaseThreadHandler(hbaseRepo, s.logger)
	hbaseChatHandler := handler.NewHBaseChatHandler(hbaseRepo, s.logger)

	// Cache handler (Redis)
	redisClient := s.poolMgr.Redis()
	if redisClient == nil {
		s.logger.Warn("Redis client not available, cache handler will not work")
	}
	cacheHandler := handler.NewCacheHandler(redisClient, s.logger)

	// Chroma handler
	var chromaRepo repository.ChromaRepository
	if s.config != nil && s.config.Chroma.Host != "" {
		// Use real ChromaDB repository
		chromaRepo = repository.NewHTTPChromaRepository(
			s.config.Chroma.Host,
			s.config.Chroma.Port,
			s.logger,
		)
		s.logger.Info("Using real ChromaDB repository", 
			log.String("host", s.config.Chroma.Host),
			log.Int("port", s.config.Chroma.Port))
	} else {
		// Fallback to memory implementation if ChromaDB is not configured
		chromaRepo = repository.NewMemoryChromaRepository()
		s.logger.Warn("ChromaDB not configured, using memory implementation")
	}
	chromaHandler := handler.NewChromaHandler(chromaRepo, s.logger)

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
