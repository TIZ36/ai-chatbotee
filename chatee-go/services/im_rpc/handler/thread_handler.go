package handler

import (
	"context"
	"encoding/json"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	commonpb "chatee-go/gen/common"
	dbc "chatee-go/gen/dbc"
	threadpb "chatee-go/gen/im/thread"
	"chatee-go/services/im_rpc/biz"
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
		h.logger.Error("Failed to create thread", "error", err)
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
		h.logger.Error("Failed to get thread metadata", "thread_id", threadID, "error", err)
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

	// Save to DBC
	// TODO: Implement update in DBC service

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
	// TODO: Implement list threads via DBC service
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

	return &threadpb.PublishResponse{
		ThreadId:  createResp.GetThreadId(),
		MsgId:     createResp.GetMsgId(),
		Timestamp: createResp.GetTimestamp(),
		Fanout:    &threadpb.FanoutResult{}, // TODO: Get actual fanout result
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
		h.logger.Error("Failed to reply", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to reply: %v", err)
	}

	// Calculate fanout result
	totalRecipients := len(resp.FullTargets) + len(resp.LimitedTargets)
	aiNotified := 0
	for _, target := range resp.FullTargets {
		if len(target) > 0 && (target[0] == 'a' || len(target) > 3 && target[:3] == "ai_") {
			aiNotified++
		}
	}
	for _, target := range resp.LimitedTargets {
		if len(target) > 0 && (target[0] == 'a' || len(target) > 3 && target[:3] == "ai_") {
			aiNotified++
		}
	}

	return &threadpb.ReplyResponse{
		MsgId:          resp.ReplyMsgID,
		Timestamp:      time.Now().Unix(),
		FullTargets:    resp.FullTargets,
		LimitedTargets: resp.LimitedTargets,
		Fanout:         &threadpb.FanoutResult{
			TotalRecipients: int32(totalRecipients),
			OnlinePushed:    0,  // TODO: Get from push service status
			OfflineStored:   int32(totalRecipients), // All stored in inbox
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
	if msgID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "msg_id is required")
	}

	// TODO: Implement delete message via DBC service
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
		feeds = append(feeds, hdbcFeedToFeedItem(dbcFeed))
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
		feeds = append(feeds, hdbcReplyFeedToReplyItem(dbcFeed))
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

	// Update read status via DBC Cache service
	// TODO: Implement mark as read

	return &threadpb.MarkAsReadResponse{Success: true}, nil
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
		ReplyCount:  0, // TODO: Get from message stats
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
		Read:           dbcFeed.GetRead(),
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
