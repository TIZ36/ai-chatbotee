package repository

import (
	"context"
	"fmt"
	"math"
)

// =============================================================================
// HBase Repository Interface
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
	ThreadID     string   `json:"thread_id"`
	OwnerID      string   `json:"owner_id"`
	RootMsgID    string   `json:"root_msg_id"`
	Title        string   `json:"title,omitempty"`
	AIAgents     []string `json:"ai_agents,omitempty"`
	Settings     string   `json:"settings,omitempty"` // JSON string
	CreatedAt    int64    `json:"created_at"`
	Status       string   `json:"status"` // "active" | "closed" | "archived"
	ReplyCount   int64    `json:"reply_count"`
	Participants []string `json:"participants,omitempty"`
	LastMsgID    string   `json:"last_msg_id,omitempty"`
	LastActiveAt int64    `json:"last_active_at,omitempty"`
	HotScore     float64  `json:"hot_score,omitempty"`
}

// ThreadMessageRow represents thread_messages table row
// RowKey: {thread_id}_{reverse_timestamp}_{msg_id}
type ThreadMessageRow struct {
	RowKey      string   `json:"row_key"` // {thread_id}_{reverse_timestamp}_{msg_id}
	ThreadID    string   `json:"thread_id"`
	MsgID       string   `json:"msg_id"`
	AuthorID    string   `json:"author_id"`
	AuthorType  string   `json:"author_type"` // "user" | "ai"
	ContentType string   `json:"content_type"`
	RawContent  []byte   `json:"raw_content"`
	Compressed  bool     `json:"compressed"`
	ParentMsgID string   `json:"parent_msg_id,omitempty"`
	Mentions    []string `json:"mentions,omitempty"`
	Depth       int32    `json:"depth"`
	Metadata    string   `json:"metadata,omitempty"` // JSON string
	Timestamp   int64    `json:"timestamp"`
	Deleted     bool     `json:"deleted"`
}

// FollowFeedRow represents user_follow_feeds table row
// RowKey: {user_id}_{reverse_timestamp}_{thread_id}_{msg_id}
type FollowFeedRow struct {
	RowKey         string `json:"row_key"`
	UserID         string `json:"user_id"`
	ThreadID       string `json:"thread_id"`
	MsgID          string `json:"msg_id"`
	MsgType        string `json:"msg_type"` // "root" | "reply"
	AuthorID       string `json:"author_id"`
	AuthorType     string `json:"author_type"`
	ContentPreview string `json:"content_preview"`
	Flags          string `json:"flags"` // JSON string
	Timestamp      int64  `json:"timestamp"`
	Read           bool   `json:"read"`
}

// ReplyFeedRow represents user_rev_reply_feeds table row
// RowKey: {user_id}_{reverse_timestamp}_{thread_id}_{reply_msg_id}
type ReplyFeedRow struct {
	RowKey         string `json:"row_key"`
	UserID         string `json:"user_id"`
	ThreadID       string `json:"thread_id"`
	ReplyMsgID     string `json:"reply_msg_id"`
	ReplyAuthor    string `json:"reply_author"`
	ParentMsgID    string `json:"parent_msg_id"`
	PushType       string `json:"push_type"`    // "full" | "limited" | "mention"
	ContentType    string `json:"content_type"` // "full_content" | "preview_only"
	ContentPreview string `json:"content_preview,omitempty"`
	FullContent    []byte `json:"full_content,omitempty"`
	Reason         string `json:"reason"` // "owner" | "mentioned" | "ai_mentioned"
	Timestamp      int64  `json:"timestamp"`
	RequireFollow  bool   `json:"require_follow"`
	ThreadOwner    string `json:"thread_owner"`
}

// ChatMetadataRow represents chats_metadata table row
// RowKey: chat_{chat_key}
type ChatMetadataRow struct {
	RowKey       string   `json:"row_key"`
	ChatKey      string   `json:"chat_key"`
	ChatType     string   `json:"chat_type"` // "private" | "group"
	Participants []string `json:"participants"`
	AIAgents     []string `json:"ai_agents,omitempty"`
	CreatedBy    string   `json:"created_by"`
	CreatedAt    int64    `json:"created_at"`
	Settings     string   `json:"settings,omitempty"` // JSON string
	Status       string   `json:"status"`             // "active" | "muted" | "archived"
	MsgCount     int64    `json:"msg_count"`
	LastMsgID    string   `json:"last_msg_id,omitempty"`
	LastActiveAt int64    `json:"last_active_at,omitempty"`
	UnreadCounts string   `json:"unread_counts,omitempty"` // JSON string
}

// ChatInboxRow represents chat_user_inbox table row
// RowKey: {user_id}_{chat_key}_{reverse_timestamp}_{msg_id}
type ChatInboxRow struct {
	RowKey      string   `json:"row_key"`
	UserID      string   `json:"user_id"`
	ChatKey     string   `json:"chat_key"`
	MsgID       string   `json:"msg_id"`
	SenderID    string   `json:"sender_id"`
	SenderType  string   `json:"sender_type"` // "user" | "ai"
	ContentType string   `json:"content_type"`
	RawContent  []byte   `json:"raw_content"`
	Mentions    []string `json:"mentions,omitempty"`
	Flags       string   `json:"flags"` // JSON string
	Timestamp   int64    `json:"timestamp"`
}

// =============================================================================
// Helper Functions
// =============================================================================

// ReverseTimestamp returns MAX_INT64 - timestamp for reverse chronological ordering
// This is exported so it can be used by implementations
func ReverseTimestamp(timestamp int64) int64 {
	return math.MaxInt64 - timestamp
}

// buildThreadMessageRowKey builds row key for thread_messages
// Format: {thread_id}_{reverse_timestamp}_{msg_id}
func buildThreadMessageRowKey(threadID string, timestamp int64, msgID string) string {
	return fmt.Sprintf("%s_%d_%s", threadID, ReverseTimestamp(timestamp), msgID)
}

// buildFollowFeedRowKey builds row key for user_follow_feeds
// Format: {user_id}_{reverse_timestamp}_{thread_id}_{msg_id}
func buildFollowFeedRowKey(userID string, timestamp int64, threadID, msgID string) string {
	return fmt.Sprintf("%s_%d_%s_%s", userID, ReverseTimestamp(timestamp), threadID, msgID)
}

// buildReplyFeedRowKey builds row key for user_rev_reply_feeds
// Format: {user_id}_{reverse_timestamp}_{thread_id}_{reply_msg_id}
func buildReplyFeedRowKey(userID string, timestamp int64, threadID, replyMsgID string) string {
	return fmt.Sprintf("%s_%d_%s_%s", userID, ReverseTimestamp(timestamp), threadID, replyMsgID)
}

// buildChatInboxRowKey builds row key for chat_user_inbox
// Format: {user_id}_{chat_key}_{reverse_timestamp}_{msg_id}
func buildChatInboxRowKey(userID, chatKey string, timestamp int64, msgID string) string {
	return fmt.Sprintf("%s_%s_%d_%s", userID, chatKey, ReverseTimestamp(timestamp), msgID)
}
