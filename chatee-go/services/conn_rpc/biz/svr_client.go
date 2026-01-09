package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	"chatee-go/commonlib/log"
	svruser "chatee-go/gen/svr/user"
)

// SVRClient wraps the gRPC client to svr_rpc UserService
type SVRClient struct {
	client svruser.UserServiceClient
	conn   *grpc.ClientConn
	logger log.Logger
}

// NewSVRClient creates a new SVR service client
func NewSVRClient(logger log.Logger) (*SVRClient, error) {
	svrAddr := os.Getenv("CHATEE_GRPC_SVR_ADDR")
	if svrAddr == "" {
		svrAddr = "localhost:9092" // Default SVR RPC address
	}

	conn, err := grpc.NewClient(
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

	client := svruser.NewUserServiceClient(conn)

	logger.Info("SVR client initialized", log.String("addr", svrAddr))

	return &SVRClient{
		client: client,
		conn:   conn,
		logger: logger,
	}, nil
}

// RegisterConnection registers a WebSocket connection with the user actor
func (c *SVRClient) RegisterConnection(ctx context.Context, userID, connID string) error {
	// Create a connection adapter that implements actor.Connection
	connAdapter := &ConnectionAdapter{
		ID:     connID,
		UserID: userID,
	}

	req := &svruser.RegisterConnectionRequest{
		UserId:       userID,
		ConnectionId: connID,
	}

	_, err := c.client.RegisterConnection(ctx, req)
	if err != nil {
		c.logger.Error("Failed to register connection", log.Err(err))
		return err
	}

	c.logger.Info("Connection registered with user actor",
		log.String("user_id", userID),
		log.String("connection_id", connID))

	return nil
}

// UnregisterConnection unregisters a WebSocket connection
func (c *SVRClient) UnregisterConnection(ctx context.Context, userID, connID string) error {
	req := &svruser.UnregisterConnectionRequest{
		UserId:       userID,
		ConnectionId: connID,
	}

	_, err := c.client.UnregisterConnection(ctx, req)
	if err != nil {
		c.logger.Error("Failed to unregister connection", log.Err(err))
		return err
	}

	c.logger.Info("Connection unregistered from user actor",
		log.String("user_id", userID),
		log.String("connection_id", connID))

	return nil
}

// SendMessageToUser sends a message to a user actor
func (c *SVRClient) SendMessageToUser(ctx context.Context, userID string, message []byte) error {
	req := &svruser.SendMessageRequest{
		UserId:  userID,
		Message: message,
	}

	_, err := c.client.SendMessage(ctx, req)
	if err != nil {
		c.logger.Error("Failed to send message to user", log.Err(err))
		return err
	}

	return nil
}

// Close closes the gRPC connection
func (c *SVRClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
