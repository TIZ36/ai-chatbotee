package actor

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// =============================================================================
// UserActor - Represents a connected user
// =============================================================================

// UserActor represents a user in the system.
type UserActor struct {
	id      string
	profile *UserProfile
	state   UserState
	mu      sync.RWMutex

	// Connection management
	connections map[string]Connection

	// Callbacks
	OnStateChange     func(old, new UserStatus)
	OnMessageReceived func(msg Message)
}

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

// UserState represents the current state of the user.
type UserState struct {
	Status       UserStatus `json:"status"`
	LastSeen     time.Time  `json:"last_seen"`
	ActiveChats  []string   `json:"active_chats"`
	MessageCount int64      `json:"message_count"`
	Connections  int        `json:"connections"`
}

// Connection represents a user's connection (WebSocket, etc.)
type Connection interface {
	ID() string
	Send(msg []byte) error
	Close() error
	IsAlive() bool
}

// =============================================================================
// User Message Types
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

// =============================================================================
// UserActor Implementation
// =============================================================================

// NewUserActor creates a new user actor.
func NewUserActor(id string, profile *UserProfile) *UserActor {
	return &UserActor{
		id:          id,
		profile:     profile,
		connections: make(map[string]Connection),
		state: UserState{
			Status:      UserStatusOffline,
			LastSeen:    time.Now(),
			ActiveChats: make([]string, 0),
		},
	}
}

// Receive handles incoming messages.
func (u *UserActor) Receive(ctx context.Context, msg Message) error {
	u.mu.Lock()
	u.state.LastSeen = time.Now()
	u.state.MessageCount++
	u.mu.Unlock()

	if u.OnMessageReceived != nil {
		u.OnMessageReceived(msg)
	}

	switch m := msg.(type) {
	case *UserMessage:
		return u.handleUserMessage(ctx, m)
	case *ConnectionEvent:
		return u.handleConnectionEvent(ctx, m)
	case *AgentMessage:
		return u.handleAgentResponse(ctx, m)
	case *PresenceUpdate:
		return u.handlePresenceUpdate(ctx, m)
	default:
		// Forward to all connections
		return u.broadcastToConnections(msg)
	}
}

// handleUserMessage processes a message from the user.
func (u *UserActor) handleUserMessage(ctx context.Context, msg *UserMessage) error {
	// Message is typically forwarded to an agent or another user
	// This would be handled by the caller
	return nil
}

// handleConnectionEvent handles connection events.
func (u *UserActor) handleConnectionEvent(ctx context.Context, event *ConnectionEvent) error {
	switch event.EventType {
	case "connected":
		u.updateStatus(UserStatusOnline)
	case "disconnected":
		u.mu.Lock()
		if len(u.connections) == 0 {
			u.mu.Unlock()
			u.updateStatus(UserStatusOffline)
		} else {
			u.mu.Unlock()
		}
	}
	return nil
}

// handleAgentResponse handles responses from agents.
func (u *UserActor) handleAgentResponse(ctx context.Context, msg *AgentMessage) error {
	// Forward to all connections
	return u.broadcastToConnections(msg)
}

// handlePresenceUpdate handles presence updates from other users.
func (u *UserActor) handlePresenceUpdate(ctx context.Context, update *PresenceUpdate) error {
	// Forward presence updates to connections if needed
	return nil
}

// broadcastToConnections sends a message to all active connections.
func (u *UserActor) broadcastToConnections(msg Message) error {
	u.mu.RLock()
	defer u.mu.RUnlock()

	// Serialize message to JSON
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	for _, conn := range u.connections {
		if conn.IsAlive() {
			if err := conn.Send(data); err != nil {
				// Log error but continue with other connections
				continue
			}
		}
	}
	return nil
}

// updateStatus updates the user status with callback.
func (u *UserActor) updateStatus(newStatus UserStatus) {
	u.mu.Lock()
	oldStatus := u.state.Status
	u.state.Status = newStatus
	u.mu.Unlock()

	if u.OnStateChange != nil && oldStatus != newStatus {
		u.OnStateChange(oldStatus, newStatus)
	}
}

// OnStart is called when the actor starts.
func (u *UserActor) OnStart(ctx context.Context) error {
	return nil
}

// OnStop is called when the actor stops.
func (u *UserActor) OnStop(ctx context.Context) error {
	u.mu.Lock()
	defer u.mu.Unlock()

	// Close all connections
	for _, conn := range u.connections {
		conn.Close()
	}
	u.connections = make(map[string]Connection)
	u.state.Status = UserStatusOffline

	return nil
}

// =============================================================================
// Connection Management
// =============================================================================

// AddConnection adds a new connection.
func (u *UserActor) AddConnection(conn Connection) {
	u.mu.Lock()
	defer u.mu.Unlock()

	u.connections[conn.ID()] = conn
	u.state.Connections = len(u.connections)
	u.state.Status = UserStatusOnline
}

// RemoveConnection removes a connection.
func (u *UserActor) RemoveConnection(connID string) {
	u.mu.Lock()
	if conn, exists := u.connections[connID]; exists {
		conn.Close()
		delete(u.connections, connID)
	}
	u.state.Connections = len(u.connections)

	if len(u.connections) == 0 {
		u.state.Status = UserStatusOffline
	}
	u.mu.Unlock()
}

// GetConnections returns all connection IDs.
func (u *UserActor) GetConnections() []string {
	u.mu.RLock()
	defer u.mu.RUnlock()

	ids := make([]string, 0, len(u.connections))
	for id := range u.connections {
		ids = append(ids, id)
	}
	return ids
}

// =============================================================================
// Getters
// =============================================================================

// GetState returns the current user state.
func (u *UserActor) GetState() UserState {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.state
}

// GetProfile returns the user profile.
func (u *UserActor) GetProfile() *UserProfile {
	return u.profile
}

// IsOnline returns true if the user has active connections.
func (u *UserActor) IsOnline() bool {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.state.Status == UserStatusOnline && len(u.connections) > 0
}

// =============================================================================
// Chat Management
// =============================================================================

// JoinChat adds a chat to the user's active chats.
func (u *UserActor) JoinChat(chatID string) {
	u.mu.Lock()
	defer u.mu.Unlock()

	// Check if already in chat
	for _, id := range u.state.ActiveChats {
		if id == chatID {
			return
		}
	}
	u.state.ActiveChats = append(u.state.ActiveChats, chatID)
}

// LeaveChat removes a chat from the user's active chats.
func (u *UserActor) LeaveChat(chatID string) {
	u.mu.Lock()
	defer u.mu.Unlock()

	for i, id := range u.state.ActiveChats {
		if id == chatID {
			u.state.ActiveChats = append(u.state.ActiveChats[:i], u.state.ActiveChats[i+1:]...)
			return
		}
	}
}

// GetActiveChats returns the user's active chats.
func (u *UserActor) GetActiveChats() []string {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return append([]string{}, u.state.ActiveChats...)
}
