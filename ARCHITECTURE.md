# AI-Chatbotee 架构与运行逻辑（Overview）

本文档将当前项目的目录结构、模块职责、关键交互链路与运行方式落成一份可维护的架构说明，供后续迭代对齐用。

## 1. 总览

本项目是一个 Electron 桌面端 AI 工具集：

- **前端**：React + TypeScript + Vite（`src/`），提供聊天、MCP 工具配置与调用、Workflow 编辑/执行、圆桌会议、多 Agent Research、内嵌 Terminal 等 UI。
- **桌面壳**：Electron（`electron/`），负责窗口/系统能力，以及 **PTY 终端**（`node-pty`）等本地能力的桥接。
- **后端**：Flask（`backend/app.py`），对前端提供 REST API，负责配置/数据持久化（MySQL）、缓存与 OAuth 状态（Redis）、以及 MCP 代理转发等。

默认端口：

- 前端（Vite dev server）：`5174`
- 后端（Flask）：`3002`

## 2. 目录结构与职责

- `src/`：React 前端
  - `components/`：功能面板与业务组件（聊天、WorkflowEditor、MCP/LLM 配置、圆桌、Research、终端等）
  - `contexts/`：共享状态（目前核心是 `TerminalContext`）
  - `services/`：与后端/模型/MCP 的交互封装（API、客户端、池化）
  - `utils/`：小工具（如全局 terminal executor）
  - `index.css`：全局样式
- `electron/`：Electron 主进程与 preload（TS，编译后输出到 `electron/dist/*.cjs`）
- `backend/`：Flask 后端（单体 `app.py` + `database.py` + MCP server 实现等）
- `start*.sh`：一键启动/单独启动脚本

## 3. 一键启动与开发运行

### 3.1 一键启动（推荐）

使用根目录 `start.sh`：

- 安装/检查前端依赖（`node_modules`）
- 创建后端虚拟环境（`backend/venv`）并安装依赖
- `electron-rebuild` 重建 `node-pty`（原生模块）
- 编译 Electron 主进程（`npm run build:electron`）
- 清理旧进程/端口（5174/3002）
- 启动 Flask（后台），探测 `GET /api/llm/configs` 就绪
- 启动 Vite dev server（后台），探测 `http://localhost:5174` 就绪
- 启动 Electron（后台）
- 日志输出到 `/tmp/backend.log`、`/tmp/vite.log`、`/tmp/electron.log`

### 3.2 分别启动

- 后端：`cd backend && source venv/bin/activate && python app.py`（`3002`）
- 前端：`npm run dev`（`5174`）
- Electron：`npm run electron:dev` 或 `./start-electron.sh`

## 4. 端口与环境变量

前端多数 API 默认指向 `http://localhost:3002`；部分文件支持：

- `VITE_BACKEND_URL`：覆盖后端地址（例如非本机或不同端口）

注意：目前部分 service 仍然硬编码 `http://localhost:3002/api`（例如 `src/services/sessionApi.ts`、`src/services/roundTableApi.ts`、`src/services/researchApi.ts`），而 `workflowApi.ts`/`mcpClient.ts` 等则会根据 `VITE_BACKEND_URL`/Electron 环境切换。若未来需要统一部署/切换端口，建议统一收敛到一个 `getBackendUrl()`。

## 5. 前端：入口、路由与模式切换

入口：`src/main.tsx`

- 使用 `BrowserRouter`
- 注入 `TerminalProvider`（全局终端会话/历史/配置）

路由与页面布局：`src/App.tsx`

- 常规路由：
  - `/`：主聊天/工作流 UI（`Workflow`）
  - `/workflow-editor`：工作流编辑器（`WorkflowEditor`）
  - `/llm-config`：LLM 配置（`LLMConfig`）
  - `/mcp-config`：MCP 配置（`MCPConfig`）
  - `/crawler-config`：Crawler 配置（`CrawlerConfigPage`）
  - `/agents`：智能体列表 + 圆桌面板（`AgentsPage`）
  - `/settings`：设置面板
- **模式切换**（同一布局中切换主内容区域）：
  - 圆桌模式：显示 `RoundTableChat`
  - Research 模式：显示 `ResearchPanel`
  - 默认：显示 `Workflow`
  - 进入 Research/圆桌模式时会自动折叠左侧会话栏（`react-resizable-panels` 控制）

## 6. 关键业务模块与交互

### 6.1 会话与消息（Chat / Session）

核心组件：`src/components/Workflow.tsx`

- 会话列表与消息持久化：`src/services/sessionApi.ts` → 后端 `/api/sessions/*`
- 会话属性（头像/昵称/人设/媒体输出路径/默认 LLM）：均通过后端 `PUT /api/sessions/:id/*` 更新
- 支持：
  - 系统提示词/人设（可由 crawler 数据项一键设置为人设）
  - 总结（summarize）与 summarize cache 清理
  - 多模态（图片/视频/音频等）在消息中透传

> 说明：仓库中另有 `src/services/chatClient.ts`（ReliableChatClient，带网络探测与重试），但当前主聊天 UI（`Workflow.tsx`）整体实现以组件内逻辑为主，是否启用 ReliableChatClient 需进一步统一。

### 6.2 “感知组件”机制：@ 选择与执行

在 `Workflow.tsx` 中，输入框支持通过 `@` 选择 **一个**感知组件（限制只能选一个）：

- `@workflow`：选择一个 workflow（后端有配置与执行能力）
- `@mcp`：选择一个 MCP server（用于工具调用）
- `@skillpack`：选择技能包（用于 system prompt/上下文增强）

选择行为：

- 选择 workflow：会通过 `workflowPool.acquireWorkflow()` 进行预热（加载 workflow 并初始化其涉及的 MCP 连接）
- 选择 mcp：若未连接，会尝试连接并 `listTools()`，然后把 server 标记为已激活

执行行为（核心链路）：

1. 前端把感知组件信息写入一条 `role='tool'` 的消息的 `tool_calls` 字段（包含 `toolType/workflowId/workflowName/workflowStatus` 等）。
2. 用户点击执行时，前端调用 `executeMessageComponent()`（`src/services/sessionApi.ts`）→ `POST /api/messages/:message_id/execute`。
3. 后端在 `backend/app.py` 中读取消息 `tool_calls`，执行：
   - `toolType === 'workflow'`：`execute_workflow_with_llm()`（会把 workflow 内所有 LLM 节点替换为当前聊天选择的 LLM 配置）
   - `toolType === 'mcp'`：`execute_mcp_with_llm()`（由指定 LLM 驱动 MCP 工具调用）
4. 执行记录落到 `message_executions` 表，可通过 `GET /api/messages/:message_id/execution` 查询。

### 6.3 MCP：代理、连接池与 SSE 支持

前端 MCP 客户端：`src/services/mcpClient.ts`

- 使用官方 SDK 的 Client/Transport，但 **tools/list 与 tools/call** 为绕开 schema 验证问题，实际走“直接 HTTP 请求”模式。
- **统一走后端代理**：
  - 前端构建代理 URL：`http://localhost:3002/mcp?url=<encoded>&transportType=streamable-http`
  - 后端 `backend/app.py` 提供 `/mcp` 路由进行转发（并处理 CORS/headers）
- **连接池**：`MCPManager` 维护 per-server pool（空闲超时、最大池大小），支持复用会话、减少重复连接。
- **SSE**：`listTools` 和 `callTool` 均兼容 `text/event-stream`，并提供流式 chunk 回调。

配置管理：`src/components/MCPConfig.tsx` + `src/services/mcpApi.ts` → 后端 `/api/mcp/servers` 与 `/api/mcp/oauth/*`。

### 6.4 Workflow：配置管理、池化预热与执行入口

- 配置 CRUD：`src/services/workflowApi.ts` → 后端 `/api/workflows/*`
- 预热与资源复用：`src/services/workflowPool.ts`
  - 获取 workflow 配置
  - 解析 workflow 节点，找出使用的 MCP serverId
  - 通过 `mcpManager.acquireConnection()` 初始化所需 MCP 连接
  - 使用后 `returnToPool()` 归还连接，避免泄漏

执行入口现状：

- 前端存在 `executeWorkflow()` → `POST /api/workflows/:id/execute`（`src/services/workflowApi.ts`）
- 但后端路由中未看到对应 `/api/workflows/:id/execute`（需确认当前 UI 是否实际调用该接口，或未来补齐后端路由）
- 当前明确可用的“执行”入口是 `POST /api/messages/:id/execute`（感知组件执行）

### 6.5 圆桌会议（Round Table）

前端：

- `src/components/RoundTableChat.tsx`：会议列表（tab 风格）+ 选择/创建/删除/改名
- `src/components/RoundTablePanel.tsx`：会议详情与对话（多 agent 回复、选择最佳回复等）
- `src/components/AgentsPage.tsx`：智能体列表（可一键加入圆桌）+ 下方圆桌面板

服务层：`src/services/roundTableApi.ts` → 后端 `/api/round-tables/*`

后端数据表（见 `backend/database.py`）：

- `round_tables`
- `round_table_participants`（participant 绑定 `sessions`）
- `round_table_messages`
- `round_table_responses`

### 6.6 Research：资料库 + 检索 + 多 Agent 分工

前端：`src/components/ResearchPanel.tsx`

- 资料来源（sources）：URL / file / dir / image
- 上传：目录上传会保留相对路径（`webkitRelativePath`）
- 检索：`retrieve()` 从后端返回 snippet/score
- 前端编排：支持“研究员（organizer）+ 选定 agents”的工作方式，部分映射用 `localStorage` 保存（例如 research session map/研究员映射/选定 agents）

服务层：`src/services/researchApi.ts` → 后端 `/api/research/*`

后端支持 multipart 上传并设置 upload limits（见 `backend/app.py` 的 `MAX_CONTENT_LENGTH/MAX_FORM_*` 与 413 JSON 化）。

### 6.7 Terminal：Electron PTY + 前端多标签 xterm

Electron：

- `electron/preload.ts` 暴露 `window.electronAPI`（IPC invoke）
- `electron/main.ts` 实现：
  - `create-terminal`（node-pty spawn）
  - `write-terminal` / `resize-terminal` / `kill-terminal`
  - 事件：`terminal-data`、`terminal-exit`

前端：

- `src/contexts/TerminalContext.tsx`：多会话、历史记录、LLM 补全配置的持久化（localStorage）
- `src/components/TerminalPanel.tsx`：xterm 多标签、中文输入、LLM 补全
- `src/utils/terminalExecutor.ts`：让其它模块可“全局触发”终端执行器（由 `App.tsx` 在 TerminalPanel ready 时注入）

## 7. 后端：路由与数据层（概览）

后端主入口：`backend/app.py`

核心路由族：

- LLM：`/api/llm/*`
- MCP：
  - `/api/mcp/servers`（配置 CRUD / test）
  - `/api/mcp/oauth/*`（OAuth discovery/authorize 等）
  - `/mcp`（代理转发，供前端 MCPClient 使用）
- Workflows：`/api/workflows/*`
- Sessions & Messages：
  - `/api/sessions/*`（会话与消息）
  - `/api/messages/:id/execute`（感知组件执行）
  - `/api/messages/:id/execution`（执行记录读取）
- Crawler：`/api/crawler/*`
- Round table：`/api/round-tables/*`
- Research：`/api/research/*`
- Skill packs：`/api/skill-packs/*`

数据层：`backend/database.py`

主要表（按功能）：

- 配置：`llm_configs`、`mcp_servers`、`oauth_tokens`、`notion_registrations`
- 工作流：`workflows`
- 会话/消息：`sessions`、`messages`、`summaries`、`message_executions`
- Research：`research_sources`、`research_documents`
- Crawler：`crawler_modules`、`crawler_batches`
- 圆桌：`round_tables`、`round_table_participants`、`round_table_messages`、`round_table_responses`
- 技能包：`skill_packs`、`skill_pack_assignments`

## 8. 关键链路（文本版时序）

### 8.1 一条普通聊天消息

1. 前端 `Workflow.tsx` 组装：system prompt + history + 选定 LLM +（可选）工具/技能包上下文
2. 调用 LLM（`LLMClient` 或后端代理相关接口，取决于具体实现分支）
3. 保存消息到后端：`POST /api/sessions/:id/messages`

### 8.2 MCP 工具调用（LLM tool_calls）

1. 选择 MCP server 并连接（`mcpManager.addServer` + `listTools`）
2. LLM 返回 `tool_calls`
3. `LLMClient.executeToolCall` → `mcpManager.acquireConnection` → `MCPClient.callTool`
4. `MCPClient` 通过后端 `/mcp` 转发（支持 SSE）

### 8.3 感知组件执行（message execution）

1. 前端写入 `role='tool'` 消息并保存（tool_calls 里标明 component）
2. 前端触发 `POST /api/messages/:message_id/execute`
3. 后端执行 workflow/MCP（带 LLM 替换/驱动），结果落 `message_executions`
4. 前端用执行结果更新 UI

## 9. 配置与安全注意事项

- 不要提交真实的 API Key/数据库口令/Notion 凭据。
- 当前 `backend/config.yaml` 存在明文敏感信息（MySQL/Redis/Notion），建议改为占位并通过环境变量或本地私有配置覆盖。

## 10. 相关设计文档索引

- `CHAT_INTERACTION_FLOW.md`：聊天交互流程（system prompt、人设、重试等）
- `CHAT_SYSTEM_SUMMARY.md`：聊天系统摘要
- `WEB_CRAWLER_DESIGN.md`：爬虫/标准化设计
- `BACKEND_SEPARATION.md`：后端拆分建议与历史说明

