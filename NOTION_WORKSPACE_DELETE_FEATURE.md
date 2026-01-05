# Notion 工作空间删除功能实现

## 概述

为 Notion MCP 工作空间管理添加了删除功能，用户现在可以删除不需要的工作空间注册。

## 实现细节

### 后端修改

#### 1. 新增删除 API (backend/app.py)

**DELETE /api/notion/registrations/<registration_id>**

```python
@app.route('/api/notion/registrations/<int:registration_id>', methods=['DELETE', 'OPTIONS'])
def delete_notion_registration(registration_id: int):
    """删除指定的 Notion 工作空间注册"""
```

**功能：**
1. 从数据库删除 `notion_registrations` 记录
2. 清理 Redis 中的相关 token：`notion_token:{short_hash}`
3. 返回成功消息

**返回示例：**
```json
{
  "success": true,
  "message": "Registration \"workspace-prod\" deleted successfully"
}
```

### 前端修改

#### 1. API 调用函数 (front/src/services/mcpApi.ts)

```typescript
export async function deleteNotionRegistration(registrationId: number): Promise<{
  success: boolean;
  message: string;
}>
```

#### 2. UI 更新 (front/src/components/MCPConfig.tsx)

**新增删除处理函数：**
```typescript
const handleDeleteNotionRegistration = async (registration: NotionRegistration, event: React.MouseEvent) => {
  // 确认对话框
  // 调用删除 API
  // 刷新工作空间列表
  // 显示 toast 提示
}
```

**UI 改进：**
- ✅ 每个工作空间卡片右侧添加删除按钮（垃圾桶图标）
- ✅ 删除按钮仅在 hover 时显示（opacity-0 → opacity-100）
- ✅ 删除按钮点击时阻止事件冒泡（不会触发连接操作）
- ✅ 删除前显示确认对话框
- ✅ 删除后显示成功/失败 toast 提示
- ✅ Notion 图标已修复为 stroke 模式（之前的修复保留）

**工作空间卡片布局：**
```
┌────────────────────────────────────────────────┐
│ [Notion图标]  工作空间名称        [连接] [删除] │
│               ID: xxxxx...                     │
└────────────────────────────────────────────────┘
```

## 使用流程

1. **打开 Notion 连接**
   - 点击 "连接 Notion"
   - 显示已注册工作空间列表

2. **删除工作空间**
   - Hover 到工作空间卡片
   - 点击右侧红色垃圾桶图标
   - 确认删除操作
   - 工作空间从列表中移除

3. **清理效果**
   - 数据库记录已删除
   - Redis token 已清除
   - UI 列表已刷新

## 数据清理

删除工作空间时会清理：

1. **数据库**：`notion_registrations` 表中的记录
2. **Redis**：`notion_token:{short_hash}` 键值对
3. **前端状态**：重新加载工作空间列表

## 安全性

- ✅ 删除前显示确认对话框
- ✅ 仅删除指定 ID 的记录
- ✅ 事件冒泡已阻止，防止误操作
- ✅ 错误处理：显示友好的错误提示

## 测试建议

1. **删除单个工作空间**
   - 注册一个工作空间
   - 打开工作空间列表
   - 删除该工作空间
   - 验证列表已更新

2. **删除多个工作空间**
   - 注册多个工作空间
   - 逐一删除
   - 验证每次删除后列表正确更新

3. **验证数据清理**
   - 删除工作空间后
   - 检查数据库：`SELECT * FROM notion_registrations WHERE id = ?`
   - 检查 Redis：`GET notion_token:{short_hash}`
   - 确认两者都已删除

4. **错误处理测试**
   - 尝试删除不存在的 ID（应返回 404）
   - 网络错误时的提示

## 相关文件

- `backend/app.py` - 删除 API 实现
- `front/src/services/mcpApi.ts` - 删除 API 调用
- `front/src/components/MCPConfig.tsx` - UI 和交互逻辑

---

**修改日期**：2026-01-05  
**功能**：Notion 工作空间删除  
**涉及文件**：3 个主要文件  
**状态**：✅ 已实现并准备测试
