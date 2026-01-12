package actor

import "time"

// =============================================================================
// Common Types - 通用类型定义
// =============================================================================

// UserProfile contains user information.
type UserProfile struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Email       string            `json:"email,omitempty"`
	Avatar      string            `json:"avatar,omitempty"`
	Role        string            `json:"role"`
	Preferences *UserPreferences  `json:"preferences,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// UserPreferences contains user preferences.
type UserPreferences struct {
	Language      string `json:"language"`
	Theme         string `json:"theme"`
	Notifications bool   `json:"notifications"`
	DefaultModel  string `json:"default_model,omitempty"`
}

// UserStatus represents the user's current status.
type UserStatus string

const (
	UserStatusOnline  UserStatus = "online"
	UserStatusOffline UserStatus = "offline"
	UserStatusAway    UserStatus = "away"
	UserStatusBusy    UserStatus = "busy"
)

// Connection represents a user's connection (WebSocket, etc.)
type Connection interface {
	ID() string
	Send(msg []byte) error
	Close() error
	IsAlive() bool
}

// =============================================================================
// Message Types - 消息类型定义
// =============================================================================

// UserMessage represents a message from/to a user.
type UserMessage struct {
	BaseMessage
	UserID    string `json:"user_id"`
	Content   string `json:"content"`
	SessionID string `json:"session_id,omitempty"`
	TargetID  string `json:"target_id,omitempty"` // Agent or another user
}

func (m *UserMessage) Type() string {
	return "user_message"
}

// ConnectionEvent represents a connection state change.
type ConnectionEvent struct {
	BaseMessage
	ConnectionID string `json:"connection_id"`
	EventType    string `json:"event_type"` // connected, disconnected
	UserID       string `json:"user_id"`
}

func (m *ConnectionEvent) Type() string {
	return "connection_event"
}

// PresenceUpdate represents a presence change notification.
type PresenceUpdate struct {
	BaseMessage
	UserID string     `json:"user_id"`
	Status UserStatus `json:"status"`
}

func (m *PresenceUpdate) Type() string {
	return "presence_update"
}

// AgentMessage represents a message to/from the agent.
type AgentMessage struct {
	BaseMessage
	SessionID string `json:"session_id"`
	Role      string `json:"role"` // user, assistant, system
	Content   string `json:"content"`
	UserID    string `json:"user_id,omitempty"`
}

func (m *AgentMessage) Type() string {
	return "agent_message"
}

// ChainResultMessage contains the result of an action chain.
type ChainResultMessage struct {
	BaseMessage
	ChainID  string        `json:"chain_id"`
	Status   ChainStatus   `json:"status"`
	Result   string        `json:"result"`
	Duration time.Duration `json:"duration"`
}

func (m *ChainResultMessage) Type() string {
	return "chain_result"
}
