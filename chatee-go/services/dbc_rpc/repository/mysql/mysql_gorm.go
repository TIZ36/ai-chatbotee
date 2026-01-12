package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// =============================================================================
// MySQL Repositories Implementation using GORM
// =============================================================================

// MySQL User Repository
type mysqlUserRepository struct {
	db    *gorm.DB
	cache *redis.Client
}

func NewMySQLUserRepository(db *gorm.DB, cache *redis.Client) UserRepository {
	return &mysqlUserRepository{db: db, cache: cache}
}

func (r *mysqlUserRepository) Create(ctx context.Context, user *User) error {
	if err := r.db.WithContext(ctx).Create(user).Error; err != nil {
		return err
	}
	// Invalidate cache
	if r.cache != nil {
		r.cache.Del(ctx, fmt.Sprintf("user:%s", user.ID))
	}
	return nil
}

func (r *mysqlUserRepository) GetByID(ctx context.Context, id string) (*User, error) {
	cacheKey := fmt.Sprintf("user:%s", id)

	// Try cache first
	if r.cache != nil {
		if data, err := r.cache.Get(ctx, cacheKey).Bytes(); err == nil {
			var user User
			if json.Unmarshal(data, &user) == nil {
				return &user, nil
			}
		}
	}

	// Query database
	var user User
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&user).Error; err != nil {
		return nil, err
	}

	// Cache result
	if r.cache != nil {
		data, _ := json.Marshal(&user)
		r.cache.Set(ctx, cacheKey, data, 5*time.Minute)
	}

	return &user, nil
}

func (r *mysqlUserRepository) GetByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	if err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *mysqlUserRepository) Update(ctx context.Context, user *User) error {
	if err := r.db.WithContext(ctx).Model(user).Updates(user).Error; err != nil {
		return err
	}
	// Invalidate cache
	if r.cache != nil {
		r.cache.Del(ctx, fmt.Sprintf("user:%s", user.ID))
	}
	return nil
}

func (r *mysqlUserRepository) Delete(ctx context.Context, id string) error {
	if err := r.db.WithContext(ctx).Delete(&User{}, "id = ?", id).Error; err != nil {
		return err
	}
	// Invalidate cache
	if r.cache != nil {
		r.cache.Del(ctx, fmt.Sprintf("user:%s", id))
	}
	return nil
}

func (r *mysqlUserRepository) List(ctx context.Context, offset, limit int) ([]*User, error) {
	var users []*User
	if err := r.db.WithContext(ctx).Order("created_at DESC").Offset(offset).Limit(limit).Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
}

// MySQL Session Repository
type mysqlSessionRepository struct {
	db    *gorm.DB
	cache *redis.Client
}

func NewMySQLSessionRepository(db *gorm.DB, cache *redis.Client) SessionRepository {
	return &mysqlSessionRepository{db: db, cache: cache}
}

func (r *mysqlSessionRepository) Create(ctx context.Context, session *Session) error {
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *mysqlSessionRepository) GetByID(ctx context.Context, id string) (*Session, error) {
	var session Session
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *mysqlSessionRepository) GetByUserID(ctx context.Context, userID string, offset, limit int) ([]*Session, error) {
	var sessions []*Session
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&sessions).Error; err != nil {
		return nil, err
	}
	return sessions, nil
}

func (r *mysqlSessionRepository) Update(ctx context.Context, session *Session) error {
	return r.db.WithContext(ctx).Model(session).Updates(map[string]interface{}{
		"title":      session.Title,
		"status":     session.Status,
		"metadata":   session.Metadata,
		"updated_at": time.Now(),
	}).Error
}

func (r *mysqlSessionRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&Session{}, "id = ?", id).Error
}

// MySQL Agent Repository
type mysqlAgentRepository struct {
	db    *gorm.DB
	cache *redis.Client
}

func NewMySQLAgentRepository(db *gorm.DB, cache *redis.Client) AgentRepository {
	return &mysqlAgentRepository{db: db, cache: cache}
}

func (r *mysqlAgentRepository) Create(ctx context.Context, agent *Agent) error {
	return r.db.WithContext(ctx).Create(agent).Error
}

func (r *mysqlAgentRepository) GetByID(ctx context.Context, id string) (*Agent, error) {
	var agent Agent
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&agent).Error; err != nil {
		return nil, err
	}
	return &agent, nil
}

func (r *mysqlAgentRepository) GetByUserID(ctx context.Context, userID string) ([]*Agent, error) {
	var agents []*Agent
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&agents).Error; err != nil {
		return nil, err
	}
	return agents, nil
}

func (r *mysqlAgentRepository) Update(ctx context.Context, agent *Agent) error {
	return r.db.WithContext(ctx).Model(agent).Updates(agent).Error
}

func (r *mysqlAgentRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&Agent{}, "id = ?", id).Error
}

func (r *mysqlAgentRepository) List(ctx context.Context, offset, limit int) ([]*Agent, error) {
	var agents []*Agent
	if err := r.db.WithContext(ctx).
		Order("created_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&agents).Error; err != nil {
		return nil, err
	}
	return agents, nil
}

// MySQL Message Repository
type mysqlMessageRepository struct {
	db    *gorm.DB
	cache *redis.Client
}

func NewMySQLMessageRepository(db *gorm.DB, cache *redis.Client) MessageRepository {
	return &mysqlMessageRepository{db: db, cache: cache}
}

func (r *mysqlMessageRepository) Create(ctx context.Context, message *Message) error {
	return r.db.WithContext(ctx).Create(message).Error
}

func (r *mysqlMessageRepository) GetByID(ctx context.Context, id string) (*Message, error) {
	var message Message
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&message).Error; err != nil {
		return nil, err
	}
	return &message, nil
}

func (r *mysqlMessageRepository) GetBySessionID(ctx context.Context, sessionID string, offset, limit int) ([]*Message, error) {
	var messages []*Message
	if err := r.db.WithContext(ctx).
		Where("session_id = ?", sessionID).
		Order("created_at ASC").
		Offset(offset).
		Limit(limit).
		Find(&messages).Error; err != nil {
		return nil, err
	}
	return messages, nil
}

func (r *mysqlMessageRepository) Update(ctx context.Context, message *Message) error {
	return r.db.WithContext(ctx).Model(message).Updates(map[string]interface{}{
		"content":  message.Content,
		"metadata": message.Metadata,
	}).Error
}

func (r *mysqlMessageRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&Message{}, "id = ?", id).Error
}

// MySQL LLM Config Repository
type mysqlLLMConfigRepository struct {
	db    *gorm.DB
	cache *redis.Client
}

func NewMySQLLLMConfigRepository(db *gorm.DB, cache *redis.Client) LLMConfigRepository {
	return &mysqlLLMConfigRepository{db: db, cache: cache}
}

func (r *mysqlLLMConfigRepository) Create(ctx context.Context, config *LLMConfig) error {
	return r.db.WithContext(ctx).Create(config).Error
}

func (r *mysqlLLMConfigRepository) GetByID(ctx context.Context, id string) (*LLMConfig, error) {
	var config LLMConfig
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&config).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *mysqlLLMConfigRepository) GetByProvider(ctx context.Context, provider string) ([]*LLMConfig, error) {
	var configs []*LLMConfig
	if err := r.db.WithContext(ctx).
		Where("provider = ? AND is_enabled = ?", provider, true).
		Find(&configs).Error; err != nil {
		return nil, err
	}
	return configs, nil
}

func (r *mysqlLLMConfigRepository) GetDefault(ctx context.Context) (*LLMConfig, error) {
	var config LLMConfig
	if err := r.db.WithContext(ctx).
		Where("is_default = ? AND is_enabled = ?", true, true).
		First(&config).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *mysqlLLMConfigRepository) Update(ctx context.Context, config *LLMConfig) error {
	return r.db.WithContext(ctx).Model(config).Updates(config).Error
}

func (r *mysqlLLMConfigRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&LLMConfig{}, "id = ?", id).Error
}

func (r *mysqlLLMConfigRepository) List(ctx context.Context) ([]*LLMConfig, error) {
	var configs []*LLMConfig
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&configs).Error; err != nil {
		return nil, err
	}
	return configs, nil
}

// MySQL MCP Server Repository
type mysqlMCPServerRepository struct {
	db    *gorm.DB
	cache *redis.Client
}

func NewMySQLMCPServerRepository(db *gorm.DB, cache *redis.Client) MCPServerRepository {
	return &mysqlMCPServerRepository{db: db, cache: cache}
}

func (r *mysqlMCPServerRepository) Create(ctx context.Context, server *MCPServer) error {
	return r.db.WithContext(ctx).Create(server).Error
}

func (r *mysqlMCPServerRepository) GetByID(ctx context.Context, id string) (*MCPServer, error) {
	var server MCPServer
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&server).Error; err != nil {
		return nil, err
	}
	return &server, nil
}

func (r *mysqlMCPServerRepository) GetByUserID(ctx context.Context, userID string) ([]*MCPServer, error) {
	var servers []*MCPServer
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&servers).Error; err != nil {
		return nil, err
	}
	return servers, nil
}

func (r *mysqlMCPServerRepository) Update(ctx context.Context, server *MCPServer) error {
	return r.db.WithContext(ctx).Model(server).Updates(server).Error
}

func (r *mysqlMCPServerRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&MCPServer{}, "id = ?", id).Error
}

func (r *mysqlMCPServerRepository) List(ctx context.Context) ([]*MCPServer, error) {
	var servers []*MCPServer
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&servers).Error; err != nil {
		return nil, err
	}
	return servers, nil
}

// =============================================================================
// Repositories Factory
// =============================================================================

// Repositories holds all repository implementations.
type Repositories struct {
	User      UserRepository
	Session   SessionRepository
	Agent     AgentRepository
	Message   MessageRepository
	LLMConfig LLMConfigRepository
	MCPServer MCPServerRepository
}

// NewRepositories creates all repositories.
// db can be *gorm.DB or *sql.DB (will be converted to GORM)
func NewRepositories(db interface{}, redis *redis.Client) *Repositories {
	var gormDB *gorm.DB

	switch v := db.(type) {
	case *gorm.DB:
		gormDB = v
	case *sql.DB:
		// Convert sql.DB to GORM
		var err error
		gormDB, err = gorm.Open(mysql.New(mysql.Config{
			Conn: v,
		}), &gorm.Config{})
		if err != nil {
			panic(fmt.Sprintf("failed to create GORM instance: %v", err))
		}
	default:
		panic(fmt.Sprintf("unsupported database type: %T", db))
	}

	return &Repositories{
		User:      NewMySQLUserRepository(gormDB, redis),
		Session:   NewMySQLSessionRepository(gormDB, redis),
		Agent:     NewMySQLAgentRepository(gormDB, redis),
		Message:   NewMySQLMessageRepository(gormDB, redis),
		LLMConfig: NewMySQLLLMConfigRepository(gormDB, redis),
		MCPServer: NewMySQLMCPServerRepository(gormDB, redis),
	}
}
