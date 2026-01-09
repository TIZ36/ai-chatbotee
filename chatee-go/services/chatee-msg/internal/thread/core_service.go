package thread

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
	"chatee-go/services/chatee-msg/internal/relationship"
)

// =============================================================================
// Core Thread Service - 实现文档中的完整流程
// =============================================================================

// CoreService implements the complete thread message flow from the document
type CoreService struct {
	cfg         Config
	hbaseRepo   repository.HBaseRepository
	relationship *relationship.Service
	fanout      *FanoutService
}

// NewCoreService creates a new core thread service
func NewCoreService(cfg Config, hbaseRepo repository.HBaseRepository, relationship *relationship.Service) *CoreService {
	fanout := NewFanoutService(cfg, hbaseRepo, relationship)
	return &CoreService{
		cfg:         cfg,
		hbaseRepo:   hbaseRepo,
		relationship: relationship,
		fanout:      fanout,
	}
}

// =============================================================================
// Thread Root Message Flow (3.1 完整流程)
// =============================================================================

// PublishRootMessage implements the complete thread root message flow
// 步骤1-6: 接收验证 -> 数据持久化 -> 写扩散 -> 实时推送 -> AI处理 -> 离线处理
func (s *CoreService) PublishRootMessage(ctx context.Context, req *PublishRootRequest) (*PublishRootResponse, error) {
	// 步骤1: 接收与验证
	if err := s.validateRootRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// 生成ID
	msgID := snowflake.GenerateTypedID("msg")
	threadID := fmt.Sprintf("thread_%s", snowflake.GenerateTypedID("thd"))

	now := time.Now().Unix()

	// 步骤2: 数据持久化
	// 2.1 写入threads_metadata
	threadMeta := &repository.ThreadMetadata{
		ThreadID:    threadID,
		OwnerID:      req.OwnerID,
		RootMsgID:   msgID,
		Title:       req.Title,
		AIAgents:    req.AIAgents,
		Settings:    req.SettingsJSON,
		CreatedAt:   now,
		Status:      "active",
		ReplyCount:  0,
		Participants: []string{req.OwnerID},
		LastActiveAt: now,
	}
	if err := s.hbaseRepo.SaveThreadMetadata(ctx, threadMeta); err != nil {
		return nil, fmt.Errorf("failed to save thread metadata: %w", err)
	}

	// 2.2 写入thread_messages
	threadMsg := &repository.ThreadMessageRow{
		ThreadID:    threadID,
		MsgID:       msgID,
		AuthorID:    req.OwnerID,
		AuthorType:  "user",
		ContentType: req.ContentType,
		RawContent:  req.Content,
		Compressed:  false,
		ParentMsgID: "",
		Mentions:    req.Mentions,
		Depth:       0,
		Metadata:    req.MetadataJSON,
		Timestamp:   now,
		Deleted:     false,
	}
	if err := s.hbaseRepo.SaveThreadMessage(ctx, threadMsg); err != nil {
		return nil, fmt.Errorf("failed to save thread message: %w", err)
	}

	// 2.3 写入消息缓存
	redis := s.cfg.Pools.GetRedis()
	msgCacheKey := fmt.Sprintf("msg_cache:%s", msgID)
	msgJSON, _ := json.Marshal(threadMsg)
	redis.Set(ctx, msgCacheKey, msgJSON, 24*time.Hour)

	// 2.4 记录贴主自己的Thread
	threadListKey := fmt.Sprintf("user:%s:threads:hot", req.OwnerID)
	redis.ZAdd(ctx, threadListKey, redis.Z{
		Score:  float64(now),
		Member: threadID,
	})

	// 步骤3: 写扩散到粉丝收件箱
	fanoutReq := &FanoutRootRequest{
		ThreadID: threadID,
		MsgID:    msgID,
		OwnerID:  req.OwnerID,
		Content:  req.Content,
		AIAgents: req.AIAgents,
	}
	if err := s.fanout.FanoutRootMessage(ctx, fanoutReq); err != nil {
		s.cfg.Logger.Warn("Failed to fanout root message", "error", err)
		// Continue even if fanout fails
	}

	// 步骤4: 实时推送
	followers, _ := s.relationship.GetFollowers(ctx, req.OwnerID)
	allRecipients := make([]string, 0, len(followers)+len(req.AIAgents))
	allRecipients = append(allRecipients, followers...)
	allRecipients = append(allRecipients, req.AIAgents...)

	publishReq := &PublishRootRequest{
		ThreadID:   threadID,
		MsgID:      msgID,
		OwnerID:    req.OwnerID,
		Content:    req.Content,
		Title:      req.Title,
		Recipients: allRecipients,
	}
	if err := s.fanout.PublishRootMessage(ctx, publishReq); err != nil {
		s.cfg.Logger.Warn("Failed to publish root message", "error", err)
	}

	// 步骤5: AI Agent处理 (异步)
	go s.handleAIAgents(ctx, threadID, msgID, req.AIAgents, threadMsg)

	return &PublishRootResponse{
		ThreadID: threadID,
		MsgID:    msgID,
	}, nil
}

// PublishRootRequest represents a request to publish root message
type PublishRootRequest struct {
	OwnerID      string
	Content      []byte
	ContentType  string
	Title        string
	AIAgents     []string
	Mentions     []string
	SettingsJSON string
	MetadataJSON string
}

// PublishRootResponse represents the response
type PublishRootResponse struct {
	ThreadID string
	MsgID    string
}

// =============================================================================
// Thread Reply Flow (3.2 完整流程)
// =============================================================================

// PublishReply implements the complete thread reply flow
// 步骤1-7: 权限验证 -> 数据持久化 -> 推送目标计算 -> 写扩散 -> 实时推送 -> AI处理 -> 客户端交互
func (s *CoreService) PublishReply(ctx context.Context, req *PublishReplyRequest) (*PublishReplyResponse, error) {
	// 步骤1: 权限验证
	threadMeta, err := s.hbaseRepo.GetThreadMetadata(ctx, req.ThreadID)
	if err != nil {
		return nil, fmt.Errorf("thread not found: %w", err)
	}

	// 验证回复者必须是贴主的粉丝
	if !s.relationship.CanReplyToThread(ctx, req.ReplierID, threadMeta.OwnerID) {
		return nil, fmt.Errorf("user must follow thread owner to reply")
	}

	// 验证@权限
	if err := s.validateMentions(ctx, req.Mentions, req.ReplierID, threadMeta); err != nil {
		return nil, fmt.Errorf("mention validation failed: %w", err)
	}

	// 验证父消息存在性
	if req.ParentMsgID != "" {
		_, err := s.hbaseRepo.GetThreadMessage(ctx, req.ThreadID, req.ParentMsgID)
		if err != nil {
			return nil, fmt.Errorf("parent message not found: %w", err)
		}
	}

	// 步骤2: 数据持久化
	replyMsgID := snowflake.GenerateTypedID("msg")
	now := time.Now().Unix()

	// 计算深度
	depth := int32(0)
	if req.ParentMsgID != "" {
		parentMsg, err := s.hbaseRepo.GetThreadMessage(ctx, req.ThreadID, req.ParentMsgID)
		if err == nil {
			depth = parentMsg.Depth + 1
		}
	}

	// 2.1 写入thread_messages
	replyMsg := &repository.ThreadMessageRow{
		ThreadID:    req.ThreadID,
		MsgID:       replyMsgID,
		AuthorID:    req.ReplierID,
		AuthorType:  "user",
		ContentType: req.ContentType,
		RawContent:  req.Content,
		Compressed:  false,
		ParentMsgID: req.ParentMsgID,
		Mentions:    req.Mentions,
		Depth:       depth,
		Metadata:    req.MetadataJSON,
		Timestamp:   now,
		Deleted:     false,
	}
	if err := s.hbaseRepo.SaveThreadMessage(ctx, replyMsg); err != nil {
		return nil, fmt.Errorf("failed to save reply message: %w", err)
	}

	// 2.2 更新threads_metadata
	threadMeta.ReplyCount++
	if !contains(threadMeta.Participants, req.ReplierID) {
		threadMeta.Participants = append(threadMeta.Participants, req.ReplierID)
	}
	threadMeta.LastMsgID = replyMsgID
	threadMeta.LastActiveAt = now
	if err := s.hbaseRepo.SaveThreadMetadata(ctx, threadMeta); err != nil {
		s.cfg.Logger.Warn("Failed to update thread metadata", "error", err)
	}

	// 2.3 缓存消息
	redis := s.cfg.Pools.GetRedis()
	msgCacheKey := fmt.Sprintf("msg_cache:%s", replyMsgID)
	msgJSON, _ := json.Marshal(replyMsg)
	redis.Set(ctx, msgCacheKey, msgJSON, 24*time.Hour)

	// 步骤3: 推送目标计算
	fanoutReq := &FanoutReplyRequest{
		ThreadID:      req.ThreadID,
		ReplyMsgID:    replyMsgID,
		AuthorID:      req.ReplierID,
		ParentMsgID:   req.ParentMsgID,
		Content:       req.Content,
		Mentions:      req.Mentions,
		ThreadOwnerID: threadMeta.OwnerID,
	}
	fullTargets, limitedTargets := s.fanout.calculatePushTargets(ctx, fanoutReq)

	// 步骤4: 写扩散到回复收件箱
	if err := s.fanout.FanoutReplyMessage(ctx, fanoutReq); err != nil {
		s.cfg.Logger.Warn("Failed to fanout reply message", "error", err)
	}

	// 步骤5: 实时推送
	publishReq := &PublishReplyRequest{
		ThreadID:       req.ThreadID,
		ReplyMsgID:     replyMsgID,
		AuthorID:       req.ReplierID,
		FullTargets:     fullTargets,
		LimitedTargets: limitedTargets,
	}
	if err := s.fanout.PublishReplyMessage(ctx, publishReq); err != nil {
		s.cfg.Logger.Warn("Failed to publish reply message", "error", err)
	}

	// 步骤6: AI处理
	go s.handleReplyAIAgents(ctx, req.ThreadID, replyMsgID, req.Mentions, threadMeta.AIAgents, replyMsg)

	return &PublishReplyResponse{
		ReplyMsgID: replyMsgID,
	}, nil
}

// PublishReplyRequest represents a request to publish reply
type PublishReplyRequest struct {
	ThreadID     string
	ReplierID    string
	Content      []byte
	ContentType  string
	ParentMsgID  string
	Mentions     []string
	MetadataJSON string
}

// PublishReplyResponse represents the response
type PublishReplyResponse struct {
	ReplyMsgID string
}

// =============================================================================
// Validation Functions
// =============================================================================

func (s *CoreService) validateRootRequest(ctx context.Context, req *PublishRootRequest) error {
	// 验证贴主存在性 (可以检查用户是否存在)
	// 验证AI Agent有效性
	// 内容安全审核 (异步)
	return nil
}

func (s *CoreService) validateMentions(ctx context.Context, mentions []string, replierID string, threadMeta *repository.ThreadMetadata) error {
	for _, mention := range mentions {
		if isAI(mention) {
			// 必须是Thread中的AI
			if !contains(threadMeta.AIAgents, mention) {
				return fmt.Errorf("AI agent %s is not in thread", mention)
			}
		} else if isUser(mention) {
			// 必须是回复者的好友（双向关注）
			if !s.relationship.CanMentionUser(ctx, replierID, mention) {
				return fmt.Errorf("user %s cannot mention %s (not friends)", replierID, mention)
			}
		} else {
			return fmt.Errorf("invalid mention: %s", mention)
		}
	}
	return nil
}

// =============================================================================
// AI Agent Handling
// =============================================================================

func (s *CoreService) handleAIAgents(ctx context.Context, threadID, msgID string, aiAgents []string, msg *repository.ThreadMessageRow) {
	// 对每个AI Agent激活处理
	// 这里应该调用AiAgentActor
	// TODO: 实现AI Agent激活逻辑
	for _, agentID := range aiAgents {
		s.cfg.Logger.Info("AI agent activated",
			"agent_id", agentID,
			"thread_id", threadID,
			"msg_id", msgID)
	}
}

func (s *CoreService) handleReplyAIAgents(ctx context.Context, threadID, replyMsgID string, mentions, aiAgents []string, replyMsg *repository.ThreadMessageRow) {
	// 被@的AI处理
	for _, mention := range mentions {
		if isAI(mention) && contains(aiAgents, mention) {
			s.cfg.Logger.Info("AI agent mentioned in reply",
				"agent_id", mention,
				"thread_id", threadID,
				"reply_msg_id", replyMsgID)
			// TODO: 调用AiAgentActor.OnThreadReply
		}
	}

	// 未被@的AI记忆更新（异步）
	for _, agentID := range aiAgents {
		if !contains(mentions, agentID) {
			s.cfg.Logger.Info("Updating AI memory",
				"agent_id", agentID,
				"thread_id", threadID)
			// TODO: 异步更新AI记忆
		}
	}
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

func isAI(id string) bool {
	return len(id) > 0 && (id[0] == 'a' || len(id) > 3 && id[:3] == "ai_")
}

func isUser(id string) bool {
	return !isAI(id)
}
