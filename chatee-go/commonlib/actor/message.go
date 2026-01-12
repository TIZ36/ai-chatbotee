package actor

import (
	"encoding/json"
	"time"
)

// =============================================================================
// Message Types - 消息类型定义
// =============================================================================

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
