package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// =============================================================================
// Repository Interfaces
// =============================================================================

// UserRepository handles user data operations.
type UserRepository interface {
	Create(ctx context.Context, user *User) error
	GetByID(ctx context.Context, id string) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	Update(ctx context.Context, user *User) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context, offset, limit int) ([]*User, error)
}

// SessionRepository handles session data operations.
type SessionRepository interface {
	Create(ctx context.Context, session *Session) error
	GetByID(ctx context.Context, id string) (*Session, error)
	GetByUserID(ctx context.Context, userID string, offset, limit int) ([]*Session, error)
	Update(ctx context.Context, session *Session) error
	Delete(ctx context.Context, id string) error
}

// AgentRepository handles agent data operations.
type AgentRepository interface {
	Create(ctx context.Context, agent *Agent) error
	GetByID(ctx context.Context, id string) (*Agent, error)
	GetByUserID(ctx context.Context, userID string) ([]*Agent, error)
	Update(ctx context.Context, agent *Agent) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context, offset, limit int) ([]*Agent, error)
}

// MessageRepository handles message data operations.
type MessageRepository interface {
	Create(ctx context.Context, message *Message) error
	GetByID(ctx context.Context, id string) (*Message, error)
	GetBySessionID(ctx context.Context, sessionID string, offset, limit int) ([]*Message, error)
	Update(ctx context.Context, message *Message) error
	Delete(ctx context.Context, id string) error
}

// LLMConfigRepository handles LLM configuration operations.
type LLMConfigRepository interface {
	Create(ctx context.Context, config *LLMConfig) error
	GetByID(ctx context.Context, id string) (*LLMConfig, error)
	GetByProvider(ctx context.Context, provider string) ([]*LLMConfig, error)
	GetDefault(ctx context.Context) (*LLMConfig, error)
	Update(ctx context.Context, config *LLMConfig) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context) ([]*LLMConfig, error)
}

// MCPServerRepository handles MCP server configuration operations.
type MCPServerRepository interface {
	Create(ctx context.Context, server *MCPServer) error
	GetByID(ctx context.Context, id string) (*MCPServer, error)
	GetByUserID(ctx context.Context, userID string) ([]*MCPServer, error)
	Update(ctx context.Context, server *MCPServer) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context) ([]*MCPServer, error)
}

// =============================================================================
// Entity Types
// =============================================================================

// User represents a user entity.
type User struct {
	ID          string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	Email       string          `gorm:"type:varchar(255);uniqueIndex;not null" json:"email"`
	Name        string          `gorm:"type:varchar(255);not null" json:"name"`
	Avatar      sql.NullString  `gorm:"type:varchar(512)" json:"avatar,omitempty"`
	Role        string          `gorm:"type:varchar(50);default:'user'" json:"role"`
	Preferences json.RawMessage `gorm:"type:json" json:"preferences,omitempty"`
	Metadata    json.RawMessage `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (User) TableName() string {
	return "users"
}

// Session represents a chat session.
type Session struct {
	ID        string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	UserID    string          `gorm:"type:varchar(64);index;not null" json:"user_id"`
	AgentID   string          `gorm:"type:varchar(64);index;not null" json:"agent_id"`
	Title     string          `gorm:"type:varchar(255);not null" json:"title"`
	Status    string          `gorm:"type:varchar(50);default:'active'" json:"status"` // active, archived
	Metadata  json.RawMessage `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Session) TableName() string {
	return "sessions"
}

// Agent represents an AI agent configuration.
type Agent struct {
	ID           string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	UserID       string          `gorm:"type:varchar(64);index;not null" json:"user_id"`
	Name         string          `gorm:"type:varchar(255);not null" json:"name"`
	Description  sql.NullString  `gorm:"type:text" json:"description,omitempty"`
	SystemPrompt string          `gorm:"type:text;not null" json:"system_prompt"`
	Model        string          `gorm:"type:varchar(100);not null" json:"model"`
	Provider     string          `gorm:"type:varchar(50);not null" json:"provider"`
	Persona      json.RawMessage `gorm:"type:json" json:"persona,omitempty"`
	MCPServers   json.RawMessage `gorm:"type:json" json:"mcp_servers,omitempty"`
	IsDefault    bool            `gorm:"default:false" json:"is_default"`
	IsPublic     bool            `gorm:"default:false" json:"is_public"`
	CreatedAt    time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Agent) TableName() string {
	return "agents"
}

// Message represents a chat message.
type Message struct {
	ID         string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	SessionID  string          `gorm:"type:varchar(64);index;not null" json:"session_id"`
	Role       string          `gorm:"type:varchar(50);not null" json:"role"` // user, assistant, system, tool
	Content    string          `gorm:"type:text;not null" json:"content"`
	ToolCalls  json.RawMessage `gorm:"type:json" json:"tool_calls,omitempty"`
	ToolCallID sql.NullString  `gorm:"type:varchar(64)" json:"tool_call_id,omitempty"`
	Metadata   json.RawMessage `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt  time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (Message) TableName() string {
	return "messages"
}

// LLMConfig represents an LLM provider configuration.
type LLMConfig struct {
	ID        string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	Name      string          `gorm:"type:varchar(255);not null" json:"name"`
	Provider  string          `gorm:"type:varchar(50);index;not null" json:"provider"` // openai, anthropic, deepseek
	APIKey    string          `gorm:"type:varchar(512);not null" json:"api_key"`
	BaseURL   sql.NullString  `gorm:"type:varchar(512)" json:"base_url,omitempty"`
	Models    json.RawMessage `gorm:"type:json" json:"models,omitempty"`
	IsDefault bool            `gorm:"default:false;index" json:"is_default"`
	IsEnabled bool            `gorm:"default:true;index" json:"is_enabled"`
	Settings  json.RawMessage `gorm:"type:json" json:"settings,omitempty"`
	CreatedAt time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (LLMConfig) TableName() string {
	return "llm_configs"
}

// MCPServer represents an MCP server configuration.
type MCPServer struct {
	ID          string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	UserID      string          `gorm:"type:varchar(64);index;not null" json:"user_id"`
	Name        string          `gorm:"type:varchar(255);not null" json:"name"`
	Description sql.NullString  `gorm:"type:text" json:"description,omitempty"`
	Type        string          `gorm:"type:varchar(50);not null" json:"type"` // http, sse, stdio
	URL         sql.NullString  `gorm:"type:varchar(512)" json:"url,omitempty"`
	Command     sql.NullString  `gorm:"type:varchar(512)" json:"command,omitempty"`
	Args        json.RawMessage `gorm:"type:json" json:"args,omitempty"`
	Env         json.RawMessage `gorm:"type:json" json:"env,omitempty"`
	Headers     json.RawMessage `gorm:"type:json" json:"headers,omitempty"`
	AuthType    string          `gorm:"type:varchar(50);default:'none'" json:"auth_type"` // none, bearer, oauth
	AuthConfig  json.RawMessage `gorm:"type:json" json:"auth_config,omitempty"`
	IsEnabled   bool            `gorm:"default:true" json:"is_enabled"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (MCPServer) TableName() string {
	return "mcp_servers"
}
