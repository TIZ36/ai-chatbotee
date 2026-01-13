package test

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	dbc "chatee-go/gen/dbc"
)

const (
	// dbc_rpc 服务地址
	dbcAddr = "localhost:9080"
)

// getConnection 创建 gRPC 连接
func getConnection(t *testing.T) *grpc.ClientConn {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, dbcAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		t.Fatalf("Failed to connect to dbc_rpc: %v", err)
	}
	return conn
}

// =============================================================================
// User Service Tests
// =============================================================================

func TestUserService_CreateAndGet(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	client := dbc.NewUserServiceClient(conn)
	ctx := context.Background()

	// Create user
	createReq := &dbc.CreateUserRequest{
		Email: "test_" + time.Now().Format("20060102150405") + "@example.com",
		Name:  "Test User",
		Role:  "user",
	}

	user, err := client.CreateUser(ctx, createReq)
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	t.Logf("Created user: id=%s, email=%s, name=%s", user.Id, user.Email, user.Name)

	if user.Id == "" {
		t.Error("User ID should not be empty")
	}
	if user.Email != createReq.Email {
		t.Errorf("Email mismatch: got %s, want %s", user.Email, createReq.Email)
	}

	// Get user by ID
	getResp, err := client.GetUser(ctx, &dbc.GetUserRequest{Id: user.Id})
	if err != nil {
		t.Fatalf("GetUser failed: %v", err)
	}

	if getResp.Id != user.Id {
		t.Errorf("GetUser ID mismatch: got %s, want %s", getResp.Id, user.Id)
	}

	t.Logf("GetUser success: %+v", getResp)

	// Get user by email
	getByEmailResp, err := client.GetUserByEmail(ctx, &dbc.GetUserByEmailRequest{Email: user.Email})
	if err != nil {
		t.Fatalf("GetUserByEmail failed: %v", err)
	}

	if getByEmailResp.Email != user.Email {
		t.Errorf("GetUserByEmail mismatch: got %s, want %s", getByEmailResp.Email, user.Email)
	}

	t.Logf("GetUserByEmail success: %+v", getByEmailResp)
}

func TestUserService_Update(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	client := dbc.NewUserServiceClient(conn)
	ctx := context.Background()

	// Create user first
	createReq := &dbc.CreateUserRequest{
		Email: "update_test_" + time.Now().Format("20060102150405") + "@example.com",
		Name:  "Original Name",
		Role:  "user",
	}

	user, err := client.CreateUser(ctx, createReq)
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Update user
	updateReq := &dbc.UpdateUserRequest{
		Id:   user.Id,
		Name: "Updated Name",
		Role: "admin",
	}

	updated, err := client.UpdateUser(ctx, updateReq)
	if err != nil {
		t.Fatalf("UpdateUser failed: %v", err)
	}

	if updated.Name != "Updated Name" {
		t.Errorf("Name not updated: got %s, want Updated Name", updated.Name)
	}

	t.Logf("UpdateUser success: %+v", updated)
}

// =============================================================================
// Session Service Tests
// =============================================================================

func TestSessionService_CreateAndGet(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	userClient := dbc.NewUserServiceClient(conn)
	sessionClient := dbc.NewSessionServiceClient(conn)
	ctx := context.Background()

	// Create a user first
	user, err := userClient.CreateUser(ctx, &dbc.CreateUserRequest{
		Email: "session_test_" + time.Now().Format("20060102150405") + "@example.com",
		Name:  "Session Test User",
		Role:  "user",
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Create session
	createReq := &dbc.CreateSessionRequest{
		UserId: user.Id,
		Title:  "Test Session",
	}

	session, err := sessionClient.CreateSession(ctx, createReq)
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	t.Logf("Created session: id=%s, user_id=%s, title=%s", session.Id, session.UserId, session.Title)

	if session.Id == "" {
		t.Error("Session ID should not be empty")
	}

	// Get session
	getResp, err := sessionClient.GetSession(ctx, &dbc.GetSessionRequest{Id: session.Id})
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}

	if getResp.Id != session.Id {
		t.Errorf("Session ID mismatch: got %s, want %s", getResp.Id, session.Id)
	}

	t.Logf("GetSession success: %+v", getResp)

	// Get sessions by user
	listResp, err := sessionClient.GetSessionsByUser(ctx, &dbc.GetSessionsByUserRequest{
		UserId: user.Id,
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("GetSessionsByUser failed: %v", err)
	}

	if len(listResp.Sessions) == 0 {
		t.Error("Expected at least 1 session")
	}

	t.Logf("GetSessionsByUser: found %d sessions", len(listResp.Sessions))
}

// =============================================================================
// Agent Service Tests
// =============================================================================

func TestAgentService_CreateAndGet(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	userClient := dbc.NewUserServiceClient(conn)
	agentClient := dbc.NewAgentServiceClient(conn)
	ctx := context.Background()

	// Create a user first
	user, err := userClient.CreateUser(ctx, &dbc.CreateUserRequest{
		Email: "agent_test_" + time.Now().Format("20060102150405") + "@example.com",
		Name:  "Agent Test User",
		Role:  "user",
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Create agent
	createReq := &dbc.CreateAgentRequest{
		UserId:       user.Id,
		Name:         "Test Agent",
		Description:  "A test agent for unit testing",
		SystemPrompt: "You are a helpful assistant.",
		Model:        "gpt-4",
		Provider:     "openai",
		IsDefault:    true,
		IsPublic:     false,
	}

	agent, err := agentClient.CreateAgent(ctx, createReq)
	if err != nil {
		t.Fatalf("CreateAgent failed: %v", err)
	}

	t.Logf("Created agent: id=%s, name=%s, model=%s", agent.Id, agent.Name, agent.Model)

	if agent.Id == "" {
		t.Error("Agent ID should not be empty")
	}

	// Get agent
	getResp, err := agentClient.GetAgent(ctx, &dbc.GetAgentRequest{Id: agent.Id})
	if err != nil {
		t.Fatalf("GetAgent failed: %v", err)
	}

	if getResp.Name != "Test Agent" {
		t.Errorf("Agent name mismatch: got %s, want Test Agent", getResp.Name)
	}

	t.Logf("GetAgent success: %+v", getResp)

	// Get agents by user
	listResp, err := agentClient.GetAgentsByUser(ctx, &dbc.GetAgentsByUserRequest{
		UserId: user.Id,
	})
	if err != nil {
		t.Fatalf("GetAgentsByUser failed: %v", err)
	}

	if len(listResp.Agents) == 0 {
		t.Error("Expected at least 1 agent")
	}

	t.Logf("GetAgentsByUser: found %d agents", len(listResp.Agents))
}

// =============================================================================
// Message Service Tests
// =============================================================================

func TestMessageService_CreateAndGet(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	userClient := dbc.NewUserServiceClient(conn)
	sessionClient := dbc.NewSessionServiceClient(conn)
	messageClient := dbc.NewMessageServiceClient(conn)
	ctx := context.Background()

	// Create user
	user, err := userClient.CreateUser(ctx, &dbc.CreateUserRequest{
		Email: "msg_test_" + time.Now().Format("20060102150405") + "@example.com",
		Name:  "Message Test User",
		Role:  "user",
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Create session
	session, err := sessionClient.CreateSession(ctx, &dbc.CreateSessionRequest{
		UserId: user.Id,
		Title:  "Message Test Session",
	})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// Create messages
	messages := []struct {
		role    string
		content string
	}{
		{"user", "Hello, how are you?"},
		{"assistant", "I'm doing well, thank you! How can I help you today?"},
		{"user", "Tell me a joke."},
	}

	var createdMsgIDs []string
	for _, m := range messages {
		msg, err := messageClient.CreateMessage(ctx, &dbc.CreateMessageRequest{
			SessionId: session.Id,
			Role:      m.role,
			Content:   m.content,
		})
		if err != nil {
			t.Fatalf("CreateMessage failed: %v", err)
		}
		createdMsgIDs = append(createdMsgIDs, msg.Id)
		t.Logf("Created message: id=%s, role=%s", msg.Id, msg.Role)
	}

	// Get messages by session
	listResp, err := messageClient.GetMessagesBySession(ctx, &dbc.GetMessagesBySessionRequest{
		SessionId: session.Id,
		Limit:     50,
	})
	if err != nil {
		t.Fatalf("GetMessagesBySession failed: %v", err)
	}

	if len(listResp.Messages) != 3 {
		t.Errorf("Expected 3 messages, got %d", len(listResp.Messages))
	}

	t.Logf("GetMessagesBySession: found %d messages", len(listResp.Messages))
}

// =============================================================================
// Cache Service Tests (Redis)
// =============================================================================

func TestCacheService_SetAndGet(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	client := dbc.NewCacheServiceClient(conn)
	ctx := context.Background()

	testKey := "test_key_" + time.Now().Format("20060102150405")
	testValue := "test_value_hello_world"

	// Set
	setResp, err := client.Set(ctx, &dbc.SetRequest{
		Key:        testKey,
		Value:      testValue,
		TtlSeconds: 60,
	})
	if err != nil {
		t.Fatalf("Set failed: %v", err)
	}

	if !setResp.Success {
		t.Error("Set should return success=true")
	}

	t.Logf("Set success: key=%s", testKey)

	// Get
	getResp, err := client.Get(ctx, &dbc.GetRequest{Key: testKey})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if !getResp.Exists {
		t.Error("Key should exist")
	}

	if getResp.Value != testValue {
		t.Errorf("Value mismatch: got %s, want %s", getResp.Value, testValue)
	}

	t.Logf("Get success: value=%s", getResp.Value)

	// Exists
	existsResp, err := client.Exists(ctx, &dbc.ExistsRequest{Key: testKey})
	if err != nil {
		t.Fatalf("Exists failed: %v", err)
	}

	if !existsResp.Exists {
		t.Error("Key should exist")
	}

	// Delete
	deleteResp, err := client.Delete(ctx, &dbc.DeleteRequest{Key: testKey})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	if !deleteResp.Success {
		t.Error("Delete should return success=true")
	}

	// Verify deleted
	getResp2, err := client.Get(ctx, &dbc.GetRequest{Key: testKey})
	if err != nil {
		t.Fatalf("Get after delete failed: %v", err)
	}

	if getResp2.Exists {
		t.Error("Key should not exist after delete")
	}

	t.Log("Delete and verify success")
}

func TestCacheService_HashOperations(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	client := dbc.NewCacheServiceClient(conn)
	ctx := context.Background()

	hashKey := "test_hash_" + time.Now().Format("20060102150405")

	// HSet
	hsetResp, err := client.HSet(ctx, &dbc.HSetRequest{
		Key:   hashKey,
		Field: "name",
		Value: "Alice",
	})
	if err != nil {
		t.Fatalf("HSet failed: %v", err)
	}

	t.Logf("HSet success: %v", hsetResp.Success)

	// HGet
	hgetResp, err := client.HGet(ctx, &dbc.HGetRequest{
		Key:   hashKey,
		Field: "name",
	})
	if err != nil {
		t.Fatalf("HGet failed: %v", err)
	}

	if hgetResp.Value != "Alice" {
		t.Errorf("HGet value mismatch: got %s, want Alice", hgetResp.Value)
	}

	t.Logf("HGet success: value=%s", hgetResp.Value)

	// Clean up
	client.Delete(ctx, &dbc.DeleteRequest{Key: hashKey})
}

// =============================================================================
// LLM Config Service Tests
// =============================================================================

func TestLLMConfigService_CreateAndGet(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	client := dbc.NewLLMConfigServiceClient(conn)
	ctx := context.Background()

	// Create LLM config
	createReq := &dbc.CreateLLMConfigRequest{
		Name:      "Test OpenAI Config",
		Provider:  "openai",
		ApiKey:    "sk-test-key-" + time.Now().Format("20060102150405"),
		BaseUrl:   "https://api.openai.com/v1",
		Models:    []byte(`["gpt-4", "gpt-3.5-turbo"]`),
		IsDefault: false,
		IsEnabled: true,
	}

	config, err := client.CreateLLMConfig(ctx, createReq)
	if err != nil {
		t.Fatalf("CreateLLMConfig failed: %v", err)
	}

	t.Logf("Created LLM config: id=%s, name=%s, provider=%s", config.Id, config.Name, config.Provider)

	if config.Id == "" {
		t.Error("LLM Config ID should not be empty")
	}

	// Get LLM config
	getResp, err := client.GetLLMConfig(ctx, &dbc.GetLLMConfigRequest{Id: config.Id})
	if err != nil {
		t.Fatalf("GetLLMConfig failed: %v", err)
	}

	if getResp.Provider != "openai" {
		t.Errorf("Provider mismatch: got %s, want openai", getResp.Provider)
	}

	t.Logf("GetLLMConfig success: %+v", getResp)

	// List LLM configs
	listResp, err := client.ListLLMConfigs(ctx, &dbc.ListLLMConfigsRequest{})
	if err != nil {
		t.Fatalf("ListLLMConfigs failed: %v", err)
	}

	t.Logf("ListLLMConfigs: found %d configs", len(listResp.Configs))
}

// =============================================================================
// MCP Server Service Tests
// =============================================================================

func TestMCPServerService_CreateAndGet(t *testing.T) {
	conn := getConnection(t)
	defer conn.Close()

	userClient := dbc.NewUserServiceClient(conn)
	mcpClient := dbc.NewMCPServerServiceClient(conn)
	ctx := context.Background()

	// Create user first
	user, err := userClient.CreateUser(ctx, &dbc.CreateUserRequest{
		Email: "mcp_test_" + time.Now().Format("20060102150405") + "@example.com",
		Name:  "MCP Test User",
		Role:  "user",
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Create MCP server
	createReq := &dbc.CreateMCPServerRequest{
		UserId:      user.Id,
		Name:        "Test MCP Server",
		Description: "A test MCP server",
		Type:        "stdio",
		Command:     "python",
		Args:        []byte(`["-m", "mcp_server"]`),
		IsEnabled:   true,
	}

	server, err := mcpClient.CreateMCPServer(ctx, createReq)
	if err != nil {
		t.Fatalf("CreateMCPServer failed: %v", err)
	}

	t.Logf("Created MCP server: id=%s, name=%s, type=%s", server.Id, server.Name, server.Type)

	if server.Id == "" {
		t.Error("MCP Server ID should not be empty")
	}

	// Get MCP server
	getResp, err := mcpClient.GetMCPServer(ctx, &dbc.GetMCPServerRequest{Id: server.Id})
	if err != nil {
		t.Fatalf("GetMCPServer failed: %v", err)
	}

	if getResp.Type != "stdio" {
		t.Errorf("Type mismatch: got %s, want stdio", getResp.Type)
	}

	t.Logf("GetMCPServer success: %+v", getResp)

	// Get MCP servers by user
	listResp, err := mcpClient.GetMCPServersByUser(ctx, &dbc.GetMCPServersByUserRequest{
		UserId: user.Id,
	})
	if err != nil {
		t.Fatalf("GetMCPServersByUser failed: %v", err)
	}

	if len(listResp.Servers) == 0 {
		t.Error("Expected at least 1 MCP server")
	}

	t.Logf("GetMCPServersByUser: found %d servers", len(listResp.Servers))
}
