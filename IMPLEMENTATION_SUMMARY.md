# Notion Short Hash 机制实现 - 修改总结

**日期**: 2026年1月4日
**状态**: ✅ 已完成实现

## 修改内容概览

### 1. 数据库表结构修改 (database.py)

**修改点**:
- ✅ 为 `notion_registrations` 表添加 `short_hash` 字段
- ✅ 字段类型: VARCHAR(8) UNIQUE NOT NULL
- ✅ 字段位置: 在 `id` 之后
- ✅ 添加自动迁移逻辑，处理既有表的升级

**SQL**:
```sql
CREATE TABLE IF NOT EXISTS `notion_registrations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `short_hash` VARCHAR(8) NOT NULL UNIQUE COMMENT '8位短哈希，用于OAuth回调路由识别',
    `client_id` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Notion OAuth Client ID',
    `client_name` VARCHAR(255) NOT NULL COMMENT '客户端名称（用户输入）',
    `redirect_uri` TEXT NOT NULL COMMENT '完整回调地址（包含short_hash）',
    ...
)
```

### 2. Short Hash 生成函数 (mcp_server/well_known/notion.py)

**新增函数**:

#### a) `generate_short_hash(client_name, retry_count=0)`
- 生成基于 client_name 的 8 位唯一哈希
- 格式：前 4 位 = client_name 的 MD5 哈希前 4 位；后 4 位 = 随机字符
- 自动检查唯一性，最多重试 10 次
- 返回值: 8 位字符串（a-z, 0-9）

#### b) `_is_short_hash_exists(short_hash)`
- 辅助函数，检查 short_hash 是否已存在
- 返回: bool

#### c) `get_notion_registration_by_short_hash(short_hash)`
- 根据 short_hash 从数据库查询 Notion 注册信息
- 返回: 包含 client_id, client_name, redirect_uri 等的字典，或 None

### 3. 注册路由修改 (app.py: `/api/notion/register`)

**修改流程**:
```
1. 获取 client_name
2. ✅ NEW: 生成 short_hash = generate_short_hash(client_name)
3. ✅ CHANGED: redirect_uri = "{base}/mcp/oauth/callback/{short_hash}"
4. 发送给 Notion 注册 API
5. ✅ NEW: 保存 short_hash 到数据库
6. ✅ NEW: 返回 short_hash 给前端
```

**返回值示例**:
```json
{
    "success": true,
    "client_id": "abc123xyz",
    "short_hash": "1a2b3c4d",
    "client_name": "workspace1",
    "redirect_uri": "http://localhost:3002/mcp/oauth/callback/1a2b3c4d",
    "registration_data": {...}
}
```

### 4. 回调路由修改 (app.py: `/mcp/oauth/callback`)

**修改内容**:
- ✅ 从固定路由改为动态路由
- ✅ 新路由: `@app.route('/mcp/oauth/callback/<short_hash>', ...)`
- ✅ 新参数: `short_hash` 动态路由参数
- ✅ 查询逻辑: 从 short_hash → 查询数据库 → 获取 client_id

**回调流程**:
```
Notion → http://localhost:3002/mcp/oauth/callback/1a2b3c4d/?code=...&state=...
    ↓
后端提取 short_hash: "1a2b3c4d"
    ↓
从数据库查询: SELECT client_id FROM notion_registrations WHERE short_hash='1a2b3c4d'
    ↓
获得 client_id: "abc123xyz"
    ↓
继续 token 交换流程
```

## 完整数据流示例

### 场景：注册两个 Notion 工作区

**工作区 1: "workspace1"**
```
POST /api/notion/register
├─ client_name: "workspace1"
├─ redirect_uri_base: "http://localhost:3002"
└─ ...
    ↓
1. 生成 short_hash: "ws1abcd"
2. redirect_uri: "http://localhost:3002/mcp/oauth/callback/ws1abcd"
3. 发送给 Notion 注册 API
4. 获得 client_id: "client_id_1"
5. 保存到数据库:
   - short_hash: "ws1abcd"
   - client_id: "client_id_1"
   - client_name: "workspace1"
   - redirect_uri: "http://localhost:3002/mcp/oauth/callback/ws1abcd"
6. 返回 short_hash 给前端
```

**工作区 2: "workspace2"**
```
POST /api/notion/register
├─ client_name: "workspace2"
├─ redirect_uri_base: "http://localhost:3002"
└─ ...
    ↓
1. 生成 short_hash: "ws2efgh" (不同的 hash)
2. redirect_uri: "http://localhost:3002/mcp/oauth/callback/ws2efgh"
3. 发送给 Notion 注册 API
4. 获得 client_id: "client_id_2"
5. 保存到数据库:
   - short_hash: "ws2efgh"
   - client_id: "client_id_2"
   - client_name: "workspace2"
   - redirect_uri: "http://localhost:3002/mcp/oauth/callback/ws2efgh"
6. 返回 short_hash 给前端
```

**用户授权工作区 1**
```
Notion OAuth Flow
    ↓ 用户同意授权
    ↓ Notion 回调
GET http://localhost:3002/mcp/oauth/callback/ws1abcd/?code=AUTH_CODE&state=...
    ↓
1. 提取 short_hash: "ws1abcd"
2. 查询数据库: get_notion_registration_by_short_hash("ws1abcd")
3. 获得: client_id="client_id_1", redirect_uri="...ws1abcd"
4. 使用 client_id 和 redirect_uri 交换 token
5. 保存 token 到数据库（关联 client_id_1）
```

**用户授权工作区 2**
```
GET http://localhost:3002/mcp/oauth/callback/ws2efgh/?code=AUTH_CODE&state=...
    ↓
1. 提取 short_hash: "ws2efgh"
2. 查询数据库: get_notion_registration_by_short_hash("ws2efgh")
3. 获得: client_id="client_id_2", redirect_uri="...ws2efgh"
4. 使用 client_id 和 redirect_uri 交换 token
5. 保存 token 到数据库（关联 client_id_2）
```

## 修改的文件列表

| 文件 | 修改内容 | 行数变化 |
|------|--------|--------|
| backend/database.py | 表结构 + 迁移逻辑 | +30 |
| backend/mcp_server/well_known/notion.py | short_hash 函数 + by_short_hash 查询 | +130 |
| backend/app.py | 注册路由 + 回调路由 | +50 |

## 核心优势

✅ **支持多个工作区**: 每个工作区有唯一的 short_hash 和回调地址
✅ **自动路由识别**: 根据 URL 自动识别是哪个工作区
✅ **数据关联清晰**: short_hash ↔ client_id ↔ oauth_tokens
✅ **向后兼容**: 仍支持 Redis-based state 查询方式（作为备选）
✅ **自动重试**: short_hash 冲突时自动重新生成

## 验证状态

```
✓ database.py - 语法检查通过
✓ mcp_server/well_known/notion.py - 语法检查通过
✓ app.py - 语法检查通过
```

## 下一步测试

1. **单元测试**: 测试 generate_short_hash() 生成唯一性
2. **集成测试**: 
   - 注册工作区 1，检查 short_hash 生成
   - 注册工作区 2，检查 short_hash 不同
   - 模拟 Notion 回调，检查正确识别工作区
3. **数据库迁移**: 验证既有表的升级流程
4. **前端集成**: 确保前端正确使用 short_hash

## 日志调试信息

修改包含了详细的日志输出，便于调试：

```
[Notion Register] Generated short_hash: ws1abcd for workspace1
[Notion Register] Short Hash: ws1abcd
[Notion Register] Redirect URI: http://localhost:3002/mcp/oauth/callback/ws1abcd
[Notion Register] ✅ Saved to database: client_id_1 with short_hash: ws1abcd

[OAuth Callback] Short Hash from URL: ws1abcd
[OAuth Callback] Found registration for short_hash ws1abcd: client_id_1
```

