package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/snowflake"
	"chatee-go/services/conn_rpc/biz"
	"chatee-go/services/conn_rpc/handler"
)

func main() {
	// Load configuration
	cfg, err := config.Load("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Initialize ServiceContext (includes logger, hub)
	svcCtx, err := NewServiceContext(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to init service context: %v\n", err)
		os.Exit(1)
	}
	defer svcCtx.Close()

	logger := svcCtx.Logger
	logger.Info("Starting Conn RPC service",
		log.String("name", cfg.Service.Name),
		log.String("version", cfg.Service.Version),
	)

	// Initialize snowflake ID generator
	if err := snowflake.Init(3); err != nil {
		logger.Fatal("Failed to init snowflake", log.Err(err))
	}

	// Setup Gin
	if cfg.IsProd() {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Recovery())

	// Start hub
	go svcCtx.Hub.Run()

	// Initialize SVR client for user actor integration
	svrClient, err := service.NewSVRClient(logger)
	if err != nil {
		logger.Warn("Failed to initialize SVR client, user actor features will be disabled", log.Err(err))
		svrClient = nil
	}
	defer func() {
		if svrClient != nil {
			svrClient.Close()
		}
	}()

	// Initialize IM client for thread/chat operations
	imClient, err := service.NewIMClient(logger)
	if err != nil {
		logger.Warn("Failed to initialize IM client, thread/chat features will be disabled", log.Err(err))
		imClient = nil
	}
	defer func() {
		if imClient != nil {
			imClient.Close()
		}
	}()

	// WebSocket endpoints (WS and WSS)
	router.GET("/ws", func(c *gin.Context) {
		handler.HandleWebSocket(c, svcCtx.Hub, cfg.WebSocket, logger, svrClient, imClient)
	})
	router.GET("/wss", func(c *gin.Context) {
		handler.HandleWebSocket(c, svcCtx.Hub, cfg.WebSocket, logger, svrClient, imClient)
	})

	// Health endpoints
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":      "ok",
			"connections": svcCtx.Hub.ConnectionCount(),
		})
	})

	// Create HTTP server for WS/WSS
	// Note: WSS can be handled by a reverse proxy (nginx, etc.) that terminates TLS
	wsServer := &http.Server{
		Addr:    fmt.Sprintf("%s:%d", cfg.HTTP.Host, cfg.HTTP.Port+1), // Use HTTP port + 1 for WS
		Handler: router,
	}

	// Start WS server
	go func() {
		logger.Info("WebSocket server started", log.String("addr", wsServer.Addr))
		if err := wsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("WebSocket server failed", log.Err(err))
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	// Graceful shutdown
	logger.Info("Shutting down server...")
	svcCtx.Hub.Shutdown() // Stop hub

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := wsServer.Shutdown(ctx); err != nil {
		logger.Error("Server forced to shutdown", log.Err(err))
	}

	logger.Info("Server stopped")
}
