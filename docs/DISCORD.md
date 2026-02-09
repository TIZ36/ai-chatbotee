# Chaya Discord 使用说明

Chaya 支持以 Discord Bot 形式接入 Discord 服务器，在频道中与用户对话。每个 Discord 频道对应一个**独立 Chaya 会话**（独立 Actor + 独立消息历史），互不干扰。

## 一、前置条件

- 已部署 Chaya 后端（Flask + MySQL + Redis）
- 拥有一个 Discord 应用与 Bot Token

## 二、在 Discord 创建 Bot

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)，登录后点击 **New Application** 创建应用。
2. 左侧进入 **Bot**，点击 **Add Bot**。
3. 在 **TOKEN** 处点击 **Reset Token** 或 **Copy** 获取 Bot Token（仅显示一次，请妥善保存）。
4. 在 **Privileged Gateway Intents** 中**必须**开启：
   - **MESSAGE CONTENT INTENT**（必开，否则收不到消息内容，且会出现 “requesting privileged intents that have not been explicitly enabled” 的提示）
   - 按需开启 **SERVER MEMBERS INTENT** 等。  
   入口：<https://discord.com/developers/applications/> → 选择你的应用 → 左侧 **Bot** → 页面中部的 **Privileged Gateway Intents**。
5. 左侧 **OAuth2 → URL Generator**：
   - Scopes 勾选 **bot**
   - Bot Permissions 勾选：**Send Messages**、**Read Message History**、**Attach Files**、**Embed Links**、**Mention Everyone**（按需）
6. 将生成的 **Generated URL** 在浏览器打开，选择服务器并授权，将 Bot 邀请进服务器。

## 三、后端配置

在项目 `backend/config.yaml` 中增加或修改 `discord` 配置块：

```yaml
discord:
  bot_token: "你的_Bot_Token"   # 从 Developer Portal 复制的 Token
  auto_start: true              # 后端启动时自动启动 Bot（填好 token 后建议 true）
  auto_create_session: true     # 未绑定频道首次 @Chaya 时自动创建专属会话
  default_trigger_mode: "mention"  # mention：仅 @Chaya 回复；all：该频道所有消息都回复
  default_llm_config_id: ""     # 空则继承 agent_chaya 的 LLM 配置
  max_response_length: 1900     # 单条消息字数上限（Discord 限制 2000）
  session_id_prefix: "dc"       # 自动创建的会话 ID 前缀
```

- **bot_token**：可选。不填也可：在 Chaya 前端的 **Discord 管理** 页输入 Token 并点击「启动」，后端会**持久化**该 Token（写入 `backend/.discord_bot_token`）；重启服务后若 **auto_start: true**，将自动用该 Token 启动，无需写 config。
- **auto_start**：为 `true` 且存在有效 Token（config 或持久化文件）时，应用启动后会自动启动 Discord Bot。
- **auto_create_session**：为 `true` 时，在任意频道首次 **@Chaya** 会为该频道自动创建专属会话并开始对话。

修改 config 后需重启后端服务。

## 四、在 Discord 中使用

### 1. 自动创建会话（推荐）

- 在任意有 Chaya 权限的频道中 **@Chaya** 并发送消息（例如：`@Chaya 你好`）。
- 若配置了 `auto_create_session: true`，会为该频道自动创建一个 Chaya 会话，Chaya 会回复。
- 之后该频道内继续 **@Chaya** 发消息即可，同一频道内上下文共享，不同频道互不影响。

### 2. 触发模式

- **mention**（默认）：只有消息中 **@Chaya** 时才会回复，适合与人类聊天混用的频道。
- **all**：该频道内每条消息都会触发 Chaya 回复，适合专用 AI 频道。  
  可在绑定或更新频道时通过 API 指定（见下文）。

### 3. 发送图片

- 用户可在同一条消息中附带图片，Chaya 会收到并参与多模态理解（依赖当前模型能力）。

## 五、管理 API（可选）

在不依赖前端的情况下，可用 HTTP 接口管理 Bot 与频道绑定（需替换为你的后端地址与鉴权方式）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/discord/status` | 查询 Bot 是否在线、已加入服务器数、已绑定频道数 |
| GET | `/api/discord/channels` | 已绑定频道列表（含 session_id、消息数、最后活跃时间） |
| POST | `/api/discord/channels` | 手动绑定频道（传 `channel_id`、`guild_id`、`trigger_mode` 等） |
| PUT | `/api/discord/channels/<channel_id>` | 更新某频道的 `trigger_mode`、`enabled`、`config_override` |
| DELETE | `/api/discord/channels/<channel_id>` | 解绑频道；body 中 `delete_session: true` 可同时删除对应 Chaya 会话 |
| POST | `/api/discord/start` | 手动启动 Bot（body 传 `bot_token` 或 Header `Authorization: Bearer <token>`） |
| POST | `/api/discord/stop` | 手动停止 Bot |

示例：查询状态

```bash
curl http://localhost:3001/api/discord/status
```

示例：手动绑定频道

```bash
curl -X POST http://localhost:3001/api/discord/channels \
  -H "Content-Type: application/json" \
  -d '{"channel_id":"123456789","guild_id":"987654321","guild_name":"我的服务器","channel_name":"general","trigger_mode":"mention"}'
```

## 六、架构简述

- 每个 Discord 频道对应一个 Chaya **会话**（session），session_id 形如 `dc_{guild_id}_{channel_id}`。
- 该会话使用 **agent** 类型，拥有独立的消息历史和独立的 Actor 实例。
- 默认人设与 LLM 配置继承自 **agent_chaya**；可通过频道的 `config_override` 覆盖 `system_prompt`、`llm_config_id` 等。
- Discord 用户发消息 → Bot 收消息 → 写入 Chaya 会话并激活 Actor → Actor 回复写入会话并发布到 Redis → Bot 订阅 Redis 收到回复 → 发回 Discord 频道。

## 七、常见问题

- **Bot 不回复**  
  - 确认 `discord.bot_token` 正确且已重启服务。  
  - 确认 Bot 已邀请进服务器，且在该频道有「查看/发送消息」权限。  
  - 若为 mention 模式，确认消息中 **@了 Chaya**。  
  - 查看后端日志是否有 `[Discord]` 相关报错。  
  - 若出现「无法产生回复: ActionResult...thinking」等内部参数错误，**请重启后端**以加载最新兼容代码（Discord 与应用内聊天共用同一 Actor 流程）。

- **收不到长回复或只收到一段**  
  - Discord 单条消息限制 2000 字符，Chaya 会将超长回复自动分段发送；可通过 `max_response_length` 微调每段长度。

- **思考过程与流式**  
  - 回复会先出现「💭 思考中...」，随后同一条消息会**流式更新**为实际生成内容（约每 2 秒或每约 1200 字更新一次，避免触发 Discord 限频）。  
  - 生成结束后若超过 2000 字，会再分段发送剩余内容。

- **希望某频道用不同人设/模型**  
  - 通过 `PUT /api/discord/channels/<channel_id>` 为该频道设置 `config_override`，例如：  
    `{"system_prompt":"你是一个专业客服...", "llm_config_id":"xxx"}`。

- **Token 持久化**  
  - 在前端 Discord 管理页输入 Token 并点击「启动」后，后端会将 Token 写入 `backend/.discord_bot_token`（已加入 .gitignore）。之后只要 config 中 `auto_start: true`，重启服务即可自动启动 Bot，无需在 config 中填写 bot_token。

- **依赖**  
  - 需安装 `discord.py>=2.3.0`（见 `backend/requirements.txt`）。若未安装，Discord 相关功能不会启用，其余功能不受影响。
