# 后端架构设计

## 一、架构总览

根据前端新架构（五层分层）设计对应的后端服务：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Electron Layer                                  │
│  窗口管理 │ 文件系统 │ 终端(PTY) │ OAuth窗口 │ IPC桥接                    │
├─────────────────────────────────────────────────────────────────────────┤
│                          Backend API Layer                               │
│  Flask REST API │ MCP Proxy │ WebSocket (Optional)                      │
├─────────────────────────────────────────────────────────────────────────┤
│                          Service Layer                                   │
│  LLMService │ MCPService │ SessionService │ WorkflowService             │
├─────────────────────────────────────────────────────────────────────────┤
│                          Data Layer                                      │
│  MySQL │ Redis │ File Storage                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## 二、后端目录结构（重构后）

```
backend/
├── app.py                      # Flask 应用入口（保持兼容）
├── config.yaml                 # 配置文件
├── database.py                 # 数据库连接（保持兼容）
├── requirements.txt            # Python 依赖
│
├── api/                        # API 路由层（新增）
│   ├── __init__.py
│   ├── llm.py                  # LLM 配置 API
│   ├── mcp.py                  # MCP 服务器/代理 API
│   ├── session.py              # 会话 API
│   ├── message.py              # 消息 API
│   ├── workflow.py             # 工作流 API
│   ├── roundtable.py           # 圆桌会议 API
│   ├── research.py             # 研究助手 API
│   ├── crawler.py              # 爬虫 API
│   └── user.py                 # 用户访问 API
│
├── services/                   # 服务层（新增）
│   ├── __init__.py
│   ├── llm_service.py          # LLM 服务
│   ├── mcp_service.py          # MCP 服务（代理、健康检查）
│   ├── session_service.py      # 会话服务
│   ├── message_service.py      # 消息服务
│   ├── workflow_service.py     # 工作流服务
│   ├── oauth_service.py        # OAuth 服务
│   └── crawler_service.py      # 爬虫服务
│
├── models/                     # 数据模型（新增）
│   ├── __init__.py
│   ├── llm_config.py           # LLM 配置模型
│   ├── mcp_server.py           # MCP 服务器模型
│   ├── session.py              # 会话模型
│   ├── message.py              # 消息模型
│   └── workflow.py             # 工作流模型
│
├── mcp_server/                 # MCP 服务器模块（已有）
│   ├── __init__.py
│   ├── mcp_common_logic.py
│   └── well_known/
│       ├── __init__.py
│       └── notion.py
│
└── utils/                      # 工具模块（新增）
    ├── __init__.py
    ├── cors.py                 # CORS 配置
    ├── auth.py                 # 认证工具
    └── logger.py               # 日志工具
```

## 三、API 设计

### 3.1 LLM API (`/api/llm`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/llm/configs | 获取所有 LLM 配置 |
| GET | /api/llm/configs/:id | 获取单个配置 |
| POST | /api/llm/configs | 创建配置 |
| PUT | /api/llm/configs/:id | 更新配置 |
| DELETE | /api/llm/configs/:id | 删除配置 |
| GET | /api/llm/configs/:id/key | 获取 API Key（安全） |

### 3.2 MCP API (`/api/mcp`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/mcp/servers | 获取所有 MCP 服务器 |
| POST | /api/mcp/servers | 添加服务器 |
| PUT | /api/mcp/servers/:id | 更新服务器 |
| DELETE | /api/mcp/servers/:id | 删除服务器 |
| POST | /mcp | MCP 代理（解决 CORS） |
| GET | /mcp/health | MCP 健康检查代理 |
| POST | /mcp/oauth/* | OAuth 流程 |

### 3.3 Session API (`/api/sessions`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/sessions | 获取会话列表 |
| POST | /api/sessions | 创建会话 |
| GET | /api/sessions/:id | 获取会话详情 |
| PUT | /api/sessions/:id | 更新会话 |
| DELETE | /api/sessions/:id | 删除会话 |
| GET | /api/sessions/:id/messages | 获取消息列表 |
| POST | /api/sessions/:id/messages | 保存消息 |

### 3.4 Message API (`/api/messages`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/messages/:id | 获取消息详情 |
| PUT | /api/messages/:id | 更新消息 |
| DELETE | /api/messages/:id | 删除消息 |
| POST | /api/messages/:id/execute | 执行消息组件 |

### 3.5 Workflow API (`/api/workflows`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/workflows | 获取工作流列表 |
| POST | /api/workflows | 创建工作流 |
| GET | /api/workflows/:id | 获取工作流详情 |
| PUT | /api/workflows/:id | 更新工作流 |
| DELETE | /api/workflows/:id | 删除工作流 |

### 3.6 RoundTable API (`/api/roundtables`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/roundtables | 获取圆桌会议列表 |
| POST | /api/roundtables | 创建圆桌会议 |
| GET | /api/roundtables/:id | 获取会议详情 |
| POST | /api/roundtables/:id/messages | 发送消息 |
| GET | /api/roundtables/:id/messages | 获取消息历史 |

## 四、服务层设计

### 4.1 MCPService

```python
class MCPService:
    """MCP 服务 - 管理 MCP 服务器连接和代理"""
    
    def proxy_request(self, target_url: str, method: str, 
                     headers: dict, body: dict) -> Response:
        """代理 MCP 请求（解决 CORS）"""
        pass
    
    def check_health(self, server_url: str) -> HealthCheckResult:
        """检查服务器健康状态"""
        pass
    
    def list_tools(self, server_id: str) -> List[MCPTool]:
        """获取工具列表"""
        pass
    
    def call_tool(self, server_id: str, tool_name: str, 
                  args: dict) -> ToolResult:
        """调用工具"""
        pass
```

### 4.2 SessionService

```python
class SessionService:
    """会话服务 - 管理会话和消息"""
    
    def create_session(self, data: SessionCreate) -> Session:
        """创建会话"""
        pass
    
    def get_session(self, session_id: str) -> Session:
        """获取会话"""
        pass
    
    def save_message(self, session_id: str, 
                    message: MessageCreate) -> Message:
        """保存消息"""
        pass
    
    def get_messages(self, session_id: str, 
                    limit: int, before: str) -> List[Message]:
        """获取消息列表（分页）"""
        pass
```

### 4.3 OAuthService

```python
class OAuthService:
    """OAuth 服务 - 处理 MCP OAuth 流程"""
    
    def start_auth_flow(self, mcp_url: str) -> AuthFlowResult:
        """开始 OAuth 流程"""
        pass
    
    def handle_callback(self, session_id: str, 
                       code: str, state: str) -> TokenResult:
        """处理回调"""
        pass
    
    def refresh_token(self, mcp_url: str) -> TokenResult:
        """刷新 Token"""
        pass
```

## 五、数据模型

### 5.1 LLMConfig

```python
@dataclass
class LLMConfig:
    config_id: str
    name: str
    provider: str  # openai, anthropic, gemini, ollama
    api_key: Optional[str]
    api_url: Optional[str]
    model: str
    enabled: bool = True
    metadata: Optional[dict] = None
```

### 5.2 MCPServer

```python
@dataclass
class MCPServer:
    server_id: str
    name: str
    url: str
    type: str  # http-stream, http-post, stdio
    enabled: bool = True
    use_proxy: bool = True
    metadata: Optional[dict] = None
    ext: Optional[dict] = None  # 扩展配置
```

### 5.3 Session

```python
@dataclass
class Session:
    session_id: str
    title: Optional[str]
    name: Optional[str]
    llm_config_id: Optional[str]
    session_type: str  # temporary, memory, agent
    avatar: Optional[str]
    system_prompt: Optional[str]
    media_output_path: Optional[str]
    role_id: Optional[str]
    created_at: datetime
    updated_at: datetime
```

### 5.4 Message

```python
@dataclass
class Message:
    message_id: str
    session_id: str
    role: str  # user, assistant, system, tool
    content: str
    thinking: Optional[str]
    tool_calls: Optional[list]
    token_count: Optional[int]
    acc_token: Optional[int]
    ext: Optional[dict]
    mcpdetail: Optional[dict]
    created_at: datetime
```

## 六、与前端新架构的对应关系

| 前端层 | 前端模块 | 后端 API | 后端服务 |
|--------|----------|----------|----------|
| Core | message/SlowDB | /api/messages | MessageService |
| Core | context | N/A (前端处理) | - |
| Core | media | /api/files | FileService |
| Provider | llm | /api/llm | LLMService |
| Provider | mcp | /mcp (proxy) | MCPService |
| Provider | voice | N/A (前端处理) | - |
| Workflow | executor | /api/workflows | WorkflowService |
| Session | Session | /api/sessions | SessionService |
| Session | Agent | /api/sessions (agent) | SessionService |
| Session | memory | /api/sessions/:id/summaries | SummaryService |
| Apps | roundtable | /api/roundtables | RoundTableService |
| Apps | research | /api/research | ResearchService |

## 七、迁移计划

### Phase 1: 保持兼容
- 保留现有 app.py 中的所有 API
- 新增 api/ 目录，逐步迁移路由

### Phase 2: 服务层抽取
- 从 app.py 中抽取业务逻辑到 services/
- 创建数据模型 models/

### Phase 3: 完善功能
- 增强 MCP 代理功能
- 添加 WebSocket 支持（可选）
- 优化性能

## 八、配置说明

```yaml
# config.yaml
server:
  host: 0.0.0.0
  port: 3002
  debug: false

mysql:
  enabled: true
  host: localhost
  port: 3306
  user: root
  password: xxx
  database: chatee
  pool_size: 10

redis:
  enabled: true
  host: localhost
  port: 6379
  db: 0

cors:
  origins:
    - http://localhost:5174
    - http://localhost:3000
  
mcp:
  proxy_timeout: 90
  health_check_interval: 30

research:
  upload_max_mb: 512
  max_form_parts: 20000
```
