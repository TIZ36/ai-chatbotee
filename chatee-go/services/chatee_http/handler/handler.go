package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	dbc "chatee-go/gen/dbc"
	imchat "chatee-go/gen/im/chat/im"
	imthread "chatee-go/gen/im/thread/im"
	svrllm "chatee-go/gen/svr/llm/svr"
	svrmcp "chatee-go/gen/svr/mcp/svr"
	svruser "chatee-go/gen/svr/user/svr"
	service "chatee-go/services/chatee_http/biz"
	"google.golang.org/grpc/codes"
)

// =============================================================================
// Handler
// =============================================================================

// Handler handles HTTP requests.
type Handler struct {
	service *service.HTTPService
	logger  log.Logger
}

// NewHandler creates a new handler.
func NewHandler(svc *service.HTTPService, logger log.Logger) *Handler {
	return &Handler{
		service: svc,
		logger:  logger,
	}
}

// =============================================================================
// Health Endpoints
// =============================================================================

// Health returns service health status.
func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"service": "chatee_http",
	})
}

// Ready returns service readiness status.
func (h *Handler) Ready(c *gin.Context) {
	// Check gRPC connection states synchronously (no timeout needed for GetState)

	status := gin.H{
		"status":  "ready",
		"service": "chatee_http",
		"checks":  make(map[string]interface{}),
	}

	checks := status["checks"].(map[string]interface{})

	// Check DBC service
	if h.service.DBCConn != nil {
		state := h.service.DBCConn.GetState()
		checks["dbc"] = gin.H{
			"status": state.String(),
			"ready":  state == connectivity.Ready || state == connectivity.Idle,
		}
	} else {
		checks["dbc"] = gin.H{
			"status": "not_initialized",
			"ready":  false,
		}
	}

	// Check SVR service
	if h.service.SVRConn != nil {
		state := h.service.SVRConn.GetState()
		checks["svr"] = gin.H{
			"status": state.String(),
			"ready":  state == connectivity.Ready || state == connectivity.Idle,
		}
	} else {
		checks["svr"] = gin.H{
			"status": "not_initialized",
			"ready":  false,
		}
	}

	// Check IM service
	if h.service.IMConn != nil {
		state := h.service.IMConn.GetState()
		checks["im"] = gin.H{
			"status": state.String(),
			"ready":  state == connectivity.Ready || state == connectivity.Idle,
		}
	} else {
		checks["im"] = gin.H{
			"status": "not_initialized",
			"ready":  false,
		}
	}

	// Check Conn service (WebSocket) - optional
	if h.service.ConnConn != nil {
		state := h.service.ConnConn.GetState()
		checks["conn"] = gin.H{
			"status": state.String(),
			"ready":  state == connectivity.Ready || state == connectivity.Idle,
		}
	} else {
		checks["conn"] = gin.H{
			"status": "not_initialized",
			"ready":  false,
			"note":   "optional",
		}
	}

	// Determine overall readiness
	allReady := true
	for _, check := range checks {
		if checkMap, ok := check.(gin.H); ok {
			if ready, ok := checkMap["ready"].(bool); ok && !ready {
				// Skip optional services
				if note, ok := checkMap["note"].(string); ok && note == "optional" {
					continue
				}
				allReady = false
				break
			}
		}
	}

	if !allReady {
		c.JSON(http.StatusServiceUnavailable, status)
		return
	}

	c.JSON(http.StatusOK, status)
}

// =============================================================================
// Auth Endpoints
// =============================================================================

// LoginRequest represents a login request.
type LoginRequest struct {
	Email string `json:"email" binding:"required,email"`
	Token string `json:"token,omitempty"` // Optional API key/token for authentication
}

// LoginResponse represents a login response.
type LoginResponse struct {
	User         *UserInfo      `json:"user"`
	AccessToken  string         `json:"access_token"`
	RefreshToken string         `json:"refresh_token"`
	ExpiresIn    int64          `json:"expires_in"` // seconds
	Connection   *ConnectionInfo `json:"connection"`
}

// UserInfo represents user information.
type UserInfo struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
	Role  string `json:"role"`
}

// ConnectionInfo represents connection information for WebSocket.
type ConnectionInfo struct {
	WebSocketURL string `json:"websocket_url"`
	WSSURL       string `json:"wss_url,omitempty"`
}

// Login handles user login.
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()

	// Get user by email from DBC service
	dbcUser, err := h.service.DBCUser.GetUserByEmail(ctx, &dbc.GetUserByEmailRequest{
		Email: req.Email,
	})
	if err != nil {
		if status.Code(err) == 5 { // NotFound
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or token"})
			return
		}
		h.logger.Error("Failed to get user by email", log.Err(err), log.String("email", req.Email))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// TODO: Validate token if provided (for API key authentication)
	// For now, we just verify the user exists

	// Generate tokens
	accessToken, err := generateToken()
	if err != nil {
		h.logger.Error("Failed to generate access token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	refreshToken, err := generateToken()
	if err != nil {
		h.logger.Error("Failed to generate refresh token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Store tokens in Redis (via DBC Cache service)
	accessTokenKey := fmt.Sprintf("auth:access:%s", accessToken)
	refreshTokenKey := fmt.Sprintf("auth:refresh:%s", refreshToken)
	accessTokenTTL := 24 * time.Hour
	refreshTokenTTL := 7 * 24 * time.Hour

	// Store access token (user ID as value)
	if _, err := h.service.DBCCache.Set(ctx, &dbc.SetRequest{
		Key:        accessTokenKey,
		Value:      dbcUser.Id,
		TtlSeconds: int64(accessTokenTTL.Seconds()),
	}); err != nil {
		h.logger.Error("Failed to store access token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Store refresh token (user ID as value)
	if _, err := h.service.DBCCache.Set(ctx, &dbc.SetRequest{
		Key:        refreshTokenKey,
		Value:      dbcUser.Id,
		TtlSeconds: int64(refreshTokenTTL.Seconds()),
	}); err != nil {
		h.logger.Error("Failed to store refresh token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Get user status from SVR service (for connection info)
	var connectionInfo *ConnectionInfo
	if h.service.SVRUser != nil {
		userStatus, err := h.service.SVRUser.GetUserStatus(ctx, &svruser.GetUserStatusRequest{
			UserId: dbcUser.Id,
		})
		if err == nil && userStatus != nil {
			// Build WebSocket URLs based on config
			wsHost := h.service.Config.HTTP.Host
			wsPort := h.service.Config.HTTP.Port + 1 // WS port is HTTP port + 1
			connectionInfo = &ConnectionInfo{
				WebSocketURL: fmt.Sprintf("ws://%s:%d/ws", wsHost, wsPort),
				WSSURL:       fmt.Sprintf("wss://%s:%d/wss", wsHost, wsPort),
			}
		}
	}

	// Build response
	response := LoginResponse{
		User: &UserInfo{
			ID:    dbcUser.Id,
			Email: dbcUser.Email,
			Name:  dbcUser.Name,
			Avatar: dbcUser.Avatar,
			Role:  dbcUser.Role,
		},
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(accessTokenTTL.Seconds()),
		Connection:   connectionInfo,
	}

	c.JSON(http.StatusOK, response)
}

// LogoutRequest represents a logout request.
type LogoutRequest struct {
	AccessToken string `json:"access_token"`
}

// Logout handles user logout.
func (h *Handler) Logout(c *gin.Context) {
	var req LogoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()

	// Delete access token from Redis
	accessTokenKey := fmt.Sprintf("auth:access:%s", req.AccessToken)
	if _, err := h.service.DBCCache.Delete(ctx, &dbc.DeleteRequest{
		Key: accessTokenKey,
	}); err != nil {
		h.logger.Error("Failed to delete access token", log.Err(err))
		// Continue anyway
	}

	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

// RefreshTokenRequest represents a refresh token request.
type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// RefreshTokenResponse represents a refresh token response.
type RefreshTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"` // seconds
}

// RefreshToken refreshes auth token.
func (h *Handler) RefreshToken(c *gin.Context) {
	var req RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()

	// Get user ID from refresh token
	refreshTokenKey := fmt.Sprintf("auth:refresh:%s", req.RefreshToken)
	userIDResp, err := h.service.DBCCache.Get(ctx, &dbc.GetRequest{
		Key: refreshTokenKey,
	})
	if err != nil || !userIDResp.Exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid refresh token"})
		return
	}

	userID := userIDResp.Value

	// Generate new tokens
	accessToken, err := generateToken()
	if err != nil {
		h.logger.Error("Failed to generate access token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	newRefreshToken, err := generateToken()
	if err != nil {
		h.logger.Error("Failed to generate refresh token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Store new tokens
	accessTokenKey := fmt.Sprintf("auth:access:%s", accessToken)
	accessTokenTTL := 24 * time.Hour
	refreshTokenTTL := 7 * 24 * time.Hour

	if _, err := h.service.DBCCache.Set(ctx, &dbc.SetRequest{
		Key:        accessTokenKey,
		Value:      userID,
		TtlSeconds: int64(accessTokenTTL.Seconds()),
	}); err != nil {
		h.logger.Error("Failed to store access token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Update refresh token
	newRefreshTokenKey := fmt.Sprintf("auth:refresh:%s", newRefreshToken)
	if _, err := h.service.DBCCache.Set(ctx, &dbc.SetRequest{
		Key:        newRefreshTokenKey,
		Value:      userID,
		TtlSeconds: int64(refreshTokenTTL.Seconds()),
	}); err != nil {
		h.logger.Error("Failed to store refresh token", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Delete old refresh token
	if _, err := h.service.DBCCache.Delete(ctx, &dbc.DeleteRequest{
		Key: refreshTokenKey,
	}); err != nil {
		h.logger.Warn("Failed to delete old refresh token", log.Err(err))
		// Continue anyway
	}

	response := RefreshTokenResponse{
		AccessToken:  accessToken,
		RefreshToken: newRefreshToken,
		ExpiresIn:    int64(accessTokenTTL.Seconds()),
	}

	c.JSON(http.StatusOK, response)
}

// generateToken generates a random token.
func generateToken() (string, error) {
	bytes := make([]byte, 32) // 256 bits
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// parseInt parses a string to int.
func parseInt(s string) (int, error) {
	return strconv.Atoi(s)
}

// =============================================================================
// Incremental Sync Endpoints (for reconnection)
// =============================================================================

// GetIncrementalMessagesRequest represents an incremental messages request.
type GetIncrementalMessagesRequest struct {
	UserID        string `json:"user_id" binding:"required"`
	SinceTimestamp int64  `json:"since_timestamp" binding:"required"`
	Limit         int32  `json:"limit,omitempty"`
}

// GetIncrementalMessages returns incremental messages since a timestamp.
func (h *Handler) GetIncrementalMessages(c *gin.Context) {
	var req GetIncrementalMessagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	ctx := c.Request.Context()

	// Get incremental messages from follow feed and reply inbox
	// This is a simplified implementation - in production, you might want to
	// combine results from multiple sources and deduplicate

	// Get follow feed updates
	followFeedResp, err := h.service.IMThread.GetUserFeed(ctx, &imthread.GetUserFeedRequest{
		UserId: req.UserID,
		Limit:  limit,
	})
	if err != nil {
		h.logger.Error("Failed to get follow feed for incremental sync", log.Err(err))
	}

	// Get reply inbox updates
	replyInboxResp, err := h.service.IMThread.GetReplyInbox(ctx, &imthread.GetReplyInboxRequest{
		UserId: req.UserID,
		Limit:  limit,
	})
	if err != nil {
		h.logger.Error("Failed to get reply inbox for incremental sync", log.Err(err))
	}

	// Filter by since_timestamp
	followItems := make([]*imthread.FeedItem, 0)
	if followFeedResp != nil {
		for _, item := range followFeedResp.Items {
			if item.Timestamp >= req.SinceTimestamp {
				followItems = append(followItems, item)
			}
		}
	}

	replyItems := make([]*imthread.ReplyItem, 0)
	if replyInboxResp != nil {
		for _, item := range replyInboxResp.Items {
			if item.Timestamp >= req.SinceTimestamp {
				replyItems = append(replyItems, item)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"follow_feed": followItems,
		"reply_inbox": replyItems,
		"timestamp":   time.Now().Unix(),
	})
}

// GetUnreadCountsRequest represents an unread counts request.
type GetUnreadCountsRequest struct {
	UserID string `json:"user_id" binding:"required"`
}

// GetUnreadCounts returns unread message counts.
func (h *Handler) GetUnreadCounts(c *gin.Context) {
	var req GetUnreadCountsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()

	// Get unread counts from follow feed and reply inbox
	// This is a simplified implementation - in production, you might want to
	// use Redis to cache unread counts

	// Get follow feed (to count unread threads)
	followFeedResp, err := h.service.IMThread.GetUserFeed(ctx, &imthread.GetUserFeedRequest{
		UserId: req.UserID,
		Limit:  1000, // Get a large batch to count unread
	})
	followUnread := int32(0)
	if err == nil && followFeedResp != nil {
		for _, item := range followFeedResp.Items {
			if !item.Read {
				followUnread++
			}
		}
	}

	// Get reply inbox (to count unread replies)
	replyInboxResp, err := h.service.IMThread.GetReplyInbox(ctx, &imthread.GetReplyInboxRequest{
		UserId: req.UserID,
		Limit:  1000,
	})
	replyUnread := int32(0)
	if err == nil && replyInboxResp != nil {
		for _, item := range replyInboxResp.Items {
			if !item.Read {
				replyUnread++
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"follow_feed_unread": followUnread,
		"reply_inbox_unread": replyUnread,
		"total_unread":       followUnread + replyUnread,
	})
}

// GetUnreadMessagesRequest represents an unread messages request.
type GetUnreadMessagesRequest struct {
	UserID string `json:"user_id" binding:"required"`
	Limit  int32  `json:"limit,omitempty"`
}

// GetUnreadMessages returns unread messages.
func (h *Handler) GetUnreadMessages(c *gin.Context) {
	var req GetUnreadMessagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	ctx := c.Request.Context()

	// Get unread messages from follow feed and reply inbox
	followFeedResp, err := h.service.IMThread.GetUserFeed(ctx, &imthread.GetUserFeedRequest{
		UserId: req.UserID,
		Limit:  limit,
	})
	if err != nil {
		h.logger.Error("Failed to get unread follow feed", log.Err(err))
	}

	replyInboxResp, err := h.service.IMThread.GetReplyInbox(ctx, &imthread.GetReplyInboxRequest{
		UserId: req.UserID,
		Limit:  limit,
	})
	if err != nil {
		h.logger.Error("Failed to get unread reply inbox", log.Err(err))
	}

	// Filter unread items
	followUnread := make([]*imthread.FeedItem, 0)
	if followFeedResp != nil {
		for _, item := range followFeedResp.Items {
			if !item.Read {
				followUnread = append(followUnread, item)
			}
		}
	}

	replyUnread := make([]*imthread.ReplyItem, 0)
	if replyInboxResp != nil {
		for _, item := range replyInboxResp.Items {
			if !item.Read {
				replyUnread = append(replyUnread, item)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"follow_feed": followUnread,
		"reply_inbox": replyUnread,
	})
}

// =============================================================================
// User Endpoints
// =============================================================================

// GetUser returns a user by ID.
func (h *Handler) GetUser(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	ctx := c.Request.Context()
	user, err := h.service.DBCUser.GetUser(ctx, &dbc.GetUserRequest{Id: id})
	if err != nil {
		if status.Code(err) == 5 { // NotFound
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("Failed to get user", log.Err(err), log.String("user_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         user.Id,
		"email":      user.Email,
		"name":       user.Name,
		"avatar":     user.Avatar,
		"role":       user.Role,
		"preferences": user.Preferences,
		"metadata":   user.Metadata,
		"created_at": user.CreatedAt,
		"updated_at": user.UpdatedAt,
	})
}

// UpdateUser updates a user.
func (h *Handler) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	var req struct {
		Name        string          `json:"name,omitempty"`
		Avatar      string          `json:"avatar,omitempty"`
		Role        string          `json:"role,omitempty"`
		Preferences json.RawMessage `json:"preferences,omitempty"`
		Metadata    json.RawMessage `json:"metadata,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	updateReq := &dbc.UpdateUserRequest{
		Id:   id,
		Name: req.Name,
		Avatar: req.Avatar,
		Role: req.Role,
	}
	if len(req.Preferences) > 0 {
		updateReq.Preferences = req.Preferences
	}
	if len(req.Metadata) > 0 {
		updateReq.Metadata = req.Metadata
	}

	user, err := h.service.DBCUser.UpdateUser(ctx, updateReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("Failed to update user", log.Err(err), log.String("user_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         user.Id,
		"email":      user.Email,
		"name":       user.Name,
		"avatar":     user.Avatar,
		"role":       user.Role,
		"preferences": user.Preferences,
		"metadata":   user.Metadata,
		"created_at": user.CreatedAt,
		"updated_at": user.UpdatedAt,
	})
}

// GetUserSessions returns user's sessions.
func (h *Handler) GetUserSessions(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	// Parse pagination params
	offset := 0
	limit := 20
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := parseInt(offsetStr); err == nil {
			offset = o
		}
	}
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	ctx := c.Request.Context()
	resp, err := h.service.DBCSession.GetSessionsByUser(ctx, &dbc.GetSessionsByUserRequest{
		UserId: userID,
		Offset: int32(offset),
		Limit:  int32(limit),
	})
	if err != nil {
		h.logger.Error("Failed to get user sessions", log.Err(err), log.String("user_id", userID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	sessions := make([]gin.H, 0, len(resp.Sessions))
	for _, session := range resp.Sessions {
		sessions = append(sessions, gin.H{
			"id":         session.Id,
			"user_id":    session.UserId,
			"agent_id":   session.AgentId,
			"title":      session.Title,
			"status":     session.Status,
			"metadata":   session.Metadata,
			"created_at": session.CreatedAt,
			"updated_at": session.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"sessions": sessions,
		"total":    resp.Total,
	})
}

// GetUserAgents returns user's agents.
func (h *Handler) GetUserAgents(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	ctx := c.Request.Context()
	agents, err := h.service.DBCAgent.GetAgentsByUser(ctx, &dbc.GetAgentsByUserRequest{UserId: userID})
	if err != nil {
		h.logger.Error("Failed to get user agents", log.Err(err), log.String("user_id", userID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"agents": agents.Agents})
}

// GetFollowFeed returns user's follow feed (threads they follow).
func (h *Handler) GetFollowFeed(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	limit := int32(20)
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}
	cursor := c.Query("cursor")

	ctx := c.Request.Context()
	resp, err := h.service.IMThread.GetUserFeed(ctx, &imthread.GetUserFeedRequest{
		UserId: userID,
		Limit:  limit,
		Cursor: cursor,
	})
	if err != nil {
		h.logger.Error("Failed to get follow feed", log.Err(err), log.String("user_id", userID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":      resp.Items,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// GetReplyInbox returns user's reply inbox.
func (h *Handler) GetReplyInbox(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	limit := int32(20)
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}
	cursor := c.Query("cursor")

	ctx := c.Request.Context()
	resp, err := h.service.IMThread.GetReplyInbox(ctx, &imthread.GetReplyInboxRequest{
		UserId: userID,
		Limit:  limit,
		Cursor: cursor,
	})
	if err != nil {
		h.logger.Error("Failed to get reply inbox", log.Err(err), log.String("user_id", userID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":      resp.Items,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// GetUserConnections returns user's connection information.
func (h *Handler) GetUserConnections(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	ctx := c.Request.Context()
	if h.service.SVRUser == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "User service not available"})
		return
	}

	status, err := h.service.SVRUser.GetUserStatus(ctx, &svruser.GetUserStatusRequest{
		UserId: userID,
	})
	if err != nil {
		h.logger.Error("Failed to get user status", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":     status.UserId,
		"online":      status.Online,
		"connections": status.Connections,
		"last_seen":   status.LastSeen,
		"active_chats": status.ActiveChats,
	})
}

// GetConnectionStatus returns connection status for a user.
func (h *Handler) GetConnectionStatus(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user id is required"})
		return
	}

	// This is the same as GetUserConnections, but with a different endpoint name
	h.GetUserConnections(c)
}

// =============================================================================
// Session Endpoints
// =============================================================================

// CreateSession creates a new session.
func (h *Handler) CreateSession(c *gin.Context) {
	var req struct {
		UserID  string          `json:"user_id" binding:"required"`
		AgentID string          `json:"agent_id" binding:"required"`
		Title   string          `json:"title,omitempty"`
		Metadata json.RawMessage `json:"metadata,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	session, err := h.service.DBCSession.CreateSession(ctx, &dbc.CreateSessionRequest{
		UserId:   req.UserID,
		AgentId:  req.AgentID,
		Title:    req.Title,
		Metadata: req.Metadata,
	})
	if err != nil {
		h.logger.Error("Failed to create session", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":         session.Id,
		"user_id":    session.UserId,
		"agent_id":   session.AgentId,
		"title":      session.Title,
		"status":     session.Status,
		"metadata":   session.Metadata,
		"created_at": session.CreatedAt,
		"updated_at": session.UpdatedAt,
	})
}

// GetSession returns a session by ID.
func (h *Handler) GetSession(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id is required"})
		return
	}

	ctx := c.Request.Context()
	session, err := h.service.DBCSession.GetSession(ctx, &dbc.GetSessionRequest{Id: id})
	if err != nil {
		if status.Code(err) == 5 { // NotFound
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("Failed to get session", log.Err(err), log.String("session_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         session.Id,
		"user_id":    session.UserId,
		"agent_id":   session.AgentId,
		"title":      session.Title,
		"status":     session.Status,
		"metadata":   session.Metadata,
		"created_at": session.CreatedAt,
		"updated_at": session.UpdatedAt,
	})
}

// UpdateSession updates a session.
func (h *Handler) UpdateSession(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id is required"})
		return
	}

	var req struct {
		Title    string          `json:"title,omitempty"`
		Status   string          `json:"status,omitempty"`
		Metadata json.RawMessage `json:"metadata,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	updateReq := &dbc.UpdateSessionRequest{
		Id:     id,
		Title:  req.Title,
		Status: req.Status,
	}
	if len(req.Metadata) > 0 {
		updateReq.Metadata = req.Metadata
	}

	session, err := h.service.DBCSession.UpdateSession(ctx, updateReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("Failed to update session", log.Err(err), log.String("session_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         session.Id,
		"user_id":    session.UserId,
		"agent_id":   session.AgentId,
		"title":      session.Title,
		"status":     session.Status,
		"metadata":   session.Metadata,
		"created_at": session.CreatedAt,
		"updated_at": session.UpdatedAt,
	})
}

// DeleteSession deletes a session.
func (h *Handler) DeleteSession(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.DBCSession.DeleteSession(ctx, &dbc.DeleteSessionRequest{
		Id: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("Failed to delete session", log.Err(err), log.String("session_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// GetSessionMessages returns session messages.
func (h *Handler) GetSessionMessages(c *gin.Context) {
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id is required"})
		return
	}

	// Parse pagination params
	offset := int32(0)
	limit := int32(20)
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := parseInt(offsetStr); err == nil && o >= 0 {
			offset = int32(o)
		}
	}
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}

	ctx := c.Request.Context()
	resp, err := h.service.DBCMessage.GetMessagesBySession(ctx, &dbc.GetMessagesBySessionRequest{
		SessionId: sessionID,
		Offset:    offset,
		Limit:     limit,
	})
	if err != nil {
		h.logger.Error("Failed to get session messages", log.Err(err), log.String("session_id", sessionID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"messages": resp.Messages,
		"total":    resp.Total,
	})
}

// =============================================================================
// Agent Endpoints
// =============================================================================

// CreateAgent creates a new agent.
func (h *Handler) CreateAgent(c *gin.Context) {
	var req struct {
		UserID      string          `json:"user_id" binding:"required"`
		Name        string          `json:"name" binding:"required"`
		Description string          `json:"description,omitempty"`
		SystemPrompt string         `json:"system_prompt,omitempty"`
		Model       string          `json:"model,omitempty"`
		Provider    string          `json:"provider,omitempty"`
		Persona     json.RawMessage `json:"persona,omitempty"`
		MCPServers  json.RawMessage `json:"mcp_servers,omitempty"`
		IsDefault   bool            `json:"is_default,omitempty"`
		IsPublic    bool            `json:"is_public,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	agent, err := h.service.DBCAgent.CreateAgent(ctx, &dbc.CreateAgentRequest{
		UserId:       req.UserID,
		Name:         req.Name,
		Description:  req.Description,
		SystemPrompt: req.SystemPrompt,
		Model:        req.Model,
		Provider:     req.Provider,
		Persona:      req.Persona,
		McpServers:   req.MCPServers,
		IsDefault:    req.IsDefault,
		IsPublic:     req.IsPublic,
	})
	if err != nil {
		h.logger.Error("Failed to create agent", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusCreated, agent)
}

// GetAgent returns an agent by ID.
func (h *Handler) GetAgent(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent id is required"})
		return
	}

	ctx := c.Request.Context()
	agent, err := h.service.DBCAgent.GetAgent(ctx, &dbc.GetAgentRequest{Id: id})
	if err != nil {
		if status.Code(err) == 5 {
			c.JSON(http.StatusNotFound, gin.H{"error": "agent not found"})
			return
		}
		h.logger.Error("Failed to get agent", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, agent)
}

// UpdateAgent updates an agent.
func (h *Handler) UpdateAgent(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent id is required"})
		return
	}

	var req struct {
		Name         string          `json:"name,omitempty"`
		Description  string          `json:"description,omitempty"`
		SystemPrompt string          `json:"system_prompt,omitempty"`
		Model        string          `json:"model,omitempty"`
		Provider     string          `json:"provider,omitempty"`
		Persona      json.RawMessage `json:"persona,omitempty"`
		MCPServers   json.RawMessage `json:"mcp_servers,omitempty"`
		IsDefault    bool            `json:"is_default,omitempty"`
		IsPublic     bool            `json:"is_public,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	agent, err := h.service.DBCAgent.UpdateAgent(ctx, &dbc.UpdateAgentRequest{
		Id:          id,
		Name:        req.Name,
		Description: req.Description,
		SystemPrompt: req.SystemPrompt,
		Model:       req.Model,
		Provider:    req.Provider,
		Persona:     req.Persona,
		McpServers:  req.MCPServers,
		IsDefault:   req.IsDefault,
		IsPublic:    req.IsPublic,
	})
	if err != nil {
		h.logger.Error("Failed to update agent", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, agent)
}

// DeleteAgent deletes an agent.
func (h *Handler) DeleteAgent(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent id is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.DBCAgent.DeleteAgent(ctx, &dbc.DeleteAgentRequest{Id: id})
	if err != nil {
		h.logger.Error("Failed to delete agent", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// ListAgents lists all agents.
func (h *Handler) ListAgents(c *gin.Context) {
	offset := int32(0)
	limit := int32(20)
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := parseInt(offsetStr); err == nil {
			offset = int32(o)
		}
	}
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}

	ctx := c.Request.Context()
	resp, err := h.service.DBCAgent.ListAgents(ctx, &dbc.ListAgentsRequest{
		Offset: offset,
		Limit:  limit,
	})
	if err != nil {
		h.logger.Error("Failed to list agents", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"agents": resp.Agents,
		"total":  resp.Total,
	})
}

// =============================================================================
// Chat Endpoints
// =============================================================================

// SendMessage sends a message.
func (h *Handler) SendMessage(c *gin.Context) {
	// TODO: Forward to SVR service
	c.JSON(http.StatusOK, gin.H{"message": "not implemented"})
}

// StreamMessage streams a message response.
func (h *Handler) StreamMessage(c *gin.Context) {
	// TODO: Implement SSE streaming
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	// TODO: Stream response from SVR service
	c.SSEvent("message", "not implemented")
}

// =============================================================================
// LLM Config Endpoints
// =============================================================================

// CreateLLMConfig creates a new LLM config.
func (h *Handler) CreateLLMConfig(c *gin.Context) {
	var req struct {
		Name     string          `json:"name" binding:"required"`
		Provider string          `json:"provider" binding:"required"`
		Model    string          `json:"model" binding:"required"`
		APIKey   string          `json:"api_key,omitempty"`
		APIURL   string          `json:"api_url,omitempty"`
		Settings *svrllm.ModelSettings `json:"settings,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	config, err := h.service.SVRLLM.CreateConfig(ctx, &svrllm.CreateConfigRequest{
		Name:     req.Name,
		Provider: req.Provider,
		Model:    req.Model,
		ApiKey:   req.APIKey,
		ApiUrl:   req.APIURL,
		Settings: req.Settings,
	})
	if err != nil {
		h.logger.Error("Failed to create LLM config", log.Err(err))
		if status.Code(err) == codes.InvalidArgument {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusCreated, config)
}

// ListLLMConfigs lists all LLM configs.
func (h *Handler) ListLLMConfigs(c *gin.Context) {
	enabledOnly := c.Query("enabled_only") == "true"
	provider := c.Query("provider")

	ctx := c.Request.Context()
	resp, err := h.service.SVRLLM.ListConfigs(ctx, &svrllm.ListConfigsRequest{
		EnabledOnly: enabledOnly,
		Provider:    provider,
	})
	if err != nil {
		h.logger.Error("Failed to list LLM configs", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"configs": resp.Configs})
}

// GetLLMConfig returns an LLM config by ID.
func (h *Handler) GetLLMConfig(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config id is required"})
		return
	}

	ctx := c.Request.Context()
	config, err := h.service.SVRLLM.GetConfig(ctx, &svrllm.GetConfigRequest{
		ConfigId: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "config not found"})
			return
		}
		h.logger.Error("Failed to get LLM config", log.Err(err), log.String("config_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, config)
}

// UpdateLLMConfig updates an LLM config.
func (h *Handler) UpdateLLMConfig(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config id is required"})
		return
	}

	var req struct {
		Name     string          `json:"name,omitempty"`
		Model    string          `json:"model,omitempty"`
		APIKey   string          `json:"api_key,omitempty"`
		APIURL   string          `json:"api_url,omitempty"`
		Settings *svrllm.ModelSettings `json:"settings,omitempty"`
		Enabled  *bool           `json:"enabled,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	updateReq := &svrllm.UpdateConfigRequest{
		ConfigId: id,
		Name:     req.Name,
		Model:    req.Model,
		ApiKey:   req.APIKey,
		ApiUrl:   req.APIURL,
		Settings: req.Settings,
	}
	if req.Enabled != nil {
		updateReq.Enabled = *req.Enabled
	}

	config, err := h.service.SVRLLM.UpdateConfig(ctx, updateReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "config not found"})
			return
		}
		h.logger.Error("Failed to update LLM config", log.Err(err), log.String("config_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, config)
}

// DeleteLLMConfig deletes an LLM config.
func (h *Handler) DeleteLLMConfig(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config id is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.SVRLLM.DeleteConfig(ctx, &svrllm.DeleteConfigRequest{
		ConfigId: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "config not found"})
			return
		}
		h.logger.Error("Failed to delete LLM config", log.Err(err), log.String("config_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// ListModels lists available models.
func (h *Handler) ListModels(c *gin.Context) {
	provider := c.Query("provider")
	apiKey := c.Query("api_key")
	apiURL := c.Query("api_url")

	ctx := c.Request.Context()

	// If provider is specified, get models for that provider
	if provider != "" {
		resp, err := h.service.SVRLLM.GetProviderModels(ctx, &svrllm.GetProviderModelsRequest{
			Provider: provider,
			ApiKey:   apiKey,
			ApiUrl:   apiURL,
		})
		if err != nil {
			h.logger.Error("Failed to get provider models", log.Err(err), log.String("provider", provider))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"models": resp.Models})
		return
	}

	// Otherwise, list all providers with their default models
	resp, err := h.service.SVRLLM.ListProviders(ctx, &svrllm.ListProvidersRequest{})
	if err != nil {
		h.logger.Error("Failed to list providers", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"providers": resp.Providers})
}

// =============================================================================
// MCP Endpoints
// =============================================================================

// CreateMCPServer creates a new MCP server.
func (h *Handler) CreateMCPServer(c *gin.Context) {
	var req struct {
		Name        string                `json:"name" binding:"required"`
		Description string                `json:"description,omitempty"`
		URL         string                `json:"url" binding:"required"`
		Transport   svrmcp.TransportType   `json:"transport"`
		AuthType    svrmcp.AuthType       `json:"auth_type"`
		Settings    *svrmcp.ServerSettings `json:"settings,omitempty"`
		UserID      string                `json:"user_id,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	server, err := h.service.SVRMCP.CreateServer(ctx, &svrmcp.CreateServerRequest{
		Name:        req.Name,
		Description: req.Description,
		Url:         req.URL,
		Transport:   req.Transport,
		AuthType:    req.AuthType,
		Settings:    req.Settings,
		UserId:      req.UserID,
	})
	if err != nil {
		h.logger.Error("Failed to create MCP server", log.Err(err))
		if status.Code(err) == codes.InvalidArgument {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusCreated, server)
}

// ListMCPServers lists all MCP servers.
func (h *Handler) ListMCPServers(c *gin.Context) {
	enabledOnly := c.Query("enabled_only") == "true"
	userID := c.Query("user_id")

	ctx := c.Request.Context()
	resp, err := h.service.SVRMCP.ListServers(ctx, &svrmcp.ListServersRequest{
		EnabledOnly: enabledOnly,
		UserId:      userID,
	})
	if err != nil {
		h.logger.Error("Failed to list MCP servers", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"servers": resp.Servers})
}

// GetMCPServer returns an MCP server by ID.
func (h *Handler) GetMCPServer(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server id is required"})
		return
	}

	ctx := c.Request.Context()
	server, err := h.service.SVRMCP.GetServer(ctx, &svrmcp.GetServerRequest{
		ServerId: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
			return
		}
		h.logger.Error("Failed to get MCP server", log.Err(err), log.String("server_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, server)
}

// UpdateMCPServer updates an MCP server.
func (h *Handler) UpdateMCPServer(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server id is required"})
		return
	}

	var req struct {
		Name        string                `json:"name,omitempty"`
		Description string                `json:"description,omitempty"`
		URL         string                `json:"url,omitempty"`
		Transport   svrmcp.TransportType   `json:"transport"`
		AuthType    svrmcp.AuthType       `json:"auth_type"`
		Settings    *svrmcp.ServerSettings `json:"settings,omitempty"`
		Enabled     *bool                 `json:"enabled,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	updateReq := &svrmcp.UpdateServerRequest{
		ServerId:    id,
		Name:        req.Name,
		Description: req.Description,
		Url:         req.URL,
		Transport:   req.Transport,
		AuthType:    req.AuthType,
		Settings:    req.Settings,
	}
	if req.Enabled != nil {
		updateReq.Enabled = *req.Enabled
	}

	server, err := h.service.SVRMCP.UpdateServer(ctx, updateReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
			return
		}
		h.logger.Error("Failed to update MCP server", log.Err(err), log.String("server_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, server)
}

// DeleteMCPServer deletes an MCP server.
func (h *Handler) DeleteMCPServer(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server id is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.SVRMCP.DeleteServer(ctx, &svrmcp.DeleteServerRequest{
		ServerId: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
			return
		}
		h.logger.Error("Failed to delete MCP server", log.Err(err), log.String("server_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// ConnectMCPServer connects to an MCP server.
func (h *Handler) ConnectMCPServer(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server id is required"})
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.SVRMCP.Initialize(ctx, &svrmcp.InitializeRequest{
		ServerId: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
			return
		}
		h.logger.Error("Failed to connect MCP server", log.Err(err), log.String("server_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// DisconnectMCPServer disconnects from an MCP server.
func (h *Handler) DisconnectMCPServer(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server id is required"})
		return
	}

	// Note: MCP service doesn't have explicit disconnect method
	// Disconnection happens when server is disabled or deleted
	// For now, we'll just return success
	// In the future, this could call a disconnect method if added to the service
	c.JSON(http.StatusOK, gin.H{"message": "disconnected", "server_id": id})
}

// ListMCPTools lists tools from an MCP server.
func (h *Handler) ListMCPTools(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server id is required"})
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.SVRMCP.ListTools(ctx, &svrmcp.ListToolsRequest{
		ServerId: serverID,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
			return
		}
		h.logger.Error("Failed to list MCP tools", log.Err(err), log.String("server_id", serverID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tools": resp.Tools, "cached_at": resp.CachedAt})
}

// CallMCPTool calls a tool on an MCP server.
func (h *Handler) CallMCPTool(c *gin.Context) {
	serverID := c.Param("id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server id is required"})
		return
	}

	var req struct {
		ToolName      string            `json:"tool_name" binding:"required"`
		Arguments     map[string]string `json:"arguments,omitempty"`
		ArgumentsJSON json.RawMessage   `json:"arguments_json,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	callReq := &svrmcp.CallToolRequest{
		ServerId:  serverID,
		ToolName:  req.ToolName,
		Arguments: req.Arguments,
	}
	if len(req.ArgumentsJSON) > 0 {
		callReq.ArgumentsJson = req.ArgumentsJSON
	}

	resp, err := h.service.SVRMCP.CallTool(ctx, callReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "server or tool not found"})
			return
		}
		h.logger.Error("Failed to call MCP tool", log.Err(err), log.String("server_id", serverID), log.String("tool_name", req.ToolName))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// =============================================================================
// Thread Endpoints
// =============================================================================

// CreateThread creates a new thread.
func (h *Handler) CreateThread(c *gin.Context) {
	// TODO: Implement
	c.JSON(http.StatusCreated, gin.H{"message": "not implemented"})
}

// GetThread returns a thread by ID.
func (h *Handler) GetThread(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "thread id is required"})
		return
	}

	ctx := c.Request.Context()
	thread, err := h.service.IMThread.GetThread(ctx, &imthread.GetThreadRequest{ThreadId: id})
	if err != nil {
		if status.Code(err) == 5 { // NotFound
			c.JSON(http.StatusNotFound, gin.H{"error": "thread not found"})
			return
		}
		h.logger.Error("Failed to get thread", log.Err(err), log.String("thread_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Convert proto thread to JSON response
	c.JSON(http.StatusOK, thread)
}

// UpdateThread updates a thread.
func (h *Handler) UpdateThread(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "thread id is required"})
		return
	}

	var req struct {
		Title    string                    `json:"title,omitempty"`
		Settings *imthread.ThreadSettings  `json:"settings,omitempty"`
		Status   imthread.ThreadStatus     `json:"status,omitempty"`
		AiAgents []string                  `json:"ai_agents,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	updateReq := &imthread.UpdateThreadRequest{
		ThreadId: id,
		Title:    req.Title,
		Settings: req.Settings,
		Status:   req.Status,
		AiAgents: req.AiAgents,
	}

	thread, err := h.service.IMThread.UpdateThread(ctx, updateReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "thread not found"})
			return
		}
		h.logger.Error("Failed to update thread", log.Err(err), log.String("thread_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, thread)
}

// DeleteThread deletes a thread.
func (h *Handler) DeleteThread(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "thread id is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.IMThread.DeleteThread(ctx, &imthread.DeleteThreadRequest{
		ThreadId: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "thread not found"})
			return
		}
		h.logger.Error("Failed to delete thread", log.Err(err), log.String("thread_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// ListThreads lists threads.
func (h *Handler) ListThreads(c *gin.Context) {
	// Parse query params
	ownerID := c.Query("owner_id")
	cursor := c.Query("cursor")
	limit := int32(20)
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}
	statusStr := c.Query("status")

	ctx := c.Request.Context()
	req := &imthread.ListThreadsRequest{
		OwnerId: ownerID,
		Cursor:  cursor,
		Limit:   limit,
	}

	// Parse status if provided
	if statusStr != "" {
		// Map string to enum (simplified - would need proper enum mapping)
		req.Status = imthread.ThreadStatus_THREAD_STATUS_UNSPECIFIED
	}

	resp, err := h.service.IMThread.ListThreads(ctx, req)
	if err != nil {
		h.logger.Error("Failed to list threads", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"threads":    resp.Threads,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// CreateReply creates a reply to a thread.
func (h *Handler) CreateReply(c *gin.Context) {
	// TODO: Implement
	c.JSON(http.StatusCreated, gin.H{"message": "not implemented"})
}

// ListReplies lists replies to a thread.
func (h *Handler) ListReplies(c *gin.Context) {
	threadID := c.Param("id")
	if threadID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "thread id is required"})
		return
	}

	limit := int32(20)
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}
	cursor := c.Query("cursor")
	parentMsgID := c.Query("parent_msg_id")

	ctx := c.Request.Context()
	resp, err := h.service.IMThread.GetMessages(ctx, &imthread.GetMessagesRequest{
		ThreadId:    threadID,
		ParentMsgId: parentMsgID,
		Limit:       limit,
		Cursor:      cursor,
	})
	if err != nil {
		h.logger.Error("Failed to get replies", log.Err(err), log.String("thread_id", threadID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"replies":    resp.Messages,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// GetThreadMessages returns messages from a thread.
func (h *Handler) GetThreadMessages(c *gin.Context) {
	threadID := c.Param("id")
	if threadID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "thread id is required"})
		return
	}

	limit := int32(20)
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}
	cursor := c.Query("cursor")
	parentMsgID := c.Query("parent_msg_id")

	ctx := c.Request.Context()
	resp, err := h.service.IMThread.GetMessages(ctx, &imthread.GetMessagesRequest{
		ThreadId:    threadID,
		ParentMsgId: parentMsgID,
		Limit:       limit,
		Cursor:      cursor,
	})
	if err != nil {
		h.logger.Error("Failed to get thread messages", log.Err(err), log.String("thread_id", threadID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"messages":   resp.Messages,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// SyncThreadHistoryRequest represents a thread history sync request.
type SyncThreadHistoryRequest struct {
	ThreadID      string `json:"thread_id" binding:"required"`
	Cursor        string `json:"cursor,omitempty"`
	SinceTimestamp int64  `json:"since_timestamp,omitempty"`
	Limit         int32  `json:"limit,omitempty"`
}

// SyncThreadHistory synchronizes thread history.
func (h *Handler) SyncThreadHistory(c *gin.Context) {
	var req SyncThreadHistoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 50 // Default limit for sync
	}
	if limit > 200 {
		limit = 200 // Max limit
	}

	ctx := c.Request.Context()
	getReq := &imthread.GetMessagesRequest{
		ThreadId: req.ThreadID,
		Limit:    limit,
		Cursor:   req.Cursor,
	}

	// If since_timestamp is provided, we need to filter messages
	// For now, we'll fetch messages and filter client-side
	// In production, this should be handled server-side with proper indexing
	resp, err := h.service.IMThread.GetMessages(ctx, getReq)
	if err != nil {
		h.logger.Error("Failed to sync thread history", log.Err(err), log.String("thread_id", req.ThreadID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Filter by since_timestamp if provided
	messages := resp.Messages
	if req.SinceTimestamp > 0 {
		filtered := make([]*imthread.ThreadMessage, 0)
		for _, msg := range messages {
			if msg.Base != nil && msg.Base.Timestamp >= req.SinceTimestamp {
				filtered = append(filtered, msg)
			}
		}
		messages = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"messages":   messages,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// SyncFollowFeedRequest represents a follow feed sync request.
type SyncFollowFeedRequest struct {
	UserID        string `json:"user_id" binding:"required"`
	Cursor        string `json:"cursor,omitempty"`
	SinceTimestamp int64  `json:"since_timestamp,omitempty"`
	Limit         int32  `json:"limit,omitempty"`
}

// SyncFollowFeed synchronizes follow feed.
func (h *Handler) SyncFollowFeed(c *gin.Context) {
	var req SyncFollowFeedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	ctx := c.Request.Context()
	resp, err := h.service.IMThread.GetUserFeed(ctx, &imthread.GetUserFeedRequest{
		UserId: req.UserID,
		Limit:  limit,
		Cursor: req.Cursor,
	})
	if err != nil {
		h.logger.Error("Failed to sync follow feed", log.Err(err), log.String("user_id", req.UserID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Filter by since_timestamp if provided
	items := resp.Items
	if req.SinceTimestamp > 0 {
		filtered := make([]*imthread.FeedItem, 0)
		for _, item := range items {
			if item.Timestamp >= req.SinceTimestamp {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"items":      items,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// SyncReplyInboxRequest represents a reply inbox sync request.
type SyncReplyInboxRequest struct {
	UserID        string `json:"user_id" binding:"required"`
	Cursor        string `json:"cursor,omitempty"`
	SinceTimestamp int64  `json:"since_timestamp,omitempty"`
	Limit         int32  `json:"limit,omitempty"`
}

// SyncReplyInbox synchronizes reply inbox.
func (h *Handler) SyncReplyInbox(c *gin.Context) {
	var req SyncReplyInboxRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	ctx := c.Request.Context()
	resp, err := h.service.IMThread.GetReplyInbox(ctx, &imthread.GetReplyInboxRequest{
		UserId: req.UserID,
		Limit:  limit,
		Cursor: req.Cursor,
	})
	if err != nil {
		h.logger.Error("Failed to sync reply inbox", log.Err(err), log.String("user_id", req.UserID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Filter by since_timestamp if provided
	items := resp.Items
	if req.SinceTimestamp > 0 {
		filtered := make([]*imthread.ReplyItem, 0)
		for _, item := range items {
			if item.Timestamp >= req.SinceTimestamp {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"items":      items,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// =============================================================================
// Group Chat Endpoints
// =============================================================================

// CreateChat creates a new chat.
func (h *Handler) CreateChat(c *gin.Context) {
	// TODO: Implement
	c.JSON(http.StatusCreated, gin.H{"message": "not implemented"})
}

// GetChat returns a chat by ID.
func (h *Handler) GetChat(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	ctx := c.Request.Context()
	chat, err := h.service.IMChat.GetChat(ctx, &imchat.GetChatRequest{ChatKey: id})
	if err != nil {
		if status.Code(err) == 5 { // NotFound
			c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
			return
		}
		h.logger.Error("Failed to get chat", log.Err(err), log.String("chat_id", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, chat)
}

// UpdateChat updates a chat.
func (h *Handler) UpdateChat(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	var req struct {
		Title    string                `json:"title,omitempty"`
		Settings *imchat.ChatSettings  `json:"settings,omitempty"`
		Status   imchat.ChatStatus     `json:"status,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	updateReq := &imchat.UpdateChatRequest{
		ChatKey:  id,
		Title:    req.Title,
		Settings: req.Settings,
		Status:   req.Status,
	}

	chat, err := h.service.IMChat.UpdateChat(ctx, updateReq)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
			return
		}
		h.logger.Error("Failed to update chat", log.Err(err), log.String("chat_key", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, chat)
}

// DeleteChat deletes a chat.
func (h *Handler) DeleteChat(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.IMChat.DeleteChat(ctx, &imchat.DeleteChatRequest{
		ChatKey: id,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
			return
		}
		h.logger.Error("Failed to delete chat", log.Err(err), log.String("chat_key", id))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// ListChats lists chats.
func (h *Handler) ListChats(c *gin.Context) {
	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	limit := int32(20)
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}
	cursor := c.Query("cursor")

	ctx := c.Request.Context()
	resp, err := h.service.IMChat.ListChats(ctx, &imchat.ListChatsRequest{
		UserId: userID,
		Limit:  limit,
		Cursor: cursor,
	})
	if err != nil {
		h.logger.Error("Failed to list chats", log.Err(err), log.String("user_id", userID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"chats":      resp.Chats,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// GetChatMessages returns messages from a chat.
func (h *Handler) GetChatMessages(c *gin.Context) {
	chatKey := c.Param("id")
	if chatKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	limit := int32(20)
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}
	cursor := c.Query("cursor")

	ctx := c.Request.Context()
	resp, err := h.service.IMChat.GetMessages(ctx, &imchat.GetMessagesRequest{
		ChatKey: chatKey,
		Limit:   limit,
		Cursor:  cursor,
	})
	if err != nil {
		h.logger.Error("Failed to get chat messages", log.Err(err), log.String("chat_key", chatKey))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"messages":   resp.Messages,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// SyncChatHistoryRequest represents a chat history sync request.
type SyncChatHistoryRequest struct {
	ChatKey       string `json:"chat_key" binding:"required"`
	UserID        string `json:"user_id" binding:"required"`
	Cursor        string `json:"cursor,omitempty"`
	SinceTimestamp int64  `json:"since_timestamp,omitempty"`
	Limit         int32  `json:"limit,omitempty"`
}

// SyncChatHistory synchronizes chat history.
func (h *Handler) SyncChatHistory(c *gin.Context) {
	var req SyncChatHistoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	ctx := c.Request.Context()
	getReq := &imchat.GetMessagesRequest{
		ChatKey:        req.ChatKey,
		Limit:          limit,
		Cursor:         req.Cursor,
		SinceTimestamp: req.SinceTimestamp,
	}

	resp, err := h.service.IMChat.GetMessages(ctx, getReq)
	if err != nil {
		h.logger.Error("Failed to sync chat history", log.Err(err), log.String("chat_key", req.ChatKey))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Filter by since_timestamp if provided
	messages := resp.Messages
	if req.SinceTimestamp > 0 {
		filtered := make([]*imchat.ChatMessage, 0)
		for _, msg := range messages {
			if msg.Base != nil && msg.Base.Timestamp >= req.SinceTimestamp {
				filtered = append(filtered, msg)
			}
		}
		messages = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"messages":   messages,
		"has_more":   resp.HasMore,
		"next_cursor": resp.NextCursor,
	})
}

// AddParticipant adds a participant to a chat.
func (h *Handler) AddParticipant(c *gin.Context) {
	chatKey := c.Param("id")
	if chatKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	var req struct {
		UserID string                `json:"user_id" binding:"required"`
		Role   imchat.ParticipantRole `json:"role,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	role := req.Role
	if role == imchat.ParticipantRole_PARTICIPANT_ROLE_UNSPECIFIED {
		role = imchat.ParticipantRole_MEMBER
	}

	_, err := h.service.IMChat.AddParticipant(ctx, &imchat.AddParticipantRequest{
		ChatKey: chatKey,
		UserId:  req.UserID,
		Role:    role,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
			return
		}
		h.logger.Error("Failed to add participant", log.Err(err), log.String("chat_key", chatKey), log.String("user_id", req.UserID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// RemoveParticipant removes a participant from a chat.
func (h *Handler) RemoveParticipant(c *gin.Context) {
	chatKey := c.Param("id")
	if chatKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id query parameter is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.IMChat.RemoveParticipant(ctx, &imchat.RemoveParticipantRequest{
		ChatKey: chatKey,
		UserId:  userID,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "chat or participant not found"})
			return
		}
		h.logger.Error("Failed to remove participant", log.Err(err), log.String("chat_key", chatKey), log.String("user_id", userID))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// ListChannels lists channels in a chat.
func (h *Handler) ListChannels(c *gin.Context) {
	// TODO: Implement
	c.JSON(http.StatusOK, gin.H{"channels": []interface{}{}})
}

// CreateChannel creates a channel in a chat.
func (h *Handler) CreateChannel(c *gin.Context) {
	// TODO: Implement
	c.JSON(http.StatusCreated, gin.H{"message": "not implemented"})
}

// =============================================================================
// Admin Endpoints (require admin authentication)
// =============================================================================

// AdminCreateThread creates a thread as admin.
func (h *Handler) AdminCreateThread(c *gin.Context) {
	// Same as CreateThread but with admin privileges
	// In production, you might want to add additional admin-only fields
	h.CreateThread(c)
}

// AdminCreateReply creates a reply as admin.
func (h *Handler) AdminCreateReply(c *gin.Context) {
	// Same as CreateReply but with admin privileges
	threadID := c.Param("id")
	if threadID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "thread id is required"})
		return
	}
	// Forward to CreateReply logic
	h.CreateReply(c)
}

// AdminDeleteMessage deletes a message as admin.
func (h *Handler) AdminDeleteMessage(c *gin.Context) {
	threadID := c.Param("id")
	msgID := c.Param("msgId")
	if threadID == "" || msgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "thread_id and msg_id are required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.IMThread.DeleteMessage(ctx, &imthread.DeleteMessageRequest{
		MsgId:       msgID,
		RequesterId: "admin", // Admin user ID should come from auth context
	})
	if err != nil {
		h.logger.Error("Failed to delete message", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminUpdateThread updates a thread as admin.
func (h *Handler) AdminUpdateThread(c *gin.Context) {
	// Same as UpdateThread but with admin privileges
	h.UpdateThread(c)
}

// AdminCreateChat creates a chat as admin.
func (h *Handler) AdminCreateChat(c *gin.Context) {
	// Same as CreateChat but with admin privileges
	h.CreateChat(c)
}

// AdminDeleteChat deletes a chat as admin.
func (h *Handler) AdminDeleteChat(c *gin.Context) {
	chatKey := c.Param("id")
	if chatKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	ctx := c.Request.Context()
	_, err := h.service.IMChat.DeleteChat(ctx, &imchat.DeleteChatRequest{
		ChatKey: chatKey,
	})
	if err != nil {
		h.logger.Error("Failed to delete chat", log.Err(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminManageParticipants manages chat participants as admin.
func (h *Handler) AdminManageParticipants(c *gin.Context) {
	chatKey := c.Param("id")
	if chatKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat id is required"})
		return
	}

	// Parse request body for action (add/remove) and user_id
	var req struct {
		Action string `json:"action" binding:"required"` // "add" or "remove"
		UserID string `json:"user_id" binding:"required"`
		Role   string `json:"role,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "details": err.Error()})
		return
	}

	ctx := c.Request.Context()
	if req.Action == "add" {
		role := imchat.ParticipantRole_MEMBER
		if req.Role == "admin" {
			role = imchat.ParticipantRole_ADMIN
		} else if req.Role == "owner" {
			role = imchat.ParticipantRole_OWNER
		}
		_, err := h.service.IMChat.AddParticipant(ctx, &imchat.AddParticipantRequest{
			ChatKey: chatKey,
			UserId:  req.UserID,
			Role:    role,
		})
		if err != nil {
			h.logger.Error("Failed to add participant", log.Err(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			return
		}
	} else if req.Action == "remove" {
		_, err := h.service.IMChat.RemoveParticipant(ctx, &imchat.RemoveParticipantRequest{
			ChatKey: chatKey,
			UserId:  req.UserID,
		})
		if err != nil {
			h.logger.Error("Failed to remove participant", log.Err(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			return
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid action, must be 'add' or 'remove'"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
