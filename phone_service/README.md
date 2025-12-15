## phone_service (MVP)

`phone_service` 是一个独立的“手机 UI 智能体服务”，通过 ADB 控制安卓设备，用 OpenAI 兼容多模态模型（`/chat/completions`）做屏幕理解与动作规划，适合做社交媒体 App（小红书/Twitter/Reddit 等）的信息获取与发帖自动化。

它的目标是：把“强状态、强交互”的手机任务放到一个可观测/可控的服务里（任务 id、每步截图、确认/接管），后续再用 MCP 作为统一工具入口去调用它。

### 功能范围（当前 MVP）

- 任务创建/单步执行：每一步返回 `thinking/action/screenshot/current_app`
- 动作类型：`Launch`、`Tap`、`Type`、`Swipe`、`Back`、`Home`、`Wait`、`Take_over`
- 敏感操作：模型输出 `Tap` 且包含 `message` 时进入 `WAIT_CONFIRM` 状态，不会执行点击
- 接管：模型输出 `Take_over` 时进入 `WAIT_TAKEOVER` 状态（用于登录/验证码/支付等）
- 上下文：服务端按 task 保存对话上下文（会删掉历史 user 的图片以节省上下文）

### 依赖与准备

1. 安装 ADB 并确保 `adb devices` 能看到设备（真机或模拟器均可）。
2. 安装并启用 ADB Keyboard（用于文本输入）。
3. 准备一个 OpenAI 兼容的多模态模型服务：
   - `base_url` 形如 `http://localhost:8000/v1` 或第三方 OpenAI 兼容网关
   - 模型需要能理解图片，并输出 `do(action=...)` / `finish(message=...)` 格式

### 安装

建议单独 venv：

```bash
python -m venv .venv
pip install -r requirements.txt
```

### 启动

```bash
export PHONE_SERVICE_PORT=3010
export PHONE_MODEL_BASE_URL=http://localhost:8000/v1
export PHONE_MODEL_NAME=autoglm-phone
export PHONE_MODEL_API_KEY=EMPTY

python -m phone_service.app
```

### API（简版）

- `GET /health`
- `GET /devices`
- `POST /tasks` body:
  - `task` (string, required)
  - `device_id` (string, optional)
  - `lang` (`cn`/`en`, default `cn`)
  - `model`: `{ base_url, model_name, api_key, max_tokens, temperature }` (optional; 默认走环境变量)
- `POST /tasks/{id}/step`：执行一步
- `POST /tasks/{id}/confirm` body `{ "approved": true/false }`
- `POST /tasks/{id}/takeover_done`
- `POST /tasks/{id}/cancel`
- `GET /tasks/{id}`

### 示例：信息获取（小红书）

创建任务：

```bash
curl -s -X POST localhost:3010/tasks \
  -H 'Content-Type: application/json' \
  -d '{"task":"打开小红书，搜索 文澜小屋，进入主页，打开最新一条图文笔记，复制其标题与正文要点到 finish message。"}'
```

然后循环调用 `POST /tasks/{id}/step`，直到 `finished=true`；如果返回 `state=WAIT_CONFIRM` 或 `WAIT_TAKEOVER`，按接口处理后继续 step。
