/**
 * 爬虫测试页面组件
 * 用于测试爬取、配置模块和标准化规则
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Globe, Loader, CheckCircle, XCircle, ChevronDown, ChevronUp, 
  Save, Play, Eye, EyeOff, X, Plus, Trash2, MousePointer, Tag, Code2, ExternalLink
} from 'lucide-react';
import { Button } from './ui/Button';
import { 
  fetchWebPage, createModule, previewNormalize, saveParsedDataToBatch, CrawlerOptions, CrawlerResult, 
  NormalizeConfig, parseCookieString, formatCookieString 
} from '../services/crawlerApi';

interface CrawlerTestPageProps {
  onClose?: () => void;
  onModuleCreated?: (moduleId: string) => void;
  moduleId?: string; // 编辑已有模块时传入
  batchId?: string; // 编辑已有批次时传入
}

const CrawlerTestPage: React.FC<CrawlerTestPageProps> = ({ onClose, onModuleCreated, moduleId, batchId }) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [crawlResult, setCrawlResult] = useState<CrawlerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 加载已有批次数据（编辑模式）
  useEffect(() => {
    if (moduleId && batchId) {
      const loadBatchData = async () => {
        try {
          const { getBatch } = await import('../services/crawlerApi');
          const batch = await getBatch(moduleId, batchId);
          if (batch && batch.crawled_data) {
            // 处理 parsed_data：如果是数组格式，转换为包含 items 的对象格式
            let normalizedData = batch.crawled_data.normalized;
            if (batch.parsed_data) {
              if (Array.isArray(batch.parsed_data)) {
                // parsed_data 是数组格式，转换为对象格式
                normalizedData = {
                  items: batch.parsed_data.map((item, index) => ({
                    id: `item_${index + 1}`,
                    title: item.title || '',
                    content: item.content || ''
                  })),
                  total_count: batch.parsed_data.length,
                  format: 'list'
                };
              } else {
                // parsed_data 是对象格式（兼容旧数据）
                normalizedData = batch.parsed_data;
              }
            }
            
            // 将批次数据转换为 CrawlerResult 格式以便预览
            setCrawlResult({
              success: true,
              content: batch.crawled_data.content || {},
              normalized: normalizedData,
            });
            // 如果有 parsed_data，也设置到预览中
            if (normalizedData) {
              setPreviewNormalizedData(normalizedData);
            }
          }
        } catch (err) {
          console.error('[CrawlerTestPage] Failed to load batch data:', err);
        }
      };
      loadBatchData();
    }
  }, [moduleId, batchId]);
  
  // 认证配置
  const [showAuthConfig, setShowAuthConfig] = useState(false);
  const [cookieString, setCookieString] = useState('');
  const [headers, setHeaders] = useState<Array<{ key: string; value: string; visible: boolean }>>([]);
  const [userAgent, setUserAgent] = useState('default');
  const [customUserAgent, setCustomUserAgent] = useState('');
  
  // 高级选项
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [timeout, setTimeout] = useState(30);
  const [forceDynamic, setForceDynamic] = useState(false);
  const [waitFor, setWaitFor] = useState('');
  
  // 模块配置
  const [showModuleConfig, setShowModuleConfig] = useState(false);
  const [moduleName, setModuleName] = useState('');
  const [moduleDescription, setModuleDescription] = useState('');
  const [batchName, setBatchName] = useState(new Date().toISOString().split('T')[0]);
  
  // 标准化配置
  const [showNormalizeConfig, setShowNormalizeConfig] = useState(false);
  const [normalizeFormat, setNormalizeFormat] = useState<'list' | 'article' | 'table' | 'custom'>('article');
  const [itemSelector, setItemSelector] = useState('');
  const [titleSelector, setTitleSelector] = useState('');
  const [contentSelector, setContentSelector] = useState('');
  const [splitStrategy, setSplitStrategy] = useState<'none' | 'regex' | 'keyword'>('none');
  const [splitPattern, setSplitPattern] = useState('');
  
  // 预览和标记功能
  const [showPreview, setShowPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<'summary' | 'html' | 'items'>('summary');
  const [selectedElements, setSelectedElements] = useState<{
    item?: string;
    title?: string;
    content?: string;
  }>({});
  const [elementPreview, setElementPreview] = useState<{
    item?: { text: string; html: string };
    title?: { text: string; html: string };
    content?: { text: string; html: string };
  }>({});
  const [splitPreview, setSplitPreview] = useState<{
    title: string;
    content: string;
    success: boolean;
    message: string;
    subItems?: Array<{ title: string; content: string }>;
    totalCount?: number;
  } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionType, setSelectionType] = useState<'item' | 'title' | 'content' | null>(null);
  
  // 计算分割预览
  const calculateSplitPreview = (text: string, strategy: string, pattern: string) => {
    if (!text) {
      setSplitPreview(null);
      return;
    }

    const lines = text.split('\n').filter(line => line.trim());
    let subItems: string[] = [];
    let success = false;
    let message = '';

    try {
      if (strategy === 'regex' && pattern) {
        // 正则表达式分割成多个子项
        const parts = text.split(new RegExp(pattern));
        subItems = parts.filter(p => p.trim());
        success = subItems.length > 1;
        message = success 
          ? `✅ 正则匹配成功，分割为 ${subItems.length} 个数据项` 
          : `⚠️ 正则未匹配到，保持为 1 个数据项`;
      } else if (strategy === 'keyword' && pattern) {
        // 关键词分割成多个子项
        if (text.includes(pattern)) {
          const parts = text.split(pattern);
          subItems = parts.filter(p => p.trim());
          success = true;
          message = `✅ 找到关键词"${pattern}"，分割为 ${subItems.length} 个数据项`;
        } else {
          subItems = [text];
          success = false;
          message = `⚠️ 未找到关键词"${pattern}"，保持为 1 个数据项`;
        }
      } else {
        // 不分割
        subItems = [text];
        success = true;
        message = `不分割，保持为 1 个数据项`;
      }

      // 为每个子项提取标题（使用首行模式）
      const previewItems = subItems.slice(0, 3).map((subText, idx) => {
        const subLines = subText.split('\n').filter(l => l.trim());
        const firstLine = subLines[0] || '';
        const title = firstLine.length < 100 ? firstLine : '';
        const content = title && subLines.length > 1 
          ? subLines.slice(1).join('\n') 
          : subText;
        
        return { title, content };
      });

      setSplitPreview({
        title: message,
        content: '',
        success,
        message,
        subItems: previewItems,
        totalCount: subItems.length
      } as any);
    } catch (error) {
      setSplitPreview({
        title: '',
        content: text,
        success: false,
        message: `❌ 分割错误: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  // 当分割规则或元素预览改变时，更新分割预览
  useEffect(() => {
    if (elementPreview.item) {
      calculateSplitPreview(elementPreview.item.text, splitStrategy, splitPattern);
    }
  }, [splitStrategy, splitPattern, elementPreview.item]);
  
  // 实时解析的结构化数据预览
  const [previewNormalizedData, setPreviewNormalizedData] = useState<{
    items: Array<{ id: string; title?: string; content?: string; metadata?: any }>;
    total_count: number;
    format: string;
  } | null>(null);
  const [isPreviewingNormalized, setIsPreviewingNormalized] = useState(false);
  
  // 高亮已选择的元素（在iframe中）
  useEffect(() => {
    if (!iframeRef.current || !crawlResult) return;
    
    const iframe = iframeRef.current;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;
    
    // 清除之前的高亮
    const allElements = iframeDoc.querySelectorAll('[data-highlighted]');
    allElements.forEach(el => {
      el.removeAttribute('data-highlighted');
      (el as HTMLElement).style.outline = '';
      (el as HTMLElement).style.backgroundColor = '';
    });
    
    // 高亮已选择的元素
    if (selectedElements.item) {
      try {
        const elements = iframeDoc.querySelectorAll(selectedElements.item);
        elements.forEach((el, idx) => {
          if (idx < 3) { // 只高亮前3个
            (el as HTMLElement).style.outline = '2px solid blue';
            (el as HTMLElement).style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
            el.setAttribute('data-highlighted', 'item');
          }
        });
      } catch (e) {
        console.warn('Invalid selector:', selectedElements.item);
      }
    }
    
    if (selectedElements.title) {
      try {
        const elements = iframeDoc.querySelectorAll(selectedElements.title);
        elements.forEach((el, idx) => {
          if (idx < 3) {
            (el as HTMLElement).style.outline = '2px solid green';
            (el as HTMLElement).style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
            el.setAttribute('data-highlighted', 'title');
          }
        });
      } catch (e) {
        console.warn('Invalid selector:', selectedElements.title);
      }
    }
    
    if (selectedElements.content) {
      try {
        const elements = iframeDoc.querySelectorAll(selectedElements.content);
        elements.forEach((el, idx) => {
          if (idx < 3) {
            (el as HTMLElement).style.outline = '2px solid purple';
            (el as HTMLElement).style.backgroundColor = 'rgba(168, 85, 247, 0.1)';
            el.setAttribute('data-highlighted', 'content');
          }
        });
      } catch (e) {
        console.warn('Invalid selector:', selectedElements.content);
      }
    }
  }, [selectedElements, crawlResult]);
  
  // 测试爬取
  const handleTestCrawl = async () => {
    if (!url.trim()) {
      setError('请输入URL');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setCrawlResult(null);
    
    try {
      const options: CrawlerOptions = {
        timeout,
        force_dynamic: forceDynamic,
        wait_for: waitFor || undefined,
      };
      
      // 添加Cookie
      if (cookieString.trim()) {
        options.cookies = cookieString.trim();
      }
      
      // 添加Headers
      if (headers.length > 0) {
        const headersObj: Record<string, string> = {};
        headers.forEach(h => {
          if (h.key && h.value) {
            headersObj[h.key] = h.value;
          }
        });
        options.headers = headersObj;
      }
      
      // 添加User-Agent
      if (userAgent === 'custom' && customUserAgent.trim()) {
        options.user_agent = customUserAgent.trim();
      } else if (userAgent !== 'default') {
        const uaMap: Record<string, string> = {
          'chrome-win': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'chrome-mac': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'firefox': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
          'safari': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        };
        options.user_agent = uaMap[userAgent] || '';
      }
      
      const result = await fetchWebPage(url, options);
      setCrawlResult(result);
      
      if (!result.success) {
        setError(result.message || '爬取失败');
      }
    } catch (err: any) {
      setError(err.message || '爬取失败');
    } finally {
      setIsLoading(false);
    }
  };
  
  // 保存模块
  const handleSaveModule = async () => {
    if (!moduleName.trim()) {
      setError('请输入模块名称');
      return;
    }
    
    if (!url.trim()) {
      setError('请输入目标URL');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // 构建爬虫选项
      const crawlerOptions: CrawlerOptions = {
        timeout,
        force_dynamic: forceDynamic,
        wait_for: waitFor || undefined,
      };
      
      if (cookieString.trim()) {
        crawlerOptions.cookies = cookieString.trim();
      }
      
      if (headers.length > 0) {
        const headersObj: Record<string, string> = {};
        headers.forEach(h => {
          if (h.key && h.value) {
            headersObj[h.key] = h.value;
          }
        });
        crawlerOptions.headers = headersObj;
      }
      
      if (userAgent === 'custom' && customUserAgent.trim()) {
        crawlerOptions.user_agent = customUserAgent.trim();
      }
      
      // 构建标准化配置
      // 优先使用 selectedElements（用户标记的选择器），如果没有则使用手动输入的选择器
      const normalizeConfig: NormalizeConfig = {
        format: normalizeFormat,
      };
      
      if (normalizeFormat === 'list') {
        // 优先使用标记的选择器
        const finalItemSelector = selectedElements.item || itemSelector;
        const finalTitleSelector = selectedElements.title || titleSelector;
        const finalContentSelector = selectedElements.content || contentSelector;
        
        if (finalItemSelector) normalizeConfig.item_selector = finalItemSelector;
        if (finalTitleSelector) normalizeConfig.title_selector = finalTitleSelector;
        if (finalContentSelector) normalizeConfig.content_selector = finalContentSelector;
        
        // 简化模式：如果标题和内容选择器都为空，添加分割规则
        if (!finalTitleSelector && !finalContentSelector) {
          normalizeConfig.title_selector = '';
          normalizeConfig.content_selector = '';
          if (splitStrategy !== 'none') {
            normalizeConfig.split_strategy = splitStrategy;
            if (splitPattern) {
              normalizeConfig.split_pattern = splitPattern;
            }
          }
        }
      } else if (normalizeFormat === 'table') {
        const finalItemSelector = selectedElements.item || itemSelector;
        if (finalItemSelector) normalizeConfig.table_selector = finalItemSelector;
      } else if (normalizeFormat === 'article') {
        // 文章格式也可以使用标记的选择器
        if (selectedElements.title || titleSelector) {
          normalizeConfig.title_selector = selectedElements.title || titleSelector;
        }
        if (selectedElements.content || contentSelector) {
          normalizeConfig.content_selector = selectedElements.content || contentSelector;
        }
      }
      
      // 创建模块
      console.log('[handleSaveModule] 📝 创建模块...');
      const module = await createModule({
        module_name: moduleName,
        description: moduleDescription || undefined,
        target_url: url,
        crawler_options: crawlerOptions,
        normalize_config: normalizeConfig,
      });
      console.log('[handleSaveModule] ✅ 模块创建成功:', module.module_id);
      
      let createdBatchId: string | null = null;
      let savedItemCount = 0;
      
      // 如果提供了批次名称，立即创建批次
      if (batchName.trim()) {
        try {
          console.log('[handleSaveModule] 📝 创建批次...');
          const { createBatch } = await import('../services/crawlerApi');
          const batch = await createBatch(module.module_id, batchName.trim());
          createdBatchId = batch.batch_id;
          console.log('[handleSaveModule] ✅ 批次创建成功:', createdBatchId);
          
          // 如果有预览数据，保存 parsed_data
          if (previewNormalizedData && previewNormalizedData.items && previewNormalizedData.items.length > 0) {
            console.log('[handleSaveModule] 💾 保存 parsed_data...', previewNormalizedData.items.length, '条');
            try {
              const saveResult = await saveParsedDataToBatch(
                module.module_id,
                createdBatchId,
                previewNormalizedData.items
              );
              savedItemCount = saveResult.item_count;
              console.log('[handleSaveModule] ✅ parsed_data 保存成功:', savedItemCount, '条');
            } catch (saveErr) {
              console.error('[handleSaveModule] ⚠️ 保存 parsed_data 失败:', saveErr);
              alert(`⚠️ 模块和批次已创建，但保存解析数据失败：\n${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n\n您可以稍后在工作流中重新保存数据。`);
            }
          }
        } catch (err) {
          console.error('[handleSaveModule] ❌ 创建批次失败:', err);
          alert(`⚠️ 模块已创建，但批次创建失败：\n${err instanceof Error ? err.message : String(err)}`);
        }
      }
      
      if (onModuleCreated) {
        onModuleCreated(module.module_id);
      }
      
      // 显示成功消息
      let successMessage = '✅ 模块保存成功！';
      if (createdBatchId) {
        successMessage += `\n\n📦 批次已创建`;
        if (savedItemCount > 0) {
          successMessage += `\n💾 已保存 ${savedItemCount} 条解析数据到 parsed_data`;
        }
      } else {
        successMessage += '\n\n💡 提示：输入批次名称可自动创建批次并保存数据';
      }
      
      alert(successMessage);
      
      if (onClose) {
        onClose();
      }
    } catch (err: any) {
      setError(err.message || '保存模块失败');
    } finally {
      setIsLoading(false);
    }
  };
  
  // 添加Header
  const handleAddHeader = () => {
    setHeaders([...headers, { key: '', value: '', visible: false }]);
  };
  
  // 删除Header
  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };
  
  // 更新Header
  const handleUpdateHeader = (index: number, field: 'key' | 'value' | 'visible', value: any) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    setHeaders(newHeaders);
  };
  
  // 生成CSS选择器（更智能的路径生成）
  const generateSelector = (element: HTMLElement): string => {
    // 优先使用ID
    if (element.id) {
      return `#${element.id}`;
    }
    
    // 使用class（过滤掉动态类名）
    const classes = Array.from(element.classList).filter(c => {
      return c && 
        !c.startsWith('hover:') && 
        !c.startsWith('focus:') && 
        !c.startsWith('dark:') &&
        c.length > 1;
    });
    
    if (classes.length > 0) {
      // 使用最具体的class（通常是最短的，因为更具体）
      const bestClass = classes.sort((a, b) => a.length - b.length)[0];
      const tagName = element.tagName.toLowerCase();
      
      // 检查这个选择器是否唯一（在iframe中）
      try {
        const iframeDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
        if (iframeDoc) {
          const testSelector = `${tagName}.${bestClass}`;
          const matches = iframeDoc.querySelectorAll(testSelector);
          if (matches && matches.length === 1) {
            return testSelector;
          }
          // 如果多个匹配，尝试使用所有class
          if (classes.length > 1) {
            return `.${classes.join('.')}`;
          }
          return `.${bestClass}`;
        }
      } catch {
        // 如果检查失败，使用最佳class
        if (classes.length > 1) {
          return `.${classes.join('.')}`;
        }
        return `.${bestClass}`;
      }
    }
    
    // 使用标签名和父元素
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    
    if (parent) {
      // 检查是否有相同标签的兄弟元素
      const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
      if (siblings.length > 1) {
        // 尝试使用nth-child
        const index = Array.from(parent.children).indexOf(element) + 1;
        return `${tagName}:nth-child(${index})`;
      }
      
      // 如果父元素有class或id，可以组合使用
      if (parent.id) {
        return `#${parent.id} > ${tagName}`;
      }
      const parentClasses = Array.from(parent.classList).filter(c => c && c.length > 1);
      if (parentClasses.length > 0) {
        return `.${parentClasses[0]} > ${tagName}`;
      }
    }
    
    return tagName;
  };
  
  // 处理元素选择
  const handleElementSelect = (element: HTMLElement, type: 'item' | 'title' | 'content') => {
    const selector = generateSelector(element);
    
    // 提取元素的文本预览
    const elementText = element.textContent || '';
    const cleanText = elementText.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
    
    const elementHtml = element.outerHTML;
    
    console.log('[标记系统] 生成选择器:', {
      type,
      selector,
      element: {
        tagName: element.tagName,
        className: element.className,
        id: element.id,
        textLength: cleanText.length,
        textPreview: cleanText.substring(0, 100)
      }
    });
    
    // 构建新的选择器集合（用于立即触发预览）
    const newSelectedElements = {
      ...selectedElements,
      [type]: selector
    };
    
    // 保存元素预览
    const newElementPreview = {
      ...elementPreview,
      [type]: {
        text: cleanText,
        html: elementHtml
      }
    };
    
    setSelectedElements(newSelectedElements);
    setElementPreview(newElementPreview);
    
    // 自动更新配置
    if (type === 'item') {
      setItemSelector(selector);
      setNormalizeFormat('list');
    } else if (type === 'title') {
      setTitleSelector(selector);
    } else if (type === 'content') {
      setContentSelector(selector);
    }
    
    setIsSelecting(false);
    setSelectionType(null);
    
    // 显示成功提示
    const typeText = type === 'item' ? '数据项' : type === 'title' ? '标题' : '内容';
    console.log(`[标记系统] ✅ ${typeText}标记成功！选择器: ${selector}, 文本长度: ${cleanText.length}`);
    
    // 标记后立即触发实时解析预览，传递新的选择器
    console.log('[标记系统] 触发预览，新选择器集合:', newSelectedElements);
    triggerPreviewNormalize(newSelectedElements);
  };
  
  // 实时解析预览（当选择器改变时）
  const triggerPreviewNormalize = async (overrideSelectors?: { item?: string; title?: string; content?: string }) => {
    if (!crawlResult || !crawlResult.success) return;
    
    // 使用传入的选择器覆盖，否则使用当前状态
    const currentSelectors = overrideSelectors || selectedElements;
    
    // 构建标准化配置
    const finalItemSelector = currentSelectors.item || itemSelector;
    const finalTitleSelector = currentSelectors.title || titleSelector;
    const finalContentSelector = currentSelectors.content || contentSelector;
    
    console.log('[预览系统] 使用选择器:', {
      finalItemSelector,
      finalTitleSelector,
      finalContentSelector
    });
    
    // 如果没有标记任何选择器，不进行预览
    if (!finalItemSelector && !finalTitleSelector && !finalContentSelector) {
      console.log('[预览系统] 没有选择器，跳过预览');
      setPreviewNormalizedData(null);
      return;
    }
    
    setIsPreviewingNormalized(true);
    
    try {
      const normalizeConfig: NormalizeConfig = {
        format: normalizeFormat,
      };
      
      if (normalizeFormat === 'list') {
        // 只有非空时才添加选择器
        if (finalItemSelector) normalizeConfig.item_selector = finalItemSelector;
        if (finalTitleSelector) normalizeConfig.title_selector = finalTitleSelector;
        if (finalContentSelector) normalizeConfig.content_selector = finalContentSelector;
        
        // 如果标题和内容选择器都为空，显式设置为空字符串以触发简化模式
        if (!finalTitleSelector && !finalContentSelector) {
          normalizeConfig.title_selector = '';
          normalizeConfig.content_selector = '';
          // 添加分割规则（只有在需要分割时才传递）
          if (splitStrategy !== 'none') {
            normalizeConfig.split_strategy = splitStrategy;
            if (splitPattern) {
              normalizeConfig.split_pattern = splitPattern;
            }
          }
          console.log('[预览系统] 🚀 使用简化模式（无标题和内容选择器）', {
            split_strategy: splitStrategy,
            split_pattern: splitPattern
          });
        }
      } else if (normalizeFormat === 'table') {
        if (finalItemSelector) normalizeConfig.table_selector = finalItemSelector;
      } else if (normalizeFormat === 'article') {
        if (finalTitleSelector) normalizeConfig.title_selector = finalTitleSelector;
        if (finalContentSelector) normalizeConfig.content_selector = finalContentSelector;
      }
      
      console.log('[预览系统] 📤 调用 previewNormalize API, 配置:', normalizeConfig);
      const result = await previewNormalize(crawlResult, normalizeConfig);
      console.log('[预览系统] 📥 API 返回结果:', { success: result.success, hasNormalized: !!result.normalized });
      
      if (result.success && result.normalized) {
        console.log('[预览系统] 预览数据:', {
          format: result.normalized.format,
          itemCount: result.normalized.items?.length || 0,
          firstItem: result.normalized.items?.[0],
        });
        
        // 检查第一个 item 的 content 是否为空
        if (result.normalized.items && result.normalized.items.length > 0) {
          const firstItem = result.normalized.items[0];
          console.log('[CrawlerTestPage] First item detail:', {
            title: firstItem.title,
            titleLength: firstItem.title?.length || 0,
            content: firstItem.content?.substring(0, 200),
            contentLength: firstItem.content?.length || 0,
            hasContent: !!firstItem.content,
          });
          
          // 如果 content 为空，输出警告
          if (!firstItem.content || firstItem.content.trim() === '') {
            console.warn('[CrawlerTestPage] ⚠️ WARNING: First item has empty content!', firstItem);
          }
        }
        
        setPreviewNormalizedData(result.normalized);
        console.log('[预览系统] ✅ 预览成功，数据已设置');
      } else {
        console.log('[预览系统] ❌ 预览结果为空或失败');
        setPreviewNormalizedData(null);
      }
    } catch (error) {
      console.error('[预览系统] ❌ 预览解析错误:', error);
      setPreviewNormalizedData(null);
      setError(`预览失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsPreviewingNormalized(false);
    }
  };
  
  // 当选择器或格式改变时，触发预览
  useEffect(() => {
    if (crawlResult && crawlResult.success) {
      triggerPreviewNormalize();
    }
  }, [selectedElements, itemSelector, titleSelector, contentSelector, normalizeFormat]);
  
  // 处理iframe加载和交互
  useEffect(() => {
    if (!iframeRef.current || !crawlResult?.content?.html) return;
    
    const iframe = iframeRef.current;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;
    
    let html = crawlResult.content.html;
    
    // 确保HTML有正确的charset声明和完整的HTML结构
    const htmlLower = html.toLowerCase();
    
    // 如果HTML不完整，包装在完整的结构中
    if (!htmlLower.includes('<html')) {
      html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 20px; }
    * { box-sizing: border-box; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
    } else {
      // 确保有charset声明
      if (!htmlLower.includes('charset')) {
        if (htmlLower.includes('<head>')) {
          html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
        } else if (htmlLower.includes('<html>')) {
          html = html.replace(/<html[^>]*>/i, (match) => {
            return match + '<head><meta charset="utf-8"></head>';
          });
        }
      }
    }
    
    // 写入HTML到iframe
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
    
    // 添加点击事件监听（用于标记元素）
    const handleIframeClick = (e: MouseEvent) => {
      if (!isSelecting || !selectionType) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation(); // 阻止其他监听器
      const target = e.target as HTMLElement;
      console.log('[标记系统] 点击元素:', {
        tagName: target.tagName,
        className: target.className,
        id: target.id,
        textContent: target.textContent?.substring(0, 50)
      });
      if (target) {
        handleElementSelect(target, selectionType);
      }
      return false;
    };
    
    // 使用捕获阶段，优先级最高
    iframeDoc.addEventListener('click', handleIframeClick, { capture: true, passive: false });
    
    // 添加鼠标悬停效果
    const handleIframeMouseOver = (e: MouseEvent) => {
      if (!isSelecting || !selectionType) return;
      const target = e.target as HTMLElement;
      if (target && !target.hasAttribute('data-highlighted')) {
        const color = selectionType === 'item' ? 'blue' : selectionType === 'title' ? 'green' : 'purple';
        target.style.outline = `2px solid ${color}`;
        target.style.cursor = 'pointer';
        target.style.transition = 'all 0.1s';
      }
    };
    
    const handleIframeMouseOut = (e: MouseEvent) => {
      if (!isSelecting) return;
      const target = e.target as HTMLElement;
      if (target && !target.hasAttribute('data-highlighted')) {
        target.style.outline = '';
        target.style.cursor = '';
      }
    };
    
    iframeDoc.addEventListener('mouseover', handleIframeMouseOver, true);
    iframeDoc.addEventListener('mouseout', handleIframeMouseOut, true);
    
    return () => {
      iframeDoc.removeEventListener('click', handleIframeClick, { capture: true } as any);
      iframeDoc.removeEventListener('mouseover', handleIframeMouseOver, true);
      iframeDoc.removeEventListener('mouseout', handleIframeMouseOut, true);
    };
  }, [crawlResult, isSelecting, selectionType]);
  
  // 渲染HTML预览（可交互）
  const renderInteractivePreview = () => {
    if (!crawlResult?.content?.html) return null;
    
    return (
      <div className="space-y-2">
        {isSelecting && selectionType && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 p-3 rounded-lg">
            <div className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
              🔍 标记模式已激活
            </div>
            <div className="text-xs text-yellow-700 dark:text-yellow-300">
              • 当前标记类型：<strong>{selectionType === 'item' ? '数据项（列表项外层容器）' : selectionType === 'title' ? '标题元素' : '内容元素'}</strong>
              <br />
              • 鼠标悬停会显示<span className={`inline-block w-3 h-3 border-2 mx-1 ${selectionType === 'item' ? 'border-blue-500' : selectionType === 'title' ? 'border-green-500' : 'border-purple-500'}`}></span>彩色边框
              <br />
              • 点击元素完成标记，或点击"取消标记"退出
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="w-full border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
          style={{ 
            height: '600px',
            minHeight: '400px',
            pointerEvents: isSelecting ? 'auto' : 'none' // 选择模式下启用交互
          }}
          sandbox="allow-same-origin allow-scripts"
          title="HTML Preview"
        />
      </div>
    );
  };
  
  // 渲染标准化数据项预览
  const renderItemsPreview = () => {
    if (!crawlResult?.normalized?.items) return null;
    
    const items = crawlResult.normalized.items;
    
      return (
      <div className="space-y-3 max-h-[600px] overflow-auto">
        {items.slice(0, 20).map((item: any, index: number) => (
          <div 
            key={item.id || index}
            className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800"
          >
            {item.title && (
              <div className="font-semibold text-sm mb-1 text-gray-900 dark:text-gray-100">
                {item.title}
              </div>
            )}
            {item.content && (
              <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3">
                {item.content.substring(0, 200)}{item.content.length > 200 ? '...' : ''}
              </div>
            )}
            {item.metadata && Object.keys(item.metadata).length > 0 && (
              <div className="mt-2 text-xs text-gray-500">
                {Object.entries(item.metadata).slice(0, 3).map(([key, value]) => (
                  <span key={key} className="mr-2">
                    {key}: {String(value).substring(0, 30)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {items.length > 20 && (
          <div className="text-xs text-gray-500 text-center">
            还有 {items.length - 20} 条数据...
          </div>
        )}
      </div>
    );
  };
  
  return (
    <div className="crawler-test-page fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="crawler-test-panel bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="crawler-test-header flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2">
            <Globe className="w-6 h-6 text-blue-500 crawler-test-header-icon" />
            <h2 className="crawler-test-title text-xl font-semibold">爬虫测试与配置</h2>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="crawler-test-close p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        
        {/* 内容区域 */}
        <div className="crawler-test-content flex-1 overflow-y-auto p-6 space-y-4">
          {/* URL输入 */}
          <div className="crawler-test-section">
            <label className="crawler-test-label block text-sm font-medium mb-2">目标URL *</label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="input-field flex-1"
              />
              <Button
                onClick={handleTestCrawl}
                disabled={isLoading || !url.trim()}
                variant="primary"
                className="crawler-test-btn-primary"
              >
                {isLoading ? (
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                <span>测试爬取</span>
              </Button>
            </div>
          </div>
          
          {/* 错误提示 */}
          {error && (
            <div className="crawler-test-error bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start space-x-2">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            </div>
          )}
          
          {/* 认证配置 */}
          <div className="crawler-test-block border border-gray-200 dark:border-gray-700 rounded-lg">
            <button
              onClick={() => setShowAuthConfig(!showAuthConfig)}
              className="crawler-test-block-toggle w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span className="font-medium">认证配置</span>
              {showAuthConfig ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            
            {showAuthConfig && (
              <div className="crawler-test-block-body p-4 space-y-4 border-t border-gray-200 dark:border-gray-700">
                {/* Cookie输入 */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Cookie
                    <span className="text-xs text-gray-500 ml-2">
                      从浏览器开发者工具复制，格式：key1=value1; key2=value2
                    </span>
                  </label>
                  <textarea
                    value={cookieString}
                    onChange={(e) => setCookieString(e.target.value)}
                    placeholder="session=abc123; token=xyz789"
                    className="input-field font-mono text-sm"
                    rows={3}
                  />
                </div>
                
                {/* Headers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">Headers</label>
                    <Button
                      onClick={handleAddHeader}
                      variant="secondary"
                      size="sm"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      <span>添加</span>
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {headers.map((header, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={header.key}
                          onChange={(e) => handleUpdateHeader(index, 'key', e.target.value)}
                          placeholder="Header名称"
                          className="input-field flex-1 text-sm"
                        />
                        <div className="flex-1 relative">
                          <input
                            type={header.visible ? 'text' : 'password'}
                            value={header.value}
                            onChange={(e) => handleUpdateHeader(index, 'value', e.target.value)}
                            placeholder="Header值"
                            className="input-field w-full text-sm pr-8"
                          />
                          <button
                            onClick={() => handleUpdateHeader(index, 'visible', !header.visible)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          >
                            {header.visible ? (
                              <EyeOff className="w-4 h-4 text-gray-500" />
                            ) : (
                              <Eye className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                        </div>
                        <button
                          onClick={() => handleRemoveHeader(index)}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* User-Agent */}
                <div>
                  <label className="block text-sm font-medium mb-2">User-Agent</label>
                  <select
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    className="input-field"
                  >
                    <option value="default">默认</option>
                    <option value="chrome-win">Chrome (Windows)</option>
                    <option value="chrome-mac">Chrome (Mac)</option>
                    <option value="firefox">Firefox</option>
                    <option value="safari">Safari</option>
                    <option value="custom">自定义</option>
                  </select>
                  {userAgent === 'custom' && (
                    <input
                      type="text"
                      value={customUserAgent}
                      onChange={(e) => setCustomUserAgent(e.target.value)}
                      placeholder="自定义User-Agent"
                      className="input-field mt-2"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* 高级选项 */}
          <div className="crawler-test-block border border-gray-200 dark:border-gray-700 rounded-lg">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="crawler-test-block-toggle w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span className="font-medium">高级选项</span>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            
            {showAdvanced && (
              <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <label className="block text-sm font-medium mb-2">超时时间（秒）</label>
                  <input
                    type="number"
                    value={timeout}
                    onChange={(e) => setTimeout(parseInt(e.target.value) || 30)}
                    min={1}
                    max={300}
                    className="input-field"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="force-dynamic"
                    checked={forceDynamic}
                    onChange={(e) => setForceDynamic(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="force-dynamic" className="text-sm">强制使用动态渲染</label>
                </div>
                {forceDynamic && (
                  <div>
                    <label className="block text-sm font-medium mb-2">等待选择器（CSS选择器）</label>
                    <input
                      type="text"
                      value={waitFor}
                      onChange={(e) => setWaitFor(e.target.value)}
                      placeholder=".main-content"
                      className="input-field"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* 爬取结果预览 */}
          {crawlResult && (
            <div className="crawler-test-block border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="crawler-test-block-body p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">爬取结果预览</span>
                  {crawlResult.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                </div>
                
                {/* 预览模式切换 */}
                {crawlResult.success && (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setPreviewMode('summary')}
                      className={`px-2 py-1 text-xs rounded ${
                        previewMode === 'summary'
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      摘要
                    </button>
                    <button
                      onClick={() => setPreviewMode('html')}
                      className={`px-2 py-1 text-xs rounded ${
                        previewMode === 'html'
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      HTML预览
                    </button>
                    {(previewNormalizedData || crawlResult.normalized) && (
                      <button
                        onClick={() => setPreviewMode('items')}
                        className={`px-2 py-1 text-xs rounded ${
                          previewMode === 'items'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        数据项 ({previewNormalizedData?.total_count || crawlResult.normalized?.total_count || 0})
                      </button>
                    )}
                  </div>
                )}
              </div>
              
              {crawlResult.success && (
                <div className="p-4">
                  {previewMode === 'summary' && (
                    <div className="space-y-3">
                      {/* 基本信息 */}
                    <div className="space-y-2">
                      <div>
                        <span className="text-sm font-medium">标题：</span>
                        <span className="text-sm ml-2">{crawlResult.title || '无'}</span>
                      </div>
                      <div>
                        <span className="text-sm font-medium">正文长度：</span>
                        <span className="text-sm ml-2">{crawlResult.content?.text.length || 0} 字符</span>
                      </div>
                      <div>
                        <span className="text-sm font-medium">统计：</span>
                        <span className="text-sm ml-2">
                          字数 {crawlResult.stats?.word_count || 0}，图片 {crawlResult.stats?.image_count || 0}，链接 {crawlResult.stats?.link_count || 0}
                        </span>
                      </div>
                      {(previewNormalizedData || crawlResult.normalized) && (
                        <div>
                          <span className="text-sm font-medium">标准化数据：</span>
                          <span className="text-sm ml-2">
                            {previewNormalizedData?.total_count || crawlResult.normalized?.total_count || 0} 条数据项，格式：{previewNormalizedData?.format || crawlResult.normalized?.format || 'unknown'}
                            {previewNormalizedData && (
                              <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">（实时预览）</span>
                            )}
                          </span>
                        </div>
                      )}
                      </div>

                      {/* 正文预览 */}
                      {crawlResult.content?.text && (
                        <div className="mt-3">
                          <span className="text-sm font-medium block mb-1">正文预览：</span>
                          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                            {crawlResult.content.text.substring(0, 500)}
                            {crawlResult.content.text.length > 500 && '...'}
                          </div>
                        </div>
                      )}

                      {/* 图片预览 */}
                      {crawlResult.images && crawlResult.images.length > 0 && (
                        <div className="mt-3">
                          <span className="text-sm font-medium block mb-2">
                            图片预览 ({crawlResult.images.length} 张)：
                          </span>
                          <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                            {crawlResult.images.slice(0, 9).map((img, index) => (
                              <div
                                key={index}
                                className="relative group cursor-pointer border border-gray-200 dark:border-gray-700 rounded overflow-hidden bg-gray-100 dark:bg-gray-800"
                                onClick={() => window.open(img.url, '_blank')}
                                title={img.alt || img.title || img.url}
                              >
                                <img
                                  src={img.url}
                                  alt={img.alt || `图片 ${index + 1}`}
                                  className="w-full h-20 object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                  }}
                                />
                                <div className="hidden absolute inset-0 flex items-center justify-center text-xs text-gray-500 p-1 break-all">
                                  {img.url.substring(0, 30)}...
                                </div>
                                {img.alt && (
                                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                    {img.alt}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          {crawlResult.images.length > 9 && (
                            <div className="text-xs text-gray-500 mt-1 text-center">
                              还有 {crawlResult.images.length - 9} 张图片...
                            </div>
                          )}
                        </div>
                      )}

                      {/* 链接预览 */}
                      {crawlResult.links && crawlResult.links.length > 0 && (
                        <div className="mt-3">
                          <span className="text-sm font-medium block mb-2">
                            链接预览 ({crawlResult.links.length} 个)：
                          </span>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {crawlResult.links.slice(0, 10).map((link, index) => (
                              <a
                                key={index}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center space-x-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 group"
                              >
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  link.type === 'internal' ? 'bg-green-500' : 'bg-blue-500'
                                }`} title={link.type === 'internal' ? '内部链接' : '外部链接'} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {link.text || link.url}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {link.url}
                                  </div>
                                </div>
                                <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-blue-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </a>
                            ))}
                          </div>
                          {crawlResult.links.length > 10 && (
                            <div className="text-xs text-gray-500 mt-1 text-center">
                              还有 {crawlResult.links.length - 10} 个链接...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {previewMode === 'html' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">HTML结构预览（点击元素进行标记）</span>
                        <div className="flex items-center space-x-2">
                          {!isSelecting ? (
                            <>
                              <button
                                onClick={() => {
                                  setIsSelecting(true);
                                  setSelectionType('item');
                                }}
                                className="px-2 py-1 text-xs bg-blue-500 text-white rounded flex items-center space-x-1"
                                title="标记数据项"
                              >
                                <Tag className="w-3 h-3" />
                                <span>标记项</span>
                              </button>
                              <button
                                onClick={() => {
                                  setIsSelecting(true);
                                  setSelectionType('title');
                                }}
                                className="px-2 py-1 text-xs bg-green-500 text-white rounded flex items-center space-x-1"
                                title="标记标题"
                              >
                                <Tag className="w-3 h-3" />
                                <span>标记标题</span>
                              </button>
                              <button
                                onClick={() => {
                                  setIsSelecting(true);
                                  setSelectionType('content');
                                }}
                                className="px-2 py-1 text-xs bg-purple-500 text-white rounded flex items-center space-x-1"
                                title="标记内容"
                              >
                                <Tag className="w-3 h-3" />
                                <span>标记内容</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setIsSelecting(false);
                                setSelectionType(null);
                              }}
                              className="px-2 py-1 text-xs bg-gray-500 text-white rounded"
                            >
                              取消标记
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {isSelecting && selectionType && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-2 text-xs">
                          <MousePointer className="w-4 h-4 inline mr-1" />
                          点击页面中的元素来标记为 <strong>{selectionType === 'item' ? '数据项' : selectionType === 'title' ? '标题' : '内容'}</strong>
                        </div>
                      )}
                      
                      {(selectedElements.item || selectedElements.title || selectedElements.content) && (
                        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-3 space-y-3">
                          <div className="text-xs font-semibold text-green-700 dark:text-green-300 mb-2 flex items-center space-x-2">
                            <span className="text-lg">✅</span>
                            <span>已标记的选择器</span>
                          </div>
                          
                          {selectedElements.item && (
                            <div className="space-y-2">
                            <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center space-x-2">
                              <span className="font-medium w-20">数据项：</span>
                                <code className="flex-1 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded font-mono text-xs">{selectedElements.item}</code>
                              <button
                                onClick={() => {
                                  setSelectedElements(prev => {
                                    const newSel = { ...prev };
                                    delete newSel.item;
                                    return newSel;
                                  });
                                    setElementPreview(prev => {
                                      const newPreview = { ...prev };
                                      delete newPreview.item;
                                      return newPreview;
                                  });
                                  setItemSelector('');
                                }}
                                className="text-red-500 hover:text-red-700"
                                title="清除"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              </div>
                              
                              {/* 元素预览 */}
                              {elementPreview.item && (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2 space-y-2">
                                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center justify-between">
                                    <span>📄 元素文本预览（原始内容）：</span>
                                    <span className="text-gray-500 font-normal">{elementPreview.item.text.length} 字符</span>
                                  </div>
                                  <div className="text-xs text-gray-600 dark:text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-2 rounded font-mono">
                                    {elementPreview.item.text.substring(0, 500)}
                                    {elementPreview.item.text.length > 500 && '\n...(更多内容已省略)'}
                                  </div>
                                  
                                  {/* 分割预览 */}
                                  {splitPreview && splitStrategy !== 'none' && (
                                    <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                          ✂️ 分割后预览
                                        </div>
                                        <div className={`text-xs px-2 py-0.5 rounded ${
                                          splitPreview.success 
                                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' 
                                            : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                                        }`}>
                                          {splitPreview.message}
                                        </div>
                                      </div>
                                      
                                      {splitPreview.subItems && splitPreview.subItems.length > 0 ? (
                                        <div className="space-y-2">
                                          <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                            将生成 <span className="font-bold text-blue-600 dark:text-blue-400">{splitPreview.totalCount}</span> 条数据
                                            {splitPreview.totalCount && splitPreview.totalCount > 3 && ' (仅显示前3条)'}:
                                          </div>
                                          
                                          {splitPreview.subItems.map((item, idx) => (
                                            <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded p-2 bg-gray-50 dark:bg-gray-800">
                                              <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                                                数据项 #{idx + 1}
                                              </div>
                                              <div className="space-y-1">
                                                <div>
                                                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">标题: </span>
                                                  <span className="text-xs text-gray-600 dark:text-gray-400">
                                                    {item.title || <span className="italic text-gray-400">(空)</span>}
                                                  </span>
                                                </div>
                                                <div>
                                                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">内容: </span>
                                                  <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-20 overflow-y-auto">
                                                    {item.content.substring(0, 150)}
                                                    {item.content.length > 150 && '...'}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  )}
                                  
                                  <details className="mt-2">
                                    <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
                                      查看 HTML 结构
                                    </summary>
                                    <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto font-mono mt-1">
                                      <code>{elementPreview.item.html.substring(0, 600)}{elementPreview.item.html.length > 600 ? '\n...' : ''}</code>
                                    </pre>
                                  </details>
                                </div>
                              )}
                            </div>
                          )}
                          {selectedElements.title && (
                            <div className="space-y-2">
                            <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center space-x-2">
                              <span className="font-medium w-20">标题：</span>
                                <code className="flex-1 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded font-mono text-xs">{selectedElements.title}</code>
                              <button
                                onClick={() => {
                                  setSelectedElements(prev => {
                                    const newSel = { ...prev };
                                    delete newSel.title;
                                    return newSel;
                                  });
                                    setElementPreview(prev => {
                                      const newPreview = { ...prev };
                                      delete newPreview.title;
                                      return newPreview;
                                  });
                                  setTitleSelector('');
                                }}
                                className="text-red-500 hover:text-red-700"
                                title="清除"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              </div>
                              {elementPreview.title && (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2">
                                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                    📄 提取的标题文本：
                                  </div>
                                  <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                    {elementPreview.title.text.substring(0, 200)}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {selectedElements.content && (
                            <div className="space-y-2">
                            <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center space-x-2">
                              <span className="font-medium w-20">内容：</span>
                                <code className="flex-1 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded font-mono text-xs">{selectedElements.content}</code>
                              <button
                                onClick={() => {
                                  setSelectedElements(prev => {
                                    const newSel = { ...prev };
                                    delete newSel.content;
                                    return newSel;
                                  });
                                    setElementPreview(prev => {
                                      const newPreview = { ...prev };
                                      delete newPreview.content;
                                      return newPreview;
                                  });
                                  setContentSelector('');
                                }}
                                className="text-red-500 hover:text-red-700"
                                title="清除"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              </div>
                              {elementPreview.content && (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2">
                                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center justify-between">
                                    <span>📄 提取的内容文本：</span>
                                    <span className="text-gray-500 font-normal">{elementPreview.content.text.length} 字符</span>
                                  </div>
                                  <div className="text-xs text-gray-600 dark:text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                    {elementPreview.content.text.substring(0, 300)}
                                    {elementPreview.content.text.length > 300 && '\n...'}
                                  </div>
                            </div>
                          )}
                            </div>
                          )}
                          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <div className="text-xs space-y-1">
                              {(!titleSelector && !contentSelector && itemSelector) ? (
                                <div className="text-green-600 dark:text-green-400 font-semibold flex items-center space-x-1">
                                  <span>🚀</span>
                                  <span>简化模式已启用 - 将自动提取上方预览的完整文本内容</span>
                                </div>
                              ) : (
                                <div className="text-gray-600 dark:text-gray-400">
                                  💡 查看后端日志的"Extraction Summary"可以了解选择器匹配情况
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {renderInteractivePreview()}
                    </div>
                  )}
                  
                  {previewMode === 'items' && (
                    <div>
                      {/* 优先显示实时解析预览 */}
                      {previewNormalizedData ? (
                        <>
                          <div className="text-sm font-medium mb-2 flex items-center space-x-2">
                            <span>实时解析的数据项（共 {previewNormalizedData.total_count} 条）</span>
                            {isPreviewingNormalized && (
                              <Loader className="w-3 h-3 animate-spin text-blue-500" />
                            )}
                          </div>
                          <div className="space-y-3 max-h-[600px] overflow-auto">
                            {previewNormalizedData.items.slice(0, 10).map((item: any, index: number) => (
                              <div 
                                key={item.id || index}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                              >
                                {/* 数据预览 */}
                                <div className="p-3 bg-white dark:bg-gray-800">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-mono text-gray-500">Item #{index + 1}</span>
                                    {item.html && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const htmlElem = document.getElementById(`html-debug-${index}`);
                                          if (htmlElem) {
                                            htmlElem.style.display = htmlElem.style.display === 'none' ? 'block' : 'none';
                                          }
                                        }}
                                        className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                      >
                                        🔍 查看 HTML
                                      </button>
                                    )}
                                  </div>
                                  {item.title ? (
                                  <div className="font-semibold text-sm mb-1 text-gray-900 dark:text-gray-100">
                                    {item.title}
                                  </div>
                                  ) : (
                                    <div className="text-sm mb-1 text-yellow-600 dark:text-yellow-400">
                                      ⚠️ 标题为空
                                  </div>
                                )}
                                  {item.content && item.content.trim() !== '' ? (
                                    <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
                                      {item.content}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-red-500 dark:text-red-400 italic">
                                      ⚠️ 内容为空 - 请检查后端日志和下方 HTML 结构
                                  </div>
                                )}
                                {item.metadata && Object.keys(item.metadata).length > 0 && (
                                  <div className="mt-2 text-xs text-gray-500">
                                    {Object.entries(item.metadata).slice(0, 3).map(([key, value]) => (
                                      <span key={key} className="mr-2">
                                        {key}: {String(value).substring(0, 30)}
                                      </span>
                                    ))}
                                    </div>
                                  )}
                                </div>
                                
                                {/* HTML 结构调试 */}
                                {item.html && (
                                  <div 
                                    id={`html-debug-${index}`}
                                    className="border-t border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900"
                                    style={{ display: 'none' }}
                                  >
                                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center justify-between">
                                      <span>原始 HTML 结构：</span>
                                      <span className="text-gray-500 font-normal">（前 600 字符）</span>
                                    </div>
                                    <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto font-mono">
                                      <code>{item.html.substring(0, 600)}{item.html.length > 600 ? '\n...(更多内容已省略)' : ''}</code>
                                    </pre>
                                    <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                                      💡 如果选择器不匹配，检查这个 HTML 结构，确认您的 CSS 选择器是否正确
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                            {previewNormalizedData.items.length > 10 && (
                              <div className="text-xs text-gray-500 text-center py-2">
                                仅显示前 10 条，共 {previewNormalizedData.items.length} 条
                              </div>
                            )}
                          </div>
                          {/* 生成并保存按钮 */}
                          {previewNormalizedData && previewNormalizedData.items.length > 0 ? (
                            moduleId && batchId ? (
                            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                              <Button
                                onClick={async () => {
                                  if (!moduleId || !batchId || !previewNormalizedData) {
                                    console.error('[CrawlerTestPage] Missing required data:', { moduleId, batchId, previewNormalizedData });
                                    setError('缺少必要的数据（模块ID、批次ID或预览数据）');
                                    return;
                                  }
                                  
                                  console.log('[CrawlerTestPage] 📤 准备保存 parsed_data:', {
                                    moduleId,
                                    batchId,
                                    itemsCount: previewNormalizedData.items.length,
                                    totalCount: previewNormalizedData.total_count,
                                    format: previewNormalizedData.format,
                                    sampleItem: previewNormalizedData.items[0],
                                  });
                                  
                                  setIsLoading(true);
                                  setError(null);
                                  try {
                                    // 使用新的 saveParsedDataToBatch 接口
                                    console.log('[CrawlerTestPage] 🚀 调用 saveParsedDataToBatch API...');
                                    console.log('[CrawlerTestPage] 📊 传递的数据项数量:', previewNormalizedData.items.length);
                                    
                                    const saveResult = await saveParsedDataToBatch(
                                      moduleId, 
                                      batchId, 
                                      previewNormalizedData.items
                                    );
                                    
                                    console.log('[CrawlerTestPage] ✅ API 返回结果:', saveResult);
                                    
                                    if (saveResult.item_count !== previewNormalizedData.items.length) {
                                      console.warn('[CrawlerTestPage] ⚠️ 保存数量不匹配!', {
                                        expected: previewNormalizedData.items.length,
                                        actual: saveResult.item_count
                                      });
                                      alert(`⚠️ 数据已保存，但数量不匹配！\n预期: ${previewNormalizedData.items.length} 条\n实际: ${saveResult.item_count} 条\n\n${saveResult.message || ''}`);
                                    } else {
                                      console.log('[CrawlerTestPage] 🎉 保存成功，数量匹配!');
                                      alert(`✅ 已成功保存 ${saveResult.item_count} 条解析数据！\n\n${saveResult.message || ''}`);
                                    }
                                    
                                    // 保存成功后，重新加载批次数据以获取最新的 parsed_data
                                    if (moduleId && batchId) {
                                      try {
                                        const { getBatch } = await import('../services/crawlerApi');
                                        const updatedBatch = await getBatch(moduleId, batchId);
                                        if (updatedBatch && updatedBatch.parsed_data) {
                                          console.log('[CrawlerTestPage] Reloaded batch with parsed_data:', updatedBatch.parsed_data);
                                          // 更新预览数据以反映保存后的状态
                                          if (Array.isArray(updatedBatch.parsed_data)) {
                                            const normalizedData = {
                                              items: updatedBatch.parsed_data.map((item, index) => ({
                                                id: `item_${index + 1}`,
                                                title: item.title || '',
                                                content: item.content || ''
                                              })),
                                              total_count: updatedBatch.parsed_data.length,
                                              format: 'list'
                                            };
                                            setPreviewNormalizedData(normalizedData);
                                          }
                                        }
                                      } catch (reloadErr) {
                                        console.error('[CrawlerTestPage] Failed to reload batch data:', reloadErr);
                                      }
                                    }
                                  } catch (err: any) {
                                    console.error('[CrawlerTestPage] Failed to save parsed data:', err);
                                    setError(err.message || '保存解析数据失败');
                                    alert(`保存失败：${err.message || '未知错误'}`);
                                  } finally {
                                    setIsLoading(false);
                                  }
                                }}
                                disabled={isLoading}
                                variant="primary"
                                className="w-full"
                              >
                                {isLoading ? (
                                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <Code2 className="w-4 h-4 mr-2" />
                                )}
                                <span>生成并保存解析数据（{previewNormalizedData.total_count} 条）</span>
                              </Button>
                            </div>
                            ) : (
                              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
                                  <div className="flex items-start space-x-3">
                                    <div className="text-yellow-600 dark:text-yellow-400 text-2xl">⚠️</div>
                                    <div className="flex-1">
                                      <div className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                                        无法保存：需要先创建模块和批次
                                      </div>
                                      <div className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                                        <p>当前状态：</p>
                                        <ul className="list-disc list-inside pl-2">
                                          <li>模块ID: {moduleId ? `✅ ${moduleId}` : '❌ 未创建'}</li>
                                          <li>批次ID: {batchId ? `✅ ${batchId}` : '❌ 未创建'}</li>
                                        </ul>
                                        <p className="mt-3 font-medium">👉 请先点击底部的"保存模块"按钮创建模块和批次</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          ) : null}
                        </>
                      ) : crawlResult.normalized ? (
                        <>
                          <div className="text-sm font-medium mb-2">
                            提取的数据项（共 {crawlResult.normalized.total_count} 条）
                          </div>
                          {renderItemsPreview()}
                        </>
                      ) : (
                        <div className="text-sm text-gray-500 text-center py-8">
                          请先标记数据项、标题和内容选择器，然后查看实时解析预览
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* 模块配置 */}
          <div className="crawler-test-block border border-gray-200 dark:border-gray-700 rounded-lg">
            <button
              onClick={() => setShowModuleConfig(!showModuleConfig)}
              className="crawler-test-block-toggle w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span className="font-medium">模块配置</span>
              {showModuleConfig ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            
            {showModuleConfig && (
              <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <label className="block text-sm font-medium mb-2">模块名称 *</label>
                  <input
                    type="text"
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    placeholder="例如：新闻网站"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">模块描述</label>
                  <textarea
                    value={moduleDescription}
                    onChange={(e) => setModuleDescription(e.target.value)}
                    placeholder="模块描述（可选）"
                    className="input-field"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">批次名称</label>
                  <input
                    type="text"
                    value={batchName}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="例如：2024-01-01"
                    className="input-field"
                  />
                  <p className="text-xs text-gray-500 mt-1">默认为当前日期，用于区分不同时间的数据</p>
                </div>
              </div>
            )}
          </div>
          
          {/* 标准化配置 */}
          <div className="crawler-test-block border border-gray-200 dark:border-gray-700 rounded-lg">
            <button
              onClick={() => setShowNormalizeConfig(!showNormalizeConfig)}
              className="crawler-test-block-toggle w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span className="font-medium">标准化配置</span>
              {showNormalizeConfig ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            
            {showNormalizeConfig && (
              <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <label className="block text-sm font-medium mb-2">数据格式</label>
                  <select
                    value={normalizeFormat}
                    onChange={(e) => setNormalizeFormat(e.target.value as any)}
                    className="input-field"
                  >
                    <option value="article">文章（整篇文章作为一个数据项）</option>
                    <option value="list">列表（提取多个数据项）</option>
                    <option value="table">表格（提取表格数据）</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>
                
                {normalizeFormat === 'list' && (
                  <>
                    {/* 标记提示 */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs">
                      <div className="font-semibold text-blue-900 dark:text-blue-100 mb-2">📌 推荐方案：</div>
                      <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded p-2 mb-2">
                        <div className="font-semibold text-green-700 dark:text-green-300 mb-1 flex items-center space-x-2">
                          <span>🚀 简化模式（推荐）</span>
                          {(!titleSelector && !contentSelector && itemSelector) && (
                            <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">已启用</span>
                          )}
                        </div>
                        <div className="text-green-700 dark:text-green-300 text-xs">
                          只需标记<strong>项目（Item）</strong>，标题和内容选择器都留空，系统会自动提取每个 Item 的完整文本！
                          <br />
                          <strong>优势：</strong>不受动态加载影响，直接提取HTML中的所有文本内容。
                        </div>
                      </div>
                      <details className="cursor-pointer">
                        <summary className="font-medium text-blue-800 dark:text-blue-200">高级模式（手动指定选择器）</summary>
                        <ol className="list-decimal list-inside space-y-1 text-blue-800 dark:text-blue-200 mt-2">
                          <li><strong>项目（Item）</strong>：选择每个列表项的外层容器</li>
                          <li><strong>标题（Title）</strong>：选择标题元素（可选）</li>
                          <li><strong>内容（Content）</strong>：选择包含完整内容的元素（可选）</li>
                        </ol>
                      </details>
                    </div>
                    
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium">
                          项目选择器（CSS选择器）
                          <span className="text-red-500 ml-1">*必填</span>
                        </label>
                        {(titleSelector || contentSelector) && (
                          <button
                            onClick={() => {
                              setTitleSelector('');
                              setContentSelector('');
                              setSelectedElements(prev => {
                                const newSel = { ...prev };
                                delete newSel.title;
                                delete newSel.content;
                                return newSel;
                              });
                              setElementPreview(prev => {
                                const newPreview = { ...prev };
                                delete newPreview.title;
                                delete newPreview.content;
                                return newPreview;
                              });
                            }}
                            className="text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                          >
                            🚀 切换到简化模式
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={itemSelector}
                        onChange={(e) => setItemSelector(e.target.value)}
                        placeholder=".article-item"
                        className="input-field"
                      />
                      <p className="text-xs text-gray-500 mt-1">用于选择列表中的每个数据项</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        标题选择器（CSS选择器）
                        <span className="text-xs text-green-600 font-normal ml-2">（可选，留空自动提取）</span>
                      </label>
                      <input
                        type="text"
                        value={titleSelector}
                        onChange={(e) => setTitleSelector(e.target.value)}
                        placeholder="留空使用简化模式，自动提取文本"
                        className="input-field"
                      />
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        💡 推荐留空！系统会自动将每个 Item 的第一行作为标题
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        内容选择器（CSS选择器）
                        <span className="text-xs text-green-600 font-normal ml-2">（可选，留空自动提取）</span>
                      </label>
                      <input
                        type="text"
                        value={contentSelector}
                        onChange={(e) => setContentSelector(e.target.value)}
                        placeholder="留空使用简化模式，自动提取文本"
                        className="input-field"
                      />
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        💡 推荐留空！系统会自动提取整个 Item 的文本内容
                      </p>
                    </div>
                    
                    {/* 简化模式分割规则 */}
                    {!titleSelector && !contentSelector && itemSelector && (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-3 space-y-3">
                        <div className="font-semibold text-yellow-800 dark:text-yellow-200 text-sm flex items-center space-x-2">
                          <span>✂️</span>
                          <span>数据项分割规则（可选）</span>
                        </div>
                        
                        <div className="text-xs text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 rounded p-2 border border-blue-200 dark:border-blue-800">
                          <strong>📌 说明：</strong> 如果标记的元素包含<span className="font-bold text-blue-600 dark:text-blue-400">多个数据项</span>（如多个 prompt、多篇文章），
                          使用分割规则可以将它们拆分成多条独立记录。
                        </div>
                        
                        <div>
                          <label className="block text-xs font-medium mb-2 text-gray-700 dark:text-gray-300">
                            分割策略：
                          </label>
                          <select
                            value={splitStrategy}
                            onChange={(e) => {
                              const newStrategy = e.target.value as any;
                              setSplitStrategy(newStrategy);
                              // 切换到不分割时，清除分割模式
                              if (newStrategy === 'none') {
                                setSplitPattern('');
                              }
                            }}
                            className="input-field text-sm"
                          >
                            <option value="none">不分割（默认，1个元素 = 1条数据）</option>
                            <option value="regex">正则表达式分割（1个元素 = 多条数据）</option>
                            <option value="keyword">关键词分割（1个元素 = 多条数据）</option>
                          </select>
                        </div>
                        
                        {splitStrategy === 'regex' && (
                          <div>
                            <label className="block text-xs font-medium mb-2 text-gray-700 dark:text-gray-300">
                              正则表达式：
                            </label>
                            <input
                              type="text"
                              value={splitPattern}
                              onChange={(e) => setSplitPattern(e.target.value)}
                              placeholder="例如：\\n\\n（按双换行分割）"
                              className="input-field text-sm font-mono"
                            />
                            <div className="mt-2 space-y-1">
                              <p className="text-xs text-gray-600 dark:text-gray-400">
                                常用示例（点击使用）：
                              </p>
                              <div className="flex flex-wrap gap-1">
                                <button
                                  onClick={() => setSplitPattern('\\n\\n')}
                                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                >
                                  \n\n (双换行)
                                </button>
                                <button
                                  onClick={() => setSplitPattern('\\n点击复制\\n')}
                                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                >
                                  \n点击复制\n
                                </button>
                                <button
                                  onClick={() => setSplitPattern('\\n#\\n')}
                                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                >
                                  \n#\n
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {splitStrategy === 'keyword' && (
                          <div>
                            <label className="block text-xs font-medium mb-2 text-gray-700 dark:text-gray-300">
                              分割关键词：
                            </label>
                            <input
                              type="text"
                              value={splitPattern}
                              onChange={(e) => setSplitPattern(e.target.value)}
                              placeholder="例如：点击复制"
                              className="input-field text-sm"
                            />
                            <div className="mt-2 space-y-1">
                              <p className="text-xs text-gray-600 dark:text-gray-400">
                                常用关键词（点击使用）：
                              </p>
                              <div className="flex flex-wrap gap-1">
                                <button
                                  onClick={() => setSplitPattern('点击复制')}
                                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                >
                                  点击复制
                                </button>
                                <button
                                  onClick={() => setSplitPattern('#')}
                                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                >
                                  #
                                </button>
                                <button
                                  onClick={() => setSplitPattern('---')}
                                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                >
                                  ---
                                </button>
                              </div>
                              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                                ⚠️ 关键词会保留在内容中
                              </p>
                            </div>
                          </div>
                        )}
                        
                        <div className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 rounded p-2">
                          <strong>💡 工作原理：</strong>
                          <ul className="list-disc list-inside mt-1 space-y-1">
                            <li><strong>正则表达式</strong>：按正则模式分割成多个数据项（如 <code className="bg-gray-100 dark:bg-gray-700 px-1">\n\n</code> 按双换行分割）</li>
                            <li><strong>关键词分割</strong>：在关键词处分割成多个数据项（如 "点击复制" 作为分隔符）</li>
                            <li><strong>标题提取</strong>：每个数据项的第一行（&lt;100字符）自动作为标题，其余为内容</li>
                          </ul>
                          <p className="mt-2 text-yellow-600 dark:text-yellow-400">
                            ⚡ 分割后会在右侧"元素预览"中实时显示预览结果！
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
                
                {normalizeFormat === 'table' && (
                  <div>
                    <label className="block text-sm font-medium mb-2">表格选择器（CSS选择器）</label>
                    <input
                      type="text"
                      value={itemSelector}
                      onChange={(e) => setItemSelector(e.target.value)}
                      placeholder="table"
                      className="input-field"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* 底部按钮 */}
        <div className="flex items-center justify-end space-x-3 p-4 border-t border-gray-200 dark:border-gray-700">
          {onClose && (
            <Button
              onClick={onClose}
              variant="secondary"
            >
              取消
            </Button>
          )}
          <Button
            onClick={handleSaveModule}
            disabled={isLoading || !moduleName.trim() || !url.trim()}
            variant="primary"
          >
            {isLoading ? (
              <Loader className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            <span>保存模块</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CrawlerTestPage;
