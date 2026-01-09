package service

import (
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// HTTPService provides business logic for HTTP handlers
type HTTPService struct {
	Config *config.Config
	Logger log.Logger

	// gRPC clients to other services
	DBCClient *grpc.ClientConn
	SVRClient *grpc.ClientConn
	IMClient  *grpc.ClientConn
}

// NewHTTPService creates a new HTTP service
func NewHTTPService(cfg *config.Config, logger log.Logger) (*HTTPService, error) {
	svc := &HTTPService{
		Config: cfg,
		Logger: logger,
	}

	// Initialize gRPC clients to other services
	// TODO: Initialize DBC, SVR, IM gRPC clients based on config
	// Example:
	// dbcConn, err := grpc.Dial(cfg.GRPC.DBCAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	// if err != nil {
	// 	return nil, err
	// }
	// svc.DBCClient = dbcConn

	return svc, nil
}

// Close closes all gRPC connections
func (s *HTTPService) Close() error {
	if s.DBCClient != nil {
		s.DBCClient.Close()
	}
	if s.SVRClient != nil {
		s.SVRClient.Close()
	}
	if s.IMClient != nil {
		s.IMClient.Close()
	}
	return nil
}

