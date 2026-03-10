# 外部作图Prompt API 接入方案

## 📋 现状分析

### 当前架构
**文件**: `/front/src/components/MediaCreatorPage.tsx`

**现有预设**:
- **静态预设** (hardcoded): 10个风格预设，存储在 `PROMPT_PRESETS` 常量
  ```typescript
  const PROMPT_PRESETS: PromptPreset[] = [
    { label: '动漫风格', text: '以高质量日式动漫风格绘制...', color: 'secondary' },
    { label: '赛博朋克', text: '赛博朋克风格，霓虹灯光效果...', color: 'accent' },
    // ... 8 more presets
  ];
  ```

- **自定义提示词**: 用户可保存至 localStorage (key: `media-creator-custom-prompts`)
- **Chaya 人设预设**: 从后端 session 的 `ext.personaPresets` 动态加载

**数据结构**:
```typescript
interface PromptPreset {
  label: string;
  text: string;
  color?: 'accent' | 'secondary' | 'highlight';
}

interface CustomPrompt {
  id: string;
  label: string;
  text: string;
}
```

**UI 布局** (行920-1050):
- 风格预设: 按钮行（可点击追加到描述）
- 自定义提示词: 可编辑列表
- Chaya 人设: 折叠区（主人设 + 预设列表）

---

## 🎯 推荐接入方案

### 优先级 1: **Civitai API** ⭐ (完全推荐)
**为什么选择**:
- ✅ 官方 REST API，稳定性强
- ✅ 免费 tier（需 API key）
- ✅ 200M+ 张生成图像 + prompt + 技术参数
- ✅ 支持 LoRA 模型（=风格预设）
- ✅ NSFW 过滤完善

**核心端点**:
```
GET https://civitai.com/api/v1/images
  ?limit=20
  &nsfw=false
  &sort=trending
  &period=week
  &query=cyberpunk

GET https://civitai.com/api/v1/models
  ?types=LORA
  &query=anime
  &nsfw=false
```

**响应示例**:
```json
{
  "items": [
    {
      "url": "...",
      "prompt": "beautiful anime girl, detailed eyes, ...",
      "meta": {
        "cfgScale": 7,
        "seed": "123456",
        "steps": 20,
        "sampler": "DPM++ 2M Karras"
      }
    }
  ]
}
```

---

### 优先级 2: **Lexica.art API** ⭐ (快速方案)
**为什么选择**:
- ✅ 无需认证，完全免费
- ✅ 50M+ Stable Diffusion prompts
- ✅ 响应快，搜索友好
- ✅ 无 rate limit（目前）

**核心端点**:
```
GET https://lexica.art/api/v1/search
  ?q=cyberpunk+neon+portrait
```

**响应示例**:
```json
{
  "images": [
    {
      "prompt": "cyberpunk portrait, neon lights, sharp focus...",
      "seed": "12345",
      "guidance": 7.5,
      "width": 512,
      "height": 768,
      "model": "stable-diffusion",
      "nsfw": false
    }
  ]
}
```

---

### 优先级 3: **DiffusionDB (Hugging Face)** (数据库方案)
**为什么选择**:
- ✅ 14M 张图像，metadata 完整
- ✅ 免费下载或流式访问
- ✅ 适合本地缓存 + 分析

**访问方式**:
```python
from datasets import load_dataset

# 加载 1k 随机样本
dataset = load_dataset('poloclub/diffusiondb', 'large_random_1k')

# 或直接加载 metadata
import pandas as pd
df = pd.read_parquet('https://huggingface.co/datasets/...')
```

---

## 🏗️ 推荐实现架构

### 后端 (Flask)

#### 新增端点

**1. 获取外部预设**
```python
@app.route("/api/media/style-presets", methods=["GET"])
def get_style_presets():
    """
    获取风格预设（支持多个源）
    
    Query Params:
      - source: civitai | lexica | local (default: all)
      - query: 搜索关键词 (e.g., "cyberpunk", "anime")
      - limit: 10-50 (default: 20)
      - page: 分页 (default: 1)
    
    Response:
    {
      "presets": [
        {
          "id": "civitai_12345",
          "label": "赛博朋克风格",
          "text": "cyberpunk neon lights...",
          "source": "civitai",
          "color": "accent",
          "tags": ["cyberpunk", "neon", "scifi"],
          "preview_url": "https://...",
          "metadata": { "cfgScale": 7, "sampler": "DPM++" }
        }
      ],
      "total": 123,
      "page": 1,
      "has_more": true
    }
    """
    source = request.args.get('source', 'all')
    query = request.args.get('query', '')
    limit = min(int(request.args.get('limit', 20)), 50)
    page = int(request.args.get('page', 1))
    
    presets = []
    
    # 本地预设
    if source in ('all', 'local'):
        presets.extend(_get_local_presets())
    
    # Civitai 预设
    if source in ('all', 'civitai'):
        presets.extend(_fetch_civitai_presets(query, limit, page))
    
    # Lexica 预设
    if source in ('all', 'lexica'):
        presets.extend(_fetch_lexica_presets(query, limit))
    
    return jsonify({
      "presets": presets,
      "total": len(presets),
      "page": page,
      "has_more": page * limit < len(presets)
    }), 200
```

**2. 缓存层** (Redis)
```python
def _fetch_civitai_presets(query, limit, page):
    cache_key = f"civitai_presets:{query}:{limit}:{page}"
    
    # 1 小时缓存
    cached = cache.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # 调用 Civitai API
    resp = requests.get(
        "https://civitai.com/api/v1/images",
        params={
            'query': query or None,
            'limit': limit,
            'nsfw': False,
            'sort': 'trending',
        },
        headers={'Authorization': f'Bearer {CIVITAI_API_KEY}'},
        timeout=10
    )
    
    if resp.status_code != 200:
        return []
    
    data = resp.json()
    presets = [
        {
            'id': f"civitai_{img['id']}",
            'label': (img['prompt'] or 'Untitled')[:50],
            'text': img['prompt'],
            'source': 'civitai',
            'color': 'accent',
            'tags': img.get('tags', []),
            'preview_url': img.get('url'),
            'metadata': img.get('meta', {}),
        }
        for img in data.get('items', [])
    ]
    
    # 缓存
    cache.set(cache_key, json.dumps(presets), 3600)
    
    return presets
```

---

### 前端 (React)

#### 新增 Hook
```typescript
// src/services/stylePresetApi.ts
export async function fetchStylePresets(options?: {
  source?: 'all' | 'civitai' | 'lexica' | 'local';
  query?: string;
  limit?: number;
  page?: number;
}) {
  const params = new URLSearchParams({
    source: options?.source || 'all',
    query: options?.query || '',
    limit: String(options?.limit || 20),
    page: String(options?.page || 1),
  });
  
  const resp = await fetch(`/api/media/style-presets?${params}`);
  if (!resp.ok) throw new Error(`Failed to fetch presets: ${resp.status}`);
  
  return resp.json();
}
```

#### 修改 MediaCreatorPage 组件

**1. 新增状态**
```typescript
const [externalPresets, setExternalPresets] = useState<PromptPreset[]>([]);
const [presetsLoading, setPresetsLoading] = useState(false);
const [presetsError, setPresetsError] = useState<string | null>(null);
const [selectedPresetSource, setSelectedPresetSource] = useState<'all' | 'local' | 'civitai' | 'lexica'>('all');
const [presetQuery, setPresetQuery] = useState('');
```

**2. 加载预设**
```typescript
useEffect(() => {
  const loadPresets = async () => {
    try {
      setPresetsLoading(true);
      const data = await fetchStylePresets({
        source: selectedPresetSource,
        query: presetQuery,
        limit: 30,
      });
      setExternalPresets(data.presets);
      setPresetsError(null);
    } catch (error) {
      console.error('Failed to load presets:', error);
      setPresetsError('无法加载预设');
    } finally {
      setPresetsLoading(false);
    }
  };
  
  const timer = setTimeout(loadPresets, 300); // 防抖
  return () => clearTimeout(timer);
}, [selectedPresetSource, presetQuery]);
```

**3. 更新 UI**

替换现有硬编码的 `PROMPT_PRESETS.map()` 部分：

```typescript
{/* 风格预设区域 - 现在支持动态加载 */}
<div className="space-y-2">
  {/* 搜索 + 源选择 */}
  <div className="flex gap-2">
    <input
      type="text"
      placeholder="搜索风格..."
      value={presetQuery}
      onChange={(e) => setPresetQuery(e.target.value)}
      className={inputClass}
    />
    <select
      value={selectedPresetSource}
      onChange={(e) => setSelectedPresetSource(e.target.value as any)}
      className={inputClass}
    >
      <option value="all">全部来源</option>
      <option value="local">本地预设</option>
      <option value="civitai">Civitai</option>
      <option value="lexica">Lexica</option>
    </select>
  </div>

  {/* 预设列表 */}
  <div className="flex flex-wrap gap-1.5">
    {presetsLoading && <Loader className="w-4 h-4 animate-spin" />}
    
    {/* 本地预设（始终显示） */}
    {PROMPT_PRESETS.map((p) => (
      <button
        key={p.label}
        type="button"
        className="text-[10px] px-2 py-0.5 rounded-full border transition-colors
          hover:opacity-80 active:scale-95 cursor-pointer select-none"
        style={{
          borderColor: `var(--color-${p.color || 'accent'})`,
          color: `var(--color-${p.color || 'accent'})`,
        }}
        onClick={() => applyPromptText(p.text)}
        title={`[本地] ${p.text}`}
      >
        {p.label}
      </button>
    ))}
    
    {/* 外部预设（支持搜索） */}
    {externalPresets.map((p) => (
      <button
        key={p.id}
        type="button"
        className="text-[10px] px-2 py-0.5 rounded-full border transition-colors
          hover:opacity-80 active:scale-95 cursor-pointer select-none
          opacity-70 hover:opacity-100"
        style={{
          borderColor: `var(--color-${p.color || 'highlight'})`,
          color: `var(--color-${p.color || 'highlight'})`,
        }}
        onClick={() => applyPromptText(p.text)}
        title={`[${p.source}] ${p.text}`}
      >
        {p.label}
      </button>
    ))}
  </div>
  
  {presetsError && (
    <div className="text-[10px] text-red-500">{presetsError}</div>
  )}
</div>
```

---

## 📊 实现路线

| 阶段 | 工作 | 优先级 | 工作量 |
|------|------|--------|--------|
| **Phase 1** | 后端：基础代理 + Civitai/Lexica 集成 + Redis 缓存 | P0 | 2-3h |
| **Phase 2** | 前端：搜索 + 源选择 + 动态加载 | P0 | 2-3h |
| **Phase 3** | 测试 + 性能优化（防抖、缓存、分页） | P1 | 1-2h |
| **Phase 4** | 用户设置（记住偏好源、黑名单 NSFW 等） | P2 | 1h |

---

## ⚠️ 关键决策

### 1. API Key 管理
```python
# .env
CIVITAI_API_KEY=sk_xxxxxxx  # 从 civitai.com/settings/account/api-key 获取
```

### 2. 缓存策略
- **本地预设**: 无需缓存（hardcoded）
- **Civitai/Lexica**: Redis 1 小时过期
- 用户查询频繁 → 可加长至 6 小时

### 3. NSFW 过滤
```python
# 后端强制
?nsfw=false  # Civitai API 参数

# 前端额外检查（以防万一）
presets.filter(p => !p.metadata?.nsfw)
```

### 4. 降级策略
```python
# 若外部 API 失败，仅返回本地预设
try:
    external = fetch_civitai(...)
except:
    external = []  # 降级到本地

return local_presets + external
```

---

## 🔗 参考链接

- **Civitai 官方文档**: https://developer.civitai.com/docs/api/public-rest
- **Lexica API**: https://lexica.art/docs
- **DiffusionDB**: https://huggingface.co/datasets/poloclub/diffusiondb
- **AIPrompts.run**: https://aiprompts.run/api-docs.html

---

## 🎯 下一步

1. ✅ 完成研究（当前）
2. ⏭️ **后端实现**: 创建 `/api/media/style-presets` 端点
3. ⏭️ **前端集成**: 修改 MediaCreatorPage，添加搜索和源选择
4. ⏭️ **测试**: 验证 API 速度、缓存、错误处理
5. ⏭️ **用户文档**: 说明如何获取 Civitai API key

---

**优先推荐组合**:
1. 保留本地 10 个预设
2. + Civitai 高质量 prompts（实时搜索）
3. + Lexica 快速发现（trending）
4. = 完整的 prompt 库体验

