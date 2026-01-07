"""
LLM供应商表迁移脚本
将现有的provider数据迁移到llm_providers表，并更新llm_configs表的provider_id
"""

import sys
import yaml
from pathlib import Path

# 添加backend目录到路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from database import get_mysql_connection, init_mysql

# 系统内置供应商配置
SYSTEM_PROVIDERS = [
    {
        'provider_id': 'openai',
        'name': 'OpenAI',
        'provider_type': 'openai',
        'is_system': 1,
        'override_url': 0,
        'default_api_url': 'https://api.openai.com/v1',
    },
    {
        'provider_id': 'anthropic',
        'name': 'Anthropic (Claude)',
        'provider_type': 'anthropic',
        'is_system': 1,
        'override_url': 0,
        'default_api_url': 'https://api.anthropic.com',
    },
    {
        'provider_id': 'gemini',
        'name': 'Google Gemini',
        'provider_type': 'gemini',
        'is_system': 1,
        'override_url': 0,
        'default_api_url': 'https://generativelanguage.googleapis.com',
    },
    {
        'provider_id': 'deepseek',
        'name': 'DeepSeek',
        'provider_type': 'deepseek',
        'is_system': 1,
        'override_url': 0,
        'default_api_url': 'https://api.deepseek.com',
    },
    {
        'provider_id': 'ollama',
        'name': 'Ollama',
        'provider_type': 'ollama',
        'is_system': 1,
        'override_url': 0,
        'default_api_url': 'http://localhost:11434',
    },
]


def migrate_llm_providers():
    """迁移LLM供应商数据"""
    # 先尝试初始化数据库连接（如果尚未初始化）
    config_path = Path(__file__).parent / 'config.yaml'
    if config_path.exists():
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            
            mysql_config = config.get('mysql', {})
            if mysql_config.get('enabled', False):
                # 如果连接池未初始化，先初始化
                from database import mysql_pool
                if mysql_pool is None:
                    print("🔄 正在初始化数据库连接...")
                    success, error = init_mysql(config)
                    if not success:
                        print(f"❌ 数据库初始化失败: {error}")
                        return False
        except Exception as e:
            print(f"⚠️  加载配置失败: {e}")
            # 继续尝试使用已初始化的连接池
    
    # 获取数据库连接
    conn = get_mysql_connection()
    if not conn:
        print("❌ 数据库连接失败")
        return False
    
    try:
        cursor = conn.cursor()
        
        # 1. 检查llm_providers表是否存在
        cursor.execute("""
            SELECT COUNT(*) 
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'llm_providers'
        """)
        table_exists = cursor.fetchone()[0] > 0
        
        if not table_exists:
            print("⚠️  llm_providers 表不存在，请先运行 create_tables()")
            return False
        
        # 2. 插入系统内置供应商（如果不存在）
        print("🔄 正在初始化系统内置供应商...")
        for provider in SYSTEM_PROVIDERS:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM llm_providers 
                WHERE provider_id = %s
            """, (provider['provider_id'],))
            exists = cursor.fetchone()[0] > 0
            
            if not exists:
                cursor.execute("""
                    INSERT INTO llm_providers 
                    (provider_id, name, provider_type, is_system, override_url, default_api_url)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    provider['provider_id'],
                    provider['name'],
                    provider['provider_type'],
                    provider['is_system'],
                    provider['override_url'],
                    provider['default_api_url'],
                ))
                print(f"  ✅ 已创建系统供应商: {provider['name']}")
            else:
                print(f"  ℹ️  供应商已存在: {provider['name']}")
        
        # 3. 更新llm_configs表的provider_id
        print("🔄 正在更新llm_configs表的provider_id...")
        
        # 检查provider_id列是否存在
        cursor.execute("""
            SELECT COUNT(*) 
            FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'llm_configs' 
            AND COLUMN_NAME = 'provider_id'
        """)
        column_exists = cursor.fetchone()[0] > 0
        
        if not column_exists:
            print("⚠️  llm_configs.provider_id 列不存在，请先运行 create_tables()")
            return False
        
        # 获取所有需要更新的配置
        cursor.execute("""
            SELECT config_id, provider 
            FROM llm_configs 
            WHERE provider_id IS NULL OR provider_id = ''
        """)
        configs_to_update = cursor.fetchall()
        
        updated_count = 0
        for config_id, provider in configs_to_update:
            # 将provider映射到provider_id（使用小写）
            provider_id = provider.lower() if provider else 'custom'
            
            # 检查provider_id是否存在
            cursor.execute("""
                SELECT COUNT(*) 
                FROM llm_providers 
                WHERE provider_id = %s
            """, (provider_id,))
            provider_exists = cursor.fetchone()[0] > 0
            
            if provider_exists:
                cursor.execute("""
                    UPDATE llm_configs 
                    SET provider_id = %s 
                    WHERE config_id = %s
                """, (provider_id, config_id))
                updated_count += 1
            else:
                # 如果provider不存在，使用custom
                print(f"  ⚠️  供应商 '{provider}' 不存在，使用 'custom'")
                cursor.execute("""
                    UPDATE llm_configs 
                    SET provider_id = 'custom' 
                    WHERE config_id = %s
                """, (config_id,))
                updated_count += 1
        
        conn.commit()
        print(f"  ✅ 已更新 {updated_count} 个配置的 provider_id")
        
        cursor.close()
        conn.close()
        
        print("✅ LLM供应商迁移完成")
        return True
        
    except Exception as e:
        import traceback
        print(f"❌ 迁移失败: {e}")
        traceback.print_exc()
        if conn:
            conn.close()
        return False


if __name__ == '__main__':
    migrate_llm_providers()
