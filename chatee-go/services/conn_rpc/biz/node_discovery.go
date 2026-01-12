package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"chatee-go/commonlib/log"
)

// =============================================================================
// Node Discovery
// =============================================================================

// NodeInfo represents node information
type NodeInfo struct {
	NodeID         string `json:"node_id"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	Status         string `json:"status"` // active, inactive
	ConnectionCount int   `json:"connection_count"`
	LastHeartbeat  int64  `json:"last_heartbeat"`
}

// NodeDiscovery manages node discovery and health monitoring
type NodeDiscovery struct {
	redis      *redis.Client
	logger     log.Logger
	nodeID     string
	host       string
	port       int
	nodes      map[string]*NodeInfo
	mu         sync.RWMutex
	heartbeatInterval time.Duration
	heartbeatTimeout  time.Duration
	done       chan struct{}
}

// NewNodeDiscovery creates a new node discovery instance
func NewNodeDiscovery(redisClient *redis.Client, logger log.Logger, nodeID, host string, port int, heartbeatInterval, heartbeatTimeout time.Duration) *NodeDiscovery {
	return &NodeDiscovery{
		redis:             redisClient,
		logger:            logger,
		nodeID:            nodeID,
		host:              host,
		port:              port,
		nodes:             make(map[string]*NodeInfo),
		heartbeatInterval: heartbeatInterval,
		heartbeatTimeout:  heartbeatTimeout,
		done:              make(chan struct{}),
	}
}

// Start starts the node discovery service
func (nd *NodeDiscovery) Start(ctx context.Context) error {
	// Register this node
	if err := nd.registerNode(ctx); err != nil {
		return fmt.Errorf("failed to register node: %w", err)
	}

	// Start heartbeat loop
	go nd.heartbeatLoop(ctx)

	// Start node monitoring loop
	go nd.monitorNodes(ctx)

	// Start Redis Pub/Sub for node events
	go nd.subscribeNodeEvents(ctx)

	nd.logger.Info("Node discovery started", log.String("node_id", nd.nodeID))
	return nil
}

// Stop stops the node discovery service
func (nd *NodeDiscovery) Stop(ctx context.Context) error {
	close(nd.done)
	
	// Unregister this node
	if err := nd.unregisterNode(ctx); err != nil {
		nd.logger.Warn("Failed to unregister node", log.Err(err))
	}

	nd.logger.Info("Node discovery stopped", log.String("node_id", nd.nodeID))
	return nil
}

// registerNode registers this node in Redis
func (nd *NodeDiscovery) registerNode(ctx context.Context) error {
	info := &NodeInfo{
		NodeID:         nd.nodeID,
		Host:           nd.host,
		Port:           nd.port,
		Status:         "active",
		ConnectionCount: 0,
		LastHeartbeat:  time.Now().Unix(),
	}

	data, err := json.Marshal(info)
	if err != nil {
		return fmt.Errorf("failed to marshal node info: %w", err)
	}

	registryKey := fmt.Sprintf("node:registry:%s", nd.nodeID)
	err = nd.redis.Set(ctx, registryKey, data, nd.heartbeatTimeout).Err()
	if err != nil {
		return fmt.Errorf("failed to register node: %w", err)
	}

	// Publish node registration event
	nd.publishNodeEvent(ctx, "node_registered", nd.nodeID)

	nd.logger.Info("Node registered", log.String("node_id", nd.nodeID))
	return nil
}

// unregisterNode unregisters this node from Redis
func (nd *NodeDiscovery) unregisterNode(ctx context.Context) error {
	registryKey := fmt.Sprintf("node:registry:%s", nd.nodeID)
	err := nd.redis.Del(ctx, registryKey).Err()
	if err != nil {
		return fmt.Errorf("failed to unregister node: %w", err)
	}

	// Publish node unregistration event
	nd.publishNodeEvent(ctx, "node_unregistered", nd.nodeID)

	nd.logger.Info("Node unregistered", log.String("node_id", nd.nodeID))
	return nil
}

// heartbeatLoop periodically updates node heartbeat
func (nd *NodeDiscovery) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(nd.heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-nd.done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := nd.updateHeartbeat(ctx); err != nil {
				nd.logger.Warn("Failed to update heartbeat", log.Err(err))
			}
		}
	}
}

// updateHeartbeat updates node heartbeat
func (nd *NodeDiscovery) updateHeartbeat(ctx context.Context) error {
	registryKey := fmt.Sprintf("node:registry:%s", nd.nodeID)
	
	// Get current node info
	data, err := nd.redis.Get(ctx, registryKey).Result()
	if err == redis.Nil {
		// Node not registered, re-register
		return nd.registerNode(ctx)
	}
	if err != nil {
		return fmt.Errorf("failed to get node info: %w", err)
	}

	var info NodeInfo
	if err := json.Unmarshal([]byte(data), &info); err != nil {
		return fmt.Errorf("failed to unmarshal node info: %w", err)
	}

	// Update heartbeat
	info.LastHeartbeat = time.Now().Unix()
	
	// Get connection count
	connIDs, err := nd.redis.SMembers(ctx, fmt.Sprintf("node:connections:%s", nd.nodeID)).Result()
	if err == nil {
		info.ConnectionCount = len(connIDs)
	}

	// Save updated info
	updatedData, err := json.Marshal(info)
	if err != nil {
		return fmt.Errorf("failed to marshal node info: %w", err)
	}

	err = nd.redis.Set(ctx, registryKey, updatedData, nd.heartbeatTimeout).Err()
	if err != nil {
		return fmt.Errorf("failed to update heartbeat: %w", err)
	}

	return nil
}

// monitorNodes periodically checks for node failures
func (nd *NodeDiscovery) monitorNodes(ctx context.Context) {
	ticker := time.NewTicker(nd.heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-nd.done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			nd.checkNodeHealth(ctx)
		}
	}
}

// checkNodeHealth checks health of all nodes
func (nd *NodeDiscovery) checkNodeHealth(ctx context.Context) {
	// Get all node registry keys
	keys, err := nd.redis.Keys(ctx, "node:registry:*").Result()
	if err != nil {
		nd.logger.Warn("Failed to get node keys", log.Err(err))
		return
	}

	now := time.Now().Unix()
	timeout := int64(nd.heartbeatTimeout.Seconds())

	nd.mu.Lock()
	defer nd.mu.Unlock()

	for _, key := range keys {
		data, err := nd.redis.Get(ctx, key).Result()
		if err != nil {
			continue
		}

		var info NodeInfo
		if err := json.Unmarshal([]byte(data), &info); err != nil {
			continue
		}

		// Check if node is alive
		if now-info.LastHeartbeat > timeout {
			// Node is dead
			if info.Status == "active" {
				nd.logger.Warn("Node heartbeat timeout", 
					log.String("node_id", info.NodeID),
					log.Int64("last_heartbeat", info.LastHeartbeat),
				)
				// Mark as inactive
				info.Status = "inactive"
				nd.nodes[info.NodeID] = &info
				nd.publishNodeEvent(ctx, "node_failed", info.NodeID)
			}
		} else {
			// Node is alive
			nd.nodes[info.NodeID] = &info
		}
	}
}

// subscribeNodeEvents subscribes to node events via Redis Pub/Sub
func (nd *NodeDiscovery) subscribeNodeEvents(ctx context.Context) {
	pubsub := nd.redis.Subscribe(ctx, "node:events")
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-nd.done:
			return
		case <-ctx.Done():
			return
		case msg := <-ch:
			nd.handleNodeEvent(ctx, msg.Payload)
		}
	}
}

// handleNodeEvent handles node events
func (nd *NodeDiscovery) handleNodeEvent(ctx context.Context, payload string) {
	var event struct {
		Type   string `json:"type"`
		NodeID string `json:"node_id"`
	}
	
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		nd.logger.Warn("Failed to unmarshal node event", log.Err(err))
		return
	}

	nd.mu.Lock()
	defer nd.mu.Unlock()

	switch event.Type {
	case "node_registered", "node_heartbeat":
		// Refresh node info
		nd.refreshNodeInfo(ctx, event.NodeID)
	case "node_unregistered", "node_failed":
		// Remove node
		delete(nd.nodes, event.NodeID)
	}
}

// refreshNodeInfo refreshes node information from Redis
func (nd *NodeDiscovery) refreshNodeInfo(ctx context.Context, nodeID string) {
	registryKey := fmt.Sprintf("node:registry:%s", nodeID)
	data, err := nd.redis.Get(ctx, registryKey).Result()
	if err != nil {
		return
	}

	var info NodeInfo
	if err := json.Unmarshal([]byte(data), &info); err != nil {
		return
	}

	nd.nodes[nodeID] = &info
}

// publishNodeEvent publishes a node event
func (nd *NodeDiscovery) publishNodeEvent(ctx context.Context, eventType, nodeID string) {
	event := map[string]string{
		"type":   eventType,
		"node_id": nodeID,
	}
	data, _ := json.Marshal(event)
	nd.redis.Publish(ctx, "node:events", data)
}

// GetActiveNodes returns all active nodes
func (nd *NodeDiscovery) GetActiveNodes() []*NodeInfo {
	nd.mu.RLock()
	defer nd.mu.RUnlock()

	nodes := make([]*NodeInfo, 0, len(nd.nodes))
	for _, node := range nd.nodes {
		if node.Status == "active" {
			nodes = append(nodes, node)
		}
	}
	return nodes
}

// GetNode returns node information by ID
func (nd *NodeDiscovery) GetNode(nodeID string) (*NodeInfo, bool) {
	nd.mu.RLock()
	defer nd.mu.RUnlock()
	node, ok := nd.nodes[nodeID]
	return node, ok
}

// GetLeastLoadedNode returns the node with the least connections
func (nd *NodeDiscovery) GetLeastLoadedNode() *NodeInfo {
	nd.mu.RLock()
	defer nd.mu.RUnlock()

	var leastLoaded *NodeInfo
	minConnections := int(^uint(0) >> 1) // Max int

	for _, node := range nd.nodes {
		if node.Status == "active" && node.ConnectionCount < minConnections {
			minConnections = node.ConnectionCount
			leastLoaded = node
		}
	}

	return leastLoaded
}

// GetNodeForUser returns the node that has connections for a user (affinity)
func (nd *NodeDiscovery) GetNodeForUser(ctx context.Context, userID string) (string, error) {
	// Check which node has connections for this user
	keys, err := nd.redis.Keys(ctx, "user:connections:*").Result()
	if err != nil {
		return "", err
	}

	userKey := fmt.Sprintf("user:connections:%s", userID)
	for _, key := range keys {
		if key == userKey {
			// User has connections, find which node
			connIDs, err := nd.redis.SMembers(ctx, userKey).Result()
			if err != nil || len(connIDs) == 0 {
				continue
			}

			// Get first connection's node
			registryKey := fmt.Sprintf("conn:registry:%s", connIDs[0])
			data, err := nd.redis.Get(ctx, registryKey).Result()
			if err != nil {
				continue
			}

			var connInfo struct {
				NodeID string `json:"node_id"`
			}
			if err := json.Unmarshal([]byte(data), &connInfo); err == nil {
				return connInfo.NodeID, nil
			}
		}
	}

	return "", nil
}

