package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"chatee-go/commonlib/log"
)

// =============================================================================
// Connection Registry Interface
// =============================================================================

// ConnectionRegistry manages connection registration in Redis
type ConnectionRegistry interface {
	// RegisterConnection registers a connection
	RegisterConnection(ctx context.Context, conn *Connection, nodeID string) error
	// UnregisterConnection unregisters a connection
	UnregisterConnection(ctx context.Context, connID string) error
	// GetConnection gets connection information
	GetConnection(ctx context.Context, connID string) (*ConnectionInfo, error)
	// GetUserConnections gets all connection IDs for a user
	GetUserConnections(ctx context.Context, userID string) ([]string, error)
	// GetNodeConnections gets all connection IDs for a node
	GetNodeConnections(ctx context.Context, nodeID string) ([]string, error)
	// UpdateHeartbeat updates connection heartbeat
	UpdateHeartbeat(ctx context.Context, connID string) error
	// IsConnectionOnline checks if a connection is online
	IsConnectionOnline(ctx context.Context, connID string) (bool, error)
}

// ConnectionInfo represents connection information stored in Redis
type ConnectionInfo struct {
	ID         string            `json:"id"`
	UserID     string            `json:"user_id"`
	SessionID  string            `json:"session_id"`
	NodeID     string            `json:"node_id"`
	JoinedAt   int64             `json:"joined_at"`
	LastActive int64             `json:"last_active"`
	Metadata   map[string]any    `json:"metadata"`
}

// =============================================================================
// Redis Connection Registry Implementation
// =============================================================================

// RedisConnectionRegistry implements ConnectionRegistry using Redis
type RedisConnectionRegistry struct {
	redis  *redis.Client
	logger log.Logger
	ttl    time.Duration
}

// NewRedisConnectionRegistry creates a new Redis connection registry
func NewRedisConnectionRegistry(redisClient *redis.Client, logger log.Logger, ttl time.Duration) *RedisConnectionRegistry {
	return &RedisConnectionRegistry{
		redis:  redisClient,
		logger: logger,
		ttl:    ttl,
	}
}

// RegisterConnection registers a connection in Redis
func (r *RedisConnectionRegistry) RegisterConnection(ctx context.Context, conn *Connection, nodeID string) error {
	info := &ConnectionInfo{
		ID:         conn.ID,
		UserID:     conn.UserID,
		SessionID:  conn.SessionID,
		NodeID:     nodeID,
		JoinedAt:   conn.JoinedAt.Unix(),
		LastActive: conn.LastActive.Unix(),
		Metadata:   conn.Metadata,
	}

	// Serialize connection info
	data, err := json.Marshal(info)
	if err != nil {
		return fmt.Errorf("failed to marshal connection info: %w", err)
	}

	// Use pipeline for atomic operations
	pipe := r.redis.Pipeline()

	// Store connection registry
	registryKey := fmt.Sprintf("conn:registry:%s", conn.ID)
	pipe.Set(ctx, registryKey, data, r.ttl)

	// Add to user connections index
	if conn.UserID != "" {
		userKey := fmt.Sprintf("user:connections:%s", conn.UserID)
		pipe.SAdd(ctx, userKey, conn.ID)
		pipe.Expire(ctx, userKey, r.ttl)
	}

	// Add to node connections index
	nodeKey := fmt.Sprintf("node:connections:%s", nodeID)
	pipe.SAdd(ctx, nodeKey, conn.ID)
	pipe.Expire(ctx, nodeKey, r.ttl)

	// Set heartbeat
	heartbeatKey := fmt.Sprintf("conn:heartbeat:%s", conn.ID)
	pipe.Set(ctx, heartbeatKey, time.Now().Unix(), 60*time.Second)

	// Execute pipeline
	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to register connection: %w", err)
	}

	r.logger.Debug("Connection registered in Redis",
		log.String("connection_id", conn.ID),
		log.String("user_id", conn.UserID),
		log.String("node_id", nodeID),
	)

	return nil
}

// UnregisterConnection unregisters a connection from Redis
func (r *RedisConnectionRegistry) UnregisterConnection(ctx context.Context, connID string) error {
	// Get connection info first to get user_id and node_id
	info, err := r.GetConnection(ctx, connID)
	if err != nil {
		// Connection might not exist, continue with cleanup
		r.logger.Warn("Connection not found during unregister", log.String("connection_id", connID), log.Err(err))
	}

	// Use pipeline for atomic operations
	pipe := r.redis.Pipeline()

	// Remove connection registry
	registryKey := fmt.Sprintf("conn:registry:%s", connID)
	pipe.Del(ctx, registryKey)

	// Remove from user connections index
	if info != nil && info.UserID != "" {
		userKey := fmt.Sprintf("user:connections:%s", info.UserID)
		pipe.SRem(ctx, userKey, connID)
	}

	// Remove from node connections index
	if info != nil && info.NodeID != "" {
		nodeKey := fmt.Sprintf("node:connections:%s", info.NodeID)
		pipe.SRem(ctx, nodeKey, connID)
	}

	// Remove heartbeat
	heartbeatKey := fmt.Sprintf("conn:heartbeat:%s", connID)
	pipe.Del(ctx, heartbeatKey)

	// Execute pipeline
	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to unregister connection: %w", err)
	}

	r.logger.Debug("Connection unregistered from Redis", log.String("connection_id", connID))
	return nil
}

// GetConnection gets connection information from Redis
func (r *RedisConnectionRegistry) GetConnection(ctx context.Context, connID string) (*ConnectionInfo, error) {
	registryKey := fmt.Sprintf("conn:registry:%s", connID)
	data, err := r.redis.Get(ctx, registryKey).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("connection not found: %s", connID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get connection: %w", err)
	}

	var info ConnectionInfo
	if err := json.Unmarshal([]byte(data), &info); err != nil {
		return nil, fmt.Errorf("failed to unmarshal connection info: %w", err)
	}

	return &info, nil
}

// GetUserConnections gets all connection IDs for a user
func (r *RedisConnectionRegistry) GetUserConnections(ctx context.Context, userID string) ([]string, error) {
	userKey := fmt.Sprintf("user:connections:%s", userID)
	connIDs, err := r.redis.SMembers(ctx, userKey).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get user connections: %w", err)
	}

	// Filter out expired connections
	validConnIDs := make([]string, 0, len(connIDs))
	for _, connID := range connIDs {
		online, err := r.IsConnectionOnline(ctx, connID)
		if err == nil && online {
			validConnIDs = append(validConnIDs, connID)
		}
	}

	return validConnIDs, nil
}

// GetNodeConnections gets all connection IDs for a node
func (r *RedisConnectionRegistry) GetNodeConnections(ctx context.Context, nodeID string) ([]string, error) {
	nodeKey := fmt.Sprintf("node:connections:%s", nodeID)
	connIDs, err := r.redis.SMembers(ctx, nodeKey).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get node connections: %w", err)
	}

	// Filter out expired connections
	validConnIDs := make([]string, 0, len(connIDs))
	for _, connID := range connIDs {
		online, err := r.IsConnectionOnline(ctx, connID)
		if err == nil && online {
			validConnIDs = append(validConnIDs, connID)
		}
	}

	return validConnIDs, nil
}

// UpdateHeartbeat updates connection heartbeat
func (r *RedisConnectionRegistry) UpdateHeartbeat(ctx context.Context, connID string) error {
	heartbeatKey := fmt.Sprintf("conn:heartbeat:%s", connID)
	now := time.Now().Unix()
	
	// Update heartbeat with TTL
	err := r.redis.Set(ctx, heartbeatKey, now, 60*time.Second).Err()
	if err != nil {
		return fmt.Errorf("failed to update heartbeat: %w", err)
	}

	// Also update last_active in registry
	registryKey := fmt.Sprintf("conn:registry:%s", connID)
	info, err := r.GetConnection(ctx, connID)
	if err == nil {
		info.LastActive = now
		data, err := json.Marshal(info)
		if err == nil {
			r.redis.Set(ctx, registryKey, data, r.ttl)
		}
	}

	return nil
}

// IsConnectionOnline checks if a connection is online
func (r *RedisConnectionRegistry) IsConnectionOnline(ctx context.Context, connID string) (bool, error) {
	heartbeatKey := fmt.Sprintf("conn:heartbeat:%s", connID)
	exists, err := r.redis.Exists(ctx, heartbeatKey).Result()
	if err != nil {
		return false, fmt.Errorf("failed to check connection online: %w", err)
	}
	return exists > 0, nil
}

// GetRedisClient returns the underlying Redis client (for advanced operations)
func (r *RedisConnectionRegistry) GetRedisClient() *redis.Client {
	return r.redis
}

// UpdateConnectionNode updates the node ID for a connection (for migration)
func (r *RedisConnectionRegistry) UpdateConnectionNode(ctx context.Context, connID, newNodeID string) error {
	// Get current connection info
	info, err := r.GetConnection(ctx, connID)
	if err != nil {
		return fmt.Errorf("failed to get connection info: %w", err)
	}

	oldNodeID := info.NodeID
	if oldNodeID == newNodeID {
		return nil // No change needed
	}

	// Update connection info
	info.NodeID = newNodeID
	data, err := json.Marshal(info)
	if err != nil {
		return fmt.Errorf("failed to marshal connection info: %w", err)
	}

	// Use pipeline for atomic operations
	pipe := r.redis.Pipeline()

	// Update registry entry
	registryKey := fmt.Sprintf("conn:registry:%s", connID)
	// Get current TTL
	ttl, err := r.redis.TTL(ctx, registryKey).Result()
	if err == nil && ttl > 0 {
		pipe.Set(ctx, registryKey, data, ttl)
	} else {
		pipe.Set(ctx, registryKey, data, r.ttl)
	}

	// Update node connection indices
	oldNodeKey := fmt.Sprintf("node:connections:%s", oldNodeID)
	newNodeKey := fmt.Sprintf("node:connections:%s", newNodeID)
	pipe.SRem(ctx, oldNodeKey, connID)
	pipe.SAdd(ctx, newNodeKey, connID)
	pipe.Expire(ctx, newNodeKey, r.ttl)

	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to update connection node: %w", err)
	}

	r.logger.Debug("Connection node updated",
		log.String("connection_id", connID),
		log.String("old_node", oldNodeID),
		log.String("new_node", newNodeID),
	)

	return nil
}

