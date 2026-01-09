package main

import (
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/services/im_rpc/handler"
	"chatee-go/services/im_rpc/biz"
	"chatee-go/services/im_rpc/biz/ai"
	"chatee-go/services/im_rpc/biz/chat"
	"chatee-go/services/im_rpc/biz/push"
	"chatee-go/services/im_rpc/biz/relationship"
	"chatee-go/services/im_rpc/biz/thread"
)

// ServiceContext holds all dependencies for the IM RPC service
type ServiceContext struct {
	Config      *config.Config
	Logger      log.Logger
	PoolManager *pool.PoolManager
	Clients     *service.Clients
	
	// Services
	RelationshipService *relationship.Service
	AIService           *ai.AIService
	ThreadCoreService   *thread.CoreService
	ChatCoreService     *chat.CoreService
	PushService         *push.PushService
	
	// Handlers
	ThreadHandler *handler.ThreadHandler
	ChatHandler   *handler.ChatHandler
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
	poolMgr, err := pool.NewPoolManager(pool.PoolManagerConfig{
		MySQL: &pool.MySQLConfig{
			Host:         cfg.MySQL.Host,
			Port:         cfg.MySQL.Port,
			User:         cfg.MySQL.User,
			Password:     cfg.MySQL.Password,
			Database:     cfg.MySQL.Database,
			MaxOpenConns: cfg.MySQL.MaxOpenConns,
			MaxIdleConns: cfg.MySQL.MaxIdleConns,
		},
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

	// Initialize gRPC clients
	clients, err := service.NewClients(cfg, logger)
	if err != nil {
		return nil, err
	}

	// Initialize relationship service
	relationshipSvc := relationship.NewService(relationship.Config{
		Pools:  poolMgr,
		Logger: logger,
	})

	// Initialize AI service
	aiSvc := ai.NewAIService(ai.Config{
		Logger: logger,
		Client: clients.Agent,
	})

	// Initialize HBase adapter (converts gRPC calls to repository interface)
	hbaseAdapter := service.NewHBaseAdapter(clients.HBaseThread, clients.HBaseChat)
	
	// Initialize thread core service
	threadCoreSvc := thread.NewCoreService(thread.Config{
		Logger:      logger,
		Pools:       poolMgr,
	}, hbaseAdapter, relationshipSvc, aiSvc)

	// Initialize chat core service
	chatCoreSvc := chat.NewCoreService(chat.Config{
		Logger: logger,
		Pools:  poolMgr,
	}, hbaseAdapter, aiSvc)

	// Initialize push service
	pushSvc := push.NewPushService(push.Config{
		Logger: logger,
		Pools:  poolMgr,
	})

	// Initialize handlers
	threadHandler := handler.NewThreadHandler(threadCoreSvc, clients, pushSvc, logger)
	chatHandler := handler.NewChatHandler(chatCoreSvc, clients, pushSvc, logger)

	return &ServiceContext{
		Config:              cfg,
		Logger:              logger,
		PoolManager:         poolMgr,
		Clients:             clients,
		RelationshipService: relationshipSvc,
		AIService:           aiSvc,
		ThreadCoreService:   threadCoreSvc,
		ChatCoreService:     chatCoreSvc,
		PushService:         pushSvc,
		ThreadHandler:       threadHandler,
		ChatHandler:         chatHandler,
	}, nil
}

// RegisterGRPC registers all gRPC services
func (ctx *ServiceContext) RegisterGRPC(server interface{}) {
	// This will be called from main.go with the gRPC server
	// The actual registration is done in main.go using the handlers
}

// Close closes all resources in the service context
func (ctx *ServiceContext) Close() error {
	var errs []error
	
	if ctx.Clients != nil {
		if err := ctx.Clients.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	
	if ctx.PoolManager != nil {
		if err := ctx.PoolManager.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	
	if len(errs) > 0 {
		return errs[0] // Return first error
	}
	return nil
}

