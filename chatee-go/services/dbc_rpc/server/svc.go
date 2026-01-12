package server

import (
	"chatee-go/commonlib/config"
	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
)

// ServiceContext holds all dependencies for the DBC service
type ServiceContext struct {
	Config      *config.Config
	Logger      log.Logger
	PoolManager *pool.PoolManager
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
		ThriftHBase: &pool.ThriftHbaseConfig{
			Host:       cfg.HBase.Host,
			Namespace:  cfg.HBase.Namespace,
			ClientType: 1,
			HbasePoolConfig: pool.HbasePoolConfig{
				InitSize:    cfg.HBase.HbasePoolConfig.InitSize,
				MaxSize:     cfg.HBase.HbasePoolConfig.MaxSize,
				IdleSize:    cfg.HBase.HbasePoolConfig.IdleSize,
				IdleTimeout: cfg.HBase.HbasePoolConfig.IdleTimeout,
			},
			HbaseClientConfig: pool.HbaseClientConfig{
				ConnectTimeout: cfg.HBase.HbaseClientConfig.ConnectTimeout,
				SocketTimeout:  cfg.HBase.HbaseClientConfig.SocketTimeout,
				MaxFrameSize:   cfg.HBase.HbaseClientConfig.MaxFrameSize,
				Credential: pool.HabseCredential{
					User: cfg.HBase.HbaseClientConfig.Credential.User,
					Pass: cfg.HBase.HbaseClientConfig.Credential.Pass,
				},
			},
		},
	})

	if err != nil {
		return nil, err
	}

	svcCtx := &ServiceContext{
		Config:      cfg,
		Logger:      logger,
		PoolManager: poolMgr,
	}

	return svcCtx, nil
}

// Close closes all resources in the service context
func (ctx *ServiceContext) Close() error {
	if ctx.PoolManager != nil {
		return ctx.PoolManager.Close()
	}
	return nil
}
