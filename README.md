# 工作流管理工具

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
- Electron
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

