package main

import (
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/services/conn_rpc/biz"
)

// ServiceContext holds all dependencies for the Conn RPC service
type ServiceContext struct {
	Config *config.Config
	Logger log.Logger
	Hub    *service.Hub
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

	// Initialize hub
	h := service.NewHub(service.HubConfig{
		Logger:       logger,
		PingInterval: cfg.WebSocket.PingInterval,
		PongWait:     cfg.WebSocket.PongWait,
	})

	return &ServiceContext{
		Config: cfg,
		Logger: logger,
		Hub:    h,
	}, nil
}

// Close closes all resources in the service context
func (ctx *ServiceContext) Close() error {
	if ctx.Hub != nil {
		ctx.Hub.Shutdown()
	}
	return nil
}

