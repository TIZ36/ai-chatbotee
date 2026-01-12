package repository

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"chatee-go/commonlib/log"

	"github.com/tiz36/ghbase"
)

// =============================================================================
// Real HBase Repository Implementation using ghbase
// =============================================================================

// GHBaseRepository implements HBaseRepository using ghbase library
type GHBaseRepository struct {
	pool      *ghbase.HbaseClientPool
	logger    log.Logger
	prefix    string
	namespace string // HBase namespace
}

// NewGHBaseRepository creates a new HBase repository using ghbase
func NewGHBaseRepository(pool *ghbase.HbaseClientPool, prefix string, logger log.Logger) HBaseRepository {
	return &GHBaseRepository{
		pool:      pool,
		logger:    logger,
		prefix:    prefix,
		namespace: "default", // Default namespace
	}
}

// =============================================================================
// Table Names
// =============================================================================

func (r *GHBaseRepository) tableName(base string) string {
	if r.prefix != "" {
		return r.prefix + base
	}
	return base
}

// =============================================================================
// Thread Metadata Operations
// =============================================================================

func (r *GHBaseRepository) SaveThreadMetadata(ctx context.Context, thread *ThreadMetadata) error {
	tableName := r.tableName("threads_metadata")
	rowKey := fmt.Sprintf("thread_%s", thread.ThreadID)

	// Convert to HBase cells (map[string]map[string]string)
	cells := make(map[string]map[string]string)

	// meta column family
	cells["meta"] = map[string]string{
		"owner_id":    thread.OwnerID,
		"root_msg_id": thread.RootMsgID,
		"title":       thread.Title,
		"ai_agents":   strings.Join(thread.AIAgents, ","),
		"settings":    thread.Settings,
		"created_at":  strconv.FormatInt(thread.CreatedAt, 10),
		"status":      thread.Status,
	}

	// stats column family
	cells["stats"] = map[string]string{
		"reply_count":    strconv.FormatInt(thread.ReplyCount, 10),
		"participants":   strings.Join(thread.Participants, ","),
		"last_msg_id":    thread.LastMsgID,
		"last_active_at": strconv.FormatInt(thread.LastActiveAt, 10),
		"hot_score":      strconv.FormatFloat(thread.HotScore, 'f', -1, 64),
	}

	// Put data using PutCf
	if err := r.pool.PutCf(ctx, r.namespace, tableName, rowKey, cells); err != nil {
		r.logger.Error("Failed to save thread metadata", log.Err(err), log.String("thread_id", thread.ThreadID))
		return fmt.Errorf("failed to save thread metadata: %w", err)
	}

	return nil
}

func (r *GHBaseRepository) GetThreadMetadata(ctx context.Context, threadID string) (*ThreadMetadata, error) {
	tableName := r.tableName("threads_metadata")
	rowKey := fmt.Sprintf("thread_%s", threadID)

	// Get data using GetRow
	result, err := r.pool.GetRow(ctx, r.namespace, tableName, rowKey)
	if err != nil {
		return nil, fmt.Errorf("failed to get thread metadata: %w", err)
	}

	if result == nil || len(result) == 0 {
		return nil, fmt.Errorf("thread not found: %s", threadID)
	}

	// Parse result
	thread := &ThreadMetadata{
		ThreadID: threadID,
	}

	// Parse meta column family
	if meta, ok := result["meta"]; ok {
		if ownerID, ok := meta["owner_id"]; ok {
			thread.OwnerID = ownerID
		}
		if rootMsgID, ok := meta["root_msg_id"]; ok {
			thread.RootMsgID = rootMsgID
		}
		if title, ok := meta["title"]; ok {
			thread.Title = title
		}
		if aiAgents, ok := meta["ai_agents"]; ok {
			if aiAgents != "" {
				thread.AIAgents = strings.Split(aiAgents, ",")
			}
		}
		if settings, ok := meta["settings"]; ok {
			thread.Settings = settings
		}
		if createdAt, ok := meta["created_at"]; ok {
			if ts, err := strconv.ParseInt(createdAt, 10, 64); err == nil {
				thread.CreatedAt = ts
			}
		}
		if status, ok := meta["status"]; ok {
			thread.Status = status
		}
	}

	// Parse stats column family
	if stats, ok := result["stats"]; ok {
		if replyCount, ok := stats["reply_count"]; ok {
			if count, err := strconv.ParseInt(replyCount, 10, 64); err == nil {
				thread.ReplyCount = count
			}
		}
		if participants, ok := stats["participants"]; ok {
			if participants != "" {
				thread.Participants = strings.Split(participants, ",")
			}
		}
		if lastMsgID, ok := stats["last_msg_id"]; ok {
			thread.LastMsgID = lastMsgID
		}
		if lastActiveAt, ok := stats["last_active_at"]; ok {
			if ts, err := strconv.ParseInt(lastActiveAt, 10, 64); err == nil {
				thread.LastActiveAt = ts
			}
		}
		if hotScore, ok := stats["hot_score"]; ok {
			if score, err := strconv.ParseFloat(hotScore, 64); err == nil {
				thread.HotScore = score
			}
		}
	}

	return thread, nil
}

// =============================================================================
// Thread Message Operations
// =============================================================================

func (r *GHBaseRepository) SaveThreadMessage(ctx context.Context, msg *ThreadMessageRow) error {
	tableName := r.tableName("thread_messages")
	if msg.RowKey == "" {
		msg.RowKey = buildThreadMessageRowKey(msg.ThreadID, msg.Timestamp, msg.MsgID)
	}

	// Convert to HBase cells (map[string]map[string]string)
	cells := make(map[string]map[string]string)
	cells["msg"] = map[string]string{
		"msg_id":        msg.MsgID,
		"author_id":     msg.AuthorID,
		"author_type":   msg.AuthorType,
		"content_type":  msg.ContentType,
		"raw_content":   string(msg.RawContent), // Convert []byte to string
		"compressed":    strconv.FormatBool(msg.Compressed),
		"parent_msg_id": msg.ParentMsgID,
		"mentions":      strings.Join(msg.Mentions, ","),
		"depth":         strconv.FormatInt(int64(msg.Depth), 10),
		"metadata":      msg.Metadata,
		"timestamp":     strconv.FormatInt(msg.Timestamp, 10),
		"deleted":       strconv.FormatBool(msg.Deleted),
	}

	// Put data using PutCf
	if err := r.pool.PutCf(ctx, r.namespace, tableName, msg.RowKey, cells); err != nil {
		r.logger.Error("Failed to save thread message", log.Err(err), log.String("msg_id", msg.MsgID))
		return fmt.Errorf("failed to save thread message: %w", err)
	}

	return nil
}

func (r *GHBaseRepository) GetThreadMessages(ctx context.Context, threadID string, limit, offset int64) ([]*ThreadMessageRow, error) {
	tableName := r.tableName("thread_messages")

	// Scan with prefix filter
	startRow := fmt.Sprintf("%s_", threadID)
	stopRow := fmt.Sprintf("%s_%c", threadID, 0xFF) // Prefix with max char

	// Scan returns []map[string]map[string]string
	results, err := r.pool.Scan(ctx, r.namespace, tableName, startRow, stopRow, int32(limit+offset))
	if err != nil {
		return nil, fmt.Errorf("failed to scan thread messages: %w", err)
	}

	var messages []*ThreadMessageRow
	count := int64(0)
	for _, row := range results {
		if count < offset {
			count++
			continue
		}
		if int64(len(messages)) >= limit {
			break
		}

		// Reconstruct rowKey from data (threadID_reverseTimestamp_msgID)
		var rowKey string
		if msgCells, ok := row["msg"]; ok {
			if msgID, ok := msgCells["msg_id"]; ok {
				if timestamp, ok := msgCells["timestamp"]; ok {
					ts, _ := strconv.ParseInt(timestamp, 10, 64)
					rowKey = buildThreadMessageRowKey(threadID, ts, msgID)
				}
			}
		}
		if rowKey == "" {
			rowKey = fmt.Sprintf("%s_%d", threadID, count) // Fallback
		}

		msg := r.parseThreadMessage(rowKey, row)
		if msg != nil && !msg.Deleted {
			messages = append(messages, msg)
		}
		count++
	}

	return messages, nil
}

func (r *GHBaseRepository) GetThreadMessage(ctx context.Context, threadID, msgID string) (*ThreadMessageRow, error) {
	// Scan to find the message
	messages, err := r.GetThreadMessages(ctx, threadID, 1000, 0)
	if err != nil {
		return nil, err
	}

	for _, msg := range messages {
		if msg.MsgID == msgID {
			return msg, nil
		}
	}

	return nil, fmt.Errorf("message not found: %s/%s", threadID, msgID)
}

// =============================================================================
// Follow Feed Operations
// =============================================================================

func (r *GHBaseRepository) SaveFollowFeed(ctx context.Context, feed *FollowFeedRow) error {
	tableName := r.tableName("user_follow_feeds")
	if feed.RowKey == "" {
		feed.RowKey = buildFollowFeedRowKey(feed.UserID, feed.Timestamp, feed.ThreadID, feed.MsgID)
	}

	// Convert to HBase cells (map[string]map[string]string)
	cells := make(map[string]map[string]string)
	cells["feed"] = map[string]string{
		"thread_id":       feed.ThreadID,
		"msg_id":          feed.MsgID,
		"msg_type":        feed.MsgType,
		"author_id":       feed.AuthorID,
		"author_type":     feed.AuthorType,
		"content_preview": feed.ContentPreview,
		"flags":           feed.Flags,
		"timestamp":       strconv.FormatInt(feed.Timestamp, 10),
		"read":            strconv.FormatBool(feed.Read),
	}

	// Put data using PutCf
	if err := r.pool.PutCf(ctx, r.namespace, tableName, feed.RowKey, cells); err != nil {
		r.logger.Error("Failed to save follow feed", log.Err(err))
		return fmt.Errorf("failed to save follow feed: %w", err)
	}

	return nil
}

func (r *GHBaseRepository) GetUserFollowFeeds(ctx context.Context, userID string, limit, offset int64) ([]*FollowFeedRow, error) {
	tableName := r.tableName("user_follow_feeds")
	startRow := fmt.Sprintf("%s_", userID)
	stopRow := fmt.Sprintf("%s_%c", userID, 0xFF)

	// Scan returns []map[string]map[string]string
	results, err := r.pool.Scan(ctx, r.namespace, tableName, startRow, stopRow, int32(limit+offset))
	if err != nil {
		return nil, fmt.Errorf("failed to scan follow feeds: %w", err)
	}

	var feeds []*FollowFeedRow
	count := int64(0)
	for _, row := range results {
		if count < offset {
			count++
			continue
		}
		if int64(len(feeds)) >= limit {
			break
		}

		// Reconstruct rowKey from data (userID_timestamp_threadID_msgID)
		// We can extract from feed data or use a placeholder
		var rowKey string
		if feedCells, ok := row["feed"]; ok {
			if threadID, ok := feedCells["thread_id"]; ok {
				if msgID, ok := feedCells["msg_id"]; ok {
					if timestamp, ok := feedCells["timestamp"]; ok {
						ts, _ := strconv.ParseInt(timestamp, 10, 64)
						rowKey = buildFollowFeedRowKey(userID, ts, threadID, msgID)
					}
				}
			}
		}
		if rowKey == "" {
			rowKey = fmt.Sprintf("%s_%d", userID, count) // Fallback
		}

		feed := r.parseFollowFeed(rowKey, row)
		if feed != nil {
			feeds = append(feeds, feed)
		}
		count++
	}

	return feeds, nil
}

// =============================================================================
// Reply Feed Operations
// =============================================================================

func (r *GHBaseRepository) SaveReplyFeed(ctx context.Context, feed *ReplyFeedRow) error {
	tableName := r.tableName("user_rev_reply_feeds")
	if feed.RowKey == "" {
		feed.RowKey = buildReplyFeedRowKey(feed.UserID, feed.Timestamp, feed.ThreadID, feed.ReplyMsgID)
	}

	// Convert to HBase cells (map[string]map[string]string)
	cells := make(map[string]map[string]string)
	cells["reply"] = map[string]string{
		"thread_id":       feed.ThreadID,
		"reply_msg_id":    feed.ReplyMsgID,
		"reply_author":    feed.ReplyAuthor,
		"parent_msg_id":   feed.ParentMsgID,
		"push_type":       feed.PushType,
		"content_type":    feed.ContentType,
		"content_preview": feed.ContentPreview,
		"full_content":    string(feed.FullContent), // Convert []byte to string
		"reason":          feed.Reason,
		"timestamp":       strconv.FormatInt(feed.Timestamp, 10),
		"require_follow":  strconv.FormatBool(feed.RequireFollow),
		"thread_owner":    feed.ThreadOwner,
	}

	// Put data using PutCf
	if err := r.pool.PutCf(ctx, r.namespace, tableName, feed.RowKey, cells); err != nil {
		r.logger.Error("Failed to save reply feed", log.Err(err))
		return fmt.Errorf("failed to save reply feed: %w", err)
	}

	return nil
}

func (r *GHBaseRepository) GetUserReplyFeeds(ctx context.Context, userID string, limit, offset int64) ([]*ReplyFeedRow, error) {
	tableName := r.tableName("user_rev_reply_feeds")
	startRow := fmt.Sprintf("%s_", userID)
	stopRow := fmt.Sprintf("%s_%c", userID, 0xFF)

	// Scan returns []map[string]map[string]string
	results, err := r.pool.Scan(ctx, r.namespace, tableName, startRow, stopRow, int32(limit+offset))
	if err != nil {
		return nil, fmt.Errorf("failed to scan reply feeds: %w", err)
	}

	var feeds []*ReplyFeedRow
	count := int64(0)
	for _, row := range results {
		if count < offset {
			count++
			continue
		}
		if int64(len(feeds)) >= limit {
			break
		}

		// Reconstruct rowKey from data
		var rowKey string
		if replyCells, ok := row["reply"]; ok {
			if threadID, ok := replyCells["thread_id"]; ok {
				if replyMsgID, ok := replyCells["reply_msg_id"]; ok {
					if timestamp, ok := replyCells["timestamp"]; ok {
						ts, _ := strconv.ParseInt(timestamp, 10, 64)
						rowKey = buildReplyFeedRowKey(userID, ts, threadID, replyMsgID)
					}
				}
			}
		}
		if rowKey == "" {
			rowKey = fmt.Sprintf("%s_%d", userID, count) // Fallback
		}

		feed := r.parseReplyFeed(rowKey, row)
		if feed != nil {
			feeds = append(feeds, feed)
		}
		count++
	}

	return feeds, nil
}

// =============================================================================
// Chat Metadata Operations
// =============================================================================

func (r *GHBaseRepository) SaveChatMetadata(ctx context.Context, chat *ChatMetadataRow) error {
	tableName := r.tableName("chats_metadata")
	if chat.RowKey == "" {
		chat.RowKey = fmt.Sprintf("chat_%s", chat.ChatKey)
	}

	// Convert to HBase cells (map[string]map[string]string)
	cells := make(map[string]map[string]string)
	cells["meta"] = map[string]string{
		"chat_type":    chat.ChatType,
		"participants": strings.Join(chat.Participants, ","),
		"ai_agents":    strings.Join(chat.AIAgents, ","),
		"created_by":   chat.CreatedBy,
		"created_at":   strconv.FormatInt(chat.CreatedAt, 10),
		"settings":     chat.Settings,
		"status":       chat.Status,
	}

	cells["stats"] = map[string]string{
		"msg_count":      strconv.FormatInt(chat.MsgCount, 10),
		"last_msg_id":    chat.LastMsgID,
		"last_active_at": strconv.FormatInt(chat.LastActiveAt, 10),
		"unread_counts":  chat.UnreadCounts,
	}

	// Put data using PutCf
	if err := r.pool.PutCf(ctx, r.namespace, tableName, chat.RowKey, cells); err != nil {
		r.logger.Error("Failed to save chat metadata", log.Err(err))
		return fmt.Errorf("failed to save chat metadata: %w", err)
	}

	return nil
}

func (r *GHBaseRepository) GetChatMetadata(ctx context.Context, chatKey string) (*ChatMetadataRow, error) {
	tableName := r.tableName("chats_metadata")
	rowKey := fmt.Sprintf("chat_%s", chatKey)

	// Get data using GetRow
	result, err := r.pool.GetRow(ctx, r.namespace, tableName, rowKey)
	if err != nil {
		return nil, fmt.Errorf("failed to get chat metadata: %w", err)
	}

	if result == nil || len(result) == 0 {
		return nil, fmt.Errorf("chat not found: %s", chatKey)
	}

	return r.parseChatMetadata(chatKey, result), nil
}

// =============================================================================
// Chat Inbox Operations
// =============================================================================

func (r *GHBaseRepository) SaveChatInbox(ctx context.Context, inbox *ChatInboxRow) error {
	tableName := r.tableName("chat_user_inbox")
	if inbox.RowKey == "" {
		inbox.RowKey = buildChatInboxRowKey(inbox.UserID, inbox.ChatKey, inbox.Timestamp, inbox.MsgID)
	}

	// Convert to HBase cells (map[string]map[string]string)
	cells := make(map[string]map[string]string)
	cells["msg"] = map[string]string{
		"chat_key":     inbox.ChatKey,
		"msg_id":       inbox.MsgID,
		"sender_id":    inbox.SenderID,
		"sender_type":  inbox.SenderType,
		"content_type": inbox.ContentType,
		"raw_content":  string(inbox.RawContent), // Convert []byte to string
		"mentions":     strings.Join(inbox.Mentions, ","),
		"flags":        inbox.Flags,
		"timestamp":    strconv.FormatInt(inbox.Timestamp, 10),
	}

	// Put data using PutCf
	if err := r.pool.PutCf(ctx, r.namespace, tableName, inbox.RowKey, cells); err != nil {
		r.logger.Error("Failed to save chat inbox", log.Err(err))
		return fmt.Errorf("failed to save chat inbox: %w", err)
	}

	return nil
}

func (r *GHBaseRepository) GetUserChatInbox(ctx context.Context, userID, chatKey string, limit, offset int64) ([]*ChatInboxRow, error) {
	tableName := r.tableName("chat_user_inbox")
	startRow := fmt.Sprintf("%s_%s_", userID, chatKey)
	stopRow := fmt.Sprintf("%s_%s_%c", userID, chatKey, 0xFF)

	// Scan returns []map[string]map[string]string
	results, err := r.pool.Scan(ctx, r.namespace, tableName, startRow, stopRow, int32(limit+offset))
	if err != nil {
		return nil, fmt.Errorf("failed to scan chat inbox: %w", err)
	}

	var inboxes []*ChatInboxRow
	count := int64(0)
	for _, row := range results {
		if count < offset {
			count++
			continue
		}
		if int64(len(inboxes)) >= limit {
			break
		}

		// Reconstruct rowKey from data
		var rowKey string
		if msgCells, ok := row["msg"]; ok {
			if msgID, ok := msgCells["msg_id"]; ok {
				if timestamp, ok := msgCells["timestamp"]; ok {
					ts, _ := strconv.ParseInt(timestamp, 10, 64)
					rowKey = buildChatInboxRowKey(userID, chatKey, ts, msgID)
				}
			}
		}
		if rowKey == "" {
			rowKey = fmt.Sprintf("%s_%s_%d", userID, chatKey, count) // Fallback
		}

		inbox := r.parseChatInbox(rowKey, row)
		if inbox != nil {
			inboxes = append(inboxes, inbox)
		}
		count++
	}

	return inboxes, nil
}

// =============================================================================
// Helper Functions - Parsing
// =============================================================================

func (r *GHBaseRepository) parseThreadMessage(rowKey string, cells map[string]map[string]string) *ThreadMessageRow {
	msg := &ThreadMessageRow{RowKey: rowKey}

	if msgCells, ok := cells["msg"]; ok {
		if msgID, ok := msgCells["msg_id"]; ok {
			msg.MsgID = msgID
		}
		if authorID, ok := msgCells["author_id"]; ok {
			msg.AuthorID = authorID
		}
		if authorType, ok := msgCells["author_type"]; ok {
			msg.AuthorType = authorType
		}
		if contentType, ok := msgCells["content_type"]; ok {
			msg.ContentType = contentType
		}
		if rawContent, ok := msgCells["raw_content"]; ok {
			msg.RawContent = []byte(rawContent) // Convert string to []byte
		}
		if compressed, ok := msgCells["compressed"]; ok {
			msg.Compressed = compressed == "true"
		}
		if parentMsgID, ok := msgCells["parent_msg_id"]; ok {
			msg.ParentMsgID = parentMsgID
		}
		if mentions, ok := msgCells["mentions"]; ok {
			if mentions != "" {
				msg.Mentions = strings.Split(mentions, ",")
			}
		}
		if depth, ok := msgCells["depth"]; ok {
			if d, err := strconv.ParseInt(depth, 10, 32); err == nil {
				msg.Depth = int32(d)
			}
		}
		if metadata, ok := msgCells["metadata"]; ok {
			msg.Metadata = metadata
		}
		if timestamp, ok := msgCells["timestamp"]; ok {
			if ts, err := strconv.ParseInt(timestamp, 10, 64); err == nil {
				msg.Timestamp = ts
			}
		}
		if deleted, ok := msgCells["deleted"]; ok {
			msg.Deleted = deleted == "true"
		}

		// Extract thread_id from rowKey
		parts := strings.Split(rowKey, "_")
		if len(parts) > 0 {
			msg.ThreadID = parts[0]
		}
	}

	return msg
}

func (r *GHBaseRepository) parseFollowFeed(rowKey string, cells map[string]map[string]string) *FollowFeedRow {
	feed := &FollowFeedRow{RowKey: rowKey}

	if feedCells, ok := cells["feed"]; ok {
		// Extract user_id from rowKey
		parts := strings.Split(rowKey, "_")
		if len(parts) > 0 {
			feed.UserID = parts[0]
		}

		if threadID, ok := feedCells["thread_id"]; ok {
			feed.ThreadID = threadID
		}
		if msgID, ok := feedCells["msg_id"]; ok {
			feed.MsgID = msgID
		}
		if msgType, ok := feedCells["msg_type"]; ok {
			feed.MsgType = msgType
		}
		if authorID, ok := feedCells["author_id"]; ok {
			feed.AuthorID = authorID
		}
		if authorType, ok := feedCells["author_type"]; ok {
			feed.AuthorType = authorType
		}
		if contentPreview, ok := feedCells["content_preview"]; ok {
			feed.ContentPreview = contentPreview
		}
		if flags, ok := feedCells["flags"]; ok {
			feed.Flags = flags
		}
		if timestamp, ok := feedCells["timestamp"]; ok {
			if ts, err := strconv.ParseInt(timestamp, 10, 64); err == nil {
				feed.Timestamp = ts
			}
		}
		if read, ok := feedCells["read"]; ok {
			feed.Read = read == "true"
		}
	}

	return feed
}

func (r *GHBaseRepository) parseReplyFeed(rowKey string, cells map[string]map[string]string) *ReplyFeedRow {
	feed := &ReplyFeedRow{RowKey: rowKey}

	if replyCells, ok := cells["reply"]; ok {
		// Extract user_id from rowKey
		parts := strings.Split(rowKey, "_")
		if len(parts) > 0 {
			feed.UserID = parts[0]
		}

		if threadID, ok := replyCells["thread_id"]; ok {
			feed.ThreadID = threadID
		}
		if replyMsgID, ok := replyCells["reply_msg_id"]; ok {
			feed.ReplyMsgID = replyMsgID
		}
		if replyAuthor, ok := replyCells["reply_author"]; ok {
			feed.ReplyAuthor = replyAuthor
		}
		if parentMsgID, ok := replyCells["parent_msg_id"]; ok {
			feed.ParentMsgID = parentMsgID
		}
		if pushType, ok := replyCells["push_type"]; ok {
			feed.PushType = pushType
		}
		if contentType, ok := replyCells["content_type"]; ok {
			feed.ContentType = contentType
		}
		if contentPreview, ok := replyCells["content_preview"]; ok {
			feed.ContentPreview = contentPreview
		}
		if fullContent, ok := replyCells["full_content"]; ok {
			feed.FullContent = []byte(fullContent) // Convert string to []byte
		}
		if reason, ok := replyCells["reason"]; ok {
			feed.Reason = reason
		}
		if timestamp, ok := replyCells["timestamp"]; ok {
			if ts, err := strconv.ParseInt(timestamp, 10, 64); err == nil {
				feed.Timestamp = ts
			}
		}
		if requireFollow, ok := replyCells["require_follow"]; ok {
			feed.RequireFollow = requireFollow == "true"
		}
		if threadOwner, ok := replyCells["thread_owner"]; ok {
			feed.ThreadOwner = threadOwner
		}
	}

	return feed
}

func (r *GHBaseRepository) parseChatMetadata(chatKey string, cells map[string]map[string]string) *ChatMetadataRow {
	chat := &ChatMetadataRow{
		RowKey:  fmt.Sprintf("chat_%s", chatKey),
		ChatKey: chatKey,
	}

	if meta, ok := cells["meta"]; ok {
		if chatType, ok := meta["chat_type"]; ok {
			chat.ChatType = chatType
		}
		if participants, ok := meta["participants"]; ok {
			if participants != "" {
				chat.Participants = strings.Split(participants, ",")
			}
		}
		if aiAgents, ok := meta["ai_agents"]; ok {
			if aiAgents != "" {
				chat.AIAgents = strings.Split(aiAgents, ",")
			}
		}
		if createdBy, ok := meta["created_by"]; ok {
			chat.CreatedBy = createdBy
		}
		if createdAt, ok := meta["created_at"]; ok {
			if ts, err := strconv.ParseInt(createdAt, 10, 64); err == nil {
				chat.CreatedAt = ts
			}
		}
		if settings, ok := meta["settings"]; ok {
			chat.Settings = settings
		}
		if status, ok := meta["status"]; ok {
			chat.Status = status
		}
	}

	if stats, ok := cells["stats"]; ok {
		if msgCount, ok := stats["msg_count"]; ok {
			if count, err := strconv.ParseInt(msgCount, 10, 64); err == nil {
				chat.MsgCount = count
			}
		}
		if lastMsgID, ok := stats["last_msg_id"]; ok {
			chat.LastMsgID = lastMsgID
		}
		if lastActiveAt, ok := stats["last_active_at"]; ok {
			if ts, err := strconv.ParseInt(lastActiveAt, 10, 64); err == nil {
				chat.LastActiveAt = ts
			}
		}
		if unreadCounts, ok := stats["unread_counts"]; ok {
			chat.UnreadCounts = unreadCounts
		}
	}

	return chat
}

func (r *GHBaseRepository) parseChatInbox(rowKey string, cells map[string]map[string]string) *ChatInboxRow {
	inbox := &ChatInboxRow{RowKey: rowKey}

	if msgCells, ok := cells["msg"]; ok {
		// Extract user_id and chat_key from rowKey
		parts := strings.Split(rowKey, "_")
		if len(parts) >= 2 {
			inbox.UserID = parts[0]
			inbox.ChatKey = parts[1]
		}

		if chatKey, ok := msgCells["chat_key"]; ok {
			inbox.ChatKey = chatKey
		}
		if msgID, ok := msgCells["msg_id"]; ok {
			inbox.MsgID = msgID
		}
		if senderID, ok := msgCells["sender_id"]; ok {
			inbox.SenderID = senderID
		}
		if senderType, ok := msgCells["sender_type"]; ok {
			inbox.SenderType = senderType
		}
		if contentType, ok := msgCells["content_type"]; ok {
			inbox.ContentType = contentType
		}
		if rawContent, ok := msgCells["raw_content"]; ok {
			inbox.RawContent = []byte(rawContent) // Convert string to []byte
		}
		if mentions, ok := msgCells["mentions"]; ok {
			if mentions != "" {
				inbox.Mentions = strings.Split(mentions, ",")
			}
		}
		if flags, ok := msgCells["flags"]; ok {
			inbox.Flags = flags
		}
		if timestamp, ok := msgCells["timestamp"]; ok {
			if ts, err := strconv.ParseInt(timestamp, 10, 64); err == nil {
				inbox.Timestamp = ts
			}
		}
	}

	return inbox
}
