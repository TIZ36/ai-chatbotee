package actor

import (
	"context"
	"sync"

	"chatee-go/commonlib/actor"
)

// =============================================================================
// Mailbox Implementation - 具体实现
// =============================================================================

// mailbox implements actor.Mailbox
type mailbox struct {
	id      string
	actor   actor.Actor
	config  actor.MailboxConfig
	queue   chan actor.Message
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	mu      sync.RWMutex
	started bool
}

// NewMailbox creates a new mailbox.
func NewMailbox(id string, a actor.Actor, config actor.MailboxConfig) *mailbox {
	ctx, cancel := context.WithCancel(context.Background())
	return &mailbox{
		id:     id,
		actor:  a,
		config: config,
		queue:  make(chan actor.Message, config.BufferSize),
		ctx:    ctx,
		cancel: cancel,
	}
}

// Start starts the mailbox processing loop.
func (m *mailbox) Start() error {
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
func (m *mailbox) process() {
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
func (m *mailbox) Stop() error {
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
func (m *mailbox) IsAlive() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.started && m.ctx.Err() == nil
}

// Send sends a message to the mailbox.
func (m *mailbox) Send(msg actor.Message) error {
	select {
	case m.queue <- msg:
		return nil
	default:
		// Queue full, drop message
		if m.config.OnError != nil {
			m.config.OnError(m.id, ErrMailboxFull)
		}
		return ErrMailboxFull
	}
}

// =============================================================================
// MailboxRef Implementation
// =============================================================================

// MailboxRef provides a reference to a mailbox.
type MailboxRef struct {
	mailbox *mailbox
}

// NewMailboxRef creates a new mailbox reference.
func NewMailboxRef(m *mailbox) *MailboxRef {
	return &MailboxRef{mailbox: m}
}

// Send sends a message to the actor.
func (r *MailboxRef) Send(msg actor.Message) {
	r.mailbox.Send(msg)
}

// Ask sends a message and waits for a response.
func (r *MailboxRef) Ask(msg actor.Message, respChan chan actor.Message) {
	if askMsg, ok := msg.(*actor.GenericMessage); ok {
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
