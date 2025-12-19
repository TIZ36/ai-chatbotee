#!/bin/bash

# Ubuntu 环境初始化脚本
# 安装所有必要的系统依赖

set -e

echo "=========================================="
echo "  Ubuntu 环境初始化脚本"
echo "=========================================="
echo ""

# 检查是否以 root 运行或有 sudo 权限
if [ "$EUID" -ne 0 ]; then
    if ! command -v sudo &> /dev/null; then
        echo "❌ 错误: 需要 root 权限或 sudo"
        exit 1
    fi
    SUDO="sudo"
else
    SUDO=""
fi

echo "📦 更新软件包列表..."
$SUDO apt update

echo ""
echo "=========================================="
echo "  安装 Python 依赖"
echo "=========================================="

echo "📦 安装 Python3 和相关工具..."
$SUDO apt install -y \
    python3 \
    python3-venv \
    python3-pip \
    python3-dev

echo "✅ Python 安装完成: $(python3 --version)"

echo ""
echo "=========================================="
echo "  安装 Node.js 依赖"
echo "=========================================="

# 检查 Node.js 是否已安装
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js 已安装: $NODE_VERSION"
    
    # 检查版本是否足够新（至少 v18）
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | tr -d 'v')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "⚠️  Node.js 版本过低，建议升级到 v18 或更高"
        read -p "是否安装 Node.js v20 LTS? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            INSTALL_NODE=true
        else
            INSTALL_NODE=false
        fi
    else
        INSTALL_NODE=false
    fi
else
    echo "📦 Node.js 未安装，准备安装..."
    INSTALL_NODE=true
fi

if [ "$INSTALL_NODE" = true ]; then
    echo "📦 安装 Node.js v20 LTS..."
    # 使用 NodeSource 仓库安装最新 LTS 版本
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
    $SUDO apt install -y nodejs
    echo "✅ Node.js 安装完成: $(node --version)"
fi

echo "✅ npm 版本: $(npm --version)"

echo ""
echo "=========================================="
echo "  安装构建工具"
echo "=========================================="

echo "📦 安装构建工具 (build-essential, make, gcc, g++)..."
$SUDO apt install -y \
    build-essential \
    make \
    gcc \
    g++

echo "✅ 构建工具安装完成"

echo ""
echo "=========================================="
echo "  安装其他常用工具"
echo "=========================================="

echo "📦 安装其他工具 (curl, git)..."
$SUDO apt install -y \
    curl \
    git

echo "✅ 其他工具安装完成"

echo ""
echo "=========================================="
echo "  安装项目依赖"
echo "=========================================="

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 安装 Python 依赖
if [ -d "backend" ] && [ -f "backend/requirements.txt" ]; then
    echo "📦 设置 Python 虚拟环境..."
    cd backend
    
    # 如果 venv 存在但损坏，先删除
    if [ -d "venv" ] && [ ! -f "venv/bin/activate" ]; then
        echo "⚠️  虚拟环境损坏，正在删除重建..."
        rm -rf venv
    fi
    
    if [ ! -d "venv" ]; then
        echo "🔨 创建虚拟环境..."
        python3 -m venv venv
        if [ $? -ne 0 ]; then
            echo "❌ 虚拟环境创建失败"
            echo "   尝试: sudo apt install python3-venv"
            cd "$SCRIPT_DIR"
        else
            echo "✅ 虚拟环境创建成功"
        fi
    fi
    
    # 再次检查 venv 是否正确创建
    if [ -f "venv/bin/activate" ]; then
        echo "📦 安装 Python 依赖..."
        . venv/bin/activate
        pip install --upgrade pip
        pip install -r requirements.txt
        
        # 检查是否需要安装 playwright 浏览器（可选，用于动态网页爬取）
        if python -c "import playwright" 2>/dev/null; then
            echo "📦 安装 Playwright 浏览器（用于动态网页爬取）..."
            playwright install chromium 2>/dev/null || echo "⚠️  Playwright 浏览器安装跳过（可选）"
        fi
        
        deactivate
        echo "✅ Python 依赖安装完成"
    else
        echo "❌ 虚拟环境未正确创建，跳过 Python 依赖安装"
        echo "   请手动运行: cd backend && python3 -m venv venv"
    fi
    
    cd "$SCRIPT_DIR"
else
    echo "⚠️  未找到 backend/requirements.txt，跳过 Python 依赖安装"
fi

# 安装 Node.js 依赖
if [ -f "package.json" ]; then
    echo "📦 安装 Node.js 依赖..."
    
    # 修复 node-pty 权限问题（如果存在）
    if [ -d "node_modules/node-pty" ]; then
        echo "🔧 修复 node-pty 权限问题..."
        $SUDO chown -R "$USER:$USER" node_modules/node-pty 2>/dev/null || true
        rm -rf node_modules/node-pty/build 2>/dev/null || true
    fi
    
    npm install || {
        echo "⚠️  npm install 遇到错误，尝试修复权限后重试..."
        # 如果安装失败，尝试修复权限
        if [ -d "node_modules" ]; then
            $SUDO chown -R "$USER:$USER" node_modules 2>/dev/null || true
        fi
        # 重试安装
        npm install || echo "❌ npm install 失败，请检查错误信息"
    }
    echo "✅ Node.js 依赖安装完成"
    
    # 编译原生模块（node-pty 需要编译）
    if [ -d "node_modules/node-pty" ]; then
        echo "🔨 编译 node-pty 原生模块..."
        # 确保权限正确
        $SUDO chown -R "$USER:$USER" node_modules/node-pty 2>/dev/null || true
        rm -rf node_modules/node-pty/build 2>/dev/null || true
        
        npx electron-rebuild -f -w node-pty 2>/dev/null || {
            echo "⚠️  electron-rebuild 失败，尝试 npm rebuild..."
            npm rebuild node-pty 2>/dev/null || echo "⚠️  原生模块编译跳过（不影响移动端构建）"
        }
        echo "✅ 原生模块编译完成"
    fi
    
    # 检查 react-resizable-panels（前端依赖）
    if [ -d "node_modules/react-resizable-panels" ]; then
        echo "✅ react-resizable-panels 已安装"
    fi
    
    # 设置 Electron 沙盒权限（可选，如果不设置会使用 --no-sandbox 模式）
    if [ -f "node_modules/electron/dist/chrome-sandbox" ]; then
        echo ""
        echo "ℹ️  Electron 沙盒设置（可选）:"
        echo "   如果想启用沙盒模式，请手动运行以下命令:"
        echo "   sudo chown root:root node_modules/electron/dist/chrome-sandbox"
        echo "   sudo chmod 4755 node_modules/electron/dist/chrome-sandbox"
        echo "   （当前默认使用 --no-sandbox 模式运行）"
    fi
else
    echo "⚠️  未找到 package.json，跳过 Node.js 依赖安装"
fi

echo ""
echo "=========================================="
echo "✅ 初始化完成！"
echo "=========================================="
echo ""
echo "现在可以运行以下命令启动应用："
echo ""
echo "  1. 启动后端服务器（在一个终端）:"
echo "     ./start-server-ubuntu.sh"
echo ""
echo "  2. 启动 Electron 应用（在另一个终端）:"
echo "     ./start-electron-ubuntu.sh"
echo ""
echo "=========================================="

