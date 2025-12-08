#!/bin/bash
cd "$(dirname "$0")"

# 清理已占用的端口 3002
echo "🧹 检查并清理端口 3002..."
if lsof -ti:3002 > /dev/null 2>&1; then
    echo "   发现端口 3002 被占用，正在清理..."
    lsof -ti:3002 | xargs kill -9 2>/dev/null
    sleep 1
    echo "   ✅ 端口 3002 已清理"
else
    echo "   ✅ 端口 3002 未被占用"
fi

# 启动后端服务
echo "🚀 启动后端服务..."
source venv/bin/activate
python app.py

