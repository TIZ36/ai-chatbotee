package service

import (
	"google.golang.org/grpc"

	"chatee-go/commonlib/log"
	pb "chatee-go/gen/dbc"
	"chatee-go/services/chatee-dbc/repository"
)

// =============================================================================
// DBC Service
// =============================================================================

// DBCService provides database operations.
// It embeds Unimplemented service servers for forward compatibility.
type DBCService struct {
	// MySQL Services
	pb.UnimplementedUserServiceServer
	pb.UnimplementedSessionServiceServer
	pb.UnimplementedAgentServiceServer
	pb.UnimplementedMessageServiceServer
	pb.UnimplementedLLMConfigServiceServer
	pb.UnimplementedMCPServerServiceServer
	repos  *repository.Repositories
	logger log.Logger
}

// NewDBCService creates a new DBC service.
func NewDBCService(repos *repository.Repositories, logger log.Logger) *DBCService {
	return &DBCService{
		repos:  repos,
		logger: logger,
	}
}

// RegisterGRPC registers the service with gRPC server.
func (s *DBCService) RegisterGRPC(server *grpc.Server) {
	// MySQL Services (6个)
	pb.RegisterUserServiceServer(server, s)
	pb.RegisterSessionServiceServer(server, s)
	pb.RegisterAgentServiceServer(server, s)
	pb.RegisterMessageServiceServer(server, s)
	pb.RegisterLLMConfigServiceServer(server, s)
	pb.RegisterMCPServerServiceServer(server, s)

	// HBase Services (2个)
	// pb.RegisterHBaseThreadServiceServer(server, s)
	// pb.RegisterHBaseChatServiceServer(server, s)

	// Redis Cache Service (1个)
	// pb.RegisterCacheServiceServer(server, s)

	// ChromaDB Vector Service (1个) - 用于RAG
	// pb.RegisterChromaServiceServer(server, s)
}

// Repositories returns the repositories.
func (s *DBCService) Repositories() *repository.Repositories {
	return s.repos
}
