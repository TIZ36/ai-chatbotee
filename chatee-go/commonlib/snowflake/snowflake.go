package snowflake

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// Snowflake ID Generator
// =============================================================================

// Default epoch: 2024-01-01 00:00:00 UTC
var defaultEpoch = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()

const (
	nodeBits     = 10
	sequenceBits = 12
	maxNodeID    = -1 ^ (-1 << nodeBits)
	maxSequence  = -1 ^ (-1 << sequenceBits)
	timeShift    = nodeBits + sequenceBits
	nodeShift    = sequenceBits
)

// Snowflake generates unique distributed IDs.
// Structure: timestamp(41) | node(10) | sequence(12)
type Snowflake struct {
	nodeID   int64
	epoch    int64
	sequence int64
	lastTime int64
	mu       sync.Mutex
}

// New creates a new Snowflake generator.
func New(nodeID int64) (*Snowflake, error) {
	if nodeID < 0 || nodeID > maxNodeID {
		return nil, fmt.Errorf("node ID must be between 0 and %d", maxNodeID)
	}
	return &Snowflake{
		nodeID: nodeID,
		epoch:  defaultEpoch,
	}, nil
}

// NewWithEpoch creates a generator with custom epoch.
func NewWithEpoch(nodeID int64, epoch time.Time) (*Snowflake, error) {
	if nodeID < 0 || nodeID > maxNodeID {
		return nil, fmt.Errorf("node ID must be between 0 and %d", maxNodeID)
	}
	return &Snowflake{
		epoch:  epoch.UnixMilli(),
		nodeID: nodeID,
	}, nil
}

// Generate generates a new unique ID.
func (s *Snowflake) Generate() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UnixMilli()
	if now == s.lastTime {
		s.sequence = (s.sequence + 1) & maxSequence
		if s.sequence == 0 {
			// Wait for next millisecond
			for now <= s.lastTime {
				now = time.Now().UnixMilli()
			}
		}
	} else {
		s.sequence = 0
	}
	s.lastTime = now

	id := ((now - s.epoch) << timeShift) |
		(s.nodeID << nodeShift) |
		s.sequence

	return id
}

// GenerateString generates an ID as a string.
func (s *Snowflake) GenerateString() string {
	return fmt.Sprintf("%d", s.Generate())
}

// Parse parses a snowflake ID into its components.
func (s *Snowflake) Parse(id int64) (timestamp int64, nodeID int64, sequence int64) {
	timestamp = (id >> timeShift) + s.epoch
	nodeID = (id >> nodeShift) & maxNodeID
	sequence = id & maxSequence
	return
}

// Timestamp extracts the timestamp from an ID.
func (s *Snowflake) Timestamp(id int64) time.Time {
	ts := (id >> timeShift) + s.epoch
	return time.UnixMilli(ts)
}

// =============================================================================
// Global Generator
// =============================================================================

var (
	globalGenerator *Snowflake
	globalOnce      sync.Once
	initErr         error
)

// Init initializes the global generator with the given node ID.
func Init(nodeID int64) error {
	globalOnce.Do(func() {
		gen, err := New(nodeID)
		if err != nil {
			initErr = err
			return
		}
		globalGenerator = gen
	})
	return initErr
}

// Generate generates an ID using the global generator.
func Generate() int64 {
	if globalGenerator == nil {
		// Auto-initialize with node 0 if not initialized
		Init(0)
	}
	return globalGenerator.Generate()
}

// GenerateString generates an ID string using the global generator.
func GenerateString() string {
	return fmt.Sprintf("%d", Generate())
}

// =============================================================================
// ID Types for different entities
// =============================================================================

type IDType byte

const (
	IDTypeUser    IDType = 1
	IDTypeAgent   IDType = 2
	IDTypeSession IDType = 3
	IDTypeMessage IDType = 4
	IDTypeThread  IDType = 5
	IDTypeChat    IDType = 6
	IDTypeChannel IDType = 7
)

// typePrefix returns the prefix for an ID type.
func typePrefix(t IDType) string {
	switch t {
	case IDTypeUser:
		return "usr"
	case IDTypeAgent:
		return "agt"
	case IDTypeSession:
		return "ses"
	case IDTypeMessage:
		return "msg"
	case IDTypeThread:
		return "thd"
	case IDTypeChat:
		return "cht"
	case IDTypeChannel:
		return "chn"
	default:
		return "id"
	}
}

// TypedID generates an ID with type prefix.
type TypedID struct {
	sf *Snowflake
}

// NewTypedID creates a typed ID generator.
func NewTypedID(nodeID int64) (*TypedID, error) {
	sf, err := New(nodeID)
	if err != nil {
		return nil, err
	}
	return &TypedID{sf: sf}, nil
}

// Generate generates a typed ID.
func (t *TypedID) Generate(idType IDType) string {
	id := t.sf.Generate()
	prefix := typePrefix(idType)
	return fmt.Sprintf("%s_%d", prefix, id)
}

// =============================================================================
// Global Typed Generator
// =============================================================================

var (
	globalTypedGen  *TypedID
	globalTypedOnce sync.Once
)

// InitTyped initializes the global typed generator.
func InitTyped(nodeID int64) error {
	var initErr error
	globalTypedOnce.Do(func() {
		gen, err := NewTypedID(nodeID)
		if err != nil {
			initErr = err
			return
		}
		globalTypedGen = gen
	})
	return initErr
}

// NewUserID generates a new user ID.
func NewUserID() string {
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(IDTypeUser)
}

// NewAgentID generates a new agent ID.
func NewAgentID() string {
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(IDTypeAgent)
}

// NewSessionID generates a new session ID.
func NewSessionID() string {
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(IDTypeSession)
}

// NewMessageID generates a new message ID.
func NewMessageID() string {
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(IDTypeMessage)
}

// NewThreadID generates a new thread ID.
func NewThreadID() string {
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(IDTypeThread)
}

// NewChatID generates a new chat ID.
func NewChatID() string {
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(IDTypeChat)
}

// NewChannelID generates a new channel ID.
func NewChannelID() string {
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(IDTypeChannel)
}

// GenerateTypedID generates a typed ID with the given type prefix.
func GenerateTypedID(idType string) string {
	var t IDType
	switch idType {
	case "usr", "user":
		t = IDTypeUser
	case "agt", "agent":
		t = IDTypeAgent
	case "ses", "session":
		t = IDTypeSession
	case "msg", "message":
		t = IDTypeMessage
	case "thd", "thread":
		t = IDTypeThread
	case "cht", "chat":
		t = IDTypeChat
	case "chn", "channel":
		t = IDTypeChannel
	default:
		t = IDTypeMessage // Default to message
	}
	if globalTypedGen == nil {
		InitTyped(0)
	}
	return globalTypedGen.Generate(t)
}
