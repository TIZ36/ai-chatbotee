# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

chatee is a full-stack LLM/MCP workflow management tool with an Electron desktop app (React + TypeScript frontend) and Python Flask backend. It manages LLM configurations, MCP (Model Context Protocol) servers, and AI chat workflows.

## Development Commands

### Frontend (React + Vite)
```bash
npm install                # Install dependencies
npm run dev                # Start dev server (port 5177)
npm run build              # Production build
```

### Electron Desktop App
```bash
npm run electron:dev       # Run Electron in dev mode
npm run build:electron     # Build Electron main process
npm run build:all          # Full build with installer
```

### Backend (Python Flask)
```bash
cd backend
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py              # Runs on http://localhost:3002
```

### Typical Development Setup
Run these in separate terminals:
1. `cd backend && source venv/bin/activate && python app.py`
2. `npm run dev`
3. (Optional) `npm run electron:dev`

## Architecture

```
Frontend (React/TS)          Backend (Flask)
     │                            │
     ├── Workflow.tsx ────────────┼── app.py (REST API)
     │   (main chat UI)           │
     ├── services/                ├── database.py (MySQL ORM)
     │   ├── llmClient.ts         │
     │   ├── mcpClient.ts         ├── mcp_server/ (MCP impl)
     │   └── chatClient.ts        │
     │                            └── web_crawler.py
     └── Electron (main.ts)
```

**Data Flow:** User Input → ReliableChatClient → LLMClient + MCPClient → Backend API → Database/LLM Providers → Response

## Key Architectural Patterns

### Chat System (src/services/chatClient.ts)
- Reliable messaging with automatic retry (max 3 attempts, exponential backoff: 1s, 2s, 4s)
- Error classification: network, timeout, API, unknown
- Streaming response support

### LLM Integration (src/services/llmClient.ts)
- Multi-provider support: OpenAI, Anthropic, Ollama, Gemini, Custom
- Token counting and context management
- API key management per provider

### MCP Integration (src/services/mcpClient.ts)
- Transport types: HTTP-stream, HTTP-POST, stdio
- Tool discovery and execution
- OAuth support (Notion integration)

### Frontend State
- React hooks + Context API (TerminalContext, SettingsContext)
- Local storage for persistent settings

## Configuration

| File | Purpose |
|------|---------|
| `backend/config.yaml` | Backend: server port (3002), MySQL, Redis, CORS |
| `.env` | Frontend API URL (`VITE_API_URL`) |
| `vite.config.ts` | Dev server port (5177), path alias `@/` → `./src/` |
| `tailwind.config.js` | Custom colors (primary, success, warning, error), dark mode |

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Workflow | `src/components/Workflow.tsx` | Main chat/workflow interface |
| WorkflowEditor | `src/components/WorkflowEditor.tsx` | Workflow editing |
| RoundTablePanel | `src/components/RoundTablePanel.tsx` | Multi-agent discussions |
| MCPConfig | `src/components/MCPConfig.tsx` | MCP server configuration |
| LLMConfig | `src/components/LLMConfig.tsx` | LLM model configuration |

## Backend API Structure

The Flask backend (`backend/app.py`) provides REST endpoints for:
- `/api/llm/*` - LLM configuration and chat
- `/api/mcp/*` - MCP server management
- `/api/session/*` - Chat session persistence
- `/api/crawler/*` - Web crawling
- `/api/roundtable/*` - Round table discussions

## Documentation References

- `CHAT_SYSTEM_SUMMARY.md` - Chat system design and error handling
- `CHAT_INTERACTION_FLOW.md` - Message flow and retry logic
- `WEB_CRAWLER_DESIGN.md` - Crawler implementation
- `BACKEND_SEPARATION.md` - Backend code organization
