"""
爬虫数据标准化模块
将爬取结果标准化为统一格式，便于后续处理和引用
"""

import re
from typing import Dict, List, Any, Optional
from bs4 import BeautifulSoup
from datetime import datetime


class CrawlerNormalizer:
    """数据标准化器"""
    
    def normalize(self, raw_data: Dict[str, Any], config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        标准化爬取结果
        
        Args:
            raw_data: 原始爬取结果
            config: 标准化配置
            
        Returns:
            标准化后的数据
        """
        if not raw_data.get('success'):
            return raw_data
        
        if not config:
            # 如果没有配置，尝试自动检测格式
            return self._auto_detect_format(raw_data)
        
        format_type = config.get('format', 'article')
        
        if format_type == 'list':
            return self._normalize_list(raw_data, config)
        elif format_type == 'table':
            return self._normalize_table(raw_data, config)
        elif format_type == 'article':
            return self._normalize_article(raw_data, config)
        else:
            return self._normalize_custom(raw_data, config)
    
    def _auto_detect_format(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        自动检测数据格式
        尝试识别列表、表格等结构化数据
        """
        html = raw_data.get('content', {}).get('html', '')
        if not html:
            return self._normalize_default(raw_data)
        
        soup = BeautifulSoup(html, 'lxml')
        
        # 1. 检测表格
        tables = soup.find_all('table')
        if tables:
            # 找到最大的表格
            largest_table = max(tables, key=lambda t: len(t.find_all('tr')))
            if len(largest_table.find_all('tr')) >= 2:  # 至少2行（表头+数据）
                return self._normalize_table(raw_data, {
                    'format': 'table',
                    'table_selector': 'table',
                    'header_row': 0
                })
        
        # 2. 检测列表结构（常见的列表选择器）
        list_selectors = [
            'ul > li',
            'ol > li',
            '.list-item',
            '.item',
            '.article-item',
            '.post-item',
            '.news-item',
            '[class*="item"]',
            '[class*="list"]',
        ]
        
        for selector in list_selectors:
            items = soup.select(selector)
            if len(items) >= 3:  # 至少3个列表项
                # 尝试提取标题和内容
                first_item = items[0]
                # 查找标题元素
                title_elem = None
                for tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                    title_elem = first_item.find(tag)
                    if title_elem:
                        break
                if not title_elem:
                    title_elem = first_item.find(class_=lambda x: x and 'title' in str(x).lower())
                
                # 查找内容元素
                content_elem = first_item.find('p')
                if not content_elem:
                    content_elem = first_item.find(class_=lambda x: x and ('content' in str(x).lower() or 'description' in str(x).lower()))
                
                if title_elem or content_elem:
                    # 找到了列表结构
                    return self._normalize_list(raw_data, {
                        'format': 'list',
                        'item_selector': selector.split(' > ')[0] if ' > ' in selector else selector,
                        'title_selector': 'h1, h2, h3, h4, h5, h6, .title',
                        'content_selector': 'p, .content, .description'
                    })
        
        # 3. 检测重复的div结构（可能是列表）
        def has_item_class(class_name):
            if not class_name:
                return False
            if isinstance(class_name, list):
                class_name = ' '.join(class_name)
            return 'item' in class_name.lower() or 'card' in class_name.lower() or 'post' in class_name.lower()
        
        divs = soup.find_all('div', class_=has_item_class)
        if len(divs) >= 3:
            # 检查这些div是否有相似的结构
            def has_title_elem(elem):
                if elem.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
                    return True
                title_elem = elem.find(class_=lambda x: x and 'title' in str(x).lower())
                return title_elem is not None
            
            has_title = sum(1 for d in divs[:5] if has_title_elem(d))
            if has_title >= 2:  # 至少2个有标题
                return self._normalize_list(raw_data, {
                    'format': 'list',
                    'item_selector': 'div[class*="item"], div[class*="card"], div[class*="post"]',
                    'title_selector': 'h1, h2, h3, h4, h5, h6, [class*="title"]',
                    'content_selector': 'p, [class*="content"], [class*="description"]'
                })
        
        # 4. 检测链接列表（如果链接数量很多，可能是列表页面）
        links = soup.find_all('a', href=True)
        if len(links) >= 10:  # 至少10个链接
            # 尝试找到链接的父容器，看是否有重复结构
            link_parents = {}
            for link in links[:20]:  # 检查前20个链接
                parent = link.parent
                if parent:
                    parent_tag = parent.name
                    parent_class = parent.get('class', [])
                    parent_id = parent.get('id', '')
                    # 生成父元素的特征
                    key = f"{parent_tag}_{'_'.join(sorted(parent_class))}_{parent_id}"
                    if key not in link_parents:
                        link_parents[key] = []
                    link_parents[key].append(link)
            
            # 找到包含最多链接的父容器
            if link_parents:
                best_parent_key = max(link_parents.keys(), key=lambda k: len(link_parents[k]))
                best_parent_links = link_parents[best_parent_key]
                
                if len(best_parent_links) >= 5:  # 至少5个链接在同一类型的父容器中
                    # 获取第一个链接的父容器作为示例
                    sample_parent = best_parent_links[0].parent
                    parent_tag = sample_parent.name
                    parent_class = sample_parent.get('class', [])
                    
                    # 构建选择器
                    if parent_class:
                        class_selector = '.'.join([c for c in parent_class if c])
                        item_selector = f"{parent_tag}.{class_selector}"
                    else:
                        item_selector = parent_tag
                    
                    # 尝试提取：链接文本作为标题，链接的兄弟元素作为内容
                    return self._normalize_list(raw_data, {
                        'format': 'list',
                        'item_selector': item_selector,
                        'title_selector': 'a',
                        'content_selector': 'p, span, div'
                    })
        
        # 5. 检测重复的链接结构（链接在同一层级的容器中）
        # 找到包含多个链接的容器
        containers_with_links = []
        for container in soup.find_all(['div', 'section', 'article', 'ul', 'ol']):
            container_links = container.find_all('a', href=True)
            if len(container_links) >= 3:
                containers_with_links.append((container, len(container_links)))
        
        if containers_with_links:
            # 按链接数量排序
            containers_with_links.sort(key=lambda x: x[1], reverse=True)
            best_container, link_count = containers_with_links[0]
            
            # 检查容器内的链接是否有相似的结构（比如都在li中，或者都在特定的div中）
            # 找到链接的直接父元素
            link_parents_set = set()
            for link in best_container.find_all('a', href=True)[:10]:
                parent = link.parent
                if parent:
                    parent_tag = parent.name
                    parent_class = parent.get('class', [])
                    if isinstance(parent_class, list):
                        parent_class = ' '.join(parent_class)
                    link_parents_set.add((parent_tag, parent_class))
            
            # 如果大部分链接的父元素类型相同，说明是列表结构
            if len(link_parents_set) <= 2:  # 最多2种父元素类型
                # 使用最常见的父元素作为item选择器
                parent_tag, parent_class = list(link_parents_set)[0]
                if parent_class:
                    item_selector = f"{parent_tag}.{parent_class.replace(' ', '.')}"
                else:
                    item_selector = parent_tag
                
                return self._normalize_list(raw_data, {
                    'format': 'list',
                    'item_selector': item_selector,
                    'title_selector': 'a',
                    'content_selector': 'p, span, div'
                })
        
        # 6. 默认作为文章处理
        return self._normalize_default(raw_data)
    
    def _normalize_default(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """默认标准化（整篇文章作为一个item）"""
        return {
            **raw_data,
            'normalized': {
                'format': 'article',
                'items': [{
                    'id': 'item_1',
                    'title': raw_data.get('title', ''),
                    'content': raw_data.get('content', {}).get('text', ''),
                    'html': raw_data.get('content', {}).get('html', ''),
                    'metadata': raw_data.get('metadata', {}),
                    'images': raw_data.get('images', []),
                    'links': raw_data.get('links', []),
                    'extracted_at': datetime.now().isoformat()
                }],
                'total_count': 1
            }
        }
    
    def _normalize_list(self, raw_data: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        """
        列表格式标准化
        
        配置示例:
        {
            "format": "list",
            "item_selector": ".article-item",
            "title_selector": "h2.title",
            "content_selector": ".content",
            "metadata_selectors": {
                "author": ".author",
                "date": ".date"
            }
        }
        """
        html = raw_data.get('content', {}).get('html', '')
        if not html:
            return self._normalize_default(raw_data)
        
        soup = BeautifulSoup(html, 'lxml')
        item_selector = config.get('item_selector', '.item')
        
        # 获取选择器，如果明确传递了空字符串，不使用默认值
        title_selector = config.get('title_selector')
        if title_selector is None:
            title_selector = 'h2, h3, .title'  # 只有未传递时才用默认值
        
        content_selector = config.get('content_selector')
        if content_selector is None:
            content_selector = '.content, p'  # 只有未传递时才用默认值
        
        metadata_selectors = config.get('metadata_selectors', {})
        
        items = []
        item_elements = soup.select(item_selector)
        
        print(f"[Normalizer] Found {len(item_elements)} items using selector '{item_selector}'")
        print(f"[Normalizer] Selectors - title: '{title_selector or 'None'}', content: '{content_selector or 'None'}'")
        
        # 如果没有指定选择器，直接提取每个item的所有文本作为快照
        if not title_selector and not content_selector:
            print(f"[Normalizer] 🚀 简化模式：没有指定选择器，直接提取纯文本快照")
            
            # 获取分割规则
            split_pattern = config.get('split_pattern', '')  # 用于分割多个数据项的模式
            split_strategy = config.get('split_strategy', 'none')  # none, regex, keyword
            
            print(f"[Normalizer] 数据项分割策略: {split_strategy}, 分割模式: '{split_pattern}'")
            
            item_counter = 0
            
            for idx, item_elem in enumerate(item_elements, 1):
                # 直接提取所有文本内容
                full_text = item_elem.get_text(separator='\n', strip=True)
                
                # 清理文本
                lines = [line.strip() for line in full_text.split('\n') if line.strip()]
                full_text = '\n'.join(lines)
                
                print(f"[Normalizer] 处理第 {idx} 个元素，原始文本长度: {len(full_text)} 字符")
                
                # 第一步：分割成多个子项
                sub_items = []
                
                if split_strategy == 'regex' and split_pattern:
                    try:
                        # 使用正则表达式分割成多个子项
                        parts = re.split(split_pattern, full_text)
                        sub_items = [p.strip() for p in parts if p.strip()]
                        print(f"[Normalizer]   正则分割: {len(sub_items)} 个子项")
                    except re.error as e:
                        print(f"[Normalizer]   正则表达式错误: {e}，不分割")
                        sub_items = [full_text]
                
                elif split_strategy == 'keyword' and split_pattern:
                    # 使用关键词分割成多个子项
                    if split_pattern in full_text:
                        parts = full_text.split(split_pattern)
                        # 保留分隔符，将其添加到每个部分的开头（除了第一个）
                        sub_items = []
                        for i, part in enumerate(parts):
                            if part.strip():
                                if i > 0:
                                    # 第二个及以后的部分，添加分隔符
                                    sub_items.append(split_pattern + '\n' + part.strip())
                                else:
                                    sub_items.append(part.strip())
                        print(f"[Normalizer]   关键词分割: {len(sub_items)} 个子项（关键词: '{split_pattern}'）")
                    else:
                        sub_items = [full_text]
                        print(f"[Normalizer]   未找到关键词 '{split_pattern}'，保持为 1 个子项")
                
                else:
                    # 不分割，整个作为一个子项
                    sub_items = [full_text]
                    print(f"[Normalizer]   不分割，保持为 1 个子项")
                
                # 第二步：为每个子项提取 title 和 content
                for sub_idx, sub_text in enumerate(sub_items, 1):
                    item_counter += 1
                    
                    sub_lines = [line.strip() for line in sub_text.split('\n') if line.strip()]
                    
                    # 默认使用首行模式提取 title
                    title = ''
                    content = sub_text
                    
                    if len(sub_lines) > 0:
                        first_line = sub_lines[0]
                        # 如果第一行短于100字符，作为标题
                        if len(first_line) < 100:
                            title = first_line
                            if len(sub_lines) > 1:
                                content = '\n'.join(sub_lines[1:])
                            else:
                                content = ''
                        else:
                            # 第一行太长，整个作为内容
                            title = ''
                            content = sub_text
                    
                    print(f"[Normalizer]     → 子项 {sub_idx}: title='{title[:30]}...', title_len={len(title)}, content_len={len(content)}")
                    
                    items.append({
                        'id': f'item_{item_counter}',
                        'title': title,
                        'content': content,
                        'text': sub_text,
                        'html': str(item_elem) if sub_idx == 1 else '',  # 只有第一个子项保存HTML
                        'metadata': {
                            'source_element_index': idx,
                            'sub_item_index': sub_idx
                        },
                        'extracted_at': datetime.now().isoformat()
                    })
            
            print(f"[Normalizer] ✅ 简化模式完成，从 {len(item_elements)} 个元素提取了 {len(items)} 个数据项")
            return {
                **raw_data,
                'normalized': {
                    'format': 'list',
                    'items': items,
                    'total_count': len(items),
                    'extraction_info': {
                        'method': 'text_snapshot',
                        'note': 'Direct text extraction without selectors'
                    }
                }
            }
        
        # 统计选择器匹配情况
        matched_titles = 0
        matched_contents = 0
        fallback_titles = 0
        fallback_contents = 0
        
        for idx, item_elem in enumerate(item_elements, 1):
            # 提取标题
            title = ''
            title_found = False
            if title_selector:
                title_elem = item_elem.select_one(title_selector)
                if title_elem:
                    title = title_elem.get_text(strip=True)
                    title_found = True
                    matched_titles += 1
                    print(f"[Normalizer] Item {idx}: Found title using selector '{title_selector}': {title[:50]}")
                else:
                    print(f"[Normalizer] Item {idx}: ⚠️ Title selector '{title_selector}' did not match any element, will try fallback methods")
            
            # 如果标题选择器是 'a'，提取链接文本和URL
            if title_selector == 'a' and not title:
                link_elem = item_elem.find('a', href=True)
                if link_elem:
                    title = link_elem.get_text(strip=True)
                    title_found = True
                    print(f"[Normalizer] Item {idx}: Found title from link: {title[:50]}")
            
            # 如果标题仍然为空，尝试从 item 中找到第一个标题元素（h1-h6）
            if not title.strip():
                for tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                    heading = item_elem.find(tag)
                    if heading:
                        title = heading.get_text(strip=True)
                        fallback_titles += 1
                        print(f"[Normalizer] Item {idx}: ✅ Fallback - Found title from <{tag}> tag: {title[:50]}")
                        break
            
            # 提取内容
            content = ''
            content_html = ''
            if content_selector:
                content_elem = item_elem.select_one(content_selector)
                if content_elem:
                    matched_contents += 1
                    print(f"[Normalizer] Item {idx}: Found content element using selector '{content_selector}', tag: {content_elem.name}")
                    # 提取所有文本内容，包括链接内的文本
                    # 使用 get_text 会递归提取所有子元素的文本
                    # 如果选择器选择到的是链接，需要提取链接内的所有文本，而不仅仅是链接文本
                    if content_elem.name == 'a':
                        # 如果是链接元素，提取链接内的所有文本（包括嵌套元素）
                        content = content_elem.get_text(separator='\n', strip=True)
                        print(f"[Normalizer] Item {idx}: Extracted content from link, length: {len(content)}")
                        # 如果链接内没有文本，尝试获取链接的 title 或 href
                        if not content.strip():
                            content = content_elem.get('title', '') or content_elem.get('href', '')
                            print(f"[Normalizer] Item {idx}: Link has no text, using title/href: {content[:50]}")
                    else:
                        # 普通元素，提取所有文本（包括链接内的文本）
                        content = content_elem.get_text(separator='\n', strip=True)
                        print(f"[Normalizer] Item {idx}: Extracted content from element, length: {len(content)}, preview: {content[:100]}")
                    content_html = str(content_elem)
                else:
                    print(f"[Normalizer] Item {idx}: ⚠️ Content selector '{content_selector}' did not match any element, will try fallback methods")
            else:
                # 如果没有指定内容选择器，使用整个item的文本（排除标题）
                print(f"[Normalizer] Item {idx}: No content selector, using entire item text")
                # 先移除标题元素
                item_copy = BeautifulSoup(str(item_elem), 'lxml')
                if title_selector:
                    for title_elem in item_copy.select(title_selector):
                        title_elem.decompose()
                # 提取所有文本，包括链接内的文本
                content = item_copy.get_text(separator='\n', strip=True)
                content_html = str(item_copy)
                print(f"[Normalizer] Item {idx}: Extracted content from entire item (excluding title), length: {len(content)}")
            
            # 如果内容为空，尝试获取item的所有文本（包括链接内的文本）
            if not content.strip():
                fallback_contents += 1
                print(f"[Normalizer] Item {idx}: ⚠️ Content is empty after selector extraction, using fallback: extract from entire item")
                # 获取所有文本内容，包括链接内的文本
                content = item_elem.get_text(separator='\n', strip=True)
                content_html = str(item_elem)
                print(f"[Normalizer] Item {idx}: ✅ Fallback succeeded - Extracted content from entire item, length: {len(content)}")
                print(f"[Normalizer] Item {idx}: Item HTML structure: {str(item_elem)[:300]}")
                
                # 如果还是为空，输出警告
                if not content.strip():
                    print(f"[Normalizer] Item {idx}: ❌ ERROR: Content is still empty after all fallback attempts!")
                    print(f"[Normalizer] Item {idx}: Item HTML preview: {str(item_elem)[:200]}")
            
            # 清理内容：移除多余的空白行和空格
            if content:
                lines = [line.strip() for line in content.split('\n') if line.strip()]
                content = '\n'.join(lines)
            
            # 智能处理：如果标题为空但内容不为空，尝试将内容的第一行作为标题
            # 这通常发生在用户没有标记标题选择器的情况
            # 重要：保留原始 content，不要清空！
            original_content = content  # 保存原始内容
            if not title.strip() and content.strip():
                content_lines = content.split('\n')
                if len(content_lines) > 0:
                    # 如果内容只有一行，整行作为标题，同时也保留在 content 中
                    if len(content_lines) == 1:
                        title = content_lines[0].strip()
                        # 保留原始内容，不清空！
                        content = original_content
                        print(f"[Normalizer] Item {idx}: Content has only one line, using as both title and content: {title[:50]}")
                    # 如果内容有多行，第一行作为标题
                    elif len(content_lines[0]) < 100:  # 标题通常较短（少于100字符）
                        title = content_lines[0].strip()
                        # 可选：保留完整内容（包括标题行）或移除标题行
                        # 这里保留完整内容更安全
                        content = original_content
                        print(f"[Normalizer] Item {idx}: Using first line as title: {title[:50]}, keeping full content length: {len(content)}")
            
            print(f"[Normalizer] Item {idx}: Final - title_length={len(title)}, content_length={len(content)}")
            
            # 提取元数据
            metadata = {}
            for key, selector in metadata_selectors.items():
                meta_elem = item_elem.select_one(selector)
                if meta_elem:
                    metadata[key] = meta_elem.get_text(strip=True)
            
            # 提取链接
            link_elem = item_elem.find('a', href=True)
            if link_elem:
                link_url = link_elem.get('href', '')
                if link_url:
                    metadata['url'] = link_url
                    # 如果标题为空，使用链接文本作为标题
                    if not title:
                        title = link_elem.get_text(strip=True)
            
            # 只有当标题或内容不为空时才添加
            if title or content.strip():
                items.append({
                    'id': f"item_{idx}",
                    'title': title,
                    'content': content,
                    'html': content_html,
                    'metadata': metadata,
                    'extracted_at': datetime.now().isoformat()
                })
        
        # 如果没有提取到items，使用默认标准化
        if not items:
            return self._normalize_default(raw_data)
        
        # 输出统计信息
        print(f"\n[Normalizer] ========== Extraction Summary ==========")
        print(f"[Normalizer] Total items: {len(items)}")
        print(f"[Normalizer] Title - Matched: {matched_titles}, Fallback: {fallback_titles}, Failed: {len(items) - matched_titles - fallback_titles}")
        print(f"[Normalizer] Content - Matched: {matched_contents}, Fallback: {fallback_contents}, Failed: {len(items) - matched_contents - fallback_contents}")
        if matched_titles < len(items) * 0.5:
            print(f"[Normalizer] ⚠️ WARNING: Less than 50% of items matched title selector, consider updating selector")
        if matched_contents < len(items) * 0.5:
            print(f"[Normalizer] ⚠️ WARNING: Less than 50% of items matched content selector, consider updating selector")
        print(f"[Normalizer] ==========================================\n")
        
        return {
            **raw_data,
            'normalized': {
                'format': 'list',
                'items': items,
                'total_count': len(items),
                'extraction_info': {
                    'method': 'selector',
                    'selectors_used': [item_selector, title_selector, content_selector],
                    'match_stats': {
                        'total': len(items),
                        'title_matched': matched_titles,
                        'title_fallback': fallback_titles,
                        'content_matched': matched_contents,
                        'content_fallback': fallback_contents
                    }
                }
            }
        }
    
    def _normalize_table(self, raw_data: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        """
        表格格式标准化
        
        配置示例:
        {
            "format": "table",
            "table_selector": "table",
            "header_row": 0,  # 表头行索引
            "skip_rows": []   # 跳过的行索引
        }
        """
        html = raw_data.get('content', {}).get('html', '')
        if not html:
            return self._normalize_default(raw_data)
        
        soup = BeautifulSoup(html, 'lxml')
        table_selector = config.get('table_selector', 'table')
        header_row = config.get('header_row', 0)
        skip_rows = config.get('skip_rows', [])
        
        table = soup.select_one(table_selector)
        if not table:
            return self._normalize_default(raw_data)
        
        rows = table.find_all('tr')
        if not rows:
            return self._normalize_default(raw_data)
        
        # 提取表头
        headers = []
        if header_row is not None and header_row < len(rows):
            header_row_elem = rows[header_row]
            headers = [th.get_text(strip=True) for th in header_row_elem.find_all(['th', 'td'])]
        
        # 提取数据行
        items = []
        for idx, row in enumerate(rows):
            if idx == header_row or idx in skip_rows:
                continue
            
            cells = [td.get_text(strip=True) for td in row.find_all(['td', 'th'])]
            if not cells:
                continue
            
            # 构建数据项
            item = {
                'id': f"item_{len(items) + 1}",
                'content': ' | '.join(cells),  # 表格行内容
                'metadata': {}
            }
            
            # 如果有表头，将数据映射到表头
            if headers:
                for i, header in enumerate(headers):
                    if i < len(cells):
                        item['metadata'][header] = cells[i]
            else:
                # 没有表头，使用列索引
                for i, cell in enumerate(cells):
                    item['metadata'][f'column_{i}'] = cell
            
            item['extracted_at'] = datetime.now().isoformat()
            items.append(item)
        
        if not items:
            return self._normalize_default(raw_data)
        
        return {
            **raw_data,
            'normalized': {
                'format': 'table',
                'items': items,
                'total_count': len(items),
                'headers': headers,
                'extraction_info': {
                    'method': 'table',
                    'table_selector': table_selector
                }
            }
        }
    
    def _normalize_article(self, raw_data: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        """
        文章格式标准化（与默认类似，但可以配置更精细的选择器）
        """
        # 文章格式通常就是整篇文章，与默认标准化类似
        return self._normalize_default(raw_data)
    
    def _normalize_custom(self, raw_data: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        """
        自定义格式标准化
        
        配置示例:
        {
            "format": "custom",
            "custom_extractors": {
                "price": {
                    "selector": ".price",
                    "type": "number"
                },
                "rating": {
                    "selector": ".rating",
                    "type": "number"
                }
            }
        }
        """
        html = raw_data.get('content', {}).get('html', '')
        if not html:
            return self._normalize_default(raw_data)
        
        soup = BeautifulSoup(html, 'lxml')
        custom_extractors = config.get('custom_extractors', {})
        
        items = []
        item_selector = config.get('item_selector', 'body')
        item_elements = soup.select(item_selector)
        
        for idx, item_elem in enumerate(item_elements, 1):
            item = {
                'id': f"item_{idx}",
                'title': raw_data.get('title', ''),
                'content': item_elem.get_text(separator='\n', strip=True),
                'html': str(item_elem),
                'metadata': {}
            }
            
            # 应用自定义提取器
            for key, extractor_config in custom_extractors.items():
                selector = extractor_config.get('selector')
                extractor_type = extractor_config.get('type', 'text')
                
                if selector:
                    elem = item_elem.select_one(selector)
                    if elem:
                        value = elem.get_text(strip=True)
                        
                        # 类型转换
                        if extractor_type == 'number':
                            try:
                                value = float(re.sub(r'[^\d.]', '', value))
                            except:
                                pass
                        elif extractor_type == 'int':
                            try:
                                value = int(re.sub(r'[^\d]', '', value))
                            except:
                                pass
                        
                        item['metadata'][key] = value
            
            item['extracted_at'] = datetime.now().isoformat()
            items.append(item)
        
        if not items:
            return self._normalize_default(raw_data)
        
        return {
            **raw_data,
            'normalized': {
                'format': 'custom',
                'items': items,
                'total_count': len(items),
                'extraction_info': {
                    'method': 'custom',
                    'extractors_used': list(custom_extractors.keys())
                }
            }
        }
