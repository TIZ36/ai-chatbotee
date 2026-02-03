#!/bin/bash

# Chaya 前端启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT_DIR="$SCRIPT_DIR/front"

echo "=========================================="
echo "  🦆 Chaya 前端启动"
echo "=========================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️  警告: Node.js 版本过低 (当前: $(node -v))，建议使用 18+"
fi

# 进入前端目录
cd "$FRONT_DIR"

# 检查并安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 清理 Vite 缓存
echo "🧹 清理 Vite 缓存..."
if [ -d "node_modules/.vite" ]; then
    rm -rf node_modules/.vite
    echo "   ✓ 已清理 node_modules/.vite"
fi
if [ -d ".vite" ]; then
    rm -rf .vite
    echo "   ✓ 已清理 .vite"
fi
if [ -d "dist" ]; then
    rm -rf dist
    echo "   ✓ 已清理 dist"
fi
echo ""

# 启动开发服务器
echo "🚀 启动前端开发服务器..."
echo "   访问地址: http://localhost:5177"
echo ""

npm run dev
