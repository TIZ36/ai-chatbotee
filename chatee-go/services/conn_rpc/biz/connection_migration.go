package service

import (
	"context"
	"fmt"

	"chatee-go/commonlib/log"
)

// =============================================================================
// Connection Migration
// =============================================================================

// ConnectionMigration handles connection migration when nodes fail
type ConnectionMigration struct {
	registry      ConnectionRegistry
	nodeDiscovery *NodeDiscovery
	logger        log.Logger
	onMigration   func(connID, fromNode, toNode string)
}

// NewConnectionMigration creates a new connection migration handler
func NewConnectionMigration(registry ConnectionRegistry, nodeDiscovery *NodeDiscovery, logger log.Logger) *ConnectionMigration {
	return &ConnectionMigration{
		registry:      registry,
		nodeDiscovery: nodeDiscovery,
		logger:        logger,
	}
}

// SetMigrationCallback sets the callback for connection migrations
func (cm *ConnectionMigration) SetMigrationCallback(callback func(connID, fromNode, toNode string)) {
	cm.onMigration = callback
}

// MigrateNodeConnections migrates all connections from a failed node to another node
func (cm *ConnectionMigration) MigrateNodeConnections(ctx context.Context, failedNodeID string) error {
	// Get all connections from the failed node
	connIDs, err := cm.registry.GetNodeConnections(ctx, failedNodeID)
	if err != nil {
		return fmt.Errorf("failed to get node connections: %w", err)
	}

	if len(connIDs) == 0 {
		cm.logger.Info("No connections to migrate", log.String("node_id", failedNodeID))
		return nil
	}

	// Select target node (least loaded)
	targetNode := cm.nodeDiscovery.GetLeastLoadedNode()
	if targetNode == nil {
		return fmt.Errorf("no available target node for migration")
	}

	// Don't migrate to the same node (shouldn't happen, but check anyway)
	if targetNode.NodeID == failedNodeID {
		return fmt.Errorf("cannot migrate to the same node")
	}

	cm.logger.Info("Starting connection migration",
		log.String("from_node", failedNodeID),
		log.String("to_node", targetNode.NodeID),
		log.Int("connection_count", len(connIDs)),
	)

	// Migrate each connection
	migrated := 0
	for _, connID := range connIDs {
		if err := cm.MigrateConnection(ctx, connID, failedNodeID, targetNode.NodeID); err != nil {
			cm.logger.Warn("Failed to migrate connection",
				log.String("connection_id", connID),
				log.Err(err),
			)
			continue
		}
		migrated++

		// Call callback if set
		if cm.onMigration != nil {
			cm.onMigration(connID, failedNodeID, targetNode.NodeID)
		}
	}

	cm.logger.Info("Connection migration completed",
		log.String("from_node", failedNodeID),
		log.String("to_node", targetNode.NodeID),
		log.Int("total", len(connIDs)),
		log.Int("migrated", migrated),
	)

	return nil
}

// MigrateConnection migrates a single connection to a new node
func (cm *ConnectionMigration) MigrateConnection(ctx context.Context, connID, fromNodeID, toNodeID string) error {
	// Get connection info
	info, err := cm.registry.GetConnection(ctx, connID)
	if err != nil {
		return fmt.Errorf("failed to get connection info: %w", err)
	}

	// Verify connection is on the source node
	if info.NodeID != fromNodeID {
		return fmt.Errorf("connection is not on source node: expected %s, got %s", fromNodeID, info.NodeID)
	}

	// Use the registry's UpdateConnectionNode method if available
	if redisRegistry, ok := cm.registry.(*RedisConnectionRegistry); ok {
		return redisRegistry.UpdateConnectionNode(ctx, connID, toNodeID)
	}

	// Fallback: manual update (should not happen if using RedisConnectionRegistry)
	return fmt.Errorf("registry does not support node update")
}

// HandleNodeFailure handles a node failure event
func (cm *ConnectionMigration) HandleNodeFailure(ctx context.Context, failedNodeID string) error {
	cm.logger.Info("Handling node failure", log.String("node_id", failedNodeID))
	return cm.MigrateNodeConnections(ctx, failedNodeID)
}

