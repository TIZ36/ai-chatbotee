package pool

import (
	"context"
	"fmt"
	"sync"
)

// =============================================================================
// Worker Type Definitions
// =============================================================================

// WorkerType represents the type of worker
type WorkerType string

const (
	// WorkerTypeGORM represents GORM database worker
	WorkerTypeGORM WorkerType = "gorm"
	// WorkerTypeRedis represents Redis client worker
	WorkerTypeRedis WorkerType = "redis"
	// WorkerTypeHTTPClient represents HTTP client worker
	WorkerTypeHTTPClient WorkerType = "httpclient"
)

// SupportedWorkerTypes returns all supported worker types
func SupportedWorkerTypes() []WorkerType {
	return []WorkerType{
		WorkerTypeGORM,
		WorkerTypeRedis,
		WorkerTypeHTTPClient,
	}
}

// IsValidWorkerType checks if the given worker type is supported
func IsValidWorkerType(workerType WorkerType) bool {
	for _, supported := range SupportedWorkerTypes() {
		if supported == workerType {
			return true
		}
	}
	return false
}

// =============================================================================
// Worker Interface
// =============================================================================

// Worker defines the interface for all pool workers
// Each worker manages a specific resource type (e.g., database connection, HTTP client)
type Worker interface {
	// Init initializes the worker with the given configuration
	// config can be any type, worker implementation should handle type assertion
	Init(ctx context.Context, config interface{}) error

	// Health checks if the worker is healthy
	Health(ctx context.Context) error

	// Use executes a function with the worker's resource
	// The function receives the worker's resource as interface{}
	// Worker implementation should handle type conversion internally
	Use(ctx context.Context, fn func(resource interface{}) error) error

	// UseWithData executes a function with both worker resource and input data
	// This supports binary or generic data processing
	UseWithData(ctx context.Context, data interface{}, fn func(resource interface{}, data interface{}) error) error

	// Close releases all resources held by the worker
	Close() error

	// Name returns the worker's name/identifier
	Name() string
}

// =============================================================================
// Pool Manager
// =============================================================================

// Pool manages multiple workers
type Pool struct {
	mu      sync.RWMutex
	workers map[string]Worker
}

// NewPool creates a new empty pool
func NewPool() *Pool {
	return &Pool{
		workers: make(map[string]Worker),
	}
}

// Register registers a worker with the given name
func (p *Pool) Register(name string, worker Worker) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if _, exists := p.workers[name]; exists {
		return fmt.Errorf("worker %s already registered", name)
	}

	p.workers[name] = worker
	return nil
}

// Get retrieves a worker by name
func (p *Pool) Get(name string) (Worker, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	worker, exists := p.workers[name]
	if !exists {
		return nil, fmt.Errorf("worker %s not found", name)
	}

	return worker, nil
}

// MustGet retrieves a worker by name, panics if not found
func (p *Pool) MustGet(name string) Worker {
	worker, err := p.Get(name)
	if err != nil {
		panic(err)
	}
	return worker
}

// Use executes a function with the specified worker
func (p *Pool) Use(ctx context.Context, name string, fn func(resource interface{}) error) error {
	worker, err := p.Get(name)
	if err != nil {
		return err
	}
	return worker.Use(ctx, fn)
}

// UseWithData executes a function with the specified worker and data
func (p *Pool) UseWithData(ctx context.Context, name string, data interface{}, fn func(resource interface{}, data interface{}) error) error {
	worker, err := p.Get(name)
	if err != nil {
		return err
	}
	return worker.UseWithData(ctx, data, fn)
}

// HealthCheck checks the health of all registered workers
func (p *Pool) HealthCheck(ctx context.Context) map[string]error {
	p.mu.RLock()
	workers := make(map[string]Worker)
	for name, worker := range p.workers {
		workers[name] = worker
	}
	p.mu.RUnlock()

	results := make(map[string]error)
	for name, worker := range workers {
		results[name] = worker.Health(ctx)
	}
	return results
}

// HealthCheckWorker checks the health of a specific worker
func (p *Pool) HealthCheckWorker(ctx context.Context, name string) error {
	worker, err := p.Get(name)
	if err != nil {
		return err
	}
	return worker.Health(ctx)
}

// Close closes all workers
func (p *Pool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	var errs []error
	for name, worker := range p.workers {
		if err := worker.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close worker %s: %w", name, err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing workers: %v", errs)
	}

	return nil
}

// List returns all registered worker names
func (p *Pool) List() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	names := make([]string, 0, len(p.workers))
	for name := range p.workers {
		names = append(names, name)
	}
	return names
}

// GetByType returns all workers of the specified type
func (p *Pool) GetByType(workerType WorkerType) []Worker {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var result []Worker
	for _, worker := range p.workers {
		// Check if worker implements Type() method (optional interface)
		if typedWorker, ok := worker.(interface{ Type() WorkerType }); ok {
			if typedWorker.Type() == workerType {
				result = append(result, worker)
			}
		}
	}
	return result
}

// =============================================================================
// Generic Use Functions (Type-safe helpers)
// =============================================================================

// UseGeneric is a type-safe wrapper for using a worker with a typed function
// Example:
//
//	err := UseGeneric(ctx, worker, func(db *gorm.DB) error {
//	    return db.Create(&user).Error
//	})
func UseGeneric[T any](ctx context.Context, worker Worker, fn func(resource T) error) error {
	return worker.Use(ctx, func(resource interface{}) error {
		typedResource, ok := resource.(T)
		if !ok {
			return fmt.Errorf("worker resource type mismatch: expected %T, got %T", *new(T), resource)
		}
		return fn(typedResource)
	})
}

// UseGenericWithData is a type-safe wrapper for using a worker with data
// Example:
//
//	err := UseGenericWithData(ctx, worker, userData, func(db *gorm.DB, data *User) error {
//	    return db.Create(data).Error
//	})
func UseGenericWithData[TResource any, TData any](ctx context.Context, worker Worker, data TData, fn func(resource TResource, data TData) error) error {
	return worker.UseWithData(ctx, data, func(resource interface{}, data interface{}) error {
		typedResource, ok := resource.(TResource)
		if !ok {
			return fmt.Errorf("worker resource type mismatch: expected %T, got %T", *new(TResource), resource)
		}
		typedData, ok := data.(TData)
		if !ok {
			return fmt.Errorf("data type mismatch: expected %T, got %T", *new(TData), data)
		}
		return fn(typedResource, typedData)
	})
}
