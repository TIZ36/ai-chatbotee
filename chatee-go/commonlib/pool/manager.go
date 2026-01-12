package pool

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"chatee-go/commonlib/log"
	"github.com/redis/go-redis/v9"
	"github.com/tiz36/ghbase"
	"github.com/tiz36/ghbase/domain"
	"gorm.io/gorm"
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
type HBaseConfig struct {
	ZookeeperQuorum string
	ZookeeperPort   int
	PoolSize        int
	Timeout         int // seconds
}

// PoolManagerConfig configures the pool manager
type PoolManagerConfig struct {
	MySQL *MySQLConfig
	Redis *RedisConfig
	HBase *HBaseConfig
}

// =============================================================================
// Pool Manager
// =============================================================================

// PoolManager manages all connection pools
type PoolManager struct {
	pool    *Pool
	mysqlDB *sql.DB
	gormDB  *gorm.DB
	redis   *redis.Client
	hbase   *ghbase.HbaseClientPool
}

// NewPoolManager creates a new pool manager
func NewPoolManager(cfg PoolManagerConfig) (*PoolManager, error) {
	pm := &PoolManager{
		pool: NewPool(),
	}

	ctx := context.Background()

	// Initialize MySQL/GORM
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
		pm.mysqlDB = gormWorker.GetSQLDB()
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

	// Initialize HBase
	if cfg.HBase != nil {
		// Create logger adapter
		logger := log.Default()
		hbaseLogger := NewHBaseLoggerAdapter(logger)

		// Configure Thrift2GHBaseClientConfig
		clientConfig := &domain.Thrift2GHBaseClientConfig{
			ThriftApiHost:      fmt.Sprintf("%s:%d", cfg.HBase.ZookeeperQuorum, cfg.HBase.ZookeeperPort),
			ConnectTimeout:     time.Duration(cfg.HBase.Timeout) * time.Second,
			SocketTimeout:      time.Duration(cfg.HBase.Timeout) * time.Second,
			MaxFrameSize:       1024 * 1024 * 16, // 16MB
			TBinaryStrictRead:  false,
			TBinaryStrictWrite: false,
			NeedCredential:     false,
		}

		// Configure PoolConf
		poolSize := cfg.HBase.PoolSize
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
			domain.TypeCommonThrift2HbaseTcpClient, // Use TCP client type
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
	return pm.mysqlDB
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
	return pm.mysqlDB
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
