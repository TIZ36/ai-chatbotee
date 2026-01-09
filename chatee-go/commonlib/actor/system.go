package actor

import (
	"context"
	"fmt"
	"sync"
)

// =============================================================================
// ActorSystem - Manages all actors
// =============================================================================

// ActorSystem manages the lifecycle of all actors.
type ActorSystem interface {
	// Spawn creates and starts a new actor.
	Spawn(id string, actor Actor) (ActorRef, error)

	// SpawnWithConfig creates and starts a new actor with custom config.
	SpawnWithConfig(id string, actor Actor, config MailboxConfig) (ActorRef, error)

	// Find returns an actor reference by ID.
	Find(id string) (ActorRef, bool)

	// Stop stops a specific actor.
	Stop(id string) error

	// StopAll stops all actors.
	StopAll() error

	// Shutdown gracefully shuts down the entire system.
	Shutdown() error

	// Count returns the number of active actors.
	Count() int

	// List returns all actor IDs.
	List() []string
}

// =============================================================================
// LocalActorSystem - Single-node implementation
// =============================================================================

// LocalActorSystem is a single-node actor system implementation.
type LocalActorSystem struct {
	name    string
	actors  map[string]*MailboxRef
	mu      sync.RWMutex
	config  SystemConfig
	stopped bool
}

// SystemConfig configures the actor system.
type SystemConfig struct {
	Name              string
	DefaultBufferSize int
	OnError           func(actorID string, err error)
	OnActorStopped    func(actorID string)
}

// DefaultSystemConfig returns default configuration.
func DefaultSystemConfig() SystemConfig {
	return SystemConfig{
		Name:              "default",
		DefaultBufferSize: 1000,
		OnError:           nil,
		OnActorStopped:    nil,
	}
}

// NewActorSystem creates a new local actor system.
func NewActorSystem(config SystemConfig) *LocalActorSystem {
	return &LocalActorSystem{
		name:   config.Name,
		actors: make(map[string]*MailboxRef),
		config: config,
	}
}

// Spawn creates and starts a new actor with default config.
func (s *LocalActorSystem) Spawn(id string, actor Actor) (ActorRef, error) {
	return s.SpawnWithConfig(id, actor, MailboxConfig{
		BufferSize: s.config.DefaultBufferSize,
		OnError:    s.config.OnError,
	})
}

// SpawnWithConfig creates and starts a new actor with custom config.
func (s *LocalActorSystem) SpawnWithConfig(id string, actor Actor, config MailboxConfig) (ActorRef, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.stopped {
		return nil, fmt.Errorf("actor system %s is stopped", s.name)
	}

	if _, exists := s.actors[id]; exists {
		return nil, fmt.Errorf("actor %s already exists", id)
	}

	// Create mailbox
	mailbox := NewMailbox(id, actor, config)

	// Start mailbox
	if err := mailbox.Start(); err != nil {
		return nil, err
	}

	// Create ref
	ref := NewMailboxRef(mailbox)
	s.actors[id] = ref

	return ref, nil
}

// Find returns an actor reference by ID.
func (s *LocalActorSystem) Find(id string) (ActorRef, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ref, exists := s.actors[id]
	if !exists || !ref.IsAlive() {
		return nil, false
	}
	return ref, true
}

// Stop stops a specific actor.
func (s *LocalActorSystem) Stop(id string) error {
	s.mu.Lock()
	ref, exists := s.actors[id]
	if !exists {
		s.mu.Unlock()
		return fmt.Errorf("actor %s not found", id)
	}
	delete(s.actors, id)
	s.mu.Unlock()

	err := ref.Stop()
	if s.config.OnActorStopped != nil {
		s.config.OnActorStopped(id)
	}
	return err
}

// StopAll stops all actors.
func (s *LocalActorSystem) StopAll() error {
	s.mu.Lock()
	actors := make([]*MailboxRef, 0, len(s.actors))
	ids := make([]string, 0, len(s.actors))
	for id, ref := range s.actors {
		actors = append(actors, ref)
		ids = append(ids, id)
	}
	s.actors = make(map[string]*MailboxRef)
	s.mu.Unlock()

	var lastErr error
	for i, ref := range actors {
		if err := ref.Stop(); err != nil {
			lastErr = err
		}
		if s.config.OnActorStopped != nil {
			s.config.OnActorStopped(ids[i])
		}
	}
	return lastErr
}

// Shutdown gracefully shuts down the entire system.
func (s *LocalActorSystem) Shutdown() error {
	s.mu.Lock()
	s.stopped = true
	s.mu.Unlock()

	return s.StopAll()
}

// Count returns the number of active actors.
func (s *LocalActorSystem) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.actors)
}

// List returns all actor IDs.
func (s *LocalActorSystem) List() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.actors))
	for id := range s.actors {
		ids = append(ids, id)
	}
	return ids
}

// =============================================================================
// Global Actor System (convenience)
// =============================================================================

var (
	defaultSystem     *LocalActorSystem
	defaultSystemOnce sync.Once
)

// GetDefaultSystem returns the default global actor system.
func GetDefaultSystem() *LocalActorSystem {
	defaultSystemOnce.Do(func() {
		defaultSystem = NewActorSystem(DefaultSystemConfig())
	})
	return defaultSystem
}

// Spawn creates an actor in the default system.
func Spawn(id string, actor Actor) (ActorRef, error) {
	return GetDefaultSystem().Spawn(id, actor)
}

// Find finds an actor in the default system.
func Find(id string) (ActorRef, bool) {
	return GetDefaultSystem().Find(id)
}

// =============================================================================
// Context Keys
// =============================================================================

type contextKey string

const (
	ActorIDKey  contextKey = "actor_id"
	ActorRefKey contextKey = "actor_ref"
	ActorSysKey contextKey = "actor_system"
)

// WithActorID adds actor ID to context.
func WithActorID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ActorIDKey, id)
}

// GetActorID retrieves actor ID from context.
func GetActorID(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(ActorIDKey).(string)
	return id, ok
}
