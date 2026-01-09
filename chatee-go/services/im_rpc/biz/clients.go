package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	dbc "chatee-go/gen/dbc"
	svragent "chatee-go/gen/svr/agent"
)

// Clients holds all gRPC clients for external services
type Clients struct {
	// DBC service clients
	HBaseThread dbc.HBaseThreadServiceClient
	HBaseChat   dbc.HBaseChatServiceClient
	Cache       dbc.CacheServiceClient

	// SVR service clients
	Agent svragent.AgentServiceClient

	// gRPC connections (for cleanup)
	dbcConn *grpc.ClientConn
	svrConn *grpc.ClientConn

	logger log.Logger
}

// NewClients creates and initializes all gRPC clients
func NewClients(cfg *config.Config, logger log.Logger) (*Clients, error) {
	clients := &Clients{
		logger: logger,
	}

	// Initialize DBC service connection
	dbcAddr := os.Getenv("CHATEE_GRPC_DBC_ADDR")
	if dbcAddr == "" {
		dbcAddr = "localhost:9091" // Default DBC RPC address
	}

	dbcConn, err := grpc.NewClient(
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
	clients.dbcConn = dbcConn

	// Initialize DBC service clients
	clients.HBaseThread = dbc.NewHBaseThreadServiceClient(dbcConn)
	clients.HBaseChat = dbc.NewHBaseChatServiceClient(dbcConn)
	clients.Cache = dbc.NewCacheServiceClient(dbcConn)

	// Initialize SVR service connection
	svrAddr := os.Getenv("CHATEE_GRPC_SVR_ADDR")
	if svrAddr == "" {
		svrAddr = "localhost:9092" // Default SVR RPC address
	}

	svrConn, err := grpc.NewClient(
		svrAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                10 * time.Second,
			Timeout:             3 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		// SVR service is optional, log warning but don't fail
		logger.Warn("Failed to connect to SVR service, AI features will be disabled", "error", err)
	} else {
		clients.svrConn = svrConn
		clients.Agent = svragent.NewAgentServiceClient(svrConn)
	}

	logger.Info("gRPC clients initialized",
		"dbc_addr", dbcAddr,
		"svr_addr", svrAddr)

	return clients, nil
}

// Close closes all gRPC connections
func (c *Clients) Close() error {
	var errs []error
	if c.dbcConn != nil {
		if err := c.dbcConn.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close DBC connection: %w", err))
		}
	}
	if c.svrConn != nil {
		if err := c.svrConn.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close SVR connection: %w", err))
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("errors closing clients: %v", errs)
	}
	return nil
}

// HealthCheck checks the health of all gRPC connections
func (c *Clients) HealthCheck(ctx context.Context) error {
	// Check DBC connection
	if c.dbcConn == nil {
		return fmt.Errorf("DBC connection is nil")
	}
	state := c.dbcConn.GetState()
	if state.String() != "READY" {
		return fmt.Errorf("DBC connection is not ready: %s", state.String())
	}

	// SVR connection is optional, so we don't check it
	return nil
}

