package main

import (
	"fmt"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	service "chatee-go/services/dbc_rpc/biz"
	"chatee-go/services/dbc_rpc/repository"
)

// ServiceContext holds all dependencies for the DBC service
type ServiceContext struct {
	Config      *config.Config
	Logger      log.Logger
	PoolManager *pool.PoolManager
	Repos       *repository.Repositories
	Service     *service.DBCService
}

// NewServiceContext creates a new service context with all dependencies initialized
func NewServiceContext(cfg *config.Config) (*ServiceContext, error) {
	// Initialize logger
	if err := log.Init(log.LogConfig{
		Level:      cfg.Log.Level,
		Format:     cfg.Log.Format,
		OutputPath: cfg.Log.OutputPath,
		AddCaller:  true,
		MaxSize:    cfg.Log.MaxSize,
		MaxBackups: cfg.Log.MaxBackups,
		MaxAge:     cfg.Log.MaxAge,
		Compress:   true,
	}); err != nil {
		return nil, err
	}

	logger := log.Default()

	// Initialize connection pools
	poolMgr, err := pool.NewPoolManager(pool.PoolManagerConfig{
		MySQL: &pool.MySQLConfig{
			Host:         cfg.MySQL.Host,
			Port:         cfg.MySQL.Port,
			User:         cfg.MySQL.User,
			Password:     cfg.MySQL.Password,
			Database:     cfg.MySQL.Database,
			MaxOpenConns: cfg.MySQL.MaxOpenConns,
			MaxIdleConns: cfg.MySQL.MaxIdleConns,
		},
		Redis: &pool.RedisConfig{
			Host:     cfg.Redis.Host,
			Port:     cfg.Redis.Port,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
			PoolSize: cfg.Redis.PoolSize,
		},
		HBase: &pool.HBaseConfig{
			ZookeeperQuorum: cfg.HBase.ZookeeperQuorum,
			ZookeeperPort:   cfg.HBase.ZookeeperPort,
			PoolSize:        10, // Default pool size
			Timeout:         30, // Default timeout in seconds
		},
	})
	if err != nil {
		return nil, err
	}

	// Initialize repositories
	// Use GORM instance from pool manager if available, otherwise convert from sql.DB
	gormDB := poolMgr.GORM()
	if gormDB == nil {
		// Fallback: convert sql.DB to GORM
		gormDB, err = gorm.Open(mysql.New(mysql.Config{
			Conn: poolMgr.MySQL(),
		}), &gorm.Config{})
		if err != nil {
			return nil, fmt.Errorf("failed to create GORM instance: %w", err)
		}
	}
	repos := repository.NewRepositories(gormDB, poolMgr.Redis())

	// Initialize service
	svc := service.NewDBCService(repos, poolMgr, cfg, logger)

	return &ServiceContext{
		Config:      cfg,
		Logger:      logger,
		PoolManager: poolMgr,
		Repos:       repos,
		Service:     svc,
	}, nil
}

// Close closes all resources in the service context
func (ctx *ServiceContext) Close() error {
	if ctx.PoolManager != nil {
		return ctx.PoolManager.Close()
	}
	return nil
}
