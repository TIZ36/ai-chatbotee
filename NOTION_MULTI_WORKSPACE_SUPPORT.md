# Notion MCP 多工作空间支持实现

## 概述

实现了 Notion MCP 的多工作空间支持机制，用户现在可以连接多个 Notion 工作空间。每个工作空间通过唯一的别名和 8 位短 hash 进行识别，支持动态回调地址和独立的 Redis token 缓存。

## 核心设计

### 1. 工作空间别名和短Hash

- **Workspace Alias**: 用户在注册时输入的工作空间别名，全局唯一（仅英文、数字、下划线、连字符）
- **Short Hash**: 基于 workspace_alias 生成的 8 位 SHA256 哈希，用于：
  - 动态构建回调地址的路由参数
  - Redis 缓存的键前缀，区分不同工作空间的 token
  - 在数据库中作为唯一索引

### 2. 数据库表结构修改

#### notion_registrations 表新增字段

```sql
ALTER TABLE `notion_registrations` ADD COLUMN (
  `workspace_alias` VARCHAR(255) DEFAULT NULL COMMENT 'Notion工作空间别名（全局唯一）',
  `short_hash` VARCHAR(8) DEFAULT NULL COMMENT '8位短hash，用于动态回调地址和redis缓存前缀'
);

-- 添加唯一索引
CREATE UNIQUE INDEX `idx_workspace_alias` ON `notion_registrations`(`workspace_alias`);
CREATE UNIQUE INDEX `idx_short_hash` ON `notion_registrations`(`short_hash`);
```

### 3. 动态回调地址

**旧方式**（固定回调地址，无法区分多工作空间）：
```
http://localhost:3001/mcp/oauth/callback/
```

**新方式**（包含short_hash的动态回调地址）：
```
http://localhost:3001/mcp/oauth/callback/{short_hash}/
```

示例：
```
http://localhost:3001/mcp/oauth/callback/a1b2c3d4/
http://localhost:3001/mcp/oauth/callback/e5f6g7h8/
```

### 4. Redis 缓存前缀

Token 保存到 Redis 时使用 short_hash 作为前缀：

```
notion_token:{short_hash}
```

例如：
```
notion_token:a1b2c3d4  → 工作空间1的token
notion_token:e5f6g7h8  → 工作空间2的token
```

## 实现细节

### 后端修改

#### 1. 工具函数 (backend/mcp_server/well_known/notion.py)

**生成短hash**
```python
def generate_short_hash(workspace_alias: str) -> str:
    """基于workspace_alias生成8位短hash"""
    hash_bytes = hashlib.sha256(workspace_alias.encode('utf-8')).digest()
    return hash_bytes.hex()[:8].lower()
```

**验证workspace_alias唯一性**
```python
def check_workspace_alias_unique(workspace_alias: str, exclude_client_id: Optional[str] = None) -> bool:
    """检查workspace_alias是否全局唯一"""
```

**Token读取和保存（按short_hash）**
```python
def get_notion_token_by_short_hash(short_hash: str) -> Optional[Dict[str, Any]]:
    """根据short_hash从Redis读取Notion token信息"""

def save_notion_token_by_short_hash(short_hash: str, token_info: Dict[str, Any], ttl: int = 86400 * 30) -> bool:
    """根据short_hash保存Notion token到Redis"""
```

#### 2. 注册流程修改 (backend/app.py)

**POST /api/notion/register** 端点修改：

1. **新增workspace_alias参数**
   - 验证格式（仅英文、数字、下划线、连字符）
   - 验证全局唯一性

2. **生成short_hash**
   ```python
   from mcp_server.well_known.notion import generate_short_hash
   short_hash = generate_short_hash(workspace_alias)
   ```

3. **构建动态redirect_uri**
   ```python
   redirect_uri = f"{redirect_uri_base.rstrip('/')}/mcp/oauth/callback/{short_hash}/"
   ```

4. **保存到数据库**
   ```sql
   INSERT INTO notion_registrations (
       client_id, client_name, workspace_alias, short_hash, 
       redirect_uri, redirect_uri_base, client_uri, registration_data
   ) VALUES (...)
   ```

#### 3. OAuth 回调路由

**新增动态路由**：
```python
@app.route('/mcp/oauth/callback/<short_hash>', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/mcp/oauth/callback/<short_hash>/', methods=['GET', 'POST', 'OPTIONS'])
def mcp_oauth_callback_with_hash(short_hash: str):
    """处理包含short_hash的OAuth回调"""
```

**处理流程**：
1. 从 URL 参数提取 code 和 state
2. 根据 short_hash 从数据库查询 Notion 注册信息
3. 从 Redis 读取 OAuth 配置（使用 state 作为 key）
4. 交换 token（调用 Notion API）
5. **使用short_hash作为前缀保存token到Redis**
   ```python
   redis_cache_key = f"notion_token:{short_hash}"
   redis_client.setex(redis_cache_key, 86400 * 30, json.dumps(token_info))
   ```
6. 返回成功页面（显示工作空间别名、short_hash 等信息）

### 前端修改

#### 1. API 更新 (front/src/services/mcpApi.ts)

```typescript
export async function registerNotionClient(params: {
  client_name: string;
  workspace_alias: string;        // 新增
  redirect_uri_base?: string;
  client_uri?: string;
}): Promise<{
  success: boolean;
  client_id: string;
  client_name: string;
  workspace_alias: string;        // 新增
  short_hash: string;              // 新增
  redirect_uri: string;
  registration_data: any;
}>
```

#### 2. 注册表单修改 (front/src/components/MCPConfig.tsx)

**表单状态**：
```typescript
const [registrationFormData, setRegistrationFormData] = useState({
  client_name: '',
  workspace_alias: '',              // 新增
  redirect_uri_base: getBackendUrl(),
});
```

**表单验证**：
- client_name：英文、数字、下划线、连字符
- workspace_alias：英文、数字、下划线、连字符，全局唯一（由后端验证）

**表单输入框**：
```tsx
<InputField
  label="Workspace Alias (工作空间别名)"
  value={registrationFormData.workspace_alias}
  onChange={(e) => setRegistrationFormData({ ...registrationFormData, workspace_alias: e.target.value })}
  placeholder="例如: workspace-1"
  required
  description="全局唯一标识，用于区分不同的Notion工作空间。只能包含英文、数字、下划线和连字符。"
/>
```

## 使用流程

### 用户场景：连接多个 Notion 工作空间

1. **第一个工作空间**
   - 输入：Client Name = `my-app`, Workspace Alias = `workspace-prod`
   - 生成：Short Hash = `a1b2c3d4`
   - 回调：`http://localhost:3001/mcp/oauth/callback/a1b2c3d4/`
   - Token 存储：`notion_token:a1b2c3d4`

2. **第二个工作空间**
   - 输入：Client Name = `my-app`, Workspace Alias = `workspace-dev`
   - 生成：Short Hash = `e5f6g7h8`
   - 回调：`http://localhost:3001/mcp/oauth/callback/e5f6g7h8/`
   - Token 存储：`notion_token:e5f6g7h8`

3. **后续 Token 刷新**
   - 根据 short_hash 从 Redis 读取相应工作空间的 token
   - 各工作空间的 token 独立刷新，互不影响

## 向后兼容性

- 旧的固定回调地址 `/mcp/oauth/callback/` 仍然有效
- 如果没有 short_hash，使用 client_id 从 Redis 查询 OAuth 配置
- 现有的 token 存储方式（基于 mcp_url 或 client_id）保持不变

## 错误处理

### 常见错误和解决

1. **workspace_alias已被使用**
   ```
   400 Bad Request
   {
     "error": "workspace_alias \"workspace-1\" 已被使用，请使用其他别名"
   }
   ```

2. **短hash唯一性冲突**
   - 数据库索引保证短hash唯一
   - 极低概率冲突（8位hex = 4,294,967,296 种组合）

3. **Redis token过期**
   - 30天过期时间
   - 过期时自动触发刷新流程

## 测试建议

1. **单工作空间注册**
   ```bash
   POST /api/notion/register
   {
     "client_name": "test-app",
     "workspace_alias": "test-workspace",
     "redirect_uri_base": "http://localhost:3001"
   }
   ```

2. **多工作空间注册**
   - 重复上述步骤，使用不同的 workspace_alias
   - 验证短hash不重复
   - 验证回调地址不同

3. **Token 隔离测试**
   - 为每个工作空间生成 token
   - 验证 Redis 中的 keys：`notion_token:*`
   - 确保各工作空间 token 独立存储

4. **回调处理测试**
   - 验证不同的回调地址能正确路由
   - 验证 OAuth 流程完成后 token 保存到正确的 Redis key

## 相关文件清单

### 后端文件

- `backend/database.py` - notion_registrations 表定义
- `backend/mcp_server/well_known/notion.py` - 核心函数实现
- `backend/mcp_server/well_known/__init__.py` - 导出新函数
- `backend/app.py` - 注册端点和回调路由修改

### 前端文件

- `front/src/services/mcpApi.ts` - registerNotionClient API 更新
- `front/src/components/MCPConfig.tsx` - 注册表单 UI 和逻辑

## 总结

该实现完全支持多 Notion 工作空间的连接，通过以下机制实现隔离：

1. ✅ **唯一标识**：workspace_alias + short_hash
2. ✅ **动态回调**：基于短hash的动态路由
3. ✅ **独立缓存**：基于short_hash的Redis前缀
4. ✅ **数据库支持**：添加必要的字段和索引
5. ✅ **用户体验**：简洁的注册表单，清晰的输入提示
