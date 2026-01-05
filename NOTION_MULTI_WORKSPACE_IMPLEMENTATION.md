# Notion MCP 多工作空间支持 - 修改汇总

## 🎯 实现目标

✅ 用户连接 Notion 时需传递工作区别名（全局唯一）  
✅ 基于别名生成 8 位短 hash 记录到数据库  
✅ 动态回调地址：host + 固定 path + 短 hash  
✅ 多个 Notion 工作空间的 token 独立缓存到 Redis（使用 short_hash 前缀）  

---

## 📝 修改清单

### 后端修改

#### 1. **backend/database.py**
- 为 `notion_registrations` 表添加两个新字段：
  - `workspace_alias VARCHAR(255)` - Notion 工作空间别名（全局唯一）
  - `short_hash VARCHAR(8)` - 8 位短 hash（唯一索引）

#### 2. **backend/mcp_server/well_known/notion.py**
新增 4 个核心函数：

**生成短 hash**
```python
def generate_short_hash(workspace_alias: str) -> str
    # SHA256(workspace_alias).hex()[:8]
```

**验证别名唯一性**
```python
def check_workspace_alias_unique(workspace_alias: str, exclude_client_id: Optional[str] = None) -> bool
```

**按 short_hash 读取 token**
```python
def get_notion_token_by_short_hash(short_hash: str) -> Optional[Dict[str, Any]]
    # Redis key: notion_token:{short_hash}
```

**按 short_hash 保存 token**
```python
def save_notion_token_by_short_hash(short_hash: str, token_info: Dict[str, Any], ttl: int = 86400 * 30) -> bool
```

#### 3. **backend/mcp_server/well_known/__init__.py**
导出上述 4 个新函数

#### 4. **backend/app.py**
修改内容：

**修改 POST /api/notion/register 端点：**
- ✅ 新增 `workspace_alias` 参数（必需）
- ✅ 验证 workspace_alias 格式（仅英文、数字、下划线、连字符）
- ✅ 验证 workspace_alias 全局唯一性
- ✅ 生成 8 位短 hash
- ✅ 构建动态 redirect_uri：`{base}/mcp/oauth/callback/{short_hash}/`
- ✅ 保存 workspace_alias 和 short_hash 到数据库
- ✅ 返回 short_hash 给前端

**新增 POST /mcp/oauth/callback/<short_hash> 路由（核心创新）：**
- 从 URL 参数提取 code 和 state
- 根据 short_hash 从数据库查询 Notion 注册信息
- 从 Redis 获取 OAuth 配置（使用 state）
- 交换 OAuth token
- ✅ **使用 short_hash 保存 token 到 Redis**：`notion_token:{short_hash}`
- 返回成功页面（显示工作空间信息）

---

### 前端修改

#### 1. **front/src/services/mcpApi.ts**
修改 `registerNotionClient` 函数：
- ✅ 新增 `workspace_alias` 参数
- ✅ 返回值新增 `workspace_alias` 和 `short_hash` 字段

#### 2. **front/src/components/MCPConfig.tsx**
修改 Notion 注册表单：

**表单状态**
```typescript
const [registrationFormData, setRegistrationFormData] = useState({
  client_name: '',
  workspace_alias: '',              // ✨ 新增
  redirect_uri_base: getBackendUrl(),
});
```

**表单验证**
- ✅ client_name 验证（原有）
- ✅ workspace_alias 验证（新增）：格式 + 长度

**表单 UI**
- ✅ 新增 workspace_alias 输入框
- ✅ 添加帮助文本：说明全局唯一、用途、格式要求
- ✅ 更新注册按钮 disabled 条件（需要两个字段都填写）

**处理逻辑**
- ✅ 修改 `handleRegisterNotion` 函数，调用 API 时传递 workspace_alias
- ✅ 提示用户检查返回的 short_hash 和动态回调地址

---

## 🔄 工作流程演示

### 用户场景：连接两个 Notion 工作空间

**工作空间 1：生产环境**
```
用户输入：
  Client Name: my-app
  Workspace Alias: workspace-prod

系统生成：
  Short Hash: a1b2c3d4
  Redirect URI: http://localhost:3001/mcp/oauth/callback/a1b2c3d4/
  
后端处理：
  1. 注册 Notion OAuth 应用，redirect_uri = "...a1b2c3d4/"
  2. 数据库保存：workspace_alias=workspace-prod, short_hash=a1b2c3d4
  3. 用户授权后，token 保存到 Redis: notion_token:a1b2c3d4
```

**工作空间 2：开发环境**
```
用户输入：
  Client Name: my-app
  Workspace Alias: workspace-dev

系统生成：
  Short Hash: e5f6g7h8
  Redirect URI: http://localhost:3001/mcp/oauth/callback/e5f6g7h8/
  
后端处理：
  1. 注册 Notion OAuth 应用，redirect_uri = "...e5f6g7h8/"
  2. 数据库保存：workspace_alias=workspace-dev, short_hash=e5f6g7h8
  3. 用户授权后，token 保存到 Redis: notion_token:e5f6g7h8
```

**后续 API 调用**
```
调用 Notion API for workspace-prod:
  ↓ 根据 short_hash 读取 token
  ↓ 从 Redis 获取 notion_token:a1b2c3d4
  ↓ 使用该 token 调用 Notion API
  
调用 Notion API for workspace-dev:
  ↓ 根据 short_hash 读取 token
  ↓ 从 Redis 获取 notion_token:e5f6g7h8
  ↓ 使用该 token 调用 Notion API
```

---

## 📊 关键数据结构

### 数据库

```sql
notion_registrations 表：
┌─────────────┬─────────────────────┬────────────┐
│ client_id   │ workspace_alias      │ short_hash │
├─────────────┼─────────────────────┼────────────┤
│ notN_xxxxx1 │ workspace-prod       │ a1b2c3d4   │
│ notN_xxxxx2 │ workspace-dev        │ e5f6g7h8   │
│ notN_xxxxx3 │ workspace-staging    │ f9a0b1c2   │
└─────────────┴─────────────────────┴────────────┘
```

### Redis

```
notion_token:a1b2c3d4 = {
  "client_id": "notN_xxxxx1",
  "workspace_alias": "workspace-prod",
  "access_token": "...",
  "refresh_token": "...",
  "workspace_id": "aaa111bbb222",
  "workspace_name": "My Production Workspace",
  ...
}

notion_token:e5f6g7h8 = {
  "client_id": "notN_xxxxx2",
  "workspace_alias": "workspace-dev",
  "access_token": "...",
  "refresh_token": "...",
  "workspace_id": "xxx999yyy888",
  "workspace_name": "My Dev Workspace",
  ...
}
```

---

## 🛡️ 安全性和唯一性

### Workspace Alias 唯一性保证
- 数据库唯一约束：`UNIQUE INDEX idx_workspace_alias`
- 后端验证：`check_workspace_alias_unique()` 函数

### Short Hash 唯一性保证
- 数据库唯一约束：`UNIQUE INDEX idx_short_hash`
- 基于 SHA256，8 位 hex = 4,294,967,296 种组合
- 极低碰撞概率（4 个字节 = ~32 位熵）

### Token 隔离
- 每个工作空间的 token 独立存储在 Redis
- 使用 short_hash 作为前缀，彼此不会覆盖
- 30 天自动过期（可配置）

---

## ✅ 验证清单

在部署前，请验证以下要点：

- [ ] 数据库迁移已应用（新字段 + 索引）
- [ ] 后端服务重启后能正确处理新路由
- [ ] 前端表单正确显示 workspace_alias 输入框
- [ ] 注册流程能生成并返回 short_hash
- [ ] OAuth 回调能正确路由到 `/mcp/oauth/callback/{short_hash}/`
- [ ] Token 正确保存到 Redis：`notion_token:{short_hash}`
- [ ] 支持同时连接多个工作空间
- [ ] 各工作空间的 token 完全隔离

---

## 🔗 相关文档

- [Notion MCP 多工作空间支持 - 完整设计](./NOTION_MULTI_WORKSPACE_SUPPORT.md)
- [Notion MCP 流程梳理](./NOTION_MCP_FLOW.md)
- [Notion 数据库结构](./NOTION_DB_STRUCTURE.md)

---

## 📈 后续扩展建议

1. **Web UI 增强**
   - 显示已连接的工作空间列表
   - 支持删除/更新工作空间配置
   - 显示 token 过期倒计时

2. **监控和日志**
   - 记录每个工作空间的 API 调用统计
   - 记录 token 刷新事件
   - 添加告警：token 刷新失败时通知用户

3. **批量操作**
   - 支持批量同步多个工作空间的数据
   - 支持工作空间间的数据迁移

4. **权限控制**
   - 支持为不同工作空间设置不同的权限
   - 支持工作空间级别的访问控制

---

**修改日期**：2026-01-05  
**相关 Issue**：Notion MCP 多工作空间支持  
**涉及文件**：6 个  
**代码行数变化**：+1093, -760 (净增 333 行)
