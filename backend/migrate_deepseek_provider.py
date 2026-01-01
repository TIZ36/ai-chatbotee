#!/usr/bin/env python3
"""
DeepSeek Provider 数据迁移脚本

将数据库中 provider='openai' 且 model 包含 'deepseek' 的配置迁移为 provider='deepseek'
"""

import yaml
from pathlib import Path
from database import get_mysql_connection, init_mysql


def _ensure_db_initialized():
    """确保数据库已初始化"""
    from database import mysql_pool
    if mysql_pool is not None:
        return True
    
    # 尝试从配置文件初始化
    config_path = Path(__file__).parent / 'config.yaml'
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        mysql_config = config.get('mysql', {})
        if mysql_config.get('enabled', False):
            success, error = init_mysql(config)
            return success
    
    return False


def migrate_deepseek_provider():
    """迁移 DeepSeek 配置"""
    print("=" * 60)
    print("DeepSeek Provider 数据迁移脚本")
    print("=" * 60)
    
    # 确保数据库已初始化
    if not _ensure_db_initialized():
        print("❌ 数据库未启用或初始化失败，跳过迁移")
        return True  # 返回 True 以免阻止启动
    
    conn = get_mysql_connection()
    if not conn:
        print("❌ 数据库连接失败")
        return False
    
    try:
        import pymysql
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # 1. 查找需要迁移的记录
        cursor.execute("""
            SELECT config_id, name, model, api_url 
            FROM llm_configs 
            WHERE provider = 'openai' 
            AND LOWER(model) LIKE '%deepseek%'
        """)
        records = cursor.fetchall()
        
        if not records:
            print("✅ 没有需要迁移的 DeepSeek 配置")
            print("=" * 60)
            return True
        
        print(f"📋 找到 {len(records)} 条需要迁移的记录:")
        for record in records:
            print(f"   - {record['name']} (ID: {record['config_id']}, Model: {record['model']})")
        print()
        
        # 2. 迁移每条记录
        migrated_count = 0
        for record in records:
            config_id = record['config_id']
            name = record['name']
            model = record['model']
            api_url = record['api_url']
            
            # 更新 provider 和 api_url
            cursor.execute("""
                UPDATE llm_configs 
                SET provider = 'deepseek',
                    api_url = COALESCE(NULLIF(api_url, ''), 'https://api.deepseek.com/v1/chat/completions'),
                    updated_at = CURRENT_TIMESTAMP
                WHERE config_id = %s
            """, (config_id,))
            
            migrated_count += 1
            new_api_url = api_url if api_url else 'https://api.deepseek.com/v1/chat/completions'
            print(f"  ✅ 迁移配置: {name}")
            print(f"     - config_id: {config_id}")
            print(f"     - model: {model}")
            print(f"     - provider: openai -> deepseek")
            print(f"     - api_url: {new_api_url}")
        
        conn.commit()
        print()
        print(f"🎉 成功迁移 {migrated_count} 条 DeepSeek 配置")
        print("=" * 60)
        return True
        
    except Exception as e:
        conn.rollback()
        print(f"❌ 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def check_deepseek_configs():
    """检查当前 DeepSeek 配置状态"""
    print("=" * 60)
    print("检查 DeepSeek 配置状态")
    print("=" * 60)
    
    # 确保数据库已初始化
    if not _ensure_db_initialized():
        print("❌ 数据库未启用或初始化失败")
        return
    
    conn = get_mysql_connection()
    if not conn:
        print("❌ 数据库连接失败")
        return
    
    try:
        import pymysql
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # 1. 检查 provider='openai' 且 model 包含 'deepseek' 的配置（需要迁移）
        cursor.execute("""
            SELECT config_id, name, provider, model, api_url 
            FROM llm_configs 
            WHERE provider = 'openai' 
            AND LOWER(model) LIKE '%deepseek%'
        """)
        openai_deepseek = cursor.fetchall()
        
        # 2. 检查 provider='deepseek' 的配置（已迁移）
        cursor.execute("""
            SELECT config_id, name, provider, model, api_url 
            FROM llm_configs 
            WHERE provider = 'deepseek'
        """)
        deepseek_configs = cursor.fetchall()
        
        print(f"\n📊 统计:")
        print(f"   - 需要迁移的配置 (provider='openai', model 包含 'deepseek'): {len(openai_deepseek)} 条")
        print(f"   - 已使用 deepseek provider 的配置: {len(deepseek_configs)} 条")
        
        if openai_deepseek:
            print(f"\n📋 需要迁移的配置:")
            for cfg in openai_deepseek:
                print(f"   - {cfg['name']} (ID: {cfg['config_id']}, Model: {cfg['model']})")
        
        if deepseek_configs:
            print(f"\n✅ 已使用 deepseek provider 的配置:")
            for cfg in deepseek_configs:
                print(f"   - {cfg['name']} (ID: {cfg['config_id']}, Model: {cfg['model']})")
        
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ 检查失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == '--check':
        # 只检查状态，不执行迁移
        check_deepseek_configs()
    else:
        # 执行迁移
        success = migrate_deepseek_provider()
        sys.exit(0 if success else 1)
