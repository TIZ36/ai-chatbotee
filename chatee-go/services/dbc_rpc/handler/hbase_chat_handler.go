package handler

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	dbc "chatee-go/gen/dbc"
	"chatee-go/services/dbc_rpc/repository"
)

// HBaseChatHandler implements HBaseChatService gRPC interface
type HBaseChatHandler struct {
	dbc.UnimplementedHBaseChatServiceServer
	
	repo   repository.HBaseRepository
	logger log.Logger
}

// NewHBaseChatHandler creates a new HBase chat handler
func NewHBaseChatHandler(repo repository.HBaseRepository, logger log.Logger) *HBaseChatHandler {
	return &HBaseChatHandler{
		repo:   repo,
		logger: logger,
	}
}

// Register registers the handler with gRPC server
func (h *HBaseChatHandler) Register(server *grpc.Server) {
	dbc.RegisterHBaseChatServiceServer(server, h)
}

// SaveChatMetadata saves chat metadata
func (h *HBaseChatHandler) SaveChatMetadata(ctx context.Context, req *dbc.SaveChatMetadataRequest) (*dbc.SaveChatMetadataResponse, error) {
	chat := h.protoToChatMetadata(req.GetChat())
	if err := h.repo.SaveChatMetadata(ctx, chat); err != nil {
		h.logger.Error("Failed to save chat metadata", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to save chat metadata: %v", err)
	}
	
	return &dbc.SaveChatMetadataResponse{Success: true}, nil
}

// GetChatMetadata retrieves chat metadata
func (h *HBaseChatHandler) GetChatMetadata(ctx context.Context, req *dbc.GetChatMetadataRequest) (*dbc.ChatMetadataRow, error) {
	chat, err := h.repo.GetChatMetadata(ctx, req.GetChatKey())
	if err != nil {
		h.logger.Error("Failed to get chat metadata", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get chat metadata: %v", err)
	}
	
	return h.chatMetadataToProto(chat), nil
}

// SaveChatInbox saves a chat inbox entry
func (h *HBaseChatHandler) SaveChatInbox(ctx context.Context, req *dbc.SaveChatInboxRequest) (*dbc.SaveChatInboxResponse, error) {
	inbox := h.protoToChatInbox(req.GetInbox())
	if err := h.repo.SaveChatInbox(ctx, inbox); err != nil {
		h.logger.Error("Failed to save chat inbox", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to save chat inbox: %v", err)
	}
	
	return &dbc.SaveChatInboxResponse{Success: true}, nil
}

// GetUserChatInbox retrieves user chat inbox
func (h *HBaseChatHandler) GetUserChatInbox(ctx context.Context, req *dbc.GetUserChatInboxRequest) (*dbc.GetUserChatInboxResponse, error) {
	inboxes, err := h.repo.GetUserChatInbox(ctx, req.GetUserId(), req.GetChatKey(), req.GetLimit(), req.GetOffset())
	if err != nil {
		h.logger.Error("Failed to get user chat inbox", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get user chat inbox: %v", err)
	}
	
	protoInboxes := make([]*dbc.ChatInboxRow, 0, len(inboxes))
	for _, inbox := range inboxes {
		protoInboxes = append(protoInboxes, h.chatInboxToProto(inbox))
	}
	
	return &dbc.GetUserChatInboxResponse{
		Inboxes: protoInboxes,
		Total:   int64(len(protoInboxes)), // TODO: Get actual total count
	}, nil
}

// Conversion functions

func (h *HBaseChatHandler) protoToChatMetadata(proto *dbc.ChatMetadataRow) *repository.ChatMetadataRow {
	if proto == nil {
		return nil
	}
	return &repository.ChatMetadataRow{
		RowKey:       proto.GetRowKey(),
		ChatKey:      proto.GetChatKey(),
		ChatType:     proto.GetChatType(),
		Participants: proto.GetParticipants(),
		AIAgents:     proto.GetAiAgents(),
		CreatedBy:    proto.GetCreatedBy(),
		CreatedAt:    proto.GetCreatedAt(),
		Settings:     proto.GetSettings(),
		Status:       proto.GetStatus(),
		MsgCount:     proto.GetMsgCount(),
		LastMsgID:    proto.GetLastMsgId(),
		LastActiveAt: proto.GetLastActiveAt(),
		UnreadCounts: proto.GetUnreadCounts(),
	}
}

func (h *HBaseChatHandler) chatMetadataToProto(chat *repository.ChatMetadataRow) *dbc.ChatMetadataRow {
	if chat == nil {
		return nil
	}
	return &dbc.ChatMetadataRow{
		RowKey:       chat.RowKey,
		ChatKey:      chat.ChatKey,
		ChatType:     chat.ChatType,
		Participants: chat.Participants,
		AiAgents:     chat.AIAgents,
		CreatedBy:    chat.CreatedBy,
		CreatedAt:    chat.CreatedAt,
		Settings:     chat.Settings,
		Status:       chat.Status,
		MsgCount:     chat.MsgCount,
		LastMsgId:    chat.LastMsgID,
		LastActiveAt: chat.LastActiveAt,
		UnreadCounts: chat.UnreadCounts,
	}
}

func (h *HBaseChatHandler) protoToChatInbox(proto *dbc.ChatInboxRow) *repository.ChatInboxRow {
	if proto == nil {
		return nil
	}
	return &repository.ChatInboxRow{
		RowKey:      proto.GetRowKey(),
		UserID:      proto.GetUserId(),
		ChatKey:     proto.GetChatKey(),
		MsgID:       proto.GetMsgId(),
		SenderID:    proto.GetSenderId(),
		SenderType:  proto.GetSenderType(),
		ContentType: proto.GetContentType(),
		RawContent:  proto.GetRawContent(),
		Mentions:    proto.GetMentions(),
		Flags:       proto.GetFlags(),
		Timestamp:   proto.GetTimestamp(),
	}
}

func (h *HBaseChatHandler) chatInboxToProto(inbox *repository.ChatInboxRow) *dbc.ChatInboxRow {
	if inbox == nil {
		return nil
	}
	return &dbc.ChatInboxRow{
		RowKey:      inbox.RowKey,
		UserId:      inbox.UserID,
		ChatKey:     inbox.ChatKey,
		MsgId:       inbox.MsgID,
		SenderId:    inbox.SenderID,
		SenderType:  inbox.SenderType,
		ContentType: inbox.ContentType,
		RawContent:  inbox.RawContent,
		Mentions:    inbox.Mentions,
		Flags:       inbox.Flags,
		Timestamp:   inbox.Timestamp,
	}
}

