# 剩余问题修复总结

## ✅ 已完成

### 1. 修复爬虫列表显示批次数和数据条数
- **文件**: `backend/app.py`
- **修改**: 第6698-6728行
- **状态**: ✅ 完成，已从 `parsed_data` 字段正确读取数据条数

---

## 🚧 需要继续修复

### 2. 修复/弹出框位置：紧跟光标且从下往上布局

**问题描述**:
- 当前弹出框距离输入光标较远
- 需要紧贴光标并向上扩展

**修复方案**:

1. 修改 `CrawlerModuleSelector.tsx` 组件，支持 `bottom` 定位：

```typescript
// 在 style 中添加条件判断
style={{
  ...((position as any).bottom !== undefined ? {
    bottom: `${(position as any).bottom}px`
  } : {
    top: `${position.top}px`
  }),
  left: `${position.left}px`,
  maxHeight: `${position.maxHeight || 256}px`,
}}
```

2. 修改 `Workflow.tsx` 中的位置计算（约第1640行）：

```typescript
// 使用 bottom 定位而不是 top
const bottom = window.innerHeight - cursorY + 5;
const actualMaxHeight = Math.min(300, cursorY - 20);

setModuleSelectorPosition({
  bottom,
  left,
  maxHeight: actualMaxHeight
} as any);
```

### 3. 弹出框在点击外部/按ESC/删除/后消失

**需要添加三个关闭逻辑**:

#### 3.1 点击外部关闭

在 `Workflow.tsx` 添加：

```typescript
// 添加到组件中
useEffect(() => {
  if (!showModuleSelector) return;
  
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // 检查是否点击了选择器外部
    if (!target.closest('.at-selector-container') && 
        !target.closest('textarea')) {
      setShowModuleSelector(false);
      setModuleSelectorIndex(-1);
      setModuleSelectorQuery('');
    }
  };
  
  // 延迟添加监听器，避免立即触发
  const timer = setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutside);
  }, 100);
  
  return () => {
    clearTimeout(timer);
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, [showModuleSelector]);
```

#### 3.2 按 ESC 关闭

已在 `CrawlerModuleSelector.tsx` 中实现（第103-106行）

#### 3.3 删除 / 后关闭

在 `Workflow.tsx` 的 `handleInputChange` 函数中添加：

```typescript
// 检查 / 是否被删除
if (moduleSelectorIndex !== -1) {
  const textBeforeCursor = value.substring(0, cursorPosition);
  const textFromSlash = textBeforeCursor.substring(moduleSelectorIndex);
  
  // 如果 / 被删除了，关闭选择器
  if (!textFromSlash.startsWith('/')) {
    setShowModuleSelector(false);
    setModuleSelectorIndex(-1);
    setModuleSelectorQuery('');
    return;
  }
}
```

### 4. 批次数据列表支持模糊搜索

**文件**: `src/components/CrawlerBatchItemSelector.tsx`

**需要添加**:

1. 搜索状态和UI：

```typescript
const [searchQuery, setSearchQuery] = useState('');

// 过滤逻辑
const filteredItems = items.filter(item => {
  if (!searchQuery) return true;
  const query = searchQuery.toLowerCase();
  const title = (item.title || '').toLowerCase();
  const content = (item.content || '').toLowerCase();
  return title.includes(query) || content.includes(query);
});

// 在组件头部添加搜索框
<div className="p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
  <input
    type="text"
    placeholder="🔍 搜索标题或内容..."
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
    autoFocus
  />
  {searchQuery && (
    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
      找到 {filteredItems.length} / {items.length} 条数据
    </div>
  )}
</div>
```

2. 更新渲染逻辑使用 `filteredItems`

3. 添加高亮匹配文本的函数：

```typescript
const highlightMatch = (text: string, query: string) => {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query})`, 'gi'));
  return parts.map((part, i) => 
    part.toLowerCase() === query.toLowerCase() 
      ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800">{part}</mark>
      : part
  );
};
```

### 5. 选定批次数据作为系统提示词发送给AI

**文件**: `src/components/Workflow.tsx`

**需要修改**:

1. 添加状态管理：

```typescript
const [systemPromptData, setSystemPromptData] = useState<{
  batchName: string;
  title: string;
  content: string;
} | null>(null);
```

2. 修改 `handleBatchItemSelect` 函数：

```typescript
const handleBatchItemSelect = (item: any, batchName: string) => {
  // 保存到系统提示词状态
  setSystemPromptData({
    batchName,
    title: item.title || '',
    content: item.content || ''
  });
  
  // 在输入框中显示引用标记
  const referenceText = `[📊 数据: ${item.title || '无标题'}]`;
  const newValue = input.substring(0, moduleSelectorIndex) + referenceText + input.substring(input.length);
  setInput(newValue);
  
  // 关闭选择器
  setShowBatchItemSelector(false);
  setShowModuleSelector(false);
  setModuleSelectorIndex(-1);
  
  // 聚焦输入框
  if (inputRef.current) {
    inputRef.current.focus();
    const newCursorPos = moduleSelectorIndex + referenceText.length;
    inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
  }
};
```

3. 修改 `sendChatMessage` 函数，在发送时包含系统提示词：

```typescript
const sendChatMessage = async () => {
  if (!input.trim() && !imageInput) {
    return;
  }

  const userMessage = input.trim();
  
  // 构建消息
  const messages = [];
  
  // 如果有系统提示词数据，添加到messages
  if (systemPromptData) {
    messages.push({
      role: 'system',
      content: `# 参考数据

来源批次：${systemPromptData.batchName}

标题：${systemPromptData.title}

内容：
${systemPromptData.content}

---
请基于以上参考数据回答用户的问题。`
    });
  }
  
  // 添加用户消息
  messages.push({
    role: 'user',
    content: userMessage
  });
  
  // ... 其余发送逻辑
  
  // 发送后清除系统提示词
  setSystemPromptData(null);
};
```

4. 在输入框附近添加系统提示词显示：

```typescript
{systemPromptData && (
  <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded flex items-start space-x-2">
    <div className="text-blue-600 dark:text-blue-400">📊</div>
    <div className="flex-1 text-sm">
      <div className="font-medium text-blue-900 dark:text-blue-100">
        携带参考数据: {systemPromptData.title}
      </div>
      <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
        来自批次: {systemPromptData.batchName}
      </div>
    </div>
    <button
      onClick={() => setSystemPromptData(null)}
      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
)}
```

---

## 🎯 修复顺序建议

1. ✅ **批次数和数据条数显示** - 已完成
2. 🔴 **删除/后关闭** - 最简单，先修复
3. 🔴 **点击外部关闭** - 基本交互
4. 🟡 **弹出框位置** - 需要测试
5. 🟡 **模糊搜索** - 独立功能
6. 🟡 **系统提示词** - 复杂但重要

---

## ⚠️ 注意事项

1. 修改 `CrawlerModuleSelector.tsx` 时要同时修改 `CrawlerBatchItemSelector.tsx` 保持一致
2. 测试时注意不同屏幕尺寸下的弹出框位置
3. 系统提示词功能需要确保在发送完成后清除状态
4. 模糊搜索要处理好中文输入和大小写

---

## 📝 测试清单

- [ ] 爬虫列表正确显示批次数
- [ ] 爬虫列表正确显示数据条数
- [ ] 弹出框紧贴输入光标
- [ ] 弹出框从下往上扩展
- [ ] 点击外部关闭弹出框
- [ ] 按ESC关闭弹出框
- [ ] 删除/后关闭弹出框
- [ ] 批次数据搜索功能正常
- [ ] 搜索结果高亮显示
- [ ] 选中数据后显示引用标记
- [ ] AI收到系统提示词
- [ ] 发送后清除系统提示词状态
