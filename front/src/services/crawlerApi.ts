/**
 * 爬虫API服务
 */

const API_BASE = 'http://localhost:3002/api';

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
    cached?: boolean;
  };
  normalized?: {
    format: string;
    items: Array<{
      id: string;
      title?: string;
      content: string;
      html?: string;
      metadata?: Record<string, any>;
      extracted_at: string;
    }>;
    total_count: number;
    extraction_info?: any;
  };
  error?: string;
  message?: string;
  suggestions?: string[];
}

export interface ModuleConfig {
  module_name: string;
  description?: string;
  target_url: string;
  crawler_options?: CrawlerOptions;
  normalize_config?: NormalizeConfig;
}

export interface NormalizeConfig {
  format: 'list' | 'article' | 'table' | 'custom';
  item_selector?: string;
  title_selector?: string;
  content_selector?: string;
  metadata_selectors?: Record<string, string>;
  custom_extractors?: Record<string, any>;
  table_selector?: string;
  header_row?: number;
  skip_rows?: number[];
  split_strategy?: 'none' | 'regex' | 'keyword';
  split_pattern?: string;
}

export interface CrawlerModule {
  module_id: string;
  module_name: string;
  description?: string;
  target_url: string;
  crawler_options?: CrawlerOptions;
  normalize_config?: NormalizeConfig;
  created_at: string;
  updated_at: string;
}

export interface CrawlerBatch {
  batch_id: string;
  module_id: string;
  batch_name: string;
  crawled_data: CrawlerResult;
  // parsed_data 是一个简单的数组，每个元素包含 title 和 content
  parsed_data?: Array<{ title?: string; content?: string }>;
  crawled_at: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  error_message?: string;
  item_count?: number;
}

export interface ModuleWithBatches extends Omit<CrawlerModule, 'crawler_options' | 'normalize_config'> {
  batches: Array<{
    batch_id: string;
    batch_name: string;
    item_count: number;
    crawled_at: string;
  }>;
}

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
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      url,
      options,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = JSON.parse(errorText);
    throw new Error(error.message || `Failed to fetch: ${response.statusText}`);
  }

  // 确保正确解析UTF-8编码的JSON
  const text = await response.text();
  return JSON.parse(text);
}

/**
 * 实时标准化预览（用于前端预览解析结果）
 */
export async function previewNormalize(
  rawData: CrawlerResult,
  normalizeConfig: NormalizeConfig
): Promise<{ success: boolean; normalized?: any; error?: string }> {
  const response = await fetch(`${API_BASE}/crawler/normalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      raw_data: rawData,
      normalize_config: normalizeConfig,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = JSON.parse(errorText);
    throw new Error(error.message || `Failed to normalize: ${response.statusText}`);
  }

  const text = await response.text();
  return JSON.parse(text);
}

/**
 * 解析Cookie字符串为对象
 */
export function parseCookieString(cookieStr: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieStr.split(';').forEach(cookie => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) {
      cookies[key.trim()] = value.trim();
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

/**
 * 创建模块
 */
export async function createModule(config: ModuleConfig): Promise<CrawlerModule> {
  const response = await fetch(`${API_BASE}/crawler/modules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = JSON.parse(text);
    throw new Error(error.error || `Failed to create module: ${response.statusText}`);
  }

  const text = await response.text();
  return JSON.parse(text);
}

/**
 * 获取模块列表
 */
export async function getModules(): Promise<CrawlerModule[]> {
  const response = await fetch(`${API_BASE}/crawler/modules`);

  if (!response.ok) {
    throw new Error(`Failed to get modules: ${response.statusText}`);
  }

  const text = await response.text();
  const data = JSON.parse(text);
  return data.modules || [];
}

/**
 * 获取模块详情
 */
export async function getModule(moduleId: string): Promise<CrawlerModule> {
  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Module not found');
    }
    throw new Error(`Failed to get module: ${response.statusText}`);
  }

  const text = await response.text();
  return JSON.parse(text);
}

/**
 * 更新模块
 */
export async function updateModule(
  moduleId: string,
  config: Partial<ModuleConfig>
): Promise<CrawlerModule> {
  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = JSON.parse(errorText);
    throw new Error(error.error || `Failed to update module: ${response.statusText}`);
  }

  const text = await response.text();
  return JSON.parse(text);
}

/**
 * 删除模块
 */
export async function deleteModule(moduleId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = JSON.parse(errorText);
    throw new Error(error.error || `Failed to delete module: ${response.statusText}`);
  }
}

/**
 * 创建批次（执行爬取）
 */
export async function createBatch(
  moduleId: string,
  batchName: string,
  forceRefresh: boolean = false
): Promise<CrawlerBatch> {
  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}/batches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      batch_name: batchName,
      force_refresh: forceRefresh,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = JSON.parse(errorText);
    throw new Error(error.error || error.message || `Failed to create batch: ${response.statusText}`);
  }

  const result = await response.json();
  return {
    batch_id: result.batch_id,
    module_id: result.module_id,
    batch_name: result.batch_name,
    crawled_data: result.crawled_data,
    crawled_at: result.crawled_at,
    status: result.status,
    error_message: result.error_message,
  };
}

/**
 * 获取批次列表
 */
export async function getBatches(moduleId: string): Promise<CrawlerBatch[]> {
  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}/batches`);

  if (!response.ok) {
    throw new Error(`Failed to get batches: ${response.statusText}`);
  }

  const data = await response.json();
  return (data.batches || []).map((batch: any) => ({
    batch_id: batch.batch_id,
    module_id: moduleId,
    batch_name: batch.batch_name,
    crawled_data: {} as CrawlerResult, // 批次列表不包含完整数据
    crawled_at: batch.crawled_at,
    status: batch.status,
    error_message: batch.error_message,
    item_count: batch.item_count,
  }));
}

/**
 * 基于历史批次快速创建新批次
 */
export async function quickCreateBatchFromHistory(
  moduleId: string,
  batchId: string,
  batchName?: string
): Promise<CrawlerBatch> {
  const response = await fetch(
    `${API_BASE}/crawler/modules/${moduleId}/batches/${batchId}/quick-create`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batch_name: batchName,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to quick create batch: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    batch_id: data.batch_id,
    module_id: data.module_id,
    batch_name: data.batch_name,
    crawled_data: data.crawled_data,
    crawled_at: data.crawled_at,
    status: data.status,
    error_message: data.error_message,
  };
}

/**
 * 获取批次详情
 */
export async function getBatch(moduleId: string, batchId: string): Promise<CrawlerBatch> {
  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}/batches/${batchId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Batch not found');
    }
    const errorText = await response.text();
    let errorMessage = `Failed to get batch: ${response.statusText}`;
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.error || error.message || errorMessage;
    } catch {
      // 如果解析失败，使用默认错误消息
    }
    throw new Error(errorMessage);
  }

  const text = await response.text();
  const result = JSON.parse(text);
  
  // 确保 crawled_data 存在，如果不存在则提供默认值
  if (!result.crawled_data) {
    result.crawled_data = {};
  }
  
  // 确保 normalized 存在，如果不存在则提供默认值
  if (!result.crawled_data.normalized) {
    result.crawled_data.normalized = {
      format: 'unknown',
      items: [],
      total_count: 0,
    };
  }
  
  return {
    batch_id: result.batch_id,
    module_id: result.module_id,
    batch_name: result.batch_name,
    crawled_data: result.crawled_data,
    parsed_data: result.parsed_data || undefined,
    crawled_at: result.crawled_at,
    status: result.status,
    error_message: result.error_message,
  };
}

/**
 * 保存批次的解析数据（parsed_data）
 */
export async function saveBatchParsedData(
  moduleId: string,
  batchId: string,
  parsedData: {
    items: Array<{ id: string; title?: string; content?: string; metadata?: any }>;
    total_count: number;
    format: string;
  }
): Promise<void> {
  console.log('[crawlerApi] Saving parsed data:', {
    moduleId,
    batchId,
    parsedData: {
      ...parsedData,
      itemsCount: parsedData.items.length,
    },
  });

  const requestBody = {
    parsed_data: parsedData,
  };

  console.log('[crawlerApi] Request body:', JSON.stringify(requestBody, null, 2));

  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}/batches/${batchId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(requestBody),
  });

  console.log('[crawlerApi] Response status:', response.status, response.statusText);

  if (!response.ok) {
    let errorMessage = '保存解析数据失败';
    try {
      const text = await response.text();
      console.error('[crawlerApi] Error response:', text);
      const errorData = JSON.parse(text);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch (e) {
      console.error('[crawlerApi] Failed to parse error response:', e);
    }
    throw new Error(errorMessage);
  }

  const responseText = await response.text();
  console.log('[crawlerApi] Success response:', responseText);
  try {
    const result = JSON.parse(responseText);
    console.log('[crawlerApi] Parsed result:', result);
  } catch (e) {
    console.warn('[crawlerApi] Failed to parse success response:', e);
  }
}

/**
 * 保存解析后的数据到 parsed_data 字段（专用接口）
 * @param moduleId 模块ID
 * @param batchId 批次ID
 * @param items 解析后的数据项数组
 * @returns 保存结果
 */
export async function saveParsedDataToBatch(
  moduleId: string,
  batchId: string,
  items: Array<{ id?: string; title?: string; content?: string; [key: string]: any }>
): Promise<{ success: boolean; item_count: number; message: string }> {
  console.log('[saveParsedDataToBatch] 📤 开始保存 parsed_data:', {
    moduleId,
    batchId,
    itemCount: items.length,
    firstItem: items[0],
  });

  // 转换为简单格式（只保留 title 和 content）
  const simplifiedData = items.map(item => ({
    title: item.title || '',
    content: item.content || '',
  }));

  console.log('[saveParsedDataToBatch] 📦 简化后的数据:', {
    count: simplifiedData.length,
    sample: simplifiedData[0],
  });

  const url = `${API_BASE}/crawler/modules/${moduleId}/batches/${batchId}/parsed-data`;
  console.log('[saveParsedDataToBatch] 🚀 请求 URL:', url);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      parsed_data: simplifiedData
    }),
  });

  console.log('[saveParsedDataToBatch] 📡 响应状态:', response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[saveParsedDataToBatch] ❌ 错误响应:', errorText);
    throw new Error(`保存失败 (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log('[saveParsedDataToBatch] ✅ 保存成功:', result);
  
  return result;
}

/**
 * @deprecated 使用 saveParsedDataToBatch 代替
 */
export async function updateBatchParsedData(
  moduleId: string,
  batchId: string,
  parsedData: any
): Promise<{ success: boolean; item_count: number }> {
  console.warn('[updateBatchParsedData] ⚠️ 此函数已废弃，请使用 saveParsedDataToBatch');
  
  // 兼容旧格式
  let items: any[] = [];
  if (Array.isArray(parsedData)) {
    items = parsedData;
  } else if (parsedData && parsedData.items) {
    items = parsedData.items;
  }
  
  return saveParsedDataToBatch(moduleId, batchId, items);
}

/**
 * 删除批次
 */
export async function deleteBatch(moduleId: string, batchId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/crawler/modules/${moduleId}/batches/${batchId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = JSON.parse(errorText);
    throw new Error(error.error || `Failed to delete batch: ${response.statusText}`);
  }
}

/**
 * 搜索模块（用于聊天中的/模块联想）
 */
export async function searchModules(query?: string): Promise<ModuleWithBatches[]> {
  const url = query
    ? `${API_BASE}/crawler/modules/search?q=${encodeURIComponent(query)}`
    : `${API_BASE}/crawler/modules/search`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to search modules: ${response.statusText}`);
  }

  const data = await response.json();
  return data.modules || [];
}
