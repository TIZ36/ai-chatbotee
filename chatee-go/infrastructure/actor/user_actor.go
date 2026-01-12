package actor

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"chatee-go/commonlib/actor"
)

// =============================================================================
// UserActor Implementation - 具体实现
// =============================================================================

// UserState represents the current state of the user.
type UserState struct {
	Status       actor.UserStatus `json:"status"`
	LastSeen     time.Time        `json:"last_seen"`
	ActiveChats  []string         `json:"active_chats"`
	MessageCount int64            `json:"message_count"`
	Connections  int              `json:"connections"`
}

// UserActor represents a user in the system.
type UserActor struct {
	id          string
	profile     *actor.UserProfile
	state       UserState
	mu          sync.RWMutex
	connections map[string]actor.Connection

	// Callbacks
	OnStateChange     func(old, new actor.UserStatus)
	OnMessageReceived func(msg actor.Message)
}

// NewUserActor creates a new user actor.
func NewUserActor(id string, profile *actor.UserProfile) *UserActor {
	return &UserActor{
		id:          id,
		profile:     profile,
		connections: make(map[string]actor.Connection),
		state: UserState{
			Status:      actor.UserStatusOffline,
			LastSeen:    time.Now(),
			ActiveChats: make([]string, 0),
		},
	}
}

// Receive handles incoming messages.
func (u *UserActor) Receive(ctx context.Context, msg actor.Message) error {
	u.mu.Lock()
	u.state.LastSeen = time.Now()
	u.state.MessageCount++
	u.mu.Unlock()

	if u.OnMessageReceived != nil {
		u.OnMessageReceived(msg)
	}

	switch m := msg.(type) {
	case *actor.UserMessage:
		return u.handleUserMessage(ctx, m)
	case *actor.ConnectionEvent:
		return u.handleConnectionEvent(ctx, m)
	case *actor.AgentMessage:
		return u.handleAgentResponse(ctx, m)
	case *actor.PresenceUpdate:
		return u.handlePresenceUpdate(ctx, m)
	case *actor.GenericMessage:
		// Handle status query requests
		if m.MsgType == "get_status" && m.RespChan != nil {
			return u.handleGetStatus(ctx, m.RespChan)
		}
		// Forward other generic messages to connections
		return u.broadcastToConnections(msg)
	default:
		// Forward to all connections
		return u.broadcastToConnections(msg)
	}
}

// handleUserMessage processes a message from the user.
func (u *UserActor) handleUserMessage(ctx context.Context, msg *actor.UserMessage) error {
	// Message is typically forwarded to an agent or another user
	// This would be handled by the caller
	return nil
}

// handleConnectionEvent handles connection events.
func (u *UserActor) handleConnectionEvent(ctx context.Context, event *actor.ConnectionEvent) error {
	switch event.EventType {
	case "connected":
		u.updateStatus(actor.UserStatusOnline)
	case "disconnected":
		u.mu.Lock()
		if len(u.connections) == 0 {
			u.mu.Unlock()
			u.updateStatus(actor.UserStatusOffline)
		} else {
			u.mu.Unlock()
		}
	}
	return nil
}

// handleAgentResponse handles responses from agents.
func (u *UserActor) handleAgentResponse(ctx context.Context, msg *actor.AgentMessage) error {
	// Forward to all connections
	return u.broadcastToConnections(msg)
}

// handlePresenceUpdate handles presence updates from other users.
func (u *UserActor) handlePresenceUpdate(ctx context.Context, update *actor.PresenceUpdate) error {
	// Forward presence updates to connections if needed
	return nil
}

// handleGetStatus handles status query requests.
func (u *UserActor) handleGetStatus(ctx context.Context, respChan chan actor.Message) error {
	state := u.GetState()

	// Create a status response message
	// We'll use a GenericMessage with the state data
	statusData := map[string]interface{}{
		"user_id":      u.id,
		"online":       state.Status == actor.UserStatusOnline,
		"connections":  state.Connections,
		"last_seen":    state.LastSeen.Unix(),
		"active_chats": state.ActiveChats,
	}

	statusMsg := actor.NewMessage("user_status", statusData)

	// Send response
	select {
	case respChan <- statusMsg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	default:
		// Channel full, but don't block
		return nil
	}
}

// broadcastToConnections sends a message to all active connections.
func (u *UserActor) broadcastToConnections(msg actor.Message) error {
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
func (u *UserActor) updateStatus(newStatus actor.UserStatus) {
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
	u.connections = make(map[string]actor.Connection)
	u.state.Status = actor.UserStatusOffline

	return nil
}

// AddConnection adds a new connection.
func (u *UserActor) AddConnection(conn actor.Connection) {
	u.mu.Lock()
	defer u.mu.Unlock()

	u.connections[conn.ID()] = conn
	u.state.Connections = len(u.connections)
	u.state.Status = actor.UserStatusOnline
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
		u.state.Status = actor.UserStatusOffline
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

// GetState returns the current user state.
func (u *UserActor) GetState() UserState {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.state
}

// GetProfile returns the user profile.
func (u *UserActor) GetProfile() *actor.UserProfile {
	return u.profile
}

// IsOnline returns true if the user has active connections.
func (u *UserActor) IsOnline() bool {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.state.Status == actor.UserStatusOnline && len(u.connections) > 0
}

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
