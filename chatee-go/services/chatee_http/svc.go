package main

import (
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/services/chatee_http/handler"
	"chatee-go/services/chatee_http/biz"
)

// ServiceContext holds all dependencies for the HTTP service
type ServiceContext struct {
	Config  *config.Config
	Logger  log.Logger
	Service *service.HTTPService
	Handler *handler.Handler
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

	// Initialize service (contains gRPC clients to other services)
	svc, err := service.NewHTTPService(cfg, logger)
	if err != nil {
		return nil, err
	}

	// Initialize handler
	h := handler.NewHandler(svc, logger)

	return &ServiceContext{
		Config:  cfg,
		Logger:  logger,
		Service: svc,
		Handler: h,
	}, nil
}

// Close closes all resources in the service context
func (ctx *ServiceContext) Close() error {
	if ctx.Service != nil {
		return ctx.Service.Close()
	}
	return nil
}

