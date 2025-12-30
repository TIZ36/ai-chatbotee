#!/usr/bin/env python3
"""
Redis连接测试脚本
用于诊断Redis连接问题
"""

import sys
from pathlib import Path

def load_config():
    """加载配置文件（简单解析）"""
    config_path = Path(__file__).parent / 'config.yaml'
    if not config_path.exists():
        return None
    
    config = {}
    current_section = None
    
    with open(config_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            if line.endswith(':'):
                current_section = line[:-1]
                config[current_section] = {}
            elif ':' in line and current_section:
                key, value = line.split(':', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                config[current_section][key] = value
    
    return config

def test_redis_connection():
    """测试Redis连接"""
    print("=" * 60)
    print("Redis连接测试")
    print("=" * 60)
    
    # 加载配置
    config = load_config()
    if not config:
        print(f"❌ 无法加载配置文件")
        return False
    
    redis_config = config.get('redis', {})
    
    enabled = redis_config.get('enabled', 'false').lower()
    if enabled != 'true':
        print("⚠️  Redis在配置中被禁用 (enabled: false)")
        return False
    
    host = redis_config.get('host', 'localhost')
    port_str = redis_config.get('port', '6379')
    try:
        port = int(port_str)
    except:
        port = 6379
    password = redis_config.get('password', '')
    db_str = redis_config.get('db', '0')
    try:
        db = int(db_str)
    except:
        db = 0
    
    print(f"📋 配置信息:")
    print(f"   Host: {host}")
    print(f"   Port: {port}")
    print(f"   Password: {'*' * len(password) if password else '(无)'}")
    print(f"   DB: {db}")
    print()
    
    # 检查redis模块
    try:
        import redis
        print("✓ redis模块已安装")
    except ImportError:
        print("❌ redis模块未安装")
        print("   请运行: pip install redis")
        return False
    
    print(f"🔌 正在连接 Redis ({host}:{port})...")
    
    try:
        # 创建连接时，如果提供了密码，redis-py会自动进行AUTH
        # 但如果Redis没有设置密码，提供密码会导致错误
        # 所以我们需要先尝试无密码连接，如果失败再尝试有密码
        client = None
        result = False
        
        if password:
            # 先尝试有密码连接
            try:
                client = redis.Redis(
                    host=host,
                    port=port,
                    password=password,
                    db=db,
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5
                )
                result = client.ping()
            except redis.AuthenticationError:
                print("⚠️  有密码连接失败，尝试无密码连接...")
                client = None
        
        if not client:
            # 尝试无密码连接
            client = redis.Redis(
                host=host,
                port=port,
                password=None,
                db=db,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            result = client.ping()
        if result:
            print("✓ Redis连接成功!")
            print()
            
            # 测试基本操作
            print("🧪 测试基本操作...")
            test_key = "test:connection"
            client.set(test_key, "test_value", ex=10)
            value = client.get(test_key)
            if value == "test_value":
                print("✓ SET/GET操作正常")
            client.delete(test_key)
            print("✓ DELETE操作正常")
            
            # 获取Redis信息
            info = client.info('server')
            print()
            print("📊 Redis服务器信息:")
            print(f"   Redis版本: {info.get('redis_version', 'unknown')}")
            print(f"   运行模式: {info.get('redis_mode', 'unknown')}")
            print(f"   操作系统: {info.get('os', 'unknown')}")
            
            return True
        else:
            print("❌ Redis ping返回False")
            return False
            
    except redis.ConnectionError as e:
        print(f"❌ Redis连接错误: {e}")
        print()
        print("💡 可能的原因:")
        print("   1. Redis服务未启动")
        print("   2. 主机地址或端口错误")
        print("   3. 防火墙阻止连接")
        print()
        print("   请检查:")
        print(f"   - Redis是否在运行: redis-cli -h {host} -p {port} ping")
        if password:
            print(f"   - 密码是否正确: redis-cli -h {host} -p {port} -a {password} ping")
        return False
        
    except redis.AuthenticationError as e:
        print(f"❌ Redis认证失败: {e}")
        print()
        print("💡 可能的原因:")
        print("   1. 密码错误")
        print("   2. Redis未设置密码，但配置中提供了密码")
        print("   3. Redis设置了密码，但配置中未提供密码")
        print()
        print("   请检查:")
        print(f"   - 配置文件中的password是否正确")
        print(f"   - Redis是否设置了requirepass")
        return False
        
    except Exception as e:
        print(f"❌ 未知错误: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    success = test_redis_connection()
    print()
    print("=" * 60)
    if success:
        print("✅ 测试完成: Redis连接正常")
    else:
        print("❌ 测试完成: Redis连接失败")
    print("=" * 60)
    sys.exit(0 if success else 1)
