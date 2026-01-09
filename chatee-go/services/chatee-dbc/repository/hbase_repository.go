package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"
)

// =============================================================================
// HBase Repository Interfaces
// =============================================================================

// HBaseRepository provides HBase storage operations
type HBaseRepository interface {
	// Thread metadata operations
	SaveThreadMetadata(ctx context.Context, thread *ThreadMetadata) error
	GetThreadMetadata(ctx context.Context, threadID string) (*ThreadMetadata, error)

	// Thread message operations
	SaveThreadMessage(ctx context.Context, msg *ThreadMessageRow) error
	GetThreadMessages(ctx context.Context, threadID string, limit, offset int64) ([]*ThreadMessageRow, error)
	GetThreadMessage(ctx context.Context, threadID, msgID string) (*ThreadMessageRow, error)

	// User follow feed operations (写扩散到粉丝收件箱)
	SaveFollowFeed(ctx context.Context, feed *FollowFeedRow) error
	GetUserFollowFeeds(ctx context.Context, userID string, limit, offset int64) ([]*FollowFeedRow, error)

	// User reply feed operations (写扩散到回复收件箱)
	SaveReplyFeed(ctx context.Context, feed *ReplyFeedRow) error
	GetUserReplyFeeds(ctx context.Context, userID string, limit, offset int64) ([]*ReplyFeedRow, error)

	// Chat metadata operations
	SaveChatMetadata(ctx context.Context, chat *ChatMetadataRow) error
	GetChatMetadata(ctx context.Context, chatKey string) (*ChatMetadataRow, error)

	// Chat user inbox operations (写扩散到参与者收件箱)
	SaveChatInbox(ctx context.Context, inbox *ChatInboxRow) error
	GetUserChatInbox(ctx context.Context, userID, chatKey string, limit, offset int64) ([]*ChatInboxRow, error)
}

// =============================================================================
// HBase Row Structures (按照文档设计)
// =============================================================================

// ThreadMetadata represents threads_metadata table row
type ThreadMetadata struct {
	ThreadID    string    `json:"thread_id"`
	OwnerID     string    `json:"owner_id"`
	RootMsgID   string    `json:"root_msg_id"`
	Title       string    `json:"title,omitempty"`
	AIAgents    []string  `json:"ai_agents,omitempty"`
	Settings    string    `json:"settings,omitempty"` // JSON string
	CreatedAt   int64     `json:"created_at"`
	Status      string    `json:"status"` // "active" | "closed" | "archived"
	ReplyCount  int64     `json:"reply_count"`
	Participants []string  `json:"participants,omitempty"`
	LastMsgID   string    `json:"last_msg_id,omitempty"`
	LastActiveAt int64    `json:"last_active_at,omitempty"`
	HotScore    float64   `json:"hot_score,omitempty"`
}

// ThreadMessageRow represents thread_messages table row
// RowKey: {thread_id}_{reverse_timestamp}_{msg_id}
type ThreadMessageRow struct {
	RowKey       string    `json:"row_key"` // {thread_id}_{reverse_timestamp}_{msg_id}
	ThreadID     string    `json:"thread_id"`
	MsgID        string    `json:"msg_id"`
	AuthorID     string    `json:"author_id"`
	AuthorType   string    `json:"author_type"` // "user" | "ai"
	ContentType  string    `json:"content_type"`
	RawContent   []byte    `json:"raw_content"`
	Compressed   bool      `json:"compressed"`
	ParentMsgID  string    `json:"parent_msg_id,omitempty"`
	Mentions     []string  `json:"mentions,omitempty"`
	Depth        int32     `json:"depth"`
	Metadata     string    `json:"metadata,omitempty"` // JSON string
	Timestamp    int64     `json:"timestamp"`
	Deleted      bool      `json:"deleted"`
}

// FollowFeedRow represents user_follow_feeds table row
// RowKey: {user_id}_{reverse_timestamp}_{thread_id}_{msg_id}
type FollowFeedRow struct {
	RowKey        string    `json:"row_key"`
	UserID        string    `json:"user_id"`
	ThreadID      string    `json:"thread_id"`
	MsgID         string    `json:"msg_id"`
	MsgType       string    `json:"msg_type"` // "root" | "reply"
	AuthorID      string    `json:"author_id"`
	AuthorType    string    `json:"author_type"`
	ContentPreview string   `json:"content_preview"`
	Flags         string    `json:"flags"` // JSON string
	Timestamp     int64     `json:"timestamp"`
	Read          bool      `json:"read"`
}

// ReplyFeedRow represents user_rev_reply_feeds table row
// RowKey: {user_id}_{reverse_timestamp}_{thread_id}_{reply_msg_id}
type ReplyFeedRow struct {
	RowKey        string    `json:"row_key"`
	UserID        string    `json:"user_id"`
	ThreadID      string    `json:"thread_id"`
	ReplyMsgID    string    `json:"reply_msg_id"`
	ReplyAuthor   string    `json:"reply_author"`
	ParentMsgID   string    `json:"parent_msg_id"`
	PushType      string    `json:"push_type"` // "full" | "limited" | "mention"
	ContentType   string    `json:"content_type"` // "full_content" | "preview_only"
	ContentPreview string   `json:"content_preview,omitempty"`
	FullContent   []byte    `json:"full_content,omitempty"`
	Reason        string    `json:"reason"` // "owner" | "mentioned" | "ai_mentioned"
	Timestamp     int64     `json:"timestamp"`
	RequireFollow bool      `json:"require_follow"`
	ThreadOwner   string    `json:"thread_owner"`
}

// ChatMetadataRow represents chats_metadata table row
// RowKey: chat_{chat_key}
type ChatMetadataRow struct struct {
	RowKey      string    `json:"row_key"`
	ChatKey     string    `json:"chat_key"`
	ChatType    string    `json:"chat_type"` // "private" | "group"
	Participants []string `json:"participants"`
	AIAgents    []string  `json:"ai_agents,omitempty"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   int64     `json:"created_at"`
	Settings    string    `json:"settings,omitempty"` // JSON string
	Status      string    `json:"status"` // "active" | "muted" | "archived"
	MsgCount    int64     `json:"msg_count"`
	LastMsgID   string    `json:"last_msg_id,omitempty"`
	LastActiveAt int64    `json:"last_active_at,omitempty"`
	UnreadCounts string   `json:"unread_counts,omitempty"` // JSON string
}

// ChatInboxRow represents chat_user_inbox table row
// RowKey: {user_id}_{chat_key}_{reverse_timestamp}_{msg_id}
type ChatInboxRow struct {
	RowKey      string    `json:"row_key"`
	UserID      string    `json:"user_id"`
	ChatKey     string    `json:"chat_key"`
	MsgID       string    `json:"msg_id"`
	SenderID    string    `json:"sender_id"`
	SenderType  string    `json:"sender_type"` // "user" | "ai"
	ContentType string    `json:"content_type"`
	RawContent  []byte    `json:"raw_content"`
	Mentions    []string  `json:"mentions,omitempty"`
	Flags       string    `json:"flags"` // JSON string
	Timestamp   int64     `json:"timestamp"`
}

// =============================================================================
// Helper Functions
// =============================================================================

// reverseTimestamp returns MAX_INT64 - timestamp for reverse chronological ordering
func reverseTimestamp(timestamp int64) int64 {
	return math.MaxInt64 - timestamp
}

// buildThreadMessageRowKey builds row key for thread_messages
// Format: {thread_id}_{reverse_timestamp}_{msg_id}
func buildThreadMessageRowKey(threadID string, timestamp int64, msgID string) string {
	return fmt.Sprintf("%s_%d_%s", threadID, reverseTimestamp(timestamp), msgID)
}

// buildFollowFeedRowKey builds row key for user_follow_feeds
// Format: {user_id}_{reverse_timestamp}_{thread_id}_{msg_id}
func buildFollowFeedRowKey(userID string, timestamp int64, threadID, msgID string) string {
	return fmt.Sprintf("%s_%d_%s_%s", userID, reverseTimestamp(timestamp), threadID, msgID)
}

// buildReplyFeedRowKey builds row key for user_rev_reply_feeds
// Format: {user_id}_{reverse_timestamp}_{thread_id}_{reply_msg_id}
func buildReplyFeedRowKey(userID string, timestamp int64, threadID, replyMsgID string) string {
	return fmt.Sprintf("%s_%d_%s_%s", userID, reverseTimestamp(timestamp), threadID, replyMsgID)
}

// buildChatInboxRowKey builds row key for chat_user_inbox
// Format: {user_id}_{chat_key}_{reverse_timestamp}_{msg_id}
func buildChatInboxRowKey(userID, chatKey string, timestamp int64, msgID string) string {
	return fmt.Sprintf("%s_%s_%d_%s", userID, chatKey, reverseTimestamp(timestamp), msgID)
}

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
