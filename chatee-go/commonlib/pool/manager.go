package pool

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/tiz36/ghbase"
	"github.com/tiz36/ghbase/domain"
	"gorm.io/gorm"

	"chatee-go/commonlib/log"
)

// =============================================================================
// Pool Manager Configuration
// =============================================================================

// MySQLConfig configures MySQL connection
type MySQLConfig struct {
	Host         string
	Port         int
	User         string
	Password     string
	Database     string
	MaxOpenConns int
	MaxIdleConns int
}

// RedisConfig configures Redis connection
type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
	PoolSize int
}

// HBaseConfig configures HBase connection
type ThriftHbaseConfig struct {
	Host              string
	Namespace         string
	ClientType        int64
	HbasePoolConfig   HbasePoolConfig
	HbaseClientConfig HbaseClientConfig
}

type ZookeeperHbaseConfig struct {
	ZkHosts           string
	Namespace         string
	ClientType        string
	HbasePoolConfig   HbasePoolConfig
	HbaseClientConfig HbaseClientConfig
}

type HbasePoolConfig struct {
	InitSize    int
	MaxSize     int
	IdleSize    int
	IdleTimeout time.Duration
}

type HbaseClientConfig struct {
	ConnectTimeout int64
	SocketTimeout  int64
	MaxFrameSize   int32
	Credential     HabseCredential
}

type HabseCredential struct {
	User string
	Pass string
}

// PoolManagerConfig configures the pool manager
type PoolManagerConfig struct {
	MySQL       *MySQLConfig
	Redis       *RedisConfig
	ThriftHBase *ThriftHbaseConfig
}

// =============================================================================
// Pool Manager
// =============================================================================

// PoolManager manages all connection pools
type PoolManager struct {
	pool *Pool

	gormDB *gorm.DB
	redis  *redis.Client
	hbase  *ghbase.HbaseClientPool
}

// NewPoolManager creates a new pool manager
func NewPoolManager(cfg PoolManagerConfig) (*PoolManager, error) {
	pm := &PoolManager{
		pool: NewPool(),
	}

	ctx := context.Background()

	// Initialize GORM pool worker for MySQL
	fmt.Print("mysl config:", cfg.MySQL)
	if cfg.MySQL != nil {
		gormWorker, err := NewGORMWorkerFromConfig(ctx, "mysql", &GORMWorkerConfig{
			Host:         cfg.MySQL.Host,
			Port:         cfg.MySQL.Port,
			User:         cfg.MySQL.User,
			Password:     cfg.MySQL.Password,
			Database:     cfg.MySQL.Database,
			MaxOpenConns: cfg.MySQL.MaxOpenConns,
			MaxIdleConns: cfg.MySQL.MaxIdleConns,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to init MySQL: %w", err)
		}
		pm.pool.Register("mysql", gormWorker)
		pm.gormDB = gormWorker.GetDB()
	}

	// Initialize Redis
	if cfg.Redis != nil {
		redisWorker, err := NewRedisWorkerFromConfig(ctx, "redis", &RedisWorkerConfig{
			Host:     cfg.Redis.Host,
			Port:     cfg.Redis.Port,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
			PoolSize: cfg.Redis.PoolSize,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to init Redis: %w", err)
		}
		pm.pool.Register("redis", redisWorker)
		pm.redis = redisWorker.GetClient()
	}

	// Initialize HBase, support thrift now
	if cfg.ThriftHBase != nil {
		// Create logger adapter
		logger := log.Default()
		hbaseLogger := NewHBaseLoggerAdapter(logger)

		// Configure Thrift2GHBaseClientConfig
		clientConfig := &domain.Thrift2GHBaseClientConfig{
			ThriftApiHost:      cfg.ThriftHBase.Host,
			ConnectTimeout:     time.Duration(cfg.ThriftHBase.HbaseClientConfig.ConnectTimeout) * time.Second,
			SocketTimeout:      time.Duration(cfg.ThriftHBase.HbaseClientConfig.SocketTimeout) * time.Second,
			MaxFrameSize:       1024 * 1024 * 16, // 16MB
			TBinaryStrictRead:  false,
			TBinaryStrictWrite: false,
			NeedCredential:     false,
		}

		// Set credentials if provided
		if cfg.ThriftHBase.HbaseClientConfig.Credential.User != "" {
			clientConfig.NeedCredential = true
			clientConfig.User = cfg.ThriftHBase.HbaseClientConfig.Credential.User
			clientConfig.Pass = cfg.ThriftHBase.HbaseClientConfig.Credential.Pass
		}

		// Configure PoolConf
		poolSize := cfg.ThriftHBase.HbasePoolConfig.MaxSize
		if poolSize <= 0 {
			poolSize = 10 // Default pool size
		}
		poolConf := &domain.PoolConf{
			InitSize:    poolSize / 2,
			MaxSize:     poolSize,
			IdleSize:    poolSize / 2,
			IdleTimeout: 5 * time.Minute,
		}

		// Create HBase client pool
		hbasePool, err := ghbase.NewHbaseClientPool(
			ctx,
			hbaseLogger,
			cfg.ThriftHBase.ClientType, // Use client type from config
			*clientConfig,
			*poolConf,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to init HBase: %w", err)
		}
		pm.hbase = hbasePool
	}

	return pm, nil
}

// Pool returns the underlying pool
func (pm *PoolManager) Pool() *Pool {
	return pm.pool
}

// MySQL returns the MySQL sql.DB instance
func (pm *PoolManager) MySQL() *sql.DB {
	sqlDB, err := pm.gormDB.DB()
	if err != nil {
		return nil
	}
	return sqlDB
}

// GORM returns the GORM database instance
func (pm *PoolManager) GORM() *gorm.DB {
	return pm.gormDB
}

// Redis returns the Redis client
func (pm *PoolManager) Redis() *redis.Client {
	return pm.redis
}

// GetRedis is an alias for Redis() for backward compatibility
func (pm *PoolManager) GetRedis() *redis.Client {
	return pm.redis
}

// GetMySQL is an alias for MySQL() for backward compatibility
func (pm *PoolManager) GetMySQL() *sql.DB {
	sqlDB, err := pm.gormDB.DB()
	if err != nil {
		return nil
	}
	return sqlDB
}

// GetGORM is an alias for GORM() for backward compatibility
func (pm *PoolManager) GetGORM() *gorm.DB {
	return pm.gormDB
}

// HBase returns the HBase pool
func (pm *PoolManager) HBase() *ghbase.HbaseClientPool {
	return pm.hbase
}

// HealthCheck checks the health of all pools
func (pm *PoolManager) HealthCheck(ctx context.Context) map[string]error {
	return pm.pool.HealthCheck(ctx)
}

// Close closes all pools
func (pm *PoolManager) Close() error {
	var errs []error

	// Close pool workers
	if err := pm.pool.Close(); err != nil {
		errs = append(errs, err)
	}

	// Close HBase pool
	// Note: HbaseClientPool manages its own pool lifecycle,
	// and the embedded pool.Pool.Close() requires a client parameter.
	// Since ghbase library manages the pool internally, we don't need to explicitly close it.
	// The pool will be garbage collected when PoolManager is closed.

	if len(errs) > 0 {
		return fmt.Errorf("errors closing pools: %v", errs)
	}

	return nil
}
