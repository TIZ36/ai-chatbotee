package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/commonlib/snowflake"
	"chatee-go/services/dbc_rpc/repository"
	"chatee-go/services/im_rpc/biz/ai"
)

// =============================================================================
// Core Chat Service - 实现文档中的完整Chat消息流程
// =============================================================================

// Config holds the chat core service configuration
type Config struct {
	Logger log.Logger
	Pools  *pool.PoolManager
}

// CoreService implements the complete chat message flow from the document
type CoreService struct {
	cfg       Config
	hbaseRepo repository.HBaseRepository
	aiService *ai.AIService
	fanout    *FanoutService
}

// NewCoreService creates a new core chat service
func NewCoreService(cfg Config, hbaseRepo repository.HBaseRepository, aiService *ai.AIService) *CoreService {
	fanout := NewFanoutService(cfg, hbaseRepo)
	return &CoreService{
		cfg:       cfg,
		hbaseRepo: hbaseRepo,
		aiService: aiService,
		fanout:    fanout,
	}
}

// =============================================================================
// Chat Message Flow (3.3 完整流程)
// =============================================================================

// SendChatMessage implements the complete chat message flow
// 步骤1-5: 消息发送验证 -> 写扩散到参与者收件箱 -> 实时推送 -> AI处理 -> 更新会话元数据
func (s *CoreService) SendChatMessage(ctx context.Context, req *SendChatMessageRequest) (*SendChatMessageResponse, error) {
	// 步骤1: 消息发送验证
	chatMeta, err := s.hbaseRepo.GetChatMetadata(ctx, req.ChatKey)
	if err != nil {
		return nil, fmt.Errorf("chat not found: %w", err)
	}

	// 验证发送者是否是会话参与者
	if !contains(chatMeta.Participants, req.SenderID) {
		return nil, fmt.Errorf("sender is not a participant")
	}

	// 验证@权限
	for _, mention := range req.Mentions {
		if !contains(chatMeta.Participants, mention) {
			return nil, fmt.Errorf("invalid mention: %s is not a participant", mention)
		}
	}

	// 会话状态检查
	if chatMeta.Status == "muted" && req.SenderID != chatMeta.CreatedBy {
		return nil, fmt.Errorf("chat is muted")
	}
	if chatMeta.Status == "archived" {
		return nil, fmt.Errorf("chat is archived")
	}

	// 生成消息ID
	msgID := snowflake.GenerateTypedID("msg")
	now := time.Now().Unix()

	// 步骤2: 写扩散到参与者收件箱
	fanoutReq := &FanoutChatRequest{
		ChatKey:     req.ChatKey,
		MsgID:       msgID,
		SenderID:    req.SenderID,
		SenderType:  req.SenderType,
		Content:     req.Content,
		ContentType: req.ContentType,
		Mentions:    req.Mentions,
	}
	if err := s.fanout.FanoutChatMessage(ctx, fanoutReq); err != nil {
		return nil, fmt.Errorf("failed to fanout message: %w", err)
	}

	// 缓存消息
	redis := s.cfg.Pools.GetRedis()
	msgCacheKey := fmt.Sprintf("msg_cache:%s", msgID)
	msgData := map[string]interface{}{
		"msg_id":      msgID,
		"chat_key":    req.ChatKey,
		"sender_id":   req.SenderID,
		"content":     string(req.Content),
		"content_type": req.ContentType,
		"mentions":    req.Mentions,
		"timestamp":   now,
	}
	msgJSON, _ := json.Marshal(msgData)
	redis.Set(ctx, msgCacheKey, msgJSON, 24*time.Hour)

	// 步骤3: 实时推送
	recipients := make([]string, 0, len(chatMeta.Participants))
	for _, p := range chatMeta.Participants {
		if p != req.SenderID {
			recipients = append(recipients, p)
		}
	}

	publishReq := &PublishChatRequest{
		ChatKey:    req.ChatKey,
		MsgID:      msgID,
		SenderID:   req.SenderID,
		Content:    req.Content,
		ChatType:   chatMeta.ChatType,
		Recipients: recipients,
		Silent:     s.isChatMuted(chatMeta),
	}
	if err := s.fanout.PublishChatMessage(ctx, publishReq); err != nil {
		s.cfg.Logger.Warn("Failed to publish chat message", "error", err)
	}

	// 步骤4: AI处理
	go s.handleAIAgents(ctx, req.ChatKey, msgID, req.Mentions, chatMeta.AIAgents, req)

	// 步骤5: 更新会话元数据 (已在FanoutChatMessage中完成)

	return &SendChatMessageResponse{
		MsgID: msgID,
	}, nil
}

// SendChatMessageRequest represents a request to send chat message
type SendChatMessageRequest struct {
	ChatKey     string
	SenderID    string
	SenderType  string
	Content     []byte
	ContentType string
	Mentions    []string
}

// SendChatMessageResponse represents the response
type SendChatMessageResponse struct {
	MsgID string
}

// =============================================================================
// AI Agent Handling
// =============================================================================

func (s *CoreService) handleAIAgents(ctx context.Context, chatKey, msgID string, mentions, aiAgents []string, req *SendChatMessageRequest) {
	// 被@的AI处理
	for _, mention := range mentions {
		if isAI(mention) && contains(aiAgents, mention) {
			// Process the message for mentioned AI agent
			if err := s.aiService.ProcessChatMessage(ctx, mention, chatKey, msgID, req.Content); err != nil {
				s.cfg.Logger.Warn("Failed to process message for mentioned AI agent",
					"agent_id", mention,
					"chat_key", chatKey,
					"msg_id", msgID,
					"error", err)
			}
		}
	}

	// 未被@的AI记忆更新（异步）
	for _, agentID := range aiAgents {
		if !contains(mentions, agentID) {
			// Update AI memory asynchronously
			go func(agentID string) {
				if err := s.aiService.UpdateAgentMemory(ctx, agentID, "chat", chatKey, req.Content); err != nil {
					s.cfg.Logger.Warn("Failed to update AI memory",
						"agent_id", agentID,
						"chat_key", chatKey,
						"error", err)
				}
			}(agentID)
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

func (s *CoreService) isChatMuted(chatMeta *repository.ChatMetadataRow) bool {
	// 检查chat settings中的muted状态
	// 简化实现
	return chatMeta.Status == "muted"
}
