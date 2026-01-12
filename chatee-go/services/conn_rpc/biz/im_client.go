package service

import (
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	"chatee-go/commonlib/log"
	imchat "chatee-go/gen/im/chat/im"
	imthread "chatee-go/gen/im/thread/im"
)

// IMClient wraps the gRPC clients to im_rpc ThreadService and ChatService
type IMClient struct {
	threadClient imthread.ThreadServiceClient
	chatClient   imchat.ChatServiceClient
	conn         *grpc.ClientConn
	logger       log.Logger
}

// ThreadClient returns the thread service client
func (c *IMClient) ThreadClient() imthread.ThreadServiceClient {
	return c.threadClient
}

// ChatClient returns the chat service client
func (c *IMClient) ChatClient() imchat.ChatServiceClient {
	return c.chatClient
}

// NewIMClient creates a new IM service client
func NewIMClient(logger log.Logger) (*IMClient, error) {
	imAddr := os.Getenv("CHATEE_GRPC_IM_ADDR")
	if imAddr == "" {
		imAddr = "localhost:9093" // Default IM RPC address
	}

	conn, err := grpc.Dial(
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

	logger.Info("IM client initialized", log.String("addr", imAddr))

	return &IMClient{
		threadClient: imthread.NewThreadServiceClient(conn),
		chatClient:   imchat.NewChatServiceClient(conn),
		conn:         conn,
		logger:       logger,
	}, nil
}

// Close closes the gRPC connection
func (c *IMClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

