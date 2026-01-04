# Notion MCP Well-Known 流程梳理

## 当前实现架构

### 1. **数据库表结构**
```
notion_registrations (Notion OAuth 客户端注册信息表)
├── id (PRIMARY KEY)
├── client_id (UNIQUE, 从 Notion 获取的 OAuth Client ID)
├── client_name (用户给的应用名称)
├── redirect_uri (完整的回调 URI，如 http://localhost:3001/mcp/oauth/callback/)
├── redirect_uri_base (基础 URI，如 http://localhost:3001)
├── client_uri (应用 URI)
├── registration_data (JSON, 注册时的详细数据)
└── created_at (创建时间)

oauth_tokens (OAuth Token 存储表)
├── id
├── mcp_url (MCP 服务器 URL，外键关联)
├── access_token
├── refresh_token
├── token_type
├── expires_at
├── scope
├── notion_registration_id (关联的 Notion 注册信息 ID)
└── 其他字段...
```

### 2. **核心类：NotionOAuthHandler**
位置：`/backend/mcp_server/well_known/notion.py`

**初始化流程：**
```python
NotionOAuthHandler(config, client_id=None)
    ├── 尝试从数据库读取注册信息 get_notion_registration_from_db(client_id)
    │   └── 如果找到 → 使用数据库注册信息
    └── 如果未找到 → 回退到 config.yaml 的 notion 配置
```

**关键方法：**

#### a) `get_client_id()` 
- **优先级：** 数据库注册 > config.yaml
- **返回：** Client ID 或 None

#### b) `generate_authorization_url()`
- **流程：**
  ```
  1. 获取 client_id
  2. 生成 PKCE code_verifier 和 code_challenge
  3. 生成随机 state (CSRF防护)
  4. 构建授权 URL：
     https://mcp.notion.com/authorize?
       client_id=...&
       response_type=code&
       redirect_uri=...&
       state=...&
       code_challenge=...&
       code_challenge_method=S256&
       resource=https://mcp.notion.com/
  5. 返回 {authorization_url, state, code_verifier}
  ```

#### c) `exchange_token(code, code_verifier, redirect_uri=None)`
- **流程：**
  ```
  1. 准备 token 请求数据：
     {
       grant_type: "authorization_code",
       code: <授权码>,
       redirect_uri: <回调地址>,
       code_verifier: <PKCE verifier>,
       client_id: <客户端ID>,
       resource: "https://mcp.notion.com/"
     }
  2. POST 到 https://mcp.notion.com/token
  3. 获取响应 → 包含 access_token, refresh_token 等
  4. 返回 token_data
  ```

#### d) `refresh_access_token(refresh_token, mcp_url)`
- **流程：**
  ```
  1. 准备刷新请求：
     {
       grant_type: "refresh_token",
       refresh_token: <刷新令牌>,
       client_id: <客户端ID>
     }
  2. POST 到 https://mcp.notion.com/token
  3. 获取新的 access_token
  4. 保存新 token 到数据库
  5. 返回新的 token_info
  ```

### 3. **前端 API 路由**

#### a) 注册新 Notion 客户端
```
POST /api/notion/register
请求：
{
  client_name: "my-app",
  redirect_uri_base: "http://localhost:3001",
  client_uri: "https://github.com/TIZ36/chatee"
}

响应：
{
  client_id: "<新生成的 client_id>",
  redirect_uri: "http://localhost:3001/mcp/oauth/callback/",
  authorization_url: "https://mcp.notion.com/authorize?...",
  state: "notion_oauth_...",
  code_verifier: "..."
}
```

#### b) 生成授权 URL（适用于已注册的客户端）
```
POST /api/notion/oauth/authorize
请求：
{
  client_id: "<可选，指定使用哪个注册>"
}

响应：
{
  authorization_url: "https://mcp.notion.com/authorize?...",
  state: "notion_oauth_...",
  code_verifier: "..."
}
```

#### c) 处理 OAuth 回调
```
POST /api/notion/oauth/callback
请求：
{
  code: "<授权码>",
  code_verifier: "<PKCE verifier>"
}

响应：
{
  access_token: "...",
  workspace_id: "...",
  workspace_name: "...",
  bot_id: "..."
}
```

#### d) 获取已注册的客户端列表
```
GET /api/notion/registrations

响应：
{
  registrations: [
    {
      client_id: "...",
      client_name: "...",
      redirect_uri: "...",
      ...
    }
  ]
}
```

#### e) 获取特定客户端详情
```
GET /api/notion/registrations/<client_id>

响应：
{
  client_id: "...",
  client_name: "...",
  ...
}
```

### 4. **在 MCP 请求中的集成**

位置：`/backend/app.py` 的 `/api/mcp/call` 路由

**流程：**
```
1. 接收 MCP 请求 (针对 Notion MCP 服务器)
2. 检查 is_notion = 'mcp.notion.com' in target_url
3. 如果是 Notion 请求：
   a) 根据 mcp_url 获取存储的 oauth_token
   b) 检查 token 是否过期 (is_token_expired)
   c) 如果过期 → refresh_oauth_token() 刷新
   d) 将 token 注入到 MCP 请求头
4. 发送请求到 MCP 服务器
5. 处理响应，特别是 Notion 的 SSE 格式
```

### 5. **Token 存储和刷新机制**

**数据库操作函数：**
- `save_oauth_token(mcp_url, token_info)` - 保存 token
- `get_oauth_token(mcp_url)` - 获取 token
- `is_token_expired(token_info)` - 检查是否过期
- `refresh_oauth_token(mcp_url)` - 刷新 token

**存储键：**
- 主键：`mcp_url` (如 "https://mcp.notion.com/")
- 备用键：`client:{client_id}` (便于通过客户端 ID 查询)

---

## 当前可能的问题点

### ❓ 需要确认的地方：

1. **数据库连接**
   - `notion_registrations` 表是否正确创建？
   - 从数据库读取时是否有错误？

2. **OAuth 流程**
   - Notion 授权 URL 的参数是否正确？
   - 是否正确处理 PKCE？
   - Token 交换是否成功？

3. **Token 管理**
   - Token 是否正确保存到数据库？
   - Token 刷新逻辑是否工作？
   - MCP 请求中是否正确注入 token？

4. **SSE 解析**
   - Notion MCP 返回的 SSE 格式是否正确解析？
   - `parse_notion_sse_event()` 是否正确处理所有事件类型？

5. **API 路由**
   - 所有路由是否在 app.py 中正确暴露？
   - CORS 配置是否允许前端访问？

6. **客户端注册**
   - 是否支持多个 Notion 应用注册？
   - 如何在前端选择要使用的注册？

---

## 建议的调试步骤

1. **检查数据库**
   ```sql
   SELECT * FROM notion_registrations;
   SELECT * FROM oauth_tokens WHERE mcp_url LIKE '%notion%';
   ```

2. **检查 API 可达性**
   ```bash
   curl -X POST http://localhost:3001/api/notion/registrations
   ```

3. **检查授权流程**
   - 访问授权 URL 是否重定向到 Notion 登录？
   - 回调是否成功返回授权码？

4. **检查 Token 交换**
   - Token 交换是否返回 access_token？
   - Token 是否保存到数据库？

5. **检查 MCP 请求**
   - MCP 请求是否成功发送？
   - 响应格式是否正确解析？

