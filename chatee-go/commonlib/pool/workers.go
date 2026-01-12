package pool

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// =============================================================================
// GORM Worker Implementation
// =============================================================================

// GORMWorkerConfig configures GORM worker
type GORMWorkerConfig struct {
	Host         string
	Port         int
	User         string
	Password     string
	Database     string
	MaxOpenConns int
	MaxIdleConns int
}

// GORMWorker implements Worker interface for GORM database
// Note: GORM itself doesn't provide connection pooling, but it uses database/sql
// which provides connection pooling. We configure the pool through sql.DB settings.
type GORMWorker struct {
	name   string
	db     *gorm.DB
	config *GORMWorkerConfig
}

// Type returns the worker type
func (w *GORMWorker) Type() WorkerType {
	return WorkerTypeGORM
}

// NewGORMWorker creates a new GORM worker
func NewGORMWorker(name string) *GORMWorker {
	return &GORMWorker{
		name: name,
	}
}

// Name returns the worker's name
func (w *GORMWorker) Name() string {
	return w.name
}

// Init initializes the GORM worker with configuration
func (w *GORMWorker) Init(ctx context.Context, config interface{}) error {
	cfg, ok := config.(*GORMWorkerConfig)
	if !ok {
		// Try to parse from map or other types if needed
		return fmt.Errorf("GORMWorker: invalid config type, expected *GORMWorkerConfig")
	}

	w.config = cfg

	// Build DSN
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Database)

	// Open database connection
	sqlDB, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("failed to open MySQL connection: %w", err)
	}

	// Set connection pool settings
	sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// Test connection
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(pingCtx); err != nil {
		sqlDB.Close()
		return fmt.Errorf("failed to ping MySQL: %w", err)
	}

	// Create GORM instance
	gormDB, err := gorm.Open(mysql.New(mysql.Config{
		Conn: sqlDB,
	}), &gorm.Config{})
	if err != nil {
		sqlDB.Close()
		return fmt.Errorf("failed to create GORM instance: %w", err)
	}

	w.db = gormDB
	return nil
}

// Health checks if the GORM worker is healthy
func (w *GORMWorker) Health(ctx context.Context) error {

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	sqlDB, err := w.db.DB()
	if err != nil {
		return fmt.Errorf("failed to get sql.DB from GORM: %w", err)
	}

	return sqlDB.PingContext(pingCtx)
}

// Use executes a function with the GORM database instance
func (w *GORMWorker) Use(ctx context.Context, fn func(resource interface{}) error) error {
	if w.db == nil {
		return fmt.Errorf("GORM worker not initialized")
	}
	return fn(w.db)
}

// UseWithData executes a function with GORM database and data
func (w *GORMWorker) UseWithData(ctx context.Context, data interface{}, fn func(resource interface{}, data interface{}) error) error {
	if w.db == nil {
		return fmt.Errorf("GORM worker not initialized")
	}
	return fn(w.db, data)
}

// Close closes the GORM worker
func (w *GORMWorker) Close() error {
	sqlDB, err := w.db.DB()
	if err != nil {
		return fmt.Errorf("failed to get sql.DB from GORM: %w", err)
	}
	return sqlDB.Close()
}

// GetDB returns the underlying GORM DB instance (for direct access if needed)
func (w *GORMWorker) GetDB() *gorm.DB {
	return w.db
}

// GetSQLDB returns the underlying sql.DB instance
func (w *GORMWorker) GetSQLDB() (*sql.DB, error) {
	return w.db.DB()
}

// =============================================================================
// Redis Worker Implementation
// =============================================================================

// RedisWorkerConfig configures Redis worker
type RedisWorkerConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
	PoolSize int
}

// RedisWorker implements Worker interface for Redis
type RedisWorker struct {
	name   string
	client *redis.Client
	config *RedisWorkerConfig
}

// Type returns the worker type
func (w *RedisWorker) Type() WorkerType {
	return WorkerTypeRedis
}

// NewRedisWorker creates a new Redis worker
func NewRedisWorker(name string) *RedisWorker {
	return &RedisWorker{
		name: name,
	}
}

// Name returns the worker's name
func (w *RedisWorker) Name() string {
	return w.name
}

// Init initializes the Redis worker with configuration
func (w *RedisWorker) Init(ctx context.Context, config interface{}) error {
	cfg, ok := config.(*RedisWorkerConfig)
	if !ok {
		return fmt.Errorf("RedisWorker: invalid config type, expected *RedisWorkerConfig")
	}

	w.config = cfg

	// Create Redis client
	client := redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Password:     cfg.Password,
		DB:           cfg.DB,
		PoolSize:     cfg.PoolSize,
		MinIdleConns: 10,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	w.client = client

	// Test connection
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := client.Ping(pingCtx).Err(); err != nil {
		client.Close()
		return fmt.Errorf("failed to ping Redis: %w", err)
	}

	return nil
}

// Health checks if the Redis worker is healthy
func (w *RedisWorker) Health(ctx context.Context) error {
	if w.client == nil {
		return fmt.Errorf("Redis worker not initialized")
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	return w.client.Ping(pingCtx).Err()
}

// Use executes a function with the Redis client
func (w *RedisWorker) Use(ctx context.Context, fn func(resource interface{}) error) error {
	if w.client == nil {
		return fmt.Errorf("Redis worker not initialized")
	}
	return fn(w.client)
}

// UseWithData executes a function with Redis client and data
func (w *RedisWorker) UseWithData(ctx context.Context, data interface{}, fn func(resource interface{}, data interface{}) error) error {
	if w.client == nil {
		return fmt.Errorf("Redis worker not initialized")
	}
	return fn(w.client, data)
}

// Close closes the Redis worker
func (w *RedisWorker) Close() error {
	if w.client != nil {
		return w.client.Close()
	}
	return nil
}

// GetClient returns the underlying Redis client (for direct access if needed)
func (w *RedisWorker) GetClient() *redis.Client {
	return w.client
}

// =============================================================================
// Helper Functions for Common Configurations
// =============================================================================

// NewGORMWorkerFromConfig creates and initializes a GORM worker from config
func NewGORMWorkerFromConfig(ctx context.Context, name string, config *GORMWorkerConfig) (*GORMWorker, error) {
	worker := NewGORMWorker(name)
	if err := worker.Init(ctx, config); err != nil {
		return nil, err
	}
	return worker, nil
}

// NewRedisWorkerFromConfig creates and initializes a Redis worker from config
func NewRedisWorkerFromConfig(ctx context.Context, name string, config *RedisWorkerConfig) (*RedisWorker, error) {
	worker := NewRedisWorker(name)
	if err := worker.Init(ctx, config); err != nil {
		return nil, err
	}
	return worker, nil
}

// =============================================================================
// HTTP Client Worker Implementation
// =============================================================================

// HTTPClientWorkerConfig configures HTTP client worker
type HTTPClientWorkerConfig struct {
	// Timeout is the maximum time to wait for a request to complete
	Timeout time.Duration
	// MaxIdleConns is the maximum number of idle connections
	MaxIdleConns int
	// MaxIdleConnsPerHost is the maximum number of idle connections per host
	MaxIdleConnsPerHost int
	// MaxConnsPerHost limits the total number of connections per host
	MaxConnsPerHost int
	// IdleConnTimeout is the maximum amount of time an idle connection will remain idle
	IdleConnTimeout time.Duration
	// DisableCompression disables compression
	DisableCompression bool
	// TLS configuration can be added here if needed
}

// HTTPClientWorker implements Worker interface for HTTP client
// HTTP client uses connection pooling through http.Transport
type HTTPClientWorker struct {
	name   string
	client *http.Client
	config *HTTPClientWorkerConfig
}

// NewHTTPClientWorker creates a new HTTP client worker
func NewHTTPClientWorker(name string) *HTTPClientWorker {
	return &HTTPClientWorker{
		name: name,
	}
}

// Type returns the worker type
func (w *HTTPClientWorker) Type() WorkerType {
	return WorkerTypeHTTPClient
}

// Name returns the worker's name
func (w *HTTPClientWorker) Name() string {
	return w.name
}

// Init initializes the HTTP client worker with configuration
func (w *HTTPClientWorker) Init(ctx context.Context, config interface{}) error {
	cfg, ok := config.(*HTTPClientWorkerConfig)
	if !ok {
		return fmt.Errorf("HTTPClientWorker: invalid config type, expected *HTTPClientWorkerConfig")
	}

	w.config = cfg

	// Set defaults
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	maxIdleConns := cfg.MaxIdleConns
	if maxIdleConns == 0 {
		maxIdleConns = 100
	}

	maxIdleConnsPerHost := cfg.MaxIdleConnsPerHost
	if maxIdleConnsPerHost == 0 {
		maxIdleConnsPerHost = 10
	}

	idleConnTimeout := cfg.IdleConnTimeout
	if idleConnTimeout == 0 {
		idleConnTimeout = 90 * time.Second
	}

	// Create transport with connection pooling
	transport := &http.Transport{
		MaxIdleConns:        maxIdleConns,
		MaxIdleConnsPerHost: maxIdleConnsPerHost,
		MaxConnsPerHost:     cfg.MaxConnsPerHost,
		IdleConnTimeout:     idleConnTimeout,
		DisableCompression:  cfg.DisableCompression,
	}

	// Create HTTP client
	w.client = &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}

	return nil
}

// Health checks if the HTTP client worker is healthy
// For HTTP client, we consider it healthy if it's initialized
func (w *HTTPClientWorker) Health(ctx context.Context) error {
	if w.client == nil {
		return fmt.Errorf("HTTP client worker not initialized")
	}
	// HTTP client doesn't have a direct health check endpoint
	// We just verify it's initialized
	return nil
}

// Use executes a function with the HTTP client
func (w *HTTPClientWorker) Use(ctx context.Context, fn func(resource interface{}) error) error {
	if w.client == nil {
		return fmt.Errorf("HTTP client worker not initialized")
	}
	return fn(w.client)
}

// UseWithData executes a function with HTTP client and data
// Data can be *http.Request, URL string, or any custom type
func (w *HTTPClientWorker) UseWithData(ctx context.Context, data interface{}, fn func(resource interface{}, data interface{}) error) error {
	if w.client == nil {
		return fmt.Errorf("HTTP client worker not initialized")
	}
	return fn(w.client, data)
}

// Close closes the HTTP client worker
// HTTP client doesn't need explicit closing, but we can close idle connections
func (w *HTTPClientWorker) Close() error {
	if w.client != nil && w.client.Transport != nil {
		if transport, ok := w.client.Transport.(*http.Transport); ok {
			transport.CloseIdleConnections()
		}
	}
	return nil
}

// GetClient returns the underlying HTTP client (for direct access if needed)
func (w *HTTPClientWorker) GetClient() *http.Client {
	return w.client
}

// NewHTTPClientWorkerFromConfig creates and initializes an HTTP client worker from config
func NewHTTPClientWorkerFromConfig(ctx context.Context, name string, config *HTTPClientWorkerConfig) (*HTTPClientWorker, error) {
	worker := NewHTTPClientWorker(name)
	if err := worker.Init(ctx, config); err != nil {
		return nil, err
	}
	return worker, nil
}

// =============================================================================
// Worker Factory
// =============================================================================

// CreateWorker creates a new worker instance based on the worker type
// This is a factory method that returns an uninitialized worker
func CreateWorker(workerType WorkerType, name string) (Worker, error) {
	if !IsValidWorkerType(workerType) {
		return nil, fmt.Errorf("unsupported worker type: %s", workerType)
	}

	switch workerType {
	case WorkerTypeGORM:
		return NewGORMWorker(name), nil
	case WorkerTypeRedis:
		return NewRedisWorker(name), nil
	case WorkerTypeHTTPClient:
		return NewHTTPClientWorker(name), nil
	default:
		return nil, fmt.Errorf("unknown worker type: %s", workerType)
	}
}
