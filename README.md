# chatee

独立的LLM/MCP/工作流管理工具，用于录入LLM、MCP、规划工作流。

## 功能

- LLM配置管理（支持OpenAI、Anthropic、Ollama等）
- MCP服务器配置和管理
- 工作流编辑和执行
- 工具调用和可视化
- 数据可视化组件

## 技术栈

- React + TypeScript
- Vite
- Flask (后端)
- MySQL (数据库)
- MCP SDK

## 开发

```bash
npm install
npm run dev
```

## 后端

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

后端默认运行在 `http://localhost:3002`

## 手机自动化（可选）

手机 UI 自动化能力已拆分为独立服务仓库：`slowjamz66/autoglm-mcp`。

- 启动 `phone_service`（默认 `http://127.0.0.1:3010`）与其 MCP Server（默认 `http://127.0.0.1:18060/mcp`）
- 在本项目 `/mcp-config` 添加 MCP server：`http://127.0.0.1:18060/mcp`
