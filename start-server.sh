#!/bin/bash

# 启动后端服务器
# 自动检测/创建虚拟环境，安装依赖，并启动 Flask 应用

cd "$(dirname "$0")/backend"

# 检查 Python 环境
if ! command -v python3 &> /dev/null; then
    echo "错误: 未找到 python3，请先安装 Python"
    exit 1
fi

# 检查 requirements.txt 是否存在
if [ ! -f "requirements.txt" ]; then
    echo "错误: 未找到 requirements.txt"
    exit 1
fi

# 检测并创建虚拟环境
if [ ! -d "venv" ]; then
    echo "虚拟环境不存在，正在创建..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "错误: 创建虚拟环境失败"
        exit 1
    fi
    echo "✅ 虚拟环境创建成功"
else
    echo "✅ 虚拟环境已存在"
fi

# 激活虚拟环境
echo "激活虚拟环境..."
source venv/bin/activate

# 升级 pip
echo "升级 pip..."
pip install --upgrade pip --quiet

# 检查依赖是否已安装（通过检查 flask 和 DBUtils 是否安装来判断）
NEED_INSTALL=false
if ! python -c "import flask" 2>/dev/null; then
    NEED_INSTALL=true
elif ! python -c "import dbutils" 2>/dev/null; then
    NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = true ]; then
    echo "依赖未完全安装，正在安装依赖..."
    pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "错误: 安装依赖失败"
        exit 1
    fi
    echo "✅ 依赖安装完成"
else
    echo "✅ 依赖已安装"
    # 检查是否有新依赖需要安装
    echo "检查是否有新依赖需要安装..."
    pip install -r requirements.txt --quiet --upgrade 2>/dev/null || true
fi

# 运行数据库迁移/初始化
echo "初始化数据库..."
python -c "
import sys
import yaml
from pathlib import Path

try:
    from database import init_mysql, create_tables
    
    # 加载配置
    config_path = Path('config.yaml')
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        # 初始化 MySQL（如果启用）
        mysql_config = config.get('mysql', {})
        if mysql_config.get('enabled', False):
            print('正在初始化 MySQL 数据库...')
            success, error = init_mysql(config)
            if success:
                print('✅ 数据库初始化成功（表已创建/验证）')
            else:
                print(f'⚠️  数据库初始化失败: {error}')
                print('继续启动服务器（无数据库支持）...')
        else:
            print('ℹ️  MySQL 未启用，跳过数据库初始化')
    else:
        print('⚠️  未找到 config.yaml，跳过数据库初始化')
except ImportError as e:
    print(f'⚠️  导入错误: {e}')
    print('数据库初始化将在服务器启动时进行...')
except Exception as e:
    print(f'⚠️  数据库初始化出错: {e}')
    print('继续启动服务器...')
" 2>&1

# 验证新架构模块
echo ""
echo "验证新架构模块..."
python -c "
try:
    from api import register_api_routes
    from api.health import health_bp
    from services.llm_service import get_llm_service
    from services.mcp_service import get_mcp_service
    from services.session_service import get_session_service
    from services.message_service import get_message_service
    print('✅ 新架构 API 模块加载成功')
except ImportError as e:
    print(f'⚠️  新架构模块加载警告: {e}')
    print('使用原有 API 路由...')
" 2>&1

# 启动服务器
echo ""
echo "=========================================="
echo "  启动后端服务器 (新架构)"
echo "=========================================="
echo ""
python app.py

