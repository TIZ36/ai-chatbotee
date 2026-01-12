package user

import (
	"context"
	"fmt"
	"sync"
	"time"

	"google.golang.org/grpc"

	"chatee-go/commonlib/actor"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/commonlib/snowflake"
	infraactor "chatee-go/infrastructure/actor"
	svruser "chatee-go/gen/svr/user"
)

// =============================================================================
// Service Configuration
// =============================================================================

// Config holds the user service configuration
type Config struct {
	Logger      log.Logger
	Pools       *pool.PoolManager
	ActorSystem actor.ActorSystem
}

// =============================================================================
// Service Implementation
// =============================================================================

// Service implements the User gRPC service
type Service struct {
	cfg        Config
	userActors map[string]*UserActorWrapper
	mu         sync.RWMutex
}

// UserActorWrapper wraps a user actor with metadata
type UserActorWrapper struct {
	Ref       actor.ActorRef
	UserID    string
	CreatedAt time.Time
}

// NewService creates a new user service
func NewService(cfg Config) *Service {
	return &Service{
		cfg:        cfg,
		userActors: make(map[string]*UserActorWrapper),
	}
}

// RegisterGRPC registers the service with a gRPC server
func RegisterGRPC(server *grpc.Server, svc *Service) {
	svruser.RegisterUserServiceServer(server, svc)
}

// =============================================================================
// User Management
// =============================================================================

// CreateUser creates a new user
func (s *Service) CreateUser(ctx context.Context, req *svruser.CreateUserRequest) (*svruser.User, error) {
	userID := snowflake.NewUserID()
	
	user := &svruser.User{
		Id:        userID,
		Email:     req.Email,
		Name:      req.Name,
		AvatarUrl: req.AvatarUrl,
		Status:    "active",
		Settings: &svruser.UserSettings{
			Theme:            "system",
			Language:         "en",
			EnableNotify:     true,
			NotifySound:      true,
			CompactMode:      false,
			ShowTimestamps:   true,
			EnterToSend:      true,
			StreamResponses:  true,
			DefaultLlm:       "deepseek",
			DefaultModel:      "deepseek-chat",
		},
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
	}

	// Save to database
	if err := s.saveUser(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to save user: %w", err)
	}

	// Cache the user
	s.cacheUser(ctx, user)

	return user, nil
}

// GetUser retrieves a user by ID
func (s *Service) GetUser(ctx context.Context, req *svruser.GetUserRequest) (*svruser.User, error) {
	userID := req.UserId

	// Try cache first
	redis := s.cfg.Pools.GetRedis()
	cacheKey := fmt.Sprintf("user:%s", userID)
	cached, err := redis.HGetAll(ctx, cacheKey).Result()
	if err == nil && len(cached) > 0 {
		return parseUserFromCache(cached), nil
	}

	// Load from database
	user, err := s.loadUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Cache the user
	s.cacheUser(ctx, user)

	return user, nil
}

// UpdateUser updates a user
func (s *Service) UpdateUser(ctx context.Context, req *svruser.UpdateUserRequest) (*svruser.User, error) {
	user, err := s.GetUser(ctx, &svruser.GetUserRequest{UserId: req.UserId})
	if err != nil {
		return nil, err
	}

	if req.Name != "" {
		user.Name = req.Name
	}
	if req.AvatarUrl != "" {
		user.AvatarUrl = req.AvatarUrl
	}
	if req.Settings != nil {
		user.Settings = req.Settings
	}

	user.UpdatedAt = time.Now().Unix()

	// Save to database
	if err := s.saveUser(ctx, user); err != nil {
		return nil, err
	}

	// Invalidate cache
	s.invalidateUserCache(ctx, user.Id)

	return user, nil
}

// DeleteUser deletes a user
func (s *Service) DeleteUser(ctx context.Context, req *svruser.DeleteUserRequest) (*svruser.DeleteUserResponse, error) {
	userID := req.UserId

	// Stop user actor if running
	s.stopUserActor(userID)

	// Invalidate cache
	s.invalidateUserCache(ctx, userID)

	// Delete from database
	db := s.cfg.Pools.GetMySQL()
	_, err := db.ExecContext(ctx, "UPDATE users SET status = 'deleted', updated_at = NOW() WHERE id = ?", userID)
	if err != nil {
		return nil, fmt.Errorf("failed to delete user: %w", err)
	}

	return &svruser.DeleteUserResponse{Success: true}, nil
}

// =============================================================================
// User Actor Management
// =============================================================================

// GetOrCreateUserActor gets or creates a user actor
func (s *Service) GetOrCreateUserActor(ctx context.Context, userID string) (*UserActorWrapper, error) {
	// Check if already exists
	s.mu.RLock()
	if wrapper, ok := s.userActors[userID]; ok {
		s.mu.RUnlock()
		return wrapper, nil
	}
	s.mu.RUnlock()

	// Double-check
	s.mu.Lock()
	defer s.mu.Unlock()
	if wrapper, ok := s.userActors[userID]; ok {
		return wrapper, nil
	}

	// Load user from database
	user, err := s.GetUser(ctx, &svruser.GetUserRequest{UserId: userID})
	if err != nil {
		return nil, err
	}

	// Create user actor
	userActor := infraactor.NewUserActor(userID, &actor.UserProfile{
		ID:        userID,
		Name:      user.Name,
		Email:     user.Email,
		Avatar:    user.AvatarUrl,
		Role:      "user",
		CreatedAt: time.Unix(user.CreatedAt, 0),
		UpdatedAt: time.Unix(user.UpdatedAt, 0),
	})

	// Spawn actor
	ref, err := s.cfg.ActorSystem.Spawn(userID, userActor)
	if err != nil {
		return nil, fmt.Errorf("failed to spawn user actor: %w", err)
	}

	wrapper := &UserActorWrapper{
		Ref:       ref,
		UserID:    userID,
		CreatedAt: time.Now(),
	}
	s.userActors[userID] = wrapper

	return wrapper, nil
}

// RegisterConnection registers a WebSocket connection for a user
func (s *Service) RegisterConnection(ctx context.Context, req *svruser.RegisterConnectionRequest) (*svruser.RegisterConnectionResponse, error) {
	userID := req.UserId
	connID := req.ConnectionId

	// Get or create user actor
	wrapper, err := s.GetOrCreateUserActor(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Send connection event to actor
	wrapper.Ref.Send(actor.NewMessage("register_connection", &actor.ConnectionEvent{
		BaseMessage: actor.BaseMessage{
			ID:        connID,
			Timestamp: time.Now(),
		},
		ConnectionID: connID,
		EventType:    "connected",
		UserID:       userID,
	}))

	// Add connection to actor
	if userActor, ok := wrapper.Ref.(*infraactor.MailboxRef); ok {
		// We need to access the underlying actor to add connection
		// This is a limitation - we should add a method to ActorRef
		// For now, we'll use a message to register the connection
		_ = userActor
	}

	return &svruser.RegisterConnectionResponse{
		Success: true,
		ActorId: userID,
	}, nil
}

// UnregisterConnection unregisters a WebSocket connection
func (s *Service) UnregisterConnection(ctx context.Context, req *svruser.UnregisterConnectionRequest) (*svruser.UnregisterConnectionResponse, error) {
	userID := req.UserId
	connID := req.ConnectionId

	s.mu.RLock()
	wrapper, ok := s.userActors[userID]
	s.mu.RUnlock()

	if !ok {
		return &svruser.UnregisterConnectionResponse{Success: true}, nil
	}

	// Send unregister event to actor
	wrapper.Ref.Send(actor.NewMessage("unregister_connection", &actor.ConnectionEvent{
		BaseMessage: actor.BaseMessage{
			ID:        connID,
			Timestamp: time.Now(),
		},
		ConnectionID: connID,
		EventType:    "disconnected",
		UserID:       userID,
	}))

	return &svruser.UnregisterConnectionResponse{Success: true}, nil
}

// SendMessage sends a message to a user actor
func (s *Service) SendMessage(ctx context.Context, req *svruser.SendMessageRequest) (*svruser.SendMessageResponse, error) {
	userID := req.UserId

	s.mu.RLock()
	wrapper, ok := s.userActors[userID]
	s.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("user actor not found: %s", userID)
	}

	// Create user message
	msg := actor.NewMessage("user_message", &actor.UserMessage{
		BaseMessage: actor.BaseMessage{
			ID:        snowflake.NewMessageID(),
			Timestamp: time.Now(),
		},
		UserID:  userID,
		Content: string(req.Message),
	})

	// Send to actor
	wrapper.Ref.Send(msg)

	// Get connection count from actor
	connections := int32(0)
	respChan := make(chan actor.Message, 1)
	askMsg := actor.NewAskMessage("get_status", nil, respChan)
	wrapper.Ref.Ask(askMsg, respChan)

	select {
	case resp := <-respChan:
		if genMsg, ok := resp.(*actor.GenericMessage); ok {
			if genMsg.MsgType == "user_status" && genMsg.Payload != nil {
				if connCount, ok := genMsg.Payload["connections"].(float64); ok {
					connections = int32(connCount)
				} else if connCount, ok := genMsg.Payload["connections"].(int); ok {
					connections = int32(connCount)
				}
			}
		}
	case <-time.After(2 * time.Second):
		// Timeout - assume at least one connection if actor exists
		connections = 1
	}

	return &svruser.SendMessageResponse{
		Success:                  true,
		DeliveredToConnections: connections,
	}, nil
}

// GetUserStatus returns the online status of a user
func (s *Service) GetUserStatus(ctx context.Context, req *svruser.GetUserStatusRequest) (*svruser.UserStatus, error) {
	userID := req.UserId

	s.mu.RLock()
	wrapper, ok := s.userActors[userID]
	s.mu.RUnlock()

	if !ok {
		return &svruser.UserStatus{
			UserId:     userID,
			Online:     false,
			Connections: 0,
			LastSeen:   time.Now().Unix(),
		}, nil
	}

	// Query the actor for status
	respChan := make(chan actor.Message, 1)
	askMsg := actor.NewAskMessage("get_status", nil, respChan)
	wrapper.Ref.Ask(askMsg, respChan)

	select {
	case resp := <-respChan:
		// Parse the response from GenericMessage
		if genMsg, ok := resp.(*actor.GenericMessage); ok {
			if genMsg.MsgType == "user_status" && genMsg.Payload != nil {
				status := &svruser.UserStatus{
					UserId: userID,
				}
				
				// Extract fields from payload
				if online, ok := genMsg.Payload["online"].(bool); ok {
					status.Online = online
				}
				if connections, ok := genMsg.Payload["connections"].(float64); ok {
					status.Connections = int32(connections)
				} else if connections, ok := genMsg.Payload["connections"].(int); ok {
					status.Connections = int32(connections)
				}
				if lastSeen, ok := genMsg.Payload["last_seen"].(float64); ok {
					status.LastSeen = int64(lastSeen)
				} else if lastSeen, ok := genMsg.Payload["last_seen"].(int64); ok {
					status.LastSeen = lastSeen
				}
				if activeChats, ok := genMsg.Payload["active_chats"].([]interface{}); ok {
					status.ActiveChats = make([]string, 0, len(activeChats))
					for _, chat := range activeChats {
						if chatStr, ok := chat.(string); ok {
							status.ActiveChats = append(status.ActiveChats, chatStr)
						}
					}
				}
				
				return status, nil
			}
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(5 * time.Second):
		// Timeout - return default status based on actor existence
		return &svruser.UserStatus{
			UserId:     userID,
			Online:     true, // Actor exists
			Connections: 0,   // Unknown
			LastSeen:   time.Now().Unix(),
		}, nil
	}

	// Fallback: actor exists but no response
	return &svruser.UserStatus{
		UserId:     userID,
		Online:     true,
		Connections: 0,
		LastSeen:   time.Now().Unix(),
	}, nil
}

// GetActiveUsers returns a list of currently active users
func (s *Service) GetActiveUsers(ctx context.Context, req *svruser.GetActiveUsersRequest) (*svruser.GetActiveUsersResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	users := make([]string, 0, len(s.userActors))
	for userID := range s.userActors {
		users = append(users, userID)
	}

	return &svruser.GetActiveUsersResponse{
		UserIds: users,
		Total:   int32(len(users)),
	}, nil
}

// stopUserActor stops a user actor
func (s *Service) stopUserActor(userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if wrapper, ok := s.userActors[userID]; ok {
		wrapper.Ref.Stop()
		delete(s.userActors, userID)
	}
}

// =============================================================================
// Database Operations
// =============================================================================

// loadUser loads a user from the database
func (s *Service) loadUser(ctx context.Context, userID string) (*svruser.User, error) {
	db := s.cfg.Pools.GetMySQL()
	var user svruser.User
	err := db.GetContext(ctx, &user, "SELECT id, email, name, avatar_url, status, created_at, updated_at FROM users WHERE id = ?", userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %s", userID)
	}
	return &user, nil
}

// saveUser saves a user to the database
func (s *Service) saveUser(ctx context.Context, user *svruser.User) error {
	db := s.cfg.Pools.GetMySQL()
	_, err := db.ExecContext(ctx, `
		INSERT INTO users (id, email, name, avatar_url, status, settings, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			name = VALUES(name),
			avatar_url = VALUES(avatar_url),
			status = VALUES(status),
			settings = VALUES(settings),
			updated_at = VALUES(updated_at)
	`, user.Id, user.Email, user.Name, user.AvatarUrl, user.Status, "{}", user.CreatedAt, user.UpdatedAt)
	return err
}

// cacheUser caches a user in Redis
func (s *Service) cacheUser(ctx context.Context, user *svruser.User) {
	redis := s.cfg.Pools.GetRedis()
	cacheKey := fmt.Sprintf("user:%s", user.Id)
	redis.HSet(ctx, cacheKey, map[string]interface{}{
		"id":        user.Id,
		"email":     user.Email,
		"name":      user.Name,
		"avatar_url": user.AvatarUrl,
		"status":    user.Status,
	})
	redis.Expire(ctx, cacheKey, 30*time.Minute)
}

// invalidateUserCache invalidates a user's cache
func (s *Service) invalidateUserCache(ctx context.Context, userID string) {
	redis := s.cfg.Pools.GetRedis()
	cacheKey := fmt.Sprintf("user:%s", userID)
	redis.Del(ctx, cacheKey)
}

// parseUserFromCache parses a user from Redis cache
func parseUserFromCache(cached map[string]string) *svruser.User {
	return &svruser.User{
		Id:        cached["id"],
		Email:     cached["email"],
		Name:      cached["name"],
		AvatarUrl: cached["avatar_url"],
		Status:    cached["status"],
	}
}

// =============================================================================
// Connection Adapter
// =============================================================================

// ConnectionAdapter adapts WebSocket connections to actor.Connection interface
type ConnectionAdapter struct {
	ConnID string
	UserID string
}

func (c *ConnectionAdapter) ID() string {
	return c.ConnID
}

func (c *ConnectionAdapter) Send(msg []byte) error {
	// This will be implemented by conn_rpc
	return nil
}

func (c *ConnectionAdapter) Close() error {
	return nil
}

func (c *ConnectionAdapter) IsAlive() bool {
	return true
}

