# 后端代码分离指南

## 需要完成的工作

### 1. app.py 分离

工作流工具的 `backend/app.py` 需要保留以下路由：
- `/api/llm/*` - LLM配置相关路由
- `/api/mcp/*` - MCP服务器相关路由
- `/api/workflow/*` - 工作流相关路由
- `/mcp` - MCP代理路由
- `/mcp/oauth/*` - OAuth相关路由

需要移除的路由：
- `/api/download/*` - 下载相关路由
- `/api/info/<video_id>` - 视频信息
- 其他YouTube相关路由

### 2. database.py 分离

工作流工具的 `backend/database.py` 需要保留以下表：
- `llm_configs` - LLM配置
- `mcp_servers` - MCP服务器配置
- `workflows` - 工作流定义
- `oauth_tokens` - OAuth令牌

需要移除的表：
- `download_tasks` - 下载任务
- `download_history` - 下载历史

### 3. 端口配置

更新 `backend/config.yaml` 中的端口为 `3002`

### 4. 启动脚本

创建 `backend/start.sh`:
```bash
#!/bin/bash
cd "$(dirname "$0")"
python app.py
```

