package service

import (
	"sync"
	"time"

	"chatee-go/commonlib/log"
)

// =============================================================================
// Hub - Manages all WebSocket connections
// =============================================================================

// Hub maintains active connections and broadcasts messages.
type Hub struct {
	// Registered connections by ID
	connections map[string]*Connection
	// Connections by user ID (a user can have multiple connections)
	userConnections map[string]map[string]*Connection
	// Channels for communication
	register   chan *Connection
	unregister chan *Connection
	broadcast  chan *Message
	// Configuration
	config HubConfig
	// Mutex for thread safety
	mu sync.RWMutex
	// Shutdown
	done chan struct{}
}

// HubConfig configures the hub.
type HubConfig struct {
	Logger       log.Logger
	PingInterval time.Duration
	PongWait     time.Duration
}

// Connection represents a WebSocket connection.
type Connection struct {
	ID         string
	UserID     string
	SessionID  string
	Send       chan []byte
	Hub        *Hub
	JoinedAt   time.Time
	LastActive time.Time
	Metadata   map[string]any
}

// Message represents a message to broadcast.
type Message struct {
	// Target
	ConnectionID string // Specific connection
	UserID       string // All connections for a user
	SessionID    string // All connections in a session
	Broadcast    bool   // All connections
	// Content
	Data []byte
	Type string // message, event, error
}

// NewHub creates a new hub.
func NewHub(config HubConfig) *Hub {
	return &Hub{
		connections:     make(map[string]*Connection),
		userConnections: make(map[string]map[string]*Connection),
		register:        make(chan *Connection, 100),
		unregister:      make(chan *Connection, 100),
		broadcast:       make(chan *Message, 1000),
		config:          config,
		done:            make(chan struct{}),
	}
}

// Run starts the hub's main loop.
func (h *Hub) Run() {
	for {
		select {
		case <-h.done:
			h.cleanup()
			return
		case conn := <-h.register:
			h.registerConnection(conn)
		case conn := <-h.unregister:
			h.unregisterConnection(conn)
		case msg := <-h.broadcast:
			h.handleBroadcast(msg)
		}
	}
}

// Shutdown stops the hub.
func (h *Hub) Shutdown() {
	close(h.done)
}

// registerConnection registers a new connection.
func (h *Hub) registerConnection(conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.connections[conn.ID] = conn
	// Add to user connections
	if conn.UserID != "" {
		if h.userConnections[conn.UserID] == nil {
			h.userConnections[conn.UserID] = make(map[string]*Connection)
		}
		h.userConnections[conn.UserID][conn.ID] = conn
	}
	h.config.Logger.Info("Connection registered",
		log.String("connection_id", conn.ID),
		log.String("user_id", conn.UserID),
		log.Int("total_connections", len(h.connections)),
	)
}

// unregisterConnection removes a connection.
func (h *Hub) unregisterConnection(conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.connections[conn.ID]; ok {
		delete(h.connections, conn.ID)
		close(conn.Send)
		// Remove from user connections
		if conn.UserID != "" && h.userConnections[conn.UserID] != nil {
			delete(h.userConnections[conn.UserID], conn.ID)
			if len(h.userConnections[conn.UserID]) == 0 {
				delete(h.userConnections, conn.UserID)
			}
		}
		h.config.Logger.Info("Connection unregistered",
			log.String("connection_id", conn.ID),
			log.String("user_id", conn.UserID),
			log.Int("total_connections", len(h.connections)),
		)
	}
}

// handleBroadcast sends a message to appropriate connections.
func (h *Hub) handleBroadcast(msg *Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	switch {
	case msg.Broadcast:
		// Send to all connections
		for _, conn := range h.connections {
			h.sendToConnection(conn, msg.Data)
		}
	case msg.ConnectionID != "":
		// Send to specific connection
		if conn, ok := h.connections[msg.ConnectionID]; ok {
			h.sendToConnection(conn, msg.Data)
		}
	case msg.UserID != "":
		// Send to all user connections
		if conns, ok := h.userConnections[msg.UserID]; ok {
			for _, conn := range conns {
				h.sendToConnection(conn, msg.Data)
			}
		}
	case msg.SessionID != "":
		// Send to all connections in session
		for _, conn := range h.connections {
			if conn.SessionID == msg.SessionID {
				h.sendToConnection(conn, msg.Data)
			}
		}
	}
}

// sendToConnection sends data to a connection.
func (h *Hub) sendToConnection(conn *Connection, data []byte) {
	select {
	case conn.Send <- data:
		conn.LastActive = time.Now()
	default:
		// Buffer full, close connection
		h.config.Logger.Warn("Connection buffer full, closing",
			log.String("connection_id", conn.ID),
		)
		close(conn.Send)
		delete(h.connections, conn.ID)
	}
}

// cleanup closes all connections.
func (h *Hub) cleanup() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, conn := range h.connections {
		close(conn.Send)
	}
	h.connections = make(map[string]*Connection)
	h.userConnections = make(map[string]map[string]*Connection)
	h.config.Logger.Info("Hub cleaned up")
}

// =============================================================================
// Public Methods
// =============================================================================

// Register registers a connection.
func (h *Hub) Register(conn *Connection) {
	h.register <- conn
}

// Unregister unregisters a connection.
func (h *Hub) Unregister(conn *Connection) {
	h.unregister <- conn
}

// Broadcast broadcasts a message.
func (h *Hub) Broadcast(msg *Message) {
	h.broadcast <- msg
}

// SendToConnection sends to a specific connection.
func (h *Hub) SendToConnection(connID string, data []byte) {
	h.broadcast <- &Message{
		ConnectionID: connID,
		Data:         data,
	}
}

// SendToUser sends to all user connections.
func (h *Hub) SendToUser(userID string, data []byte) {
	h.broadcast <- &Message{
		UserID: userID,
		Data:   data,
	}
}

// SendToSession sends to all connections in a session.
func (h *Hub) SendToSession(sessionID string, data []byte) {
	h.broadcast <- &Message{
		SessionID: sessionID,
		Data:      data,
	}
}

// BroadcastAll sends to all connections.
func (h *Hub) BroadcastAll(data []byte) {
	h.broadcast <- &Message{
		Broadcast: true,
		Data:      data,
	}
}

// ConnectionCount returns the number of active connections.
func (h *Hub) ConnectionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.connections)
}

// UserCount returns the number of connected users.
func (h *Hub) UserCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.userConnections)
}

// GetConnection returns a connection by ID.
func (h *Hub) GetConnection(id string) (*Connection, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conn, ok := h.connections[id]
	return conn, ok
}

// GetUserConnections returns all connections for a user.
func (h *Hub) GetUserConnections(userID string) []*Connection {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if conns, ok := h.userConnections[userID]; ok {
		result := make([]*Connection, 0, len(conns))
		for _, conn := range conns {
			result = append(result, conn)
		}
		return result
	}
	return nil
}

// IsUserOnline checks if a user has any active connections.
func (h *Hub) IsUserOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.userConnections[userID]
	return ok
}
