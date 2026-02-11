# 接入本地 Cursor Agent CLI

本文说明如何让 ai-chatbotee 的机器人（Chaya / Discord 等）**调用本机的 Cursor Agent 命令行**，把用户的自然语言请求交给 Cursor 的 `agent` 命令执行（读代码、改文件、跑命令等），并把结果返回给用户。

---

## 1. Cursor Agent CLI 是什么

- **命令**：安装 Cursor CLI 后，在终端执行 `agent`（或 `cursor`，以官方文档为准）。
- **安装**：`curl https://cursor.com/install -fsSL | bash`（macOS/Linux/WSL）；Windows 见 [Cursor 文档](https://cursor.com/docs/cli/installation)。
- **无头/脚本模式**：`agent -p "你的提示词"`（`-p` / `--print`）可非交互执行，适合被其他程序调用；可选 `--force` 允许直接改文件，`--output-format text|json` 等。
- **权限**：Agent 会读、改、删文件并执行 shell 命令，仅应在可信环境使用。

---

## 2. 当前支持情况

- **内置**：ai-chatbotee 目前**没有**内置「调用本机 Cursor Agent」的入口；机器人不会自动执行 `agent` 命令。
- **可接入方式**：通过 **MCP 桥接**，把「执行一次 Cursor Agent」封装成一个 MCP 工具，在 Chaya 里勾选该 MCP 后，由 Agent 在需要时代理调用本机 `agent -p "..."` 并把输出返回。

---

## 3. 用桥接 MCP 接入（推荐）

仓库内提供了一个**桥接用 MCP 服务**，暴露一个工具给 Chaya，由该工具在**运行 MCP 的机器上**执行 `agent -p "<用户/机器人给出的任务>"` 并返回结果。

### 3.1 桥接服务位置与启动

- 服务目录：与 `backend` 平级的 **`cursor_agent_bridge/`** 独立服务（见该目录下 `README.md`）。
- 依赖：本机已安装并可用 `agent`（或配置中的命令名），且 Python 已安装 `cursor_agent_bridge/requirements.txt` 中的依赖。
- 启动示例（在项目根目录）：

```bash
# 安装依赖（首次）：pip install -r cursor_agent_bridge/requirements.txt
# 默认 HTTP 端口 8932，避免与 Playwright MCP 的 8931 冲突
python -m cursor_agent_bridge --port 8932
```

- 启动后 MCP 端点：`http://localhost:8932/mcp`（若改端口则相应修改）。

### 3.2 在 ai-chatbotee 中配置 MCP

1. 打开 **设置 → MCP 配置**。
2. **新增 MCP 服务器**：
   - **名称**：如 `Cursor Agent`
   - **URL**：`http://localhost:8932/mcp`
   - **类型**：`http-stream`（或与你启动时一致）
3. 保存后，在 Chaya 对话中**勾选该 MCP**，即可在对话中让机器人「调用本地 Cursor Agent」完成任务（由桥接执行 `agent -p "..."` 并回传结果）。

### 3.3 环境变量（可选）

启动桥接前可设置：

- `CURSOR_AGENT_CMD`：本机 agent 命令名（默认 `agent`）。
- `CURSOR_AGENT_TIMEOUT`：单次执行默认超时秒数（默认 `300`）。
- `CURSOR_AGENT_CWD`：默认工作目录（不设则使用桥接进程当前目录）。

### 3.4 安全与限制

- 桥接会在**运行 MCP 的机器上**执行 `agent`，具备该进程的读写与执行权限。
- 建议仅在本机或可信内网使用；不要对公网暴露端口，或做好鉴权与访问控制。
- 注意：Chaya 调用 MCP 时后端对单次工具有约 60 秒 HTTP 超时。若 Cursor Agent 任务较长，请让任务在 60 秒内完成，或在后端放宽该超时（见 `call_mcp_tool` 的 `tool_timeout`）。

---

## 4. 不接 MCP 的用法（手动）

- 在终端本机执行：`agent -p "你的问题或任务"`，将输出复制到 Chaya / Discord 等会话中，当作机器人回复的补充或后续人工回复。
- 这样不涉及机器人自动调用，无需 MCP，也不会有权限问题。

---

## 5. 参考

- [Cursor CLI 安装](https://cursor.com/docs/cli/installation)
- [Cursor Headless / 无头模式](https://cursor.com/docs/cli/headless)
- 本仓库 MCP 规范：`docs/mcp-http-stream-protocol.md`
