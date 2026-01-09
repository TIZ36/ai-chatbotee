package thread

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/services/dbc_rpc/repository"
	"chatee-go/services/im_rpc/biz/relationship"
)

// =============================================================================
// Thread Fanout Service - 实现写扩散逻辑
// =============================================================================

// FanoutService handles write-based fanout for thread messages
type FanoutService struct {
	cfg          Config
	hbaseRepo    repository.HBaseRepository
	relationship *relationship.Service
}

// NewFanoutService creates a new fanout service
func NewFanoutService(cfg Config, hbaseRepo repository.HBaseRepository, relationship *relationship.Service) *FanoutService {
	return &FanoutService{
		cfg:         cfg,
		hbaseRepo:   hbaseRepo,
		relationship: relationship,
	}
}

// =============================================================================
// Thread Root Message Fanout (步骤3: 写扩散到粉丝收件箱)
// =============================================================================

// FanoutRootMessage implements step 3 of thread root message flow
// 写扩散到粉丝收件箱
func (fs *FanoutService) FanoutRootMessage(ctx context.Context, req *FanoutRootRequest) error {
	redis := fs.cfg.Pools.GetRedis()

	// 1. 获取粉丝列表
	followers, err := fs.relationship.GetFollowers(ctx, req.OwnerID)
	if err != nil {
		return fmt.Errorf("failed to get followers: %w", err)
	}

	// 2. 包含贴主添加的AI Agents
	allRecipients := make([]string, 0, len(followers)+len(req.AIAgents))
	allRecipients = append(allRecipients, followers...)
	allRecipients = append(allRecipients, req.AIAgents...)

	// 3. 批量写入user_follow_feeds
	now := time.Now().Unix()
	contentPreview := truncateString(string(req.Content), 100)

	flags := map[string]interface{}{
		"is_root":      true,
		"has_mention":  false,
		"is_ai":        false,
		"requires_follow": false,
	}
	flagsJSON, _ := json.Marshal(flags)

	for _, recipientID := range allRecipients {
		feed := &repository.FollowFeedRow{
			UserID:        recipientID,
			ThreadID:      req.ThreadID,
			MsgID:         req.MsgID,
			MsgType:       "root",
			AuthorID:      req.OwnerID,
			AuthorType:    "user",
			ContentPreview: contentPreview,
			Flags:         string(flagsJSON),
			Timestamp:     now,
			Read:          false,
		}

		if err := fs.hbaseRepo.SaveFollowFeed(ctx, feed); err != nil {
			fs.cfg.Logger.Error("Failed to save follow feed",
				"user_id", recipientID,
				"thread_id", req.ThreadID,
				"error", err)
			continue
		}

		// 4. 更新粉丝未读计数 (仅对用户,不包括AI)
		if !isAI(recipientID) {
			unreadTotalKey := fmt.Sprintf("unread:%s:total", recipientID)
			unreadThreadKey := fmt.Sprintf("unread:%s:thread:%s", recipientID, req.ThreadID)
			redis.Incr(ctx, unreadTotalKey)
			redis.Incr(ctx, unreadThreadKey)
		}
	}

	return nil
}

// FanoutRootRequest represents a request to fanout root message
type FanoutRootRequest struct {
	ThreadID  string
	MsgID     string
	OwnerID   string
	Content   []byte
	AIAgents  []string
}

// =============================================================================
// Thread Reply Fanout (步骤4: 写扩散到回复收件箱)
// =============================================================================

// FanoutReplyMessage implements step 4 of thread reply flow
// 写扩散到回复收件箱,包括完整推送和受限推送
func (fs *FanoutService) FanoutReplyMessage(ctx context.Context, req *FanoutReplyRequest) error {
	redis := fs.cfg.Pools.GetRedis()

	// 计算推送目标
	fullTargets, limitedTargets := fs.calculatePushTargets(ctx, req)

	now := time.Now().Unix()

	// 完整推送目标
	for _, targetID := range fullTargets {
		feed := &repository.ReplyFeedRow{
			UserID:        targetID,
			ThreadID:      req.ThreadID,
			ReplyMsgID:    req.ReplyMsgID,
			ReplyAuthor:   req.AuthorID,
			ParentMsgID:   req.ParentMsgID,
			PushType:      "full",
			ContentType:   "full_content",
			FullContent:   req.Content,
			Reason:        fs.getReason(targetID, req.ThreadOwnerID, req.Mentions),
			Timestamp:     now,
			RequireFollow: false,
			ThreadOwner:   req.ThreadOwnerID,
		}

		if err := fs.hbaseRepo.SaveReplyFeed(ctx, feed); err != nil {
			fs.cfg.Logger.Error("Failed to save reply feed (full)",
				"user_id", targetID,
				"thread_id", req.ThreadID,
				"error", err)
			continue
		}

		// 更新未读计数
		if !isAI(targetID) {
			unreadTotalKey := fmt.Sprintf("unread:%s:total", targetID)
			unreadThreadKey := fmt.Sprintf("unread:%s:thread:%s", targetID, req.ThreadID)
			redis.Incr(ctx, unreadTotalKey)
			redis.Incr(ctx, unreadThreadKey)
		}
	}

	// 受限推送目标
	for _, targetID := range limitedTargets {
		feed := &repository.ReplyFeedRow{
			UserID:        targetID,
			ThreadID:      req.ThreadID,
			ReplyMsgID:    req.ReplyMsgID,
			ReplyAuthor:   req.AuthorID,
			ParentMsgID:   req.ParentMsgID,
			PushType:      "limited",
			ContentType:   "preview_only",
			ContentPreview: fmt.Sprintf("用户%s在%s的Thread中提到了你", req.AuthorID, req.ThreadOwnerID),
			Reason:        "mentioned",
			Timestamp:     now,
			RequireFollow: true,
			ThreadOwner:   req.ThreadOwnerID,
		}

		if err := fs.hbaseRepo.SaveReplyFeed(ctx, feed); err != nil {
			fs.cfg.Logger.Error("Failed to save reply feed (limited)",
				"user_id", targetID,
				"thread_id", req.ThreadID,
				"error", err)
			continue
		}

		// 更新未读计数
		if !isAI(targetID) {
			unreadTotalKey := fmt.Sprintf("unread:%s:total", targetID)
			unreadThreadKey := fmt.Sprintf("unread:%s:thread:%s", targetID, req.ThreadID)
			redis.Incr(ctx, unreadTotalKey)
			redis.Incr(ctx, unreadThreadKey)
		}
	}

	return nil
}

// FanoutReplyRequest represents a request to fanout reply message
type FanoutReplyRequest struct {
	ThreadID      string
	ReplyMsgID    string
	AuthorID      string
	ParentMsgID   string
	Content       []byte
	Mentions      []string
	ThreadOwnerID string
}

// calculatePushTargets calculates full and limited push targets
// 实现文档中的步骤3: 推送目标计算
func (fs *FanoutService) calculatePushTargets(ctx context.Context, req *FanoutReplyRequest) (fullTargets, limitedTargets []string) {
	fullTargets = []string{}
	limitedTargets = []string{}

	// 1. 贴主必定收到完整推送
	fullTargets = append(fullTargets, req.ThreadOwnerID)

	// 2. 处理@提及
	for _, mention := range req.Mentions {
		if isAI(mention) {
			// 被@的AI: 完整推送
			fullTargets = append(fullTargets, mention)
		} else if isUser(mention) {
			// 被@的用户: 检查是否是贴主粉丝
			if fs.relationship.IsFollowing(ctx, mention, req.ThreadOwnerID) {
				fullTargets = append(fullTargets, mention)
			} else {
				// 不是贴主粉丝 → 受限推送
				limitedTargets = append(limitedTargets, mention)
			}
		}
	}

	// 去重
	fullTargets = deduplicate(fullTargets)
	limitedTargets = deduplicate(limitedTargets)

	return fullTargets, limitedTargets
}

// getReason determines the reason for the push
func (fs *FanoutService) getReason(targetID, threadOwnerID string, mentions []string) string {
	if targetID == threadOwnerID {
		return "owner"
	}
	for _, mention := range mentions {
		if mention == targetID {
			if isAI(targetID) {
				return "ai_mentioned"
			}
			return "mentioned"
		}
	}
	return "mentioned"
}

// =============================================================================
// Real-time Push (步骤5: 实时推送)
// =============================================================================

// PublishRootMessage publishes root message to Redis Pub/Sub
func (fs *FanoutService) PublishRootMessage(ctx context.Context, req *PushRootRequest) error {
	redis := fs.cfg.Pools.GetRedis()

	// 准备推送消息
	pushMsg := map[string]interface{}{
		"type":      "thread_root",
		"msg_id":    req.MsgID,
		"thread_id": req.ThreadID,
		"author_id": req.OwnerID,
		"content": map[string]interface{}{
			"preview":     truncateString(string(req.Content), 100),
			"thread_title": req.Title,
		},
		"push_config": map[string]interface{}{
			"priority":    5,
			"need_confirm": false,
			"silent":      false,
		},
		"recipients": req.Recipients,
	}

	pushMsgJSON, err := json.Marshal(pushMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal push message: %w", err)
	}

	// Redis发布
	return redis.Publish(ctx, "channel:new_feed", pushMsgJSON).Err()
}

// PushRootRequest represents a request to push root message to Redis Pub/Sub
type PushRootRequest struct {
	ThreadID   string
	MsgID      string
	OwnerID    string
	Content    []byte
	Title      string
	Recipients []string
}

// PublishReplyMessage publishes reply message to Redis Pub/Sub
func (fs *FanoutService) PublishReplyMessage(ctx context.Context, req *PushReplyRequest) error {
	redis := fs.cfg.Pools.GetRedis()

	// 准备推送消息
	pushMsg := map[string]interface{}{
		"thread_id":     req.ThreadID,
		"reply_msg_id":  req.ReplyMsgID,
		"author":        req.AuthorID,
		"full_targets":  req.FullTargets,
		"limited_targets": req.LimitedTargets,
	}

	pushMsgJSON, err := json.Marshal(pushMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal push message: %w", err)
	}

	// Redis发布
	return redis.Publish(ctx, "channel:thread_reply", pushMsgJSON).Err()
}

// PushReplyRequest represents a request to push reply message to Redis Pub/Sub
type PushReplyRequest struct {
	ThreadID       string
	ReplyMsgID     string
	AuthorID       string
	FullTargets    []string
	LimitedTargets []string
}

// =============================================================================
// Helper Functions
// =============================================================================

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// Helper functions - use the ones from core_service.go
// isAI and isUser are defined in core_service.go

func deduplicate(slice []string) []string {
	keys := make(map[string]bool)
	result := []string{}
	for _, item := range slice {
		if !keys[item] {
			keys[item] = true
			result = append(result, item)
		}
	}
	return result
}
