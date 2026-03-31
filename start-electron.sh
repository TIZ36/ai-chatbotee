#!/bin/bash

# 单独启动 Electron 桌面端（Vite dev + Electron）
# 后端请另行启动：./start-server.sh（默认 API http://127.0.0.1:3001，可在 .env.electron 或应用内设置中修改）

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT_DIR="$SCRIPT_DIR/front"

echo "=========================================="
echo "  Chatee Electron 启动"
echo "=========================================="

if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️  警告: Node.js 版本过低 (当前: $(node -v))，建议使用 18+"
fi

if ! command -v pnpm &> /dev/null; then
    echo "❌ 错误: 未找到 pnpm，请先安装: npm install -g pnpm"
    exit 1
fi

cd "$FRONT_DIR"

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

echo "🧹 清理 Vite 缓存..."
if [ -d "node_modules/.vite" ]; then
    rm -rf node_modules/.vite
    echo "   ✓ 已清理 node_modules/.vite"
fi
if [ -d ".vite" ]; then
    rm -rf .vite
    echo "   ✓ 已清理 .vite"
fi
echo ""

echo "🚀 启动 Electron（开发模式，--mode electron）..."
echo "   Vite: http://127.0.0.1:5177"
echo "   请确保后端已运行（例如 ./start-server.sh）"
echo ""

pnpm run dev:electron
