package pool

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// =============================================================================
// Usage Examples
// =============================================================================

// ExampleBasicUsage demonstrates basic pool usage
func ExampleBasicUsage() {
	ctx := context.Background()

	// Create a new pool
	pool := NewPool()

	// Create and initialize a GORM worker
	gormWorker, err := NewGORMWorkerFromConfig(ctx, "mysql", &GORMWorkerConfig{
		Host:         "localhost",
		Port:         3306,
		User:         "root",
		Password:     "password",
		Database:     "chatee",
		MaxOpenConns: 100,
		MaxIdleConns: 10,
	})
	if err != nil {
		panic(err)
	}

	// Register the worker
	if err := pool.Register("mysql", gormWorker); err != nil {
		panic(err)
	}

	// Use the worker with type-safe generic function
	err = UseGeneric(ctx, gormWorker, func(db *gorm.DB) error {
		// Use the database connection
		// db.Create(&user)
		return nil
	})

	// Or use through pool
	err = pool.Use(ctx, "mysql", func(resource interface{}) error {
		_ = resource.(*gorm.DB) // Type assertion for type safety
		// Use the database connection
		// db.Create(&user)
		return nil
	})

	// Cleanup
	defer pool.Close()
}

// ExampleWithData demonstrates using worker with data
func ExampleWithData() {
	ctx := context.Background()
	pool := NewPool()

	// Assume worker is already registered
	worker, _ := pool.Get("mysql")

	// Define your data type
	type User struct {
		ID   uint
		Name string
	}

	userData := &User{Name: "John"}

	// Use with data - type-safe
	err := UseGenericWithData(ctx, worker, userData, func(db *gorm.DB, user *User) error {
		return db.Create(user).Error
	})

	// Or use through pool
	err = pool.UseWithData(ctx, "mysql", userData, func(resource interface{}, data interface{}) error {
		db := resource.(*gorm.DB)
		user := data.(*User)
		return db.Create(user).Error
	})

	fmt.Println(err)
}

// ExampleBinaryData demonstrates processing binary data
func ExampleBinaryData() {
	ctx := context.Background()
	pool := NewPool()

	// Assume Redis worker is registered
	worker, _ := pool.Get("redis")

	// Process binary data
	binaryData := []byte("some binary data")

	err := worker.UseWithData(ctx, binaryData, func(resource interface{}, data interface{}) error {
		client := resource.(*redis.Client)
		bytes := data.([]byte)
		// Process binary data with Redis
		return client.Set(ctx, "key", bytes, 0).Err()
	})

	fmt.Println(err)
}

// ExampleHealthCheck demonstrates health checking
func ExampleHealthCheck() {
	ctx := context.Background()
	pool := NewPool()

	// Check health of all workers
	results := pool.HealthCheck(ctx)
	for name, err := range results {
		if err != nil {
			fmt.Printf("Worker %s is unhealthy: %v\n", name, err)
		} else {
			fmt.Printf("Worker %s is healthy\n", name)
		}
	}

	// Check specific worker
	if err := pool.HealthCheckWorker(ctx, "mysql"); err != nil {
		fmt.Printf("MySQL worker is unhealthy: %v\n", err)
	}
}

// ExampleHTTPClient demonstrates using HTTP client worker
func ExampleHTTPClient() {
	ctx := context.Background()
	pool := NewPool()

	// Create and initialize an HTTP client worker
	httpWorker, err := NewHTTPClientWorkerFromConfig(ctx, "http", &HTTPClientWorkerConfig{
		Timeout:             30 * time.Second,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	})
	if err != nil {
		panic(err)
	}

	// Register the worker
	if err := pool.Register("http", httpWorker); err != nil {
		panic(err)
	}

	// Use the HTTP client - type-safe
	err = UseGeneric(ctx, httpWorker, func(client *http.Client) error {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://example.com", nil)
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		// Process response
		return nil
	})

	// Or use with data (request)
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

	fmt.Println(err)
}

// ExampleWorkerType demonstrates using WorkerType and factory
func ExampleWorkerType() {
	ctx := context.Background()
	pool := NewPool()

	// Check supported worker types
	supportedTypes := SupportedWorkerTypes()
	fmt.Printf("Supported worker types: %v\n", supportedTypes)

	// Create worker using factory
	gormWorker, err := CreateWorker(WorkerTypeGORM, "mysql")
	if err != nil {
		panic(err)
	}

	// Initialize the worker
	err = gormWorker.Init(ctx, &GORMWorkerConfig{
		Host:         "localhost",
		Port:         3306,
		User:         "root",
		Password:     "password",
		Database:     "chatee",
		MaxOpenConns: 100,
		MaxIdleConns: 10,
	})
	if err != nil {
		panic(err)
	}

	// Register
	pool.Register("mysql", gormWorker)

	// Get workers by type
	gormWorkers := pool.GetByType(WorkerTypeGORM)
	fmt.Printf("Found %d GORM workers\n", len(gormWorkers))
}

// ExampleCustomWorker demonstrates creating a custom worker
// This is a template showing the structure needed
func ExampleCustomWorker() {
	// To create a custom worker, implement the Worker interface:
	//
	// type CustomWorker struct {
	//     name string
	//     resource YourResourceType
	// }
	//
	// func (w *CustomWorker) Name() string { return w.name }
	// func (w *CustomWorker) Type() WorkerType { return WorkerTypeCustom }
	// func (w *CustomWorker) Init(ctx context.Context, config interface{}) error { ... }
	// func (w *CustomWorker) Health(ctx context.Context) error { ... }
	// func (w *CustomWorker) Use(ctx context.Context, fn func(interface{}) error) error {
	//     return fn(w.resource)
	// }
	// func (w *CustomWorker) UseWithData(ctx context.Context, data interface{}, fn func(interface{}, interface{}) error) error {
	//     return fn(w.resource, data)
	// }
	// func (w *CustomWorker) Close() error { ... }
}
