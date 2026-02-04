# MCP Server 实现规范（HTTP-Stream / Streamable HTTP）

本文档基于本仓库实际客户端与代理实现，描述 **仅 HTTP-Stream（Streamable HTTP）** 下 MCP Server 的对接规范。实现语言不限；客户端与代理行为以当前代码为准。

---

## 1. 概述

- **传输**：同一 URL 上，**POST** 发送 JSON-RPC 请求，响应可为 **JSON** 或 **SSE（text/event-stream）**；部分场景会先 **GET** 建立 SSE 长连接再收事件。
- **协议版本**：当前使用 `mcp-protocol-version: 2025-06-18`（兼容 2025-03-26）。
- **会话**：服务端通过响应头 `mcp-session-id` 分配会话；客户端在后续请求中必须携带该头，否则视为新会话或导致 404/410。

---

## 2. CORS

若 Server 被浏览器直连，必须允许：

- **Allow-Origin**：至少包含前端来源或 `*`。
- **Allow-Methods**：`GET, POST, OPTIONS`（以及若需要：PUT, DELETE, PATCH）。
- **Allow-Headers**：必须包含  
  `Content-Type`, `Accept`, `Authorization`, `mcp-protocol-version`, `mcp-session-id`。
- **Expose-Headers**：必须包含 **`mcp-session-id`**，否则浏览器无法读取会话 ID。

本仓库代理层对上述头做了统一 CORS 配置，直连时 Server 需自行满足。

---

## 3. 请求

### 3.1 公共请求头

| Header | 说明 |
|--------|------|
| `Content-Type` | `application/json`（POST 时） |
| `Accept` | `application/json, text/event-stream`（建议同时接受，便于返回 SSE） |
| `mcp-protocol-version` | 协议版本，如 `2025-06-18` |
| `mcp-session-id` | 会话 ID；**首次 initialize 不携带**，后续请求必须携带服务端返回的值 |
| `Authorization` | 可选，如 `Bearer <token>`（OAuth/API Key） |

### 3.2 GET（建立 SSE 连接）

- **用途**：建立 Server-Sent Events 长连接，用于接收异步事件（如 initialize 的 202 后通过 SSE 返回结果）。
- **无 URL 参数时**：客户端可能用于预检；建议返回 `200` 与简单说明，避免 405。
- **响应**：  
  - `Content-Type: text/event-stream`，并建议 `Cache-Control: no-cache`, `Connection: keep-alive`。  
  - 若返回 JSON 而非 SSE，客户端会按普通 JSON 处理。

### 3.3 POST（JSON-RPC）

- **Body**：JSON-RPC 2.0，例如：
  - `jsonrpc`: `"2.0"`
  - `id`: 数字或字符串，请求唯一标识
  - `method`: 字符串（见下）
  - `params`: 对象（可为空）

**必须支持的方法：**

| method | 说明 |
|--------|------|
| `initialize` | 初始化会话；**不得带** `mcp-session-id`，服务端分配并在响应头返回 |
| `notifications/initialized` | 客户端在收到 initialize 结果后发送，无返回值 |
| `tools/list` | 列出工具；客户端可能期望 JSON 或 SSE（见 4.2） |
| `tools/call` | 调用工具，参数含 `name`、`arguments` 等 |

---

## 4. 响应

### 4.1 会话 ID

- **initialize**：服务端应在响应头中返回 **`mcp-session-id`**；若为 SSE，可在首条有效事件的同一响应上下文中通过 HTTP 头返回（具体以实现为准），客户端会从响应头读取并缓存。
- 后续所有 **POST/GET** 请求，客户端都会带上该 **`mcp-session-id`**；未带或过期可能导致 404/410，客户端会触发重连（重新 initialize）。

### 4.2 响应格式：JSON 或 SSE

- **JSON**：  
  `Content-Type: application/json`，Body 为单个 JSON-RPC 对象。
- **SSE**：  
  `Content-Type: text/event-stream`，每条事件为多行文本，以双换行 `\n\n` 或 `\r\n\r\n` 分隔。

**SSE 事件格式（本端解析约定）：**

- 行首 `event:` 表示事件类型（如 `message`），可选。
- 行首 `data:` 表示数据；**数据为单行 JSON 字符串**，内容为 JSON-RPC 2.0 对象。
- 客户端/代理会按行解析，取 `data:` 行去掉前缀 `data: ` 后解析 JSON；多行 `data` 会拼接后解析。
- 兼容写法示例：
  - `data: {"jsonrpc":"2.0","id":1,"result":{...}}\n\n`
  - `event: message\ndata: {"jsonrpc":"2.0",...}\n\n`

**JSON-RPC 响应结构：**

- 成功：`{ "jsonrpc": "2.0", "id": <与请求一致>, "result": <...> }`
- 失败：`{ "jsonrpc": "2.0", "id": <与请求一致>, "error": { "code": <number>, "message": "<string>", "data": <可选> } }`

### 4.3 initialize

- 请求体示例：
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "Workflow Manager", "version": "1.0.0" }
    }
  }
  ```
- 服务端可返回：
  - **200 + JSON**：Body 中 `result` 包含 `serverInfo` 等。
  - **202 Accepted + SSE**：结果通过 SSE 事件返回；事件中的 JSON-RPC `result` 应包含 `serverInfo`，客户端/代理据此判断初始化成功。
- 无论 200 还是 202，**响应头中必须带 `mcp-session-id`**，供后续请求使用。

### 4.4 notifications/initialized

- 客户端在收到 initialize 成功结果后，会再发一条 **notifications/initialized**（无 `id`，无返回值）。
- 请求体示例：`{ "jsonrpc": "2.0", "method": "notifications/initialized", "params": {} }`
- 服务端应返回成功（如 200 空或 204），并保持同一 `mcp-session-id`。

### 4.5 tools/list

- 请求体示例：
  ```json
  {
    "jsonrpc": "2.0",
    "id": <number>,
    "method": "tools/list",
    "params": { "_meta": { "progressToken": <number> } }
  }
  ```
- 响应 **result** 须为对象，且包含 **tools** 数组；每项至少包含 **name**。
- 若返回 SSE：客户端/代理会从 SSE 中解析出**一条** JSON-RPC 对象（含 `result.tools`），并可能转为单次 JSON 响应给上层；因此 SSE 中应包含完整 tools/list 的 JSON-RPC 消息。

### 4.6 tools/call

- 请求体含 `name`、`arguments` 等；响应 **result** 结构由工具定义（常见为 `content` 数组，项含 `type`、`text` 等）。
- 若返回 SSE，客户端/代理会从 SSE 中解析出**一条** JSON-RPC 对象作为 tools/call 的最终结果。

---

## 5. 超时与错误

- **连接/读取超时**：客户端与代理侧对单次请求常用 **120 秒**；SSE 流式读取时，若长时间无新数据（如 180 秒），可能关闭流并发送错误事件（如 `-32000` “Stream read timeout”）。
- **会话失效**：当返回 **404 / 410** 时，客户端会认为会话失效并触发重连（重新 initialize、清理旧 `mcp-session-id`）；502/503/504 同样可能触发重连。
- **错误码**：建议遵循 JSON-RPC 2.0 及 MCP 约定（如 `-32603` 内部错误、`-32000` 自定义业务/流错误）。

---

## 6. 实现检查清单（Server 端）

- [ ] CORS：暴露 `mcp-session-id`，允许 `Content-Type`, `Accept`, `Authorization`, `mcp-protocol-version`, `mcp-session-id`。
- [ ] POST 支持 `initialize` / `notifications/initialized` / `tools/list` / `tools/call`；Body 为 JSON-RPC 2.0。
- [ ] 首次 **initialize** 不在请求头带 `mcp-session-id`；响应头返回 **`mcp-session-id`**；后续请求均带该头。
- [ ] 若使用 SSE：`Content-Type: text/event-stream`，事件以 `data: <JSON-RPC 对象>` 形式发送，双换行分隔；支持 `event: message` 可选。
- [ ] **tools/list** 的 `result` 为 `{ "tools": [ { "name": "...", ... } ] }`。
- [ ] GET 无 URL 参数时返回 200 而非 405；GET 用于 SSE 时返回 `text/event-stream`。
- [ ] 长时无数据时考虑心跳或合理超时，避免客户端 180 秒无数据断开。

---

## 7. 参考（本仓库）

- 代理与 CORS：`backend/app.py`（CORS 列表、`/mcp/proxy`、SSE 转发与 SSE→JSON 转换）。
- 会话与初始化：`backend/mcp_server/mcp_common_logic.py`（`prepare_mcp_headers`、`initialize_mcp_session`、`parse_sse_event`、`parse_mcp_jsonrpc_response`、`_parse_sse_text_to_jsonrpc`）。
- 前端客户端：`front/src/services/mcpClient.ts`（协议版本、sessionId、tools/list 的 SSE 解析、重连与健康检查）。

以上为当前代码行为归纳，若与官方 MCP 规范有出入，以官方规范为准；本规范侧重与本仓库客户端/代理的兼容实现。
