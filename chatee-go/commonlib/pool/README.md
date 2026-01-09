# 通用池化技术 (Generic Pool)

这是一个通用的资源池化框架，支持管理多种类型的资源（数据库连接、Redis客户端、HTTP客户端等）。

## 支持的 Worker 类型

当前支持以下 Worker 类型：

- **gorm**: GORM 数据库连接（通过 database/sql 提供连接池）
- **redis**: Redis 客户端（自带连接池）
- **httpclient**: HTTP 客户端（通过 http.Transport 提供连接池）

```go
// 查看支持的 Worker 类型
supportedTypes := pool.SupportedWorkerTypes()
// 输出: [gorm redis httpclient]

// 检查 Worker 类型是否有效
if pool.IsValidWorkerType(pool.WorkerTypeGORM) {
    // ...
}
```

## 核心概念

### Worker 接口

所有资源都通过 `Worker` 接口进行管理：

```go
type Worker interface {
    Init(ctx context.Context, config interface{}) error
    Health(ctx context.Context) error
    Use(ctx context.Context, fn func(resource interface{}) error) error
    UseWithData(ctx context.Context, data interface{}, fn func(resource interface{}, data interface{}) error) error
    Close() error
    Name() string
}
```

### Pool 管理器

`Pool` 用于管理多个 Worker：

```go
pool := pool.NewPool()
pool.Register("mysql", gormWorker)
pool.Register("redis", redisWorker)
```

## 使用方式

### 1. 创建和注册 Worker

#### 方式一：使用工厂方法

```go
ctx := context.Background()

// 使用工厂方法创建 Worker
gormWorker, err := pool.CreateWorker(pool.WorkerTypeGORM, "mysql")
if err != nil {
    panic(err)
}

// 初始化 Worker
err = gormWorker.Init(ctx, &pool.GORMWorkerConfig{
    Host:         "localhost",
    Port:         3306,
    User:         "root",
    Password:     "password",
    Database:     "chatee",
    MaxOpenConns: 100,
    MaxIdleConns: 10,
})

// 注册到 Pool
pool := pool.NewPool()
pool.Register("mysql", gormWorker)
```

#### 方式二：直接创建（推荐）

```go
ctx := context.Background()

// 直接创建并初始化 GORM Worker
gormWorker, err := pool.NewGORMWorkerFromConfig(ctx, "mysql", &pool.GORMWorkerConfig{
    Host:         "localhost",
    Port:         3306,
    User:         "root",
    Password:     "password",
    Database:     "chatee",
    MaxOpenConns: 100,
    MaxIdleConns: 10,
})

// 注册到 Pool
pool := pool.NewPool()
pool.Register("mysql", gormWorker)
```

### 2. 使用 Worker（类型安全）

```go
// 使用泛型函数（类型安全）
err := pool.UseGeneric(ctx, gormWorker, func(db *gorm.DB) error {
    return db.Create(&user).Error
})

// 或通过 Pool 使用
err = pool.Use(ctx, "mysql", func(resource interface{}) error {
    db := resource.(*gorm.DB)
    return db.Create(&user).Error
})
```

### 3. 使用 Worker 处理数据

```go
// 类型安全的方式
err := pool.UseGenericWithData(ctx, gormWorker, userData, func(db *gorm.DB, user *User) error {
    return db.Create(user).Error
})

// 或处理二进制数据
binaryData := []byte("some data")
err = worker.UseWithData(ctx, binaryData, func(resource interface{}, data interface{}) error {
    client := resource.(*redis.Client)
    bytes := data.([]byte)
    return client.Set(ctx, "key", bytes, 0).Err()
})
```

### 4. 按类型查找 Worker

```go
// 获取所有 GORM 类型的 Worker
gormWorkers := pool.GetByType(pool.WorkerTypeGORM)
for _, worker := range gormWorkers {
    fmt.Printf("Found GORM worker: %s\n", worker.Name())
}
```

### 5. 健康检查

```go
// 检查所有 Worker
results := pool.HealthCheck(ctx)
for name, err := range results {
    if err != nil {
        log.Printf("Worker %s is unhealthy: %v", name, err)
    }
}

// 检查特定 Worker
if err := pool.HealthCheckWorker(ctx, "mysql"); err != nil {
    log.Printf("MySQL worker is unhealthy: %v", err)
}
```

## 实现自定义 Worker

要实现自定义 Worker，需要实现 `Worker` 接口：

```go
type CustomWorker struct {
    name     string
    resource YourResourceType
}

func (w *CustomWorker) Name() string {
    return w.name
}

// Type 方法可选，用于支持 GetByType
func (w *CustomWorker) Type() pool.WorkerType {
    return pool.WorkerTypeCustom  // 需要定义新的 WorkerType
}

func (w *CustomWorker) Init(ctx context.Context, config interface{}) error {
    // 解析配置并初始化资源
    cfg := config.(*YourConfig)
    // ... 初始化逻辑
    return nil
}

func (w *CustomWorker) Health(ctx context.Context) error {
    // 检查资源健康状态
    return nil
}

func (w *CustomWorker) Use(ctx context.Context, fn func(interface{}) error) error {
    // 将资源传递给函数
    return fn(w.resource)
}

func (w *CustomWorker) UseWithData(ctx context.Context, data interface{}, fn func(interface{}, interface{}) error) error {
    // 将资源和数据传递给函数
    return fn(w.resource, data)
}

func (w *CustomWorker) Close() error {
    // 清理资源
    return nil
}
```

## 内置 Worker

### GORMWorker

用于管理 GORM 数据库连接。

**关于 GORM 的池化**：GORM 本身不直接提供连接池，它使用 `database/sql` 包。`database/sql` 提供了连接池功能，我们通过 `sql.DB` 的配置参数（`MaxOpenConns`、`MaxIdleConns` 等）来管理连接池。这是标准的做法。

```go
gormWorker, err := pool.NewGORMWorkerFromConfig(ctx, "mysql", &pool.GORMWorkerConfig{
    Host:         "localhost",
    Port:         3306,
    User:         "root",
    Password:     "password",
    Database:     "chatee",
    MaxOpenConns: 100,  // 最大打开连接数
    MaxIdleConns: 10,  // 最大空闲连接数
})
```

### RedisWorker

用于管理 Redis 客户端。Redis 客户端自带连接池功能。

```go
redisWorker, err := pool.NewRedisWorkerFromConfig(ctx, "redis", &pool.RedisWorkerConfig{
    Host:     "localhost",
    Port:     6379,
    Password: "",
    DB:       0,
    PoolSize: 100,  // 连接池大小
})
```

### HTTPClientWorker

用于管理 HTTP 客户端。HTTP 客户端通过 `http.Transport` 提供连接池功能。

```go
httpWorker, err := pool.NewHTTPClientWorkerFromConfig(ctx, "http", &pool.HTTPClientWorkerConfig{
    Timeout:             30 * time.Second,
    MaxIdleConns:        100,              // 最大空闲连接数
    MaxIdleConnsPerHost: 10,               // 每个主机的最大空闲连接数
    MaxConnsPerHost:     0,                // 每个主机的最大连接数（0 表示无限制）
    IdleConnTimeout:     90 * time.Second, // 空闲连接超时
    DisableCompression:  false,
})
```

使用 HTTP Client Worker：

```go
// 类型安全的方式
err := pool.UseGeneric(ctx, httpWorker, func(client *http.Client) error {
    req, _ := http.NewRequestWithContext(ctx, "GET", "https://example.com", nil)
    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    // 处理响应
    return nil
})

// 或使用数据
err = pool.UseWithData(ctx, "http", "https://example.com", func(resource interface{}, data interface{}) error {
    client := resource.(*http.Client)
    url := data.(string)
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    return nil
})
```

## 优势

1. **通用性**: 支持任意类型的资源，只需实现 Worker 接口
2. **类型安全**: 提供泛型函数 `UseGeneric` 和 `UseGenericWithData` 确保类型安全
3. **灵活性**: 支持处理二进制数据和泛型数据
4. **统一管理**: 通过 Pool 统一管理所有资源
5. **健康检查**: 内置健康检查机制
6. **易于扩展**: 可以轻松添加新的 Worker 实现

## 注意事项

- 使用完 Pool 后记得调用 `Close()` 释放所有资源
- Worker 的配置类型需要在 `Init` 方法中进行类型断言
- 使用 `UseGeneric` 时，如果类型不匹配会返回错误

