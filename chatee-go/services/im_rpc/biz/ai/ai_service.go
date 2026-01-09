package ai

import (
	"context"
	"fmt"
	"time"

	"chatee-go/commonlib/log"
	commonpb "chatee-go/gen/common"
	svragent "chatee-go/gen/svr/agent"
)

// AIService handles AI agent integration
type AIService struct {
	cfg    Config
	client svragent.AgentServiceClient
}

// Config holds the AI service configuration
type Config struct {
	Logger log.Logger
	Client svragent.AgentServiceClient // Can be nil if AI service is not available
}

// NewAIService creates a new AI service
func NewAIService(cfg Config) *AIService {
	return &AIService{
		cfg:    cfg,
		client: cfg.Client,
	}
}

// ActivateAgentForThread activates an AI agent for a thread
func (s *AIService) ActivateAgentForThread(ctx context.Context, agentID, threadID string, persona *svragent.Persona) error {
	if s.client == nil {
		s.cfg.Logger.Warn("AI client not available, skipping activation")
		return nil
	}

	req := &svragent.ActivateRequest{
		AgentId:     agentID,
		ContextType: "thread",
		ContextId:   threadID,
		Persona:     persona,
	}

	resp, err := s.client.ActivateActor(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to activate agent: %w", err)
	}

	if !resp.GetSuccess() {
		return fmt.Errorf("agent activation failed: %s", resp.GetError())
	}

	s.cfg.Logger.Info("AI agent activated",
		"agent_id", agentID,
		"thread_id", threadID,
		"actor_id", resp.GetActorId())

	return nil
}

// ActivateAgentForChat activates an AI agent for a chat
func (s *AIService) ActivateAgentForChat(ctx context.Context, agentID, chatKey string, persona *svragent.Persona) error {
	if s.client == nil {
		s.cfg.Logger.Warn("AI client not available, skipping activation")
		return nil
	}

	req := &svragent.ActivateRequest{
		AgentId:     agentID,
		ContextType: "chat",
		ContextId:   chatKey,
		Persona:     persona,
	}

	resp, err := s.client.ActivateActor(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to activate agent: %w", err)
	}

	if !resp.GetSuccess() {
		return fmt.Errorf("agent activation failed: %s", resp.GetError())
	}

	s.cfg.Logger.Info("AI agent activated",
		"agent_id", agentID,
		"chat_key", chatKey,
		"actor_id", resp.GetActorId())

	return nil
}

// ProcessThreadMessage processes a thread message for AI agents
func (s *AIService) ProcessThreadMessage(ctx context.Context, agentID, threadID, msgID string, content []byte) error {
	if s.client == nil {
		return nil // AI service is optional
	}

	req := &svragent.ProcessRequest{
		AgentId:     agentID,
		ContextType: "thread",
		ContextId:   threadID,
		Message: &commonpb.BaseMessage{
			MsgId:       msgID,
			AuthorId:    agentID,
			AuthorType:  commonpb.AuthorType_AI,
			ContentType: commonpb.ContentType_TEXT,
			RawContent:  content,
			Timestamp:   time.Now().Unix(),
		},
		Trigger: "mention", // or "new_thread" for root messages
	}

	// ProcessMessage returns a stream, but we'll handle it asynchronously
	stream, err := s.client.ProcessMessage(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to process message: %w", err)
	}

	// Handle stream events asynchronously
	go func() {
		for {
			event, err := stream.Recv()
			if err != nil {
				s.cfg.Logger.Warn("Error receiving process event",
					"agent_id", agentID,
					"thread_id", threadID,
					"error", err)
				return
			}
			
			// Handle different event types based on the oneof field
			if event.GetChainStarted() != nil {
				s.cfg.Logger.Info("AI agent started action chain",
					"agent_id", agentID,
					"chain_id", event.GetChainStarted().GetChainId())
			} else if event.GetContent() != nil {
				s.cfg.Logger.Info("AI agent generated content",
					"agent_id", agentID,
					"content_type", event.GetContent().GetType())
			} else if event.GetToolCall() != nil {
				s.cfg.Logger.Info("AI agent called tool",
					"agent_id", agentID,
					"tool_name", event.GetToolCall().GetToolName())
			} else if event.GetError() != nil {
				s.cfg.Logger.Error("AI processing error",
					"agent_id", agentID,
					"error", event.GetError().GetMessage())
			}
		}
	}()

	return nil
}

// ProcessChatMessage processes a chat message for AI agents
func (s *AIService) ProcessChatMessage(ctx context.Context, agentID, chatKey, msgID string, content []byte) error {
	if s.client == nil {
		return nil // AI service is optional
	}

	req := &svragent.ProcessRequest{
		AgentId:     agentID,
		ContextType: "chat",
		ContextId:   chatKey,
		Message: &commonpb.BaseMessage{
			MsgId:       msgID,
			AuthorId:    agentID,
			AuthorType:  commonpb.AuthorType_AI,
			ContentType: commonpb.ContentType_TEXT,
			RawContent:  content,
			Timestamp:   time.Now().Unix(),
		},
		Trigger: "mention", // or "new_chat" for new chats
	}

	// ProcessMessage returns a stream, but we'll handle it asynchronously
	stream, err := s.client.ProcessMessage(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to process message: %w", err)
	}

	// Handle stream events asynchronously
	go func() {
		for {
			event, err := stream.Recv()
			if err != nil {
				s.cfg.Logger.Warn("Error receiving process event",
					"agent_id", agentID,
					"chat_key", chatKey,
					"error", err)
				return
			}
			
			// Handle different event types based on the oneof field
			if event.GetChainStarted() != nil {
				s.cfg.Logger.Info("AI agent started action chain",
					"agent_id", agentID,
					"chain_id", event.GetChainStarted().GetChainId())
			} else if event.GetContent() != nil {
				s.cfg.Logger.Info("AI agent generated content",
					"agent_id", agentID,
					"content_type", event.GetContent().GetType())
			} else if event.GetToolCall() != nil {
				s.cfg.Logger.Info("AI agent called tool",
					"agent_id", agentID,
					"tool_name", event.GetToolCall().GetToolName())
			} else if event.GetError() != nil {
				s.cfg.Logger.Error("AI processing error",
					"agent_id", agentID,
					"error", event.GetError().GetMessage())
			}
		}
	}()

	return nil
}

// UpdateAgentMemory updates AI agent memory (async)
// Note: The current agent.proto doesn't have a direct memory update method.
// Memory is typically updated through ProcessMessage or as part of the conversation flow.
// This method logs the update for now, and actual memory updates happen during message processing.
func (s *AIService) UpdateAgentMemory(ctx context.Context, agentID, contextType, contextID string, content []byte) error {
	if s.client == nil {
		return nil // AI service is optional
	}

	// Memory updates are typically handled automatically by the AI service
	// when processing messages. We log this for tracking purposes.
	s.cfg.Logger.Info("AI agent memory update logged",
		"agent_id", agentID,
		"context_type", contextType,
		"context_id", contextID)

	// In a full implementation, we might send a special message type
	// to the ProcessMessage stream to update memory, or use a dedicated
	// memory update endpoint if available in future versions of the API.
	return nil
}
