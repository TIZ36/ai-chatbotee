# Notion 数据库表结构对比

## 当前表结构（来自 database.py）

```sql
CREATE TABLE IF NOT EXISTS `notion_registrations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `client_id` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Notion OAuth Client ID',
    `client_name` VARCHAR(255) NOT NULL COMMENT '客户端名称（用户输入）',
    `redirect_uri` TEXT NOT NULL COMMENT '完整回调地址',
    `redirect_uri_base` VARCHAR(500) DEFAULT NULL COMMENT '回调地址基础部分（用户输入）',
    `client_uri` VARCHAR(500) DEFAULT NULL COMMENT '客户端 URI',
    `registration_data` JSON DEFAULT NULL COMMENT '完整注册响应数据',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX `idx_client_id` (`client_id`),
    INDEX `idx_client_name` (`client_name`),
    INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Notion MCP 注册信息表';
```

### 字段分析

| 字段 | 类型 | 说明 | 问题 |
|-----|------|------|------|
| id | INT | 自增主键 | ✓ OK |
| client_id | VARCHAR(255) | OAuth Client ID | ✓ 从 Notion 获取 |
| client_name | VARCHAR(255) | 用户给的名称 | ✓ 用户输入 |
| redirect_uri | TEXT | 完整回调地址 | ❌ **目前固定不动态** |
| redirect_uri_base | VARCHAR(500) | 基础部分 | ✓ 用户输入 |
| client_uri | VARCHAR(500) | 应用 URI | ✓ 用户输入 |
| registration_data | JSON | 完整注册数据 | ✓ 存储原始响应 |
| created_at | DATETIME | 创建时间 | ✓ OK |
| updated_at | DATETIME | 更新时间 | ✓ OK |

---

## 需要添加的字段

### ❌ 缺少的关键字段：`short_hash`

```sql
`short_hash` VARCHAR(8) NOT NULL UNIQUE COMMENT '8位短哈希，用于OAuth回调路由识别'
```

**为什么需要：**
- 用于动态路由 `/mcp/oauth/callback/<short_hash>`
- 唯一标识每个工作区
- 支持多个工作区（目前实现无法支持）

---

## 完整的修复后的表结构

```sql
CREATE TABLE IF NOT EXISTS `notion_registrations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `short_hash` VARCHAR(8) NOT NULL UNIQUE COMMENT '8位短哈希，用于OAuth回调路由识别（必填）',
    `client_id` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Notion OAuth Client ID',
    `client_name` VARCHAR(255) NOT NULL COMMENT '客户端名称（用户输入）',
    `redirect_uri` TEXT NOT NULL COMMENT '完整回调地址（包含short_hash）',
    `redirect_uri_base` VARCHAR(500) DEFAULT NULL COMMENT '回调地址基础部分（用户输入）',
    `client_uri` VARCHAR(500) DEFAULT NULL COMMENT '客户端 URI',
    `registration_data` JSON DEFAULT NULL COMMENT '完整注册响应数据',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX `idx_short_hash` (`short_hash`),
    INDEX `idx_client_id` (`client_id`),
    INDEX `idx_client_name` (`client_name`),
    INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Notion MCP 注册信息表';
```

---

## 数据流对比

### 当前流程（问题）

```
用户注册工作区 "workspace1"
    ↓
fixed redirect_uri: "http://localhost:3002/mcp/oauth/callback/"
    ↓
发送给 Notion 注册 API
    ↓
Notion 保存: redirect_uri = "http://localhost:3002/mcp/oauth/callback/"
    ↓
数据库 notion_registrations:
  client_id: "abc123"
  client_name: "workspace1"
  redirect_uri: "http://localhost:3002/mcp/oauth/callback/"  ❌ 没有区别
  
用户注册工作区 "workspace2"
    ↓
fixed redirect_uri: "http://localhost:3002/mcp/oauth/callback/"  ❌ 相同！
    ↓
发送给 Notion 注册 API
    ↓
Notion 保存: redirect_uri = "http://localhost:3002/mcp/oauth/callback/"
    ↓
数据库 notion_registrations:
  client_id: "def456"
  client_name: "workspace2"
  redirect_uri: "http://localhost:3002/mcp/oauth/callback/"  ❌ 相同！

当用户授权完成，Notion 回调：
    http://localhost:3002/mcp/oauth/callback/?code=...&state=...
    ↓
❌ 后端无法判断是 workspace1 还是 workspace2！
```

### 修复后流程（正确）

```
用户注册工作区 "workspace1"
    ↓
生成 short_hash: "ws1abcd"
    ↓
redirect_uri: "http://localhost:3002/mcp/oauth/callback/ws1abcd"
    ↓
发送给 Notion 注册 API
    ↓
Notion 保存: redirect_uri = "http://localhost:3002/mcp/oauth/callback/ws1abcd"
    ↓
数据库 notion_registrations:
  short_hash: "ws1abcd"           ✓ 唯一
  client_id: "abc123"
  client_name: "workspace1"
  redirect_uri: "...callback/ws1abcd"

用户注册工作区 "workspace2"
    ↓
生成 short_hash: "ws2efgh"
    ↓
redirect_uri: "http://localhost:3002/mcp/oauth/callback/ws2efgh"
    ↓
发送给 Notion 注册 API
    ↓
数据库 notion_registrations:
  short_hash: "ws2efgh"           ✓ 不同
  client_id: "def456"
  client_name: "workspace2"
  redirect_uri: "...callback/ws2efgh"

当用户授权完成，Notion 回调：
    http://localhost:3002/mcp/oauth/callback/ws1abcd/?code=...&state=...
    ↓
✓ 从 URL 提取 short_hash: "ws1abcd"
    ↓
✓ 查询数据库：SELECT client_id FROM notion_registrations WHERE short_hash='ws1abcd'
    ↓
✓ 获得 client_id: "abc123"
    ↓
✓ 正确交换 token
```

---

## 数据库迁移脚本

```sql
-- 为 notion_registrations 表添加 short_hash 列
ALTER TABLE `notion_registrations` 
ADD COLUMN `short_hash` VARCHAR(8) UNIQUE NOT NULL DEFAULT '' COMMENT '8位短哈希，用于OAuth回调路由识别' 
AFTER `id`;

-- 为 short_hash 添加索引
ALTER TABLE `notion_registrations` 
ADD INDEX `idx_short_hash` (`short_hash`);

-- 现有数据迁移（为已有记录生成 short_hash）
-- 需要通过应用代码完成，确保每个 short_hash 唯一
```

---

## 关键表关系

```
notion_registrations
├── id (PK)
├── short_hash (UNIQUE) ← 用于回调路由识别 ✓
├── client_id (UNIQUE)
├── client_name
├── redirect_uri
└── ...

↓ 一对多关系

oauth_tokens
├── id (PK)
├── mcp_url (FK)
├── access_token
├── refresh_token
├── notion_registration_id (FK) ← 关联 notion_registrations.id
└── ...
```

---

## 小结

**当前问题：**
- ❌ 缺少 `short_hash` 字段
- ❌ 所有工作区共享同一个 redirect_uri
- ❌ 无法支持多个 Notion 工作区

**修复方案：**
- ✓ 添加 `short_hash` VARCHAR(8) UNIQUE 字段
- ✓ 注册时生成唯一的 8 位 short_hash
- ✓ 动态构建 redirect_uri: `base + "/mcp/oauth/callback/" + short_hash`
- ✓ 修改回调路由为动态: `/mcp/oauth/callback/<short_hash>`
- ✓ 根据 short_hash 查询 client_id 和其他信息

