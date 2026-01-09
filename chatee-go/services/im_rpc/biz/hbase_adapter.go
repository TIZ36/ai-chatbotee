package service

import (
	"context"

	dbc "chatee-go/gen/dbc"
	"chatee-go/services/dbc_rpc/repository"
)

// HBaseAdapter adapts gRPC DBC clients to HBaseRepository interface
type HBaseAdapter struct {
	threadClient dbc.HBaseThreadServiceClient
	chatClient   dbc.HBaseChatServiceClient
}

// NewHBaseAdapter creates a new HBase adapter
func NewHBaseAdapter(threadClient dbc.HBaseThreadServiceClient, chatClient dbc.HBaseChatServiceClient) repository.HBaseRepository {
	return &HBaseAdapter{
		threadClient: threadClient,
		chatClient:   chatClient,
	}
}

// Thread operations
func (a *HBaseAdapter) SaveThreadMetadata(ctx context.Context, thread *repository.ThreadMetadata) error {
	req := &dbc.SaveThreadMetadataRequest{
		Thread: hbaseMetadataToDBC(thread),
	}
	_, err := a.threadClient.SaveThreadMetadata(ctx, req)
	return err
}

func (a *HBaseAdapter) GetThreadMetadata(ctx context.Context, threadID string) (*repository.ThreadMetadata, error) {
	req := &dbc.GetThreadMetadataRequest{ThreadId: threadID}
	resp, err := a.threadClient.GetThreadMetadata(ctx, req)
	if err != nil {
		return nil, err
	}
	return dbcMetadataToHBase(resp), nil
}

func (a *HBaseAdapter) SaveThreadMessage(ctx context.Context, msg *repository.ThreadMessageRow) error {
	req := &dbc.SaveThreadMessageRequest{
		Message: hbaseMessageToDBC(msg),
	}
	_, err := a.threadClient.SaveThreadMessage(ctx, req)
	return err
}

func (a *HBaseAdapter) GetThreadMessage(ctx context.Context, threadID, msgID string) (*repository.ThreadMessageRow, error) {
	req := &dbc.GetThreadMessageRequest{
		ThreadId: threadID,
		MsgId:    msgID,
	}
	resp, err := a.threadClient.GetThreadMessage(ctx, req)
	if err != nil {
		return nil, err
	}
	return dbcMessageToHBase(resp), nil
}

func (a *HBaseAdapter) GetThreadMessages(ctx context.Context, threadID string, limit, offset int64) ([]*repository.ThreadMessageRow, error) {
	req := &dbc.GetThreadMessagesRequest{
		ThreadId: threadID,
		Limit:    limit,
		Offset:   offset,
	}
	resp, err := a.threadClient.GetThreadMessages(ctx, req)
	if err != nil {
		return nil, err
	}
	
	messages := make([]*repository.ThreadMessageRow, 0, len(resp.GetMessages()))
	for _, msg := range resp.GetMessages() {
		messages = append(messages, dbcMessageToHBase(msg))
	}
	return messages, nil
}

func (a *HBaseAdapter) SaveFollowFeed(ctx context.Context, feed *repository.FollowFeedRow) error {
	req := &dbc.SaveFollowFeedRequest{
		Feed: hbaseFollowFeedToDBC(feed),
	}
	_, err := a.threadClient.SaveFollowFeed(ctx, req)
	return err
}

func (a *HBaseAdapter) GetUserFollowFeeds(ctx context.Context, userID string, limit, offset int64) ([]*repository.FollowFeedRow, error) {
	req := &dbc.GetUserFollowFeedsRequest{
		UserId: userID,
		Limit:  limit,
		Offset: offset,
	}
	resp, err := a.threadClient.GetUserFollowFeeds(ctx, req)
	if err != nil {
		return nil, err
	}
	
	feeds := make([]*repository.FollowFeedRow, 0, len(resp.GetFeeds()))
	for _, feed := range resp.GetFeeds() {
		feeds = append(feeds, dbcFollowFeedToHBase(feed))
	}
	return feeds, nil
}

func (a *HBaseAdapter) SaveReplyFeed(ctx context.Context, feed *repository.ReplyFeedRow) error {
	req := &dbc.SaveReplyFeedRequest{
		Feed: hbaseReplyFeedToDBC(feed),
	}
	_, err := a.threadClient.SaveReplyFeed(ctx, req)
	return err
}

func (a *HBaseAdapter) GetUserReplyFeeds(ctx context.Context, userID string, limit, offset int64) ([]*repository.ReplyFeedRow, error) {
	req := &dbc.GetUserReplyFeedsRequest{
		UserId: userID,
		Limit:  limit,
		Offset: offset,
	}
	resp, err := a.threadClient.GetUserReplyFeeds(ctx, req)
	if err != nil {
		return nil, err
	}
	
	feeds := make([]*repository.ReplyFeedRow, 0, len(resp.GetFeeds()))
	for _, feed := range resp.GetFeeds() {
		feeds = append(feeds, dbcReplyFeedToHBase(feed))
	}
	return feeds, nil
}

// Chat operations
func (a *HBaseAdapter) SaveChatMetadata(ctx context.Context, chat *repository.ChatMetadataRow) error {
	req := &dbc.SaveChatMetadataRequest{
		Chat: hbaseChatMetadataToDBC(chat),
	}
	_, err := a.chatClient.SaveChatMetadata(ctx, req)
	return err
}

func (a *HBaseAdapter) GetChatMetadata(ctx context.Context, chatKey string) (*repository.ChatMetadataRow, error) {
	req := &dbc.GetChatMetadataRequest{ChatKey: chatKey}
	resp, err := a.chatClient.GetChatMetadata(ctx, req)
	if err != nil {
		return nil, err
	}
	return dbcChatMetadataToHBase(resp), nil
}

func (a *HBaseAdapter) SaveChatInbox(ctx context.Context, inbox *repository.ChatInboxRow) error {
	req := &dbc.SaveChatInboxRequest{
		Inbox: hbaseChatInboxToDBC(inbox),
	}
	_, err := a.chatClient.SaveChatInbox(ctx, req)
	return err
}

func (a *HBaseAdapter) GetUserChatInbox(ctx context.Context, userID, chatKey string, limit, offset int64) ([]*repository.ChatInboxRow, error) {
	req := &dbc.GetUserChatInboxRequest{
		UserId:  userID,
		ChatKey: chatKey,
		Limit:   limit,
		Offset:  offset,
	}
	resp, err := a.chatClient.GetUserChatInbox(ctx, req)
	if err != nil {
		return nil, err
	}
	
	inboxes := make([]*repository.ChatInboxRow, 0, len(resp.GetInboxes()))
	for _, inbox := range resp.GetInboxes() {
		inboxes = append(inboxes, dbcChatInboxToHBase(inbox))
	}
	return inboxes, nil
}

// =============================================================================
// Conversion functions
// =============================================================================

func hbaseMetadataToDBC(meta *repository.ThreadMetadata) *dbc.ThreadMetadata {
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

func dbcMetadataToHBase(meta *dbc.ThreadMetadata) *repository.ThreadMetadata {
	if meta == nil {
		return nil
	}
	return &repository.ThreadMetadata{
		ThreadID:     meta.GetThreadId(),
		OwnerID:      meta.GetOwnerId(),
		RootMsgID:    meta.GetRootMsgId(),
		Title:        meta.GetTitle(),
		AIAgents:     meta.GetAiAgents(),
		Settings:     meta.GetSettings(),
		CreatedAt:    meta.GetCreatedAt(),
		Status:       meta.GetStatus(),
		ReplyCount:   meta.GetReplyCount(),
		Participants: meta.GetParticipants(),
		LastMsgID:    meta.GetLastMsgId(),
		LastActiveAt: meta.GetLastActiveAt(),
		HotScore:     meta.GetHotScore(),
	}
}

func hbaseMessageToDBC(msg *repository.ThreadMessageRow) *dbc.ThreadMessageRow {
	if msg == nil {
		return nil
	}
	return &dbc.ThreadMessageRow{
		RowKey:     msg.RowKey,
		ThreadId:   msg.ThreadID,
		MsgId:      msg.MsgID,
		AuthorId:   msg.AuthorID,
		AuthorType: msg.AuthorType,
		ContentType: msg.ContentType,
		RawContent: msg.RawContent,
		Compressed: msg.Compressed,
		ParentMsgId: msg.ParentMsgID,
		Mentions:    msg.Mentions,
		Depth:      msg.Depth,
		Metadata:   msg.Metadata,
		Timestamp:  msg.Timestamp,
		Deleted:    msg.Deleted,
	}
}

func dbcMessageToHBase(msg *dbc.ThreadMessageRow) *repository.ThreadMessageRow {
	if msg == nil {
		return nil
	}
	return &repository.ThreadMessageRow{
		RowKey:     msg.GetRowKey(),
		ThreadID:   msg.GetThreadId(),
		MsgID:      msg.GetMsgId(),
		AuthorID:   msg.GetAuthorId(),
		AuthorType: msg.GetAuthorType(),
		ContentType: msg.GetContentType(),
		RawContent: msg.GetRawContent(),
		Compressed: msg.GetCompressed(),
		ParentMsgID: msg.GetParentMsgId(),
		Mentions:    msg.GetMentions(),
		Depth:      msg.GetDepth(),
		Metadata:   msg.GetMetadata(),
		Timestamp:  msg.GetTimestamp(),
		Deleted:    msg.GetDeleted(),
	}
}

func hbaseFollowFeedToDBC(feed *repository.FollowFeedRow) *dbc.FollowFeedRow {
	if feed == nil {
		return nil
	}
	return &dbc.FollowFeedRow{
		RowKey:        feed.RowKey,
		UserId:        feed.UserID,
		ThreadId:      feed.ThreadID,
		MsgId:         feed.MsgID,
		MsgType:       feed.MsgType,
		AuthorId:      feed.AuthorID,
		AuthorType:    feed.AuthorType,
		ContentPreview: feed.ContentPreview,
		Flags:         feed.Flags,
		Timestamp:     feed.Timestamp,
		Read:          feed.Read,
	}
}

func dbcFollowFeedToHBase(feed *dbc.FollowFeedRow) *repository.FollowFeedRow {
	if feed == nil {
		return nil
	}
	return &repository.FollowFeedRow{
		RowKey:        feed.GetRowKey(),
		UserID:        feed.GetUserId(),
		ThreadID:      feed.GetThreadId(),
		MsgID:         feed.GetMsgId(),
		MsgType:       feed.GetMsgType(),
		AuthorID:      feed.GetAuthorId(),
		AuthorType:    feed.GetAuthorType(),
		ContentPreview: feed.GetContentPreview(),
		Flags:         feed.GetFlags(),
		Timestamp:     feed.GetTimestamp(),
		Read:          feed.GetRead(),
	}
}

func hbaseReplyFeedToDBC(feed *repository.ReplyFeedRow) *dbc.ReplyFeedRow {
	if feed == nil {
		return nil
	}
	return &dbc.ReplyFeedRow{
		RowKey:        feed.RowKey,
		UserId:        feed.UserID,
		ThreadId:      feed.ThreadID,
		ReplyMsgId:    feed.ReplyMsgID,
		ReplyAuthor:   feed.ReplyAuthor,
		ParentMsgId:   feed.ParentMsgID,
		PushType:      feed.PushType,
		ContentType:   feed.ContentType,
		ContentPreview: feed.ContentPreview,
		FullContent:   feed.FullContent,
		Reason:        feed.Reason,
		Timestamp:     feed.Timestamp,
		RequireFollow: feed.RequireFollow,
		ThreadOwner:   feed.ThreadOwner,
	}
}

func dbcReplyFeedToHBase(feed *dbc.ReplyFeedRow) *repository.ReplyFeedRow {
	if feed == nil {
		return nil
	}
	return &repository.ReplyFeedRow{
		RowKey:        feed.GetRowKey(),
		UserID:        feed.GetUserId(),
		ThreadID:      feed.GetThreadId(),
		ReplyMsgID:    feed.GetReplyMsgId(),
		ReplyAuthor:   feed.GetReplyAuthor(),
		ParentMsgID:   feed.GetParentMsgId(),
		PushType:      feed.GetPushType(),
		ContentType:   feed.GetContentType(),
		ContentPreview: feed.GetContentPreview(),
		FullContent:   feed.GetFullContent(),
		Reason:        feed.GetReason(),
		Timestamp:     feed.GetTimestamp(),
		RequireFollow: feed.GetRequireFollow(),
		ThreadOwner:   feed.GetThreadOwner(),
	}
}

func hbaseChatMetadataToDBC(chat *repository.ChatMetadataRow) *dbc.ChatMetadataRow {
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

func dbcChatMetadataToHBase(chat *dbc.ChatMetadataRow) *repository.ChatMetadataRow {
	if chat == nil {
		return nil
	}
	return &repository.ChatMetadataRow{
		RowKey:       chat.GetRowKey(),
		ChatKey:      chat.GetChatKey(),
		ChatType:     chat.GetChatType(),
		Participants: chat.GetParticipants(),
		AIAgents:     chat.GetAiAgents(),
		CreatedBy:    chat.GetCreatedBy(),
		CreatedAt:    chat.GetCreatedAt(),
		Settings:     chat.GetSettings(),
		Status:       chat.GetStatus(),
		MsgCount:     chat.GetMsgCount(),
		LastMsgID:    chat.GetLastMsgId(),
		LastActiveAt: chat.GetLastActiveAt(),
		UnreadCounts: chat.GetUnreadCounts(),
	}
}

func hbaseChatInboxToDBC(inbox *repository.ChatInboxRow) *dbc.ChatInboxRow {
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

func dbcChatInboxToHBase(inbox *dbc.ChatInboxRow) *repository.ChatInboxRow {
	if inbox == nil {
		return nil
	}
	return &repository.ChatInboxRow{
		RowKey:      inbox.GetRowKey(),
		UserID:      inbox.GetUserId(),
		ChatKey:     inbox.GetChatKey(),
		MsgID:       inbox.GetMsgId(),
		SenderID:    inbox.GetSenderId(),
		SenderType:  inbox.GetSenderType(),
		ContentType: inbox.GetContentType(),
		RawContent:  inbox.GetRawContent(),
		Mentions:    inbox.GetMentions(),
		Flags:       inbox.GetFlags(),
		Timestamp:   inbox.GetTimestamp(),
	}
}

