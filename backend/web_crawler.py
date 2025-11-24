"""
Web爬虫核心模块
支持静态HTML和JavaScript渲染的SPA网站爬取
"""

import time
import hashlib
import json
from typing import Dict, Optional, Any
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup
import html2text

# 尝试导入playwright（可选）
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    print("[WebCrawler] Playwright not installed, dynamic rendering disabled")

# 尝试导入Redis
try:
    from database import get_redis_client
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False


class WebCrawler:
    """Web爬虫类"""
    
    def __init__(self, default_timeout: int = 30, default_user_agent: str = None):
        """
        初始化爬虫
        
        Args:
            default_timeout: 默认超时时间（秒）
            default_user_agent: 默认User-Agent
        """
        self.default_timeout = default_timeout
        self.default_user_agent = default_user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        self.playwright_browser = None
        self.playwright_context = None
        
    def __del__(self):
        """清理资源"""
        self._cleanup_playwright()
    
    def _cleanup_playwright(self):
        """清理Playwright资源"""
        if self.playwright_context:
            try:
                self.playwright_context.close()
            except:
                pass
            self.playwright_context = None
        if self.playwright_browser:
            try:
                self.playwright_browser.close()
            except:
                pass
            self.playwright_browser = None
    
    def fetch(self, url: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        爬取网页（主入口）
        
        Args:
            url: 目标URL
            options: 爬取选项
            
        Returns:
            爬取结果字典
        """
        if options is None:
            options = {}
        
        start_time = time.time()
        
        try:
            # 检查Redis缓存
            if not options.get('force_refresh', False):
                cached_result = self._get_cached_result(url)
                if cached_result:
                    cached_result['fetch_info']['cached'] = True
                    return cached_result
            
            # 判断是否需要动态渲染
            force_dynamic = options.get('force_dynamic', False)
            needs_dynamic = force_dynamic or self._needs_dynamic_rendering(url, options)
            
            if needs_dynamic and HAS_PLAYWRIGHT:
                result = self._fetch_dynamic(url, options)
            else:
                result = self._fetch_static(url, options)
            
            # 计算耗时
            fetch_time = time.time() - start_time
            result['fetch_info']['fetch_time'] = round(fetch_time, 2)
            
            # 缓存结果
            self._cache_result(url, result)
            
            return result
            
        except Exception as e:
            fetch_time = time.time() - start_time
            return {
                'success': False,
                'error': 'UNKNOWN_ERROR',
                'message': str(e),
                'url': url,
                'fetch_info': {
                    'fetch_time': round(fetch_time, 2),
                    'status_code': None
                }
            }
    
    def _fetch_static(self, url: str, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        静态HTML爬取
        
        Args:
            url: 目标URL
            options: 爬取选项
            
        Returns:
            爬取结果
        """
        timeout = options.get('timeout', self.default_timeout)
        headers = options.get('headers', {})
        cookies = self._parse_cookies(options.get('cookies'))
        user_agent = options.get('user_agent', self.default_user_agent)
        
        # 设置请求头
        request_headers = {
            'User-Agent': user_agent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
        request_headers.update(headers)
        
        try:
            # 发送HTTP请求
            response = requests.get(
                url,
                headers=request_headers,
                cookies=cookies,
                timeout=timeout,
                allow_redirects=True
            )
            response.raise_for_status()
            
            # 确保正确检测编码
            if response.encoding is None or response.encoding.lower() in ['iso-8859-1', 'windows-1252']:
                # 尝试从Content-Type头获取编码
                content_type = response.headers.get('Content-Type', '')
                if 'charset=' in content_type:
                    try:
                        charset = content_type.split('charset=')[1].split(';')[0].strip().lower()
                        response.encoding = charset
                    except:
                        pass
                
                # 如果还是无法确定，尝试使用chardet检测
                if response.encoding is None or response.encoding.lower() in ['iso-8859-1', 'windows-1252']:
                    try:
                        import chardet
                        detected = chardet.detect(response.content)
                        if detected and detected.get('encoding'):
                            response.encoding = detected['encoding']
                    except:
                        pass
                
                # 默认使用utf-8
                if response.encoding is None or response.encoding.lower() in ['iso-8859-1', 'windows-1252']:
                    response.encoding = 'utf-8'
            
            # 解析HTML
            return self._parse_content(response.text, url, response.status_code, response.headers)
            
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'error': 'TIMEOUT',
                'message': f'请求超时（{timeout}秒）',
                'url': url,
                'fetch_info': {'status_code': None}
            }
        except requests.exceptions.ConnectionError:
            return {
                'success': False,
                'error': 'CONNECTION_ERROR',
                'message': '无法连接到目标服务器',
                'url': url,
                'fetch_info': {'status_code': None}
            }
        except requests.exceptions.HTTPError as e:
            status_code = e.response.status_code if e.response else None
            if status_code == 401:
                return {
                    'success': False,
                    'error': 'AUTHENTICATION_REQUIRED',
                    'message': '需要认证信息才能访问此页面',
                    'url': url,
                    'fetch_info': {'status_code': status_code},
                    'suggestions': [
                        '请提供Cookie（options.cookies）',
                        '或提供Authorization Header（options.headers.Authorization）'
                    ]
                }
            elif status_code == 403:
                return {
                    'success': False,
                    'error': 'AUTHENTICATION_FAILED',
                    'message': '认证失败，请检查认证信息是否正确或是否已过期',
                    'url': url,
                    'fetch_info': {'status_code': status_code},
                    'suggestions': [
                        '检查Cookie是否有效',
                        '检查Token是否过期',
                        '重新登录获取新的认证信息'
                    ]
                }
            else:
                return {
                    'success': False,
                    'error': 'HTTP_ERROR',
                    'message': f'HTTP错误: {status_code}',
                    'url': url,
                    'fetch_info': {'status_code': status_code}
                }
        except Exception as e:
            return {
                'success': False,
                'error': 'UNKNOWN_ERROR',
                'message': str(e),
                'url': url,
                'fetch_info': {'status_code': None}
            }
    
    def _fetch_dynamic(self, url: str, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        JavaScript渲染爬取（使用Playwright）
        
        Args:
            url: 目标URL
            options: 爬取选项
            
        Returns:
            爬取结果
        """
        if not HAS_PLAYWRIGHT:
            # 如果没有Playwright，回退到静态爬取
            return self._fetch_static(url, options)
        
        timeout = options.get('timeout', self.default_timeout) * 1000  # Playwright使用毫秒
        wait_for = options.get('wait_for')
        wait_timeout = options.get('wait_timeout', 10) * 1000
        cookies = self._parse_cookies(options.get('cookies'))
        headers = options.get('headers', {})
        user_agent = options.get('user_agent', self.default_user_agent)
        
        try:
            # 初始化Playwright（如果还没有）
            if not self.playwright_browser:
                playwright = sync_playwright().start()
                self.playwright_browser = playwright.chromium.launch(headless=True)
            
            # 创建浏览器上下文
            context_options = {
                'user_agent': user_agent,
                'viewport': {'width': 1920, 'height': 1080},
            }
            if headers:
                context_options['extra_http_headers'] = headers
            
            if self.playwright_context:
                self.playwright_context.close()
            self.playwright_context = self.playwright_browser.new_context(**context_options)
            
            # 添加Cookie
            if cookies:
                cookie_list = []
                for name, value in cookies.items():
                    cookie_list.append({
                        'name': name,
                        'value': value,
                        'url': url
                    })
                if cookie_list:
                    self.playwright_context.add_cookies(cookie_list)
            
            # 创建页面
            page = self.playwright_context.new_page()
            
            try:
                # 加载页面
                page.goto(url, wait_until='domcontentloaded', timeout=timeout)
                
                # 等待内容加载
                if wait_for:
                    try:
                        page.wait_for_selector(wait_for, timeout=wait_timeout)
                    except PlaywrightTimeoutError:
                        pass  # 选择器超时不影响继续
                else:
                    # 默认等待网络空闲
                    try:
                        page.wait_for_load_state('networkidle', timeout=wait_timeout)
                    except PlaywrightTimeoutError:
                        pass
                
                # 获取渲染后的HTML
                html = page.content()
                status_code = 200  # Playwright不直接提供状态码
                
                # 解析内容
                result = self._parse_content(html, url, status_code, {})
                result['fetch_info']['method'] = 'dynamic'
                
                return result
                
            finally:
                page.close()
                
        except PlaywrightTimeoutError:
            return {
                'success': False,
                'error': 'TIMEOUT',
                'message': f'页面加载超时（{timeout/1000}秒）',
                'url': url,
                'fetch_info': {'status_code': None, 'method': 'dynamic'}
            }
        except Exception as e:
            return {
                'success': False,
                'error': 'DYNAMIC_RENDER_ERROR',
                'message': f'动态渲染错误: {str(e)}',
                'url': url,
                'fetch_info': {'status_code': None, 'method': 'dynamic'}
            }
    
    def _parse_content(self, html: str, url: str, status_code: int, response_headers: Dict) -> Dict[str, Any]:
        """
        解析HTML内容
        
        Args:
            html: HTML内容
            url: 页面URL
            status_code: HTTP状态码
            response_headers: 响应头
            
        Returns:
            解析结果
        """
        # 确保HTML有正确的charset声明
        if isinstance(html, bytes):
            # 如果是bytes，尝试解码
            try:
                html = html.decode('utf-8')
            except UnicodeDecodeError:
                try:
                    html = html.decode('gbk')
                except UnicodeDecodeError:
                    html = html.decode('utf-8', errors='ignore')
        
        # 检查HTML是否已经有charset声明
        html_lower = html.lower()
        if '<meta' in html_lower and 'charset' in html_lower:
            # 已经有charset声明，直接使用
            pass
        else:
            # 在head标签前插入charset声明
            if '<head>' in html_lower:
                html = html.replace('<head>', '<head><meta charset="utf-8">', 1)
            elif '<html>' in html_lower:
                html = html.replace('<html>', '<html><head><meta charset="utf-8"></head>', 1)
            else:
                # 如果没有head标签，在开头添加
                html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>'
        
        soup = BeautifulSoup(html, 'lxml')
        base_url = url
        
        # 提取标题
        title = self._extract_title(soup)
        
        # 提取正文
        content_text, content_html = self._extract_content(soup)
        
        # 提取元数据
        metadata = self._extract_metadata(soup)
        
        # 提取图片
        images = self._extract_images(soup, base_url)
        
        # 提取链接
        links = self._extract_links(soup, base_url)
        
        # 提取结构化数据
        structured_data = self._extract_structured_data(soup)
        
        # 统计信息
        stats = {
            'word_count': len(content_text.split()),
            'image_count': len(images),
            'link_count': len(links),
            'paragraph_count': len(content_text.split('\n\n'))
        }
        
        # 转换为Markdown（可选）
        try:
            h = html2text.HTML2Text()
            h.ignore_links = False
            h.ignore_images = False
            content_markdown = h.handle(content_html)
        except:
            content_markdown = None
        
        return {
            'success': True,
            'url': url,
            'title': title,
            'content': {
                'text': content_text,
                'html': content_html,
                'markdown': content_markdown
            },
            'metadata': metadata,
            'images': images,
            'links': links,
            'structured_data': structured_data,
            'stats': stats,
            'fetch_info': {
                'method': 'static',
                'status_code': status_code,
                'content_type': response_headers.get('Content-Type', 'text/html'),
                'content_length': len(html.encode('utf-8'))
            }
        }
    
    def _extract_title(self, soup: BeautifulSoup) -> str:
        """提取页面标题"""
        # 优先使用og:title
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            return og_title['content']
        
        # 使用title标签
        title_tag = soup.find('title')
        if title_tag:
            return title_tag.get_text().strip()
        
        # 使用h1标签
        h1_tag = soup.find('h1')
        if h1_tag:
            return h1_tag.get_text().strip()
        
        return ''
    
    def _extract_content(self, soup: BeautifulSoup):
        """
        提取正文内容
        
        Returns:
            (纯文本, HTML)
        """
        # 移除script和style标签
        for tag in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
            tag.decompose()
        
        # 尝试找到主要内容区域
        main_content = None
        for selector in ['main', 'article', '.content', '.article-content', '#content', '.main-content']:
            main_content = soup.select_one(selector)
            if main_content:
                break
        
        if main_content:
            content_html = str(main_content)
            content_text = main_content.get_text(separator='\n', strip=True)
        else:
            # 如果没有找到主要内容区域，使用body
            body = soup.find('body')
            if body:
                content_html = str(body)
                content_text = body.get_text(separator='\n', strip=True)
            else:
                content_html = str(soup)
                content_text = soup.get_text(separator='\n', strip=True)
        
        # 清理文本
        content_text = '\n'.join(line.strip() for line in content_text.split('\n') if line.strip())
        
        return content_text, content_html
    
    def _extract_metadata(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """提取元数据"""
        metadata = {}
        
        # meta description
        desc_tag = soup.find('meta', attrs={'name': 'description'})
        if desc_tag and desc_tag.get('content'):
            metadata['description'] = desc_tag['content']
        
        # meta keywords
        keywords_tag = soup.find('meta', attrs={'name': 'keywords'})
        if keywords_tag and keywords_tag.get('content'):
            keywords = [k.strip() for k in keywords_tag['content'].split(',')]
            metadata['keywords'] = keywords
        
        # author
        author_tag = soup.find('meta', attrs={'name': 'author'})
        if author_tag and author_tag.get('content'):
            metadata['author'] = author_tag['content']
        
        # published time
        pub_time_tag = soup.find('meta', property='article:published_time')
        if pub_time_tag and pub_time_tag.get('content'):
            metadata['published_time'] = pub_time_tag['content']
        
        # modified time
        mod_time_tag = soup.find('meta', property='article:modified_time')
        if mod_time_tag and mod_time_tag.get('content'):
            metadata['modified_time'] = mod_time_tag['content']
        
        # language
        html_tag = soup.find('html')
        if html_tag and html_tag.get('lang'):
            metadata['language'] = html_tag['lang']
        
        # canonical URL
        canonical_tag = soup.find('link', attrs={'rel': 'canonical'})
        if canonical_tag and canonical_tag.get('href'):
            metadata['canonical_url'] = canonical_tag['href']
        
        return metadata
    
    def _extract_images(self, soup: BeautifulSoup, base_url: str) -> list:
        """提取图片"""
        images = []
        img_tags = soup.find_all('img')
        
        for img in img_tags:
            img_url = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
            if not img_url:
                continue
            
            # 转换为绝对URL
            img_url = urljoin(base_url, img_url)
            
            images.append({
                'url': img_url,
                'alt': img.get('alt', ''),
                'title': img.get('title', ''),
                'width': self._parse_int(img.get('width')),
                'height': self._parse_int(img.get('height'))
            })
        
        return images
    
    def _extract_links(self, soup: BeautifulSoup, base_url: str) -> list:
        """提取链接"""
        links = []
        a_tags = soup.find_all('a', href=True)
        parsed_base = urlparse(base_url)
        base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"
        
        for a in a_tags:
            href = a.get('href')
            if not href:
                continue
            
            # 转换为绝对URL
            absolute_url = urljoin(base_url, href)
            parsed_link = urlparse(absolute_url)
            link_domain = f"{parsed_link.scheme}://{parsed_link.netloc}"
            
            # 判断是内部链接还是外部链接
            link_type = 'internal' if link_domain == base_domain else 'external'
            
            links.append({
                'url': absolute_url,
                'text': a.get_text(strip=True),
                'type': link_type,
                'rel': a.get('rel', [])
            })
        
        return links
    
    def _extract_structured_data(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """提取结构化数据"""
        structured_data = {
            'json_ld': [],
            'open_graph': {},
            'twitter_card': {},
            'microdata': []
        }
        
        # JSON-LD
        json_ld_tags = soup.find_all('script', type='application/ld+json')
        for tag in json_ld_tags:
            try:
                data = json.loads(tag.string)
                structured_data['json_ld'].append(data)
            except:
                pass
        
        # Open Graph
        og_tags = soup.find_all('meta', property=lambda x: x and x.startswith('og:'))
        for tag in og_tags:
            prop = tag.get('property', '').replace('og:', '')
            content = tag.get('content', '')
            if prop and content:
                structured_data['open_graph'][prop] = content
        
        # Twitter Card
        twitter_tags = soup.find_all('meta', attrs={'name': lambda x: x and x.startswith('twitter:')})
        for tag in twitter_tags:
            name = tag.get('name', '').replace('twitter:', '')
            content = tag.get('content', '')
            if name and content:
                structured_data['twitter_card'][name] = content
        
        return structured_data
    
    def _needs_dynamic_rendering(self, url: str, options: Dict[str, Any]) -> bool:
        """
        检测是否需要动态渲染
        
        Args:
            url: 目标URL
            options: 爬取选项
            
        Returns:
            是否需要动态渲染
        """
        # 如果强制动态，直接返回True
        if options.get('force_dynamic', False):
            return True
        
        # 先尝试静态爬取，检查内容
        try:
            result = self._fetch_static(url, options)
            if not result.get('success'):
                # 如果静态爬取失败，可能需要动态渲染
                return True
            
            # 检查内容是否为空或不完整
            content = result.get('content', {})
            text = content.get('text', '')
            
            # 如果内容很少，可能需要动态渲染
            if len(text.strip()) < 100:
                return True
            
            # 检查是否包含常见的SPA框架特征
            html = result.get('content', {}).get('html', '')
            spa_indicators = [
                '<div id="root"></div>',
                '<div id="app"></div>',
                'data-react-root',
                'ng-app',
                'vue-app'
            ]
            
            for indicator in spa_indicators:
                if indicator in html:
                    return True
            
            return False
            
        except:
            # 如果检测过程出错，默认使用动态渲染
            return True
    
    def _parse_cookies(self, cookies: Any) -> Dict[str, str]:
        """
        解析Cookie（支持字符串和字典格式）
        
        Args:
            cookies: Cookie字符串或字典
            
        Returns:
            Cookie字典
        """
        if not cookies:
            return {}
        
        if isinstance(cookies, dict):
            return cookies
        
        if isinstance(cookies, str):
            cookie_dict = {}
            for item in cookies.split(';'):
                item = item.strip()
                if '=' in item:
                    key, value = item.split('=', 1)
                    cookie_dict[key.strip()] = value.strip()
            return cookie_dict
        
        return {}
    
    def _parse_int(self, value: Any) -> Optional[int]:
        """解析整数"""
        if value is None:
            return None
        try:
            return int(value)
        except:
            return None
    
    def _get_cached_result(self, url: str) -> Optional[Dict[str, Any]]:
        """从Redis获取缓存结果"""
        if not HAS_REDIS:
            return None
        
        try:
            redis_client = get_redis_client()
            if not redis_client:
                return None
            
            url_hash = hashlib.md5(url.encode()).hexdigest()
            cache_key = f"crawler:result:{url_hash}"
            cached = redis_client.get(cache_key)
            
            if cached:
                # 确保正确解码（Redis返回bytes）
                if isinstance(cached, bytes):
                    cached = cached.decode('utf-8')
                return json.loads(cached)
        except Exception as e:
            print(f"[WebCrawler] Error getting cache: {e}")
        
        return None
    
    def _cache_result(self, url: str, result: Dict[str, Any]):
        """缓存结果到Redis"""
        if not HAS_REDIS:
            return
        
        try:
            redis_client = get_redis_client()
            if not redis_client:
                return
            
            url_hash = hashlib.md5(url.encode()).hexdigest()
            cache_key = f"crawler:result:{url_hash}"
            
            # 缓存1小时（确保JSON正确处理中文）
            redis_client.setex(cache_key, 3600, json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(f"[WebCrawler] Error caching result: {e}")
