# Web爬虫模块设计文档

## 目录
1. [概述](#概述)
2. [API接口设计](#api接口设计)
3. [数据结构定义](#数据结构定义)
4. [前端交互设计](#前端交互设计)
5. [使用示例](#使用示例)
6. [安全考虑](#安全考虑)
7. [错误处理](#错误处理)
8. [集成指南](#集成指南)

---

## 概述

### 功能目标
- 支持静态HTML网站和JavaScript渲染的SPA网站爬取
- 返回结构化的JSON数据（标题、正文、图片、链接、元数据等）
- 支持需要认证的网站（Cookie、Headers、Token等）
- 智能检测网站类型，自动选择最佳爬取方式

### 技术栈
- **后端**：Python + Flask
- **静态爬取**：`requests` + `BeautifulSoup4`
- **动态爬取**：`playwright`（支持JavaScript渲染）
- **内容解析**：`lxml`、`html2text`、`readability-lxml`

---

## API接口设计

### 1. 爬取网页接口

#### 接口信息
- **URL**: `POST /api/crawler/fetch`
- **Content-Type**: `application/json`
- **CORS**: 已配置

#### 请求参数

```typescript
interface CrawlerRequest {
  url: string;                    // 必填：目标网页URL
  options?: CrawlerOptions;       // 可选：爬取选项
}

interface CrawlerOptions {
  // 认证信息
  cookies?: string | Record<string, string>;  // Cookie字符串或对象
  headers?: Record<string, string>;           // 自定义HTTP Headers
  user_agent?: string;                       // 自定义User-Agent
  
  // 爬取选项
  timeout?: number;              // 超时时间（秒），默认30
  force_dynamic?: boolean;       // 强制使用动态渲染，默认false
  wait_for?: string;             // 动态渲染时等待的CSS选择器
  wait_timeout?: number;         // 等待选择器的超时时间（秒），默认10
  
  // 内容提取选项
  extract_images?: boolean;      // 是否提取图片，默认true
  extract_links?: boolean;       // 是否提取链接，默认true
  extract_metadata?: boolean;    // 是否提取元数据，默认true
  extract_structured_data?: boolean;  // 是否提取结构化数据，默认true
}
```

#### 请求示例

**基础请求（无需认证）**
```json
{
  "url": "https://example.com/article"
}
```

**带Cookie的请求**
```json
{
  "url": "https://example.com/article",
  "options": {
    "cookies": "session=abc123; token=xyz789"
  }
}
```

**带Headers的请求**
```json
{
  "url": "https://api.example.com/data",
  "options": {
    "headers": {
      "Authorization": "Bearer your_token_here",
      "X-API-Key": "your_api_key"
    }
  }
}
```

**完整配置示例**
```json
{
  "url": "https://example.com/article",
  "options": {
    "cookies": {
      "session": "abc123",
      "token": "xyz789"
    },
    "headers": {
      "Authorization": "Bearer token_here",
      "X-Custom-Header": "value"
    },
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "timeout": 30,
    "force_dynamic": false,
    "wait_for": ".article-content",
    "extract_images": true,
    "extract_links": true
  }
}
```

#### 响应格式

**成功响应**
```typescript
interface CrawlerSuccessResponse {
  success: true;
  url: string;
  title: string;
  content: {
    text: string;              // 正文纯文本
    html: string;              // 正文HTML（清理后）
    markdown?: string;         // Markdown格式（可选）
  };
  metadata: {
    description?: string;      // meta description
    keywords?: string[];       // meta keywords
    author?: string;           // 作者
    published_time?: string;  // 发布时间（ISO格式）
    modified_time?: string;   // 修改时间
    language?: string;         // 语言代码
    canonical_url?: string;    // 规范URL
  };
  images: Array<{
    url: string;              // 图片URL（绝对路径）
    alt?: string;             // alt文本
    title?: string;           // title属性
    width?: number;            // 宽度
    height?: number;          // 高度
  }>;
  links: Array<{
    url: string;              // 链接URL（绝对路径）
    text: string;            // 链接文本
    type: 'internal' | 'external';  // 内部/外部链接
    rel?: string;            // rel属性
  }>;
  structured_data: {
    json_ld?: any[];         // JSON-LD结构化数据
    open_graph?: Record<string, any>;  // Open Graph标签
    twitter_card?: Record<string, any>; // Twitter Card标签
    microdata?: any[];       // 微数据
  };
  stats: {
    word_count: number;      // 字数统计
    image_count: number;     // 图片数量
    link_count: number;       // 链接数量
    paragraph_count: number; // 段落数量
  };
  fetch_info: {
    method: 'static' | 'dynamic';  // 使用的爬取方法
    fetch_time: number;     // 爬取耗时（秒）
    status_code: number;     // HTTP状态码
    content_type?: string;   // Content-Type
    content_length?: number; // 内容长度
  };
}
```

**错误响应**
```typescript
interface CrawlerErrorResponse {
  success: false;
  error: string;             // 错误类型代码
  message: string;           // 错误描述
  url: string;              // 请求的URL
  suggestions?: string[];    // 建议（如需要认证时）
  details?: any;            // 详细错误信息
}
```

#### 错误类型代码

| 错误代码 | 说明 | HTTP状态码 |
|---------|------|-----------|
| `INVALID_URL` | URL格式无效 | 400 |
| `TIMEOUT` | 请求超时 | 408 |
| `CONNECTION_ERROR` | 连接错误 | 502 |
| `HTTP_ERROR` | HTTP错误（如404、500） | 对应HTTP状态码 |
| `AUTHENTICATION_REQUIRED` | 需要认证 | 401 |
| `AUTHENTICATION_FAILED` | 认证失败 | 403 |
| `CONTENT_PARSING_ERROR` | 内容解析错误 | 500 |
| `DYNAMIC_RENDER_ERROR` | 动态渲染错误 | 500 |
| `UNKNOWN_ERROR` | 未知错误 | 500 |

#### 响应示例

**成功响应示例**
```json
{
  "success": true,
  "url": "https://example.com/article",
  "title": "示例文章标题",
  "content": {
    "text": "这是文章的正文内容...",
    "html": "<p>这是文章的正文内容...</p>",
    "markdown": "这是文章的正文内容..."
  },
  "metadata": {
    "description": "文章描述",
    "keywords": ["关键词1", "关键词2"],
    "author": "作者名",
    "published_time": "2024-01-01T00:00:00Z",
    "language": "zh-CN"
  },
  "images": [
    {
      "url": "https://example.com/image.jpg",
      "alt": "图片描述",
      "width": 800,
      "height": 600
    }
  ],
  "links": [
    {
      "url": "https://example.com/link",
      "text": "链接文本",
      "type": "internal"
    }
  ],
  "structured_data": {
    "json_ld": [
      {
        "@type": "Article",
        "headline": "文章标题"
      }
    ],
    "open_graph": {
      "og:title": "文章标题",
      "og:description": "文章描述"
    }
  },
  "stats": {
    "word_count": 1000,
    "image_count": 5,
    "link_count": 20,
    "paragraph_count": 10
  },
  "fetch_info": {
    "method": "static",
    "fetch_time": 1.23,
    "status_code": 200,
    "content_type": "text/html",
    "content_length": 50000
  }
}
```

**错误响应示例**
```json
{
  "success": false,
  "error": "AUTHENTICATION_REQUIRED",
  "message": "需要认证信息才能访问此页面",
  "url": "https://example.com/protected",
  "suggestions": [
    "请提供Cookie或Authorization Header",
    "检查认证信息是否过期"
  ]
}
```

---

## 数据结构定义

### TypeScript类型定义

```typescript
// src/services/crawlerApi.ts

export interface CrawlerRequest {
  url: string;
  options?: CrawlerOptions;
}

export interface CrawlerOptions {
  cookies?: string | Record<string, string>;
  headers?: Record<string, string>;
  user_agent?: string;
  timeout?: number;
  force_dynamic?: boolean;
  wait_for?: string;
  wait_timeout?: number;
  extract_images?: boolean;
  extract_links?: boolean;
  extract_metadata?: boolean;
  extract_structured_data?: boolean;
}

export interface CrawlerResult {
  success: boolean;
  url: string;
  title?: string;
  content?: {
    text: string;
    html: string;
    markdown?: string;
  };
  metadata?: {
    description?: string;
    keywords?: string[];
    author?: string;
    published_time?: string;
    modified_time?: string;
    language?: string;
    canonical_url?: string;
  };
  images?: Array<{
    url: string;
    alt?: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
  links?: Array<{
    url: string;
    text: string;
    type: 'internal' | 'external';
    rel?: string;
  }>;
  structured_data?: {
    json_ld?: any[];
    open_graph?: Record<string, any>;
    twitter_card?: Record<string, any>;
    microdata?: any[];
  };
  stats?: {
    word_count: number;
    image_count: number;
    link_count: number;
    paragraph_count: number;
  };
  fetch_info?: {
    method: 'static' | 'dynamic';
    fetch_time: number;
    status_code: number;
    content_type?: string;
    content_length?: number;
  };
  error?: string;
  message?: string;
  suggestions?: string[];
}

export interface AuthConfig {
  config_id: string;
  domain: string;
  name: string;
  created_at: string;
  updated_at: string;
  // 注意：实际认证信息不返回，仅返回元数据
}
```

---

## 前端交互设计

### 1. UI设计方案

#### 方案A：集成到聊天界面（推荐）

在聊天界面添加"网页爬取"工具，用户可以通过以下方式使用：

1. **工具栏按钮**：在输入框上方添加"网页爬取"按钮
2. **@符号触发**：输入`@crawler`触发爬取工具
3. **模态框界面**：点击后弹出爬取配置模态框

#### 方案B：作为MCP工具集成

将爬虫功能封装为MCP工具，通过现有的@符号选择器触发。

### 2. 爬取模态框设计

#### 组件结构 (`src/components/CrawlerModal.tsx`)

```typescript
interface CrawlerModalProps {
  onClose: () => void;
  onSuccess: (result: CrawlerResult) => void;
  initialUrl?: string;  // 初始URL（可选）
}
```

#### UI布局

```
┌─────────────────────────────────────┐
│  网页爬取                    [×]     │
├─────────────────────────────────────┤
│                                     │
│  URL: [________________________]    │
│                                     │
│  ▼ 认证配置（可折叠）                │
│  ├─ Cookie:                        │
│  │  [________________________]      │
│  │  从浏览器开发者工具复制Cookie     │
│  │                                   │
│  ├─ Headers:                       │
│  │  [+ 添加Header]                  │
│  │  ┌─────────────────────────┐    │
│  │  │ Header名称: [______]    │    │
│  │  │ Header值:   [______] 👁 │    │
│  │  └─────────────────────────┘    │
│  │                                   │
│  └─ User-Agent:                    │
│     [下拉选择 ▼]                    │
│                                     │
│  ▼ 高级选项（可折叠）                │
│  ├─ 超时时间: [30] 秒               │
│  ├─ 强制动态渲染: [ ]               │
│  └─ 等待选择器: [______]            │
│                                     │
│  [取消]              [开始爬取]     │
└─────────────────────────────────────┘
```

#### 功能特性

1. **URL输入**
   - 自动验证URL格式
   - 支持粘贴完整URL
   - 输入时实时验证

2. **Cookie输入**
   - 文本输入框（支持多行）
   - 格式提示：`key1=value1; key2=value2`
   - 自动解析按钮（可选）
   - 显示/隐藏切换（保护敏感信息）

3. **Headers输入**
   - 动态添加/删除Header
   - 常用Header预设：
     - Authorization: Bearer token
     - X-API-Key
     - Custom Header
   - 每个Header支持显示/隐藏切换

4. **User-Agent选择**
   - 下拉选择常用UA
   - 自定义输入选项

5. **高级选项**
   - 超时时间设置
   - 强制动态渲染开关
   - 等待选择器输入（用于动态渲染）

6. **状态显示**
   - 加载状态：显示进度
   - 错误提示：显示错误信息和建议
   - 成功提示：显示爬取结果摘要

### 3. 前端API服务实现

#### 文件：`src/services/crawlerApi.ts`

```typescript
const API_BASE = 'http://localhost:3002/api';

/**
 * 爬取网页
 */
export async function fetchWebPage(
  url: string,
  options?: CrawlerOptions
): Promise<CrawlerResult> {
  const response = await fetch(`${API_BASE}/crawler/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      options,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to fetch: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 解析Cookie字符串为对象
 */
export function parseCookieString(cookieStr: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieStr.split(';').forEach(cookie => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) {
      cookies[key] = value;
    }
  });
  return cookies;
}

/**
 * 格式化Cookie对象为字符串
 */
export function formatCookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}
```

### 4. 使用示例

#### 基础使用（无需认证）
```typescript
import { fetchWebPage } from '../services/crawlerApi';

const result = await fetchWebPage('https://example.com/article');
if (result.success) {
  console.log('标题:', result.title);
  console.log('正文:', result.content?.text);
}
```

#### 带Cookie使用
```typescript
const result = await fetchWebPage('https://example.com/article', {
  cookies: 'session=abc123; token=xyz789'
});
```

#### 带Headers使用
```typescript
const result = await fetchWebPage('https://api.example.com/data', {
  headers: {
    'Authorization': 'Bearer your_token',
    'X-API-Key': 'your_api_key'
  }
});
```

#### 完整配置使用
```typescript
const result = await fetchWebPage('https://example.com/article', {
  cookies: {
    session: 'abc123',
    token: 'xyz789'
  },
  headers: {
    'Authorization': 'Bearer token_here'
  },
  user_agent: 'Mozilla/5.0...',
  timeout: 30,
  force_dynamic: false,
  wait_for: '.article-content'
});
```

---

## 使用示例

### 1. 基础爬取

**请求**
```bash
curl -X POST http://localhost:3002/api/crawler/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article"
  }'
```

**响应**
```json
{
  "success": true,
  "url": "https://example.com/article",
  "title": "文章标题",
  "content": {...},
  ...
}
```

### 2. 需要认证的网站

**请求**
```bash
curl -X POST http://localhost:3002/api/crawler/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/protected",
    "options": {
      "cookies": "session=abc123; token=xyz789",
      "headers": {
        "Authorization": "Bearer token_here"
      }
    }
  }'
```

### 3. JavaScript渲染的SPA网站

**请求**
```bash
curl -X POST http://localhost:3002/api/crawler/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://spa.example.com",
    "options": {
      "force_dynamic": true,
      "wait_for": ".main-content",
      "wait_timeout": 15
    }
  }'
```

---

## 安全考虑

### 1. 敏感信息处理

#### 前端
- Cookie和Token输入框支持"显示/隐藏"切换
- 不在控制台或日志中输出敏感信息
- 使用HTTPS传输（生产环境）

#### 后端
- **日志脱敏**：自动脱敏Cookie、Token等敏感信息
  ```python
  # 示例：日志中显示
  # Cookie: session=abc***xyz (已脱敏)
  ```
- **不持久化**：认证信息仅在请求期间使用，不保存到数据库
- **请求后清理**：使用后立即清除内存中的认证信息

### 2. 输入验证

- **URL验证**：验证URL格式，防止SSRF攻击
- **超时控制**：防止长时间占用资源
- **大小限制**：限制响应内容大小（默认10MB）

### 3. 错误信息

- 不暴露内部实现细节
- 提供有用的错误提示，但不泄露敏感信息

---

## 错误处理

### 错误类型和处理

#### 1. URL格式错误
```json
{
  "success": false,
  "error": "INVALID_URL",
  "message": "URL格式无效，请检查URL是否正确",
  "url": "invalid-url"
}
```

#### 2. 请求超时
```json
{
  "success": false,
  "error": "TIMEOUT",
  "message": "请求超时，请检查网络连接或增加超时时间",
  "url": "https://example.com",
  "suggestions": [
    "增加超时时间（options.timeout）",
    "检查目标网站是否可访问"
  ]
}
```

#### 3. 需要认证
```json
{
  "success": false,
  "error": "AUTHENTICATION_REQUIRED",
  "message": "需要认证信息才能访问此页面",
  "url": "https://example.com/protected",
  "suggestions": [
    "请提供Cookie（options.cookies）",
    "或提供Authorization Header（options.headers.Authorization）"
  ]
}
```

#### 4. 认证失败
```json
{
  "success": false,
  "error": "AUTHENTICATION_FAILED",
  "message": "认证失败，请检查认证信息是否正确或是否已过期",
  "url": "https://example.com/protected",
  "suggestions": [
    "检查Cookie是否有效",
    "检查Token是否过期",
    "重新登录获取新的认证信息"
  ]
}
```

#### 5. 连接错误
```json
{
  "success": false,
  "error": "CONNECTION_ERROR",
  "message": "无法连接到目标服务器",
  "url": "https://example.com",
  "suggestions": [
    "检查网络连接",
    "检查URL是否正确",
    "检查目标网站是否可访问"
  ]
}
```

### 前端错误处理示例

```typescript
try {
  const result = await fetchWebPage(url, options);
  if (result.success) {
    // 处理成功结果
    handleSuccess(result);
  } else {
    // 处理错误
    handleError(result);
  }
} catch (error) {
  // 处理异常
  console.error('爬取失败:', error);
  showError(error.message);
}
```

---

## 集成指南

### 1. 后端集成

#### 步骤1：安装依赖
```bash
cd backend
pip install beautifulsoup4 lxml playwright html2text readability-lxml
playwright install chromium  # 安装浏览器
```

#### 步骤2：创建爬虫模块
创建 `backend/web_crawler.py`，实现 `WebCrawler` 类。

#### 步骤3：添加API路由
在 `backend/app.py` 中添加：
```python
from web_crawler import WebCrawler

@app.route('/api/crawler/fetch', methods=['POST', 'OPTIONS'])
def crawler_fetch():
    # 实现爬取逻辑
    pass
```

### 2. 前端集成

#### 步骤1：创建API服务
创建 `src/services/crawlerApi.ts`，实现API调用函数。

#### 步骤2：创建UI组件
创建 `src/components/CrawlerModal.tsx`，实现爬取配置界面。

#### 步骤3：集成到聊天界面
在 `src/components/Workflow.tsx` 中：
```typescript
import { fetchWebPage } from '../services/crawlerApi';
import CrawlerModal from './CrawlerModal';

// 添加状态
const [showCrawlerModal, setShowCrawlerModal] = useState(false);

// 添加按钮
<button onClick={() => setShowCrawlerModal(true)}>
  网页爬取
</button>

// 添加模态框
{showCrawlerModal && (
  <CrawlerModal
    onClose={() => setShowCrawlerModal(false)}
    onSuccess={(result) => {
      // 处理爬取结果
      handleCrawlerResult(result);
      setShowCrawlerModal(false);
    }}
  />
)}
```

### 3. 结果处理

#### 将结果发送到聊天
```typescript
const handleCrawlerResult = (result: CrawlerResult) => {
  if (result.success) {
    // 格式化结果
    const message = formatCrawlerResult(result);
    
    // 添加到消息列表
    setMessages(prev => [...prev, {
      id: `crawler-${Date.now()}`,
      role: 'tool',
      content: message,
      toolType: 'crawler'
    }]);
  }
};

const formatCrawlerResult = (result: CrawlerResult): string => {
  return `
网页爬取结果：${result.url}

标题：${result.title}

正文：
${result.content?.text.substring(0, 500)}...

统计：
- 字数：${result.stats?.word_count}
- 图片：${result.stats?.image_count}
- 链接：${result.stats?.link_count}
  `.trim();
};
```

---

## 扩展功能（可选）

### 1. 认证配置管理

#### 保存认证配置
```typescript
interface SaveAuthConfigRequest {
  domain: string;
  name: string;
  cookies?: string;
  headers?: Record<string, string>;
}

export async function saveAuthConfig(
  config: SaveAuthConfigRequest
): Promise<AuthConfig> {
  // 实现保存逻辑
}
```

#### 使用已保存的配置
```typescript
// 获取已保存的配置
const configs = await getAuthConfigs();

// 使用配置爬取
const result = await fetchWebPage(url, {
  cookies: config.cookies,
  headers: config.headers
});
```

### 2. 批量爬取

#### 接口设计
```typescript
POST /api/crawler/fetch-batch
{
  "urls": ["url1", "url2", "url3"],
  "options": {...}
}
```

### 3. 爬取历史

#### 接口设计
```typescript
GET /api/crawler/history
GET /api/crawler/history/<history_id>
```

---

## 测试用例

### 1. 基础功能测试
- [ ] 静态HTML网站爬取
- [ ] SPA网站爬取（JavaScript渲染）
- [ ] 需要Cookie的网站
- [ ] 需要Headers的网站
- [ ] 超时处理
- [ ] 错误处理

### 2. 内容提取测试
- [ ] 标题提取
- [ ] 正文提取
- [ ] 图片提取
- [ ] 链接提取
- [ ] 元数据提取
- [ ] 结构化数据提取

### 3. 边界情况测试
- [ ] 无效URL
- [ ] 不存在的网站
- [ ] 超大页面
- [ ] 特殊字符处理
- [ ] 编码问题（UTF-8、GBK等）

---

## 性能优化

### 1. 缓存机制（可选）
- 相同URL的请求可以缓存结果
- 缓存时间可配置
- 支持缓存失效策略

### 2. 并发控制
- 限制同时进行的爬取任务数量
- 避免资源耗尽

### 3. 浏览器实例复用
- Playwright浏览器实例可以复用
- 减少启动开销

---

## 更新日志

### v1.0.0 (已实现)
- ✅ 基础爬取功能
- ✅ 静态和动态爬取支持（Playwright）
- ✅ 认证支持（Cookie、Headers、User-Agent）
- ✅ 结构化数据提取
- ✅ Redis缓存机制
- ✅ 模块和批次管理
- ✅ 标准化解析（列表、文章、表格、自定义格式）
- ✅ 前端测试页面
- ✅ 聊天中的/模块命令引用

---

## 实现状态

### 后端实现
- ✅ `backend/web_crawler.py` - 爬虫核心模块
- ✅ `backend/crawler_normalizer.py` - 标准化解析模块
- ✅ `backend/database.py` - 数据库表（crawler_modules, crawler_batches）
- ✅ `backend/app.py` - API接口（/api/crawler/*）
- ✅ `backend/requirements.txt` - 依赖包

### 前端实现
- ✅ `src/services/crawlerApi.ts` - API服务
- ✅ `src/components/CrawlerTestPage.tsx` - 测试页面组件
- ✅ `src/components/CrawlerModuleSelector.tsx` - 模块选择器组件
- ✅ `src/components/Workflow.tsx` - /模块命令集成

### 安装说明

#### 后端依赖安装
```bash
cd backend
pip install beautifulsoup4 lxml playwright html2text readability-lxml
playwright install chromium  # 安装浏览器
```

#### 使用说明
1. **配置爬虫模块**：
   - 点击"爬虫配置"按钮打开测试页面
   - 输入URL，配置认证信息
   - 测试爬取，查看结果
   - 配置标准化规则
   - 设置模块名称和批次名称
   - 保存模块

2. **在聊天中引用**：
   - 输入 `/模块` 触发模块选择器
   - 选择模块和批次
   - 数据自动插入到输入框

---

## 联系方式

如有问题或建议，请联系开发团队。
