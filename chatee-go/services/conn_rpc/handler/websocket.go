package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/gen/common"
	imchat "chatee-go/gen/im/chat/im"
	imthread "chatee-go/gen/im/thread/im"
	"chatee-go/services/conn_rpc/biz"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// =============================================================================
// WebSocket Upgrader
// =============================================================================

// createUpgrader creates a WebSocket upgrader with origin checking
func createUpgrader(cfg config.WebSocketConfig) websocket.Upgrader {
	allowedOrigins := make(map[string]bool)
	for _, origin := range cfg.AllowedOrigins {
		allowedOrigins[origin] = true
	}

	return websocket.Upgrader{
		ReadBufferSize:  cfg.ReadBufferSize,
		WriteBufferSize: cfg.WriteBufferSize,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				// No origin header, allow (for non-browser clients)
				return true
			}

			// Check if "*" is in allowed origins (allow all)
			if allowedOrigins["*"] {
				return true
			}

			// Check if exact origin is allowed
			if allowedOrigins[origin] {
				return true
			}

			// Check if any allowed origin matches (supports wildcards)
			for allowedOrigin := range allowedOrigins {
				if matchOrigin(origin, allowedOrigin) {
					return true
				}
			}

			return false
		},
	}
}

// matchOrigin checks if an origin matches a pattern (supports wildcards)
func matchOrigin(origin, pattern string) bool {
	if pattern == "*" {
		return true
	}
	if pattern == origin {
		return true
	}
	// Simple wildcard matching: "*.example.com" matches "sub.example.com"
	if strings.HasPrefix(pattern, "*.") {
		domain := pattern[2:]
		return strings.HasSuffix(origin, domain) && len(origin) > len(domain)
	}
	return false
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
	conn         *websocket.Conn
	hub          *service.Hub
	hubConn      *service.Connection
	config       config.WebSocketConfig
	logger       log.Logger
	svrClient    *service.SVRClient
	imClient     *service.IMClient
	requestCount int64              // Request counter for rate limiting
	lastRequest  time.Time          // Last request time for rate limiting
	requestMap   map[string]time.Time // Map of request IDs to timestamps for tracking
}

// =============================================================================
// WebSocket Handler
// =============================================================================

// HandleWebSocket handles WebSocket upgrade and communication.
func HandleWebSocket(c *gin.Context, h *service.Hub, cfg config.WebSocketConfig, logger log.Logger, svrClient *service.SVRClient, imClient *service.IMClient) {
	// Get user info from context/query
	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	sessionID := c.Query("session_id")

	// Create upgrader with origin checking
	upgrader := createUpgrader(cfg)

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
		conn:        conn,
		hub:         h,
		hubConn:     hubConn,
		config:      cfg,
		logger:      logger.With(log.String("connection_id", hubConn.ID)),
		svrClient:   svrClient,
		imClient:    imClient,
		requestMap:  make(map[string]time.Time),
		lastRequest: time.Now(),
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
		c.sendErrorWithID("", "invalid_message", "Invalid JSON format")
		return
	}

	// Rate limiting: Check if too many requests in a short time
	now := time.Now()
	if now.Sub(c.lastRequest) < 100*time.Millisecond {
		c.requestCount++
		if c.requestCount > 10 {
			c.sendErrorWithID(msg.ID, "rate_limit_exceeded", "Too many requests, please slow down")
			return
		}
	} else {
		c.requestCount = 1
	}
	c.lastRequest = now

	// Track request ID for response matching
	if msg.ID != "" {
		c.requestMap[msg.ID] = now
		// Clean up old request IDs (older than 1 minute)
		for id, timestamp := range c.requestMap {
			if now.Sub(timestamp) > time.Minute {
				delete(c.requestMap, id)
			}
		}
	}

	// Validate message type
	if msg.Type == "" {
		c.sendErrorWithID(msg.ID, "invalid_message", "Message type is required")
		return
	}

	c.logger.Debug("Received message",
		log.String("type", msg.Type),
		log.String("id", msg.ID),
		log.String("user_id", c.hubConn.UserID),
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
	case "send_message":
		c.handleSendMessage(msg)
	case "agent_chat":
		c.handleAgentChat(msg)
	case "agent_stream":
		c.handleAgentStream(msg)
	case "mark_read":
		c.handleMarkAsRead(msg)
	case "typing":
		c.handleTyping(msg)
	default:
		c.sendErrorWithID(msg.ID, "unknown_type", "Unknown message type: "+msg.Type)
	}
}

// handleSubscribe subscribes to a channel/session.
func (c *Client) handleSubscribe(msg IncomingMessage) {
	var payload struct {
		SessionID string `json:"session_id"`
		Channel   string `json:"channel"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		c.sendErrorWithID(msg.ID, "invalid_payload", "Invalid subscribe payload")
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

// handleSendMessage handles sending a message to thread or chat
func (c *Client) handleSendMessage(msg IncomingMessage) {
	var payload struct {
		Type      string `json:"type"`       // "thread" or "chat"
		ThreadID  string `json:"thread_id,omitempty"`
		ChatKey   string `json:"chat_key,omitempty"`
		Content   string `json:"content"`
		ContentType string `json:"content_type,omitempty"`
		ParentMsgID string `json:"parent_msg_id,omitempty"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		c.sendErrorWithID(msg.ID, "invalid_payload", "Invalid send_message payload")
		return
	}

	if c.imClient == nil {
		c.sendErrorWithID(msg.ID, "service_unavailable", "IM service not available")
		return
	}

	if payload.Type == "thread" {
		// Send to thread
		if payload.ThreadID == "" {
			c.sendErrorWithID(msg.ID, "invalid_request", "thread_id is required for thread messages")
			return
		}

		// Build BaseMessage
		baseMsg := &common.BaseMessage{
			AuthorId:    c.hubConn.UserID,
			AuthorType:  common.AuthorType_USER,
			ContentType: common.ContentType_TEXT,
			RawContent:  []byte(payload.Content),
			Timestamp:   time.Now().UnixMilli(),
		}
		if payload.ContentType != "" {
			switch payload.ContentType {
			case "image":
				baseMsg.ContentType = common.ContentType_IMAGE
			case "video":
				baseMsg.ContentType = common.ContentType_VIDEO
			case "file":
				baseMsg.ContentType = common.ContentType_FILE
			case "audio":
				baseMsg.ContentType = common.ContentType_AUDIO
			default:
				baseMsg.ContentType = common.ContentType_TEXT
			}
		}

		// Call IM ThreadService.Reply
		ctx := context.Background()
		replyReq := &imthread.ReplyRequest{
			ReplierId:   c.hubConn.UserID,
			ThreadId:    payload.ThreadID,
			ParentMsgId: payload.ParentMsgID,
			Message:     baseMsg,
		}

		resp, err := c.imClient.ThreadClient().Reply(ctx, replyReq)
		if err != nil {
			c.logger.Error("Failed to send thread message", log.Err(err),
				log.String("thread_id", payload.ThreadID),
				log.String("user_id", c.hubConn.UserID))
			if status.Code(err) == codes.NotFound {
				c.sendErrorWithID(msg.ID, "not_found", "Thread not found")
			} else {
				c.sendErrorWithID(msg.ID, "internal_error", "Failed to send message")
			}
			return
		}

		c.sendMessage(OutgoingMessage{
			Type:      "message_sent",
			ID:        msg.ID,
			Timestamp: time.Now().UnixMilli(),
			Payload: map[string]any{
				"type":      "thread",
				"thread_id": payload.ThreadID,
				"msg_id":    resp.MsgId,
				"timestamp": resp.Timestamp,
			},
		})
	} else if payload.Type == "chat" {
		// Send to chat
		if payload.ChatKey == "" {
			c.sendErrorWithID(msg.ID, "invalid_request", "chat_key is required for chat messages")
			return
		}

		// Build BaseMessage
		baseMsg := &common.BaseMessage{
			AuthorId:    c.hubConn.UserID,
			AuthorType:  common.AuthorType_USER,
			ContentType: common.ContentType_TEXT,
			RawContent:  []byte(payload.Content),
			Timestamp:   time.Now().UnixMilli(),
		}
		if payload.ContentType != "" {
			switch payload.ContentType {
			case "image":
				baseMsg.ContentType = common.ContentType_IMAGE
			case "video":
				baseMsg.ContentType = common.ContentType_VIDEO
			case "file":
				baseMsg.ContentType = common.ContentType_FILE
			case "audio":
				baseMsg.ContentType = common.ContentType_AUDIO
			default:
				baseMsg.ContentType = common.ContentType_TEXT
			}
		}

		// Call IM ChatService.SendMessage
		ctx := context.Background()
		sendReq := &imchat.SendMessageRequest{
			ChatKey:  payload.ChatKey,
			SenderId: c.hubConn.UserID,
			Message:  baseMsg,
		}

		resp, err := c.imClient.ChatClient().SendMessage(ctx, sendReq)
		if err != nil {
			c.logger.Error("Failed to send chat message", log.Err(err),
				log.String("chat_key", payload.ChatKey),
				log.String("user_id", c.hubConn.UserID))
			if status.Code(err) == codes.NotFound {
				c.sendErrorWithID(msg.ID, "not_found", "Chat not found")
			} else {
				c.sendErrorWithID(msg.ID, "internal_error", "Failed to send message")
			}
			return
		}

		c.sendMessage(OutgoingMessage{
			Type:      "message_sent",
			ID:        msg.ID,
			Timestamp: time.Now().UnixMilli(),
			Payload: map[string]any{
				"type":     "chat",
				"chat_key": payload.ChatKey,
				"msg_id":   resp.MsgId,
				"timestamp": resp.Timestamp,
			},
		})
	} else {
		c.sendErrorWithID(msg.ID, "invalid_type", "type must be 'thread' or 'chat'")
	}
}

// handleAgentChat handles agent chat requests
func (c *Client) handleAgentChat(msg IncomingMessage) {
	var payload struct {
		SessionID string `json:"session_id"`
		AgentID   string `json:"agent_id"`
		Content   string `json:"content"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		c.sendErrorWithID(msg.ID, "invalid_payload", "Invalid agent_chat payload")
		return
	}

	if c.svrClient == nil {
		c.sendErrorWithID(msg.ID, "service_unavailable", "SVR service not available")
		return
	}

	// TODO: Implement agent chat via SVR AgentService
	c.logger.Info("Agent chat not yet implemented",
		log.String("agent_id", payload.AgentID),
		log.String("session_id", payload.SessionID),
		log.String("user_id", c.hubConn.UserID))

	c.sendMessage(OutgoingMessage{
		Type:      "agent_response",
		ID:        msg.ID,
		Timestamp: time.Now().UnixMilli(),
		Payload: map[string]any{
			"session_id": payload.SessionID,
			"agent_id":   payload.AgentID,
			"content":    "Agent chat not yet implemented",
		},
	})
}

// handleAgentStream handles agent streaming requests
func (c *Client) handleAgentStream(msg IncomingMessage) {
	var payload struct {
		SessionID string `json:"session_id"`
		AgentID   string `json:"agent_id"`
		Content   string `json:"content"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		c.sendErrorWithID(msg.ID, "invalid_payload", "Invalid agent_stream payload")
		return
	}

	if c.svrClient == nil {
		c.sendErrorWithID(msg.ID, "service_unavailable", "SVR service not available")
		return
	}

	// TODO: Implement agent streaming via SVR AgentService
	c.logger.Info("Agent streaming not yet implemented",
		log.String("agent_id", payload.AgentID),
		log.String("session_id", payload.SessionID),
		log.String("user_id", c.hubConn.UserID))

	// For now, send a single response
	c.sendMessage(OutgoingMessage{
		Type:      "agent_stream_chunk",
		ID:        msg.ID,
		Timestamp: time.Now().UnixMilli(),
		Payload: map[string]any{
			"session_id": payload.SessionID,
			"agent_id":   payload.AgentID,
			"chunk":      "Agent streaming not yet implemented",
			"done":       true,
		},
	})
}

// handleMarkAsRead handles mark as read requests
func (c *Client) handleMarkAsRead(msg IncomingMessage) {
	var payload struct {
		Type      string   `json:"type"`       // "thread" or "chat"
		ThreadID  string   `json:"thread_id,omitempty"`
		ChatKey   string   `json:"chat_key,omitempty"`
		MsgIDs    []string `json:"msg_ids,omitempty"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		c.sendErrorWithID(msg.ID, "invalid_payload", "Invalid mark_read payload")
		return
	}

	if c.imClient == nil {
		c.sendErrorWithID(msg.ID, "service_unavailable", "IM service not available")
		return
	}

	ctx := context.Background()

	if payload.Type == "thread" {
		if payload.ThreadID == "" {
			c.sendErrorWithID(msg.ID, "invalid_request", "thread_id is required")
			return
		}

		// Call IM ThreadService.MarkAsRead
		markReq := &imthread.MarkAsReadRequest{
			UserId:   c.hubConn.UserID,
			ThreadId: payload.ThreadID,
			MsgIds:   payload.MsgIDs,
		}

		resp, err := c.imClient.ThreadClient().MarkAsRead(ctx, markReq)
		if err != nil {
			c.logger.Error("Failed to mark thread as read", log.Err(err),
				log.String("thread_id", payload.ThreadID),
				log.String("user_id", c.hubConn.UserID))
			c.sendErrorWithID(msg.ID, "internal_error", "Failed to mark as read")
			return
		}

		c.sendMessage(OutgoingMessage{
			Type:      "marked_as_read",
			ID:        msg.ID,
			Timestamp: time.Now().UnixMilli(),
			Payload: map[string]any{
				"type":         "thread",
				"thread_id":    payload.ThreadID,
				"marked_count": resp.MarkedCount,
			},
		})
	} else if payload.Type == "chat" {
		if payload.ChatKey == "" {
			c.sendErrorWithID(msg.ID, "invalid_request", "chat_key is required")
			return
		}

		// Call IM ChatService.MarkAsRead
		markReq := &imchat.MarkAsReadRequest{
			UserId:  c.hubConn.UserID,
			ChatKey: payload.ChatKey,
		}
		if len(payload.MsgIDs) > 0 {
			markReq.MsgId = payload.MsgIDs[0] // Use first msg_id if provided
		}

		resp, err := c.imClient.ChatClient().MarkAsRead(ctx, markReq)
		if err != nil {
			c.logger.Error("Failed to mark chat as read", log.Err(err),
				log.String("chat_key", payload.ChatKey),
				log.String("user_id", c.hubConn.UserID))
			c.sendErrorWithID(msg.ID, "internal_error", "Failed to mark as read")
			return
		}

		c.sendMessage(OutgoingMessage{
			Type:      "marked_as_read",
			ID:        msg.ID,
			Timestamp: time.Now().UnixMilli(),
			Payload: map[string]any{
				"type":         "chat",
				"chat_key":     payload.ChatKey,
				"marked_count": resp.MarkedCount,
			},
		})
	} else {
		c.sendErrorWithID(msg.ID, "invalid_type", "type must be 'thread' or 'chat'")
		return
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
	c.sendErrorWithID("", code, message)
}

// sendErrorWithID sends an error message with a request ID for tracking.
func (c *Client) sendErrorWithID(requestID, code, message string) {
	c.sendMessage(OutgoingMessage{
		Type:      "error",
		ID:        requestID,
		Timestamp: time.Now().UnixMilli(),
		Error:     message,
		Payload: map[string]any{
			"code":    code,
			"message": message,
		},
	})
}
