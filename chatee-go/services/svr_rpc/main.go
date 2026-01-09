package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	"chatee-go/commonlib/actor"
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/llm"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/mcp"
	"chatee-go/commonlib/pool"
	"chatee-go/commonlib/snowflake"
	agentmod "chatee-go/services/svr_rpc/biz/agent"
	llmmod "chatee-go/services/svr_rpc/biz/llm"
	mcpmod "chatee-go/services/svr_rpc/biz/mcp"
	usermod "chatee-go/services/svr_rpc/biz/user"
	"chatee-go/services/svr_rpc/interceptor"
)

func main() {
	// Load configuration
	cfg, err := config.Load("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Initialize ServiceContext
	svcCtx, err := NewServiceContext(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to init service context: %v\n", err)
		os.Exit(1)
	}
	defer svcCtx.Close()

	logger := svcCtx.Logger
	logger.Info("Starting SVR RPC service",
		log.String("name", cfg.Service.Name),
		log.String("version", cfg.Service.Version),
	)

	// Initialize snowflake ID generator
	if err := snowflake.Init(4); err != nil {
		logger.Fatal("Failed to init snowflake", log.Err(err))
	}

	// Initialize connection pools
	pools := pool.NewPoolManager()
	mysqlPool, err := pool.NewMySQLPool(
		cfg.MySQL.Host,
		cfg.MySQL.Port,
		cfg.MySQL.User,
		cfg.MySQL.Password,
		cfg.MySQL.Database,
		cfg.MySQL.MaxOpenConns,
		cfg.MySQL.MaxIdleConns,
	)
	if err != nil {
		logger.Fatal("Failed to create MySQL pool", log.Err(err))
	}
	pools.SetMySQL(mysqlPool)

	redisPool := pool.NewRedisPool(
		cfg.Redis.Host,
		cfg.Redis.Port,
		cfg.Redis.Password,
		cfg.Redis.DB,
		cfg.Redis.PoolSize,
	)
	pools.SetRedis(redisPool)

	// Initialize LLM providers
	llmRegistry := llm.NewRegistry()
	for name, providerCfg := range cfg.LLM.Providers {
		provider, err := llm.CreateProvider(name, providerCfg.APIKey, providerCfg.BaseURL, providerCfg.DefaultModel)
		if err != nil {
			logger.Warn("Failed to create LLM provider",
				log.String("name", name),
				log.Err(err),
			)
			continue
		}
		llmRegistry.Register(name, provider)
	}

	// Initialize MCP manager
	mcpManager := mcp.NewManager()
	for _, serverCfg := range cfg.MCP.Servers {
		err := mcpManager.AddServer(serverCfg.Name, serverCfg.URL, &mcp.AuthConfig{
			Type:   serverCfg.AuthType,
			Token:  serverCfg.AuthToken,
			Header: serverCfg.AuthHeader,
		})
		if err != nil {
			logger.Warn("Failed to add MCP server",
				log.String("name", serverCfg.Name),
				log.Err(err),
			)
		}
	}

	// Initialize Actor system
	actorSystem := actor.NewActorSystem(actor.SystemConfig{
		Name:              "svr_rpc",
		DefaultBufferSize: 1000,
		OnError: func(actorID string, err error) {
			logger.Error("Actor error", log.String("actor_id", actorID), log.Err(err))
		},
		OnActorStopped: func(actorID string) {
			logger.Info("Actor stopped", log.String("actor_id", actorID))
		},
	})

	// Create service modules
	agentService := agentmod.NewService(agentmod.Config{
		Logger:      logger,
		Pools:       pools,
		LLMRegistry: llmRegistry,
		MCPManager:  mcpManager,
		ActorSystem: actorSystem,
	})

	llmService := llmmod.NewService(llmmod.Config{
		Logger:   logger,
		Pools:    pools,
		Registry: llmRegistry,
	})

	mcpService := mcpmod.NewService(mcpmod.Config{
		Logger:  logger,
		Pools:   pools,
		Manager: mcpManager,
	})

	userService := usermod.NewService(usermod.Config{
		Logger:      logger,
		Pools:       pools,
		ActorSystem: actorSystem,
	})

	// Create gRPC server with interceptors
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(interceptor.UnaryServerInterceptor(logger)),
		grpc.StreamInterceptor(interceptor.StreamServerInterceptor(logger)),
	)

	// Register services
	agentmod.RegisterGRPC(grpcServer, agentService)
	llmmod.RegisterGRPC(grpcServer, llmService)
	mcpmod.RegisterGRPC(grpcServer, mcpService)
	usermod.RegisterGRPC(grpcServer, userService)

	// Register health check
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("svr_rpc", grpc_health_v1.HealthCheckResponse_SERVING)

	// Enable reflection for development
	if cfg.IsDev() {
		reflection.Register(grpcServer)
	}

	// Start listening
	addr := cfg.GetGRPCAddr()
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Fatal("Failed to listen", log.String("addr", addr), log.Err(err))
	}

	// Start server in goroutine
	go func() {
		logger.Info("gRPC server started", log.String("addr", addr))
		if err := grpcServer.Serve(listener); err != nil {
			logger.Fatal("gRPC server failed", log.Err(err))
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	// Graceful shutdown
	logger.Info("Shutting down server...")
	healthServer.SetServingStatus("svr_rpc", grpc_health_v1.HealthCheckResponse_NOT_SERVING)
	actorSystem.Shutdown()
	pools.Close()
	grpcServer.GracefulStop()
	logger.Info("Server stopped")
}
