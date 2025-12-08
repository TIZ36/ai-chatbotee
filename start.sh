#!/bin/bash

# 启动脚本 - 同时启动后端、前端和 Electron
# 启动工作流管理工具

set -e  # 遇到错误立即退出

cd "$(dirname "$0")"

echo "=========================================="
echo "  工作流管理工具启动脚本"
echo "=========================================="

# 检查 Node.js 环境
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 node，请先安装 Node.js"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm，请先安装 npm"
    exit 1
fi

# 检查 Python 环境
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "❌ 错误: 未找到 python，请先安装 Python"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装前端依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 前端依赖安装失败"
        exit 1
    fi
fi

# 检查后端虚拟环境
if [ ! -d "backend/venv" ]; then
    echo "📦 创建后端虚拟环境..."
    cd backend
    python3 -m venv venv || python -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cd ..
fi

# 检查并重新编译 node-pty（如果需要）
if [ ! -f "node_modules/node-pty/build/Release/pty.node" ]; then
    echo "🔨 重新编译原生模块..."
    npx electron-rebuild -f -w node-pty 2>/dev/null || echo "⚠️  原生模块编译跳过（可能已编译）"
fi

# 编译 Electron 代码
echo "🔨 编译 Electron 主进程..."
npm run build:electron
if [ $? -ne 0 ]; then
    echo "❌ Electron 代码编译失败"
    exit 1
fi

# 清理可能存在的旧进程和端口
echo "🧹 清理旧进程和端口..."
pkill -f "vite.*5174" 2>/dev/null || true
pkill -f "electron.*workflow-manager" 2>/dev/null || true
pkill -f "python.*app.py" 2>/dev/null || true

# 清理端口 5174 (前端) 和 3002 (后端)
if lsof -ti:5174 > /dev/null 2>&1; then
    echo "   清理端口 5174..."
    lsof -ti:5174 | xargs kill -9 2>/dev/null
fi
if lsof -ti:3002 > /dev/null 2>&1; then
    echo "   清理端口 3002..."
    lsof -ti:3002 | xargs kill -9 2>/dev/null
fi
sleep 1

# 启动后端服务（后台）
echo "🚀 启动后端服务..."
cd backend
source venv/bin/activate
python app.py > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
cd ..
echo "   Backend PID: $BACKEND_PID"

# 等待后端服务就绪
echo "⏳ 等待后端服务启动..."
for i in {1..30}; do
    if curl -s http://localhost:3002/api/llm/configs > /dev/null 2>&1; then
        echo "✅ 后端服务已就绪 (http://localhost:3002)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ 后端服务启动超时"
        echo "查看日志: tail -f /tmp/backend.log"
        kill $BACKEND_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
    echo -n "."
done
echo ""

# 启动 Vite 开发服务器（后台）
echo "🚀 启动 Vite 开发服务器..."
npm run dev > /tmp/vite.log 2>&1 &
VITE_PID=$!
echo "   Vite PID: $VITE_PID"

# 等待 Vite 服务器就绪
echo "⏳ 等待 Vite 服务器启动..."
for i in {1..30}; do
    if curl -s http://localhost:5174 > /dev/null 2>&1; then
        echo "✅ Vite 服务器已就绪 (http://localhost:5174)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Vite 服务器启动超时"
        echo "查看日志: tail -f /tmp/vite.log"
        kill $VITE_PID $BACKEND_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
    echo -n "."
done
echo ""

# 启动 Electron
echo "🚀 启动 Electron 应用..."
NODE_ENV=development node_modules/.bin/electron . > /tmp/electron.log 2>&1 &
ELECTRON_PID=$!
echo "   Electron PID: $ELECTRON_PID"

# 等待一下让 Electron 启动
sleep 2

# 检查进程是否还在运行
if ps -p $BACKEND_PID > /dev/null 2>&1 && ps -p $VITE_PID > /dev/null 2>&1 && ps -p $ELECTRON_PID > /dev/null 2>&1; then
    echo ""
    echo "=========================================="
    echo "✅ 启动成功！"
    echo "   Backend:  http://localhost:3002"
    echo "   Vite:     http://localhost:5174"
    echo "   Electron: 窗口应该已打开"
    echo ""
    echo "查看日志:"
    echo "   Backend:  tail -f /tmp/backend.log"
    echo "   Vite:     tail -f /tmp/vite.log"
    echo "   Electron: tail -f /tmp/electron.log"
    echo ""
    echo "按 Ctrl+C 停止所有服务"
    echo "=========================================="
    
    # 等待用户中断
    trap "echo ''; echo '正在停止服务...'; kill $BACKEND_PID $VITE_PID $ELECTRON_PID 2>/dev/null; exit 0" INT TERM
    wait
else
    echo "❌ 启动失败，检查日志:"
    if ! ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo "   Backend 进程已退出:"
        tail -20 /tmp/backend.log
    fi
    if ! ps -p $VITE_PID > /dev/null 2>&1; then
        echo "   Vite 进程已退出:"
        tail -20 /tmp/vite.log
    fi
    if ! ps -p $ELECTRON_PID > /dev/null 2>&1; then
        echo "   Electron 进程已退出:"
        tail -20 /tmp/electron.log
    fi
    exit 1
fi

