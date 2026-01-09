package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	commonpb "chatee-go/gen/common"
	dbc "chatee-go/gen/dbc"
	chatpb "chatee-go/gen/im/chat"
	"chatee-go/services/im_rpc/biz"
	"chatee-go/services/im_rpc/biz/chat"
	"chatee-go/services/im_rpc/biz/push"
)

// ChatHandler implements ChatService gRPC interface
type ChatHandler struct {
	chatpb.UnimplementedChatServiceServer

	coreService *chat.CoreService
	clients     *service.Clients
	pushService *push.PushService
	logger      log.Logger
}

// NewChatHandler creates a new chat handler
func NewChatHandler(coreService *chat.CoreService, clients *service.Clients, pushService *push.PushService, logger log.Logger) *ChatHandler {
	return &ChatHandler{
		coreService: coreService,
		clients:     clients,
		pushService: pushService,
		logger:      logger,
	}
}

// CreateChat creates a new chat
func (h *ChatHandler) CreateChat(ctx context.Context, req *chatpb.CreateChatRequest) (*chatpb.CreateChatResponse, error) {
	// TODO: Implement create chat
	// Generate chat_key based on chat type
	chatKey := generateChatKey(req.GetChatType(), req.GetCreatedBy(), req.GetParticipantIds())

	// Create chat metadata via DBC
	// TODO: Implement full create chat logic

	return &chatpb.CreateChatResponse{
		ChatKey: chatKey,
		Chat:    &chatpb.Chat{}, // TODO: Build full chat object
	}, nil
}

// GetChat retrieves a chat by key
func (h *ChatHandler) GetChat(ctx context.Context, req *chatpb.GetChatRequest) (*chatpb.Chat, error) {
	chatKey := req.GetChatKey()
	if chatKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key is required")
	}

	// Call DBC service
	dbcReq := &dbc.GetChatMetadataRequest{
		ChatKey: chatKey,
	}
	dbcResp, err := h.clients.HBaseChat.GetChatMetadata(ctx, dbcReq)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "chat not found: %v", err)
	}

	// Convert DBC response to proto Chat
	return hdbcMetadataToChat(dbcResp), nil
}

// UpdateChat updates a chat
func (h *ChatHandler) UpdateChat(ctx context.Context, req *chatpb.UpdateChatRequest) (*chatpb.Chat, error) {
	// TODO: Implement update chat
	return nil, status.Errorf(codes.Unimplemented, "UpdateChat not yet implemented")
}

// DeleteChat deletes a chat (soft delete)
func (h *ChatHandler) DeleteChat(ctx context.Context, req *chatpb.DeleteChatRequest) (*chatpb.DeleteChatResponse, error) {
	// TODO: Implement delete chat
	return &chatpb.DeleteChatResponse{Success: true}, nil
}

// ListChats lists user's chats
func (h *ChatHandler) ListChats(ctx context.Context, req *chatpb.ListChatsRequest) (*chatpb.ListChatsResponse, error) {
	// TODO: Implement list chats
	return &chatpb.ListChatsResponse{
		Chats:      []*chatpb.ChatSummary{},
		HasMore:    false,
		NextCursor: "",
	}, nil
}

// AddParticipant adds a participant to a chat
func (h *ChatHandler) AddParticipant(ctx context.Context, req *chatpb.AddParticipantRequest) (*chatpb.AddParticipantResponse, error) {
	// TODO: Implement add participant
	return nil, status.Errorf(codes.Unimplemented, "AddParticipant not yet implemented")
}

// RemoveParticipant removes a participant from a chat
func (h *ChatHandler) RemoveParticipant(ctx context.Context, req *chatpb.RemoveParticipantRequest) (*chatpb.RemoveParticipantResponse, error) {
	// TODO: Implement remove participant
	return &chatpb.RemoveParticipantResponse{Success: true}, nil
}

// ListParticipants lists chat participants
func (h *ChatHandler) ListParticipants(ctx context.Context, req *chatpb.ListParticipantsRequest) (*chatpb.ListParticipantsResponse, error) {
	chatKey := req.GetChatKey()
	if chatKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key is required")
	}

	// Get chat metadata
	getReq := &chatpb.GetChatRequest{ChatKey: chatKey}
	chatObj, err := h.GetChat(ctx, getReq)
	if err != nil {
		return nil, err
	}

	return &chatpb.ListParticipantsResponse{
		Participants: chatObj.GetParticipants(),
	}, nil
}

// SendMessage sends a message to a chat
func (h *ChatHandler) SendMessage(ctx context.Context, req *chatpb.SendMessageRequest) (*chatpb.SendMessageResponse, error) {
	chatKey := req.GetChatKey()
	if chatKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key is required")
	}

	// Convert proto request to internal request
	msg := req.GetMessage()
	internalReq := &chat.SendChatMessageRequest{
		ChatKey:     chatKey,
		SenderID:    req.GetSenderId(),
		SenderType:  req.GetSenderType(),
		Content:     msg.GetRawContent(),
		ContentType: contentTypeToString(msg.GetContentType()),
		Mentions:    msg.GetMentions(),
	}

	// Call core service
	resp, err := h.coreService.SendChatMessage(ctx, internalReq)
	if err != nil {
		h.logger.Error("Failed to send message", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to send message: %v", err)
	}

	return &chatpb.SendMessageResponse{
		MsgId:     resp.MsgID,
		Timestamp: time.Now().Unix(),
	}, nil
}

// GetMessages retrieves messages from a chat
func (h *ChatHandler) GetMessages(ctx context.Context, req *chatpb.GetMessagesRequest) (*chatpb.GetMessagesResponse, error) {
	chatKey := req.GetChatKey()
	if chatKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key is required")
	}

	// Get user_id from context or request
	userID := req.GetUserId()
	if userID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "user_id is required")
	}

	// Parse cursor to get offset
	offset, _, err := cursor.Decode(req.GetCursor())
	if err != nil {
		offset = 0
	}
	limit := int64(req.GetLimit())
	if limit <= 0 {
		limit = 20 // Default limit
	}

	// Call DBC service
	dbcReq := &dbc.GetUserChatInboxRequest{
		UserId:  userID,
		ChatKey: chatKey,
		Limit:   limit + 1, // Fetch one extra to check has_more
		Offset:  offset,
	}
	dbcResp, err := h.clients.HBaseChat.GetUserChatInbox(ctx, dbcReq)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get messages: %v", err)
	}

	// Convert DBC inbox rows to proto messages
	allInboxes := dbcResp.GetInboxes()
	hasMore := int64(len(allInboxes)) > limit
	if hasMore {
		allInboxes = allInboxes[:limit] // Remove the extra one
	}

	messages := make([]*chatpb.ChatMessage, 0, len(allInboxes))
	for _, inbox := range allInboxes {
		messages = append(messages, hdbcInboxToChatMessage(inbox))
	}

	// Calculate next cursor
	nextCursor := cursor.NextCursor(offset, limit, hasMore)
	return &chatpb.GetMessagesResponse{
		Messages:   messages,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// DeleteMessage deletes a message (soft delete)
func (h *ChatHandler) DeleteMessage(ctx context.Context, req *chatpb.DeleteMessageRequest) (*chatpb.DeleteMessageResponse, error) {
	// TODO: Implement delete message
	return &chatpb.DeleteMessageResponse{Success: true}, nil
}

// CreateChannel creates a channel in a group chat
func (h *ChatHandler) CreateChannel(ctx context.Context, req *chatpb.CreateChannelRequest) (*chatpb.Channel, error) {
	// TODO: Implement create channel
	return nil, status.Errorf(codes.Unimplemented, "CreateChannel not yet implemented")
}

// ListChannels lists channels in a chat
func (h *ChatHandler) ListChannels(ctx context.Context, req *chatpb.ListChannelsRequest) (*chatpb.ListChannelsResponse, error) {
	// TODO: Implement list channels
	return &chatpb.ListChannelsResponse{
		Channels: []*chatpb.Channel{},
	}, nil
}

// DeleteChannel deletes a channel
func (h *ChatHandler) DeleteChannel(ctx context.Context, req *chatpb.DeleteChannelRequest) (*chatpb.DeleteChannelResponse, error) {
	// TODO: Implement delete channel
	return &chatpb.DeleteChannelResponse{Success: true}, nil
}

// Subscribe subscribes to chat events (streaming)
func (h *ChatHandler) Subscribe(req *chatpb.SubscribeRequest, stream chatpb.ChatService_SubscribeServer) error {
	chatKey := req.GetChatKey()
	userID := req.GetUserId()
	if chatKey == "" || userID == "" {
		return status.Errorf(codes.InvalidArgument, "chat_key and user_id are required")
	}

	ctx := stream.Context()

	// Create a wrapper stream adapter
	adapter := &chatEventStreamAdapter{stream: stream}

	// Subscribe to chat events
	return h.pushService.SubscribeChat(ctx, chatKey, userID, adapter)
}

// chatEventStreamAdapter adapts gRPC stream to push service interface
type chatEventStreamAdapter struct {
	stream chatpb.ChatService_SubscribeServer
}

func (a *chatEventStreamAdapter) Send(event *push.ChatEvent) error {
	pbEvent := &chatpb.ChatEvent{
		EventType: event.EventType,
		ChatKey:   event.ChatKey,
		MsgId:     event.MsgID,
		Payload:   event.Payload,
		Timestamp: event.Timestamp,
	}
	return a.stream.Send(pbEvent)
}

// MarkAsRead marks messages as read
func (h *ChatHandler) MarkAsRead(ctx context.Context, req *chatpb.MarkAsReadRequest) (*chatpb.MarkAsReadResponse, error) {
	chatKey := req.GetChatKey()
	userID := req.GetUserId()
	if chatKey == "" || userID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key and user_id are required")
	}

	// Update read status via DBC Cache service
	// TODO: Implement mark as read

	return &chatpb.MarkAsReadResponse{Success: true}, nil
}

// GetUnreadCount gets unread message count
func (h *ChatHandler) GetUnreadCount(ctx context.Context, req *chatpb.GetUnreadCountRequest) (*chatpb.GetUnreadCountResponse, error) {
	chatKey := req.GetChatKey()
	userID := req.GetUserId()
	if chatKey == "" || userID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key and user_id are required")
	}

	// Get unread count from Redis via DBC Cache service
	key := fmt.Sprintf("chat:%s:unread:%s", chatKey, userID)
	dbcReq := &dbc.GetRequest{Key: key}
	dbcResp, err := h.clients.Cache.Get(ctx, dbcReq)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get unread count: %v", err)
	}

	count := int32(0)
	if dbcResp.GetExists() {
		// Parse count from value
		fmt.Sscanf(dbcResp.GetValue(), "%d", &count)
	}

	return &chatpb.GetUnreadCountResponse{
		Count: count,
	}, nil
}

// =============================================================================
// Helper Functions - Proto Conversion
// =============================================================================

func generateChatKey(chatType chatpb.ChatType, createdBy string, participantIds []string) string {
	if chatType == chatpb.ChatType_PRIVATE {
		// Private chat: max(uid1,uid2):min(uid1,uid2)
		if len(participantIds) < 2 {
			return ""
		}
		uid1, uid2 := participantIds[0], participantIds[1]
		if uid1 > uid2 {
			return fmt.Sprintf("%s:%s", uid1, uid2)
		}
		return fmt.Sprintf("%s:%s", uid2, uid1)
	} else if chatType == chatpb.ChatType_GROUP {
		// Group chat: group_{owner_id}_{id}
		chatID := fmt.Sprintf("group_%s_%d", createdBy, time.Now().UnixNano())
		return chatID
	}
	return ""
}

func hdbcMetadataToChat(meta *dbc.ChatMetadataRow) *chatpb.Chat {
	if meta == nil {
		return nil
	}

	settings := &chatpb.ChatSettings{}
	if meta.GetSettings() != "" {
		json.Unmarshal([]byte(meta.GetSettings()), settings)
	}

	stats := &chatpb.ChatStats{
		MessageCount: meta.GetMsgCount(),
		LastMsgId:    meta.GetLastMsgId(),
		LastActiveAt: meta.GetLastActiveAt(),
	}

	// Convert participants
	participants := make([]*chatpb.Participant, 0, len(meta.GetParticipants()))
	for _, pID := range meta.GetParticipants() {
		participants = append(participants, &chatpb.Participant{
			UserId: pID,
			Role:   chatpb.ParticipantRole_MEMBER, // TODO: Get actual role
		})
	}

	chatType := chatpb.ChatType_CHAT_TYPE_UNSPECIFIED
	if meta.GetChatType() == "private" {
		chatType = chatpb.ChatType_PRIVATE
	} else if meta.GetChatType() == "group" {
		chatType = chatpb.ChatType_GROUP
	}

	chatStatus := chatpb.ChatStatus_CHAT_STATUS_UNSPECIFIED
	switch meta.GetStatus() {
	case "active":
		chatStatus = chatpb.ChatStatus_CHAT_ACTIVE
	case "muted":
		chatStatus = chatpb.ChatStatus_CHAT_MUTED
	case "archived":
		chatStatus = chatpb.ChatStatus_CHAT_ARCHIVED
	}

	return &chatpb.Chat{
		ChatKey:      meta.GetChatKey(),
		ChatType:     chatType,
		CreatedBy:    meta.GetCreatedBy(),
		Status:       chatStatus,
		Settings:     settings,
		Stats:        stats,
		Participants: participants,
		AiAgents:     meta.GetAiAgents(),
		CreatedAt:    meta.GetCreatedAt(),
		UpdatedAt:    meta.GetCreatedAt(), // DBC doesn't have updated_at
	}
}

func hdbcInboxToChatMessage(inbox *dbc.ChatInboxRow) *chatpb.ChatMessage {
	if inbox == nil {
		return nil
	}

	// Convert sender type string to enum
	authorType := commonpb.AuthorType_AUTHOR_TYPE_UNSPECIFIED
	if inbox.GetSenderType() == "user" {
		authorType = commonpb.AuthorType_USER
	} else if inbox.GetSenderType() == "ai" {
		authorType = commonpb.AuthorType_AI
	}

	// Convert content type string to enum
	contentType := commonpb.ContentType_CONTENT_TYPE_UNSPECIFIED
	switch inbox.GetContentType() {
	case "text":
		contentType = commonpb.ContentType_TEXT
	case "image":
		contentType = commonpb.ContentType_IMAGE
	case "video":
		contentType = commonpb.ContentType_VIDEO
	case "file":
		contentType = commonpb.ContentType_FILE
	case "audio":
		contentType = commonpb.ContentType_AUDIO
	}

	baseMsg := &commonpb.BaseMessage{
		MsgId:       inbox.GetMsgId(),
		AuthorId:    inbox.GetSenderId(),
		AuthorType:  authorType,
		RawContent:  inbox.GetRawContent(),
		ContentType: contentType,
		Mentions:    inbox.GetMentions(),
		Timestamp:   inbox.GetTimestamp(),
	}

	return &chatpb.ChatMessage{
		Base:      baseMsg,
		ChatKey:   inbox.GetChatKey(),
		ChannelId: "", // TODO: Get from flags or metadata
	}
}
