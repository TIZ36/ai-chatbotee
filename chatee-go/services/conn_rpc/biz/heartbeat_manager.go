package service

import (
	"context"
	"sync"
	"time"

	"chatee-go/commonlib/log"
)

// =============================================================================
// Heartbeat Manager
// =============================================================================

// HeartbeatManager manages connection heartbeats
type HeartbeatManager struct {
	registry          ConnectionRegistry
	logger            log.Logger
	interval          time.Duration
	timeout           time.Duration
	connections       map[string]*Connection
	mu                sync.RWMutex
	done              chan struct{}
	onConnectionLost  func(connID string)
}

// NewHeartbeatManager creates a new heartbeat manager
func NewHeartbeatManager(registry ConnectionRegistry, logger log.Logger, interval, timeout time.Duration) *HeartbeatManager {
	return &HeartbeatManager{
		registry:    registry,
		logger:      logger,
		interval:    interval,
		timeout:     timeout,
		connections: make(map[string]*Connection),
		done:        make(chan struct{}),
	}
}

// SetConnectionLostCallback sets the callback for lost connections
func (hm *HeartbeatManager) SetConnectionLostCallback(callback func(connID string)) {
	hm.onConnectionLost = callback
}

// Start starts the heartbeat manager
func (hm *HeartbeatManager) Start(ctx context.Context) {
	go hm.heartbeatLoop(ctx)
	hm.logger.Info("Heartbeat manager started")
}

// Stop stops the heartbeat manager
func (hm *HeartbeatManager) Stop() {
	close(hm.done)
	hm.logger.Info("Heartbeat manager stopped")
}

// RegisterConnection registers a connection for heartbeat monitoring
func (hm *HeartbeatManager) RegisterConnection(conn *Connection) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	hm.connections[conn.ID] = conn
}

// UnregisterConnection unregisters a connection from heartbeat monitoring
func (hm *HeartbeatManager) UnregisterConnection(connID string) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	delete(hm.connections, connID)
}

// heartbeatLoop periodically updates heartbeats and checks for expired connections
func (hm *HeartbeatManager) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(hm.interval)
	defer ticker.Stop()

	for {
		select {
		case <-hm.done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			hm.updateHeartbeats(ctx)
			hm.checkExpiredConnections(ctx)
		}
	}
}

// updateHeartbeats updates heartbeats for all registered connections
func (hm *HeartbeatManager) updateHeartbeats(ctx context.Context) {
	hm.mu.RLock()
	conns := make([]*Connection, 0, len(hm.connections))
	for _, conn := range hm.connections {
		conns = append(conns, conn)
	}
	hm.mu.RUnlock()

	for _, conn := range conns {
		// Update last active time
		conn.LastActive = time.Now()

		// Update heartbeat in Redis
		if err := hm.registry.UpdateHeartbeat(ctx, conn.ID); err != nil {
			hm.logger.Warn("Failed to update heartbeat",
				log.String("connection_id", conn.ID),
				log.Err(err),
			)
		}
	}
}

// checkExpiredConnections checks for expired connections
func (hm *HeartbeatManager) checkExpiredConnections(ctx context.Context) {
	hm.mu.RLock()
	conns := make([]*Connection, 0, len(hm.connections))
	for _, conn := range hm.connections {
		conns = append(conns, conn)
	}
	hm.mu.RUnlock()

	now := time.Now()
	expired := make([]string, 0)

	for _, conn := range conns {
		// Check if connection heartbeat is expired
		online, err := hm.registry.IsConnectionOnline(ctx, conn.ID)
		if err != nil || !online {
			// Also check local last active time
			if now.Sub(conn.LastActive) > hm.timeout {
				expired = append(expired, conn.ID)
			}
		}
	}

	// Handle expired connections
	for _, connID := range expired {
		hm.logger.Warn("Connection heartbeat expired",
			log.String("connection_id", connID),
		)

		// Remove from local tracking
		hm.UnregisterConnection(connID)

		// Call callback if set
		if hm.onConnectionLost != nil {
			hm.onConnectionLost(connID)
		}
	}
}

// GetConnectionCount returns the number of monitored connections
func (hm *HeartbeatManager) GetConnectionCount() int {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	return len(hm.connections)
}

