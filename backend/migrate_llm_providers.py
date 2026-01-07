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
    mysql_enabled = False
    
    if config_path.exists():
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            
            mysql_config = config.get('mysql', {})
            mysql_enabled = mysql_config.get('enabled', False)
            
            if mysql_enabled:
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
    else:
        print("ℹ️  未找到 config.yaml，跳过迁移")
        return True  # 无配置文件时返回成功，不阻止启动
    
    # 如果 MySQL 未启用，跳过迁移
    if not mysql_enabled:
        print("ℹ️  MySQL 未启用，跳过 LLM 供应商迁移")
        return True  # 未启用时返回成功，不阻止启动
    
    # 获取数据库连接
    conn = get_mysql_connection()
    if not conn:
        print("❌ 数据库连接失败，无法执行迁移")
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
        
        # 2. 确保所有必需的列都存在
        print("🔄 正在检查表结构...")
        
        def _ensure_column(table: str, column: str, ddl: str, log_name: str):
            """确保列存在"""
            try:
                cursor.execute("""
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = %s
                      AND COLUMN_NAME = %s
                """, (table, column))
                exists = cursor.fetchone()[0] > 0
                if exists:
                    return True
                print(f"  → 添加列 '{log_name}' 到 '{table}' 表...")
                cursor.execute(ddl)
                conn.commit()
                print(f"  ✅ 已添加列 '{log_name}'")
                return True
            except Exception as e:
                print(f"  ⚠️  添加列 '{log_name}' 失败: {e}")
                return False
        
        # 检查并添加必需的列
        columns_to_add = [
            ('provider_type', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `provider_type` VARCHAR(50) NOT NULL DEFAULT 'custom' 
                COMMENT '兼容的供应商类型: openai, deepseek, anthropic, gemini, ollama, local, custom'
                AFTER `name`
            """, 'provider_type'),
            ('is_system', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `is_system` TINYINT(1) DEFAULT 0 
                COMMENT '是否为系统内置供应商'
                AFTER `provider_type`
            """, 'is_system'),
            ('override_url', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `override_url` TINYINT(1) DEFAULT 0 
                COMMENT '是否覆盖默认URL'
                AFTER `is_system`
            """, 'override_url'),
            ('default_api_url', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `default_api_url` TEXT DEFAULT NULL 
                COMMENT '默认API地址'
                AFTER `override_url`
            """, 'default_api_url'),
            ('logo_light', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `logo_light` TEXT DEFAULT NULL 
                COMMENT '浅色主题Logo (base64)'
            """, 'logo_light'),
            ('logo_dark', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `logo_dark` TEXT DEFAULT NULL 
                COMMENT '深色主题Logo (base64)'
            """, 'logo_dark'),
            ('logo_theme', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `logo_theme` VARCHAR(10) DEFAULT 'auto' 
                COMMENT 'Logo主题模式: auto, light, dark'
            """, 'logo_theme'),
            ('metadata', """
                ALTER TABLE `llm_providers`
                ADD COLUMN `metadata` JSON DEFAULT NULL 
                COMMENT '元数据'
            """, 'metadata'),
        ]
        
        for column_name, ddl, log_name in columns_to_add:
            _ensure_column('llm_providers', column_name, ddl, log_name)
        
        # 更新现有记录的 provider_type（如果为空或默认值）
        print("🔄 正在更新现有记录的 provider_type...")
        try:
            # 检查是否有 provider_type 为 'custom' 或 NULL 的记录
            cursor.execute("""
                SELECT provider_id, name 
                FROM llm_providers 
                WHERE provider_type IS NULL OR provider_type = 'custom' OR provider_type = ''
            """)
            existing_records = cursor.fetchall()
            
            # 根据 provider_id 映射到正确的 provider_type
            provider_type_map = {
                'openai': 'openai',
                'anthropic': 'anthropic',
                'gemini': 'gemini',
                'deepseek': 'deepseek',
                'ollama': 'ollama',
            }
            
            updated_count = 0
            for provider_id, name in existing_records:
                # 尝试从 provider_id 推断 provider_type
                provider_type = provider_type_map.get(provider_id.lower(), 'custom')
                if provider_type != 'custom':
                    cursor.execute("""
                        UPDATE llm_providers 
                        SET provider_type = %s 
                        WHERE provider_id = %s 
                        AND (provider_type IS NULL OR provider_type = 'custom' OR provider_type = '')
                    """, (provider_type, provider_id))
                    updated_count += 1
            
            if updated_count > 0:
                conn.commit()
                print(f"  ✅ 已更新 {updated_count} 条记录的 provider_type")
        except Exception as e:
            print(f"  ⚠️  更新现有记录失败: {e}")
            # 继续执行，不阻止迁移
        
        # 3. 插入系统内置供应商（如果不存在）
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
        
        # 4. 更新llm_configs表的provider_id
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
