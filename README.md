# Chatee

AI 智能体对话平台，支持多 Agent 协作、MCP 工具调用、工作流编排。

## 功能特性

- **多模型支持**：OpenAI、Anthropic、DeepSeek、Google Gemini、Ollama 等
- **MCP 工具集成**：连接外部 MCP 服务器，扩展 AI 能力
- **Agent 协作**：多 Agent 圆桌会议、任务委派
- **思考链展示**：实时显示 AI 思考过程（支持 DeepSeek Reasoner 等思考模型）
- **工作流编排**：可视化工作流设计与执行

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 后端 | Flask + Python 3.10+ |
| 数据库 | MySQL 8.0+ |
| 缓存 | Redis |
| 协议 | MCP (Model Context Protocol) |

## 快速开始

### 环境要求

- Node.js 18+
- Python 3.10+
- MySQL 8.0+
- Redis

### 1. 克隆项目

```bash
git clone <repo-url>
cd ai-chatbotee
```

### 2. 启动后端

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

后端默认运行在 `http://localhost:3002`

### 3. 启动前端

```bash
# 方式一：使用脚本
./start-front.sh

# 方式二：手动启动
cd front
npm install
npm run dev
```

前端默认运行在 `http://localhost:5177`

## 配置说明

### 数据库配置

在 `backend/config.yaml` 中配置 MySQL 连接：

```yaml
database:
  host: localhost
  port: 3306
  user: root
  password: your_password
  database: chatee
```

### Redis 配置

```yaml
redis:
  host: localhost
  port: 6379
  password: your_password  # 可选
```

### LLM 配置

在应用内的「设置 → LLM 配置」中添加 API 密钥：

- OpenAI / Azure OpenAI
- Anthropic Claude
- DeepSeek
- Google Gemini
- Ollama（本地）

## 目录结构

```
ai-chatbotee/
├── backend/                # Flask 后端
│   ├── api/               # API 路由
│   ├── models/            # 数据模型
│   ├── services/          # 业务逻辑
│   │   ├── actor/         # Agent Actor 模型
│   │   ├── providers/     # LLM Provider 实现
│   │   └── mcp/           # MCP 相关服务
│   └── app.py             # 入口
├── front/                  # React 前端
│   └── src/
│       ├── components/    # UI 组件
│       ├── services/      # 前端服务
│       └── conversation/  # 对话适配器
├── start-front.sh         # 前端启动脚本
└── README.md
```

## MCP 服务集成

在「设置 → MCP 服务器」中添加 MCP 服务器 URL，例如：

- 小红书 MCP：`http://127.0.0.1:18060/mcp`
- Notion MCP：`http://127.0.0.1:18061/mcp`

## 开发指南

### 前端开发

```bash
cd front
npm run dev      # 开发模式
npm run build    # 构建
npm run lint     # 代码检查
```

### 后端开发

```bash
cd backend
python app.py    # 启动服务
```

## License

MIT
