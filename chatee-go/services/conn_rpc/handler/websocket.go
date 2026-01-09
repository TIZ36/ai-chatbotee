package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/services/conn_rpc/biz"
)

// =============================================================================
// WebSocket Upgrader
// =============================================================================

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// TODO: Implement proper origin checking
		return true
	},
}

// =============================================================================
// Message Types
// =============================================================================

// IncomingMessage represents a message from client.
type IncomingMessage struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// OutgoingMessage represents a message to client.
type OutgoingMessage struct {
	Type      string `json:"type"`
	ID        string `json:"id,omitempty"`
	Payload   any    `json:"payload,omitempty"`
	Error     string `json:"error,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// =============================================================================
// Client
// =============================================================================

// Client represents a WebSocket client.
type Client struct {
	conn      *websocket.Conn
	hub       *service.Hub
	hubConn   *service.Connection
	config    config.WebSocketConfig
	logger    log.Logger
	svrClient *service.SVRClient
}

// =============================================================================
// WebSocket Handler
// =============================================================================

// HandleWebSocket handles WebSocket upgrade and communication.
func HandleWebSocket(c *gin.Context, h *service.Hub, cfg config.WebSocketConfig, logger log.Logger, svrClient *service.SVRClient) {
	// Get user info from context/query
	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	sessionID := c.Query("session_id")

	// Upgrade connection
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.Error("Failed to upgrade WebSocket", log.Err(err))
		return
	}

	// Create connection
	hubConn := &service.Connection{
		ID:         uuid.New().String(),
		UserID:     userID,
		SessionID:  sessionID,
		Send:       make(chan []byte, 256),
		Hub:        h,
		JoinedAt:   time.Now(),
		LastActive: time.Now(),
		Metadata:   make(map[string]any),
	}

	// Register with hub
	h.Register(hubConn)

	// Create client
	client := &Client{
		conn:      conn,
		hub:       h,
		hubConn:   hubConn,
		config:    cfg,
		logger:    logger.With(log.String("connection_id", hubConn.ID)),
		svrClient: svrClient,
	}

	// Register connection with user actor in svr_rpc
	if svrClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := svrClient.RegisterConnection(ctx, userID, hubConn.ID); err != nil {
			logger.Warn("Failed to register connection with user actor",
				log.String("user_id", userID),
				log.String("connection_id", hubConn.ID),
				log.Err(err))
		}
	}

	// Send welcome message
	client.sendMessage(OutgoingMessage{
		Type:      "connected",
		ID:        hubConn.ID,
		Timestamp: time.Now().UnixMilli(),
		Payload: map[string]any{
			"connection_id": hubConn.ID,
			"user_id":       userID,
			"session_id":    sessionID,
		},
	})

	// Start read/write pumps
	go client.readPump()
	go client.writePump()
}

// =============================================================================
// Read Pump
// =============================================================================

// readPump reads messages from the WebSocket connection.
func (c *Client) readPump() {
	defer func() {
		c.conn.Close()
		c.hub.Unregister(c.hubConn)

		// Unregister from user actor
		if c.svrClient != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := c.svrClient.UnregisterConnection(ctx, c.hubConn.UserID, c.hubConn.ID); err != nil {
				c.logger.Warn("Failed to unregister connection from user actor", log.Err(err))
			}
		}
	}()

	c.conn.SetReadDeadline(time.Now().Add(c.config.PongWait))
	c.conn.SetReadLimit(int64(c.config.MaxMessageSize))
	c.conn.SetPongHandler(func(string) error {
		c.hubConn.LastActive = time.Now()
		c.conn.SetReadDeadline(time.Now().Add(c.config.PongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.logger.Error("WebSocket read error", log.Err(err))
			}
			break
		}
		c.hubConn.LastActive = time.Now()
		c.handleMessage(message)
	}
}

// =============================================================================
// Write Pump
// =============================================================================

// writePump writes messages to the WebSocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(c.config.PingInterval)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.hubConn.Send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Write queued messages
			n := len(c.hubConn.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.hubConn.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// =============================================================================
// Message Handling
// =============================================================================

// handleMessage processes an incoming message.
func (c *Client) handleMessage(data []byte) {
	var msg IncomingMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		c.sendError("invalid_message", "Invalid JSON format")
		return
	}

	c.logger.Debug("Received message",
		log.String("type", msg.Type),
		log.String("id", msg.ID),
	)

	switch msg.Type {
	case "ping":
		c.sendMessage(OutgoingMessage{
			Type:      "pong",
			ID:        msg.ID,
			Timestamp: time.Now().UnixMilli(),
		})
	case "subscribe":
		c.handleSubscribe(msg)
	case "unsubscribe":
		c.handleUnsubscribe(msg)
	case "message":
		c.handleChatMessage(msg)
	case "typing":
		c.handleTyping(msg)
	default:
		c.sendError("unknown_type", "Unknown message type: "+msg.Type)
	}
}

// handleSubscribe subscribes to a channel/session.
func (c *Client) handleSubscribe(msg IncomingMessage) {
	var payload struct {
		SessionID string `json:"session_id"`
		Channel   string `json:"channel"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		c.sendError("invalid_payload", "Invalid subscribe payload")
		return
	}

	// Update session ID
	if payload.SessionID != "" {
		c.hubConn.SessionID = payload.SessionID
	}

	c.sendMessage(OutgoingMessage{
		Type:      "subscribed",
		ID:        msg.ID,
		Timestamp: time.Now().UnixMilli(),
		Payload: map[string]any{
			"session_id": payload.SessionID,
			"channel":    payload.Channel,
		},
	})
}

// handleUnsubscribe unsubscribes from a channel/session.
func (c *Client) handleUnsubscribe(msg IncomingMessage) {
	c.hubConn.SessionID = ""
	c.sendMessage(OutgoingMessage{
		Type:      "unsubscribed",
		ID:        msg.ID,
		Timestamp: time.Now().UnixMilli(),
	})
}

// handleChatMessage handles a chat message.
func (c *Client) handleChatMessage(msg IncomingMessage) {
	c.logger.Info("Chat message received",
		log.String("user_id", c.hubConn.UserID),
		log.String("session_id", c.hubConn.SessionID),
	)

	// Acknowledge receipt
	c.sendMessage(OutgoingMessage{
		Type:      "message_received",
		ID:        msg.ID,
		Timestamp: time.Now().UnixMilli(),
	})

	// Forward message to user actor via svr_rpc
	if c.svrClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := c.svrClient.SendMessageToUser(ctx, c.hubConn.UserID, msg.Payload); err != nil {
			c.logger.Error("Failed to send message to user actor", log.Err(err))
		}
	}
}

// handleTyping handles typing indicator.
func (c *Client) handleTyping(msg IncomingMessage) {
	var payload struct {
		SessionID string `json:"session_id"`
		IsTyping  bool   `json:"is_typing"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}

	// Broadcast typing status to session
	if payload.SessionID != "" {
		data, _ := json.Marshal(OutgoingMessage{
			Type:      "user_typing",
			Timestamp: time.Now().UnixMilli(),
			Payload: map[string]any{
				"user_id":    c.hubConn.UserID,
				"session_id": payload.SessionID,
				"is_typing":  payload.IsTyping,
			},
		})
		c.hub.SendToSession(payload.SessionID, data)
	}
}

// =============================================================================
// Helper Methods
// =============================================================================

// sendMessage sends a message to the client.
func (c *Client) sendMessage(msg OutgoingMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		c.logger.Error("Failed to marshal message", log.Err(err))
		return
	}

	select {
	case c.hubConn.Send <- data:
	default:
		c.logger.Warn("Send buffer full")
	}
}

// sendError sends an error message.
func (c *Client) sendError(code, message string) {
	c.sendMessage(OutgoingMessage{
		Type:      "error",
		Timestamp: time.Now().UnixMilli(),
		Payload: map[string]any{
			"code":    code,
			"message": message,
		},
	})
}
