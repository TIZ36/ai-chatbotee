package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	commonpb "chatee-go/gen/common"
	dbc "chatee-go/gen/dbc"
	chatpb "chatee-go/gen/im/chat"
	"chatee-go/services/im_rpc/biz"
	"chatee-go/services/im_rpc/biz/chat"
	"chatee-go/services/im_rpc/biz/cursor"
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
	// Generate chat_key based on chat type
	chatKey := generateChatKey(req.GetChatType(), req.GetCreatedBy(), req.GetParticipantIds())

	// Build participants list (include creator)
	participants := make([]string, 0, len(req.GetParticipantIds())+1)
	participants = append(participants, req.GetCreatedBy())
	participants = append(participants, req.GetParticipantIds()...)

	// Convert settings to JSON
	settingsJSON := "{}"
	if req.GetSettings() != nil {
		settingsData, _ := json.Marshal(req.GetSettings())
		settingsJSON = string(settingsData)
	}

	// Determine chat type string
	chatTypeStr := "private"
	if req.GetChatType() == chatpb.ChatType_GROUP {
		chatTypeStr = "group"
	}

	now := time.Now().Unix()

	// Create chat metadata
	chatMeta := &dbc.ChatMetadataRow{
		ChatKey:      chatKey,
		ChatType:     chatTypeStr,
		Participants: participants,
		AiAgents:     req.GetAiAgentIds(),
		CreatedBy:    req.GetCreatedBy(),
		CreatedAt:    now,
		Settings:     settingsJSON,
		Status:       "active",
		MsgCount:     0,
		LastActiveAt: now,
	}

	// Save to DBC
	dbcReq := &dbc.SaveChatMetadataRequest{
		Chat: chatMeta,
	}
	_, err := h.clients.HBaseChat.SaveChatMetadata(ctx, dbcReq)
	if err != nil {
		h.logger.Error("Failed to create chat", log.Err(err), log.String("chat_key", chatKey))
		return nil, status.Errorf(codes.Internal, "failed to create chat: %v", err)
	}

	// Convert to proto Chat
	chatObj := hdbcMetadataToChat(chatMeta)

	return &chatpb.CreateChatResponse{
		ChatKey: chatKey,
		Chat:    chatObj,
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
	chatKey := req.GetChatKey()
	if chatKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key is required")
	}

	// Get existing chat
	getReq := &chatpb.GetChatRequest{ChatKey: chatKey}
	existingChat, err := h.GetChat(ctx, getReq)
	if err != nil {
		return nil, err
	}

	// Update fields
	if req.GetTitle() != "" {
		// Title is not stored in metadata, but we can add it to settings
		// For now, we'll skip title update as it's not in the metadata structure
	}
	if req.GetSettings() != nil {
		// Settings will be updated in metadata
	}
	if req.GetStatus() != chatpb.ChatStatus_CHAT_STATUS_UNSPECIFIED {
		// Status will be updated
	}

	// Convert proto Chat to DBC ChatMetadataRow
	statusStr := "active"
	switch req.GetStatus() {
	case chatpb.ChatStatus_CHAT_MUTED:
		statusStr = "muted"
	case chatpb.ChatStatus_CHAT_ARCHIVED:
		statusStr = "archived"
	default:
		// Use existing status if not specified
		if existingChat.GetStatus() == chatpb.ChatStatus_CHAT_MUTED {
			statusStr = "muted"
		} else if existingChat.GetStatus() == chatpb.ChatStatus_CHAT_ARCHIVED {
			statusStr = "archived"
		}
	}

	settingsJSON := existingChat.GetSettings()
	if req.GetSettings() != nil {
		settingsData, _ := json.Marshal(req.GetSettings())
		settingsJSON = string(settingsData)
	}

	// Get participants from existing chat
	participants := make([]string, 0, len(existingChat.GetParticipants()))
	for _, p := range existingChat.GetParticipants() {
		participants = append(participants, p.GetUserId())
	}

	// Update chat metadata
	chatMeta := &dbc.ChatMetadataRow{
		ChatKey:      chatKey,
		ChatType:     existingChat.GetChatType().String(),
		Participants: participants,
		AiAgents:     existingChat.GetAiAgents(),
		CreatedBy:    existingChat.GetCreatedBy(),
		CreatedAt:    existingChat.GetCreatedAt(),
		Settings:     settingsJSON,
		Status:       statusStr,
		MsgCount:     existingChat.GetStats().GetMessageCount(),
		LastMsgId:    existingChat.GetStats().GetLastMsgId(),
		LastActiveAt: existingChat.GetStats().GetLastActiveAt(),
	}

	// Save to DBC
	dbcReq := &dbc.SaveChatMetadataRequest{
		Chat: chatMeta,
	}
	_, err = h.clients.HBaseChat.SaveChatMetadata(ctx, dbcReq)
	if err != nil {
		h.logger.Error("Failed to update chat", log.Err(err), log.String("chat_key", chatKey))
		return nil, status.Errorf(codes.Internal, "failed to update chat: %v", err)
	}

	// Return updated chat
	return hdbcMetadataToChat(chatMeta), nil
}

// DeleteChat deletes a chat (soft delete)
func (h *ChatHandler) DeleteChat(ctx context.Context, req *chatpb.DeleteChatRequest) (*chatpb.DeleteChatResponse, error) {
	chatKey := req.GetChatKey()
	if chatKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key is required")
	}

	// Update chat status to archived (soft delete)
	updateReq := &chatpb.UpdateChatRequest{
		ChatKey: chatKey,
		Status:  chatpb.ChatStatus_CHAT_ARCHIVED,
	}
	_, err := h.UpdateChat(ctx, updateReq)
	if err != nil {
		return nil, err
	}

	return &chatpb.DeleteChatResponse{Success: true}, nil
}

// ListChats lists user's chats
func (h *ChatHandler) ListChats(ctx context.Context, req *chatpb.ListChatsRequest) (*chatpb.ListChatsResponse, error) {
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

	// Get user's chat inbox to find all chats
	// We'll iterate through inbox entries to find unique chat keys
	// Note: This is not the most efficient approach, but HBase doesn't support direct queries by participant
	// In production, you might want to maintain a separate index table
	
	// For now, we'll use a simplified approach: get chats from inbox
	// This will only return chats that have messages
	dbcReq := &dbc.GetUserChatInboxRequest{
		UserId: userID,
		ChatKey: "", // Empty to get all chats
		Limit:   limit + 1, // Fetch one extra to check has_more
		Offset:  offset,
	}
	dbcResp, err := h.clients.HBaseChat.GetUserChatInbox(ctx, dbcReq)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get chats: %v", err)
	}

	// Extract unique chat keys
	chatKeys := make(map[string]bool)
	for _, inbox := range dbcResp.GetInboxes() {
		chatKeys[inbox.GetChatKey()] = true
	}

	// Fetch chat metadata for each chat
	chats := make([]*chatpb.ChatSummary, 0, len(chatKeys))
	for chatKey := range chatKeys {
		getReq := &chatpb.GetChatRequest{ChatKey: chatKey}
		chat, err := h.GetChat(ctx, getReq)
		if err != nil {
			// Skip chats that can't be fetched
			continue
		}

		// Filter by chat type if specified
		if req.GetChatType() != chatpb.ChatType_CHAT_TYPE_UNSPECIFIED {
			if chat.GetChatType() != req.GetChatType() {
				continue
			}
		}

		// Filter by status if specified
		if req.GetStatus() != chatpb.ChatStatus_CHAT_STATUS_UNSPECIFIED {
			if chat.GetStatus() != req.GetStatus() {
				continue
			}
		}

		// Convert to ChatSummary
		summary := &chatpb.ChatSummary{
			ChatKey:     chat.GetChatKey(),
			ChatType:    chat.GetChatType(),
			Title:       chat.GetTitle(),
			LastMsgId:   chat.GetStats().GetLastMsgId(),
			LastActiveAt: chat.GetStats().GetLastActiveAt(),
			UnreadCount: 0, // TODO: Calculate unread count
		}
		chats = append(chats, summary)
	}

	// Sort by last active time (most recent first)
	sort.Slice(chats, func(i, j int) bool {
		return chats[i].GetLastActiveAt() > chats[j].GetLastActiveAt()
	})

	hasMore := int64(len(dbcResp.GetInboxes())) > limit
	nextCursor := cursor.NextCursor(offset, limit, hasMore)

	return &chatpb.ListChatsResponse{
		Chats:      chats,
		HasMore:    hasMore,
		NextCursor: nextCursor,
	}, nil
}

// AddParticipant adds a participant to a chat
func (h *ChatHandler) AddParticipant(ctx context.Context, req *chatpb.AddParticipantRequest) (*chatpb.AddParticipantResponse, error) {
	chatKey := req.GetChatKey()
	userID := req.GetUserId()
	if chatKey == "" || userID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key and user_id are required")
	}

	// Get existing chat
	getReq := &chatpb.GetChatRequest{ChatKey: chatKey}
	chat, err := h.GetChat(ctx, getReq)
	if err != nil {
		return nil, err
	}

	// Check if user is already a participant
	for _, p := range chat.GetParticipants() {
		if p.GetUserId() == userID {
			return &chatpb.AddParticipantResponse{Success: true}, nil
		}
	}

	// Add user to participants
	participants := make([]string, 0, len(chat.GetParticipants())+1)
	for _, p := range chat.GetParticipants() {
		participants = append(participants, p.GetUserId())
	}
	participants = append(participants, userID)

	// Update chat metadata
	chatMeta := &dbc.ChatMetadataRow{
		ChatKey:      chatKey,
		ChatType:     chat.GetChatType().String(),
		Participants: participants,
		AiAgents:     chat.GetAiAgents(),
		CreatedBy:    chat.GetCreatedBy(),
		CreatedAt:    chat.GetCreatedAt(),
		Settings:     "", // Will be preserved from existing chat
		Status:       chat.GetStatus().String(),
		MsgCount:     chat.GetStats().GetMessageCount(),
		LastMsgId:    chat.GetStats().GetLastMsgId(),
		LastActiveAt: chat.GetStats().GetLastActiveAt(),
	}

	// Get existing settings
	if chat.GetSettings() != nil {
		settingsData, _ := json.Marshal(chat.GetSettings())
		chatMeta.Settings = string(settingsData)
	}

	// Save to DBC
	dbcReq := &dbc.SaveChatMetadataRequest{
		Chat: chatMeta,
	}
	_, err = h.clients.HBaseChat.SaveChatMetadata(ctx, dbcReq)
	if err != nil {
		h.logger.Error("Failed to add participant", log.Err(err), log.String("chat_key", chatKey), log.String("user_id", userID))
		return nil, status.Errorf(codes.Internal, "failed to add participant: %v", err)
	}

	return &chatpb.AddParticipantResponse{Success: true}, nil
}

// RemoveParticipant removes a participant from a chat
func (h *ChatHandler) RemoveParticipant(ctx context.Context, req *chatpb.RemoveParticipantRequest) (*chatpb.RemoveParticipantResponse, error) {
	chatKey := req.GetChatKey()
	userID := req.GetUserId()
	if chatKey == "" || userID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key and user_id are required")
	}

	// Get existing chat
	getReq := &chatpb.GetChatRequest{ChatKey: chatKey}
	chat, err := h.GetChat(ctx, getReq)
	if err != nil {
		return nil, err
	}

	// Remove user from participants
	participants := make([]string, 0, len(chat.GetParticipants()))
	found := false
	for _, p := range chat.GetParticipants() {
		if p.GetUserId() != userID {
			participants = append(participants, p.GetUserId())
		} else {
			found = true
		}
	}

	if !found {
		return &chatpb.RemoveParticipantResponse{Success: true}, nil // Already removed
	}

	// Update chat metadata
	chatMeta := &dbc.ChatMetadataRow{
		ChatKey:      chatKey,
		ChatType:     chat.GetChatType().String(),
		Participants: participants,
		AiAgents:     chat.GetAiAgents(),
		CreatedBy:    chat.GetCreatedBy(),
		CreatedAt:    chat.GetCreatedAt(),
		Settings:     "", // Will be preserved from existing chat
		Status:       chat.GetStatus().String(),
		MsgCount:     chat.GetStats().GetMessageCount(),
		LastMsgId:    chat.GetStats().GetLastMsgId(),
		LastActiveAt: chat.GetStats().GetLastActiveAt(),
	}

	// Get existing settings
	if chat.GetSettings() != nil {
		settingsData, _ := json.Marshal(chat.GetSettings())
		chatMeta.Settings = string(settingsData)
	}

	// Save to DBC
	dbcReq := &dbc.SaveChatMetadataRequest{
		Chat: chatMeta,
	}
	_, err = h.clients.HBaseChat.SaveChatMetadata(ctx, dbcReq)
	if err != nil {
		h.logger.Error("Failed to remove participant", log.Err(err), log.String("chat_key", chatKey), log.String("user_id", userID))
		return nil, status.Errorf(codes.Internal, "failed to remove participant: %v", err)
	}

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
		h.logger.Error("Failed to send message", log.Err(err))
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
	msgID := req.GetMsgId()
	chatKey := req.GetChatKey()
	if msgID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "msg_id is required")
	}
	if chatKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "chat_key is required")
	}

	// Get the message from inbox (we need user_id to query inbox)
	// Since we don't have user_id in the request, we'll need to mark it as deleted in a different way
	// For now, we'll use a flag in Redis to mark messages as deleted
	// In a full implementation, we might want to update the inbox row's flags field
	
	deleteKey := fmt.Sprintf("chat_msg_deleted:%s:%s", chatKey, msgID)
	dbcCacheReq := &dbc.SetRequest{
		Key:   deleteKey,
		Value: "1",
	}
	_, err := h.clients.Cache.Set(ctx, dbcCacheReq)
	if err != nil {
		h.logger.Error("Failed to delete message", log.Err(err), log.String("msg_id", msgID))
		return nil, status.Errorf(codes.Internal, "failed to delete message: %v", err)
	}

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

	// Extract channel_id from flags if present
	channelID := ""
	if inbox.GetFlags() != "" {
		var flags map[string]interface{}
		if err := json.Unmarshal([]byte(inbox.GetFlags()), &flags); err == nil {
			if chID, ok := flags["channel_id"].(string); ok {
				channelID = chID
			}
		}
	}

	return &chatpb.ChatMessage{
		Base:      baseMsg,
		ChatKey:   inbox.GetChatKey(),
		ChannelId: channelID,
	}
}
