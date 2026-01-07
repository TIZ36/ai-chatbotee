#!/bin/bash

# 启动后端服务器 (macOS/Linux)
# 自动检测/创建虚拟环境，安装依赖，并启动 Flask 应用

cd "$(dirname "$0")/backend"

# ========== 停止已运行的后端进程 ==========
echo "检查并停止已运行的后端进程..."

# 方法1: 通过端口查找进程 (默认端口 3001/3002)
for PORT in 3001 3002; do
    PID=$(lsof -ti :$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "  发现端口 $PORT 被进程 $PID 占用，正在停止..."
        kill -9 $PID 2>/dev/null
        sleep 1
        echo "  ✅ 进程 $PID 已停止"
    fi
done

# 方法2: 通过进程名查找 (app.py)
PIDS=$(pgrep -f "python.*app\.py" 2>/dev/null)
if [ -n "$PIDS" ]; then
    echo "  发现后端进程: $PIDS，正在停止..."
    echo "$PIDS" | xargs kill -9 2>/dev/null
    sleep 1
    echo "  ✅ 后端进程已停止"
fi

echo "✅ 旧进程清理完成"
echo ""

# ========== 清理 Python 编译缓存 ==========
echo "清理 Python 编译缓存..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find . -type f -name "*.pyc" -delete 2>/dev/null
find . -type f -name "*.pyo" -delete 2>/dev/null
echo "✅ 编译缓存已清理"
echo ""

# ========== 检查 Python 环境 ==========
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未找到 python3，请先安装 Python"
    echo "   macOS: brew install python3"
    echo "   Ubuntu: sudo apt install python3 python3-venv"
    exit 1
fi

echo "✅ Python 版本: $(python3 --version)"

# 检查 requirements.txt 是否存在
if [ ! -f "requirements.txt" ]; then
    echo "❌ 错误: 未找到 requirements.txt"
    exit 1
fi

# ========== 虚拟环境创建函数 ==========
create_venv() {
    echo "创建虚拟环境..."
    rm -rf venv 2>/dev/null
    
    # 方法1: 标准方式创建（包含 pip）
    if python3 -m venv venv 2>/dev/null; then
        source venv/bin/activate
        if python -m pip --version &> /dev/null; then
            echo "✅ 虚拟环境创建成功（标准方式）"
            return 0
        fi
        deactivate 2>/dev/null || true
    fi
    
    # 方法2: 不带 pip 创建，然后使用 get-pip.py 安装
    echo "⚠️  标准方式未包含 pip，尝试备选方案..."
    rm -rf venv 2>/dev/null
    python3 -m venv --without-pip venv
    if [ $? -ne 0 ]; then
        echo "❌ 错误: 创建虚拟环境失败"
        return 1
    fi
    
    source venv/bin/activate
    
    # 使用 get-pip.py 安装 pip
    echo "下载并安装 pip..."
    curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
    if [ $? -ne 0 ]; then
        echo "❌ 错误: 下载 get-pip.py 失败"
        deactivate 2>/dev/null || true
        return 1
    fi
    
    python /tmp/get-pip.py --quiet 2>/dev/null || python /tmp/get-pip.py
    rm -f /tmp/get-pip.py
    
    if python -m pip --version &> /dev/null; then
        echo "✅ 虚拟环境创建成功（get-pip 方式）"
        return 0
    fi
    
    echo "❌ 错误: 无法安装 pip"
    deactivate 2>/dev/null || true
    return 1
}

# ========== 检测并创建/修复虚拟环境 ==========
NEED_CREATE=false

if [ ! -d "venv" ]; then
    echo "虚拟环境不存在"
    NEED_CREATE=true
elif [ ! -f "venv/bin/activate" ] || [ ! -f "venv/bin/python" ]; then
    echo "⚠️  虚拟环境不完整"
    NEED_CREATE=true
else
    # 虚拟环境存在，尝试激活并检查 pip
    echo "✅ 虚拟环境已存在"
    source venv/bin/activate
    
    if [ -z "$VIRTUAL_ENV" ]; then
        echo "⚠️  虚拟环境激活失败"
        NEED_CREATE=true
    elif ! python -m pip --version &> /dev/null; then
        echo "⚠️  虚拟环境中没有 pip"
        deactivate 2>/dev/null || true
        NEED_CREATE=true
    fi
fi

if [ "$NEED_CREATE" = true ]; then
    create_venv
    if [ $? -ne 0 ]; then
        echo ""
        echo "❌ 虚拟环境创建失败"
        echo ""
        echo "可能的解决方案："
        echo "1. macOS: brew install python3"
        echo "2. Ubuntu: sudo apt install python3 python3-venv python3-pip"
        echo "3. 手动创建虚拟环境:"
        echo "   cd backend"
        echo "   python3 -m venv --without-pip venv"
        echo "   source venv/bin/activate"
        echo "   curl https://bootstrap.pypa.io/get-pip.py | python"
        exit 1
    fi
fi

# 确保虚拟环境已激活
if [ -z "$VIRTUAL_ENV" ]; then
    source venv/bin/activate
fi

echo "使用 pip: $(python -m pip --version)"

# ========== 升级 pip ==========
echo "升级 pip..."
python -m pip install --upgrade pip --quiet 2>/dev/null || python -m pip install --upgrade pip

# ========== 安装依赖 ==========
NEED_INSTALL=false
if ! python -c "import flask" 2>/dev/null; then
    NEED_INSTALL=true
elif ! python -c "import dbutils" 2>/dev/null; then
    NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = true ]; then
    echo "安装依赖..."
    python -m pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "❌ 错误: 安装依赖失败"
        exit 1
    fi
    echo "✅ 依赖安装完成"
else
    echo "✅ 依赖已安装"
    # 检查是否有新依赖需要安装
    echo "检查新依赖..."
    python -m pip install -r requirements.txt --quiet --upgrade 2>/dev/null || true
fi

# ========== 初始化数据库 ==========
echo ""
echo "初始化数据库..."
DB_INIT_SUCCESS=false
python -c "
import sys
import yaml
from pathlib import Path

try:
    from database import init_mysql, create_tables
    
    config_path = Path('config.yaml')
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        mysql_config = config.get('mysql', {})
        if mysql_config.get('enabled', False):
            print('正在初始化 MySQL 数据库...')
            success, error = init_mysql(config)
            if success:
                print('✅ 数据库初始化成功')
                sys.exit(0)  # 成功
            else:
                print(f'⚠️  数据库初始化失败: {error}')
                print('继续启动服务器（无数据库支持）...')
                sys.exit(1)  # 失败但继续
        else:
            print('ℹ️  MySQL 未启用，跳过数据库初始化')
            sys.exit(0)  # 未启用不算失败
    else:
        print('⚠️  未找到 config.yaml，跳过数据库初始化')
        sys.exit(0)  # 无配置文件不算失败
except ImportError as e:
    print(f'⚠️  导入错误: {e}')
    print('数据库初始化将在服务器启动时进行...')
    sys.exit(1)  # 导入错误
except Exception as e:
    print(f'⚠️  数据库初始化出错: {e}')
    print('继续启动服务器...')
    sys.exit(1)  # 异常
" 2>&1
DB_INIT_RESULT=$?

# ========== 运行数据迁移 ==========
echo ""
echo "检查数据迁移..."

# 只有在数据库启用且初始化成功时才执行迁移
if [ "$DB_INIT_RESULT" -eq 0 ]; then
    echo "执行 DeepSeek 供应商迁移..."
    python -c "
import sys
try:
    from migrate_deepseek_provider import migrate_deepseek_provider
    success = migrate_deepseek_provider()
    sys.exit(0 if success else 1)
except ImportError:
    print('ℹ️  跳过 DeepSeek 迁移（脚本不存在）')
    sys.exit(0)
except Exception as e:
    import traceback
    print(f'❌ DeepSeek 迁移出错: {e}')
    traceback.print_exc()
    sys.exit(1)
" 2>&1
    DEEPSEEK_MIGRATE_RESULT=$?
    
    if [ "$DEEPSEEK_MIGRATE_RESULT" -ne 0 ]; then
        echo "⚠️  DeepSeek 迁移失败，但继续启动服务器..."
    fi
else
    echo "ℹ️  数据库未初始化，跳过 DeepSeek 迁移"
fi

# ========== LLM供应商迁移 ==========
echo ""
echo "检查 LLM 供应商迁移..."

# 只有在数据库启用且初始化成功时才执行迁移
if [ "$DB_INIT_RESULT" -eq 0 ]; then
    echo "执行 LLM 供应商迁移..."
    python -c "
import sys
try:
    from migrate_llm_providers import migrate_llm_providers
    success = migrate_llm_providers()
    if not success:
        print('❌ LLM 供应商迁移失败')
        sys.exit(1)
    sys.exit(0)
except ImportError:
    print('ℹ️  跳过 LLM 供应商迁移（脚本不存在）')
    sys.exit(0)
except Exception as e:
    import traceback
    print(f'❌ LLM 供应商迁移出错: {e}')
    traceback.print_exc()
    sys.exit(1)
" 2>&1
    LLM_MIGRATE_RESULT=$?
    
    if [ "$LLM_MIGRATE_RESULT" -ne 0 ]; then
        echo ""
        echo "⚠️  ⚠️  ⚠️  警告：LLM 供应商迁移失败！"
        echo "   这可能导致模型供应商功能不正常。"
        echo "   建议手动运行迁移脚本："
        echo "   cd backend"
        echo "   python migrate_llm_providers.py"
        echo ""
        echo "   继续启动服务器（迁移失败不影响启动）..."
    else
        echo "✅ LLM 供应商迁移完成"
    fi
else
    echo "ℹ️  数据库未初始化，跳过 LLM 供应商迁移"
fi

# ========== Notion 工作空间字段迁移 ==========
echo ""
echo "检查 Notion 工作空间数据库迁移..."
python -c "
import yaml
from pathlib import Path
from database import get_mysql_connection, init_mysql

try:
    config_path = Path('config.yaml')
    if not config_path.exists():
        print('ℹ️  未找到 config.yaml，跳过 Notion 迁移')
    else:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        mysql_config = config.get('mysql', {})
        if not mysql_config.get('enabled', False):
            print('ℹ️  MySQL 未启用，跳过 Notion 迁移')
        else:
            # 先尝试初始化数据库连接（如果尚未初始化）
            from database import mysql_pool
            if mysql_pool is None:
                print('🔄 正在初始化数据库连接...')
                success, error = init_mysql(config)
                if not success:
                    print(f'⚠️  数据库初始化失败: {error}，跳过 Notion 迁移')
                    conn = None
                else:
                    conn = get_mysql_connection()
            else:
                conn = get_mysql_connection()
            
            if not conn:
                print('⚠️  数据库连接失败，跳过 Notion 迁移')
            else:
                cursor = conn.cursor()
                
                # 检查 workspace_alias 字段是否存在
                cursor.execute('''
                    SELECT COUNT(*) 
                    FROM information_schema.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = 'notion_registrations' 
                    AND COLUMN_NAME = 'workspace_alias'
                ''')
                workspace_alias_exists = cursor.fetchone()[0] > 0
                
                # 检查 short_hash 字段是否存在
                cursor.execute('''
                    SELECT COUNT(*) 
                    FROM information_schema.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = 'notion_registrations' 
                    AND COLUMN_NAME = 'short_hash'
                ''')
                short_hash_exists = cursor.fetchone()[0] > 0
                
                if workspace_alias_exists and short_hash_exists:
                    print('✅ Notion 工作空间字段已存在，跳过迁移')
                else:
                    print('🔄 正在添加 Notion 工作空间字段...')
                    
                    # 添加 workspace_alias 字段
                    if not workspace_alias_exists:
                        cursor.execute('''
                            ALTER TABLE notion_registrations 
                            ADD COLUMN workspace_alias VARCHAR(255) DEFAULT NULL 
                            COMMENT 'Notion工作空间别名（全局唯一）'
                            AFTER client_name
                        ''')
                        print('  ✅ 已添加 workspace_alias 字段')
                    
                    # 添加 short_hash 字段
                    if not short_hash_exists:
                        cursor.execute('''
                            ALTER TABLE notion_registrations 
                            ADD COLUMN short_hash VARCHAR(8) DEFAULT NULL 
                            COMMENT '8位短hash，用于动态回调地址和redis缓存前缀'
                            AFTER workspace_alias
                        ''')
                        print('  ✅ 已添加 short_hash 字段')
                    
                    # 添加唯一索引
                    try:
                        cursor.execute('''
                            ALTER TABLE notion_registrations 
                            ADD UNIQUE INDEX idx_workspace_alias (workspace_alias)
                        ''')
                        print('  ✅ 已添加 workspace_alias 唯一索引')
                    except Exception as idx_error:
                        if 'Duplicate key' in str(idx_error):
                            print('  ℹ️  workspace_alias 唯一索引已存在')
                        else:
                            print(f'  ⚠️  添加 workspace_alias 索引失败: {idx_error}')
                    
                    try:
                        cursor.execute('''
                            ALTER TABLE notion_registrations 
                            ADD UNIQUE INDEX idx_short_hash (short_hash)
                        ''')
                        print('  ✅ 已添加 short_hash 唯一索引')
                    except Exception as idx_error:
                        if 'Duplicate key' in str(idx_error):
                            print('  ℹ️  short_hash 唯一索引已存在')
                        else:
                            print(f'  ⚠️  添加 short_hash 索引失败: {idx_error}')
                    
                    conn.commit()
                    print('✅ Notion 工作空间字段迁移完成')
                
                cursor.close()
                conn.close()
except ImportError as e:
    print(f'ℹ️  跳过 Notion 迁移（导入错误）: {e}')
except Exception as e:
    import traceback
    print(f'⚠️  Notion 迁移出错: {e}')
    traceback.print_exc()
" 2>&1

# ========== 验证模块 ==========
echo ""
echo "验证模块..."
python -c "
try:
    from api import register_api_routes
    from api.health import health_bp
    from services.llm_service import get_llm_service
    from services.mcp_service import get_mcp_service
    from services.session_service import get_session_service
    from services.message_service import get_message_service
    print('✅ API 模块加载成功')
except ImportError as e:
    print(f'⚠️  模块加载警告: {e}')
    print('使用原有 API 路由...')
" 2>&1

# ========== 启动服务器 ==========
echo ""
echo "=========================================="
echo "  启动后端服务器"
echo "=========================================="
echo ""
python app.py
