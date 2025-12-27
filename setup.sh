#!/bin/bash

# macOS/通用环境依赖安装脚本
# 安装所有必要的系统依赖和项目依赖

set -e

echo "=========================================="
echo "  依赖安装脚本 (macOS/通用环境)"
echo "=========================================="
echo ""

# 检测操作系统
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)    MACHINE=macOS;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

echo "🖥️  检测到操作系统: $MACHINE"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ==================== Python 依赖 ====================

echo "=========================================="
echo "  安装 Python 依赖"
echo "=========================================="

# 检查 Python3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 未安装"
    if [ "$MACHINE" = "macOS" ]; then
        echo "   请先安装 Python3:"
        echo "   brew install python3"
    else
        echo "   请先安装 Python3"
    fi
    exit 1
fi

echo "✅ Python 版本: $(python3 --version)"

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
            if [ "$MACHINE" = "macOS" ]; then
                echo "   尝试: brew install python3"
            fi
            cd "$SCRIPT_DIR"
            exit 1
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
        
        # 检查是否需要安装 playwright 浏览器（可选）
        if python -c "import playwright" 2>/dev/null; then
            echo "📦 安装 Playwright 浏览器（用于动态网页爬取）..."
            playwright install chromium 2>/dev/null || echo "⚠️  Playwright 浏览器安装跳过（可选）"
        fi
        
        deactivate
        echo "✅ Python 依赖安装完成"
    else
        echo "❌ 虚拟环境未正确创建，跳过 Python 依赖安装"
        echo "   请手动运行: cd backend && python3 -m venv venv"
        cd "$SCRIPT_DIR"
        exit 1
    fi
    
    cd "$SCRIPT_DIR"
else
    echo "⚠️  未找到 backend/requirements.txt，跳过 Python 依赖安装"
fi

# ==================== Node.js 依赖 ====================

echo ""
echo "=========================================="
echo "  安装 Node.js 依赖"
echo "=========================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    if [ "$MACHINE" = "macOS" ]; then
        echo "   请先安装 Node.js:"
        echo "   brew install node"
        echo "   或访问: https://nodejs.org/"
    else
        echo "   请先安装 Node.js: https://nodejs.org/"
    fi
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js 版本: $NODE_VERSION"

# 检查版本是否足够新（至少 v18）
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "⚠️  Node.js 版本过低，建议升级到 v18 或更高"
    echo "   当前版本: $NODE_VERSION"
fi

echo "✅ npm 版本: $(npm --version)"

# 安装 Node.js 依赖
if [ -f "package.json" ]; then
    echo "📦 安装 Node.js 依赖..."
    npm install
    echo "✅ Node.js 依赖安装完成"

    # 安装前端依赖（front/）
    if [ -f "front/package.json" ]; then
        echo "📦 安装前端依赖 (front/)..."
        npm --prefix front install
        echo "✅ 前端依赖安装完成"
    fi
    
    # 编译原生模块（node-pty）
    if [ -d "node_modules/node-pty" ]; then
        echo "🔨 编译 node-pty 原生模块..."
        npx electron-rebuild -f -w node-pty 2>/dev/null || {
            echo "⚠️  electron-rebuild 失败，尝试 npm rebuild..."
            npm rebuild node-pty 2>/dev/null || echo "⚠️  原生模块编译跳过"
        }
        echo "✅ 原生模块编译完成"
    fi
    
    # macOS 特定：设置 Electron 沙盒权限（可选）
    if [ "$MACHINE" = "macOS" ] && [ -f "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
        echo ""
        echo "ℹ️  Electron 沙盒设置（可选）:"
        echo "   当前使用默认配置，如需启用沙盒模式，请参考 Electron 文档"
    fi
else
    echo "⚠️  未找到 package.json，跳过 Node.js 依赖安装"
fi

# ==================== 系统依赖检查 ====================

echo ""
echo "=========================================="
echo "  系统依赖检查"
echo "=========================================="

# macOS 特定依赖
if [ "$MACHINE" = "macOS" ]; then
    # 检查 Homebrew（推荐但非必需）
    if ! command -v brew &> /dev/null; then
        echo "ℹ️  Homebrew 未安装（可选）"
        echo "   如需安装: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    else
        echo "✅ Homebrew 已安装"
    fi
fi

# 检查构建工具（用于编译原生模块）
if command -v gcc &> /dev/null || command -v clang &> /dev/null; then
    echo "✅ 编译工具已安装"
else
    echo "⚠️  编译工具未安装（可能需要编译原生模块）"
    if [ "$MACHINE" = "macOS" ]; then
        echo "   安装 Xcode Command Line Tools:"
        echo "   xcode-select --install"
    fi
fi

echo ""
echo "=========================================="
echo "✅ 依赖安装完成！"
echo "=========================================="
echo ""
echo "现在可以运行以下命令启动应用："
echo ""
echo "  1. 启动后端服务器（在一个终端）:"
echo "     cd backend && source venv/bin/activate && python app.py"
echo ""
echo "  2. 启动前端开发服务器（在另一个终端）:"
echo "     npm run dev"
echo ""
echo "  3. 启动 Electron 应用（在第三个终端）:"
echo "     npm run electron:dev"
echo ""
echo "=========================================="

