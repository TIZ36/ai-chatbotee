# 弹出框问题修复方案

## 已完成修复

### ✅ 1. 修复爬虫列表显示批次数和数据条数

**问题**: 显示的批次数量和数据条数不准确

**修复**: `backend/app.py` - `/api/crawler/modules/search` 接口
- 优先从数据库 `parsed_data` 字段读取数据条数
- 如果 `parsed_data` 为空，再从 Redis 缓存读取
- 正确计算 JSON 数组长度

```python
# 优先从parsed_data字段获取数据条数
cursor.execute("SELECT parsed_data FROM crawler_batches WHERE batch_id = %s", (batch['batch_id'],))
batch_data = cursor.fetchone()
if batch_data and batch_data.get('parsed_data'):
    parsed_data = batch_data['parsed_data']
    if isinstance(parsed_data, str):
        parsed_data = json.loads(parsed_data)
    if isinstance(parsed_data, list):
        item_count = len(parsed_data)
```

---

## 待修复问题

### 2. 修复/弹出框位置：紧跟光标且从下往上布局

**当前问题**:
- 弹出框距离输入光标很远
- 应该紧贴光标下方，向上扩展

**修复位置**: `src/components/Workflow.tsx`

**修复方案**:
```typescript
// 当前计算方式（有问题）：
setModuleSelectorPosition({
  top: cursorY - actualMaxHeight,  // 从光标上方固定距离
  left,
  maxHeight: actualMaxHeight
});

// 应改为（从光标位置向上扩展）：
setModuleSelectorPosition({
  bottom: window.innerHeight - cursorY + 5,  // 紧贴光标，5px间距
  left,
  maxHeight: Math.min(256, cursorY - 20)  // 向上最多到屏幕顶部
});
```

**CrawlerModuleSelector组件也需要修改**:
```typescript
// 支持 bottom 定位
style={{
  bottom: position.bottom !== undefined ? `${position.bottom}px` : undefined,
  top: position.bottom === undefined ? `${position.top}px` : undefined,
  left: `${position.left}px`,
  maxHeight: `${position.maxHeight}px`,
}}
```

### 3. 弹出框在点击外部/按ESC/删除/后消失

**需要添加的关闭逻辑**:

1. **点击外部关闭**: 使用 `useEffect` + 全局点击事件监听器
2. **按 ESC 关闭**: 已实现（在组件的 onKeyDown 中）
3. **删除 / 后关闭**: 在 `handleInputChange` 中检测

```typescript
// 在 Workflow.tsx 中添加
useEffect(() => {
  if (!showModuleSelector) return;
  
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.at-selector-container')) {
      setShowModuleSelector(false);
    }
  };
  
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [showModuleSelector]);

// 在 handleInputChange 中添加
if (moduleSelectorIndex !== -1) {
  const textBeforeCursor = value.substring(0, cursorPosition);
  const textFromSlash = textBeforeCursor.substring(moduleSelectorIndex);
  
  // 如果 / 被删除了，关闭选择器
  if (!textFromSlash.startsWith('/')) {
    setShowModuleSelector(false);
    setModuleSelectorIndex(-1);
    return;
  }
}
```

### 4. 批次数据列表支持模糊搜索

**修复位置**: `src/components/CrawlerBatchItemSelector.tsx`

**需要添加**:
1. 搜索输入框
2. 过滤逻辑（根据 title 和 content 搜索）
3. 高亮匹配文本

```typescript
const [searchQuery, setSearchQuery] = useState('');

const filteredItems = items.filter(item => {
  if (!searchQuery) return true;
  const query = searchQuery.toLowerCase();
  const title = item.title?.toLowerCase() || '';
  const content = item.content?.toLowerCase() || '';
  return title.includes(query) || content.includes(query);
});

// UI添加搜索框
<div className="p-2 border-b">
  <input
    type="text"
    placeholder="搜索数据..."
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    className="input-field text-sm"
  />
</div>
```

### 5. 选定批次数据作为系统提示词发送给AI

**修复位置**: `src/components/Workflow.tsx`

**需要修改**:
1. `handleBatchItemSelect` 函数 - 将选中的数据添加到系统提示词
2. `sendChatMessage` 函数 - 发送时包含系统提示词

```typescript
// 添加状态
const [systemPromptData, setSystemPromptData] = useState<{
  title: string;
  content: string;
} | null>(null);

// 在 handleBatchItemSelect 中设置
const handleBatchItemSelect = (item: any, batchName: string) => {
  setSystemPromptData({
    title: item.title || '',
    content: item.content || ''
  });
  
  // 在输入框中显示引用
  const newValue = input.replace(/\/模块.*$/, `[数据: ${item.title}]`);
  setInput(newValue);
  
  setShowBatchItemSelector(false);
};

// 在 sendChatMessage 中包含系统提示词
const messages = [{
  role: 'system',
  content: systemPromptData 
    ? `参考数据：\n标题：${systemPromptData.title}\n内容：${systemPromptData.content}`
    : ''
}, {
  role: 'user',
  content: userMessage
}];
```

## 修复优先级

1. ✅ **批次数和数据条数显示** - 已完成
2. 🔴 **弹出框位置** - 高优先级（影响用户体验）
3. 🔴 **弹出框关闭逻辑** - 高优先级（基本交互）
4. 🟡 **模糊搜索** - 中优先级（提升效率）
5. 🟡 **系统提示词** - 中优先级（核心功能）
