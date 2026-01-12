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

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/snowflake"
	"chatee-go/services/dbc_rpc/interceptor"
	"chatee-go/services/dbc_rpc/server"
)

func main() {
	// Load configuration (empty path uses default search paths: ./configs/config.yaml)
	cfg, err := config.Load("./config/config.yaml")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Initialize ServiceContext (includes logger, pools, repos, service)
	svcCtx, err := server.NewServiceContext(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to init service context: %v\n", err)
		os.Exit(1)
	}
	defer svcCtx.Close()

	logger := svcCtx.Logger
	logger.Info("Starting DBC RPC service",
		log.String("name", cfg.Service.Name),
		log.String("version", cfg.Service.Version),
	)

	// Initialize snowflake ID generator
	if err := snowflake.Init(1); err != nil {
		logger.Fatal("Failed to init snowflake", log.Err(err))
	}

	// Health check
	healthResults := svcCtx.PoolManager.HealthCheck(context.Background())
	for name, err := range healthResults {
		if err != nil {
			logger.Warn("Pool health check failed",
				log.String("pool", name),
				log.Err(err),
			)
		} else {
			logger.Info("Pool healthy", log.String("pool", name))
		}
	}

	// Create gRPC server with interceptors
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(interceptor.UnaryServerInterceptor(logger)),
		grpc.StreamInterceptor(interceptor.StreamServerInterceptor(logger)),
		grpc.MaxRecvMsgSize(cfg.GRPC.MaxRecvMsgSize),
		grpc.MaxSendMsgSize(cfg.GRPC.MaxSendMsgSize),
	)

	// Register services

	// Create DBC service with service context
	services := server.NewDBCService(svcCtx)
	services.RegisterGRPC(grpcServer)

	// Register health service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("dbc_rpc", grpc_health_v1.HealthCheckResponse_SERVING)

	// Enable reflection for debugging
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

	logger.Info("Shutting down server...")
	grpcServer.GracefulStop()
	logger.Info("Server stopped")
}
