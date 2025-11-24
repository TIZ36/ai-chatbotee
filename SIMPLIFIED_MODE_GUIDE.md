# 🚀 简化模式使用指南

## 问题诊断

您遇到的问题：
- 标记不上元素
- 总是说"没有内容"
- 怀疑是动态加载导致的

**根本原因：** CSS 选择器依赖于精确的 HTML 结构，但动态加载的网页可能导致：
1. 标记时看到的元素和实际 HTML 结构不一致
2. 选择器无法匹配到正确的元素
3. BeautifulSoup 解析的静态 HTML 和浏览器渲染的动态内容不同

## 解决方案：简化模式

**简化模式**直接提取每个 Item 的所有文本内容，不依赖复杂的选择器！

### 工作原理

```python
# 后端自动执行：
for item in items:
    # 1. 提取整个 item 的所有文本
    full_text = item.get_text(separator='\n', strip=True)
    
    # 2. 智能分离标题和内容
    lines = [line.strip() for line in full_text.split('\n') if line.strip()]
    
    # 3. 第一行作为标题（如果 < 100 字符）
    title = lines[0] if len(lines[0]) < 100 else ''
    
    # 4. 剩余行作为内容
    content = '\n'.join(lines[1:]) if len(lines) > 1 else full_text
```

### 使用步骤

#### 1. 清空选择器（切换到简化模式）

如果您已经填写了标题或内容选择器，点击**"🚀 切换到简化模式"**按钮。

#### 2. 只标记 Item（数据项）

- 点击 **"标记项"** 按钮
- 在页面中点击包含完整内容的外层容器
- 例如：`<div class="article-item">...</div>`

标记后，您会**立即看到元素预览**：

```
✅ 已标记的选择器

数据项：.v-card [X]

📄 元素文本预览（简化模式将提取这些内容）：     87 字符
┌─────────────────────────────────────────┐
│ 我希望你假定自己是雅思写作考官              │
│ 根据雅思评判标准，按我给你的雅思考题和对   │
│ 应答案给我评分，并且按照雅思...            │
└─────────────────────────────────────────┘
▼ 查看 HTML 结构

🚀 简化模式已启用 - 将自动提取上方预览的完整文本内容
```

#### 3. 查看预览

切换到**"数据项"**标签页，您会看到：

```
Item #1                    [🔍 查看 HTML]
我希望你假定自己是雅思写作考官
根据雅思评判标准，按我给你的雅思考题...

[点击"查看 HTML"展开]
原始 HTML 结构：
<p>我希望你假定自己是雅思写作考官...</p>
```

#### 4. 保存数据

点击**"生成并保存解析数据"**按钮。

### 新功能：元素预览

标记元素后，会在绿色面板中显示：

1. **选择器信息**：生成的 CSS 选择器
2. **文本预览**：提取的完整文本内容（最多显示 500 字符）
3. **字符统计**：显示总字符数
4. **HTML 结构**：可展开查看原始 HTML（最多显示 600 字符）
5. **简化模式状态**：绿色提示表示简化模式已启用

**优势：**
- ✅ 标记前就能看到会提取什么内容
- ✅ 验证选择器是否选中了正确的元素
- ✅ 避免标记后才发现选错了
- ✅ 直观理解简化模式的工作原理

### 预期日志输出

**后端日志：**
```
[Normalizer] Found 123 items using selector '.v-card'
[Normalizer] Selectors - title: '', content: ''
[Normalizer] 🚀 简化模式：没有指定选择器，直接提取纯文本快照
[Normalizer] Item 1: 文本快照 - title_len=15, content_len=87
[Normalizer] Item 2: 文本快照 - title_len=8, content_len=142
...
[Normalizer] ✅ 简化模式完成，提取了 123 个文本快照
```

**前端控制台：**
```
[预览系统] 🚀 使用简化模式（无标题和内容选择器）
[预览系统] 📤 调用 previewNormalize API, 配置: {
  format: "list",
  item_selector: ".v-card",
  title_selector: "",
  content_selector: ""
}
[预览系统] 📥 API 返回结果: { success: true, hasNormalized: true }
[预览系统] ✅ 预览成功，共 123 项
```

### 优势对比

| 特性 | 高级模式（手动选择器） | 简化模式 |
|------|---------------------|----------|
| 配置复杂度 | 需要标记 Item、Title、Content | 只需标记 Item |
| 动态加载兼容性 | ❌ 可能失败 | ✅ 不受影响 |
| 提取准确性 | 依赖选择器准确性 | 提取所有文本 |
| 元素预览 | ✅ 支持 | ✅ 支持 + 完整文本预览 |
| 适用场景 | 结构规整的静态页面 | 任何页面 |

## 故障排查

### 如果还是提取不到内容

1. **检查 Item 选择器是否正确：**
   ```bash
   # 后端日志应该显示：
   [Normalizer] Found 123 items using selector '.your-selector'
   ```
   如果显示 `Found 0 items`，说明 Item 选择器不匹配。

2. **查看原始 HTML：**
   在预览中点击 **"🔍 查看 HTML"**，检查每个 item 的实际 HTML 结构。

3. **尝试更宽泛的选择器：**
   - ❌ `.article > .content > .text`（太具体）
   - ✅ `.article`（更宽泛）

4. **使用浏览器开发者工具：**
   - 右键点击元素 → 检查
   - 查看元素的 class 和 id
   - 确认选择器能匹配到元素

## 技术细节

### 后端实现

位置：`backend/crawler_normalizer.py`

```python
# 检测到简化模式
if not title_selector and not content_selector:
    for item_elem in item_elements:
        # 提取所有文本
        full_text = item_elem.get_text(separator='\n', strip=True)
        
        # 保存文本快照
        items.append({
            'title': smart_extract_title(full_text),
            'content': full_text,
            'text': full_text,  # 完整文本
            'html': str(item_elem)  # 原始 HTML
        })
```

### 前端触发

位置：`src/components/CrawlerTestPage.tsx`

```typescript
// 显式传递空字符串以触发简化模式
if (!finalTitleSelector && !finalContentSelector) {
  normalizeConfig.title_selector = '';
  normalizeConfig.content_selector = '';
  console.log('[预览系统] 🚀 使用简化模式');
}
```

## 下一步

重启应用后，您应该能够：
1. ✅ 看到绿色的"已启用"标签（表示简化模式生效）
2. ✅ 只需标记 Item，无需标记标题和内容
3. ✅ 在预览中看到提取的完整文本
4. ✅ 成功保存数据到数据库

如果还有问题，检查后端日志是否显示：
```
[Normalizer] 🚀 简化模式：没有指定选择器，直接提取纯文本快照
```

如果没有看到这条日志，说明选择器传递有问题，请查看前端控制台日志。
