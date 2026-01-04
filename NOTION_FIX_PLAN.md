# Notion MCP 短 Hash 回调路径修复方案

## 问题诊断

**当前实现的问题：**
1. 所有 Notion 工作区共享同一个回调 URI: `/mcp/oauth/callback/`
2. Notion 服务器回调时，后端无法区分是哪个工作区
3. 数据库表 `notion_registrations` 缺少 `short_hash` 字段
4. 后端没有动态回调路由来处理不同的 short_hash

**正确的流程应该是：**
```
1. 注册工作区时：
   client_name: "my-workspace"
   ↓ 生成 8 位短 hash（如 "abcdefgh"）
   redirect_uri: "http://localhost:3002/mcp/oauth/callback/abcdefgh"
   ↓ 发送给 Notion 注册 API
   
2. Notion 用户授权后：
   回调到：http://localhost:3002/mcp/oauth/callback/abcdefgh
   ↓ 后端根据 short_hash 查询 client_id
   ↓ 交换 token
   
3. 数据关联：
   short_hash ← → client_id ← → oauth_tokens
```

## 需要修改的部分

### 1. 数据库表结构
- [ ] 为 `notion_registrations` 表添加 `short_hash` 列（UNIQUE, VARCHAR(8)）
- [ ] 创建迁移脚本

### 2. 生成短 hash 的函数
- [ ] 创建 `generate_short_hash(client_name)` 函数
- [ ] 确保唯一性，最多重试 10 次
- [ ] 格式：8 位字符（a-z, 0-9）

### 3. 修改 `register_notion_client()` 路由
- [ ] 生成短 hash
- [ ] 将短 hash 包含在 redirect_uri 中
- [ ] 保存短 hash 到数据库
- [ ] 返回短 hash 给前端

### 4. 修改 `mcp_oauth_callback()` 路由
- [ ] 改为动态路由 `@app.route('/mcp/oauth/callback/<short_hash>', methods=[...])`
- [ ] 根据 short_hash 从数据库查询 client_id
- [ ] 继续执行 token 交换逻辑

### 5. 修改 `notion_registrations` 表
```sql
ALTER TABLE `notion_registrations` 
ADD COLUMN `short_hash` VARCHAR(8) UNIQUE NOT NULL COMMENT '短哈希值，用于回调路由识别';
```

### 6. 修改相关查询函数
- [ ] `get_notion_registration_from_db()` - 支持 short_hash 查询
- [ ] 添加 `get_notion_registration_by_short_hash(short_hash)` 函数

## 实现步骤

### 第一步：添加数据库列
```python
# database.py 中的表创建逻辑
ALTER TABLE `notion_registrations` 
ADD COLUMN `short_hash` VARCHAR(8) UNIQUE NOT NULL DEFAULT '';
```

### 第二步：生成短 hash 的函数
```python
def generate_short_hash(client_name: str, retry_count: int = 0) -> str:
    """
    生成基于 client_name 的 8 位短 hash
    格式：前 4 位取 client_name，后 4 位是随机字符
    """
    import hashlib
    import random
    import string
    
    # 计算 client_name 的哈希
    name_hash = hashlib.md5(client_name.encode()).hexdigest()[:4]
    
    # 生成 4 位随机字符
    random_part = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
    
    short_hash = name_hash + random_part
    
    # 检查数据库中是否已存在
    if is_short_hash_exists(short_hash):
        if retry_count < 10:
            return generate_short_hash(client_name, retry_count + 1)
        else:
            raise Exception(f"Failed to generate unique short_hash after 10 retries")
    
    return short_hash
```

### 第三步：修改 `register_notion_client()`
```python
# 在构建 redirect_uri 之前
short_hash = generate_short_hash(client_name)

# 构建完整的 redirect_uri
redirect_uri = f"{redirect_uri_base.rstrip('/')}/mcp/oauth/callback/{short_hash}"

# 保存到数据库时添加 short_hash
cursor.execute("""
    INSERT INTO `notion_registrations` 
    (`short_hash`, `client_id`, `client_name`, `redirect_uri`, ...)
    VALUES (%s, %s, %s, %s, ...)
""", (short_hash, client_id, ...))

# 返回时包含 short_hash
return jsonify({
    'success': True,
    'client_id': client_id,
    'short_hash': short_hash,  # 返回给前端
    'redirect_uri': redirect_uri,
    ...
})
```

### 第四步：修改 `mcp_oauth_callback()` 路由
```python
# 从原来的通用路由改为动态路由
@app.route('/mcp/oauth/callback/<short_hash>', methods=['GET', 'POST', 'OPTIONS'])
def mcp_oauth_callback(short_hash):
    """处理 OAuth 回调，根据 short_hash 识别工作区"""
    
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    # 根据 short_hash 查询 client_id
    registration = get_notion_registration_by_short_hash(short_hash)
    if not registration:
        return jsonify({'error': 'Invalid short_hash'}), 400
    
    client_id = registration['client_id']
    
    # 继续执行原有的 token 交换逻辑
    # ... (保持现有代码不变)
```

### 第五步：添加查询函数
```python
def get_notion_registration_by_short_hash(short_hash: str):
    """根据 short_hash 查询 Notion 注册信息"""
    try:
        conn = get_mysql_connection()
        if not conn:
            return None
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT client_id, client_name, redirect_uri, redirect_uri_base, 
                   client_uri, registration_data
            FROM notion_registrations
            WHERE short_hash = %s
            LIMIT 1
        """, (short_hash,))
        
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row:
            return None
        
        registration_data = row[5]
        if isinstance(registration_data, str):
            try:
                registration_data = json.loads(registration_data)
            except:
                registration_data = {}
        
        return {
            'client_id': row[0],
            'client_name': row[1],
            'redirect_uri': row[2],
            'redirect_uri_base': row[3],
            'client_uri': row[4],
            'registration_data': registration_data,
        }
    except Exception as e:
        print(f"[Notion] Error getting registration by short_hash: {e}")
        return None
```

## 关键要点

1. **short_hash 必须唯一** - 用于回调路由识别
2. **short_hash 应该基于 client_name** - 便于调试
3. **redirect_uri 必须动态生成** - 不能固定
4. **回调路由必须动态** - `/mcp/oauth/callback/<short_hash>`
5. **保存 short_hash 到数据库** - 便于反向查询

## 测试场景

1. 注册第一个工作区 "workspace-1"
   - short_hash: "1a2b3c4d"
   - redirect_uri: "http://localhost:3002/mcp/oauth/callback/1a2b3c4d"

2. 注册第二个工作区 "workspace-2"
   - short_hash: "5e6f7g8h"
   - redirect_uri: "http://localhost:3002/mcp/oauth/callback/5e6f7g8h"

3. Notion 回调第一个工作区
   - URL: "http://localhost:3002/mcp/oauth/callback/1a2b3c4d?code=..."
   - 根据 short_hash 查询 client_id
   - 交换 token

4. Notion 回调第二个工作区
   - URL: "http://localhost:3002/mcp/oauth/callback/5e6f7g8h?code=..."
   - 根据 short_hash 查询 client_id
   - 交换 token

