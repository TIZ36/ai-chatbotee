# MCP (Model Context Protocol) 实现文档

## 概述

MCP (Model Context Protocol) 是一个基于 JSON-RPC 2.0 的协议，用于客户端与 MCP 服务器之间的通信。本实现支持两种传输方式：stdio 和 HTTP/SSE。

## 目录结构

```
mcp/
├── types.go           # MCP 协议类型定义
├── transport.go       # 传输层接口定义
├── stdio_transport.go # stdio 传输实现
├── http_transport.go  # HTTP/SSE 传输实现
├── client.go          # MCP 客户端实现
├── manager.go        # MCP 服务器管理器
└── README.md          # 本文档
```

## MCP 协议类型

### JSON-RPC 2.0 类型

- `JSONRPCRequest`: JSON-RPC 请求
- `JSONRPCResponse`: JSON-RPC 响应
- `JSONRPCError`: JSON-RPC 错误

### MCP 协议类型

- `ServerInfo`: 服务器信息（名称、版本、能力）
- `ServerCapabilities`: 服务器能力（工具、资源、提示）
- `Tool`: 工具定义
- `ToolResult`: 工具调用结果
- `ToolContent`: 工具内容（文本、图片、资源）
- `Resource`: 资源定义
- `Prompt`: 提示定义
- `PromptArgument`: 提示参数

### 传输配置类型

- `TransportType`: 传输类型（http, sse, stdio）
- `AuthType`: 认证类型（none, bearer, oauth）
- `AuthConfig`: 认证配置
- `ConnectionStatus`: 连接状态

## 传输方式

### 1. Stdio 传输

**用途**: 本地进程通信

**实现方式**:
- 将 MCP 服务器作为子进程启动
- 通过标准输入（stdin）和标准输出（stdout）进行通信
- 每条消息以换行符分隔（newline-delimited JSON）

**连接过程**:
1. 启动命令进程
2. 建立 stdin/stdout 管道
3. 创建扫描器读取 stdout
4. 连接建立完成

**消息格式**:
```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}\n
{"jsonrpc":"2.0","id":1,"result":{...}}\n
```

**认证**: stdio 传输不支持认证（本地进程，无需认证）

### 2. HTTP/SSE 传输

**用途**: 远程服务器通信，支持流式传输

**实现方式**:
- 服务器作为独立进程运行
- 通过 HTTP POST 请求发送 JSON-RPC 消息
- 可选支持 Server-Sent Events (SSE) 流式传输

**连接过程**:
1. 发送 GET 请求验证端点可达性
2. 检查 HTTP 状态码（2xx 表示成功）
3. 连接建立完成

**消息格式**:
- 普通请求: POST 请求体包含 JSON-RPC 消息
- SSE 流式: `Accept: text/event-stream`，响应格式为 `data: <json>\n`

**认证方式**:

#### 无 Token 连接
```go
config := ServerConfig{
    Type: TransportHTTP,
    URL:  "http://example.com/mcp",
    Auth:  nil, // 无认证
}
```

#### Bearer Token 认证
```go
config := ServerConfig{
    Type: TransportHTTP,
    URL:  "http://example.com/mcp",
    Auth: &AuthConfig{
        Type:  AuthBearer,
        Token: "your-token-here",
    },
}
```
自动添加 HTTP 头: `Authorization: Bearer <token>`

#### OAuth 认证
```go
config := ServerConfig{
    Type: TransportHTTP,
    URL:  "http://example.com/mcp",
    Auth: &AuthConfig{
        Type:         AuthOAuth,
        ClientID:     "client-id",
        ClientSecret: "client-secret",
        TokenURL:     "https://oauth.example.com/token",
        Scopes:       []string{"read", "write"},
    },
}
```
注意: OAuth token 交换需要在 Manager 层面处理，transport 只负责使用 token。

## 连接建立过程

### 完整连接流程

```
1. 创建传输层 (Transport)
   ├─ stdio: 创建 StdioTransport
   └─ http:  创建 HTTPTransport

2. 建立传输连接
   ├─ stdio: 启动进程，建立管道
   └─ http:  验证端点可达性

3. 发送 initialize 请求
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "initialize",
     "params": {
       "protocolVersion": "2024-11-05",
       "capabilities": {},
       "clientInfo": {
         "name": "chatee",
         "version": "1.0.0"
       }
     }
   }

4. 接收 initialize 响应
   {
     "jsonrpc": "2.0",
     "id": 1,
     "result": {
       "name": "server-name",
       "version": "1.0.0",
       "capabilities": {
         "tools": {...},
         "resources": {...},
         "prompts": {...}
       }
     }
   }

5. 发送 initialized 通知
   {
     "jsonrpc": "2.0",
     "method": "notifications/initialized",
     "params": {}
   }

6. 加载可用资源
   ├─ 如果支持 tools: 调用 tools/list
   ├─ 如果支持 resources: 调用 resources/list
   └─ 如果支持 prompts: 调用 prompts/list

7. 连接建立完成
```

### 认证流程

#### 无 Token 连接
```
客户端 → 服务器: GET /mcp (无认证头)
服务器 → 客户端: 200 OK
连接建立
```

#### Bearer Token 连接
```
客户端 → 服务器: GET /mcp
                Authorization: Bearer <token>
服务器 → 客户端: 200 OK
连接建立
```

#### OAuth 连接
```
1. 客户端 → OAuth 服务器: 获取授权 URL
2. 用户授权
3. 客户端 → OAuth 服务器: 交换 code 获取 token
4. 客户端 → MCP 服务器: GET /mcp
                          Authorization: Bearer <token>
5. 服务器 → 客户端: 200 OK
6. 连接建立
```

## 使用示例

### 1. 使用 Stdio 传输

```go
// 创建 stdio 传输
transport := NewStdioTransport(StdioTransportConfig{
    Command: "python",
    Args:    []string{"-m", "mcp_server"},
    Env:     map[string]string{"API_KEY": "secret"},
})

// 创建客户端
client := NewClient(transport)

// 连接并初始化
clientInfo := map[string]string{
    "name":    "chatee",
    "version": "1.0.0",
}
serverInfo, err := client.Connect(ctx, clientInfo)
if err != nil {
    log.Fatal(err)
}

// 列出工具
tools, err := client.ListTools(ctx)
if err != nil {
    log.Fatal(err)
}

// 调用工具
result, err := client.CallTool(ctx, "tool_name", map[string]any{
    "arg1": "value1",
})
```

### 2. 使用 HTTP 传输（无 Token）

```go
// 创建 HTTP 传输
transport := NewHTTPTransport(HTTPTransportConfig{
    BaseURL: "http://example.com/mcp",
    Headers: map[string]string{},
})

// 创建客户端
client := NewClient(transport)

// 连接并初始化
clientInfo := map[string]string{
    "name":    "chatee",
    "version": "1.0.0",
}
serverInfo, err := client.Connect(ctx, clientInfo)
```

### 3. 使用 HTTP 传输（Bearer Token）

```go
// 创建 HTTP 传输（带认证）
transport := NewHTTPTransport(HTTPTransportConfig{
    BaseURL: "http://example.com/mcp",
    Headers: map[string]string{
        "Authorization": "Bearer your-token-here",
    },
})

// 创建客户端
client := NewClient(transport)

// 连接并初始化
clientInfo := map[string]string{
    "name":    "chatee",
    "version": "1.0.0",
}
serverInfo, err := client.Connect(ctx, clientInfo)
```

### 4. 使用 Manager 管理多个服务器

```go
// 创建管理器
manager := NewManager()

// 添加 stdio 服务器
err := manager.AddServer(ServerConfig{
    ID:          "local-server",
    Name:        "Local MCP Server",
    Type:        TransportStdio,
    Command:     "python",
    Args:        []string{"-m", "mcp_server"},
    AutoConnect: true,
})

// 添加 HTTP 服务器（无 token）
err = manager.AddServer(ServerConfig{
    ID:          "remote-server",
    Name:        "Remote MCP Server",
    Type:        TransportHTTP,
    URL:         "http://example.com/mcp",
    AutoConnect: true,
})

// 添加 HTTP 服务器（Bearer token）
err = manager.AddServer(ServerConfig{
    ID:          "auth-server",
    Name:        "Authenticated MCP Server",
    Type:        TransportHTTP,
    URL:         "http://example.com/mcp",
    Auth: &AuthConfig{
        Type:  AuthBearer,
        Token: "your-token-here",
    },
    AutoConnect: true,
})

// 连接所有自动连接的服务器
err = manager.ConnectAll(ctx)

// 列出所有工具
allTools, err := manager.ListAllTools(ctx)

// 调用特定服务器的工具
result, err := manager.CallTool(ctx, "auth-server", "tool_name", map[string]any{
    "arg1": "value1",
})
```

## 错误处理

### 连接错误
- `not connected`: 传输层未连接
- `failed to start process`: stdio 进程启动失败
- `HTTP error 401`: 认证失败（token 无效）
- `HTTP error 404`: 端点不存在

### 协议错误
- `JSON-RPC error -32700`: 解析错误
- `JSON-RPC error -32600`: 无效请求
- `JSON-RPC error -32601`: 方法不存在
- `JSON-RPC error -32602`: 无效参数

## 注意事项

1. **Stdio 传输**:
   - 每个消息必须是单行 JSON（newline-delimited）
   - 消息中不能包含嵌入的换行符
   - 进程终止时连接自动关闭

2. **HTTP 传输**:
   - 支持超时配置（默认 30 秒）
   - Bearer token 自动添加到 Authorization 头
   - SSE 流式传输需要服务器支持

3. **认证**:
   - stdio 传输不支持认证（本地进程）
   - HTTP 传输支持 Bearer token
   - OAuth 需要额外的 token 交换逻辑

4. **线程安全**:
   - Client 和 Manager 都是线程安全的
   - 可以并发调用工具和资源操作

## 参考

- [MCP 协议规范](https://modelcontextprotocol.io)
- [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)

---

**文档更新记录**：
- 2024-12-XX: 初始版本，包含完整的协议类型、传输方式、连接流程和使用示例
- 遵循项目文档规范：每次代码修改后同步更新本文档

