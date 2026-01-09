package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/commonlib/snowflake"
	"chatee-go/services/chatee-dbc/repository"
)

// =============================================================================
// Chat Fanout Service - 实现Chat消息写扩散
// =============================================================================

// FanoutService handles write-based fanout for chat messages
type FanoutService struct {
	cfg       Config
	hbaseRepo repository.HBaseRepository
}

// NewFanoutService creates a new chat fanout service
func NewFanoutService(cfg Config, hbaseRepo repository.HBaseRepository) *FanoutService {
	return &FanoutService{
		cfg:       cfg,
		hbaseRepo: hbaseRepo,
	}
}

// =============================================================================
// Chat Message Fanout (步骤2: 写扩散到参与者收件箱)
// =============================================================================

// FanoutChatMessage implements step 2 of chat message flow
// 写扩散到参与者收件箱
func (fs *FanoutService) FanoutChatMessage(ctx context.Context, req *FanoutChatRequest) error {
	redis := fs.cfg.Pools.GetRedis()

	// 获取会话元数据
	chatMeta, err := fs.hbaseRepo.GetChatMetadata(ctx, req.ChatKey)
	if err != nil {
		return fmt.Errorf("failed to get chat metadata: %w", err)
	}

	// 验证发送者是否是会话参与者
	if !contains(chatMeta.Participants, req.SenderID) {
		return fmt.Errorf("sender is not a participant")
	}

	// 验证@权限
	for _, mention := range req.Mentions {
		if !contains(chatMeta.Participants, mention) {
			return fmt.Errorf("invalid mention: %s is not a participant", mention)
		}
	}

	// 对每个参与者写扩散
	now := time.Now().Unix()
	flagsBase := map[string]interface{}{
		"is_group":    chatMeta.ChatType == "group",
		"has_mention": false,
		"read":       false,
	}

	for _, participantID := range chatMeta.Participants {
		flags := make(map[string]interface{})
		for k, v := range flagsBase {
			flags[k] = v
		}
		flags["is_sender"] = (participantID == req.SenderID)
		flags["has_mention"] = contains(req.Mentions, participantID)
		flags["read"] = (participantID == req.SenderID) // 发送者标记为已读

		flagsJSON, _ := json.Marshal(flags)

		inbox := &repository.ChatInboxRow{
			UserID:      participantID,
			ChatKey:     req.ChatKey,
			MsgID:       req.MsgID,
			SenderID:    req.SenderID,
			SenderType:  req.SenderType,
			ContentType: req.ContentType,
			RawContent:  req.Content,
			Mentions:    req.Mentions,
			Flags:       string(flagsJSON),
			Timestamp:   now,
		}

		if err := fs.hbaseRepo.SaveChatInbox(ctx, inbox); err != nil {
			fs.cfg.Logger.Error("Failed to save chat inbox",
				"user_id", participantID,
				"chat_key", req.ChatKey,
				"error", err)
			continue
		}

		// 更新未读计数（除发送者）
		if participantID != req.SenderID {
			unreadTotalKey := fmt.Sprintf("unread:%s:total", participantID)
			unreadChatKey := fmt.Sprintf("unread:%s:chat:%s", participantID, req.ChatKey)
			redis.Incr(ctx, unreadTotalKey)
			redis.HIncrBy(ctx, fmt.Sprintf("chat:%s:unread", req.ChatKey), participantID, 1)
			redis.Incr(ctx, unreadChatKey)
		}
	}

	// 更新会话元数据
	chatMeta.MsgCount++
	chatMeta.LastMsgID = req.MsgID
	chatMeta.LastActiveAt = now
	if err := fs.hbaseRepo.SaveChatMetadata(ctx, chatMeta); err != nil {
		fs.cfg.Logger.Warn("Failed to update chat metadata", "error", err)
	}

	return nil
}

// FanoutChatRequest represents a request to fanout chat message
type FanoutChatRequest struct {
	ChatKey     string
	MsgID       string
	SenderID    string
	SenderType  string
	Content     []byte
	ContentType string
	Mentions    []string
}

// =============================================================================
// Real-time Push (步骤3: 实时推送)
// =============================================================================

// PublishChatMessage publishes chat message to Redis Pub/Sub
func (fs *FanoutService) PublishChatMessage(ctx context.Context, req *PublishChatRequest) error {
	redis := fs.cfg.Pools.GetRedis()

	// 准备推送消息
	pushMsg := map[string]interface{}{
		"type":      "chat_message",
		"msg_id":    req.MsgID,
		"chat_key":  req.ChatKey,
		"author_id": req.SenderID,
		"content": map[string]interface{}{
			"content":   string(req.Content),
			"chat_type": req.ChatType,
			"is_group":  req.ChatType == "group",
		},
		"push_config": map[string]interface{}{
			"priority":    8, // Chat优先级较高
			"need_confirm": true,
			"silent":      req.Silent,
		},
		"recipients": req.Recipients,
	}

	pushMsgJSON, err := json.Marshal(pushMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal push message: %w", err)
	}

	// Redis发布
	return redis.Publish(ctx, "channel:chat_message", pushMsgJSON).Err()
}

// PublishChatRequest represents a request to publish chat message
type PublishChatRequest struct {
	ChatKey    string
	MsgID      string
	SenderID   string
	Content    []byte
	ChatType   string
	Recipients []string
	Silent     bool
}

// =============================================================================
// Helper Functions
// =============================================================================

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
