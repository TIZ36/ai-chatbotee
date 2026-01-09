package push

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
)

// PushService handles Redis Pub/Sub for real-time message streaming
type PushService struct {
	cfg   Config
	redis *redis.Client
}

// Config holds the push service configuration
type Config struct {
	Logger log.Logger
	Pools  *pool.PoolManager
}

// NewPushService creates a new push service
func NewPushService(cfg Config) *PushService {
	return &PushService{
		cfg:   cfg,
		redis: cfg.Pools.GetRedis(),
	}
}

// SubscribeThread subscribes to thread events
func (s *PushService) SubscribeThread(ctx context.Context, threadID, userID string, stream ThreadEventStream) error {
	// Subscribe to thread-specific channel
	channel := fmt.Sprintf("thread:%s:events", threadID)
	return s.subscribe(ctx, channel, userID, stream)
}

// SubscribeChat subscribes to chat events
func (s *PushService) SubscribeChat(ctx context.Context, chatKey, userID string, stream ChatEventStream) error {
	// Subscribe to chat-specific channel
	channel := fmt.Sprintf("chat:%s:events", chatKey)
	return s.subscribe(ctx, channel, userID, stream)
}

// SubscribeUser subscribes to user-specific events (feed, mentions, etc.)
func (s *PushService) SubscribeUser(ctx context.Context, userID string, stream UserEventStream) error {
	// Subscribe to user-specific channels
	channels := []string{
		fmt.Sprintf("notify:%s", userID),      // Direct notifications
		fmt.Sprintf("channel:new_feed"),       // New feed items
		fmt.Sprintf("channel:thread_reply"),   // Thread replies
		fmt.Sprintf("channel:chat_message"),   // Chat messages
	}
	
	return s.subscribeMultiple(ctx, channels, userID, stream)
}

// subscribe subscribes to a single Redis channel
func (s *PushService) subscribe(ctx context.Context, channel, userID string, stream interface{}) error {
	pubsub := s.redis.Subscribe(ctx, channel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg := <-ch:
			if msg == nil {
				continue
			}

			// Parse message
			var eventData map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Payload), &eventData); err != nil {
				s.cfg.Logger.Error("Failed to parse event", "error", err)
				continue
			}

			// Filter by user if needed
			if recipients, ok := eventData["recipients"].([]interface{}); ok {
				userFound := false
				for _, r := range recipients {
					if str, ok := r.(string); ok && str == userID {
						userFound = true
						break
					}
				}
				if !userFound {
					continue
				}
			}

			// Send event to stream
			if err := s.sendEvent(stream, eventData); err != nil {
				s.cfg.Logger.Error("Failed to send event", "error", err)
				return err
			}
		}
	}
}

// subscribeMultiple subscribes to multiple Redis channels
func (s *PushService) subscribeMultiple(ctx context.Context, channels []string, userID string, stream interface{}) error {
	pubsub := s.redis.PSubscribe(ctx, channels...)
	defer pubsub.Close()

	ch := pubsub.Channel()
	
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg := <-ch:
			if msg == nil {
				continue
			}

			// Parse message
			var eventData map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Payload), &eventData); err != nil {
				s.cfg.Logger.Error("Failed to parse event", "error", err)
				continue
			}

			// Filter by user if needed
			if recipients, ok := eventData["recipients"].([]interface{}); ok {
				userFound := false
				for _, r := range recipients {
					if str, ok := r.(string); ok && str == userID {
						userFound = true
						break
					}
				}
				if !userFound {
					continue
				}
			}

			// Send event to stream
			if err := s.sendEvent(stream, eventData); err != nil {
				s.cfg.Logger.Error("Failed to send event", "error", err)
				return err
			}
		}
	}
}

// sendEvent sends event to the appropriate stream
func (s *PushService) sendEvent(stream interface{}, eventData map[string]interface{}) error {
	// Determine stream type and send accordingly
	switch str := stream.(type) {
	case ThreadEventStream:
		event := &ThreadEvent{
			EventType: getString(eventData, "type", "unknown"),
			ThreadID:  getString(eventData, "thread_id", ""),
			MsgID:     getString(eventData, "msg_id", ""),
			Payload:   marshalEventData(eventData),
			Timestamp: time.Now().Unix(),
		}
		return str.Send(event)
	case ChatEventStream:
		event := &ChatEvent{
			EventType: getString(eventData, "type", "unknown"),
			ChatKey:   getString(eventData, "chat_key", ""),
			MsgID:     getString(eventData, "msg_id", ""),
			Payload:   marshalEventData(eventData),
			Timestamp: time.Now().Unix(),
		}
		return str.Send(event)
	case UserEventStream:
		event := &UserEvent{
			EventType: getString(eventData, "type", "unknown"),
			UserID:    getString(eventData, "user_id", ""),
			Payload:   marshalEventData(eventData),
			Timestamp: time.Now().Unix(),
		}
		return str.Send(event)
	default:
		return fmt.Errorf("unknown stream type")
	}
}

func getString(m map[string]interface{}, key, defaultValue string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return defaultValue
}

func marshalEventData(data map[string]interface{}) []byte {
	payload, _ := json.Marshal(data)
	return payload
}

// ThreadEventStream is the interface for thread event streaming
type ThreadEventStream interface {
	Send(event *ThreadEvent) error
}

// ChatEventStream is the interface for chat event streaming
type ChatEventStream interface {
	Send(event *ChatEvent) error
}

// UserEventStream is the interface for user event streaming
type UserEventStream interface {
	Send(event *UserEvent) error
}

// ThreadEvent represents a thread event
type ThreadEvent struct {
	EventType string
	ThreadID  string
	MsgID     string
	Payload   []byte
	Timestamp int64
}

// ChatEvent represents a chat event
type ChatEvent struct {
	EventType string
	ChatKey   string
	MsgID     string
	Payload   []byte
	Timestamp int64
}

// UserEvent represents a user event
type UserEvent struct {
	EventType string
	UserID    string
	Payload   []byte
	Timestamp int64
}

