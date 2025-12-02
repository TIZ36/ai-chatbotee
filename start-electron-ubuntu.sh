#!/bin/bash

# Ubuntu 版本 - 启动 Electron 应用
# 同时启动 Vite 和 Electron

set -e

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  Electron 应用启动脚本 (Ubuntu)"
echo "=========================================="

# 检查 Node.js 环境
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 node，请先安装 Node.js"
    echo "   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
    echo "   sudo apt install -y nodejs"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"

if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm，请先安装 npm"
    exit 1
fi

echo "✅ npm 版本: $(npm --version)"

# 检查 package.json
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 未找到 package.json"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
    echo "✅ 依赖安装完成"
else
    echo "✅ node_modules 已存在"
fi

# 检查 vite 是否安装
if [ ! -d "node_modules/vite" ]; then
    echo "📦 检测到依赖未完全安装，正在安装..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
fi

# 检查并重新编译 node-pty（如果需要）
echo "🔨 检查原生模块..."
if [ ! -f "node_modules/node-pty/build/Release/pty.node" ]; then
    echo "🔨 重新编译 node-pty 原生模块..."
    # 确保安装了必要的构建工具
    if ! command -v make &> /dev/null; then
        echo "⚠️  警告: make 未安装，尝试安装构建工具..."
        echo "   sudo apt install build-essential"
    fi
    npx electron-rebuild -f -w node-pty 2>/dev/null || {
        echo "⚠️  原生模块编译失败，尝试备选方案..."
        npm rebuild node-pty 2>/dev/null || echo "⚠️  原生模块编译跳过"
    }
else
    echo "✅ 原生模块已编译"
fi

# 编译 Electron 代码
echo "🔨 编译 Electron 主进程代码..."
npm run build:electron
if [ $? -ne 0 ]; then
    echo "❌ Electron 代码编译失败"
    exit 1
fi
echo "✅ Electron 代码编译完成"

# 检查编译后的文件
if [ ! -f "./electron/dist/main.cjs" ]; then
    echo "❌ 错误: 编译后的 main.cjs 文件不存在"
    exit 1
fi
echo "✅ 编译文件检查通过"

# 清理可能存在的旧进程（排除当前脚本）
echo "🧹 清理旧进程..."
pkill -f "vite.*5174" 2>/dev/null || true
# 只杀死 electron 二进制进程，不杀死脚本
pkill -f "node_modules/.bin/electron" 2>/dev/null || true
pkill -f "node_modules/electron/dist" 2>/dev/null || true
sleep 1

# 创建日志目录
LOG_DIR="/tmp/ai-chatbot-logs"
mkdir -p "$LOG_DIR"

# 启动 Vite 开发服务器（后台）
echo "🚀 启动 Vite 开发服务器..."
npm run dev > "$LOG_DIR/vite.log" 2>&1 &
VITE_PID=$!
echo "   Vite PID: $VITE_PID"

# 等待 Vite 服务器就绪
echo "⏳ 等待 Vite 服务器启动..."
counter=0
max_wait=30
while [ $counter -lt $max_wait ]; do
    if curl -s http://localhost:5174 > /dev/null 2>&1; then
        echo ""
        echo "✅ Vite 服务器已就绪 (http://localhost:5174)"
        break
    fi
    if [ $counter -eq $((max_wait - 1)) ]; then
        echo ""
        echo "❌ Vite 服务器启动超时"
        echo "查看日志: tail -f $LOG_DIR/vite.log"
        kill $VITE_PID 2>/dev/null || true
        exit 1
    fi
    counter=$((counter + 1))
    printf "."
    sleep 1
done

# 启动 Electron
# 注意：在 Linux 上使用 --no-sandbox 避免沙盒权限问题
# 如果需要沙盒，请运行: sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
echo "🚀 启动 Electron 应用..."
NODE_ENV=development ./node_modules/.bin/electron . --no-sandbox > "$LOG_DIR/electron.log" 2>&1 &
ELECTRON_PID=$!
echo "   Electron PID: $ELECTRON_PID"

# 等待一下让 Electron 启动
sleep 3

# 检查进程是否还在运行
check_vite=$(ps -p $VITE_PID > /dev/null 2>&1 && echo "1" || echo "0")
check_electron=$(ps -p $ELECTRON_PID > /dev/null 2>&1 && echo "1" || echo "0")

if [ "$check_vite" = "1" ] && [ "$check_electron" = "1" ]; then
    echo ""
    echo "=========================================="
    echo "✅ 启动成功！"
    echo "   Vite:     http://localhost:5174"
    echo "   Electron: 窗口应该已打开"
    echo ""
    echo "查看日志:"
    echo "   Vite:     tail -f $LOG_DIR/vite.log"
    echo "   Electron: tail -f $LOG_DIR/electron.log"
    echo ""
    echo "按 Ctrl+C 停止所有服务"
    echo "=========================================="
    
    # 清理函数
    cleanup() {
        echo ""
        echo "正在停止服务..."
        kill $VITE_PID 2>/dev/null || true
        kill $ELECTRON_PID 2>/dev/null || true
        exit 0
    }
    
    # 设置信号处理
    trap cleanup INT TERM
    
    # 等待进程结束
    wait $ELECTRON_PID 2>/dev/null || true
    
    # Electron 退出后清理 Vite
    echo "Electron 已退出，清理 Vite 进程..."
    kill $VITE_PID 2>/dev/null || true
else
    echo "❌ 启动失败，检查日志:"
    if [ "$check_vite" = "0" ]; then
        echo "   Vite 进程已退出:"
        tail -20 "$LOG_DIR/vite.log" 2>/dev/null || echo "   (无日志)"
    fi
    if [ "$check_electron" = "0" ]; then
        echo "   Electron 进程已退出:"
        tail -20 "$LOG_DIR/electron.log" 2>/dev/null || echo "   (无日志)"
    fi
    # 清理可能残留的进程
    kill $VITE_PID 2>/dev/null || true
    kill $ELECTRON_PID 2>/dev/null || true
    exit 1
fi

