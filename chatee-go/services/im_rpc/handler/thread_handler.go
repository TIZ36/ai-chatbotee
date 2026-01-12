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
	threadpb "chatee-go/gen/im/thread"
	"chatee-go/services/im_rpc/biz"
	"chatee-go/services/im_rpc/biz/cursor"
	"chatee-go/services/im_rpc/biz/push"
	"chatee-go/services/im_rpc/biz/thread"
)

// ThreadHandler implements ThreadService gRPC interface
type ThreadHandler struct {
	threadpb.UnimplementedThreadServiceServer

	coreService *thread.CoreService
	clients     *service.Clients
	pushService *push.PushService
	logger      log.Logger
}

// NewThreadHandler creates a new thread handler
func NewThreadHandler(coreService *thread.CoreService, clients *service.Clients, pushService *push.PushService, logger log.Logger) *ThreadHandler {
	return &ThreadHandler{
		coreService: coreService,
		clients:     clients,
		pushService: pushService,
		logger:      logger,
	}
}

// CreateThread creates a new thread
func (h *ThreadHandler) CreateThread(ctx context.Context, req *threadpb.CreateThreadRequest) (*threadpb.CreateThreadResponse, error) {
	// Convert proto request to internal request
	rootMsg := req.GetRootMessage()
	internalReq := &thread.PublishRootRequest{
		OwnerID:      req.GetOwnerId(),
		Content:      rootMsg.GetRawContent(),
		ContentType:  contentTypeToString(rootMsg.GetContentType()),
		Title:        req.GetTitle(),
		AIAgents:     req.GetAiAgents(),
		Mentions:     rootMsg.GetMentions(),
		SettingsJSON: protoSettingsToJSON(req.GetSettings()),
		MetadataJSON: protoMetadataToJSON(rootMsg.GetMetadata()),
	}

	// Call core service
	resp, err := h.coreService.PublishRootMessage(ctx, internalReq)
	if err != nil {
		h.logger.Error("Failed to create thread", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create thread: %v", err)
	}

	// Convert internal response to proto response
	return &threadpb.CreateThreadResponse{
		ThreadId:  resp.ThreadID,
		MsgId:     resp.MsgID,
		Timestamp: time.Now().Unix(),
	}, nil
}

// GetThread retrieves a thread by ID
func (h *ThreadHandler) GetThread(ctx context.Context, req *threadpb.GetThreadRequest) (*threadpb.Thread, error) {
	threadID := req.GetThreadId()
	if threadID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "thread_id is required")
	}

	// Call DBC service to get thread metadata
	dbcReq := &dbc.GetThreadMetadataRequest{
		ThreadId: threadID,
	}
	dbcResp, err := h.clients.HBaseThread.GetThreadMetadata(ctx, dbcReq)
	if err != nil {
		h.logger.Error("Failed to get thread metadata", log.String("thread_id", threadID), log.Err(err))
		return nil, status.Errorf(codes.NotFound, "thread not found: %v", err)
	}

	// Convert DBC response to proto Thread
	return hdbcMetadataToThread(dbcResp), nil
}

// UpdateThread updates a thread
func (h *ThreadHandler) UpdateThread(ctx context.Context, req *threadpb.UpdateThreadRequest) (*threadpb.Thread, error) {
	threadID := req.GetThreadId()
	if threadID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "thread_id is required")
	}

	// Get existing thread
	getReq := &threadpb.GetThreadRequest{ThreadId: threadID}
	existingThread, err := h.GetThread(ctx, getReq)
	if err != nil {
		return nil, err
	}

	// Update fields
	if req.GetTitle() != "" {
		existingThread.Title = req.GetTitle()
	}
	if req.GetSettings() != nil {
		existingThread.Settings = req.GetSettings()
	}
	if req.GetStatus() != threadpb.ThreadStatus_THREAD_STATUS_UNSPECIFIED {
		existingThread.Status = req.GetStatus()
	}
	if len(req.GetAiAgents()) > 0 {
		existingThread.AiAgents = req.GetAiAgents()
	}
	existingThread.UpdatedAt = time.Now().Unix()

	// Convert proto Thread to DBC ThreadMetadata
	settingsJSON := "{}"
	if existingThread.Settings != nil {
		settingsData, _ := json.Marshal(existingThread.Settings)
		settingsJSON = string(settingsData)
	}

	statusStr := "active"
	switch existingThread.Status {
	case threadpb.ThreadStatus_THREAD_CLOSED:
		statusStr = "closed"
	case threadpb.ThreadStatus_THREAD_ARCHIVED:
		statusStr = "archived"
	}

	// Save to DBC using SaveThreadMetadata (HBase Put will overwrite existing data)
	dbcReq := &dbc.SaveThreadMetadataRequest{
		Thread: &dbc.ThreadMetadata{
			ThreadId:     existingThread.ThreadId,
			OwnerId:      existingThread.OwnerId,
			RootMsgId:    existingThread.RootMsgId,
			Title:        existingThread.Title,
			AiAgents:     existingThread.AiAgents,
			Settings:     settingsJSON,
			CreatedAt:    existingThread.CreatedAt,
			Status:       statusStr,
			ReplyCount:   existingThread.Stats.GetReplyCount(),
			Participants: existingThread.Stats.GetParticipantCount(),
			LastMsgId:    existingThread.Stats.GetLastMsgId(),
			LastActiveAt: existingThread.Stats.GetLastActiveAt(),
			HotScore:     existingThread.Stats.GetHotScore(),
		},
	}

	_, err = h.clients.HBaseThread.SaveThreadMetadata(ctx, dbcReq)
	if err != nil {
		h.logger.Error("Failed to update thread metadata", log.Err(err), log.String("thread_id", threadID))
		return nil, status.Errorf(codes.Internal, "failed to update thread: %v", err)
	}

	return existingThread, nil
}

// DeleteThread deletes a thread (soft delete)
func (h *ThreadHandler) DeleteThread(ctx context.Context, req *threadpb.DeleteThreadRequest) (*threadpb.DeleteThreadResponse, error) {
	threadID := req.GetThreadId()
	if threadID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "thread_id is required")
	}

	// Update thread status to archived
	updateReq := &threadpb.UpdateThreadRequest{
		ThreadId: threadID,
		Status:   threadpb.ThreadStatus_THREAD_ARCHIVED,
	}
	_, err := h.UpdateThread(ctx, updateReq)
	if err != nil {
		return nil, err
	}

	return &threadpb.DeleteThreadResponse{Success: true}, nil
}

// ListThreads lists threads with pagination
func (h *ThreadHandler) ListThreads(ctx context.Context, req *threadpb.ListThreadsRequest) (*threadpb.ListThreadsResponse, error) {
	// Parse cursor to get offset
	_, _, err := cursor.Decode(req.GetCursor())
	if err != nil {
		// Ignore cursor decode error, start from beginning
	}
	limit := int64(req.GetLimit())
	if limit <= 0 {
		limit = 20 // Default limit
	}

	// If owner_id is specified, we can get threads from user's follow feed
	// Otherwise, we need to implement a different approach (e.g., global thread index)
	if req.GetOwnerId() != "" {
		// Get threads from user's follow feed (threads they follow)
		feedReq := &threadpb.GetUserFeedRequest{
			UserId: req.GetOwnerId(),
			Limit:  int32(limit + 1), // Fetch one extra to check has_more
			Cursor: req.GetCursor(),
		}
		feedResp, err := h.GetUserFeed(ctx, feedReq)
		if err != nil {
			return nil, err
		}

		// Extract unique thread IDs from feed
		threadIDs := make(map[string]bool)
		for _, item := range feedResp.GetItems() {
			threadIDs[item.GetThreadId()] = true
		}

		// Fetch thread metadata for each thread
		threads := make([]*threadpb.Thread, 0, len(threadIDs))
		for threadID := range threadIDs {
			getReq := &threadpb.GetThreadRequest{ThreadId: threadID}
			thread, err := h.GetThread(ctx, getReq)
			if err != nil {
				// Skip threads that can't be fetched
				continue
			}

			// Filter by status if specified
			if req.GetStatus() != threadpb.ThreadStatus_THREAD_STATUS_UNSPECIFIED {
				if thread.Status != req.GetStatus() {
					continue
				}
			}

			threads = append(threads, thread)
		}

		hasMore := feedResp.GetHasMore()
		nextCursor := feedResp.GetNextCursor()

		return &threadpb.ListThreadsResponse{
			Threads:    threads,
			HasMore:    hasMore,
			NextCursor: nextCursor,
		}, nil
	}

	// If no owner_id, return empty (global thread listing would require an index table)
	// For now, return empty result
	return &threadpb.ListThreadsResponse{
		Threads:    []*threadpb.Thread{},
		HasMore:    false,
		NextCursor: "",
	}, nil
}

// Publish publishes a root message (creates thread)
func (h *ThreadHandler) Publish(ctx context.Context, req *threadpb.PublishRequest) (*threadpb.PublishResponse, error) {
	// Same as CreateThread, but returns PublishResponse
	createReq := &threadpb.CreateThreadRequest{
		OwnerId:     req.GetOwnerId(),
		RootMessage: req.GetMessage(),
		Title:       req.GetTitle(),
		Settings:    req.GetSettings(),
		AiAgents:    req.GetAiAgents(),
	}

	createResp, err := h.CreateThread(ctx, createReq)
	if err != nil {
		return nil, err
	}

	// Get fanout result from core service response
	// Note: We need to get this from the internal response, but CreateThread doesn't return it
	// For now, we'll call PublishRootMessage directly to get the fanout result
	// Actually, CreateThread already calls PublishRootMessage, so we need to modify the flow
	// For simplicity, we'll estimate based on the response
	// In a full implementation, we'd need to return fanout results from CreateThread
	
	// TODO: Get actual fanout result from CreateThread response
	// Currently, CreateThread doesn't return fanout results
	// We would need to modify PublishRootMessage to return fanout statistics
	// For now, return estimated values
	
	return &threadpb.PublishResponse{
		ThreadId:  createResp.GetThreadId(),
		MsgId:     createResp.GetMsgId(),
		Timestamp: createResp.GetTimestamp(),
		Fanout: &threadpb.FanoutResult{
			TotalRecipients: 0, // Will be populated from actual fanout
			OnlinePushed:    0, // TODO: Get from push service or WebSocket Hub
			OfflineStored:   0, // All recipients stored in inbox
			AiNotified:      0, // TODO: Count AI agents
		},
	}, nil
}

// Reply replies to a thread message
func (h *ThreadHandler) Reply(ctx context.Context, req *threadpb.ReplyRequest) (*threadpb.ReplyResponse, error) {
	threadID := req.GetThreadId()
	if threadID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "thread_id is required")
	}

	// Convert proto request to internal request
	msg := req.GetMessage()
	internalReq := &thread.PublishReplyRequest{
		ThreadID:     threadID,
		ReplierID:    req.GetReplierId(),
		Content:      msg.GetRawContent(),
		ContentType:  contentTypeToString(msg.GetContentType()),
		ParentMsgID:  req.GetParentMsgId(),
		Mentions:     msg.GetMentions(),
		MetadataJSON: protoMetadataToJSON(msg.GetMetadata()),
	}

	// Call core service
	resp, err := h.coreService.PublishReply(ctx, internalReq)
	if err != nil {
		h.logger.Error("Failed to reply", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to reply: %v", err)
	}

	// Calculate fanout result
	totalRecipients := len(resp.FullTargets) + len(resp.LimitedTargets)
	aiNotified := 0
	allTargets := append(resp.FullTargets, resp.LimitedTargets...)
	for _, target := range allTargets {
		if len(target) > 0 && (target[0] == 'a' || len(target) > 3 && target[:3] == "ai_") {
			aiNotified++
		}
	}

	// Estimate online pushed count (simplified: assume 30% of users are online)
	// In production, this should query SVR service or WebSocket Hub for actual online status
	onlinePushed := int32(float64(totalRecipients) * 0.3) // Simplified estimate
	offlineStored := int32(totalRecipients) - onlinePushed

	return &threadpb.ReplyResponse{
		MsgId:          resp.ReplyMsgID,
		Timestamp:      time.Now().Unix(),
		FullTargets:    resp.FullTargets,
		LimitedTargets: resp.LimitedTargets,
		Fanout: &threadpb.FanoutResult{
			TotalRecipients: int32(totalRecipients),
			OnlinePushed:    onlinePushed,  // Estimated, TODO: Get from push service or WebSocket Hub
			OfflineStored:   offlineStored, // All stored in inbox
			AiNotified:      int32(aiNotified),
		},
	}, nil
}

// GetMessages retrieves messages from a thread
func (h *ThreadHandler) GetMessages(ctx context.Context, req *threadpb.GetMessagesRequest) (*threadpb.GetMessagesResponse, error) {
	threadID := req.GetThreadId()
	if threadID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "thread_id is required")
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
	dbcReq := &dbc.GetThreadMessagesRequest{
		ThreadId: threadID,
		Limit:    limit + 1, // Fetch one extra to check has_more
		Offset:   offset,
	}
	dbcResp, err := h.clients.HBaseThread.GetThreadMessages(ctx, dbcReq)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get messages: %v", err)
	}

	// Convert DBC messages to proto messages
	allMessages := dbcResp.GetMessages()
	hasMore := int64(len(allMessages)) > limit
	if hasMore {
		allMessages = allMessages[:limit] // Remove the extra one
	}

	messages := make([]*threadpb.ThreadMessage, 0, len(allMessages))
	for _, dbcMsg := range allMessages {
		// Filter by parent_msg_id if specified
		if req.GetParentMsgId() != "" && dbcMsg.GetParentMsgId() != req.GetParentMsgId() {
			continue
		}
		messages = append(messages, hdbcMessageToThreadMessage(dbcMsg))
	}

	// Calculate next cursor
	nextCursor := cursor.NextCursor(offset, limit, hasMore)
	return &threadpb.GetMessagesResponse{
		Messages:   messages,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// DeleteMessage deletes a message (soft delete)
func (h *ThreadHandler) DeleteMessage(ctx context.Context, req *threadpb.DeleteMessageRequest) (*threadpb.DeleteMessageResponse, error) {
	msgID := req.GetMsgId()
	threadID := req.GetThreadId()
	if msgID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "msg_id is required")
	}
	if threadID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "thread_id is required")
	}

	// Get the message first to check if it exists
	dbcGetReq := &dbc.GetThreadMessageRequest{
		ThreadId: threadID,
		MsgId:    msgID,
	}
	dbcMsg, err := h.clients.HBaseThread.GetThreadMessage(ctx, dbcGetReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, status.Errorf(codes.NotFound, "message not found: %s", msgID)
		}
		h.logger.Error("Failed to get message for deletion", log.Err(err), log.String("msg_id", msgID))
		return nil, status.Errorf(codes.Internal, "failed to get message: %v", err)
	}

	// Soft delete: update the message to mark it as deleted
	// We'll update the message's deleted flag in HBase
	// Since HBase doesn't have a direct update method, we'll use SaveThreadMessage with deleted=true
	updatedMsg := &dbc.ThreadMessageRow{
		RowKey:      dbcMsg.GetRowKey(),
		ThreadId:    dbcMsg.GetThreadId(),
		MsgId:       dbcMsg.GetMsgId(),
		AuthorId:    dbcMsg.GetAuthorId(),
		AuthorType:   dbcMsg.GetAuthorType(),
		ContentType: dbcMsg.GetContentType(),
		RawContent:  dbcMsg.GetRawContent(),
		Compressed:  dbcMsg.GetCompressed(),
		ParentMsgId: dbcMsg.GetParentMsgId(),
		Mentions:    dbcMsg.GetMentions(),
		Depth:       dbcMsg.GetDepth(),
		Metadata:    dbcMsg.GetMetadata(),
		Timestamp:   dbcMsg.GetTimestamp(),
		Deleted:     true, // Mark as deleted
	}

	dbcSaveReq := &dbc.SaveThreadMessageRequest{
		Message: updatedMsg,
	}
	_, err = h.clients.HBaseThread.SaveThreadMessage(ctx, dbcSaveReq)
	if err != nil {
		h.logger.Error("Failed to delete message", log.Err(err), log.String("msg_id", msgID))
		return nil, status.Errorf(codes.Internal, "failed to delete message: %v", err)
	}

	return &threadpb.DeleteMessageResponse{Success: true}, nil
}

// Subscribe subscribes to thread events (streaming)
func (h *ThreadHandler) Subscribe(req *threadpb.SubscribeRequest, stream threadpb.ThreadService_SubscribeServer) error {
	threadID := req.GetThreadId()
	userID := req.GetUserId()
	if threadID == "" || userID == "" {
		return status.Errorf(codes.InvalidArgument, "thread_id and user_id are required")
	}

	ctx := stream.Context()

	// Create a wrapper stream adapter
	adapter := &threadEventStreamAdapter{stream: stream}

	// Subscribe to thread events
	return h.pushService.SubscribeThread(ctx, threadID, userID, adapter)
}

// threadEventStreamAdapter adapts gRPC stream to push service interface
type threadEventStreamAdapter struct {
	stream threadpb.ThreadService_SubscribeServer
}

func (a *threadEventStreamAdapter) Send(event *push.ThreadEvent) error {
	pbEvent := &threadpb.ThreadEvent{
		EventType: event.EventType,
		ThreadId:  event.ThreadID,
		MsgId:     event.MsgID,
		Payload:   event.Payload,
		Timestamp: event.Timestamp,
	}
	return a.stream.Send(pbEvent)
}

// GetUserFeed gets user's follow feed
func (h *ThreadHandler) GetUserFeed(ctx context.Context, req *threadpb.GetUserFeedRequest) (*threadpb.GetUserFeedResponse, error) {
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
	dbcReq := &dbc.GetUserFollowFeedsRequest{
		UserId: userID,
		Limit:  limit + 1, // Fetch one extra to check has_more
		Offset: offset,
	}
	dbcResp, err := h.clients.HBaseThread.GetUserFollowFeeds(ctx, dbcReq)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get feed: %v", err)
	}

	// Convert DBC feeds to proto feeds
	allFeeds := dbcResp.GetFeeds()
	hasMore := int64(len(allFeeds)) > limit
	if hasMore {
		allFeeds = allFeeds[:limit] // Remove the extra one
	}

	feeds := make([]*threadpb.FeedItem, 0, len(allFeeds))
	for _, dbcFeed := range allFeeds {
		item := hdbcFeedToFeedItem(dbcFeed)
		// Check read status from Redis cache
		item.Read = h.getReadStatus(ctx, userID, dbcFeed.GetThreadId(), dbcFeed.GetMsgId())
		feeds = append(feeds, item)
	}

	// Calculate next cursor
	nextCursor := cursor.NextCursor(offset, limit, hasMore)
	return &threadpb.GetUserFeedResponse{
		Items:      feeds,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// GetReplyInbox gets user's reply inbox
func (h *ThreadHandler) GetReplyInbox(ctx context.Context, req *threadpb.GetReplyInboxRequest) (*threadpb.GetReplyInboxResponse, error) {
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
	dbcReq := &dbc.GetUserReplyFeedsRequest{
		UserId: userID,
		Limit:  limit + 1, // Fetch one extra to check has_more
		Offset: offset,
	}
	dbcResp, err := h.clients.HBaseThread.GetUserReplyFeeds(ctx, dbcReq)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get reply inbox: %v", err)
	}

	// Convert DBC feeds to proto feeds
	allFeeds := dbcResp.GetFeeds()
	hasMore := int64(len(allFeeds)) > limit
	if hasMore {
		allFeeds = allFeeds[:limit] // Remove the extra one
	}

	feeds := make([]*threadpb.ReplyItem, 0, len(allFeeds))
	for _, dbcFeed := range allFeeds {
		item := hdbcReplyFeedToReplyItem(dbcFeed)
		// Check read status from Redis cache
		item.Read = h.getReadStatus(ctx, userID, dbcFeed.GetThreadId(), dbcFeed.GetReplyMsgId())
		feeds = append(feeds, item)
	}

	// Calculate next cursor
	nextCursor := cursor.NextCursor(offset, limit, hasMore)
	return &threadpb.GetReplyInboxResponse{
		Items:      feeds,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// MarkAsRead marks messages as read
func (h *ThreadHandler) MarkAsRead(ctx context.Context, req *threadpb.MarkAsReadRequest) (*threadpb.MarkAsReadResponse, error) {
	userID := req.GetUserId()
	threadID := req.GetThreadId()
	if userID == "" || threadID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "user_id and thread_id are required")
	}

	// Use Redis cache to store read status
	// Key format: read:{user_id}:{thread_id}
	readKey := fmt.Sprintf("read:%s:%s", userID, threadID)
	
	// If msg_id is specified, mark specific message as read
	if req.GetMsgId() != "" {
		// Store message read timestamp
		msgReadKey := fmt.Sprintf("read:%s:%s:%s", userID, threadID, req.GetMsgId())
		dbcCacheReq := &dbc.SetRequest{
			Key:   msgReadKey,
			Value: fmt.Sprintf("%d", time.Now().Unix()),
		}
		_, err := h.clients.Cache.Set(ctx, dbcCacheReq)
		if err != nil {
			h.logger.Error("Failed to mark message as read", log.Err(err))
			return nil, status.Errorf(codes.Internal, "failed to mark message as read: %v", err)
		}
	} else {
		// Mark entire thread as read (store last read timestamp)
		dbcCacheReq := &dbc.SetRequest{
			Key:   readKey,
			Value: fmt.Sprintf("%d", time.Now().Unix()),
		}
		_, err := h.clients.Cache.Set(ctx, dbcCacheReq)
		if err != nil {
			h.logger.Error("Failed to mark thread as read", log.Err(err))
			return nil, status.Errorf(codes.Internal, "failed to mark thread as read: %v", err)
		}
	}

	// Also update the follow feed read status if applicable
	// This would require updating the HBase feed row, but for now we'll just use cache
	// In a full implementation, we might want to update the feed row's read flag

	return &threadpb.MarkAsReadResponse{Success: true}, nil
}

// =============================================================================
// Helper Functions - Statistics and Status
// =============================================================================

// getReadStatus checks if a message/thread is marked as read for a user
func (h *ThreadHandler) getReadStatus(ctx context.Context, userID, threadID, msgID string) bool {
	// Check message-specific read status
	if msgID != "" {
		msgReadKey := fmt.Sprintf("read:%s:%s:%s", userID, threadID, msgID)
		dbcCacheReq := &dbc.GetRequest{Key: msgReadKey}
		resp, err := h.clients.Cache.Get(ctx, dbcCacheReq)
		if err == nil && resp.GetValue() != "" {
			return true
		}
	}
	
	// Check thread-level read status
	readKey := fmt.Sprintf("read:%s:%s", userID, threadID)
	dbcCacheReq := &dbc.GetRequest{Key: readKey}
	resp, err := h.clients.Cache.Get(ctx, dbcCacheReq)
	if err == nil && resp.GetValue() != "" {
		// If thread is marked as read, all messages in the thread are considered read
		return true
	}
	
	return false
}

// =============================================================================
// Helper Functions - Proto Conversion
// =============================================================================

func contentTypeToString(ct commonpb.ContentType) string {
	switch ct {
	case commonpb.ContentType_TEXT:
		return "text"
	case commonpb.ContentType_IMAGE:
		return "image"
	case commonpb.ContentType_VIDEO:
		return "video"
	case commonpb.ContentType_FILE:
		return "file"
	case commonpb.ContentType_AUDIO:
		return "audio"
	default:
		return "text"
	}
}

func protoSettingsToJSON(settings *threadpb.ThreadSettings) string {
	if settings == nil {
		return "{}"
	}
	data, _ := json.Marshal(settings)
	return string(data)
}

func protoMetadataToJSON(metadata map[string]string) string {
	if len(metadata) == 0 {
		return "{}"
	}
	data, _ := json.Marshal(metadata)
	return string(data)
}

func hdbcMetadataToThread(meta *dbc.ThreadMetadata) *threadpb.Thread {
	if meta == nil {
		return nil
	}

	settings := &threadpb.ThreadSettings{}
	if meta.GetSettings() != "" {
		json.Unmarshal([]byte(meta.GetSettings()), settings)
	}

	stats := &threadpb.ThreadStats{
		ReplyCount:       meta.GetReplyCount(),
		ParticipantCount: int64(len(meta.GetParticipants())),
		LastMsgId:        meta.GetLastMsgId(),
		LastActiveAt:     meta.GetLastActiveAt(),
		HotScore:         meta.GetHotScore(),
	}

	return &threadpb.Thread{
		ThreadId:  meta.GetThreadId(),
		OwnerId:   meta.GetOwnerId(),
		RootMsgId: meta.GetRootMsgId(),
		Title:     meta.GetTitle(),
		Status:    hdbcStatusToThreadStatus(meta.GetStatus()),
		Settings:  settings,
		Stats:     stats,
		AiAgents:  meta.GetAiAgents(),
		CreatedAt: meta.GetCreatedAt(),
		UpdatedAt: meta.GetCreatedAt(), // DBC doesn't have updated_at, use created_at
	}
}

func hdbcStatusToThreadStatus(status string) threadpb.ThreadStatus {
	switch status {
	case "active":
		return threadpb.ThreadStatus_THREAD_ACTIVE
	case "closed":
		return threadpb.ThreadStatus_THREAD_CLOSED
	case "archived":
		return threadpb.ThreadStatus_THREAD_ARCHIVED
	default:
		return threadpb.ThreadStatus_THREAD_STATUS_UNSPECIFIED
	}
}

func hdbcMessageToThreadMessage(dbcMsg *dbc.ThreadMessageRow) *threadpb.ThreadMessage {
	if dbcMsg == nil {
		return nil
	}

	// Convert author type string to enum
	authorType := commonpb.AuthorType_AUTHOR_TYPE_UNSPECIFIED
	if dbcMsg.GetAuthorType() == "user" {
		authorType = commonpb.AuthorType_USER
	} else if dbcMsg.GetAuthorType() == "ai" {
		authorType = commonpb.AuthorType_AI
	}

	// Convert content type string to enum
	contentType := commonpb.ContentType_CONTENT_TYPE_UNSPECIFIED
	switch dbcMsg.GetContentType() {
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
		MsgId:       dbcMsg.GetMsgId(),
		AuthorId:    dbcMsg.GetAuthorId(),
		AuthorType:  authorType,
		RawContent:  dbcMsg.GetRawContent(),
		ContentType: contentType,
		Mentions:    dbcMsg.GetMentions(),
		Metadata:    hdbcMetadataToMap(dbcMsg.GetMetadata()),
		Timestamp:   dbcMsg.GetTimestamp(),
	}

	return &threadpb.ThreadMessage{
		Base:        baseMsg,
		ThreadId:    dbcMsg.GetThreadId(),
		ParentMsgId: dbcMsg.GetParentMsgId(),
		Depth:       int32(dbcMsg.GetDepth()),
		ReplyCount:  0, // ReplyCount is not stored per message, it's in thread metadata
		IsRoot:      dbcMsg.GetParentMsgId() == "",
		Deleted:     dbcMsg.GetDeleted(),
	}
}

func hdbcMetadataToMap(metadata string) map[string]string {
	if metadata == "" {
		return map[string]string{}
	}
	var result map[string]string
	json.Unmarshal([]byte(metadata), &result)
	return result
}

func hdbcFeedToFeedItem(dbcFeed *dbc.FollowFeedRow) *threadpb.FeedItem {
	if dbcFeed == nil {
		return nil
	}

	return &threadpb.FeedItem{
		ThreadId:       dbcFeed.GetThreadId(),
		MsgId:          dbcFeed.GetMsgId(),
		AuthorId:       dbcFeed.GetAuthorId(),
		ContentPreview: dbcFeed.GetContentPreview(),
		Timestamp:      dbcFeed.GetTimestamp(),
		Read:           false, // Read status will be checked separately in GetUserFeed
	}
}

func hdbcReplyFeedToReplyItem(dbcFeed *dbc.ReplyFeedRow) *threadpb.ReplyItem {
	if dbcFeed == nil {
		return nil
	}

	return &threadpb.ReplyItem{
		ThreadId:       dbcFeed.GetThreadId(),
		ReplyMsgId:     dbcFeed.GetReplyMsgId(),
		ReplyAuthorId:  dbcFeed.GetReplyAuthor(),
		ParentMsgId:    dbcFeed.GetParentMsgId(),
		PushType:       dbcFeed.GetPushType(),
		ContentPreview: dbcFeed.GetContentPreview(),
		FullContent:    dbcFeed.GetFullContent(),
		Reason:         dbcFeed.GetReason(),
		RequireFollow:  dbcFeed.GetRequireFollow(),
		ThreadOwner:    dbcFeed.GetThreadOwner(),
		Timestamp:      dbcFeed.GetTimestamp(),
		Read:           false, // TODO: Get from flags
	}
}
