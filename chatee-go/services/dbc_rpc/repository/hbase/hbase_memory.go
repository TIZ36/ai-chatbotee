package repository

import (
	"context"
	"fmt"
)

// =============================================================================
// Memory-based HBase Repository (临时实现,用于开发测试)
// =============================================================================

// MemoryHBaseRepository is a memory-based implementation for development
// In production, this should be replaced with actual HBase client
type MemoryHBaseRepository struct {
	threadMetadata map[string]*ThreadMetadata
	threadMessages map[string]*ThreadMessageRow
	followFeeds    map[string]*FollowFeedRow
	replyFeeds     map[string]*ReplyFeedRow
	chatMetadata   map[string]*ChatMetadataRow
	chatInbox      map[string]*ChatInboxRow
}

// NewMemoryHBaseRepository creates a new memory-based HBase repository
func NewMemoryHBaseRepository() HBaseRepository {
	return &MemoryHBaseRepository{
		threadMetadata: make(map[string]*ThreadMetadata),
		threadMessages: make(map[string]*ThreadMessageRow),
		followFeeds:    make(map[string]*FollowFeedRow),
		replyFeeds:     make(map[string]*ReplyFeedRow),
		chatMetadata:   make(map[string]*ChatMetadataRow),
		chatInbox:      make(map[string]*ChatInboxRow),
	}
}

func (r *MemoryHBaseRepository) SaveThreadMetadata(ctx context.Context, thread *ThreadMetadata) error {
	key := fmt.Sprintf("thread_%s", thread.ThreadID)
	r.threadMetadata[key] = thread
	return nil
}

func (r *MemoryHBaseRepository) GetThreadMetadata(ctx context.Context, threadID string) (*ThreadMetadata, error) {
	key := fmt.Sprintf("thread_%s", threadID)
	thread, ok := r.threadMetadata[key]
	if !ok {
		return nil, fmt.Errorf("thread not found: %s", threadID)
	}
	return thread, nil
}

func (r *MemoryHBaseRepository) SaveThreadMessage(ctx context.Context, msg *ThreadMessageRow) error {
	if msg.RowKey == "" {
		msg.RowKey = buildThreadMessageRowKey(msg.ThreadID, msg.Timestamp, msg.MsgID)
	}
	r.threadMessages[msg.RowKey] = msg
	return nil
}

func (r *MemoryHBaseRepository) GetThreadMessages(ctx context.Context, threadID string, limit, offset int64) ([]*ThreadMessageRow, error) {
	var results []*ThreadMessageRow
	for _, msg := range r.threadMessages {
		if msg.ThreadID == threadID && !msg.Deleted {
			results = append(results, msg)
		}
	}
	// Sort by timestamp descending (reverse timestamp ascending)
	// Simple implementation - in production, use proper sorting
	if len(results) > int(offset) {
		results = results[offset:]
	}
	if len(results) > int(limit) {
		results = results[:limit]
	}
	return results, nil
}

func (r *MemoryHBaseRepository) GetThreadMessage(ctx context.Context, threadID, msgID string) (*ThreadMessageRow, error) {
	for _, msg := range r.threadMessages {
		if msg.ThreadID == threadID && msg.MsgID == msgID {
			return msg, nil
		}
	}
	return nil, fmt.Errorf("message not found: %s/%s", threadID, msgID)
}

func (r *MemoryHBaseRepository) SaveFollowFeed(ctx context.Context, feed *FollowFeedRow) error {
	if feed.RowKey == "" {
		feed.RowKey = buildFollowFeedRowKey(feed.UserID, feed.Timestamp, feed.ThreadID, feed.MsgID)
	}
	r.followFeeds[feed.RowKey] = feed
	return nil
}

func (r *MemoryHBaseRepository) GetUserFollowFeeds(ctx context.Context, userID string, limit, offset int64) ([]*FollowFeedRow, error) {
	var results []*FollowFeedRow
	for _, feed := range r.followFeeds {
		if feed.UserID == userID {
			results = append(results, feed)
		}
	}
	// Sort by timestamp descending
	if len(results) > int(offset) {
		results = results[offset:]
	}
	if len(results) > int(limit) {
		results = results[:limit]
	}
	return results, nil
}

func (r *MemoryHBaseRepository) SaveReplyFeed(ctx context.Context, feed *ReplyFeedRow) error {
	if feed.RowKey == "" {
		feed.RowKey = buildReplyFeedRowKey(feed.UserID, feed.Timestamp, feed.ThreadID, feed.ReplyMsgID)
	}
	r.replyFeeds[feed.RowKey] = feed
	return nil
}

func (r *MemoryHBaseRepository) GetUserReplyFeeds(ctx context.Context, userID string, limit, offset int64) ([]*ReplyFeedRow, error) {
	var results []*ReplyFeedRow
	for _, feed := range r.replyFeeds {
		if feed.UserID == userID {
			results = append(results, feed)
		}
	}
	// Sort by timestamp descending
	if len(results) > int(offset) {
		results = results[offset:]
	}
	if len(results) > int(limit) {
		results = results[:limit]
	}
	return results, nil
}

func (r *MemoryHBaseRepository) SaveChatMetadata(ctx context.Context, chat *ChatMetadataRow) error {
	if chat.RowKey == "" {
		chat.RowKey = fmt.Sprintf("chat_%s", chat.ChatKey)
	}
	r.chatMetadata[chat.RowKey] = chat
	return nil
}

func (r *MemoryHBaseRepository) GetChatMetadata(ctx context.Context, chatKey string) (*ChatMetadataRow, error) {
	key := fmt.Sprintf("chat_%s", chatKey)
	chat, ok := r.chatMetadata[key]
	if !ok {
		return nil, fmt.Errorf("chat not found: %s", chatKey)
	}
	return chat, nil
}

func (r *MemoryHBaseRepository) SaveChatInbox(ctx context.Context, inbox *ChatInboxRow) error {
	if inbox.RowKey == "" {
		inbox.RowKey = buildChatInboxRowKey(inbox.UserID, inbox.ChatKey, inbox.Timestamp, inbox.MsgID)
	}
	r.chatInbox[inbox.RowKey] = inbox
	return nil
}

func (r *MemoryHBaseRepository) GetUserChatInbox(ctx context.Context, userID, chatKey string, limit, offset int64) ([]*ChatInboxRow, error) {
	var results []*ChatInboxRow
	for _, inbox := range r.chatInbox {
		if inbox.UserID == userID && inbox.ChatKey == chatKey {
			results = append(results, inbox)
		}
	}
	// Sort by timestamp descending
	if len(results) > int(offset) {
		results = results[offset:]
	}
	if len(results) > int(limit) {
		results = results[:limit]
	}
	return results, nil
}
