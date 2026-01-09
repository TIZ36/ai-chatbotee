package main

import (
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
)

// ServiceContext holds all dependencies for the SVR RPC service
type ServiceContext struct {
	Config *config.Config
	Logger log.Logger
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

	// Initialize service
	svc := service.NewSVRService(logger)

	return &ServiceContext{
		Config:  cfg,
		Logger:  logger,
		Service: svc,
	}, nil
}

// Close closes all resources in the service context
func (ctx *ServiceContext) Close() error {
	// TODO: Close any resources if needed
	return nil
}
