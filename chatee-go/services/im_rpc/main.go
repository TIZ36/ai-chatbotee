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
	threadpb "chatee-go/gen/im/thread"
	chatpb "chatee-go/gen/im/chat"
	"chatee-go/services/im_rpc/interceptor"
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
	logger.Info("Starting IM RPC service",
		log.String("name", cfg.Service.Name),
		log.String("version", cfg.Service.Version),
	)

	// Initialize snowflake ID generator
	if err := snowflake.Init(2); err != nil {
		logger.Fatal("Failed to init snowflake", log.Err(err))
	}

	// Create gRPC server with interceptors
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(interceptor.UnaryServerInterceptor(logger)),
		grpc.StreamInterceptor(interceptor.StreamServerInterceptor(logger)),
	)

	// Register handlers (using the handlers from ServiceContext)
	threadpb.RegisterThreadServiceServer(grpcServer, svcCtx.ThreadHandler)
	chatpb.RegisterChatServiceServer(grpcServer, svcCtx.ChatHandler)

	// Register health check
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("im_rpc", grpc_health_v1.HealthCheckResponse_SERVING)

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
	healthServer.SetServingStatus("im_rpc", grpc_health_v1.HealthCheckResponse_NOT_SERVING)
	grpcServer.GracefulStop()
	logger.Info("Server stopped")
}
