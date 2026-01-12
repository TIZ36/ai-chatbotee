package actor

import (
	"context"
	"time"
)

// =============================================================================
// Core Interfaces - 范式定义
// =============================================================================

// Actor is the interface that all actors must implement.
type Actor interface {
	// OnStart is called when the actor starts.
	OnStart(ctx context.Context) error

	// Receive handles incoming messages.
	Receive(ctx context.Context, msg Message) error

	// OnStop is called when the actor stops.
	OnStop(ctx context.Context) error
}

// Message is the interface that all messages must implement.
type Message interface {
	Type() string
}

// ActorRef provides a reference to an actor for sending messages.
type ActorRef interface {
	// Send sends a message to the actor (fire-and-forget).
	Send(msg Message)

	// Ask sends a message and waits for a response.
	Ask(msg Message, respChan chan Message)

	// Stop stops the actor.
	Stop() error

	// IsAlive returns true if the actor is still alive.
	IsAlive() bool
}

// Mailbox manages the message queue for an actor.
// This is an interface - implementations should be in infrastructure.
type Mailbox interface {
	// Start starts the mailbox processing loop.
	Start() error

	// Stop stops the mailbox.
	Stop() error

	// IsAlive returns true if the mailbox is still running.
	IsAlive() bool

	// Send sends a message to the mailbox.
	Send(msg Message) error
}

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
// Base Types - 基础数据结构
// =============================================================================

// BaseMessage provides base fields for all messages.
type BaseMessage struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	SenderID  string    `json:"sender_id,omitempty"`
}

// MailboxConfig configures a mailbox.
type MailboxConfig struct {
	BufferSize int
	OnError    func(actorID string, err error)
}

// SystemConfig configures the actor system.
type SystemConfig struct {
	Name              string
	DefaultBufferSize int
	OnError           func(actorID string, err error)
	OnActorStopped    func(actorID string)
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
