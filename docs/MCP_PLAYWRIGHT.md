# Playwright MCP 接入说明

本文说明如何将 [playwright-mcp](https://github.com/microsoft/playwright-mcp)（本地仓库路径 `../playwright-mcp`）接入 ai-chatbotee，使 Chaya 等 Agent 能使用浏览器自动化能力（打开页面、快照、点击、输入等）。

---

## 1. Playwright MCP 简介

- **协议**：MCP（Model Context Protocol），支持 **stdio**（默认）和 **HTTP/SSE**（`--port` 时启用）。
- **能力**：基于 Playwright 的无头/有头浏览器，提供 `browser_navigate`、`browser_snapshot`、`browser_click`、`browser_type` 等工具，无需视觉模型，使用可访问性树。
- ai-chatbotee 当前通过 **HTTP** 调用 MCP，因此需要以 **HTTP 模式** 启动 Playwright MCP。

---

## 2. 启动 Playwright MCP（HTTP 模式）

### 方式 A：使用 npx（官方包）

```bash
# 安装并启动，监听 8931 端口，SSE 端点为 http://localhost:8931/mcp
npx @playwright/mcp@latest --port 8931
```

### 方式 B：使用本地仓库（你当前的 playwright-mcp 目录）

```bash
cd /Users/lilithgames/aiproj/playwright-mcp/packages/playwright-mcp
npm install
node cli.js --port 8931
```

可选参数（按需加在 `cli.js` 后面）：

- `--headless`：无头模式
- `--browser chromium`：指定浏览器（chromium / firefox / webkit）
- `--host 0.0.0.0`：允许其他机器访问（默认 localhost）

启动成功后，会看到类似 “listening on port 8931” 的日志，MCP 端点为 **`http://localhost:8931/mcp`**。

---

## 3. 在 ai-chatbotee 中配置 MCP 服务器

1. 打开 **设置 / MCP 配置**（或对应入口）。
2. **新增 MCP 服务器**，填写：
   - **名称**：例如 `Playwright` 或 `浏览器自动化`
   - **URL**：`http://localhost:8931/mcp`（与上一步 `--port 8931` 一致；若改端口则改此处）
   - **类型**：`http-stream`
   - **使用代理**：若前端直连填写的 URL 且 Playwright 未配置 CORS，可勾选“使用后端代理”；若仅后端调用且 Playwright 与本机同机，可不勾选。
3. 保存后，在 Chaya 对话里**勾选该 MCP**，发送消息即可让 Agent 使用 Playwright 工具（如打开网页、截图、点击等）。

---

## 4. 校验是否接通

- 在 MCP 配置页查看该服务器状态是否为“已连接”或“健康”。
- 在 Chaya 中勾选该 MCP 后，发送如“打开 https://example.com 并给我页面标题”之类请求，若返回正常页面信息或执行结果，即表示接入成功。

---

## 5. 常见问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 连接失败 / 超时 | Playwright MCP 未启动或端口不对 | 确认 `node cli.js --port 8931` 在运行，且 URL 为 `http://localhost:8931/mcp` |
| 404 / 会话失效 | 端点路径错误 | 必须使用 `/mcp` 路径，完整 URL 为 `http://<host>:<port>/mcp` |
| 浏览器未安装 | 首次运行需安装 Playwright 浏览器 | 在 playwright-mcp 目录执行：`npx playwright install chromium` |
| 跨域 / CORS | 前端直连 MCP 时被浏览器拦截 | 在 ai-chatbotee 中勾选“使用后端代理”，或为 Playwright MCP 配置 CORS（若其支持） |

---

## 6. 参考

- Playwright MCP 官方 README：`/Users/lilithgames/aiproj/playwright-mcp/README.md`
- ai-chatbotee MCP HTTP 规范：`docs/mcp-http-stream-protocol.md`
- MCP 配置数据模型：`backend/models/mcp_server.py`（`url`、`type: http-stream`）
