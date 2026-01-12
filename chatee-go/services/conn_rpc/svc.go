package main

import (
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	service "chatee-go/services/conn_rpc/biz"
)

// ServiceContext holds all dependencies for the Conn RPC service
type ServiceContext struct {
	Config *config.Config
	Logger log.Logger
	Hub    *service.Hub
	Pools  *pool.PoolManager
}

// NewServiceContext creates a new service context with all dependencies initialized
func NewServiceContext(cfg *config.Config) (*ServiceContext, error) {
	// Initialize logger
	if err := log.Init(log.LogConfig{
		Level:      cfg.Log.Level,
		Format:     cfg.Log.Format,
		OutputPath: cfg.Log.OutputPath,
		AddCaller:  true,
		MaxSize:    cfg.Log.MaxSize,
		MaxBackups: cfg.Log.MaxBackups,
		MaxAge:     cfg.Log.MaxAge,
		Compress:   true,
	}); err != nil {
		return nil, err
	}

	logger := log.Default()

	// Initialize connection pools
	pools, err := pool.NewPoolManager(pool.PoolManagerConfig{
		Redis: &pool.RedisConfig{
			Host:     cfg.Redis.Host,
			Port:     cfg.Redis.Port,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
			PoolSize: cfg.Redis.PoolSize,
		},
	})
	if err != nil {
		return nil, err
	}

	// Initialize base hub
	baseHub := service.NewHub(service.HubConfig{
		Logger:       logger,
		PingInterval: cfg.WebSocket.PingInterval,
		PongWait:     cfg.WebSocket.PongWait,
	})

	// Determine node ID
	nodeID := cfg.Connection.NodeID
	if nodeID == "" {
		nodeID = cfg.Service.NodeID
	}
	if nodeID == "" {
		nodeID = "node_1" // Default
	}

	// Initialize hub (distributed or regular)
	var hub *service.Hub
	if cfg.Connection.EnableDistributed {
		distributedHub, err := service.NewDistributedHub(
			baseHub,
			pools,
			logger,
			nodeID,
			true,
			cfg.Connection.HeartbeatInterval,
			cfg.Connection.HeartbeatTimeout,
			cfg.Connection.NodeHeartbeatInterval,
			cfg.Connection.NodeHeartbeatTimeout,
			cfg.Connection.LoadBalancingStrategy,
			cfg.HTTP.Host,
			cfg.HTTP.Port+1, // Use WebSocket port (HTTP port + 1)
		)
		if err != nil {
			logger.Warn("Failed to initialize distributed hub, falling back to regular hub",
				log.Err(err),
			)
			hub = baseHub
		} else {
			// DistributedHub embeds Hub, so we can use it as Hub
			hub = distributedHub.Hub
			logger.Info("Distributed hub initialized",
				log.String("node_id", nodeID),
				log.String("load_balancing", cfg.Connection.LoadBalancingStrategy),
			)
		}
	} else {
		hub = baseHub
		logger.Info("Regular hub initialized (distributed mode disabled)")
	}

	return &ServiceContext{
		Config: cfg,
		Logger: logger,
		Hub:    hub,
		Pools:  pools,
	}, nil
}

// Close closes all resources in the service context
func (ctx *ServiceContext) Close() error {
	if ctx.Hub != nil {
		ctx.Hub.Shutdown()
	}
	if ctx.Pools != nil {
		return ctx.Pools.Close()
	}
	return nil
}

