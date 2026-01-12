package handler

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	dbc "chatee-go/gen/dbc"
	repository "chatee-go/services/dbc_rpc/repository/hbase"
)

// HBaseThreadHandler implements HBaseThreadService gRPC interface
type HBaseThreadHandler struct {
	dbc.UnimplementedHBaseThreadServiceServer

	logger log.Logger
	repo   repository.HBaseRepository
}

// NewHBaseThreadHandler creates a new HBase thread handler
func NewHBaseThreadHandler(poolMgr *pool.PoolManager, logger log.Logger) *HBaseThreadHandler {
	var repo repository.HBaseRepository
	if poolMgr.HBase() != nil {
		repo = repository.NewGHBaseRepository(poolMgr.HBase(), "chatee_", logger)
	} else {
		// 如果 HBase 不可用，使用内存实现
		repo = repository.NewMemoryHBaseRepository()
	}
	return &HBaseThreadHandler{
		logger: logger,
		repo:   repo,
	}
}

// Register registers the handler with gRPC server
func (h *HBaseThreadHandler) Register(server *grpc.Server) {
	dbc.RegisterHBaseThreadServiceServer(server, h)
}

// SaveThreadMetadata saves thread metadata
func (h *HBaseThreadHandler) SaveThreadMetadata(ctx context.Context, req *dbc.SaveThreadMetadataRequest) (*dbc.SaveThreadMetadataResponse, error) {
	thread := h.protoToThreadMetadata(req.GetThread())
	if err := h.repo.SaveThreadMetadata(ctx, thread); err != nil {
		h.logger.Error("Failed to save thread metadata", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to save thread metadata: %v", err)
	}

	return &dbc.SaveThreadMetadataResponse{Success: true}, nil
}

// GetThreadMetadata retrieves thread metadata
func (h *HBaseThreadHandler) GetThreadMetadata(ctx context.Context, req *dbc.GetThreadMetadataRequest) (*dbc.ThreadMetadata, error) {
	thread, err := h.repo.GetThreadMetadata(ctx, req.GetThreadId())
	if err != nil {
		h.logger.Error("Failed to get thread metadata", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get thread metadata: %v", err)
	}

	return h.threadMetadataToProto(thread), nil
}

// SaveThreadMessage saves a thread message
func (h *HBaseThreadHandler) SaveThreadMessage(ctx context.Context, req *dbc.SaveThreadMessageRequest) (*dbc.SaveThreadMessageResponse, error) {
	msg := h.protoToThreadMessage(req.GetMessage())
	if err := h.repo.SaveThreadMessage(ctx, msg); err != nil {
		h.logger.Error("Failed to save thread message", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to save thread message: %v", err)
	}

	return &dbc.SaveThreadMessageResponse{Success: true}, nil
}

// GetThreadMessage retrieves a thread message
func (h *HBaseThreadHandler) GetThreadMessage(ctx context.Context, req *dbc.GetThreadMessageRequest) (*dbc.ThreadMessageRow, error) {
	msg, err := h.repo.GetThreadMessage(ctx, req.GetThreadId(), req.GetMsgId())
	if err != nil {
		h.logger.Error("Failed to get thread message", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get thread message: %v", err)
	}

	return h.threadMessageToProto(msg), nil
}

// GetThreadMessages retrieves thread messages
func (h *HBaseThreadHandler) GetThreadMessages(ctx context.Context, req *dbc.GetThreadMessagesRequest) (*dbc.GetThreadMessagesResponse, error) {
	messages, err := h.repo.GetThreadMessages(ctx, req.GetThreadId(), req.GetLimit(), req.GetOffset())
	if err != nil {
		h.logger.Error("Failed to get thread messages", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get thread messages: %v", err)
	}

	protoMessages := make([]*dbc.ThreadMessageRow, 0, len(messages))
	for _, msg := range messages {
		protoMessages = append(protoMessages, h.threadMessageToProto(msg))
	}

	return &dbc.GetThreadMessagesResponse{
		Messages: protoMessages,
	}, nil
}

// SaveFollowFeed saves a follow feed entry
func (h *HBaseThreadHandler) SaveFollowFeed(ctx context.Context, req *dbc.SaveFollowFeedRequest) (*dbc.SaveFollowFeedResponse, error) {
	feed := h.protoToFollowFeed(req.GetFeed())
	if err := h.repo.SaveFollowFeed(ctx, feed); err != nil {
		h.logger.Error("Failed to save follow feed", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to save follow feed: %v", err)
	}

	return &dbc.SaveFollowFeedResponse{Success: true}, nil
}

// GetUserFollowFeeds retrieves user follow feeds
func (h *HBaseThreadHandler) GetUserFollowFeeds(ctx context.Context, req *dbc.GetUserFollowFeedsRequest) (*dbc.GetUserFollowFeedsResponse, error) {
	feeds, err := h.repo.GetUserFollowFeeds(ctx, req.GetUserId(), req.GetLimit(), req.GetOffset())
	if err != nil {
		h.logger.Error("Failed to get user follow feeds", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get user follow feeds: %v", err)
	}

	protoFeeds := make([]*dbc.FollowFeedRow, 0, len(feeds))
	for _, feed := range feeds {
		protoFeeds = append(protoFeeds, h.followFeedToProto(feed))
	}

	return &dbc.GetUserFollowFeedsResponse{
		Feeds: protoFeeds,
		Total: int64(len(protoFeeds)), // TODO: Get actual total count
	}, nil
}

// SaveReplyFeed saves a reply feed entry
func (h *HBaseThreadHandler) SaveReplyFeed(ctx context.Context, req *dbc.SaveReplyFeedRequest) (*dbc.SaveReplyFeedResponse, error) {
	feed := h.protoToReplyFeed(req.GetFeed())
	if err := h.repo.SaveReplyFeed(ctx, feed); err != nil {
		h.logger.Error("Failed to save reply feed", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to save reply feed: %v", err)
	}

	return &dbc.SaveReplyFeedResponse{Success: true}, nil
}

// GetUserReplyFeeds retrieves user reply feeds
func (h *HBaseThreadHandler) GetUserReplyFeeds(ctx context.Context, req *dbc.GetUserReplyFeedsRequest) (*dbc.GetUserReplyFeedsResponse, error) {
	feeds, err := h.repo.GetUserReplyFeeds(ctx, req.GetUserId(), req.GetLimit(), req.GetOffset())
	if err != nil {
		h.logger.Error("Failed to get user reply feeds", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get user reply feeds: %v", err)
	}

	protoFeeds := make([]*dbc.ReplyFeedRow, 0, len(feeds))
	for _, feed := range feeds {
		protoFeeds = append(protoFeeds, h.replyFeedToProto(feed))
	}

	return &dbc.GetUserReplyFeedsResponse{
		Feeds: protoFeeds,
		Total: int64(len(protoFeeds)), // TODO: Get actual total count
	}, nil
}

// Conversion functions

func (h *HBaseThreadHandler) protoToThreadMetadata(proto *dbc.ThreadMetadata) *repository.ThreadMetadata {
	if proto == nil {
		return nil
	}
	return &repository.ThreadMetadata{
		ThreadID:     proto.GetThreadId(),
		OwnerID:      proto.GetOwnerId(),
		RootMsgID:    proto.GetRootMsgId(),
		Title:        proto.GetTitle(),
		AIAgents:     proto.GetAiAgents(),
		Settings:     proto.GetSettings(),
		CreatedAt:    proto.GetCreatedAt(),
		Status:       proto.GetStatus(),
		ReplyCount:   proto.GetReplyCount(),
		Participants: proto.GetParticipants(),
		LastMsgID:    proto.GetLastMsgId(),
		LastActiveAt: proto.GetLastActiveAt(),
		HotScore:     proto.GetHotScore(),
	}
}

func (h *HBaseThreadHandler) threadMetadataToProto(meta *repository.ThreadMetadata) *dbc.ThreadMetadata {
	if meta == nil {
		return nil
	}
	return &dbc.ThreadMetadata{
		ThreadId:     meta.ThreadID,
		OwnerId:      meta.OwnerID,
		RootMsgId:    meta.RootMsgID,
		Title:        meta.Title,
		AiAgents:     meta.AIAgents,
		Settings:     meta.Settings,
		CreatedAt:    meta.CreatedAt,
		Status:       meta.Status,
		ReplyCount:   meta.ReplyCount,
		Participants: meta.Participants,
		LastMsgId:    meta.LastMsgID,
		LastActiveAt: meta.LastActiveAt,
		HotScore:     meta.HotScore,
	}
}

func (h *HBaseThreadHandler) protoToThreadMessage(proto *dbc.ThreadMessageRow) *repository.ThreadMessageRow {
	if proto == nil {
		return nil
	}
	return &repository.ThreadMessageRow{
		RowKey:      proto.GetRowKey(),
		ThreadID:    proto.GetThreadId(),
		MsgID:       proto.GetMsgId(),
		AuthorID:    proto.GetAuthorId(),
		AuthorType:  proto.GetAuthorType(),
		ContentType: proto.GetContentType(),
		RawContent:  proto.GetRawContent(),
		Compressed:  proto.GetCompressed(),
		ParentMsgID: proto.GetParentMsgId(),
		Mentions:    proto.GetMentions(),
		Depth:       proto.GetDepth(),
		Metadata:    proto.GetMetadata(),
		Timestamp:   proto.GetTimestamp(),
		Deleted:     proto.GetDeleted(),
	}
}

func (h *HBaseThreadHandler) threadMessageToProto(msg *repository.ThreadMessageRow) *dbc.ThreadMessageRow {
	if msg == nil {
		return nil
	}
	return &dbc.ThreadMessageRow{
		RowKey:      msg.RowKey,
		ThreadId:    msg.ThreadID,
		MsgId:       msg.MsgID,
		AuthorId:    msg.AuthorID,
		AuthorType:  msg.AuthorType,
		ContentType: msg.ContentType,
		RawContent:  msg.RawContent,
		Compressed:  msg.Compressed,
		ParentMsgId: msg.ParentMsgID,
		Mentions:    msg.Mentions,
		Depth:       msg.Depth,
		Metadata:    msg.Metadata,
		Timestamp:   msg.Timestamp,
		Deleted:     msg.Deleted,
	}
}

func (h *HBaseThreadHandler) protoToFollowFeed(proto *dbc.FollowFeedRow) *repository.FollowFeedRow {
	if proto == nil {
		return nil
	}
	return &repository.FollowFeedRow{
		RowKey:         proto.GetRowKey(),
		UserID:         proto.GetUserId(),
		ThreadID:       proto.GetThreadId(),
		MsgID:          proto.GetMsgId(),
		MsgType:        proto.GetMsgType(),
		AuthorID:       proto.GetAuthorId(),
		AuthorType:     proto.GetAuthorType(),
		ContentPreview: proto.GetContentPreview(),
		Flags:          proto.GetFlags(),
		Timestamp:      proto.GetTimestamp(),
		Read:           proto.GetRead(),
	}
}

func (h *HBaseThreadHandler) followFeedToProto(feed *repository.FollowFeedRow) *dbc.FollowFeedRow {
	if feed == nil {
		return nil
	}
	return &dbc.FollowFeedRow{
		RowKey:         feed.RowKey,
		UserId:         feed.UserID,
		ThreadId:       feed.ThreadID,
		MsgId:          feed.MsgID,
		MsgType:        feed.MsgType,
		AuthorId:       feed.AuthorID,
		AuthorType:     feed.AuthorType,
		ContentPreview: feed.ContentPreview,
		Flags:          feed.Flags,
		Timestamp:      feed.Timestamp,
		Read:           feed.Read,
	}
}

func (h *HBaseThreadHandler) protoToReplyFeed(proto *dbc.ReplyFeedRow) *repository.ReplyFeedRow {
	if proto == nil {
		return nil
	}
	return &repository.ReplyFeedRow{
		RowKey:         proto.GetRowKey(),
		UserID:         proto.GetUserId(),
		ThreadID:       proto.GetThreadId(),
		ReplyMsgID:     proto.GetReplyMsgId(),
		ReplyAuthor:    proto.GetReplyAuthor(),
		ParentMsgID:    proto.GetParentMsgId(),
		PushType:       proto.GetPushType(),
		ContentType:    proto.GetContentType(),
		ContentPreview: proto.GetContentPreview(),
		FullContent:    proto.GetFullContent(),
		Reason:         proto.GetReason(),
		Timestamp:      proto.GetTimestamp(),
		RequireFollow:  proto.GetRequireFollow(),
		ThreadOwner:    proto.GetThreadOwner(),
	}
}

func (h *HBaseThreadHandler) replyFeedToProto(feed *repository.ReplyFeedRow) *dbc.ReplyFeedRow {
	if feed == nil {
		return nil
	}
	return &dbc.ReplyFeedRow{
		RowKey:         feed.RowKey,
		UserId:         feed.UserID,
		ThreadId:       feed.ThreadID,
		ReplyMsgId:     feed.ReplyMsgID,
		ReplyAuthor:    feed.ReplyAuthor,
		ParentMsgId:    feed.ParentMsgID,
		PushType:       feed.PushType,
		ContentType:    feed.ContentType,
		ContentPreview: feed.ContentPreview,
		FullContent:    feed.FullContent,
		Reason:         feed.Reason,
		Timestamp:      feed.Timestamp,
		RequireFollow:  feed.RequireFollow,
		ThreadOwner:    feed.ThreadOwner,
	}
}
