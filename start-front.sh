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

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ 错误: 未找到 pnpm，请先安装: npm install -g pnpm"
    exit 1
fi

# 进入前端目录
cd "$FRONT_DIR"

# 检查并安装依赖
# 条件：1) node_modules 不存在，或 2) package.json / pnpm-lock.yaml 比 node_modules 更新
NEED_INSTALL=false

if [ ! -d "node_modules" ]; then
    echo "📦 node_modules 不存在，需要安装依赖"
    NEED_INSTALL=true
elif [ "package.json" -nt "node_modules" ]; then
    echo "📦 package.json 已更新，需要同步依赖"
    NEED_INSTALL=true
elif [ -f "pnpm-lock.yaml" ] && [ "pnpm-lock.yaml" -nt "node_modules" ]; then
    echo "📦 pnpm-lock.yaml 已更新，需要同步依赖"
    NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = true ]; then
    echo "📦 使用 pnpm 安装依赖..."
    pnpm install
    touch node_modules
    echo "✅ 依赖安装完成"
else
    echo "✅ 依赖已是最新"
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

pnpm run dev
