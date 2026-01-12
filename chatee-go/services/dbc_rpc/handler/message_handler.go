package handler

import (
	"context"
	"database/sql"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/commonlib/snowflake"
	dbc "chatee-go/gen/dbc"
	repository "chatee-go/services/dbc_rpc/repository/mysql"
)

// MessageHandler implements MessageService gRPC interface
type MessageHandler struct {
	dbc.UnimplementedMessageServiceServer

	logger log.Logger
	repo   repository.MessageRepository
}

// NewMessageHandler creates a new message handler
func NewMessageHandler(poolMgr *pool.PoolManager, logger log.Logger) *MessageHandler {
	return &MessageHandler{
		logger: logger,
		repo:   repository.NewMySQLMessageRepository(poolMgr.GetGORM(), poolMgr.GetRedis()),
	}
}

// Register registers the handler with gRPC server
func (h *MessageHandler) Register(server *grpc.Server) {
	dbc.RegisterMessageServiceServer(server, h)
}

// CreateMessage creates a new message
func (h *MessageHandler) CreateMessage(ctx context.Context, req *dbc.CreateMessageRequest) (*dbc.Message, error) {
	messageID := snowflake.GenerateTypedID("msg")

	message := &repository.Message{
		ID:         messageID,
		SessionID:  req.GetSessionId(),
		Role:       req.GetRole(),
		Content:    req.GetContent(),
		ToolCalls:  req.GetToolCalls(),
		ToolCallID: sql.NullString{String: req.GetToolCallId(), Valid: req.GetToolCallId() != ""},
		Metadata:   req.GetMetadata(),
		CreatedAt:  time.Now(),
	}

	if err := h.repo.Create(ctx, message); err != nil {
		h.logger.Error("Failed to create message", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create message: %v", err)
	}

	return h.toProtoMessage(message), nil
}

// GetMessage retrieves a message by ID
func (h *MessageHandler) GetMessage(ctx context.Context, req *dbc.GetMessageRequest) (*dbc.Message, error) {
	message, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "message not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get message", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get message: %v", err)
	}

	return h.toProtoMessage(message), nil
}

// GetMessagesBySession retrieves messages for a session
func (h *MessageHandler) GetMessagesBySession(ctx context.Context, req *dbc.GetMessagesBySessionRequest) (*dbc.GetMessagesBySessionResponse, error) {
	offset := int(req.GetOffset())
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 50 // Default limit
	}

	messages, err := h.repo.GetBySessionID(ctx, req.GetSessionId(), offset, limit)
	if err != nil {
		h.logger.Error("Failed to get messages by session", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get messages: %v", err)
	}

	protoMessages := make([]*dbc.Message, 0, len(messages))
	for _, message := range messages {
		protoMessages = append(protoMessages, h.toProtoMessage(message))
	}

	return &dbc.GetMessagesBySessionResponse{
		Messages: protoMessages,
		Total:    int32(len(protoMessages)), // TODO: Get actual total count
	}, nil
}

// UpdateMessage updates a message
func (h *MessageHandler) UpdateMessage(ctx context.Context, req *dbc.UpdateMessageRequest) (*dbc.Message, error) {
	message, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "message not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get message for update", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get message: %v", err)
	}

	// Update fields
	if req.GetContent() != "" {
		message.Content = req.GetContent()
	}
	if req.GetMetadata() != nil {
		message.Metadata = req.GetMetadata()
	}

	if err := h.repo.Update(ctx, message); err != nil {
		h.logger.Error("Failed to update message", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update message: %v", err)
	}

	return h.toProtoMessage(message), nil
}

// DeleteMessage deletes a message
func (h *MessageHandler) DeleteMessage(ctx context.Context, req *dbc.DeleteMessageRequest) (*dbc.DeleteMessageResponse, error) {
	if err := h.repo.Delete(ctx, req.GetId()); err != nil {
		h.logger.Error("Failed to delete message", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete message: %v", err)
	}

	return &dbc.DeleteMessageResponse{Success: true}, nil
}

// toProtoMessage converts repository Message to proto Message
func (h *MessageHandler) toProtoMessage(message *repository.Message) *dbc.Message {
	toolCallID := ""
	if message.ToolCallID.Valid {
		toolCallID = message.ToolCallID.String
	}

	return &dbc.Message{
		Id:         message.ID,
		SessionId:  message.SessionID,
		Role:       message.Role,
		Content:    message.Content,
		ToolCalls:  message.ToolCalls,
		ToolCallId: toolCallID,
		Metadata:   message.Metadata,
		CreatedAt:  message.CreatedAt.Unix(),
	}
}
