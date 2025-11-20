#!/bin/bash

# 启动 Electron 应用
# 在项目根目录运行

cd "$(dirname "$0")"

# 检查 Node.js 环境
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 node，请先安装 Node.js"
    exit 1
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "错误: 未找到 npm，请先安装 npm"
    exit 1
fi

# 检查是否存在 node_modules（如果没有则安装依赖）
if [ ! -d "node_modules" ]; then
    echo "未找到 node_modules，正在安装依赖..."
    npm install
fi

# 检查是否存在 package.json
if [ ! -f "package.json" ]; then
    echo "错误: 未找到 package.json"
    exit 1
fi

# 启动 Electron（开发模式）
# 使用 concurrently 同时启动 Vite 开发服务器和 Electron
echo "启动 Electron 应用..."

# 检查依赖是否已安装（通过检查 vite 是否在 node_modules 中）
if [ ! -d "node_modules/vite" ]; then
    echo "检测到依赖未完全安装，正在安装..."
    npm install
    if [ $? -ne 0 ]; then
        echo "错误: 安装依赖失败"
        exit 1
    fi
    echo "✅ 依赖安装完成"
fi

# 检查并重新编译 node-pty（如果需要）
echo "检查原生模块..."
if [ ! -f "node_modules/node-pty/build/Release/pty.node" ] || [ "node_modules/node-pty/build/Release/pty.node" -ot "node_modules/electron/package.json" ]; then
    echo "重新编译 node-pty 原生模块..."
    npm run rebuild:electron 2>/dev/null || npx electron-rebuild -f -w node-pty
    if [ $? -ne 0 ]; then
        echo "警告: 原生模块重新编译失败，但继续启动..."
    else
        echo "✅ 原生模块编译完成"
    fi
fi

# 编译 Electron 主进程代码
echo "编译 Electron 主进程代码..."
npm run build:electron
if [ $? -ne 0 ]; then
    echo "错误: 编译 Electron 代码失败"
    exit 1
fi
echo "✅ Electron 代码编译完成"

# 检查编译后的文件是否存在
if [ ! -f "electron/dist/main.js" ]; then
    echo "错误: 编译后的 main.js 文件不存在"
    exit 1
fi
echo "✅ 编译文件检查通过"

# 尝试使用 electron:dev 脚本（需要 concurrently 和 wait-on）
if command -v npx &> /dev/null && (npx -y concurrently --version 2>/dev/null || [ -f "node_modules/.bin/concurrently" ]); then
    echo "使用 electron:dev 模式启动（同时启动 Vite 和 Electron）..."
    npm run electron:dev
else
    echo "使用基础模式启动（先启动 Vite，再启动 Electron）..."
    # 后台启动 Vite 开发服务器
    npm run dev &
    VITE_PID=$!
    echo "Vite 开发服务器已启动 (PID: $VITE_PID)"
    
    # 等待 Vite 服务器就绪
    echo "等待 Vite 服务器就绪..."
    for i in {1..30}; do
        if curl -s http://localhost:5174 > /dev/null 2>&1; then
            echo "✅ Vite 服务器已就绪"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "警告: Vite 服务器启动超时，继续启动 Electron..."
        fi
        sleep 1
    done
    
    # 启动 Electron
    npm run electron
    
    # 当 Electron 退出时，清理 Vite 进程
    echo "清理 Vite 进程..."
    kill $VITE_PID 2>/dev/null
fi

