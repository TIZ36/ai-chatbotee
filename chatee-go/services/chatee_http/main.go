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
	"chatee-go/services/chatee_http/handler"
	"chatee-go/services/chatee_http/middleware"
)

func main() {
	// Load configuration
	cfg, err := config.Load("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Initialize ServiceContext (includes logger, service, handler)
	svcCtx, err := NewServiceContext(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to init service context: %v\n", err)
		os.Exit(1)
	}
	defer svcCtx.Close()

	logger := svcCtx.Logger
	logger.Info("Starting ChateeHTTP service",
		log.String("name", cfg.Service.Name),
		log.String("version", cfg.Service.Version),
	)

	// Initialize snowflake ID generator
	if err := snowflake.Init(2); err != nil {
		logger.Fatal("Failed to init snowflake", log.Err(err))
	}

	// Setup Gin
	if cfg.IsProd() {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Add middlewares
	router.Use(middleware.RequestID())
	router.Use(middleware.Logger(logger))
	router.Use(middleware.Recovery(logger))
	if cfg.HTTP.EnableCORS {
		router.Use(middleware.CORS(cfg.HTTP.CORSOrigins))
	}

	// Register routes
	RegisterRoutes(router, svcCtx.Handler)

	// Create HTTP server
	server := &http.Server{
		Addr:         cfg.GetHTTPAddr(),
		Handler:      router,
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}

	// Start server in goroutine
	go func() {
		logger.Info("HTTP server started", log.String("addr", cfg.GetHTTPAddr()))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("HTTP server failed", log.Err(err))
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	// Graceful shutdown
	logger.Info("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("Server forced to shutdown", log.Err(err))
	}
	logger.Info("Server stopped")
}

// RegisterRoutes registers all HTTP routes.
func RegisterRoutes(router *gin.Engine, h *handler.Handler) {
	// Health check
	router.GET("/health", h.Health)
	router.GET("/ready", h.Ready)

	// API v1
	v1 := router.Group("/api/v1")

	// Auth routes
	{
		auth := v1.Group("/auth")
		auth.POST("/login", h.Login)
		auth.POST("/logout", h.Logout)
		auth.POST("/refresh", h.RefreshToken)
	}

	// Sync routes (for reconnection)
	{
		sync := v1.Group("/sync")
		sync.GET("/incremental", h.GetIncrementalMessages)
		sync.GET("/unread-counts", h.GetUnreadCounts)
		sync.GET("/unread-messages", h.GetUnreadMessages)
	}

	// User routes
	{
		users := v1.Group("/users")
		users.GET("/:id", h.GetUser)
		users.PUT("/:id", h.UpdateUser)
		users.GET("/:id/sessions", h.GetUserSessions)
		users.GET("/:id/agents", h.GetUserAgents)
		users.GET("/:id/follow-feed", h.GetFollowFeed)
		users.GET("/:id/reply-inbox", h.GetReplyInbox)
		users.GET("/:id/connections", h.GetUserConnections)
		users.GET("/:id/connection-status", h.GetConnectionStatus)
	}

	// Session routes
	{
		sessions := v1.Group("/sessions")
		sessions.POST("", h.CreateSession)
		sessions.GET("/:id", h.GetSession)
		sessions.PUT("/:id", h.UpdateSession)
		sessions.DELETE("/:id", h.DeleteSession)
		sessions.GET("/:id/messages", h.GetSessionMessages)
	}

	// Agent routes
	{
		agents := v1.Group("/agents")
		agents.POST("", h.CreateAgent)
		agents.GET("/:id", h.GetAgent)
		agents.PUT("/:id", h.UpdateAgent)
		agents.DELETE("/:id", h.DeleteAgent)
		agents.GET("", h.ListAgents)
	}

	// Chat routes (for real-time messaging)
	{
		chat := v1.Group("/chat")
		chat.POST("/send", h.SendMessage)
		chat.POST("/stream", h.StreamMessage)
	}

	// LLM config routes
	{
		llm := v1.Group("/llm")
		llm.POST("/configs", h.CreateLLMConfig)
		llm.GET("/configs", h.ListLLMConfigs)
		llm.GET("/configs/:id", h.GetLLMConfig)
		llm.PUT("/configs/:id", h.UpdateLLMConfig)
		llm.DELETE("/configs/:id", h.DeleteLLMConfig)
		llm.GET("/models", h.ListModels)
	}

	// Config management routes (require admin authentication)
	{
		config := v1.Group("/config", middleware.AdminAuth())
		{
			// Agent CRUD
			config.POST("/agents", h.CreateAgent)
			config.GET("/agents", h.ListAgents)
			config.GET("/agents/:id", h.GetAgent)
			config.PUT("/agents/:id", h.UpdateAgent)
			config.DELETE("/agents/:id", h.DeleteAgent)

			// LLM Config CRUD (already implemented above, but can add admin-only endpoints)
			// MCP Server CRUD (already implemented above, but can add admin-only endpoints)
		}
	}

	// MCP routes
	{
		mcp := v1.Group("/mcp")
		mcp.POST("/servers", h.CreateMCPServer)
		mcp.GET("/servers", h.ListMCPServers)
		mcp.GET("/servers/:id", h.GetMCPServer)
		mcp.PUT("/servers/:id", h.UpdateMCPServer)
		mcp.DELETE("/servers/:id", h.DeleteMCPServer)
		mcp.POST("/servers/:id/connect", h.ConnectMCPServer)
		mcp.POST("/servers/:id/disconnect", h.DisconnectMCPServer)
		mcp.GET("/servers/:id/tools", h.ListMCPTools)
		mcp.POST("/servers/:id/tools/:tool/call", h.CallMCPTool)
	}

	// Thread routes (topic-based messaging)
	{
		threads := v1.Group("/threads")
		threads.POST("", h.CreateThread)
		threads.GET("/:id", h.GetThread)
		threads.PUT("/:id", h.UpdateThread)
		threads.DELETE("/:id", h.DeleteThread)
		threads.GET("", h.ListThreads)
		threads.POST("/:id/replies", h.CreateReply)
		threads.GET("/:id/replies", h.ListReplies)
		threads.GET("/:id/messages", h.GetThreadMessages)
		threads.POST("/sync", h.SyncThreadHistory)
		threads.POST("/follow-feed/sync", h.SyncFollowFeed)
		threads.POST("/reply-inbox/sync", h.SyncReplyInbox)
	}

	// Admin routes (require admin authentication)
	{
		admin := v1.Group("/admin", middleware.AdminAuth())
		{
			// Admin Thread routes
			adminThreads := admin.Group("/threads")
			adminThreads.POST("", h.AdminCreateThread)
			adminThreads.POST("/:id/replies", h.AdminCreateReply)
			adminThreads.DELETE("/:id/messages/:msgId", h.AdminDeleteMessage)
			adminThreads.PUT("/:id", h.AdminUpdateThread)

			// Admin Chat routes
			adminChats := admin.Group("/chats")
			adminChats.POST("", h.AdminCreateChat)
			adminChats.DELETE("/:id", h.AdminDeleteChat)
			adminChats.POST("/:id/participants", h.AdminManageParticipants)
		}
	}

	// Group chat routes
	{
		chats := v1.Group("/chats")
		chats.POST("", h.CreateChat)
		chats.GET("/:id", h.GetChat)
		chats.PUT("/:id", h.UpdateChat)
		chats.DELETE("/:id", h.DeleteChat)
		chats.GET("", h.ListChats)
		chats.GET("/:id/messages", h.GetChatMessages)
		chats.POST("/:id/participants", h.AddParticipant)
		chats.DELETE("/:id/participants/:userId", h.RemoveParticipant)
		chats.GET("/:id/channels", h.ListChannels)
		chats.POST("/:id/channels", h.CreateChannel)
		chats.POST("/sync", h.SyncChatHistory)
	}
}
