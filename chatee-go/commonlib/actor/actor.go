package actor

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// =============================================================================
// Actor Interface
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

// =============================================================================
// Message Interface
// =============================================================================

// Message is the interface that all messages must implement.
type Message interface {
	Type() string
}

// BaseMessage provides base fields for all messages.
type BaseMessage struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	SenderID  string    `json:"sender_id,omitempty"`
}

// NewMessage creates a new message with the given type and payload.
func NewMessage(msgType string, payload interface{}) Message {
	data, _ := json.Marshal(payload)
	var msg map[string]interface{}
	json.Unmarshal(data, &msg)
	msg["type"] = msgType
	msg["timestamp"] = time.Now()
	return &GenericMessage{
		BaseMessage: BaseMessage{
			ID:        generateID(),
			Timestamp: time.Now(),
		},
		MsgType: msgType,
		Payload: msg,
	}
}

// NewAskMessage creates a new ask message that expects a response.
func NewAskMessage(msgType string, payload interface{}, respChan chan Message) Message {
	msg := NewMessage(msgType, payload)
	if askMsg, ok := msg.(*GenericMessage); ok {
		askMsg.RespChan = respChan
	}
	return msg
}

// GenericMessage is a generic message implementation.
type GenericMessage struct {
	BaseMessage
	MsgType  string                 `json:"type"`
	Payload  map[string]interface{} `json:"payload"`
	RespChan chan Message           `json:"-"`
}

func (m *GenericMessage) Type() string {
	return m.MsgType
}

// generateID generates a unique message ID.
func generateID() string {
	return time.Now().Format("20060102150405.000000") + "-" + randomString(6)
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
	}
	return string(b)
}

// =============================================================================
// ActorRef Interface
// =============================================================================

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

// =============================================================================
// Mailbox Configuration
// =============================================================================

// MailboxConfig configures a mailbox.
type MailboxConfig struct {
	BufferSize int
	OnError    func(actorID string, err error)
}

// =============================================================================
// Mailbox - Message queue for actors
// =============================================================================

// Mailbox manages the message queue for an actor.
type Mailbox struct {
	id      string
	actor   Actor
	config  MailboxConfig
	queue   chan Message
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	mu      sync.RWMutex
	started bool
}

// NewMailbox creates a new mailbox.
func NewMailbox(id string, actor Actor, config MailboxConfig) *Mailbox {
	ctx, cancel := context.WithCancel(context.Background())
	return &Mailbox{
		id:     id,
		actor:  actor,
		config: config,
		queue:  make(chan Message, config.BufferSize),
		ctx:    ctx,
		cancel: cancel,
	}
}

// Start starts the mailbox processing loop.
func (m *Mailbox) Start() error {
	m.mu.Lock()
	if m.started {
		m.mu.Unlock()
		return nil
	}
	m.started = true
	m.mu.Unlock()

	// Call OnStart
	if err := m.actor.OnStart(m.ctx); err != nil {
		return err
	}

	// Start processing loop
	m.wg.Add(1)
	go m.process()

	return nil
}

// process processes messages from the queue.
func (m *Mailbox) process() {
	defer m.wg.Done()

	for {
		select {
		case <-m.ctx.Done():
			return
		case msg := <-m.queue:
			if err := m.actor.Receive(m.ctx, msg); err != nil {
				if m.config.OnError != nil {
					m.config.OnError(m.id, err)
				}
			}
		}
	}
}

// Stop stops the mailbox.
func (m *Mailbox) Stop() error {
	m.mu.Lock()
	if !m.started {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	// Cancel context
	m.cancel()

	// Call OnStop
	if err := m.actor.OnStop(m.ctx); err != nil {
		return err
	}

	// Wait for processing to finish
	m.wg.Wait()

	// Close queue
	close(m.queue)

	return nil
}

// IsAlive returns true if the mailbox is still running.
func (m *Mailbox) IsAlive() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.started && m.ctx.Err() == nil
}

// =============================================================================
// MailboxRef - Reference to a mailbox
// =============================================================================

// MailboxRef provides a reference to a mailbox.
type MailboxRef struct {
	mailbox *Mailbox
}

// NewMailboxRef creates a new mailbox reference.
func NewMailboxRef(mailbox *Mailbox) *MailboxRef {
	return &MailboxRef{mailbox: mailbox}
}

// Send sends a message to the actor.
func (r *MailboxRef) Send(msg Message) {
	select {
	case r.mailbox.queue <- msg:
	default:
		// Queue full, drop message
		if r.mailbox.config.OnError != nil {
			r.mailbox.config.OnError(r.mailbox.id, ErrMailboxFull)
		}
	}
}

// Ask sends a message and waits for a response.
func (r *MailboxRef) Ask(msg Message, respChan chan Message) {
	if askMsg, ok := msg.(*GenericMessage); ok {
		askMsg.RespChan = respChan
	}
	r.Send(msg)
}

// Stop stops the actor.
func (r *MailboxRef) Stop() error {
	return r.mailbox.Stop()
}

// IsAlive returns true if the actor is still alive.
func (r *MailboxRef) IsAlive() bool {
	return r.mailbox.IsAlive()
}

// =============================================================================
// Errors
// =============================================================================

var (
	ErrMailboxFull = &MailboxError{Message: "mailbox queue is full"}
)

// MailboxError represents a mailbox error.
type MailboxError struct {
	Message string
}

func (e *MailboxError) Error() string {
	return e.Message
}
