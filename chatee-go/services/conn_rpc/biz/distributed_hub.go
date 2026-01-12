package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
)

// =============================================================================
// Distributed Hub
// =============================================================================

// DistributedHub extends Hub with Redis-based distributed connection management
type DistributedHub struct {
	// Embed original Hub for backward compatibility
	*Hub

	// Distributed components
	registry          ConnectionRegistry
	nodeDiscovery     *NodeDiscovery
	heartbeatManager  *HeartbeatManager
	migration         *ConnectionMigration
	pools             *pool.PoolManager

	// Configuration
	nodeID            string
	enableDistributed bool
	loadBalancingStrategy string
	logger            log.Logger

	// Local connection cache (for fast access)
	localConnections map[string]*Connection
	localMu          sync.RWMutex

	// Context
	ctx    context.Context
	cancel context.CancelFunc
}

// NewDistributedHub creates a new distributed hub
func NewDistributedHub(baseHub *Hub, pools *pool.PoolManager, logger log.Logger, nodeID string, enableDistributed bool, heartbeatInterval, heartbeatTimeout, nodeHeartbeatInterval, nodeHeartbeatTimeout time.Duration, loadBalancingStrategy string, host string, port int) (*DistributedHub, error) {
	if !enableDistributed {
		// Return hub without distributed features
		return &DistributedHub{
			Hub: baseHub,
			enableDistributed: false,
		}, nil
	}

	// Get Redis client
	redisClient := pools.GetRedis()
	if redisClient == nil {
		return nil, fmt.Errorf("Redis client is required for distributed hub")
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Create registry
	registry := NewRedisConnectionRegistry(redisClient, logger, 3600*time.Second)

	// Create node discovery
	nodeDiscovery := NewNodeDiscovery(redisClient, logger, nodeID, host, port, nodeHeartbeatInterval, nodeHeartbeatTimeout)

	// Create heartbeat manager
	heartbeatManager := NewHeartbeatManager(registry, logger, heartbeatInterval, heartbeatTimeout)

	// Create migration handler
	migration := NewConnectionMigration(registry, nodeDiscovery, logger)

	dh := &DistributedHub{
		Hub:                 baseHub,
		registry:            registry,
		nodeDiscovery:       nodeDiscovery,
		heartbeatManager:    heartbeatManager,
		migration:           migration,
		pools:               pools,
		nodeID:              nodeID,
		enableDistributed:   enableDistributed,
		loadBalancingStrategy: loadBalancingStrategy,
		logger:              logger,
		localConnections:    make(map[string]*Connection),
		ctx:                 ctx,
		cancel:              cancel,
	}

	// Set up callbacks
	heartbeatManager.SetConnectionLostCallback(dh.onConnectionLost)
	migration.SetMigrationCallback(dh.onConnectionMigrated)

	// Start distributed components
	if err := nodeDiscovery.Start(ctx); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start node discovery: %w", err)
	}

	heartbeatManager.Start(ctx)

	// Subscribe to node failure events
	go dh.watchNodeFailures(ctx)

	return dh, nil
}

// Register registers a connection (overrides Hub.Register)
func (dh *DistributedHub) Register(conn *Connection) {
	// Call base Hub register
	dh.Hub.Register(conn)

	if !dh.enableDistributed {
		return
	}

	// Register in local cache
	dh.localMu.Lock()
	dh.localConnections[conn.ID] = conn
	dh.localMu.Unlock()

	// Register in Redis
	ctx, cancel := context.WithTimeout(dh.ctx, 5*time.Second)
	defer cancel()

	if err := dh.registry.RegisterConnection(ctx, conn, dh.nodeID); err != nil {
		dh.logger.Warn("Failed to register connection in Redis",
			log.String("connection_id", conn.ID),
			log.Err(err),
		)
	}

	// Register in heartbeat manager
	dh.heartbeatManager.RegisterConnection(conn)
}

// Unregister unregisters a connection (overrides Hub.Unregister)
func (dh *DistributedHub) Unregister(conn *Connection) {
	// Call base Hub unregister
	dh.Hub.Unregister(conn)

	if !dh.enableDistributed {
		return
	}

	// Remove from local cache
	dh.localMu.Lock()
	delete(dh.localConnections, conn.ID)
	dh.localMu.Unlock()

	// Unregister from Redis
	ctx, cancel := context.WithTimeout(dh.ctx, 5*time.Second)
	defer cancel()

	if err := dh.registry.UnregisterConnection(ctx, conn.ID); err != nil {
		dh.logger.Warn("Failed to unregister connection from Redis",
			log.String("connection_id", conn.ID),
			log.Err(err),
		)
	}

	// Unregister from heartbeat manager
	dh.heartbeatManager.UnregisterConnection(conn.ID)
}

// SendToUser sends to all user connections (overrides Hub.SendToUser)
func (dh *DistributedHub) SendToUser(userID string, data []byte) {
	if !dh.enableDistributed {
		// Use base implementation
		dh.Hub.SendToUser(userID, data)
		return
	}

	// Get all user connections from Redis
	ctx, cancel := context.WithTimeout(dh.ctx, 5*time.Second)
	defer cancel()

	connIDs, err := dh.registry.GetUserConnections(ctx, userID)
	if err != nil {
		dh.logger.Warn("Failed to get user connections from Redis",
			log.String("user_id", userID),
			log.Err(err),
		)
		// Fallback to local connections
		dh.Hub.SendToUser(userID, data)
		return
	}

	// Send to each connection
	for _, connID := range connIDs {
		// Check if connection is local
		dh.localMu.RLock()
		_, isLocal := dh.localConnections[connID]
		dh.localMu.RUnlock()

		if isLocal {
			// Send directly
			dh.Hub.SendToConnection(connID, data)
		} else {
			// Connection is on another node
			// For now, we'll just log it
			// In a full implementation, we might forward via gRPC or Redis Pub/Sub
			dh.logger.Debug("Connection on remote node, skipping",
				log.String("connection_id", connID),
				log.String("user_id", userID),
			)
		}
	}

	// Also send to local connections (in case Redis is out of sync)
	dh.Hub.SendToUser(userID, data)
}

// SelectNode selects a node for a new connection based on load balancing strategy
func (dh *DistributedHub) SelectNode(userID string) (string, error) {
	if !dh.enableDistributed {
		return dh.nodeID, nil
	}

	ctx, cancel := context.WithTimeout(dh.ctx, 5*time.Second)
	defer cancel()

	switch dh.loadBalancingStrategy {
	case "user_affinity":
		// Try to get existing node for user
		existingNode, err := dh.nodeDiscovery.GetNodeForUser(ctx, userID)
		if err == nil && existingNode != "" {
			return existingNode, nil
		}
		// Fall through to least_connections

	case "least_connections":
		node := dh.nodeDiscovery.GetLeastLoadedNode()
		if node != nil {
			return node.NodeID, nil
		}

	case "round_robin":
		// Simple round-robin implementation
		nodes := dh.nodeDiscovery.GetActiveNodes()
		if len(nodes) > 0 {
			// Use node ID hash for simple round-robin
			hash := 0
			for _, c := range userID {
				hash = hash*31 + int(c)
			}
			return nodes[hash%len(nodes)].NodeID, nil
		}
	}

	// Default to this node
	return dh.nodeID, nil
}

// onConnectionLost handles lost connections
func (dh *DistributedHub) onConnectionLost(connID string) {
	dh.logger.Info("Connection lost, cleaning up",
		log.String("connection_id", connID),
	)

	// Remove from local cache
	dh.localMu.Lock()
	conn, exists := dh.localConnections[connID]
	if exists {
		delete(dh.localConnections, connID)
	}
	dh.localMu.Unlock()

	// Close connection if exists
	if conn != nil {
		close(conn.Send)
	}
}

// onConnectionMigrated handles connection migrations
func (dh *DistributedHub) onConnectionMigrated(connID, fromNode, toNode string) {
	dh.logger.Info("Connection migrated",
		log.String("connection_id", connID),
		log.String("from_node", fromNode),
		log.String("to_node", toNode),
	)

	// If connection was migrated to this node, we might want to handle it
	// For now, we just log it
	if toNode == dh.nodeID {
		// Connection was migrated to this node
		// In a full implementation, we might want to try to reconnect
		dh.logger.Debug("Connection migrated to this node",
			log.String("connection_id", connID),
		)
	}
}

// watchNodeFailures watches for node failure events
func (dh *DistributedHub) watchNodeFailures(ctx context.Context) {
	// Subscribe to node events
	pubsub := dh.pools.GetRedis().Subscribe(ctx, "node:events")
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-dh.ctx.Done():
			return
		case msg := <-ch:
			var event struct {
				Type   string `json:"type"`
				NodeID string `json:"node_id"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				continue
			}

			if event.Type == "node_failed" && event.NodeID != dh.nodeID {
				// Handle node failure
				go func() {
					ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
					defer cancel()
					if err := dh.migration.HandleNodeFailure(ctx, event.NodeID); err != nil {
						dh.logger.Error("Failed to handle node failure",
							log.String("node_id", event.NodeID),
							log.Err(err),
						)
					}
				}()
			}
		}
	}
}

// Shutdown shuts down the distributed hub
func (dh *DistributedHub) Shutdown() {
	if dh.enableDistributed {
		// Stop distributed components
		dh.cancel()
		if dh.nodeDiscovery != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			dh.nodeDiscovery.Stop(ctx)
			cancel()
		}
		if dh.heartbeatManager != nil {
			dh.heartbeatManager.Stop()
		}
	}

	// Call base Hub shutdown
	dh.Hub.Shutdown()
}

// GetConnectionCount returns total connection count (local + distributed)
func (dh *DistributedHub) GetConnectionCount() int {
	if !dh.enableDistributed {
		return dh.Hub.ConnectionCount()
	}

	// Get local count
	localCount := len(dh.localConnections)

	// Get distributed count from Redis
	ctx, cancel := context.WithTimeout(dh.ctx, 5*time.Second)
	defer cancel()

	connIDs, err := dh.registry.GetNodeConnections(ctx, dh.nodeID)
	if err != nil {
		return localCount
	}

	// Return the larger of the two (in case of sync issues)
	if len(connIDs) > localCount {
		return len(connIDs)
	}
	return localCount
}

// IsUserOnline checks if a user is online (distributed check)
func (dh *DistributedHub) IsUserOnline(userID string) bool {
	if !dh.enableDistributed {
		return dh.Hub.IsUserOnline(userID)
	}

	ctx, cancel := context.WithTimeout(dh.ctx, 5*time.Second)
	defer cancel()

	connIDs, err := dh.registry.GetUserConnections(ctx, userID)
	if err != nil {
		// Fallback to local check
		return dh.Hub.IsUserOnline(userID)
	}

	return len(connIDs) > 0
}

