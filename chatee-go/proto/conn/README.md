# WebSocket Connection Protocol

## 概述

`conn.proto` 定义了客户端和服务端之间 WebSocket 通信的消息格式。这个 proto 文件应该被客户端和服务端共享，以确保类型安全和一致性。

## 使用方式

### 生成代码

```bash
# 生成 Go 代码
protoc --go_out=. --go_opt=paths=source_relative \
  --go-grpc_out=. --go-grpc_opt=paths=source_relative \
  proto/conn/conn.proto

# 生成其他语言代码（如 TypeScript/JavaScript）
protoc --ts_out=. proto/conn/conn.proto
```

### 消息格式

虽然使用 protobuf 定义，但在 WebSocket 传输时通常使用 JSON 格式：

```json
{
  "id": "msg_123456",
  "type": "MSG_SUBSCRIBE",
  "timestamp": 1699123456789,
  "subscribe": {
    "session_id": "session_abc",
    "channel": "general"
  }
}
```

### 客户端使用示例

```typescript
// TypeScript/JavaScript
import { WebSocketMessage, MessageType } from './proto/conn/conn_pb';

const ws = new WebSocket('ws://localhost:8081/ws?user_id=user123&session_id=session456');

ws.onmessage = (event) => {
  const msg = WebSocketMessage.fromJSON(JSON.parse(event.data));
  
  switch (msg.type) {
    case MessageType.MSG_CONNECTED:
      console.log('Connected:', msg.connected);
      break;
    case MessageType.MSG_PUSH_CHAT_MESSAGE:
      console.log('New message:', msg.pushChatMessage);
      break;
  }
};

// 发送订阅消息
const subscribeMsg = new WebSocketMessage({
  id: generateId(),
  type: MessageType.MSG_SUBSCRIBE,
  timestamp: Date.now(),
  subscribe: {
    sessionId: 'session_abc',
    channel: 'general'
  }
});

ws.send(JSON.stringify(subscribeMsg.toJSON()));
```

### 服务端使用示例

```go
// Go
import (
    "encoding/json"
    pb "chatee-go/proto/conn"
)

// 接收消息
var msg pb.WebSocketMessage
if err := json.Unmarshal(data, &msg); err != nil {
    return err
}

switch msg.Type {
case pb.MessageType_MSG_PING:
    // 处理心跳
    sendPong(conn)
case pb.MessageType_MSG_SUBSCRIBE:
    // 处理订阅
    handleSubscribe(conn, msg.GetSubscribe())
}

// 发送消息
response := &pb.WebSocketMessage{
    Id:        generateID(),
    Type:      pb.MessageType_MSG_CONNECTED,
    Timestamp: time.Now().UnixMilli(),
    Payload: &pb.WebSocketMessage_Connected{
        Connected: &pb.ConnectedPayload{
            ConnectionId: connID,
            UserId:       userID,
            SessionId:    sessionID,
            ServerTime:   time.Now().UnixMilli(),
        },
    },
}

data, _ := json.Marshal(response)
conn.WriteMessage(websocket.TextMessage, data)
```

## 消息类型说明

### 客户端 -> 服务端

- `MSG_PING`: 心跳包
- `MSG_SUBSCRIBE`: 订阅频道/会话
- `MSG_UNSUBSCRIBE`: 取消订阅
- `MSG_SEND_MESSAGE`: 发送消息
- `MSG_TYPING`: 输入状态
- `MSG_ACK`: 确认收到消息

### 服务端 -> 客户端

- `MSG_CONNECTED`: 连接成功
- `MSG_PONG`: 心跳响应
- `MSG_SUBSCRIBED`: 订阅确认
- `MSG_UNSUBSCRIBED`: 取消订阅确认
- `MSG_MESSAGE_RECEIVED`: 消息接收确认
- `MSG_USER_TYPING`: 用户输入状态通知
- `MSG_ERROR`: 错误消息

### 推送通知

- `MSG_PUSH_THREAD_ROOT`: Thread 根消息推送
- `MSG_PUSH_THREAD_REPLY`: Thread 回复推送
- `MSG_PUSH_CHAT_MESSAGE`: Chat 消息推送
- `MSG_PUSH_MENTION`: @提及推送
- `MSG_PUSH_FEED_UPDATE`: Feed 更新推送

## 注意事项

1. **消息 ID**: 每个消息都应该有唯一的 ID，用于请求/响应匹配
2. **时间戳**: 使用 Unix 时间戳（毫秒）
3. **错误处理**: 服务端应发送 `MSG_ERROR` 消息而不是直接关闭连接
4. **心跳**: 客户端应定期发送 `MSG_PING`，服务端响应 `MSG_PONG`
5. **批量消息**: 可以使用 `BatchMessage` 在一个 WebSocket 帧中发送多个消息
