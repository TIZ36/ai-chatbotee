"""
YouTube视频下载后端服务
使用Flask实现，支持批量下载、进度跟踪、任务管理
"""

import os
import json
import yaml
import threading
import subprocess
import time
import signal
import requests
import pymysql
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from flask import Flask, request, jsonify, send_file, Response, stream_with_context
from flask_cors import CORS
import yt_dlp
import queue

# 尝试导入psutil（Windows暂停/继续需要）
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

app = Flask(__name__)

# 加载配置
def load_config():
    config_path = Path(__file__).parent / 'config.yaml'
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

config = load_config()

# ==================== CORS 统一配置 ====================
# 统一定义所有允许的CORS请求头，确保所有API接口使用相同的配置
CORS_ALLOWED_HEADERS = [
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Requested-With',
    'mcp-protocol-version',
    'mcp-session-id',
    'Notion-Version',
    'notion-version',
    'X-CSRF-Token',
    'X-API-Key',
    'Cookie',
    'Origin',
    'Referer',
    'User-Agent'
]

# 统一定义所有允许的HTTP方法
CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']

# 统一定义所有暴露的响应头
CORS_EXPOSE_HEADERS = [
    'mcp-session-id',
    'Content-Type',
    'Content-Length',
    'Content-Range',
    'X-Total-Count',
    'X-Page-Count',
    'Location',
    'Set-Cookie'
]

# 将列表转换为字符串（用于响应头）
CORS_ALLOWED_HEADERS_STR = ', '.join(CORS_ALLOWED_HEADERS)
CORS_ALLOWED_METHODS_STR = ', '.join(CORS_ALLOWED_METHODS)
CORS_EXPOSE_HEADERS_STR = ', '.join(CORS_EXPOSE_HEADERS)

# HTTP 请求日志辅助函数
def log_http_request(method, url, headers=None, data=None, json_data=None):
    """安全地打印 HTTP 请求信息（脱敏敏感信息）"""
    print(f"\n{'='*80}")
    print(f"[HTTP Request] {method} {url}")
    print(f"{'='*80}")
    
    if headers:
        print("[HTTP Request] Headers:")
        for key, value in headers.items():
            # 脱敏敏感信息，但打印更多调试信息
            if key.lower() in ['authorization', 'cookie', 'x-api-key']:
                if isinstance(value, str) and len(value) > 20:
                    # 对于 Authorization，打印更多信息用于调试
                    if key.lower() == 'authorization':
                        print(f"  {key}: {value[:30]}...{value[-10:]}")
                        print(f"    [DEBUG] Full length: {len(value)}")
                        if value.startswith('Bearer '):
                            token = value[7:]  # 移除 'Bearer ' 前缀
                            print(f"    [DEBUG] Token (without Bearer): {token[:30]}...{token[-10:]}")
                            print(f"    [DEBUG] Token length: {len(token)}")
                            print(f"    [DEBUG] Token starts with 'secret_': {token.startswith('secret_')}")
                            print(f"    [DEBUG] Token starts with 'ntn_': {token.startswith('ntn_')}")
                    else:
                        masked_value = value[:20] + "..." + value[-4:] if len(value) > 24 else value[:20] + "..."
                        print(f"  {key}: {masked_value}")
                else:
                    masked_value = "***" if value else ""
                    print(f"  {key}: {masked_value}")
            else:
                print(f"  {key}: {value}")
    
    if json_data:
        print("[HTTP Request] JSON Body:")
        try:
            # 限制 JSON 输出长度，避免日志过大
            json_str = json.dumps(json_data, indent=2, ensure_ascii=False)
            if len(json_str) > 2000:
                print(json_str[:2000] + "\n  ... (truncated)")
            else:
                print(json_str)
        except Exception as e:
            print(f"  (Failed to serialize JSON: {e})")
    
    if data:
        print("[HTTP Request] Data:")
        if isinstance(data, str):
            print(f"  {data[:500]}..." if len(data) > 500 else f"  {data}")
        else:
            print(f"  {data}")

def log_http_response(response):
    """安全地打印 HTTP 响应信息"""
    print(f"\n{'='*80}")
    print(f"[HTTP Response] Status: {response.status_code} {response.reason}")
    print(f"{'='*80}")
    
    print("[HTTP Response] Headers:")
    for key, value in response.headers.items():
        print(f"  {key}: {value}")
    
    print("[HTTP Response] Body:")
    try:
        # 尝试解析 JSON
        if response.headers.get('content-type', '').startswith('application/json'):
            try:
                response_json = response.json()
                json_str = json.dumps(response_json, indent=2, ensure_ascii=False)
                if len(json_str) > 2000:
                    print(json_str[:2000] + "\n  ... (truncated)")
                else:
                    print(json_str)
            except:
                # 如果不是有效的 JSON，打印文本
                text = response.text[:1000] if len(response.text) > 1000 else response.text
                print(text)
        else:
            # 非 JSON 响应，限制长度
            text = response.text[:1000] if len(response.text) > 1000 else response.text
            print(text)
            if len(response.text) > 1000:
                print("  ... (truncated)")
    except Exception as e:
        print(f"  (Failed to read response: {e})")
    
    print(f"{'='*80}\n")

# CORS 预检请求处理辅助函数
def handle_cors_preflight():
    """处理 CORS 预检请求，使用统一的CORS配置"""
    response = Response()
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS_STR
    # 允许所有请求头：回显浏览器在 Access-Control-Request-Headers 中请求的所有请求头
    requested_headers = request.headers.get('Access-Control-Request-Headers', '')
    if requested_headers:
        # 如果浏览器指定了需要的请求头，直接回显它们（允许所有）
        response.headers['Access-Control-Allow-Headers'] = requested_headers
    else:
        # 如果没有指定，使用统一的允许头列表
        response.headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS_STR
    # 使用统一的暴露响应头列表
    response.headers['Access-Control-Expose-Headers'] = CORS_EXPOSE_HEADERS_STR
    response.headers['Access-Control-Max-Age'] = '3600'
    return response

# CORS配置 - 使用统一的CORS配置常量
cors_origins = config.get('server', {}).get('cors_origins', ['*'])
CORS(app, 
     resources={r"/*": {"origins": cors_origins}},
     supports_credentials=True, 
     allow_headers=CORS_ALLOWED_HEADERS,
     expose_headers=CORS_EXPOSE_HEADERS,
     methods=CORS_ALLOWED_METHODS)

# 添加after_request处理器确保CORS头正确 - 使用统一的CORS配置常量
@app.after_request  
def after_request_cors(response):
    origin = request.headers.get('Origin')
    if origin and (origin in cors_origins or '*' in cors_origins):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS_STR
        response.headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS_STR
        response.headers['Access-Control-Expose-Headers'] = CORS_EXPOSE_HEADERS_STR
    return response

# 下载配置
DOWNLOAD_DIR = Path(config.get('download', {}).get('download_dir', './downloads'))
TEMP_DIR = Path(config.get('download', {}).get('temp_dir', './temp'))
MAX_CONCURRENT = config.get('download', {}).get('max_concurrent_downloads', 3)
DOWNLOAD_TIMEOUT = config.get('download', {}).get('timeout', 3600)

# 创建目录
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# 下载任务管理
download_tasks: Dict[str, Dict] = {}
download_lock = threading.Lock()

# SSE事件队列：用于实时推送下载进度
sse_queues: Dict[str, queue.Queue] = {}
sse_lock = threading.Lock()

# yt-dlp配置
ytdlp_path = config.get('ytdlp', {}).get('executable_path', 'yt-dlp')
if not ytdlp_path:
    ytdlp_path = 'yt-dlp'

def get_ytdlp_options(quality: str = 'highest', format: str = 'best') -> List[str]:
    """构建yt-dlp选项"""
    options = config.get('ytdlp', {}).get('default_options', []).copy()
    
    # 添加cookies文件（如果配置了）
    cookies_file = config.get('ytdlp', {}).get('cookies_file', '')
    if cookies_file and os.path.exists(cookies_file):
        options.extend(['--cookies', cookies_file])
        print(f"Using cookies file: {cookies_file}")
    
    # MP3格式需要特殊处理（纯音频）
    if format == 'mp3':
        # 音频格式选项
        options.extend(['-x', '--audio-format', 'mp3'])
        # 音频质量选项
        if quality == 'highest':
            options.extend(['--audio-quality', '0'])  # 最高质量
        elif quality == 'high':
            options.extend(['--audio-quality', '192K'])  # 高质量
        elif quality == 'medium':
            options.extend(['--audio-quality', '128K'])  # 中等质量
        else:  # low
            options.extend(['--audio-quality', '64K'])  # 低质量
        
        # 输出模板 - 使用绝对路径
        output_template = config.get('ytdlp', {}).get('output_template', '%(title)s.%(ext)s')
        output_path = str(DOWNLOAD_DIR.absolute()) + '/' + output_template
        options.extend(['-o', output_path])
        
        # 不使用--no-warnings，保留警告信息
        # 添加--ignore-errors允许在警告时继续下载
        if '--ignore-errors' not in options:
            options.append('--ignore-errors')
        
        return options
    
    # 视频格式选项
    # 质量选项
    quality_map = {
        'highest': 'best',
        'high': 'bestvideo[height<=1080]+bestaudio',
        'medium': 'bestvideo[height<=720]+bestaudio',
        'low': 'worst',
    }
    
    # 格式选项 - 使用更灵活的格式选择，避免403错误
    format_map = {
        # MP4: 优先选择h264+aac，如果不可用则fallback到其他格式
        'mp4': 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best',
        # WebM: 优先选择vp9+opus
        'webm': 'bestvideo[ext=webm][vcodec^=vp9]+bestaudio[ext=webm][acodec^=opus]/bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
        'best': 'best',
    }
    
    selected_quality = quality_map.get(quality, 'best')
    selected_format = format_map.get(format, 'best')
    
    # 如果指定了格式，使用格式选项；否则使用质量选项
    if format != 'best':
        format_option = selected_format
    else:
        format_option = selected_quality
    
    options.extend(['-f', format_option])
    
    # 输出模板 - 使用绝对路径
    output_template = config.get('ytdlp', {}).get('output_template', '%(title)s.%(ext)s')
    output_path = str(DOWNLOAD_DIR.absolute()) + '/' + output_template
    options.extend(['-o', output_path])
    
    # 不使用--no-warnings，保留警告信息以便调试和问题排查
    # 但添加--ignore-errors允许在警告时继续下载
    if '--ignore-errors' not in options:
        options.append('--ignore-errors')
    
    return options

def send_sse_event(task_id: str, event_type: str, data: Dict):
    """发送SSE事件到所有监听该任务的客户端"""
    with sse_lock:
        if task_id in sse_queues:
            event_data = {
                'type': event_type,
                'task_id': task_id,
                'data': data,
                'timestamp': datetime.now().isoformat()
            }
            try:
                sse_queues[task_id].put_nowait(event_data)
            except queue.Full:
                # 队列满了，移除最旧的事件
                try:
                    sse_queues[task_id].get_nowait()
                    sse_queues[task_id].put_nowait(event_data)
                except queue.Empty:
                    pass

def update_task_progress(task_id: str, progress_data: Dict):
    """更新任务进度并发送SSE事件"""
    with download_lock:
        if task_id in download_tasks:
            download_tasks[task_id].update(progress_data)
    
    # 发送SSE事件
    print(f"[{task_id}] Sending SSE progress event: progress={progress_data.get('progress', 0)}%, speed={progress_data.get('speed', 'N/A')}")
    send_sse_event(task_id, 'progress', progress_data)

def get_ytdlp_dict_options(quality: str = 'highest', format: str = 'best', logger=None) -> Dict:
    """构建yt-dlp字典选项（用于Python API）"""
    options = {}
    
    # 添加cookies文件（如果配置了）
    cookies_file = config.get('ytdlp', {}).get('cookies_file', '')
    if cookies_file and os.path.exists(cookies_file):
        options['cookiefile'] = cookies_file
    
    # MP3格式需要特殊处理（纯音频）
    if format == 'mp3':
        options['format'] = 'bestaudio'
        options['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': {
                'highest': '0',
                'high': '192',
                'medium': '128',
                'low': '64'
            }.get(quality, '0'),
        }]
    else:
        # 视频格式选项
        quality_map = {
            'highest': 'best',
            'high': 'bestvideo[height<=1080]+bestaudio',
            'medium': 'bestvideo[height<=720]+bestaudio',
            'low': 'worst',
        }
        
        format_map = {
            'mp4': 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best',
            'webm': 'bestvideo[ext=webm][vcodec^=vp9]+bestaudio[ext=webm][acodec^=opus]/bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
            'best': 'best',
        }
        
        selected_quality = quality_map.get(quality, 'best')
        selected_format = format_map.get(format, 'best')
        
        if format != 'best':
            options['format'] = selected_format
        else:
            options['format'] = selected_quality
    
    # 输出模板 - 使用标准模板，让yt-dlp自动处理文件名转义
    output_template = config.get('ytdlp', {}).get('output_template', '%(title)s.%(ext)s')
    # 使用标准模板，不要硬编码文件名，让yt-dlp处理特殊字符
    output_path = str(DOWNLOAD_DIR.absolute()) + '/' + output_template
    options['outtmpl'] = output_path
    
    # 其他选项
    options['quiet'] = False
    options['no_warnings'] = False
    options['ignoreerrors'] = True
    
    # 如果提供了logger，使用它来捕获输出
    if logger:
        options['logger'] = logger
    
    return options

def download_video(task_id: str, video_id: str, video_url: str, quality: str, format: str):
    """下载视频（后台任务）- 使用yt-dlp Python API"""
    print(f"[{task_id}] Starting download: video_id={video_id}, quality={quality}, format={format}")
    print(f"[{task_id}] Video URL: {video_url}")
    
    with download_lock:
        if task_id not in download_tasks:
            print(f"[{task_id}] Task not found in download_tasks")
            return
        download_tasks[task_id]['status'] = 'downloading'
        download_tasks[task_id]['started_at'] = datetime.now().isoformat()
    
    # 发送状态更新
    send_sse_event(task_id, 'status', {'status': 'downloading'})
    
    # 生成预期的文件名（用于匹配下载完成的文件）
    output_template = config.get('ytdlp', {}).get('output_template', '%(title)s.%(ext)s')
    # 先获取视频信息以生成准确的文件名
    expected_filename = None
    downloaded_file_path = [None]  # 使用列表以便在闭包中修改
    
    try:
        # 先获取视频信息
        info_opts = {
            'quiet': True,
            'no_warnings': True,
        }
        cookies_file = config.get('ytdlp', {}).get('cookies_file', '')
        if cookies_file and os.path.exists(cookies_file):
            info_opts['cookiefile'] = cookies_file
        
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            # 保存视频信息用于文件匹配
            if info:
                video_title = info.get('title', '')
                with download_lock:
                    if task_id in download_tasks:
                        download_tasks[task_id]['video_title'] = video_title
                        download_tasks[task_id]['video_id'] = info.get('id', video_id)
        
        # 创建一个自定义logger来捕获yt-dlp的输出并解析进度
        import re
        
        class YtDlpLogger:
            def __init__(self, task_id: str):
                self.task_id = task_id
                # 进度匹配正则表达式
                # 格式: [download] 12.5% of 100.00MiB at 1.23MiB/s ETA 00:45
                self.progress_pattern = re.compile(
                    r'\[download\]\s+(\d+\.?\d*)%\s+of\s+([\d.]+[KMGT]?i?B)\s+at\s+([\d.]+[KMGT]?i?B/s)\s+ETA\s+(\d+:\d+)'
                )
                # 简化的进度匹配（只有百分比）
                self.simple_progress_pattern = re.compile(
                    r'\[download\]\s+(\d+\.?\d*)%'
                )
                # 文件大小匹配
                self.size_pattern = re.compile(
                    r'of\s+([\d.]+[KMGT]?i?B)'
                )
                # 速度匹配
                self.speed_pattern = re.compile(
                    r'at\s+([\d.]+[KMGT]?i?B/s)'
                )
                # ETA匹配
                self.eta_pattern = re.compile(
                    r'ETA\s+(\d+:\d+)'
                )
                # 下载完成匹配 - 更全面的模式
                self.completed_pattern = re.compile(
                    r'\[download\]\s+(.+?)\s+has\s+already\s+been\s+downloaded|'
                    r'\[download\]\s+100%|'
                    r'\[download\]\s+100\.0%|'
                    r'\[download\]\s+100%\s+of|'  # 100% of xxx
                    r'\[Merger\]\s+Merging\s+formats|'
                    r'\[Merger\]\s+Merging\s+formats\s+into|'
                    r'\[ExtractAudio\]\s+Destination|'
                    r'Deleting\s+original\s+file|'
                    r'has\s+already\s+been\s+downloaded'
                )
                # 文件名提取模式（从完成消息中提取）
                self.filename_pattern = re.compile(
                    r'\[download\]\s+(.+?)\s+has\s+already\s+been\s+downloaded|'
                    r'\[Merger\]\s+Merging\s+formats\s+into\s+[\'"](.+?)[\'"]|'
                    r'\[Merger\]\s+Merging\s+formats\s+into\s+([^\s]+)|'  # 没有引号的情况
                    r'\[ExtractAudio\]\s+Destination:\s+(.+?)$'
                )
            
            def _parse_progress_from_message(self, msg: str):
                """从消息中解析进度信息并更新任务进度"""
                msg_str = str(msg)
                
                # 首先检查是否完成（优先级最高）
                completed_match = self.completed_pattern.search(msg_str)
                if completed_match:
                    print(f"[{self.task_id}] Detected completion pattern in log: {msg_str[:100]}")
                    
                    # 尝试提取文件名
                    filename_match = self.filename_pattern.search(msg_str)
                    extracted_filename = None
                    if filename_match:
                        # 提取第一个非空组
                        for group in filename_match.groups():
                            if group:
                                extracted_filename = group.strip().strip("'\"")
                                print(f"[{self.task_id}] Extracted filename from log: {extracted_filename}")
                                break
                    
                    # 立即更新任务状态为完成（无论是否找到文件名）
                    with download_lock:
                        if self.task_id in download_tasks:
                            download_tasks[self.task_id]['status'] = 'completed'
                            download_tasks[self.task_id]['progress'] = 100.0
                            if not download_tasks[self.task_id].get('completed_at'):
                                download_tasks[self.task_id]['completed_at'] = datetime.now().isoformat()
                    
                    # 更新进度为100%
                    progress_data = {
                        'progress': 100.0,
                        'speed': None,
                        'eta': None,
                    }
                    update_task_progress(self.task_id, progress_data)
                    
                    # 发送完成状态事件
                    send_sse_event(self.task_id, 'status', {
                        'status': 'completed',
                        'message': msg_str,
                        'extracted_filename': extracted_filename
                    })
                    
                    # 记录日志
                    send_sse_event(self.task_id, 'log', {
                        'level': 'info',
                        'message': msg_str
                    })
                    
                    # 如果提取到了文件名，尝试查找文件
                    if extracted_filename:
                        file_path = DOWNLOAD_DIR / extracted_filename
                        if file_path.exists():
                            file_size = file_path.stat().st_size
                            if file_size > 0:
                                with download_lock:
                                    if self.task_id in download_tasks:
                                        download_tasks[self.task_id]['file_path'] = str(file_path)
                                        download_tasks[self.task_id]['file_name'] = file_path.name
                                        download_tasks[self.task_id]['file_size'] = file_size
                                
                                send_sse_event(self.task_id, 'status', {
                                    'status': 'completed',
                                    'file_path': str(file_path),
                                    'file_name': file_path.name,
                                    'file_size': file_size
                                })
                                print(f"[{self.task_id}] File found and task updated: {file_path.name}")
                        else:
                            print(f"[{self.task_id}] Extracted filename not found: {extracted_filename}")
                    else:
                        # 如果没有提取到文件名，尝试从视频标题查找
                        print(f"[{self.task_id}] No filename extracted, will try to find file after download completes")
                    
                    return True
                
                # 尝试完整匹配进度
                match = self.progress_pattern.search(msg_str)
                if match:
                    percent = float(match.group(1))
                    size = match.group(2)
                    speed = match.group(3)
                    eta = match.group(4)
                    
                    # 更新进度
                    progress_data = {
                        'progress': percent,
                        'size': size,
                        'speed': speed,
                        'eta': eta,
                    }
                    update_task_progress(self.task_id, progress_data)
                    return True
                
                # 尝试简单匹配（只有百分比）
                simple_match = self.simple_progress_pattern.search(msg_str)
                if simple_match:
                    percent = float(simple_match.group(1))
                    
                    # 如果达到100%，立即标记为完成
                    if percent >= 100.0:
                        print(f"[{self.task_id}] Progress reached 100%, marking as completed")
                        with download_lock:
                            if self.task_id in download_tasks:
                                download_tasks[self.task_id]['status'] = 'completed'
                                download_tasks[self.task_id]['progress'] = 100.0
                                if not download_tasks[self.task_id].get('completed_at'):
                                    download_tasks[self.task_id]['completed_at'] = datetime.now().isoformat()
                        
                        send_sse_event(self.task_id, 'status', {
                            'status': 'completed',
                            'message': msg_str
                        })
                    
                    # 尝试提取其他信息
                    size_match = self.size_pattern.search(msg_str)
                    speed_match = self.speed_pattern.search(msg_str)
                    eta_match = self.eta_pattern.search(msg_str)
                    
                    progress_data = {
                        'progress': percent,
                        'size': size_match.group(1) if size_match else None,
                        'speed': speed_match.group(1) if speed_match else None,
                        'eta': eta_match.group(1) if eta_match else None,
                    }
                    update_task_progress(self.task_id, progress_data)
                    return True
                
                return False
            
            def debug(self, msg):
                msg_str = str(msg)
                # 尝试解析进度信息
                if not self._parse_progress_from_message(msg_str):
                    # 如果没有匹配到进度，发送为普通日志
                    send_sse_event(self.task_id, 'log', {
                        'level': 'debug',
                        'message': msg_str
                    })
            
            def warning(self, msg):
                msg_str = str(msg)
                # 警告信息也可能包含进度信息
                if not self._parse_progress_from_message(msg_str):
                    send_sse_event(self.task_id, 'log', {
                        'level': 'warning',
                        'message': msg_str
                    })
            
            def error(self, msg):
                msg_str = str(msg)
                # 错误信息也可能包含进度信息
                if not self._parse_progress_from_message(msg_str):
                    send_sse_event(self.task_id, 'log', {
                        'level': 'error',
                        'message': msg_str
                    })
            
            def info(self, msg):
                """info级别的日志"""
                msg_str = str(msg)
                if not self._parse_progress_from_message(msg_str):
                    send_sse_event(self.task_id, 'log', {
                        'level': 'info',
                        'message': msg_str
                    })
        
        yt_dlp_logger = YtDlpLogger(task_id)
        
        # 构建下载选项（不使用硬编码的文件名，让yt-dlp自动处理）
        ydl_opts = get_ytdlp_dict_options(quality, format, logger=yt_dlp_logger)
        
        # 进度回调函数
        def progress_hook(d):
            # 检查任务状态（如果暂停，不更新进度）
            with download_lock:
                if task_id not in download_tasks:
                    return
                task_status = download_tasks[task_id]['status']
                if task_status == 'paused':
                    return  # 暂停时不更新进度
            
            status = d.get('status', '')
            
            if status == 'downloading':
                # 更新进度
                percent_str = d.get('_percent_str', '0%')
                if not percent_str:
                    # 如果没有百分比字符串，尝试从其他字段计算
                    total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                    downloaded_bytes = d.get('downloaded_bytes', 0)
                    if total_bytes > 0:
                        progress = (downloaded_bytes / total_bytes) * 100
                    else:
                        progress = 0
                else:
                    percent = percent_str.replace('%', '').strip()
                    try:
                        progress = float(percent) if percent else 0
                    except:
                        progress = 0
                
                # 确保进度在0-100之间
                progress = max(0, min(100, progress))
                
                speed = d.get('_speed_str', '')
                eta = d.get('_eta_str', '')
                total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                downloaded_bytes = d.get('downloaded_bytes', 0)
                
                # 格式化大小
                size_str = ''
                if total_bytes:
                    if total_bytes < 1024:
                        size_str = f"{total_bytes} B"
                    elif total_bytes < 1024 * 1024:
                        size_str = f"{total_bytes / 1024:.2f} KB"
                    elif total_bytes < 1024 * 1024 * 1024:
                        size_str = f"{total_bytes / (1024 * 1024):.2f} MB"
                    else:
                        size_str = f"{total_bytes / (1024 * 1024 * 1024):.2f} GB"
                
                progress_data = {
                    'progress': progress,
                    'speed': speed,
                    'eta': eta,
                    'size': size_str,
                    'downloaded_bytes': downloaded_bytes,
                    'total_bytes': total_bytes,
                }
                
                update_task_progress(task_id, progress_data)
                
            elif status == 'finished':
                # 下载完成 - filename字段包含实际下载的文件路径
                downloaded_file_path[0] = d.get('filename')
                print(f"[{task_id}] Download finished (progress_hook): {downloaded_file_path[0]}")
                
                # 确保路径是绝对路径
                if downloaded_file_path[0]:
                    if not os.path.isabs(downloaded_file_path[0]):
                        downloaded_file_path[0] = str(DOWNLOAD_DIR / os.path.basename(downloaded_file_path[0]))
                    
                    # 立即检查文件是否存在并更新状态
                    if os.path.exists(downloaded_file_path[0]):
                        file_path = Path(downloaded_file_path[0])
                        file_size = file_path.stat().st_size
                        if file_size > 0:
                            with download_lock:
                                if task_id in download_tasks:
                                    download_tasks[task_id]['status'] = 'completed'
                                    download_tasks[task_id]['completed_at'] = datetime.now().isoformat()
                                    download_tasks[task_id]['file_path'] = str(file_path)
                                    download_tasks[task_id]['file_name'] = file_path.name
                                    download_tasks[task_id]['file_size'] = file_size
                                    download_tasks[task_id]['progress'] = 100.0
                            
                            send_sse_event(task_id, 'status', {
                                'status': 'completed',
                                'file_path': str(file_path),
                                'file_name': file_path.name,
                                'file_size': file_size
                            })
                            print(f"[{task_id}] Task completed via progress_hook: {file_path.name}")
            
            # 处理文件已存在的情况（yt-dlp可能不会触发finished状态）
            elif status == 'error' and 'already been downloaded' in str(d.get('error', '')).lower():
                # 文件已存在，尝试查找文件
                filename = d.get('filename')
                if filename:
                    downloaded_file_path[0] = filename
                    if not os.path.isabs(downloaded_file_path[0]):
                        downloaded_file_path[0] = str(DOWNLOAD_DIR / os.path.basename(downloaded_file_path[0]))
                    print(f"[{task_id}] File already exists: {downloaded_file_path[0]}")
        
        ydl_opts['progress_hooks'] = [progress_hook]
        
        # 检查任务状态（用于暂停/取消）
        paused = False
        cancelled = False
        
        def check_status():
            """定期检查任务状态"""
            nonlocal paused, cancelled
            while True:
                with download_lock:
                    if task_id not in download_tasks:
                        cancelled = True
                        break
                    task_status = download_tasks[task_id]['status']
                    if task_status == 'cancelled':
                        cancelled = True
                        break
                    elif task_status == 'paused':
                        paused = True
                    elif task_status == 'downloading' and paused:
                        paused = False
                time.sleep(0.1)
        
        # 启动状态检查线程
        status_thread = threading.Thread(target=check_status, daemon=True)
        status_thread.start()
        
        # 执行下载
        download_success = False
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # 检查是否取消
                if cancelled:
                    print(f"[{task_id}] Download cancelled before start")
                    with download_lock:
                        if task_id in download_tasks:
                            download_tasks[task_id]['status'] = 'cancelled'
                    send_sse_event(task_id, 'status', {'status': 'cancelled'})
                    return
                
                ydl.download([video_url])
                download_success = True
        except yt_dlp.utils.DownloadError as e:
            error_msg = str(e)
            # 检查是否是"文件已存在"的错误（文件已存在也算成功）
            if 'already been downloaded' in error_msg.lower() or 'already exists' in error_msg.lower():
                download_success = True  # 文件已存在也算成功
                print(f"[{task_id}] File already exists (from exception): {error_msg}")
                # 尝试从错误信息中提取文件名
                import re
                filename_match = re.search(r'\[download\]\s+(.+?)\s+has\s+already\s+been\s+downloaded', error_msg)
                if filename_match:
                    downloaded_file_path[0] = str(DOWNLOAD_DIR / filename_match.group(1))
            else:
                raise  # 重新抛出其他错误
        
        # 等待状态检查线程结束
        status_thread.join(timeout=1)
        
        # 检查是否取消
        if cancelled:
            print(f"[{task_id}] Download cancelled")
            with download_lock:
                if task_id in download_tasks:
                    download_tasks[task_id]['status'] = 'cancelled'
            send_sse_event(task_id, 'status', {'status': 'cancelled'})
            return
        
        # 如果下载成功（包括文件已存在的情况），查找文件
        if not download_success:
            return
        
        # 检查任务是否已经被标记为完成（可能通过logger检测到）
        with download_lock:
            task_already_completed = False
            if task_id in download_tasks:
                if download_tasks[task_id]['status'] == 'completed':
                    task_already_completed = True
                    print(f"[{task_id}] Task already marked as completed, checking if file path exists")
                    # 如果已经有文件路径，直接返回
                    if download_tasks[task_id].get('file_path'):
                        file_path = Path(download_tasks[task_id]['file_path'])
                        if file_path.exists():
                            print(f"[{task_id}] File path already set and exists: {file_path}")
                            return
        
        # 查找下载的文件
        # 方法1: 使用progress_hook返回的实际文件路径（最准确）
        file_path = None
        if downloaded_file_path[0]:
            if os.path.exists(downloaded_file_path[0]):
                file_path = Path(downloaded_file_path[0])
            else:
                # 如果路径不存在，可能是相对路径，尝试在下载目录中查找
                file_path = DOWNLOAD_DIR / os.path.basename(downloaded_file_path[0])
                if not file_path.exists():
                    file_path = None
        
        # 方法2: 如果方法1失败，使用视频标题进行模糊匹配
        if not file_path or not file_path.exists():
            with download_lock:
                video_title = download_tasks[task_id].get('video_title', '')
            
            if video_title:
                # 清理标题中的特殊字符，用于匹配
                clean_title = ''.join(c for c in video_title if c.isalnum() or c in (' ', '-', '_'))[:50]
                
                # 查找包含视频标题的文件
                for f in DOWNLOAD_DIR.glob('*'):
                    # 检查文件名是否包含视频标题的关键部分
                    if clean_title.lower() in f.name.lower() or f.name.lower() in clean_title.lower():
                        # 检查文件扩展名是否匹配
                        ext = f.suffix.lower()
                        if format == 'mp3' and ext == '.mp3':
                            file_path = f
                            break
                        elif format == 'mp4' and ext == '.mp4':
                            file_path = f
                            break
                        elif format == 'webm' and ext == '.webm':
                            file_path = f
                            break
                        elif format == 'best' and ext in ['.mp4', '.webm', '.mkv']:
                            file_path = f
                            break
        
        # 方法3: 如果还是找不到，查找最近5分钟内修改的文件
        if not file_path or not file_path.exists():
            current_time = time.time()
            recent_files = []
            for f in DOWNLOAD_DIR.glob('*'):
                try:
                    # 只考虑最近5分钟内修改的文件
                    if current_time - f.stat().st_mtime < 300:
                        recent_files.append(f)
                except Exception as e:
                    print(f"[{task_id}] Error checking file {f}: {e}")
            
            if recent_files:
                # 按修改时间排序，获取最新的文件
                recent_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                file_path = recent_files[0]
        
        if file_path and file_path.exists():
            file_size = file_path.stat().st_size
            print(f"[{task_id}] File found: {file_path.name} ({file_size} bytes)")
            
            if file_size > 0:
                with download_lock:
                    if task_id in download_tasks:
                        # 如果任务已经被标记为完成，只更新文件信息
                        if not task_already_completed:
                            download_tasks[task_id]['status'] = 'completed'
                            download_tasks[task_id]['completed_at'] = datetime.now().isoformat()
                            download_tasks[task_id]['progress'] = 100.0
                        download_tasks[task_id]['file_path'] = str(file_path)
                        download_tasks[task_id]['file_name'] = file_path.name
                        download_tasks[task_id]['file_size'] = file_size
                
                send_sse_event(task_id, 'status', {
                    'status': 'completed',
                    'file_path': str(file_path),
                    'file_name': file_path.name,
                    'file_size': file_size
                })
                print(f"[{task_id}] Task marked as completed: {file_path.name}")
            else:
                print(f"[{task_id}] File exists but is empty: {file_path.name}")
                raise Exception('Downloaded file is empty')
        else:
            # 如果找不到文件，但下载成功（可能是文件已存在），尝试更广泛的搜索
            # 但如果任务已经被标记为完成，就不需要再次更新状态
            if not task_already_completed:
                print(f"[{task_id}] File not found, trying broader search...")
            else:
                print(f"[{task_id}] Task already completed, skipping file search")
            # 检查是否有视频标题信息
            with download_lock:
                video_title = download_tasks[task_id].get('video_title', '')
            
            if video_title:
                # 更宽松的匹配：查找包含视频ID或标题关键字的文件
                for f in DOWNLOAD_DIR.glob('*'):
                    if video_id in f.name or (video_title and any(word in f.name for word in video_title.split()[:3] if len(word) > 3)):
                        file_path = f
                        file_size = f.stat().st_size
                        if file_size > 0:
                            with download_lock:
                                if task_id in download_tasks:
                                    download_tasks[task_id]['status'] = 'completed'
                                    download_tasks[task_id]['completed_at'] = datetime.now().isoformat()
                                    download_tasks[task_id]['file_path'] = str(file_path)
                                    download_tasks[task_id]['file_name'] = file_path.name
                                    download_tasks[task_id]['file_size'] = file_size
                                    download_tasks[task_id]['progress'] = 100.0
                            
                            send_sse_event(task_id, 'status', {
                                'status': 'completed',
                                'file_path': str(file_path),
                                'file_name': file_path.name,
                                'file_size': file_size
                            })
                            print(f"[{task_id}] Found file by broad search: {file_path.name}")
                            return
            
            # 如果还是找不到，但不报错（文件可能已存在但无法匹配）
            print(f"[{task_id}] Could not find downloaded file, but download reported success")
            # 标记为完成，但记录警告
            with download_lock:
                if task_id in download_tasks:
                    download_tasks[task_id]['status'] = 'completed'
                    download_tasks[task_id]['completed_at'] = datetime.now().isoformat()
                    download_tasks[task_id]['progress'] = 100.0
            
            send_sse_event(task_id, 'status', {
                'status': 'completed',
                'message': 'Download completed but file path could not be determined'
            })
    
    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        print(f"[{task_id}] Download error: {error_msg}")
        
        # 检查是否是403错误
        if '403' in error_msg or 'Forbidden' in error_msg:
            enhanced_error = f"{error_msg}\n\n解决建议：\n"
            enhanced_error += "1. 更新yt-dlp到最新版本: yt-dlp -U\n"
            enhanced_error += "2. 某些视频可能需要登录，请配置cookies文件\n"
            enhanced_error += "3. 尝试使用不同的extractor参数\n"
            enhanced_error += "4. 检查网络连接和IP是否被限制"
            error_msg = enhanced_error
        
        with download_lock:
            if task_id in download_tasks:
                download_tasks[task_id]['status'] = 'failed'
                download_tasks[task_id]['error'] = error_msg[:1000]
                download_tasks[task_id]['completed_at'] = datetime.now().isoformat()
        
        send_sse_event(task_id, 'status', {'status': 'failed', 'error': error_msg[:1000]})
    
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        error_msg = f"{str(e)}\n{error_trace[:500]}"
        print(f"[{task_id}] Exception occurred: {error_msg}")
        
        with download_lock:
            if task_id in download_tasks:
                download_tasks[task_id]['status'] = 'failed'
                download_tasks[task_id]['error'] = error_msg
                download_tasks[task_id]['completed_at'] = datetime.now().isoformat()
        
        send_sse_event(task_id, 'status', {'status': 'failed', 'error': error_msg})

@app.route('/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'message': 'YouTube download service is running',
        'version': '1.0.0'
    })

@app.route('/api/download', methods=['POST'])
def start_download():
    """开始下载视频"""
    data = request.json
    video_id = data.get('videoId')
    video_url = data.get('videoUrl') or f'https://www.youtube.com/watch?v={video_id}'
    quality = data.get('quality', 'highest')
    format_type = data.get('format', 'mp4')
    
    if not video_id and not video_url:
        return jsonify({'error': 'videoId or videoUrl is required'}), 400
    
    # 生成任务ID
    task_id = f"task_{int(time.time())}_{video_id}"
    
    # 创建任务
    with download_lock:
        download_tasks[task_id] = {
            'task_id': task_id,
            'video_id': video_id,
            'video_url': video_url,
            'quality': quality,
            'format': format_type,
            'status': 'queued',
            'progress': 0,
            'speed': None,
            'eta': None,
            'size': None,
            'created_at': datetime.now().isoformat(),
            'started_at': None,
            'completed_at': None,
            'file_path': None,
            'file_name': None,
            'file_size': None,
            'error': None,
            'process': None,
            'pid': None,
            'processed_lines_count': 0,  # 用于跟踪已处理的进度行数
        }
    
    # 启动下载线程
    thread = threading.Thread(
        target=download_video,
        args=(task_id, video_id, video_url, quality, format_type)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'task_id': task_id,
        'status': 'queued',
        'message': 'Download task created'
    }), 201

@app.route('/api/download/batch', methods=['POST'])
def batch_download():
    """批量下载视频"""
    data = request.json
    videos = data.get('videos', [])
    
    if not videos:
        return jsonify({'error': 'videos array is required'}), 400
    
    task_ids = []
    for video in videos:
        video_id = video.get('videoId')
        video_url = video.get('videoUrl') or f'https://www.youtube.com/watch?v={video_id}'
        quality = video.get('quality', 'highest')
        format_type = video.get('format', 'mp4')
        
        task_id = f"task_{int(time.time())}_{video_id}_{len(task_ids)}"
        
        with download_lock:
            download_tasks[task_id] = {
                'task_id': task_id,
                'video_id': video_id,
                'video_url': video_url,
                'quality': quality,
                'format': format_type,
                'status': 'queued',
                'progress': 0,
                'speed': None,
                'eta': None,
                'size': None,
                'created_at': datetime.now().isoformat(),
                'started_at': None,
                'completed_at': None,
                'file_path': None,
                'file_name': None,
                'file_size': None,
                'error': None,
                'process': None,
                'pid': None,
            }
        
        thread = threading.Thread(
            target=download_video,
            args=(task_id, video_id, video_url, quality, format_type)
        )
        thread.daemon = True
        thread.start()
        
        task_ids.append(task_id)
        time.sleep(0.1)  # 避免任务ID冲突
    
    return jsonify({
        'task_ids': task_ids,
        'count': len(task_ids),
        'message': f'Created {len(task_ids)} download tasks'
    }), 201

@app.route('/api/download/tasks', methods=['GET'])
def list_tasks():
    """获取所有下载任务列表"""
    with download_lock:
        tasks = []
        for task_id, task in download_tasks.items():
            task_copy = task.copy()
            # 移除process对象（不可序列化）
            if 'process' in task_copy:
                del task_copy['process']
            tasks.append(task_copy)
        
        # 按创建时间倒序排列
        tasks.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        return jsonify({
            'tasks': tasks,
            'total': len(tasks)
        })

@app.route('/api/download/tasks/<task_id>', methods=['GET'])
def get_task(task_id):
    """获取单个任务详情"""
    with download_lock:
        if task_id not in download_tasks:
            return jsonify({'error': 'Task not found'}), 404
        
        task = download_tasks[task_id].copy()
        if 'process' in task:
            del task['process']
        
        return jsonify(task)

@app.route('/api/download/tasks/<task_id>/events', methods=['GET'])
def stream_task_events(task_id):
    """SSE流：实时推送任务进度和状态更新"""
    def generate():
        # 创建事件队列
        event_queue = queue.Queue(maxsize=100)
        
        with sse_lock:
            if task_id not in sse_queues:
                sse_queues[task_id] = event_queue
            else:
                event_queue = sse_queues[task_id]
        
        # 发送初始状态
        with download_lock:
            if task_id in download_tasks:
                task = download_tasks[task_id].copy()
                if 'process' in task:
                    del task['process']
                yield f"data: {json.dumps({'type': 'initial', 'task': task})}\n\n"
        
        # 监听事件
        try:
            while True:
                try:
                    event = event_queue.get(timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except queue.Empty:
                    # 发送心跳
                    yield f": heartbeat\n\n"
        except GeneratorExit:
            # 客户端断开连接
            pass
        finally:
            # 清理：如果队列为空，移除它
            with sse_lock:
                if task_id in sse_queues and sse_queues[task_id].empty():
                    del sse_queues[task_id]
    
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

@app.route('/api/download/tasks/<task_id>/pause', methods=['POST'])
def pause_task(task_id):
    """暂停下载任务"""
    with download_lock:
        if task_id not in download_tasks:
            return jsonify({'error': 'Task not found'}), 404
        
        task = download_tasks[task_id]
        if task['status'] not in ['downloading', 'queued']:
            return jsonify({'error': 'Task cannot be paused'}), 400
        
        task['status'] = 'paused'
        send_sse_event(task_id, 'status', {'status': 'paused'})
        
        return jsonify({
            'task_id': task_id,
            'status': 'paused',
            'message': 'Task paused'
        })

@app.route('/api/download/tasks/<task_id>/resume', methods=['POST'])
def resume_task(task_id):
    """继续下载任务"""
    with download_lock:
        if task_id not in download_tasks:
            return jsonify({'error': 'Task not found'}), 404
        
        task = download_tasks[task_id]
        if task['status'] != 'paused':
            return jsonify({'error': 'Task is not paused'}), 400
        
        task['status'] = 'downloading'
        send_sse_event(task_id, 'status', {'status': 'downloading'})
        
        return jsonify({
            'task_id': task_id,
            'status': 'downloading',
            'message': 'Task resumed'
        })

@app.route('/api/download/tasks/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    """删除下载任务"""
    with download_lock:
        if task_id not in download_tasks:
            return jsonify({'error': 'Task not found'}), 404
        
        task = download_tasks[task_id]
        
        # 如果正在下载，先取消
        if task['status'] == 'downloading':
            task['status'] = 'cancelled'
            if task.get('process'):
                try:
                    task['process'].terminate()
                except Exception as e:
                    print(f"Error terminating process: {e}")
        
        # 删除文件（如果存在）
        if task.get('file_path') and os.path.exists(task['file_path']):
            try:
                os.remove(task['file_path'])
            except Exception as e:
                print(f"Error deleting file: {e}")
        
        # 从任务列表中删除
        del download_tasks[task_id]
        
        return jsonify({
            'task_id': task_id,
            'message': 'Task deleted'
        })

@app.route('/api/download/tasks/<task_id>/file', methods=['GET'])
def download_file(task_id):
    """下载已完成的文件"""
    with download_lock:
        if task_id not in download_tasks:
            return jsonify({'error': 'Task not found'}), 404
        
        task = download_tasks[task_id]
        if task['status'] != 'completed' or not task.get('file_path'):
            return jsonify({'error': 'File not available'}), 404
        
        file_path = Path(task['file_path'])
        if not file_path.exists():
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(
            str(file_path),
            as_attachment=True,
            download_name=task.get('file_name', file_path.name)
        )

@app.route('/api/info/<video_id>', methods=['GET'])
def get_video_info(video_id):
    """获取视频信息和可用格式"""
    try:
        video_url = f'https://www.youtube.com/watch?v={video_id}'
        
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            # 添加绕过403的选项
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'referer': 'https://www.youtube.com/',
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
        }
        
        # 添加cookies文件（如果配置了）
        cookies_file = config.get('ytdlp', {}).get('cookies_file', '')
        if cookies_file and os.path.exists(cookies_file):
            ydl_opts['cookiefile'] = cookies_file
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            
            # 提取所有格式
            formats = info.get('formats', [])
            
            # 分析可用格式
            available_formats = {
                'mp4': False,
                'webm': False,
                'mp3': False,
            }
            
            # 分析可用质量
            available_qualities = {
                'highest': True,  # 总是可用
                'high': False,    # 1080p
                'medium': False,  # 720p
                'low': True,      # 总是可用
            }
            
            # 检查视频格式和质量
            video_formats = [f for f in formats if f.get('vcodec') != 'none']
            audio_formats = [f for f in formats if f.get('acodec') != 'none']
            
            # 检查MP4格式
            mp4_videos = [f for f in video_formats if f.get('ext') == 'mp4']
            mp4_audio = [f for f in audio_formats if f.get('ext') in ['mp4', 'm4a']]
            if mp4_videos or mp4_audio:
                available_formats['mp4'] = True
            
            # 检查WebM格式
            webm_videos = [f for f in video_formats if f.get('ext') == 'webm']
            webm_audio = [f for f in audio_formats if f.get('ext') == 'webm']
            if webm_videos or webm_audio:
                available_formats['webm'] = True
            
            # 检查MP3格式
            mp3_audio = [f for f in audio_formats if f.get('ext') == 'mp3']
            if mp3_audio:
                available_formats['mp3'] = True
            
            # 检查分辨率
            heights = [f.get('height') for f in video_formats if f.get('height')]
            if heights:
                max_height = max(heights)
                if max_height >= 1080:
                    available_qualities['high'] = True
                if max_height >= 720:
                    available_qualities['medium'] = True
            
            # 构建格式列表（用于显示）
            format_list = []
            for f in formats:
                format_info = {
                    'format_id': f.get('format_id'),
                    'ext': f.get('ext'),
                    'resolution': f.get('resolution'),
                    'height': f.get('height'),
                    'width': f.get('width'),
                    'filesize': f.get('filesize'),
                    'vcodec': f.get('vcodec'),
                    'acodec': f.get('acodec'),
                    'fps': f.get('fps'),
                    'format_note': f.get('format_note', ''),
                }
                format_list.append(format_info)
            
            return jsonify({
                'id': info.get('id'),
                'title': info.get('title'),
                'description': info.get('description'),
                'duration': info.get('duration'),
                'thumbnail': info.get('thumbnail'),
                'view_count': info.get('view_count'),
                'uploader': info.get('uploader'),
                'upload_date': info.get('upload_date'),
                'formats': format_list,
                'available_formats': available_formats,
                'available_qualities': available_qualities,
            })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== MCP 代理 API ====================

@app.route('/mcp', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/mcp/', methods=['GET', 'POST', 'OPTIONS'])  # 支持末尾斜杠
def mcp_proxy_inspector():
    """
    MCP Inspector 格式的代理端点
    支持格式：/mcp?url=http://localhost:18060/mcp&transportType=streamable-http
    支持 GET (SSE) 和 POST (JSON-RPC) 请求
    """
    from flask import Response, request, stream_with_context
    import requests
    from urllib.parse import unquote
    
    # 处理 CORS 预检请求 - 使用统一的CORS配置常量
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        # 允许所有请求头：回显浏览器在 Access-Control-Request-Headers 中请求的所有请求头
        # 这是 CORS 规范推荐的方式，可以动态允许任何请求头
        requested_headers = request.headers.get('Access-Control-Request-Headers', '')
        if requested_headers:
            # 如果浏览器指定了需要的请求头，直接回显它们（允许所有）
            response.headers['Access-Control-Allow-Headers'] = requested_headers
        else:
            # 如果没有指定，使用统一的允许头列表
            response.headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS_STR
        response.headers['Access-Control-Expose-Headers'] = CORS_EXPOSE_HEADERS_STR
        return response
    
    try:
        # 获取目标 URL
        target_url = request.args.get('url')
        if not target_url:
            # 如果是GET请求且没有url参数，可能是SDK的预检请求
            # 返回200而不是400，避免405错误
            if request.method == 'GET':
                print(f"[MCP Proxy] GET request without url parameter (likely SDK preflight check)")
                return jsonify({
                    'status': 'ok',
                    'message': 'MCP proxy endpoint is ready. Please provide url parameter for actual requests.'
                }), 200
            return jsonify({'error': 'Missing url parameter'}), 400
        
        target_url = unquote(target_url)
        transport_type = request.args.get('transportType', 'streamable-http')
        
        print(f"[MCP Proxy] {request.method} request -> {target_url} (transport: {transport_type})")
        
        # 获取会话 ID（如果存在）
        session_id = request.headers.get('mcp-session-id')
        
        # 准备基础请求头
        # 使用最新的 MCP 协议版本 2025-06-18（兼容 2025-03-26）
        base_headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'mcp-protocol-version': request.headers.get('mcp-protocol-version', '2025-06-18'),
        }
        if session_id:
            base_headers['mcp-session-id'] = session_id
        
        # 使用 MCP 通用逻辑准备请求头（包括 OAuth token 和服务器配置）
        from mcp_server.mcp_common_logic import prepare_mcp_headers
        headers = prepare_mcp_headers(target_url, dict(request.headers), base_headers)
        
        # GET 请求：建立 SSE 连接
        if request.method == 'GET':
            print(f"[MCP Proxy] Establishing SSE connection to {target_url}")
            try:
                # 记录请求信息
                log_http_request('GET', target_url, headers=headers)
                
                # 转发 SSE 请求
                sse_response = requests.get(
                    target_url,
                    headers=headers,
                    stream=True,
                    timeout=30
                )
                
                # 记录响应信息（SSE 流式响应，只记录状态码和 headers）
                print(f"\n{'='*80}")
                print(f"[HTTP Response] Status: {sse_response.status_code} {sse_response.reason}")
                print(f"{'='*80}")
                print("[HTTP Response] Headers:")
                for key, value in sse_response.headers.items():
                    print(f"  {key}: {value}")
                print(f"{'='*80}\n")
                
                # 检测响应类型：是否是SSE流
                content_type = sse_response.headers.get('Content-Type', '').lower()
                is_sse_stream = 'text/event-stream' in content_type
                
                # 如果不是SSE流，直接返回JSON响应
                if not is_sse_stream:
                    print(f"[MCP Proxy] Response is not SSE stream (Content-Type: {content_type}), returning as JSON")
                    try:
                        # 尝试读取完整响应（设置超时）
                        json_data = sse_response.json()
                        response_headers = {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Expose-Headers': 'mcp-session-id',
                        }
                        if 'mcp-session-id' in sse_response.headers:
                            response_headers['mcp-session-id'] = sse_response.headers['mcp-session-id']
                        return jsonify(json_data), sse_response.status_code
                    except Exception as e:
                        print(f"[MCP Proxy] Failed to parse JSON response: {e}")
                        # 如果JSON解析失败，尝试返回文本
                        try:
                            text_data = sse_response.text
                            response_headers = {
                                'Content-Type': 'text/plain',
                                'Access-Control-Allow-Origin': '*',
                            }
                            return Response(text_data, headers=response_headers, status=sse_response.status_code)
                        except Exception as e2:
                            print(f"[MCP Proxy] Failed to get text response: {e2}")
                            return jsonify({'error': 'Failed to parse response'}), 500
                
                print(f"[MCP Proxy] SSE connection established, streaming response...")
                
                # 创建响应头
                response_headers = {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Expose-Headers': 'mcp-session-id',
                }
                
                # 转发会话 ID
                if 'mcp-session-id' in sse_response.headers:
                    response_headers['mcp-session-id'] = sse_response.headers['mcp-session-id']
                
                # 流式转发 SSE 响应（支持 Notion 工具解析）
                def generate():
                    try:
                        # 检测是否是 Notion MCP
                        is_notion = target_url and 'mcp.notion.com' in target_url
                        buffer = b''
                        current_event_type = None
                        chunk_timeout = 60  # 每个chunk的超时时间（秒）
                        last_chunk_time = time.time()
                        
                        # 使用iter_content，但添加超时检测
                        try:
                            for chunk in sse_response.iter_content(chunk_size=None):
                                if chunk:
                                    buffer += chunk
                                    last_chunk_time = time.time()
                                    
                                    # 尝试解析完整的 SSE 事件
                                    while b'\n\n' in buffer or b'\r\n\r\n' in buffer:
                                        # 找到事件分隔符
                                        if b'\n\n' in buffer:
                                            separator = b'\n\n'
                                        else:
                                            separator = b'\r\n\r\n'
                                        
                                        event_block, buffer = buffer.split(separator, 1)
                                        event_lines = event_block.decode('utf-8', errors='ignore').split('\n')
                                        
                                        # 解析 SSE 事件
                                        event_type = None
                                        data_lines = []
                                        
                                        for line in event_lines:
                                            line = line.strip()
                                            if not line:
                                                continue
                                            if line.startswith('event:'):
                                                event_type = line[6:].strip()
                                            elif line.startswith('data:'):
                                                data_lines.append(line[5:].strip())
                                        
                                        # 如果有数据，尝试解析
                                        if data_lines:
                                            data_content = '\n'.join(data_lines)
                                            try:
                                                if is_notion:
                                                    # Notion 特定解析（包含通用解析 + 自定义处理）
                                                    from mcp_server.well_known.notion import parse_notion_sse_event
                                                    parsed = parse_notion_sse_event(event_type or 'message', data_content)
                                                else:
                                                    # 通用 MCP 解析
                                                    from mcp_server.mcp_common_logic import parse_sse_event
                                                    parsed = parse_sse_event(event_type or 'message', data_content)
                                                
                                                if parsed and 'result' in parsed:
                                                    result = parsed['result']
                                                    if isinstance(result, dict) and 'tools' in result:
                                                        tools_count = len(result.get('tools', []))
                                                        server_type = 'Notion' if is_notion else 'MCP'
                                                        print(f"[MCP Proxy] ✅ Parsed {server_type} tools response: {tools_count} tools")
                                            except Exception as parse_error:
                                                print(f"[MCP Proxy] ⚠️ Failed to parse SSE event: {parse_error}")
                                        
                                        # 转发原始事件块
                                        yield event_block + separator
                                    
                                    # 如果缓冲区还有剩余数据但没有完整事件，继续等待
                                    # 但如果缓冲区太大，直接转发（避免内存问题）
                                    if len(buffer) > 10240:  # 10KB 阈值
                                        yield buffer
                                        buffer = b''
                                    
                                    # 检查超时（如果超过60秒没有新数据，停止读取）
                                    if time.time() - last_chunk_time > chunk_timeout:
                                        print(f"[MCP Proxy] ⚠️ SSE stream timeout: no data for {chunk_timeout} seconds")
                                        break
                        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError, TimeoutError) as timeout_error:
                            print(f"[MCP Proxy] SSE stream read timeout/error: {timeout_error}")
                            # 如果读取超时，尝试返回已收集的数据
                            if buffer:
                                print(f"[MCP Proxy] Returning buffered data: {len(buffer)} bytes")
                                yield buffer
                            # 发送一个结束事件
                            yield b'data: {"jsonrpc":"2.0","error":{"code":-32000,"message":"Stream read timeout"}}\n\n'
                        except Exception as stream_error:
                            print(f"[MCP Proxy] SSE stream error: {stream_error}")
                            import traceback
                            traceback.print_exc()
                            # 如果出错，尝试返回已收集的数据
                            if buffer:
                                yield buffer
                        
                        # 转发剩余的缓冲区内容
                        if buffer:
                            yield buffer
                    except Exception as e:
                        print(f"[MCP Proxy] SSE stream error: {e}")
                        import traceback
                        traceback.print_exc()
                    finally:
                        sse_response.close()
                
                return Response(
                    stream_with_context(generate()),
                    headers=response_headers,
                    status=sse_response.status_code
                )
            except requests.exceptions.RequestException as e:
                print(f"[MCP Proxy] SSE connection error: {e}")
                return jsonify({'error': str(e)}), 500
        
        # POST 请求：转发 JSON-RPC 请求
        elif request.method == 'POST':
            try:
                # 获取请求体
                if request.is_json:
                    json_data = request.get_json()
                else:
                    json_data = {}
                
                method = json_data.get('method', 'unknown')
                print(f"[MCP Proxy] Forwarding POST request: {method}")
                
                # 记录请求信息
                log_http_request('POST', target_url, headers=headers, json_data=json_data)
                
                # 转发到目标服务器
                post_response = requests.post(
                    target_url,
                    json=json_data,
                    headers=headers,
                    timeout=30
                )
                
                # 记录响应信息
                log_http_response(post_response)
                
                # 检测是否是 initialize 方法的成功响应
                is_initialize = method == 'initialize'
                initialize_successful = False
                new_session_id = None
                
                # 创建响应头
                response_headers = {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Expose-Headers': 'mcp-session-id',
                }
                
                # 转发会话 ID
                if 'mcp-session-id' in post_response.headers:
                    response_headers['mcp-session-id'] = post_response.headers['mcp-session-id']
                
                # 检测请求类型
                is_tools_list = method == 'tools/list'
                is_tools_call = method == 'tools/call'
                needs_json_response = is_tools_list or is_tools_call  # 这些方法前端期望 JSON
                
                # 从数据库获取服务器配置，检查响应格式
                response_format = 'json'  # 默认 JSON
                try:
                    from database import get_mysql_connection
                    conn = get_mysql_connection()
                    if conn:
                        cursor = conn.cursor()
                        cursor.execute(
                            "SELECT ext FROM mcp_servers WHERE url = %s AND enabled = 1 LIMIT 1",
                            (target_url,)
                        )
                        server_row = cursor.fetchone()
                        if server_row and server_row[0]:
                            ext = server_row[0]
                            if isinstance(ext, str):
                                ext = json.loads(ext)
                            response_format = ext.get('response_format', 'json')
                            print(f"[MCP Proxy] Server response_format: {response_format}")
                        cursor.close()
                        conn.close()
                except Exception as db_error:
                    print(f"[MCP Proxy] Warning: Failed to get response_format from DB: {db_error}")
                
                # 检测是否是 Notion MCP（兼容旧逻辑）
                is_notion = target_url and 'mcp.notion.com' in target_url
                if is_notion and response_format == 'json':
                    response_format = 'sse'  # Notion 默认使用 SSE
                
                # 如果是 SSE 响应
                if 'text/event-stream' in post_response.headers.get('Content-Type', ''):
                    # 特殊处理：前端期望 JSON 的请求（tools/list, tools/call）返回 SSE 时，转换为 JSON 格式
                    if needs_json_response and response_format == 'sse':
                        print(f"[MCP Proxy] {method} returned SSE, converting to JSON (response_format={response_format})...")
                        try:
                            # 完整读取 SSE 响应（带超时处理）
                            sse_content = b''
                            try:
                                for chunk in post_response.iter_content(chunk_size=None):
                                    if chunk:
                                        sse_content += chunk
                            except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError, TimeoutError) as timeout_error:
                                print(f"[MCP Proxy] SSE read timeout when converting to JSON: {timeout_error}")
                                # 如果超时，使用已读取的内容
                                if not sse_content:
                                    raise  # 如果没有读取到任何内容，重新抛出异常
                            
                            # 解析 SSE 事件
                            sse_text = sse_content.decode('utf-8', errors='ignore')
                            sse_events = sse_text.split('\n\n')
                            
                            json_rpc_response = None
                            for event in sse_events:
                                if not event.strip():
                                    continue
                                
                                event_lines = event.split('\n')
                                event_type = None
                                data_lines = []
                                
                                for line in event_lines:
                                    line = line.strip()
                                    if not line:
                                        continue
                                    if line.startswith('event:'):
                                        event_type = line[6:].strip()
                                    elif line.startswith('data:'):
                                        data_lines.append(line[5:].strip())
                                
                                if data_lines:
                                    data_content = '\n'.join(data_lines)
                                    try:
                                        # 解析 JSON-RPC 响应
                                        if is_notion:
                                            from mcp_server.well_known.notion import parse_notion_sse_event
                                            parsed = parse_notion_sse_event(event_type or 'message', data_content)
                                        else:
                                            from mcp_server.mcp_common_logic import parse_sse_event
                                            parsed = parse_sse_event(event_type or 'message', data_content)
                                        
                                        if parsed:
                                            json_rpc_response = parsed
                                            print(f"[MCP Proxy] ✅ Extracted JSON-RPC from SSE: id={json_rpc_response.get('id', 'unknown')}, method={method}")
                                            break
                                    except Exception as parse_error:
                                        print(f"[MCP Proxy] ⚠️ Failed to parse SSE for {method}: {parse_error}")
                            
                            if json_rpc_response:
                                # 返回纯 JSON 格式
                                response_headers['Content-Type'] = 'application/json'
                                
                                # 记录详细信息
                                if is_tools_list:
                                    tools_count = len(json_rpc_response.get('result', {}).get('tools', []))
                                    print(f"[MCP Proxy] ✅ Converted SSE to JSON for tools/list ({tools_count} tools)")
                                elif is_tools_call:
                                    print(f"[MCP Proxy] ✅ Converted SSE to JSON for tools/call")
                                
                                return Response(
                                    json.dumps(json_rpc_response),
                                    headers=response_headers,
                                    status=post_response.status_code
                                )
                            else:
                                print(f"[MCP Proxy] ⚠️ Could not extract JSON-RPC from SSE, falling back to SSE stream")
                        except Exception as convert_error:
                            print(f"[MCP Proxy] ⚠️ Error converting SSE to JSON: {convert_error}")
                            import traceback
                            traceback.print_exc()
                    
                    # 非 tools/list 的 SSE 响应，正常流式转发
                    response_headers['Content-Type'] = 'text/event-stream'
                    response_headers['Cache-Control'] = 'no-cache'
                    response_headers['Connection'] = 'keep-alive'
                    
                    # 流式转发（支持 Notion 工具解析 + initialize 后自动获取工具）
                    def generate():
                        try:
                            buffer = b''
                            initialize_successful = False
                            session_id_for_auto_fetch = None
                            chunk_timeout = 60  # 每个chunk的超时时间（秒）
                            last_chunk_time = time.time()
                            
                            try:
                                for chunk in post_response.iter_content(chunk_size=None):
                                    if chunk:
                                        buffer += chunk
                                        last_chunk_time = time.time()
                                    
                                    # 尝试解析完整的 SSE 事件
                                    while b'\n\n' in buffer or b'\r\n\r\n' in buffer:
                                        # 找到事件分隔符
                                        if b'\n\n' in buffer:
                                            separator = b'\n\n'
                                        else:
                                            separator = b'\r\n\r\n'
                                        
                                        event_block, buffer = buffer.split(separator, 1)
                                        event_lines = event_block.decode('utf-8', errors='ignore').split('\n')
                                        
                                        # 解析 SSE 事件
                                        event_type = None
                                        data_lines = []
                                        
                                        for line in event_lines:
                                            line = line.strip()
                                            if not line:
                                                continue
                                            if line.startswith('event:'):
                                                event_type = line[6:].strip()
                                            elif line.startswith('data:'):
                                                data_lines.append(line[5:].strip())
                                        
                                        # 如果有数据，尝试解析
                                        if data_lines:
                                            data_content = '\n'.join(data_lines)
                                            try:
                                                if is_notion:
                                                    # Notion 特定解析（包含通用解析 + 自定义处理）
                                                    from mcp_server.well_known.notion import parse_notion_sse_event
                                                    parsed = parse_notion_sse_event(event_type or 'message', data_content)
                                                else:
                                                    # 通用 MCP 解析
                                                    from mcp_server.mcp_common_logic import parse_sse_event
                                                    parsed = parse_sse_event(event_type or 'message', data_content)
                                                
                                                if parsed and 'result' in parsed:
                                                    result = parsed['result']
                                                    
                                                    # 检测 initialize 成功响应
                                                    if is_initialize and 'serverInfo' in result:
                                                        initialize_successful = True
                                                        # 从响应头获取 session_id
                                                        session_id_for_auto_fetch = post_response.headers.get('mcp-session-id')
                                                        print(f"[MCP Proxy] ✅ Initialize successful, session_id: {session_id_for_auto_fetch}")
                                                    
                                                    if isinstance(result, dict) and 'tools' in result:
                                                        tools_count = len(result.get('tools', []))
                                                        server_type = 'Notion' if is_notion else 'MCP'
                                                        print(f"[MCP Proxy] ✅ Parsed {server_type} tools response: {tools_count} tools")
                                            except Exception as parse_error:
                                                print(f"[MCP Proxy] ⚠️ Failed to parse SSE event: {parse_error}")
                                        
                                        # 转发原始事件块
                                        yield event_block + separator
                                    
                                    # 如果缓冲区太大，直接转发（避免内存问题）
                                    if len(buffer) > 10240:  # 10KB 阈值
                                        yield buffer
                                        buffer = b''
                                    
                                    # 检查超时（如果超过60秒没有新数据，停止读取）
                                    if time.time() - last_chunk_time > chunk_timeout:
                                        print(f"[MCP Proxy] ⚠️ POST SSE stream timeout: no data for {chunk_timeout} seconds")
                                        break
                            except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError, TimeoutError) as timeout_error:
                                print(f"[MCP Proxy] POST SSE stream read timeout/error: {timeout_error}")
                                # 如果读取超时，尝试返回已收集的数据
                                if buffer:
                                    print(f"[MCP Proxy] Returning buffered data: {len(buffer)} bytes")
                                    yield buffer
                                # 发送一个结束事件
                                yield b'data: {"jsonrpc":"2.0","error":{"code":-32000,"message":"Stream read timeout"}}\n\n'
                            
                            # 转发剩余的缓冲区内容
                            if buffer:
                                yield buffer
                            
                            # 如果 initialize 成功，自动发送 notifications/initialized
                            # 注意：不自动发送 tools/list，让前端主动调用以避免 SSE/JSON 格式混乱
                            if initialize_successful and session_id_for_auto_fetch:
                                print(f"[MCP Proxy] ✅ Initialize completed, client should now call tools/list")
                                
                                try:
                                    # 发送 notifications/initialized 通知
                                    notification_headers = headers.copy()
                                    notification_headers['mcp-session-id'] = session_id_for_auto_fetch
                                    
                                    notification_request = {
                                        'jsonrpc': '2.0',
                                        'method': 'notifications/initialized',
                                        'params': {}
                                    }
                                    
                                    print(f"[MCP Proxy] Sending notifications/initialized...")
                                    requests.post(
                                        target_url,
                                        json=notification_request,
                                        headers=notification_headers,
                                        timeout=10
                                    )
                                    print(f"[MCP Proxy] ✅ Notification sent, session ready for tools/list")
                                        
                                except Exception as notification_error:
                                    print(f"[MCP Proxy] ⚠️ Notification error: {notification_error}")
                                    import traceback
                                    traceback.print_exc()
                            
                        except Exception as e:
                            print(f"[MCP Proxy] POST stream error: {e}")
                            import traceback
                            traceback.print_exc()
                        finally:
                            post_response.close()
                    
                    return Response(
                        stream_with_context(generate()),
                        headers=response_headers,
                        status=post_response.status_code
                    )
                else:
                    # JSON 响应
                    response_headers['Content-Type'] = 'application/json'
                    return Response(
                        post_response.content,
                        headers=response_headers,
                        status=post_response.status_code
                    )
                    
            except requests.exceptions.RequestException as e:
                print(f"[MCP Proxy] POST request error: {e}")
                return jsonify({'error': str(e)}), 500
        
    except Exception as e:
        print(f"[MCP Proxy] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/mcp/proxy', methods=['POST', 'OPTIONS'])
def mcp_proxy():
    """
    MCP CORS 代理端点
    仅在浏览器环境中遇到 CORS 问题时使用
    直接转发请求到 MCP 服务器以解决跨域问题
    """
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({'error': 'Missing url parameter'}), 400

        target_url = data['url']
        method = data.get('method', 'tools/list')
        params = data.get('params', {})

        # 构建 MCP 请求
        mcp_request = {
            'jsonrpc': '2.0',
            'id': data.get('id', 1),
            'method': method,
            'params': params
        }

        print(f"[MCP Proxy] CORS proxy: {method} -> {target_url}")

        # 发送请求到 MCP 服务器
        import requests
        
        # 记录请求信息
        log_http_request('POST', target_url, json_data=mcp_request)
        
        response = requests.post(target_url, json=mcp_request, timeout=30)

        # 记录响应信息
        log_http_response(response)

        print(f"[MCP Proxy] Response status: {response.status_code}")

        # 返回完整的响应，包括状态码
        return response.json(), response.status_code

    except Exception as e:
        print(f"[MCP Proxy] Error: {e}")
        return jsonify({'error': str(e)}), 500

# ==================== 通用 OAuth MCP 服务器配置 API ====================

@app.route('/api/mcp/oauth/notion/config', methods=['GET', 'OPTIONS'])
def get_notion_oauth_config():
    """获取 Notion OAuth 配置（client_id等）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        notion_config = config.get('notion', {})
        client_id = notion_config.get('client_id', '')
        
        return jsonify({
            'client_id': client_id,
            'has_client_secret': bool(notion_config.get('client_secret')),
        })
    except Exception as e:
        print(f"[MCP OAuth] ❌ ERROR getting Notion config: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/mcp/oauth/discover', methods=['POST', 'OPTIONS'])
def mcp_oauth_discover():
    """发现 MCP 服务器的 OAuth 配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        import requests
        
        data = request.get_json()
        mcp_url = data.get('mcp_url')
        
        if not mcp_url:
            return jsonify({'error': 'Missing mcp_url parameter'}), 400
        
        print(f"[MCP OAuth Discovery] Discovering OAuth config for: {mcp_url}")
        
        # 1. 获取 OAuth protected resource 信息
        protected_resource_url = f"{mcp_url.rstrip('/')}/.well-known/oauth-protected-resource"
        print(f"[MCP OAuth Discovery] Fetching protected resource: {protected_resource_url}")
        
        try:
            protected_resource_response = requests.get(protected_resource_url, timeout=10)
            protected_resource_data = protected_resource_response.json() if protected_resource_response.ok else None
            print(f"[MCP OAuth Discovery] Protected resource response: {protected_resource_data}")
        except Exception as e:
            print(f"[MCP OAuth Discovery] Failed to fetch protected resource: {e}")
            protected_resource_data = None
        
        # 2. 获取 OAuth authorization server 信息
        auth_server_url = None
        if protected_resource_data and protected_resource_data.get('authorization_servers'):
            auth_server_url = protected_resource_data['authorization_servers'][0]
        else:
            # 如果没有 protected resource，尝试使用 MCP URL 作为 authorization server
            auth_server_url = mcp_url.rstrip('/')
        
        auth_server_metadata_url = f"{auth_server_url}/.well-known/oauth-authorization-server"
        print(f"[MCP OAuth Discovery] Fetching authorization server metadata: {auth_server_metadata_url}")
        
        try:
            auth_server_response = requests.get(auth_server_metadata_url, timeout=10)
            auth_server_data = auth_server_response.json() if auth_server_response.ok else None
            print(f"[MCP OAuth Discovery] Authorization server response: {auth_server_data}")
        except Exception as e:
            print(f"[MCP OAuth Discovery] Failed to fetch authorization server metadata: {e}")
            return jsonify({
                'error': 'OAuth discovery failed',
                'message': f'Failed to fetch OAuth configuration: {str(e)}'
            }), 400
        
        if not auth_server_data:
            return jsonify({
                'error': 'OAuth not supported',
                'message': 'This MCP server does not support OAuth authentication'
            }), 400
        
        return jsonify({
            'protected_resource': protected_resource_data,
            'authorization_server': auth_server_data,
            'resource': protected_resource_data.get('resource') if protected_resource_data else mcp_url,
        })
        
    except Exception as e:
        print(f"[MCP OAuth Discovery] ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/mcp/oauth/authorize', methods=['POST', 'OPTIONS'])
def mcp_oauth_authorize():
    """生成 OAuth 授权 URL（通用，支持所有 MCP 服务器）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        import secrets
        import hashlib
        import base64
        from urllib.parse import urlencode
        
        data = request.get_json()
        authorization_endpoint = data.get('authorization_endpoint')
        client_id = data.get('client_id')
        resource = data.get('resource')
        code_challenge_methods = data.get('code_challenge_methods_supported', ['S256', 'plain'])
        mcp_url = data.get('mcp_url')  # MCP 服务器 URL
        
        if not authorization_endpoint or not client_id:
            return jsonify({
                'error': 'Missing required parameters',
                'message': 'authorization_endpoint and client_id are required'
            }), 400
        
        # 使用固定的回调地址（不包含client_id）
        # 对于 Notion，使用 config.yaml 中的 redirect_uri（包含末尾斜杠）
        is_notion = resource and 'mcp.notion.com' in resource
        if is_notion:
            notion_config = config.get('notion', {})
            redirect_uri = notion_config.get('redirect_uri', f"{config.get('server', {}).get('url', 'http://localhost:3001')}/mcp/oauth/callback/")
            print(f"[MCP OAuth] Detected Notion MCP, using redirect_uri from config.yaml")
        else:
            backend_url = config.get('server', {}).get('url', 'http://localhost:3001')
            redirect_uri = f"{backend_url}/mcp/oauth/callback"
        
        print(f"[MCP OAuth] Using Client ID: {client_id[:10]}...")
        print(f"[MCP OAuth] Redirect URI: {redirect_uri}")
        
        print(f"[MCP OAuth] Generating authorization URL")
        print(f"[MCP OAuth] Authorization endpoint: {authorization_endpoint}")
        print(f"[MCP OAuth] Client ID: {client_id[:10]}...")
        print(f"[MCP OAuth] Redirect URI (backend): {redirect_uri}")
        print(f"[MCP OAuth] Resource: {resource}")
        print(f"[MCP OAuth] MCP URL: {mcp_url}")
        
        # 生成 state 用于 CSRF 防护
        state = f"mcp_oauth_{secrets.token_urlsafe(32)}"
        
        # 生成 PKCE code_verifier 和 code_challenge
        code_verifier = secrets.token_urlsafe(64)[:128]
        
        # 选择 code_challenge_method（优先使用 S256）
        code_challenge_method = 'S256' if 'S256' in code_challenge_methods else 'plain'
        
        if code_challenge_method == 'S256':
            code_challenge_bytes = hashlib.sha256(code_verifier.encode('utf-8')).digest()
            code_challenge = base64.urlsafe_b64encode(code_challenge_bytes).decode('utf-8').rstrip('=')
        else:
            code_challenge = code_verifier
        
        print(f"[MCP OAuth] Generated PKCE:")
        print(f"[MCP OAuth]   code_verifier: {code_verifier[:30]}...")
        print(f"[MCP OAuth]   code_challenge: {code_challenge[:30]}...")
        print(f"[MCP OAuth]   method: {code_challenge_method}")
        
        # 构建授权 URL
        params = {
            'client_id': client_id,
            'response_type': 'code',
            'redirect_uri': redirect_uri,
            'state': state,
            'code_challenge': code_challenge,
            'code_challenge_method': code_challenge_method,
        }
        
        if resource:
            params['resource'] = resource
        
        authorization_url = f"{authorization_endpoint}?{urlencode(params)}"
        
        print(f"[MCP OAuth] Generated authorization URL (full): {authorization_url}")
        print(f"[MCP OAuth] Generated authorization URL (truncated): {authorization_url[:150]}...")
        
        # 保存 OAuth 配置到 Redis（使用 client_id 作为 key）
        from database import save_oauth_config
        
        oauth_config = {
            'client_id': client_id,
            'code_verifier': code_verifier,
            'code_challenge_method': code_challenge_method,
            'token_endpoint': data.get('token_endpoint'),  # 从请求中获取
            'client_secret': data.get('client_secret', ''),
            'redirect_uri': redirect_uri,  # 后端回调地址（包含 client_id）
            'resource': resource,
            'token_endpoint_auth_methods_supported': data.get('token_endpoint_auth_methods_supported', ['none']),
            'mcp_url': mcp_url,  # 保存 MCP URL，用于后续 token 管理
            'state': state,  # 保留原始 state
        }
        
        # 使用 client_id 作为 key 保存到 Redis，TTL 10 分钟
        save_success = save_oauth_config(client_id, oauth_config, ttl=600)
        if not save_success:
            print(f"[MCP OAuth] ⚠️ WARNING: Failed to save OAuth config to Redis!")
            return jsonify({
                'error': 'Failed to save OAuth configuration',
                'message': 'Could not save OAuth configuration to Redis. Please check Redis connection.'
            }), 500
        print(f"[MCP OAuth] OAuth config saved to Redis with client_id: {client_id}")
        print(f"[MCP OAuth] Redis key: oauth:config:{client_id}")
        
        return jsonify({
            'authorization_url': authorization_url,
            'client_id': client_id,  # 返回 client_id
            'state': state,
            # 不再返回 code_verifier，已保存到 Redis
        })
        
    except Exception as e:
        print(f"[MCP OAuth] ❌ ERROR generating authorization URL: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# 测试端点：验证回调路由是否工作
@app.route('/mcp/oauth/callback/test', methods=['GET'])
def mcp_oauth_callback_test():
    """测试回调路由是否正常工作"""
    print("[TEST] OAuth callback test endpoint hit!")
    return jsonify({'status': 'ok', 'message': 'Callback endpoint is working'}), 200

@app.route('/mcp/oauth/callback', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/mcp/oauth/callback/', methods=['GET', 'POST', 'OPTIONS'])  # 支持末尾斜杠
def mcp_oauth_callback():
    """处理 OAuth 回调，交换 access token（通用）
    GET: 接收 OAuth 服务器的重定向回调
    POST: 前端手动触发的回调（向后兼容）
    
    从 config.yaml 读取 client_id，用于从 Redis 获取配置
    """
    # 从 config.yaml 读取 client_id
    notion_config = config.get('notion', {})
    client_id = notion_config.get('client_id', '')
    
    if not client_id:
        print(f"[MCP OAuth Callback] ❌ ERROR: client_id not found in config.yaml")
        error_html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>OAuth 配置错误</title>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .error { color: #dc2626; }
            </style>
        </head>
        <body>
            <h1 class="error">OAuth 配置错误</h1>
            <p>请在 backend/config.yaml 中配置 notion.client_id</p>
            <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
        </body>
        </html>
        """
        return error_html, 500
    
    # 立即打印请求信息（无论什么方法）
    import sys
    # 同时输出到 stdout 和 stderr，确保日志可见
    msg = f"""
{'='*80}
==== MCP OAUTH CALLBACK ENDPOINT HIT ====
Method: {request.method}
URL: {request.url}
Path: {request.path}
Client ID (from config.yaml): {client_id}
Query String: {request.query_string.decode('utf-8') if request.query_string else 'None'}
Headers: {dict(request.headers)}
{'='*80}
"""
    print(msg, flush=True)
    sys.stderr.write(msg)
    sys.stderr.flush()
    sys.stdout.flush()
    
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    # GET 请求：OAuth 服务器重定向回调
    if request.method == 'GET':
        try:
            import requests
            import json
            
            print("\n" + "="*80)
            print("==== RECEIVED OAUTH CALLBACK (GET) ====")
            print("="*80)
            
            # 从 URL 参数获取 code 和 state
            code = request.args.get('code')
            state = request.args.get('state')
            error = request.args.get('error')
            error_description = request.args.get('error_description')
            
            print(f"[OAuth Callback] Request URL: {request.url}")
            print(f"[OAuth Callback] Client ID: {client_id}")
            print(f"[OAuth Callback] Code: {code}")
            print(f"[OAuth Callback] Code (full): {code}")
            print(f"[OAuth Callback] State: {state}")
            print(f"[OAuth Callback] Error: {error}")
            print(f"[OAuth Callback] Error Description: {error_description}")
            print("="*80 + "\n")
            
            # 检查是否有错误
            if error:
                print(f"[OAuth Callback] ❌ ERROR: OAuth provider returned error: {error}")
                print(f"[OAuth Callback] Error description: {error_description}")
                error_html = f"""
                <!DOCTYPE html>
                <html>
                <head>
                    <title>OAuth 授权失败</title>
                    <meta charset="utf-8">
                    <style>
                        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                        .error {{ color: #dc2626; }}
                    </style>
                </head>
                <body>
                    <h1 class="error">OAuth 授权失败</h1>
                    <p>错误: {error}</p>
                    <p>{error_description or ''}</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 400
            
            # code 是必需的
            if not code:
                print(f"[OAuth Callback] ❌ ERROR: Missing required parameter 'code'")
                print(f"[OAuth Callback] Request args: {dict(request.args)}")
                error_html = """
                <!DOCTYPE html>
                <html>
                <head>
                    <title>OAuth 回调错误</title>
                    <meta charset="utf-8">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .error { color: #dc2626; }
                    </style>
                </head>
                <body>
                    <h1 class="error">OAuth 回调错误</h1>
                    <p>缺少必要的参数（code）</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 400
            
            # 从 Redis 获取 OAuth 配置（使用 client_id）
            from database import get_oauth_config, delete_oauth_config, save_oauth_config, get_redis_client
            
            print(f"[OAuth Callback] Looking for OAuth config with client_id: {client_id}")
            print(f"[OAuth Callback] Full client_id: {client_id}")
            
            # 尝试获取配置
            oauth_config = get_oauth_config(client_id)
            
            # 如果找不到，尝试列出所有OAuth配置key以便调试
            if not oauth_config:
                print(f"[OAuth Callback] ⚠️ OAuth config not found for client_id: {client_id}")
                try:
                    redis_client = get_redis_client()
                    if redis_client:
                        all_keys = redis_client.keys('oauth:config:*')
                        print(f"[OAuth Callback] Available OAuth config keys in Redis: {[k.decode('utf-8') if isinstance(k, bytes) else k for k in all_keys[:20]]}")
                except Exception as e:
                    print(f"[OAuth Callback] Error checking Redis keys: {e}")
            
            # 打印 code_verifier 用于手动调试
            if oauth_config:
                code_verifier = oauth_config.get('code_verifier')
                print("\n" + "="*80)
                print("==== DEBUG INFO FOR MANUAL TESTING ====")
                print("="*80)
                print(f"Code: {code}")
                print(f"Code Verifier: {code_verifier}")
                print(f"Client ID: {client_id}")
                print(f"State: {state}")
                print("="*80 + "\n")
            
            if not oauth_config:
                error_html = f"""
                <!DOCTYPE html>
                <html>
                <head>
                    <title>OAuth 配置过期</title>
                    <meta charset="utf-8">
                    <style>
                        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                        .error {{ color: #dc2626; }}
                        .info {{ color: #666; font-size: 12px; margin-top: 20px; }}
                    </style>
                </head>
                <body>
                    <h1 class="error">OAuth 配置过期</h1>
                    <p>OAuth 配置已过期或不存在。请重新开始授权流程。</p>
                    <p class="info">Client ID: {client_id}</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 400
            
            # 从 Redis 配置中提取所需信息
            code_verifier = oauth_config.get('code_verifier')
            token_endpoint = oauth_config.get('token_endpoint')
            # client_id 已从路径参数获取，验证配置中的client_id是否匹配
            config_client_id = oauth_config.get('client_id')
            if config_client_id and config_client_id != client_id:
                print(f"[OAuth Callback] ⚠️ Warning: Client ID mismatch. Path: {client_id}, Config: {config_client_id}")
            client_secret = oauth_config.get('client_secret', '')
            resource = oauth_config.get('resource')
            # 使用固定的回调地址（不包含client_id）
            # 对于 Notion，使用 config.yaml 中的 redirect_uri（包含末尾斜杠）
            is_notion = resource and 'mcp.notion.com' in resource
            if is_notion:
                notion_config = config.get('notion', {})
                redirect_uri = notion_config.get('redirect_uri', f"{config.get('server', {}).get('url', 'http://localhost:3001')}/mcp/oauth/callback/")
                print(f"[MCP OAuth Callback] Detected Notion MCP, using redirect_uri from config.yaml")
            else:
                backend_url = config.get('server', {}).get('url', 'http://localhost:3001')
                redirect_uri = f"{backend_url}/mcp/oauth/callback"
            token_endpoint_auth_methods = oauth_config.get('token_endpoint_auth_methods_supported', ['none'])
            mcp_url = oauth_config.get('mcp_url')  # 保存的 MCP 服务器 URL
            
            print("[OAuth Callback] OAuth Config from Redis:")
            print(f"  token_endpoint: {token_endpoint}")
            print(f"  client_id (from path): {client_id}")
            print(f"  client_id (from config): {config_client_id}")
            print(f"  redirect_uri (fixed): {redirect_uri}")
            print(f"  resource: {resource}")
            print(f"  mcp_url: {mcp_url}")
            print(f"  code_verifier present: {bool(code_verifier)}")
            
            if not code_verifier or not token_endpoint or not client_id or not redirect_uri:
                missing_fields = []
                if not code_verifier:
                    missing_fields.append('code_verifier')
                if not token_endpoint:
                    missing_fields.append('token_endpoint')
                if not client_id:
                    missing_fields.append('client_id')
                if not redirect_uri:
                    missing_fields.append('redirect_uri')
                
                print(f"[OAuth Callback] ❌ ERROR: Missing required fields in OAuth config: {missing_fields}")
                print(f"[OAuth Callback] Full OAuth config from Redis: {oauth_config}")
                print(f"[OAuth Callback] Config keys: {list(oauth_config.keys()) if oauth_config else 'None'}")
                print(f"[OAuth Callback] Field values:")
                print(f"  code_verifier: {'present' if code_verifier else 'MISSING'} ({type(code_verifier).__name__})")
                print(f"  token_endpoint: {'present' if token_endpoint else 'MISSING'} ({type(token_endpoint).__name__})")
                print(f"  client_id: {'present' if client_id else 'MISSING'} ({type(client_id).__name__})")
                print(f"  redirect_uri: {'present' if redirect_uri else 'MISSING'} ({type(redirect_uri).__name__})")
                
                error_html = f"""
                <!DOCTYPE html>
                <html>
                <head>
                    <title>OAuth 配置不完整</title>
                    <meta charset="utf-8">
                    <style>
                        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                        .error {{ color: #dc2626; }}
                        .info {{ color: #666; font-size: 12px; margin-top: 20px; }}
                    </style>
                </head>
                <body>
                    <h1 class="error">OAuth 配置不完整</h1>
                    <p>OAuth 配置缺少必要的信息。请重新开始授权流程。</p>
                    <p class="info">缺少的字段: {', '.join(missing_fields)}</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 400
            
            # 自动交换 token
            print(f"[MCP OAuth] Exchanging code for access token")
            
            # 对于 Notion，使用专用模块
            if is_notion:
                try:
                    from mcp_server.well_known.notion import exchange_notion_token
                    token_data = exchange_notion_token(config, code, code_verifier, redirect_uri)
                    access_token = token_data.get('access_token')
                    refresh_token = token_data.get('refresh_token')
                    expires_in = token_data.get('expires_in')
                except Exception as e:
                    print(f"[MCP OAuth] ❌ Notion token exchange failed: {e}")
                    error_html = f"""
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Token 交换失败</title>
                        <meta charset="utf-8">
                        <style>
                            body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                            .error {{ color: #dc2626; }}
                        </style>
                    </head>
                    <body>
                        <h1 class="error">Token 交换失败</h1>
                        <p>{str(e)}</p>
                        <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                    </body>
                    </html>
                    """
                    return error_html, 500
            else:
                # 通用 token 交换逻辑
                headers = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
                
                payload = {
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': redirect_uri,
                    'code_verifier': code_verifier,
                    'client_id': client_id,
                }
                
                # 根据 token_endpoint_auth_methods 选择认证方式
                if 'client_secret_basic' in token_endpoint_auth_methods and client_secret:
                    import base64
                    auth_string = f"{client_id}:{client_secret}"
                    auth_bytes = auth_string.encode('utf-8')
                    auth_b64 = base64.b64encode(auth_bytes).decode('utf-8')
                    headers['Authorization'] = f'Basic {auth_b64}'
                    print(f"[MCP OAuth] Using client_secret_basic authentication")
                elif 'client_secret_post' in token_endpoint_auth_methods and client_secret:
                    payload['client_secret'] = client_secret
                    print(f"[MCP OAuth] Using client_secret_post authentication")
                else:
                    print(f"[MCP OAuth] Using no authentication (public client)")
                
                if resource:
                    payload['resource'] = resource
                
                print(f"[MCP OAuth] Sending token request to: {token_endpoint}")
                print(f"[MCP OAuth] Redirect URI: {redirect_uri}")
                
                # 记录请求信息
                log_http_request('POST', token_endpoint, headers=headers, data=payload)
                
                # 使用 form-urlencoded 格式发送
                response = requests.post(token_endpoint, data=payload, headers=headers, timeout=30)
                
                # 记录响应信息
                log_http_response(response)
                
                print(f"[MCP OAuth] Token response status: {response.status_code}")
                
                if not response.ok:
                    error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
                    print(f"[MCP OAuth] ❌ Token exchange failed: {response.status_code}")
                    print(f"[MCP OAuth] Error response: {error_data}")
                    
                    error_html = f"""
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Token 交换失败</title>
                        <meta charset="utf-8">
                        <style>
                            body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                            .error {{ color: #dc2626; }}
                            pre {{ text-align: left; background: #f3f4f6; padding: 20px; border-radius: 8px; }}
                        </style>
                    </head>
                    <body>
                        <h1 class="error">Token 交换失败</h1>
                        <p>状态码: {response.status_code}</p>
                        <pre>{json.dumps(error_data, indent=2, ensure_ascii=False)}</pre>
                        <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                    </body>
                    </html>
                    """
                    return error_html, response.status_code
                
                token_data = response.json()
                print(f"[MCP OAuth] ✅ Access token received successfully")
                print(f"[MCP OAuth] Token type: {token_data.get('token_type', 'N/A')}")
                print(f"[MCP OAuth] Expires in: {token_data.get('expires_in', 'N/A')} seconds")
                
                access_token = token_data.get('access_token')
                refresh_token = token_data.get('refresh_token')
                expires_in = token_data.get('expires_in')
            
            if not access_token:
                error_html = """
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Token 响应错误</title>
                    <meta charset="utf-8">
                    <style>
                        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                        .error {{ color: #dc2626; }}
                    </style>
                </head>
                <body>
                    <h1 class="error">Token 响应错误</h1>
                    <p>响应中没有 access_token</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 500
            
            # 保存 token 到 Redis 和 MySQL（使用 client_id 和 mcp_url）
            import time
            # 规范化 mcp_url（移除尾随斜杠，统一格式）
            normalized_mcp_url = mcp_url.rstrip('/') if mcp_url else None
            
            # 构建 token_info（对于 Notion，token_data 可能包含额外字段）
            token_info = {
                'client_id': client_id,  # 关联 Client ID
                'access_token': access_token,
                'refresh_token': refresh_token,
                'token_type': token_data.get('token_type', 'bearer'),
                'expires_in': expires_in,
                'expires_at': int(time.time()) + expires_in if expires_in else None,
                'scope': token_data.get('scope', ''),
                'state': state,  # 保留原始 state（如果有）
                'mcp_url': normalized_mcp_url,  # 保存规范化的 MCP URL
            }
            
            # 对于 Notion，保存额外的信息（workspace_id, bot_id 等）
            if is_notion:
                token_info['workspace_id'] = token_data.get('workspace_id')
                token_info['workspace_name'] = token_data.get('workspace_name')
                token_info['bot_id'] = token_data.get('bot_id')
            
            # 保存 token 到 Redis 和 MySQL
            # 使用两个 key：1. mcp_url 2. client_id
            from database import save_oauth_token
            
            # 主 key：使用 mcp_url（用于代理时查找 token）
            if normalized_mcp_url:
                save_oauth_token(normalized_mcp_url, token_info)
                print(f"[MCP OAuth] ✅ Token saved to Redis and MySQL with key: oauth:token:{normalized_mcp_url}")
            
            # 辅助 key：使用 client_id（用于前端查询状态）
            save_oauth_token(f"client:{client_id}", token_info)
            print(f"[MCP OAuth] ✅ Token also saved with client_id: oauth:token:client:{client_id[:10]}...")
            print(f"[MCP OAuth] Client ID: {client_id}")
            
            # 保存 OAuth 配置到 Redis（用于后续刷新 token）
            oauth_config_for_refresh = {
                'client_id': client_id,
                'token_endpoint': token_endpoint,
                'client_secret': client_secret,
                'resource': resource,
                'token_endpoint_auth_methods_supported': token_endpoint_auth_methods,
                'mcp_url': normalized_mcp_url,
            }
            
            # 使用 mcp_url 和 client_id 保存刷新配置
            if normalized_mcp_url:
                save_oauth_config(f"refresh_{normalized_mcp_url}", oauth_config_for_refresh, ttl=None)  # 永不过期
                print(f"[MCP OAuth] ✅ Refresh config saved with key: refresh_{normalized_mcp_url}")
            
            save_oauth_config(f"refresh_client:{client_id}", oauth_config_for_refresh, ttl=None)  # 永不过期
            print(f"[MCP OAuth] ✅ Refresh config saved with client_id: refresh_client:{client_id[:10]}...")
            
            # 更新服务器配置的 ext 字段，确保包含 response_format
            if normalized_mcp_url:
                try:
                    from database import get_mysql_connection
                    conn = get_mysql_connection()
                    if conn:
                        cursor = conn.cursor()
                        # 获取当前 ext 配置
                        cursor.execute(
                            "SELECT ext FROM mcp_servers WHERE url = %s LIMIT 1",
                            (normalized_mcp_url,)
                        )
                        server_row = cursor.fetchone()
                        
                        if server_row:
                            current_ext = server_row[0]
                            if isinstance(current_ext, str):
                                current_ext = json.loads(current_ext) if current_ext else {}
                            elif current_ext is None:
                                current_ext = {}
                            
                            # 更新 ext，确保包含 response_format
                            updated_ext = current_ext.copy()
                            if is_notion:
                                updated_ext['server_type'] = 'notion'
                                updated_ext['response_format'] = 'sse'  # Notion 使用 SSE
                            elif 'response_format' not in updated_ext:
                                updated_ext['response_format'] = 'json'  # 默认 JSON
                            
                            # 如果 ext 有变化，更新数据库
                            if updated_ext != current_ext:
                                cursor.execute(
                                    "UPDATE mcp_servers SET ext = %s WHERE url = %s",
                                    (json.dumps(updated_ext), normalized_mcp_url)
                                )
                                conn.commit()
                                print(f"[MCP OAuth] ✅ Updated server ext with response_format: {updated_ext.get('response_format')}")
                        
                        cursor.close()
                        conn.close()
                except Exception as update_error:
                    print(f"[MCP OAuth] ⚠️ Warning: Failed to update server ext: {update_error}")
            
            # 删除临时的 OAuth 配置（client_id 相关的临时配置）
            delete_oauth_config(client_id)
            print(f"[MCP OAuth] ✅ Temporary OAuth config deleted: {client_id[:10]}...")
            
            # 返回成功页面
            success_html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>OAuth 授权成功</title>
                <meta charset="utf-8">
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        min-height: 100vh;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                    }
                    .success { 
                        color: #10b981; 
                        font-size: 48px;
                        margin-bottom: 20px;
                    }
                    h1 {
                        color: white;
                        margin: 20px 0;
                    }
                    .info { 
                        color: rgba(255, 255, 255, 0.9); 
                        margin-top: 20px;
                        font-size: 16px;
                    }
                    .spinner {
                        border: 3px solid rgba(255, 255, 255, 0.3);
                        border-top: 3px solid white;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="success">✓</div>
                <h1>OAuth 授权成功</h1>
                <p class="info">Access token 已保存到服务器</p>
                <p class="info">窗口将自动关闭...</p>
                <div class="spinner"></div>
                <script>
                    // 检测是否在 Electron 环境中
                    const isElectron = typeof window !== 'undefined' && 
                                      (window.navigator.userAgent.includes('Electron') || 
                                       window.location.protocol === 'file:');
                    
                    if (isElectron) {
                        // Electron 环境：立即尝试关闭（Electron 主进程会处理）
                        console.log('Electron environment detected, window will be closed by main process');
                        // Electron 主进程会检测到成功页面并关闭窗口
                    } else if (window.opener) {
                        // 浏览器环境：如果是弹窗，尝试关闭
                        setTimeout(() => {
                            window.close();
                        }, 1500);
                    } else {
                        // 浏览器环境：如果不是弹窗，显示提示
                        setTimeout(() => {
                            document.querySelector('.info').textContent = '请手动关闭此标签页并返回应用';
                        }, 2000);
                    }
                </script>
            </body>
            </html>
            """
            return success_html, 200
            
        except Exception as e:
            print(f"[MCP OAuth] ❌ ERROR in GET callback: {e}")
            import traceback
            print("[MCP OAuth] Full traceback:")
            traceback.print_exc()
            
            error_html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>OAuth 回调错误</title>
                <meta charset="utf-8">
                <style>
                    body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                    .error {{ color: #dc2626; }}
                </style>
            </head>
            <body>
                <h1 class="error">OAuth 回调错误</h1>
                <p>处理 OAuth 回调时发生错误：{str(e)}</p>
                <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
            </body>
            </html>
            """
            return error_html, 500
            
        except Exception as e:
            print(f"[MCP OAuth] ❌ ERROR in GET callback: {e}")
            import traceback
            print("[MCP OAuth] Full traceback:")
            traceback.print_exc()
            
            error_html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>OAuth 回调错误</title>
                <meta charset="utf-8">
                <style>
                    body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                    .error {{ color: #dc2626; }}
                </style>
            </head>
            <body>
                <h1 class="error">OAuth 回调错误</h1>
                <p>{str(e)}</p>
                <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
            </body>
            </html>
            """
            return error_html, 500
    
    # POST 请求：前端手动触发的回调（向后兼容）
    try:
        import requests
        import json
        
        print("\n" + "="*80)
        print("==== RECEIVED CALLBACK ====")
        print("="*80)
        
        # 打印所有请求信息
        print(f"[Callback] Request Method: {request.method}")
        print(f"[Callback] Request URL: {request.url}")
        print(f"[Callback] Request Headers:")
        for key, value in request.headers.items():
            print(f"  {key}: {value}")
        print(f"[Callback] Request Content-Type: {request.content_type}")
        print(f"[Callback] Request Content-Length: {request.content_length}")
        
        # 获取请求数据
        if request.is_json:
            data = request.get_json()
            print(f"[Callback] Request JSON Body:")
            print(json.dumps(data, indent=2, ensure_ascii=False))
        else:
            data = {}
            print(f"[Callback] Request Data (raw): {request.get_data(as_text=True)[:500]}")
        
        code = data.get('code')
        state = data.get('state')
        
        print("\n[Callback] Extracted Parameters:")
        print(f"  client_id: {client_id}")
        print(f"  code: {code[:50] + '...' if code and len(code) > 50 else code}")
        print(f"  state: {state}")
        print("="*80 + "\n")
        
        if not code:
            return jsonify({'error': 'Missing authorization code'}), 400
        
        # 从 Redis 获取 OAuth 配置（使用 client_id）
        from database import get_oauth_config, delete_oauth_config, save_oauth_config, save_oauth_token
        
        print(f"[Callback POST] Looking for OAuth config with client_id: {client_id[:10]}...")
        oauth_config = get_oauth_config(client_id)
        
        if not oauth_config:
            return jsonify({
                'error': 'OAuth configuration not found',
                'message': f'OAuth configuration for client_id {client_id[:10]}... expired or not found. Please restart the authorization flow.'
            }), 400
        
        # 从 Redis 配置中提取所需信息
        code_verifier = oauth_config.get('code_verifier')
        token_endpoint = oauth_config.get('token_endpoint')
        # client_id 已从路径参数获取，不需要从配置中再次获取
        config_client_id = oauth_config.get('client_id')
        if config_client_id and config_client_id != client_id:
            print(f"[MCP OAuth POST] ⚠️ Warning: Client ID mismatch. Path: {client_id[:10]}..., Config: {config_client_id[:10]}...")
        client_secret = oauth_config.get('client_secret', '')
        resource = oauth_config.get('resource')
        # 使用固定的回调地址（不包含client_id）
        # 对于 Notion，使用 config.yaml 中的 redirect_uri（包含末尾斜杠）
        is_notion = resource and 'mcp.notion.com' in resource
        if is_notion:
            notion_config = config.get('notion', {})
            redirect_uri = notion_config.get('redirect_uri', f"{config.get('server', {}).get('url', 'http://localhost:3001')}/mcp/oauth/callback/")
            print(f"[MCP OAuth POST Callback] Detected Notion MCP, using redirect_uri from config.yaml")
        else:
            backend_url = config.get('server', {}).get('url', 'http://localhost:3001')
            redirect_uri = f"{backend_url}/mcp/oauth/callback"
        token_endpoint_auth_methods = oauth_config.get('token_endpoint_auth_methods_supported', ['none'])
        mcp_url = oauth_config.get('mcp_url')
        
        print("[Callback] OAuth Config from Redis:")
        print(f"  token_endpoint: {token_endpoint}")
        print(f"  client_id: {client_id[:10]}...")
        print(f"  redirect_uri: {redirect_uri}")
        print(f"  resource: {resource}")
        print(f"  code_verifier: {code_verifier[:30] + '...' if code_verifier else 'None'}")
        print("="*80 + "\n")
        
        if not code_verifier:
            return jsonify({'error': 'Missing code_verifier in OAuth configuration'}), 400
        
        if not token_endpoint:
            return jsonify({'error': 'Missing token_endpoint in OAuth configuration'}), 400
        
        if not client_id:
            return jsonify({'error': 'Missing client_id in OAuth configuration'}), 400
        
        if not redirect_uri:
            return jsonify({'error': 'Missing redirect_uri in OAuth configuration'}), 400
        
        print(f"[MCP OAuth] Exchanging code for access token")
        
        # 对于 Notion，使用专用模块
        if is_notion:
            try:
                from mcp_server.well_known.notion import exchange_notion_token
                token_data = exchange_notion_token(config, code, code_verifier, redirect_uri)
                access_token = token_data.get('access_token')
                refresh_token = token_data.get('refresh_token')
                expires_in = token_data.get('expires_in')
            except Exception as e:
                print(f"[MCP OAuth] ❌ Notion token exchange failed: {e}")
                import traceback
                traceback.print_exc()
                return jsonify({
                    'error': 'Token exchange failed',
                    'details': str(e)
                }), 500
        else:
            # 通用 token 交换逻辑
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
            
            payload = {
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': redirect_uri,
                'code_verifier': code_verifier,
                'client_id': client_id,
            }
            
            # 根据 token_endpoint_auth_methods 选择认证方式
            if 'client_secret_basic' in token_endpoint_auth_methods and client_secret:
                import base64
                auth_string = f"{client_id}:{client_secret}"
                auth_bytes = auth_string.encode('utf-8')
                auth_b64 = base64.b64encode(auth_bytes).decode('utf-8')
                headers['Authorization'] = f'Basic {auth_b64}'
                print(f"[MCP OAuth] Using client_secret_basic authentication")
            elif 'client_secret_post' in token_endpoint_auth_methods and client_secret:
                payload['client_secret'] = client_secret
                print(f"[MCP OAuth] Using client_secret_post authentication")
            else:
                print(f"[MCP OAuth] Using no authentication (public client)")
            
            if resource:
                payload['resource'] = resource
            
            print(f"[MCP OAuth] Sending token request to: {token_endpoint}")
            print(f"[MCP OAuth] Redirect URI: {redirect_uri}")
            
            # 记录请求信息
            log_http_request('POST', token_endpoint, headers=headers, data=payload)
            
            # 使用 form-urlencoded 格式发送
            response = requests.post(token_endpoint, data=payload, headers=headers, timeout=30)
            
            # 记录响应信息
            log_http_response(response)
            
            print(f"[MCP OAuth] Token response status: {response.status_code}")
            
            if not response.ok:
                error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
                print(f"[MCP OAuth] ❌ Token exchange failed: {response.status_code}")
                print(f"[MCP OAuth] Error response: {error_data}")
                return jsonify({
                    'error': 'Token exchange failed',
                    'details': error_data
                }), response.status_code
            
            token_data = response.json()
            print(f"[MCP OAuth] ✅ Access token received successfully")
            print(f"[MCP OAuth] Token type: {token_data.get('token_type', 'N/A')}")
            print(f"[MCP OAuth] Expires in: {token_data.get('expires_in', 'N/A')} seconds")
            
            access_token = token_data.get('access_token')
            refresh_token = token_data.get('refresh_token')
            expires_in = token_data.get('expires_in')
        
        if not access_token:
            print(f"[MCP OAuth] ⚠️ WARNING: No access_token in response!")
            print(f"[MCP OAuth] Full response: {json.dumps(token_data, indent=2)}")
            return jsonify({'error': 'No access_token in response'}), 500
        
        # 保存 token 到 Redis 和 MySQL（使用 client_id 和 mcp_url）
        import time
        normalized_mcp_url = mcp_url.rstrip('/') if mcp_url else None
        
        token_info = {
            'client_id': client_id,
            'access_token': access_token,
            'refresh_token': refresh_token,
            'token_type': token_data.get('token_type', 'bearer'),
            'expires_in': expires_in,
            'expires_at': int(time.time()) + expires_in if expires_in else None,
            'scope': token_data.get('scope', ''),
            'state': state,
            'mcp_url': normalized_mcp_url,
        }
        
        # 对于 Notion，保存额外的信息（workspace_id, bot_id 等）
        if is_notion:
            token_info['workspace_id'] = token_data.get('workspace_id')
            token_info['workspace_name'] = token_data.get('workspace_name')
            token_info['bot_id'] = token_data.get('bot_id')
        
        # 保存 token 到 Redis（使用两个 key）
        if normalized_mcp_url:
            save_oauth_token(normalized_mcp_url, token_info)
            print(f"[MCP OAuth POST] ✅ Token saved to Redis with key: oauth:token:{normalized_mcp_url}")
        
        save_oauth_token(f"client:{client_id}", token_info)
        print(f"[MCP OAuth POST] ✅ Token also saved with client_id: oauth:token:client:{client_id[:10]}...")
        
        # 保存 OAuth 配置到 Redis（用于后续刷新 token）
        oauth_config_for_refresh = {
            'client_id': client_id,
            'token_endpoint': token_endpoint,
            'client_secret': client_secret,
            'resource': resource,
            'token_endpoint_auth_methods_supported': token_endpoint_auth_methods,
            'mcp_url': normalized_mcp_url,
        }
        
        if normalized_mcp_url:
            save_oauth_config(f"refresh_{normalized_mcp_url}", oauth_config_for_refresh, ttl=None)
            print(f"[MCP OAuth POST] ✅ Refresh config saved with key: refresh_{normalized_mcp_url}")
        
        save_oauth_config(f"refresh_client:{client_id}", oauth_config_for_refresh, ttl=None)
        print(f"[MCP OAuth POST] ✅ Refresh config saved with client_id: refresh_client:{client_id[:10]}...")
        
        # 更新服务器配置的 ext 字段，确保包含 response_format
        if normalized_mcp_url:
            try:
                from database import get_mysql_connection
                conn = get_mysql_connection()
                if conn:
                    cursor = conn.cursor()
                    # 获取当前 ext 配置
                    cursor.execute(
                        "SELECT ext FROM mcp_servers WHERE url = %s LIMIT 1",
                        (normalized_mcp_url,)
                    )
                    server_row = cursor.fetchone()
                    
                    if server_row:
                        current_ext = server_row[0]
                        if isinstance(current_ext, str):
                            current_ext = json.loads(current_ext) if current_ext else {}
                        elif current_ext is None:
                            current_ext = {}
                        
                        # 更新 ext，确保包含 response_format
                        updated_ext = current_ext.copy()
                        if is_notion:
                            updated_ext['server_type'] = 'notion'
                            updated_ext['response_format'] = 'sse'  # Notion 使用 SSE
                        elif 'response_format' not in updated_ext:
                            updated_ext['response_format'] = 'json'  # 默认 JSON
                        
                        # 如果 ext 有变化，更新数据库
                        if updated_ext != current_ext:
                            cursor.execute(
                                "UPDATE mcp_servers SET ext = %s WHERE url = %s",
                                (json.dumps(updated_ext), normalized_mcp_url)
                            )
                            conn.commit()
                            print(f"[MCP OAuth POST] ✅ Updated server ext with response_format: {updated_ext.get('response_format')}")
                    
                    cursor.close()
                    conn.close()
            except Exception as update_error:
                print(f"[MCP OAuth POST] ⚠️ Warning: Failed to update server ext: {update_error}")
        
        # 删除临时的 OAuth 配置（client_id 相关的临时配置）
        delete_oauth_config(client_id)
        print(f"[MCP OAuth POST] ✅ Temporary OAuth config deleted: {client_id[:10]}...")
        
        return jsonify({
            'success': True,
            'access_token': access_token,
            'token_type': token_data.get('token_type', 'bearer'),
            'expires_in': expires_in,
            'refresh_token': refresh_token,
            'scope': token_data.get('scope', ''),
            'client_id': client_id,
        })
        
    except Exception as e:
        print(f"[MCP OAuth] ❌ ERROR in callback: {e}")
        import traceback
        print("[MCP OAuth] Full traceback:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== Notion OAuth API (保留向后兼容) ====================

@app.route('/api/notion/oauth/authorize', methods=['POST', 'OPTIONS'])
def notion_oauth_authorize():
    """生成Notion MCP OAuth授权URL（使用PKCE）"""
    # 处理 CORS 预检请求
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from mcp_server.well_known.notion import generate_notion_authorization_url
        result = generate_notion_authorization_url(config)
        return jsonify(result)
    except ValueError as e:
        print(f"[Notion OAuth] ERROR: {e}")
        return jsonify({
            'error': 'Notion OAuth not configured',
            'message': str(e)
        }), 500
    except Exception as e:
        print(f"[Notion OAuth] ❌ ERROR generating authorization URL: {e}")
        import traceback
        print("[Notion OAuth] Full traceback:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/notion/oauth/callback', methods=['POST', 'OPTIONS'])
def notion_oauth_callback():
    """处理Notion OAuth回调，交换access token（使用PKCE）"""
    # 处理 CORS 预检请求
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        import json
        
        # 获取请求数据
        if request.is_json:
            data = request.get_json()
        else:
            data = {}
        
        code = data.get('code')
        code_verifier = data.get('code_verifier')
        
        if not code:
            print("[Notion OAuth] ❌ ERROR: Missing authorization code")
            return jsonify({'error': 'Missing authorization code'}), 400
        
        if not code_verifier:
            print("[Notion OAuth] ❌ ERROR: Missing code_verifier (required for PKCE)")
            return jsonify({'error': 'Missing code_verifier'}), 400
        
        from mcp_server.well_known.notion import exchange_notion_token
        token_data = exchange_notion_token(config, code, code_verifier)
        
        return jsonify({
            'access_token': token_data.get('access_token'),
            'workspace_id': token_data.get('workspace_id'),
            'workspace_name': token_data.get('workspace_name'),
            'workspace_icon': token_data.get('workspace_icon'),
            'bot_id': token_data.get('bot_id'),
            'owner': token_data.get('owner'),
        })
        
    except ValueError as e:
        print(f"[Notion OAuth] ❌ ERROR: {e}")
        return jsonify({
            'error': 'Notion OAuth not configured',
            'message': str(e)
        }), 500
    except Exception as e:
        print(f"[Notion OAuth] ❌ ERROR in callback: {e}")
        import traceback
        print("[Notion OAuth] Full traceback:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== MCP 服务器配置管理 API ====================

@app.route('/api/mcp/servers', methods=['GET', 'OPTIONS'])
def list_mcp_servers():
    """获取所有MCP服务器配置列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            # MySQL不可用时返回空列表而不是错误，允许应用继续运行
            print("[MCP API] MySQL not available, returning empty list")
            return jsonify({'servers': [], 'total': 0, 'warning': 'MySQL not available'})
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 检查表是否存在
            cursor.execute("SHOW TABLES LIKE 'mcp_servers'")
            if not cursor.fetchone():
                print("[MCP API] Table 'mcp_servers' does not exist, returning empty list")
                return jsonify({'servers': [], 'total': 0, 'warning': 'Table mcp_servers does not exist'})
            
            cursor.execute("""
                SELECT server_id, name, url, type, enabled, use_proxy, description, 
                       metadata, ext, created_at, updated_at
                FROM mcp_servers
                ORDER BY created_at DESC
            """)
            
            columns = [desc[0] for desc in cursor.description]
            servers = []
            for row in cursor.fetchall():
                server = dict(zip(columns, row))
                # 使用 server_id 作为 id 字段
                server['id'] = server.pop('server_id')
                # 解析JSON字段
                if server.get('metadata'):
                    try:
                        server['metadata'] = json.loads(server['metadata']) if isinstance(server['metadata'], str) else server['metadata']
                    except:
                        server['metadata'] = {}
                # 解析ext字段
                if server.get('ext'):
                    try:
                        server['ext'] = json.loads(server['ext']) if isinstance(server['ext'], str) else server['ext']
                    except:
                        server['ext'] = {}
                # 转换 TINYINT 为 boolean
                server['enabled'] = bool(server.get('enabled'))
                server['use_proxy'] = bool(server.get('use_proxy'))
                # 转换日期时间为字符串
                if server.get('created_at'):
                    server['created_at'] = server['created_at'].isoformat() if hasattr(server['created_at'], 'isoformat') else str(server['created_at'])
                if server.get('updated_at'):
                    server['updated_at'] = server['updated_at'].isoformat() if hasattr(server['updated_at'], 'isoformat') else str(server['updated_at'])
                servers.append(server)
            
            return jsonify({'servers': servers, 'total': len(servers)})
        finally:
            if cursor:
                cursor.close()
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[MCP API] Error listing MCP servers: {e}")
        print(f"[MCP API] Traceback: {error_trace}")
        # 返回空列表而不是500错误，允许应用继续运行
        return jsonify({'servers': [], 'total': 0, 'error': str(e)})

@app.route('/api/mcp/servers', methods=['POST', 'OPTIONS'])
def create_mcp_server():
    """创建MCP服务器配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # 验证必需字段
        required_fields = ['name', 'url']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 生成唯一的 server_id
            import uuid
            server_id = data.get('id') or f"mcp-{uuid.uuid4().hex[:12]}"
            
            # 插入数据
            cursor.execute("""
                INSERT INTO mcp_servers 
                (server_id, name, url, type, enabled, use_proxy, description, metadata, ext)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                server_id,
                data['name'],
                data['url'],
                data.get('type', 'http-stream'),
                data.get('enabled', True),
                data.get('use_proxy', True),
                data.get('description'),
                json.dumps(data.get('metadata', {})),
                json.dumps(data.get('ext', {})) if data.get('ext') else None
            ))
            
            conn.commit()
            
            return jsonify({
                'server_id': server_id,
                'message': 'MCP server created successfully'
            }), 201
            
        finally:
            if cursor:
                cursor.close()
    except Exception as e:
        print(f"Error creating MCP server: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/mcp/servers/<server_id>/test', methods=['POST', 'OPTIONS'])
def test_mcp_server(server_id):
    """测试 MCP 服务器连接并获取工具列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        from mcp_server.mcp_common_logic import prepare_mcp_headers, initialize_mcp_session, send_mcp_notification, get_mcp_tools_list
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 获取服务器配置
            cursor.execute("""
                SELECT server_id, name, url, type, metadata, ext 
                FROM mcp_servers 
                WHERE server_id = %s
            """, (server_id,))
            
            server_row = cursor.fetchone()
            if not server_row:
                return jsonify({'error': 'Server not found'}), 404
            
            server_data = {
                'id': server_row[0],
                'name': server_row[1],
                'url': server_row[2],
                'type': server_row[3],
                'metadata': json.loads(server_row[4]) if server_row[4] else {},
                'ext': json.loads(server_row[5]) if server_row[5] else {},
            }
            
            target_url = server_data['url']
            print(f"\n[MCP Test] Testing server: {server_data['name']} ({target_url})")
            
            # 准备请求头（包括 OAuth token）
            request_headers = dict(request.headers)
            headers = prepare_mcp_headers(target_url, request_headers)
            
            print(f"[MCP Test] Prepared headers with {len(headers)} entries")
            
            # 1. 初始化会话
            print(f"[MCP Test] Step 1: Initializing session...")
            init_response = initialize_mcp_session(target_url, headers)
            
            if not init_response:
                return jsonify({
                    'success': False,
                    'error': 'Failed to initialize MCP session',
                    'step': 'initialize'
                }), 500
            
            print(f"[MCP Test] ✅ Session initialized")
            
            # 2. 发送 initialized 通知
            print(f"[MCP Test] Step 2: Sending initialized notification...")
            notification_sent = send_mcp_notification(target_url, 'notifications/initialized', {}, headers)
            
            if notification_sent:
                print(f"[MCP Test] ✅ Notification sent")
            else:
                print(f"[MCP Test] ⚠️ Notification failed (continuing anyway)")
            
            # 3. 获取工具列表
            print(f"[MCP Test] Step 3: Getting tools list...")
            tools_response = get_mcp_tools_list(target_url, headers)
            
            if not tools_response:
                return jsonify({
                    'success': False,
                    'error': 'Failed to get tools list',
                    'step': 'tools/list',
                    'init_response': init_response
                }), 500
            
            # 提取工具列表
            tools = []
            if 'result' in tools_response and 'tools' in tools_response['result']:
                tools = tools_response['result']['tools']
            
            print(f"[MCP Test] ✅ Retrieved {len(tools)} tools")
            
            return jsonify({
                'success': True,
                'connected': True,
                'tools_count': len(tools),
                'tools': tools,
                'server_info': init_response.get('result', {}).get('serverInfo', {}),
            })
            
        finally:
            if cursor:
                cursor.close()
                
    except Exception as e:
        print(f"[MCP Test] ❌ Error testing server: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500

@app.route('/api/mcp/servers/<server_id>', methods=['PUT', 'OPTIONS'])
def update_mcp_server(server_id):
    """更新MCP服务器配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 构建更新语句
            update_fields = []
            update_values = []
            
            if 'name' in data:
                update_fields.append('name = %s')
                update_values.append(data['name'])
            if 'url' in data:
                update_fields.append('url = %s')
                update_values.append(data['url'])
            if 'type' in data:
                update_fields.append('type = %s')
                update_values.append(data['type'])
            if 'enabled' in data:
                update_fields.append('enabled = %s')
                update_values.append(data['enabled'])
            if 'use_proxy' in data:
                update_fields.append('use_proxy = %s')
                update_values.append(data['use_proxy'])
            if 'description' in data:
                update_fields.append('description = %s')
                update_values.append(data['description'])
            if 'metadata' in data:
                update_fields.append('metadata = %s')
                update_values.append(json.dumps(data['metadata']))
            if 'ext' in data:
                update_fields.append('ext = %s')
                update_values.append(json.dumps(data['ext']) if data['ext'] else None)
            
            if not update_fields:
                return jsonify({'error': 'No fields to update'}), 400
            
            update_values.append(server_id)
            
            cursor.execute(f"""
                UPDATE mcp_servers 
                SET {', '.join(update_fields)}
                WHERE server_id = %s
            """, update_values)
            
            conn.commit()
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Server not found'}), 404
            
            return jsonify({'message': 'MCP server updated successfully'})
            
        finally:
            if cursor:
                cursor.close()
    except Exception as e:
        print(f"Error updating MCP server: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/mcp/servers/<server_id>', methods=['DELETE', 'OPTIONS'])
def delete_mcp_server(server_id):
    """删除MCP服务器配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM mcp_servers 
                WHERE server_id = %s
            """, (server_id,))
            
            conn.commit()
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Server not found'}), 404
            
            return jsonify({'message': 'MCP server deleted successfully'})
            
        finally:
            if cursor:
                cursor.close()
    except Exception as e:
        print(f"Error deleting MCP server: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/llm/configs', methods=['GET'])
def list_llm_configs():
    """获取所有LLM配置列表"""
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            # MySQL不可用时返回空列表而不是错误，允许应用继续运行
            print("[LLM API] MySQL not available, returning empty list")
            return jsonify({'configs': [], 'total': 0, 'warning': 'MySQL not available'})
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 检查表是否存在
            cursor.execute("SHOW TABLES LIKE 'llm_configs'")
            if not cursor.fetchone():
                print("[LLM API] Table 'llm_configs' does not exist, returning empty list")
                return jsonify({'configs': [], 'total': 0, 'warning': 'Table llm_configs does not exist'})
            
            cursor.execute("""
                SELECT config_id, name, provider, api_url, model, tags, enabled, 
                       description, metadata, created_at, updated_at
                FROM llm_configs
                ORDER BY created_at DESC
            """)
            
            columns = [desc[0] for desc in cursor.description]
            configs = []
            for row in cursor.fetchall():
                config = dict(zip(columns, row))
                # 解析JSON字段
                if config.get('tags'):
                    try:
                        config['tags'] = json.loads(config['tags']) if isinstance(config['tags'], str) else config['tags']
                    except:
                        config['tags'] = []
                if config.get('metadata'):
                    try:
                        config['metadata'] = json.loads(config['metadata']) if isinstance(config['metadata'], str) else config['metadata']
                    except:
                        config['metadata'] = {}
                # 转换 TINYINT 为 boolean
                config['enabled'] = bool(config.get('enabled'))
                # 转换日期时间为字符串
                if config.get('created_at'):
                    config['created_at'] = config['created_at'].isoformat() if hasattr(config['created_at'], 'isoformat') else str(config['created_at'])
                if config.get('updated_at'):
                    config['updated_at'] = config['updated_at'].isoformat() if hasattr(config['updated_at'], 'isoformat') else str(config['updated_at'])
                # 不返回API密钥
                config.pop('api_key', None)
                configs.append(config)
            
            return jsonify({'configs': configs, 'total': len(configs)})
        finally:
            if cursor:
                cursor.close()
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[LLM API] Error in list_llm_configs: {e}")
        print(f"[LLM API] Traceback: {error_trace}")
        # 返回空列表而不是500错误，允许应用继续运行
        return jsonify({'configs': [], 'total': 0, 'error': str(e)})

@app.route('/api/llm/configs', methods=['POST'])
def create_llm_config():
    """创建新的LLM配置"""
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        config_id = data.get('config_id') or f'llm-{int(time.time())}'
        name = data.get('name')
        provider = data.get('provider', 'openai')
        
        if not name:
            return jsonify({'error': 'name is required'}), 400
        
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO llm_configs 
            (config_id, name, provider, api_key, api_url, model, tags, enabled, description, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            config_id,
            name,
            provider,
            data.get('api_key'),
            data.get('api_url'),
            data.get('model'),
            json.dumps(data.get('tags', [])),
            data.get('enabled', True),
            data.get('description'),
            json.dumps(data.get('metadata', {}))
        ))
        
        conn.commit()
        cursor.close()
        
        return jsonify({
            'config_id': config_id,
            'message': 'LLM config created successfully'
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/llm/configs/<config_id>', methods=['GET'])
def get_llm_config(config_id):
    """获取单个LLM配置（不包含API密钥）"""
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT config_id, name, provider, api_url, model, tags, enabled, 
                   description, metadata, created_at, updated_at
            FROM llm_configs
            WHERE config_id = %s
        """, (config_id,))
        
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Config not found'}), 404
        
        columns = [desc[0] for desc in cursor.description]
        config = dict(zip(columns, row))
        
        # 解析JSON字段
        if config.get('tags'):
            try:
                config['tags'] = json.loads(config['tags']) if isinstance(config['tags'], str) else config['tags']
            except:
                config['tags'] = []
        if config.get('metadata'):
            try:
                config['metadata'] = json.loads(config['metadata']) if isinstance(config['metadata'], str) else config['metadata']
            except:
                config['metadata'] = {}
        
        cursor.close()
        return jsonify(config)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/llm/configs/<config_id>/api-key', methods=['GET'])
def get_llm_config_api_key(config_id):
    """获取LLM配置的API密钥（用于前端调用）"""
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT api_key
            FROM llm_configs
            WHERE config_id = %s AND enabled = 1
        """, (config_id,))
        
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Config not found or disabled'}), 404
        
        cursor.close()
        return jsonify({'api_key': row[0] if row[0] else ''})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/llm/configs/<config_id>', methods=['PUT'])
def update_llm_config(config_id):
    """更新LLM配置"""
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        cursor = conn.cursor()
        
        # 构建更新字段
        updates = []
        values = []
        
        if 'name' in data:
            updates.append('name = %s')
            values.append(data['name'])
        if 'provider' in data:
            updates.append('provider = %s')
            values.append(data['provider'])
        if 'api_key' in data:
            updates.append('api_key = %s')
            values.append(data['api_key'])
        if 'api_url' in data:
            updates.append('api_url = %s')
            values.append(data['api_url'])
        if 'model' in data:
            updates.append('model = %s')
            values.append(data['model'])
        if 'tags' in data:
            updates.append('tags = %s')
            values.append(json.dumps(data['tags']))
        if 'enabled' in data:
            updates.append('enabled = %s')
            values.append(data['enabled'])
        if 'description' in data:
            updates.append('description = %s')
            values.append(data['description'])
        if 'metadata' in data:
            updates.append('metadata = %s')
            values.append(json.dumps(data['metadata']))
        
        if not updates:
            return jsonify({'error': 'No fields to update'}), 400
        
        values.append(config_id)
        cursor.execute(f"""
            UPDATE llm_configs
            SET {', '.join(updates)}
            WHERE config_id = %s
        """, values)
        
        conn.commit()
        cursor.close()
        
        return jsonify({'message': 'LLM config updated successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/llm/configs/<config_id>', methods=['DELETE'])
def delete_llm_config(config_id):
    """删除LLM配置"""
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor()
        cursor.execute("DELETE FROM llm_configs WHERE config_id = %s", (config_id,))
        conn.commit()
        
        if cursor.rowcount == 0:
            cursor.close()
            return jsonify({'error': 'Config not found'}), 404
        
        cursor.close()
        return jsonify({'message': 'LLM config deleted successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500



def init_services():
    """初始化服务（MySQL、Redis等）"""
    print("=" * 60)
    print("Initializing services...")
    print("=" * 60)
    
    # 初始化MySQL
    mysql_success, mysql_error = init_mysql(config)
    if not mysql_success and mysql_error:
        print(f"Warning: MySQL initialization failed: {mysql_error}")
        print("Continuing without MySQL support...")
    
    # 初始化Redis
    redis_success, redis_error = init_redis(config)
    if not redis_success and redis_error:
        print(f"Warning: Redis initialization failed: {redis_error}")
        print("Continuing without Redis support...")
    
    print("=" * 60)
    print("Service initialization completed")
    print("=" * 60)
    print()

# ==================== 工作流配置管理 API ====================

@app.route('/api/workflows', methods=['GET', 'OPTIONS'])
def list_workflows():
    """获取所有工作流配置列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT workflow_id, name, description, config, created_at, updated_at
                FROM workflows
                ORDER BY updated_at DESC
            """)
            workflows = cursor.fetchall()
            
            # 解析JSON配置
            for workflow in workflows:
                if workflow.get('config'):
                    workflow['config'] = json.loads(workflow['config']) if isinstance(workflow['config'], str) else workflow['config']
                # 转换时间格式
                if workflow.get('created_at'):
                    workflow['created_at'] = workflow['created_at'].isoformat() if hasattr(workflow['created_at'], 'isoformat') else str(workflow['created_at'])
                if workflow.get('updated_at'):
                    workflow['updated_at'] = workflow['updated_at'].isoformat() if hasattr(workflow['updated_at'], 'isoformat') else str(workflow['updated_at'])
                # 添加id字段作为workflow_id的别名，以匹配前端接口
                if 'workflow_id' in workflow:
                    workflow['id'] = workflow['workflow_id']
            
            return jsonify({
                'workflows': workflows,
                'total': len(workflows)
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Workflow API] Error listing workflows: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/workflows', methods=['POST', 'OPTIONS'])
def create_workflow():
    """创建新的工作流配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        name = data.get('name')
        if not name:
            return jsonify({'error': 'Workflow name is required'}), 400
        
        description = data.get('description', '')
        config = data.get('config', {})
        
        # 生成唯一的workflow_id
        import uuid
        workflow_id = f"workflow_{uuid.uuid4().hex[:16]}"
        
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO workflows (workflow_id, name, description, config)
                VALUES (%s, %s, %s, %s)
            """, (workflow_id, name, description, json.dumps(config)))
            conn.commit()
            
            print(f"[Workflow API] Created workflow: {workflow_id} - {name}")
            
            return jsonify({
                'workflow_id': workflow_id,
                'message': 'Workflow created successfully'
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Workflow API] Error creating workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/workflows/<workflow_id>', methods=['GET', 'OPTIONS'])
def get_workflow(workflow_id):
    """获取指定工作流配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT workflow_id, name, description, config, created_at, updated_at
                FROM workflows
                WHERE workflow_id = %s
            """, (workflow_id,))
            workflow = cursor.fetchone()
            
            if not workflow:
                return jsonify({'error': 'Workflow not found'}), 404
            
            # 解析JSON配置
            if workflow.get('config'):
                workflow['config'] = json.loads(workflow['config']) if isinstance(workflow['config'], str) else workflow['config']
            # 转换时间格式
            if workflow.get('created_at'):
                workflow['created_at'] = workflow['created_at'].isoformat() if hasattr(workflow['created_at'], 'isoformat') else str(workflow['created_at'])
            if workflow.get('updated_at'):
                workflow['updated_at'] = workflow['updated_at'].isoformat() if hasattr(workflow['updated_at'], 'isoformat') else str(workflow['updated_at'])
            # 添加id字段作为workflow_id的别名，以匹配前端接口
            if 'workflow_id' in workflow:
                workflow['id'] = workflow['workflow_id']
            
            return jsonify(workflow)
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Workflow API] Error getting workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/workflows/<workflow_id>', methods=['PUT', 'OPTIONS'])
def update_workflow(workflow_id):
    """更新工作流配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 构建更新语句
            update_fields = []
            update_values = []
            
            if 'name' in data:
                update_fields.append('name = %s')
                update_values.append(data['name'])
            if 'description' in data:
                update_fields.append('description = %s')
                update_values.append(data['description'])
            if 'config' in data:
                update_fields.append('config = %s')
                update_values.append(json.dumps(data['config']))
            
            if not update_fields:
                return jsonify({'error': 'No fields to update'}), 400
            
            update_values.append(workflow_id)
            
            sql = f"""
                UPDATE workflows
                SET {', '.join(update_fields)}
                WHERE workflow_id = %s
            """
            
            cursor.execute(sql, tuple(update_values))
            conn.commit()
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Workflow not found'}), 404
            
            print(f"[Workflow API] Updated workflow: {workflow_id}")
            
            return jsonify({
                'workflow_id': workflow_id,
                'message': 'Workflow updated successfully'
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Workflow API] Error updating workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/workflows/<workflow_id>', methods=['DELETE', 'OPTIONS'])
def delete_workflow(workflow_id):
    """删除工作流配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM workflows WHERE workflow_id = %s", (workflow_id,))
            conn.commit()
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Workflow not found'}), 404
            
            print(f"[Workflow API] Deleted workflow: {workflow_id}")
            
            return jsonify({'message': 'Workflow deleted successfully'})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Workflow API] Error deleting workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== 会话和消息管理 API ====================

@app.route('/api/sessions', methods=['GET', 'OPTIONS'])
def list_sessions():
    """获取会话列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'sessions': [], 'total': 0, 'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取会话列表，按最后消息时间排序
            cursor.execute("""
                SELECT 
                    s.session_id,
                    s.title,
                    s.llm_config_id,
                    s.created_at,
                    s.updated_at,
                    s.last_message_at,
                    COUNT(m.id) as message_count
                FROM sessions s
                LEFT JOIN messages m ON s.session_id = m.session_id
                GROUP BY s.session_id
                ORDER BY s.last_message_at DESC, s.created_at DESC
                LIMIT 100
            """)
            
            sessions = []
            for row in cursor.fetchall():
                session = {
                    'session_id': row['session_id'],
                    'title': row['title'],
                    'llm_config_id': row['llm_config_id'],
                    'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                    'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None,
                    'last_message_at': row['last_message_at'].isoformat() if row['last_message_at'] else None,
                    'message_count': row['message_count'] or 0,
                }
                sessions.append(session)
            
            return jsonify({'sessions': sessions, 'total': len(sessions)})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error listing sessions: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'sessions': [], 'total': 0, 'error': str(e)}), 500

@app.route('/api/sessions', methods=['POST', 'OPTIONS'])
def create_session():
    """创建新会话"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        session_id = data.get('session_id') or f'session-{int(time.time() * 1000)}'
        title = data.get('title')
        llm_config_id = data.get('llm_config_id')
        
        cursor = None
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO sessions (session_id, title, llm_config_id)
                VALUES (%s, %s, %s)
            """, (session_id, title, llm_config_id))
            conn.commit()
            
            return jsonify({
                'session_id': session_id,
                'message': 'Session created successfully'
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error creating session: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>', methods=['DELETE', 'OPTIONS'])
def delete_session(session_id):
    """删除会话及其所有消息"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 删除会话（由于外键约束，会自动删除关联的消息和总结）
            cursor.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
            conn.commit()
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Session not found'}), 404
            
            print(f"[Session API] Deleted session: {session_id}")
            
            return jsonify({
                'message': 'Session deleted successfully'
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error deleting session: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>', methods=['GET', 'OPTIONS'])
def get_session(session_id):
    """获取会话详情"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT 
                    s.session_id,
                    s.title,
                    s.llm_config_id,
                    s.created_at,
                    s.updated_at,
                    s.last_message_at,
                    COUNT(m.id) as message_count
                FROM sessions s
                LEFT JOIN messages m ON s.session_id = m.session_id
                WHERE s.session_id = %s
                GROUP BY s.session_id
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Session not found'}), 404
            
            session = {
                'session_id': row['session_id'],
                'title': row['title'],
                'llm_config_id': row['llm_config_id'],
                'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None,
                'last_message_at': row['last_message_at'].isoformat() if row['last_message_at'] else None,
                'message_count': row['message_count'] or 0,
            }
            
            return jsonify(session)
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error getting session: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/messages', methods=['GET', 'OPTIONS'])
def get_session_messages(session_id):
    """获取会话消息（分页）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'messages': [], 'total': 0, 'error': 'MySQL not available'}), 503
        
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 50))
        offset = (page - 1) * page_size
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取总数
            cursor.execute("SELECT COUNT(*) as total FROM messages WHERE session_id = %s", (session_id,))
            total = cursor.fetchone()['total']
            
            # 获取消息（按时间倒序，最新的在前）
            cursor.execute("""
                SELECT 
                    message_id,
                    session_id,
                    role,
                    content,
                    thinking,
                    tool_calls,
                    token_count,
                    created_at
                FROM messages
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """, (session_id, page_size, offset))
            
            messages = []
            invalid_message_ids = []
            for row in cursor.fetchall():
                # 过滤掉无效的感知组件消息（pending状态且没有content的workflow消息）
                if row['role'] == 'tool':
                    if not row['content'] or row['content'].strip() == '' or row['content'] == '[]':
                        if row['tool_calls']:
                            try:
                                tool_calls = json.loads(row['tool_calls']) if isinstance(row['tool_calls'], str) else row['tool_calls']
                                if isinstance(tool_calls, dict) and tool_calls.get('workflowStatus') == 'pending':
                                    invalid_message_ids.append(row['message_id'])
                                    continue  # 跳过这个无效消息
                            except (json.JSONDecodeError, TypeError):
                                pass
                
                message = {
                    'message_id': row['message_id'],
                    'session_id': row['session_id'],
                    'role': row['role'],
                    'content': row['content'],
                    'thinking': row['thinking'],
                    'tool_calls': json.loads(row['tool_calls']) if row['tool_calls'] else None,
                    'token_count': row['token_count'],
                    'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                }
                messages.append(message)
            
            # 同时清理无效的感知组件消息（在后台执行，不影响返回）
            if invalid_message_ids:
                try:
                    placeholders = ','.join(['%s'] * len(invalid_message_ids))
                    cursor.execute(f"""
                        DELETE FROM messages 
                        WHERE message_id IN ({placeholders})
                    """, invalid_message_ids)
                    deleted_count = cursor.rowcount
                    if deleted_count > 0:
                        conn.commit()
                        print(f"[Session API] Cleaned up {deleted_count} invalid workflow messages from session {session_id}")
                except Exception as cleanup_error:
                    # 清理失败不影响主流程
                    print(f"[Session API] Warning: Failed to cleanup invalid workflow messages: {cleanup_error}")
            
            # 反转顺序，使最旧的在前（用于前端显示）
            messages.reverse()
            
            return jsonify({
                'messages': messages,
                'total': total,
                'page': page,
                'page_size': page_size,
                'total_pages': (total + page_size - 1) // page_size
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error getting messages: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'messages': [], 'total': 0, 'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/messages', methods=['POST', 'OPTIONS'])
def save_message(session_id):
    """保存消息到会话"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        from token_counter import estimate_tokens
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        message_id = data.get('message_id') or f'msg-{int(time.time() * 1000)}'
        role = data.get('role', 'user')
        content = data.get('content', '')
        thinking = data.get('thinking')
        tool_calls = data.get('tool_calls')
        model = data.get('model', 'gpt-4')  # 用于估算 token
        
        # 估算 token 数量
        token_count = estimate_tokens(content, model)
        if thinking:
            token_count += estimate_tokens(thinking, model)
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 保存消息
            cursor.execute("""
                INSERT INTO messages (message_id, session_id, role, content, thinking, tool_calls, token_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                message_id,
                session_id,
                role,
                content,
                thinking,
                json.dumps(tool_calls) if tool_calls else None,
                token_count
            ))
            
            # 更新会话的最后消息时间
            cursor.execute("""
                UPDATE sessions 
                SET last_message_at = NOW(), updated_at = NOW()
                WHERE session_id = %s
            """, (session_id,))
            
            # 如果会话没有标题，自动生成一个（基于第一条用户消息）
            if role == 'user' and content:
                cursor.execute("""
                    SELECT title FROM sessions WHERE session_id = %s
                """, (session_id,))
                row = cursor.fetchone()
                if row and not row[0]:
                    # 生成标题（取前50个字符）
                    title = content[:50].strip()
                    if len(content) > 50:
                        title += '...'
                    cursor.execute("""
                        UPDATE sessions SET title = %s WHERE session_id = %s
                    """, (title, session_id))
            
            conn.commit()
            
            return jsonify({
                'message_id': message_id,
                'token_count': token_count,
                'message': 'Message saved successfully'
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error saving message: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/messages/<message_id>', methods=['DELETE', 'OPTIONS'])
def delete_message(session_id, message_id):
    """删除会话中的消息"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 删除消息
            cursor.execute("""
                DELETE FROM messages 
                WHERE session_id = %s AND message_id = %s
            """, (session_id, message_id))
            conn.commit()
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Message not found'}), 404
            
            print(f"[Session API] Deleted message: {message_id} from session: {session_id}")
            
            # 检查并删除无效的感知组件消息（pending状态且没有content的workflow消息）
            # 先查询所有workflow消息，然后检查JSON字段
            cursor.execute("""
                SELECT message_id, tool_calls 
                FROM messages 
                WHERE session_id = %s 
                AND role = 'tool' 
                AND (content IS NULL OR content = '' OR content = '[]')
                AND tool_calls IS NOT NULL
            """, (session_id,))
            
            invalid_messages = []
            for row in cursor.fetchall():
                try:
                    tool_calls = json.loads(row['tool_calls']) if isinstance(row['tool_calls'], str) else row['tool_calls']
                    if isinstance(tool_calls, dict) and tool_calls.get('workflowStatus') == 'pending':
                        invalid_messages.append(row['message_id'])
                except (json.JSONDecodeError, TypeError):
                    continue
            
            if invalid_messages:
                placeholders = ','.join(['%s'] * len(invalid_messages))
                cursor.execute(f"""
                    DELETE FROM messages 
                    WHERE message_id IN ({placeholders})
                """, invalid_messages)
            
                deleted_invalid = cursor.rowcount
                if deleted_invalid > 0:
                    conn.commit()
                    print(f"[Session API] Deleted {deleted_invalid} invalid workflow messages (pending without output)")
            else:
                deleted_invalid = 0
            
            return jsonify({
                'message': 'Message deleted successfully',
                'deleted_invalid_workflows': deleted_invalid
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error deleting message: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/summarize', methods=['POST', 'OPTIONS'])
def summarize_session(session_id):
    """总结会话内容"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection, get_redis_client
        from token_counter import estimate_messages_tokens, get_model_max_tokens, estimate_tokens
        import hashlib
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        llm_config_id = data.get('llm_config_id')
        model = data.get('model', 'gpt-4')
        messages_to_summarize = data.get('messages', [])  # 要总结的消息列表
        
        if not llm_config_id:
            return jsonify({'error': 'llm_config_id is required'}), 400
        
        # 检查 Redis 缓存
        from database import get_redis_client
        redis_conn = get_redis_client()
        cache_key = None
        if redis_conn and messages_to_summarize:
            # 生成缓存键（基于消息ID列表）
            message_ids = [msg.get('message_id') or str(i) for i, msg in enumerate(messages_to_summarize)]
            cache_key = f"summarize:{session_id}:{hashlib.md5(','.join(sorted(message_ids)).encode()).hexdigest()}"
            cached_summary = redis_conn.get(cache_key)
            if cached_summary:
                print(f"[Summarize] Using cached summary for session {session_id}")
                return jsonify(json.loads(cached_summary))
        
        # 获取 LLM 配置
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT api_key, api_url, model, provider
                FROM llm_configs
                WHERE config_id = %s AND enabled = 1
            """, (llm_config_id,))
            
            llm_config = cursor.fetchone()
            if not llm_config:
                return jsonify({'error': 'LLM config not found or disabled'}), 404
            
            # 构建总结提示词
            summarize_prompt = """请将以下对话内容进行精简总结，保留关键信息和上下文，去除冗余内容。总结应该：
1. 保留重要的用户需求和问题
2. 保留关键的AI回答和解决方案
3. 保留重要的上下文信息
4. 去除重复和冗余的内容
5. 使用简洁清晰的语言

对话内容：
"""
            
            # 构建要总结的消息文本
            messages_text = []
            for msg in messages_to_summarize:
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                if content:
                    messages_text.append(f"{role}: {content}")
            
            full_text = summarize_prompt + "\n\n".join(messages_text)
            
            # 调用 LLM 进行总结
            summary_content = None
            try:
                # 构建 LLM 请求
                llm_messages = [
                    {
                        'role': 'system',
                        'content': '你是一个专业的对话总结助手，擅长将长对话精简为关键信息，保留重要上下文。'
                    },
                    {
                        'role': 'user',
                        'content': summarize_prompt + "\n\n".join(messages_text)
                    }
                ]
                
                # 根据 provider 调用不同的 API
                provider = llm_config['provider']
                api_key = llm_config['api_key']
                api_url = llm_config.get('api_url') or ''
                model_name = llm_config.get('model') or model
                
                if provider == 'openai':
                    # OpenAI API
                    default_url = 'https://api.openai.com/v1/chat/completions'
                    if not api_url or '/chat/completions' not in api_url:
                        if api_url and not api_url.endswith('/'):
                            api_url = api_url.rstrip('/')
                        if not api_url.endswith('/v1/chat/completions'):
                            api_url = f"{api_url}/v1/chat/completions" if api_url else default_url
                    
                    response = requests.post(
                        api_url,
                        headers={
                            'Content-Type': 'application/json',
                            'Authorization': f'Bearer {api_key}',
                        },
                        json={
                            'model': model_name,
                            'messages': llm_messages,
                            'temperature': 0.3,
                        },
                        timeout=60
                    )
                    
                    if response.ok:
                        result = response.json()
                        summary_content = result['choices'][0]['message']['content']
                    else:
                        error_data = response.json() if response.content else {}
                        error_msg = error_data.get('error', {}).get('message', response.text)
                        print(f"[Summarize] LLM API error: {error_msg}")
                        summary_content = f"[自动总结] 已精简 {len(messages_to_summarize)} 条消息的关键信息"
                
                elif provider == 'anthropic':
                    # Anthropic API
                    default_url = 'https://api.anthropic.com/v1/messages'
                    if not api_url or '/messages' not in api_url:
                        if api_url and not api_url.endswith('/'):
                            api_url = api_url.rstrip('/')
                        if not api_url.endswith('/v1/messages'):
                            api_url = f"{api_url}/v1/messages" if api_url else default_url
                    
                    system_msg = llm_messages[0]['content']
                    user_msg = llm_messages[1]['content']
                    
                    response = requests.post(
                        api_url,
                        headers={
                            'Content-Type': 'application/json',
                            'x-api-key': api_key,
                            'anthropic-version': '2023-06-01',
                        },
                        json={
                            'model': model_name,
                            'max_tokens': 2000,
                            'system': system_msg,
                            'messages': [{'role': 'user', 'content': user_msg}],
                            'temperature': 0.3,
                        },
                        timeout=60
                    )
                    
                    if response.ok:
                        result = response.json()
                        summary_content = result['content'][0]['text']
                    else:
                        error_data = response.json() if response.content else {}
                        error_msg = error_data.get('error', {}).get('message', response.text)
                        print(f"[Summarize] LLM API error: {error_msg}")
                        summary_content = f"[自动总结] 已精简 {len(messages_to_summarize)} 条消息的关键信息"
                
                else:
                    print(f"[Summarize] Provider {provider} not fully supported for summarize, using simplified summary")
                    summary_content = f"[自动总结] 已精简 {len(messages_to_summarize)} 条消息的关键信息"
                    
            except Exception as e:
                print(f"[Summarize] Error calling LLM: {e}")
                import traceback
                traceback.print_exc()
                summary_content = f"[自动总结] 已精简 {len(messages_to_summarize)} 条消息的关键信息"
            
            # 估算总结后的 token 数量
            estimated_tokens = estimate_tokens(summary_content or '', model)
            
            # 保存总结到数据库
            summary_id = f'summary-{int(time.time() * 1000)}'
            last_message_id = messages_to_summarize[-1].get('message_id') if messages_to_summarize else None
            
            token_count_before = sum(msg.get('token_count', 0) for msg in messages_to_summarize)
            token_count_after = estimated_tokens
            
            cursor.execute("""
                INSERT INTO summaries (summary_id, session_id, summary_content, last_message_id, token_count_before, token_count_after)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (summary_id, session_id, summary_content, last_message_id, token_count_before, token_count_after))
            
            # 缓存总结结果
            if redis_conn and cache_key:
                summary_data = {
                    'summary_id': summary_id,
                    'summary_content': summary_content,
                    'token_count_before': token_count_before,
                    'token_count_after': token_count_after,
                }
                redis_conn.setex(cache_key, 3600, json.dumps(summary_data))  # 缓存1小时
            
            conn.commit()
            
            return jsonify({
                'summary_id': summary_id,
                'summary_content': summary_content,
                'token_count_before': token_count_before,
                'token_count_after': token_count_after,
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Summarize API] Error summarizing session: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/summaries', methods=['GET', 'OPTIONS'])
def get_session_summaries(session_id):
    """获取会话的所有总结"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'summaries': [], 'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT 
                    summary_id,
                    session_id,
                    summary_content,
                    last_message_id,
                    token_count_before,
                    token_count_after,
                    created_at
                FROM summaries
                WHERE session_id = %s
                ORDER BY created_at ASC
            """, (session_id,))
            
            summaries = []
            for row in cursor.fetchall():
                summary = {
                    'summary_id': row['summary_id'],
                    'session_id': row['session_id'],
                    'summary_content': row['summary_content'],
                    'last_message_id': row['last_message_id'],
                    'token_count_before': row['token_count_before'],
                    'token_count_after': row['token_count_after'],
                    'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                }
                summaries.append(summary)
            
            return jsonify({'summaries': summaries})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Summarize API] Error getting summaries: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'summaries': [], 'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/summaries/cache', methods=['DELETE', 'OPTIONS'])
def clear_summarize_cache(session_id):
    """清除会话的总结缓存（Redis）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_redis_client
        redis_client = get_redis_client()
        
        if not redis_client:
            # 如果没有Redis，返回成功（可能Redis未配置）
            return jsonify({'message': 'Redis not available, cache clear skipped'})
        
        # 清除该会话的所有总结缓存
        cache_key_pattern = f'summarize:{session_id}:*'
        try:
            # 获取所有匹配的key
            keys = redis_client.keys(cache_key_pattern)
            if keys:
                redis_client.delete(*keys)
                print(f"[Summarize Cache] Cleared {len(keys)} cache entries for session {session_id}")
            return jsonify({
                'message': f'Cleared {len(keys) if keys else 0} cache entries',
                'cleared_count': len(keys) if keys else 0
            })
        except Exception as e:
            print(f"[Summarize Cache] Error clearing cache: {e}")
            return jsonify({'error': str(e)}), 500
            
    except Exception as e:
        print(f"[Session API] Error clearing summarize cache: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== 消息执行管理 API ====================

@app.route('/api/messages/<message_id>/execute', methods=['POST', 'OPTIONS'])
def execute_message_component(message_id):
    """执行消息关联的感知组件（MCP或工作流）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        llm_config_id = data.get('llm_config_id')  # 聊天选择的LLM配置ID
        input_text = data.get('input', '')
        
        if not llm_config_id:
            return jsonify({'error': 'llm_config_id is required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取消息信息
            cursor.execute("""
                SELECT message_id, session_id, role, content, tool_calls
                FROM messages
                WHERE message_id = %s
            """, (message_id,))
            
            message = cursor.fetchone()
            if not message:
                return jsonify({'error': 'Message not found'}), 404
            
            # 解析tool_calls获取组件信息
            tool_calls = None
            if message['tool_calls']:
                try:
                    tool_calls = json.loads(message['tool_calls']) if isinstance(message['tool_calls'], str) else message['tool_calls']
                except (json.JSONDecodeError, TypeError):
                    pass
            
            if not tool_calls or not isinstance(tool_calls, dict):
                return jsonify({'error': 'Invalid tool_calls format'}), 400
            
            component_type = tool_calls.get('toolType')  # 'mcp' or 'workflow'
            component_id = tool_calls.get('workflowId')  # MCP server ID or workflow ID
            component_name = tool_calls.get('workflowName')
            
            if not component_type or not component_id:
                return jsonify({'error': 'Missing component information'}), 400
            
            # 检查是否已有执行记录
            cursor.execute("""
                SELECT execution_id, status
                FROM message_executions
                WHERE message_id = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (message_id,))
            
            existing_execution = cursor.fetchone()
            execution_id = existing_execution['execution_id'] if existing_execution else f'exec-{int(time.time() * 1000)}'
            
            # 创建或更新执行记录（状态为running）
            if existing_execution:
                cursor.execute("""
                    UPDATE message_executions
                    SET status = 'running',
                        llm_config_id = %s,
                        input = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE execution_id = %s
                """, (llm_config_id, input_text, execution_id))
            else:
                cursor.execute("""
                    INSERT INTO message_executions
                    (execution_id, message_id, component_type, component_id, component_name, 
                     llm_config_id, input, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'running')
                """, (execution_id, message_id, component_type, component_id, component_name, 
                      llm_config_id, input_text))
            
            conn.commit()
            
            # 执行感知组件
            result = None
            error_message = None
            status = 'completed'
            
            try:
                if component_type == 'workflow':
                    # 执行工作流，使用聊天选择的LLM替换工作流中的LLM节点
                    result = execute_workflow_with_llm(component_id, input_text, llm_config_id)
                elif component_type == 'mcp':
                    # 执行MCP，使用聊天选择的LLM驱动MCP工具
                    result = execute_mcp_with_llm(component_id, input_text, llm_config_id)
                else:
                    raise ValueError(f'Unknown component type: {component_type}')
                
                if isinstance(result, dict) and result.get('error'):
                    status = 'error'
                    error_message = result.get('error')
                    result = None
                elif not isinstance(result, str):
                    result = json.dumps(result, ensure_ascii=False, indent=2)
                    
            except Exception as e:
                status = 'error'
                error_message = str(e)
                print(f"[Message Execution] Error executing component: {e}")
                import traceback
                traceback.print_exc()
            
            # 更新执行记录
            cursor.execute("""
                UPDATE message_executions
                SET status = %s,
                    result = %s,
                    error_message = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE execution_id = %s
            """, (status, result, error_message, execution_id))
            
            conn.commit()
            
            return jsonify({
                'execution_id': execution_id,
                'status': status,
                'result': result,
                'error_message': error_message
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Message Execution API] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def execute_workflow_with_llm(workflow_id: str, input_text: str, llm_config_id: str):
    """执行工作流，使用指定的LLM配置替换工作流中的LLM节点"""
    logs = []
    
    def add_log(message: str):
        logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
        print(f"[Workflow Execution] {message}")
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return {'error': 'MySQL not available', 'logs': logs}
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取工作流配置
            add_log(f"获取工作流配置: {workflow_id}")
            cursor.execute("""
                SELECT workflow_id, name, config
                FROM workflows
                WHERE workflow_id = %s
            """, (workflow_id,))
            
            workflow = cursor.fetchone()
            if not workflow:
                return {'error': 'Workflow not found', 'logs': logs}
            
            add_log(f"工作流配置获取成功: {workflow['name']}")
            
            config = json.loads(workflow['config']) if isinstance(workflow['config'], str) else workflow['config']
            nodes = config.get('nodes', [])
            connections = config.get('connections', [])
            
            add_log(f"工作流包含 {len(nodes)} 个节点，{len(connections)} 个连接")
            
            # 替换所有LLM节点的llmConfigId为聊天选择的LLM
            llm_nodes_replaced = 0
            for node in nodes:
                if node.get('type') == 'llm':
                    node['data'] = node.get('data', {})
                    old_config_id = node['data'].get('llmConfigId')
                    node['data']['llmConfigId'] = llm_config_id
                    llm_nodes_replaced += 1
                    add_log(f"替换LLM节点 {node.get('id', 'unknown')} 的配置: {old_config_id} -> {llm_config_id}")
            
            if llm_nodes_replaced > 0:
                add_log(f"已替换 {llm_nodes_replaced} 个LLM节点的配置")
            
            # 查找输入节点
            input_nodes = [n for n in nodes if n.get('type') == 'input']
            if not input_nodes:
                return {'error': 'No input node found in workflow', 'logs': logs}
            
            add_log(f"找到 {len(input_nodes)} 个输入节点")
            
            # 查找输出节点
            output_nodes = [n for n in nodes if n.get('type') == 'output']
            add_log(f"找到 {len(output_nodes)} 个输出节点")
            
            # 执行工作流（简化版本：只执行LLM节点）
            # 注意：完整的工作流执行逻辑应该在前端WorkflowEditor中实现
            # 这里提供一个简化版本，主要用于演示
            result_text = f"工作流 \"{workflow['name']}\" 执行完成\n\n"
            result_text += f"输入: {input_text}\n\n"
            result_text += f"工作流配置: {llm_nodes_replaced} 个LLM节点已替换为配置 {llm_config_id}\n\n"
            result_text += "注意：完整的工作流执行逻辑需要在WorkflowEditor中实现\n\n"
            result_text += "执行日志:\n" + "\n".join(logs)
            
            return result_text
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        error_msg = str(e)
        add_log(f"❌ 执行出错: {error_msg}")
        import traceback
        traceback.print_exc()
        return {'error': error_msg, 'logs': logs}

def execute_mcp_with_llm(mcp_server_id: str, input_text: str, llm_config_id: str):
    """执行MCP，使用指定的LLM配置驱动MCP工具"""
    logs = []
    
    def add_log(message: str):
        logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
        print(f"[MCP Execution] {message}")
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return {'error': 'MySQL not available', 'logs': logs}
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取LLM配置（包括加密的API key）
            add_log(f"获取LLM配置: {llm_config_id}")
            cursor.execute("""
                SELECT config_id, provider, api_key, api_url, model, enabled, metadata
                FROM llm_configs
                WHERE config_id = %s AND enabled = 1
            """, (llm_config_id,))
            
            llm_config = cursor.fetchone()
            if not llm_config:
                return {'error': 'LLM config not found or disabled', 'logs': logs}
            
            # 如果API key是加密的，需要解密（这里假设直接存储，如果需要解密可以添加解密逻辑）
            # 注意：实际项目中API key应该加密存储，这里简化处理
            add_log(f"LLM配置获取成功: {llm_config['provider']} - {llm_config['model']}")
            
            # 获取MCP服务器配置
            add_log(f"获取MCP服务器配置: {mcp_server_id}")
            cursor.execute("""
                SELECT server_id, name, url, type, enabled, description, metadata, ext
                FROM mcp_servers
                WHERE server_id = %s AND enabled = 1
            """, (mcp_server_id,))
            
            mcp_server = cursor.fetchone()
            if not mcp_server:
                return {'error': 'MCP server not found or disabled', 'logs': logs}
            
            add_log(f"MCP服务器配置获取成功: {mcp_server['name']} ({mcp_server['url']})")
            
            # 1. 连接MCP服务器并获取工具列表
            add_log("连接MCP服务器并获取工具列表...")
            from mcp_server.mcp_common_logic import get_mcp_tools_list, call_mcp_tool, prepare_mcp_headers
            
            # 构建基础请求头
            base_headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'mcp-protocol-version': '2025-06-18',
            }
            
            # 准备完整的请求头（包括OAuth token等）
            headers = prepare_mcp_headers(mcp_server['url'], base_headers, base_headers)
            
            # 获取工具列表
            tools_response = get_mcp_tools_list(mcp_server['url'], headers)
            if not tools_response or 'result' not in tools_response:
                return {'error': 'Failed to get MCP tools list', 'logs': logs}
            
            tools = tools_response['result'].get('tools', [])
            add_log(f"获取到 {len(tools)} 个可用工具: {', '.join([t.get('name', '') for t in tools])}")
            
            if not tools:
                return {'error': 'No tools available from MCP server', 'logs': logs}
            
            # 2. 使用LLM分析输入，决定调用哪些工具
            add_log("使用LLM分析输入并决定调用的工具...")
            
            # 构建工具描述
            tools_description = '\n'.join([
                f"- {t.get('name', '')}: {t.get('description', '')}"
                for t in tools
            ])
            
            # 构建LLM提示词
            system_prompt = f"""你是一个智能助手，可以使用以下MCP工具帮助用户：
{tools_description}

请分析用户的输入，决定需要调用哪些工具，并返回JSON格式的工具调用信息。
格式：
{{
  "tool_calls": [
    {{
      "name": "工具名称",
      "arguments": {{"参数名": "参数值"}}
    }}
  ]
}}

只返回JSON，不要其他内容。"""
            
            # 调用LLM
            llm_response = call_llm_api(llm_config, system_prompt, input_text, add_log)
            if not llm_response:
                return {'error': 'Failed to call LLM API', 'logs': logs}
            
            # 解析LLM返回的工具调用
            import re
            json_match = re.search(r'\{.*\}', llm_response, re.DOTALL)
            if not json_match:
                return {'error': 'Failed to parse LLM response as JSON', 'logs': logs, 'llm_response': llm_response}
            
            try:
                tool_calls_data = json.loads(json_match.group())
                tool_calls = tool_calls_data.get('tool_calls', [])
            except json.JSONDecodeError as e:
                return {'error': f'Failed to parse JSON: {e}', 'logs': logs, 'llm_response': llm_response}
            
            if not tool_calls:
                return {'error': 'No tool calls found in LLM response', 'logs': logs, 'llm_response': llm_response}
            
            add_log(f"LLM决定调用 {len(tool_calls)} 个工具")
            
            # 3. 执行工具调用
            results = []
            for i, tool_call in enumerate(tool_calls):
                tool_name = tool_call.get('name')
                tool_args = tool_call.get('arguments', {})
                
                if not tool_name:
                    add_log(f"⚠️ 工具调用 {i+1} 缺少工具名称，跳过")
                    continue
                
                add_log(f"执行工具调用 {i+1}/{len(tool_calls)}: {tool_name}")
                add_log(f"工具参数: {json.dumps(tool_args, ensure_ascii=False)}")
                
                try:
                    # 调用MCP工具
                    tool_result = call_mcp_tool(mcp_server['url'], headers, tool_name, tool_args, add_log)
                    if tool_result:
                        results.append({
                            'tool': tool_name,
                            'result': tool_result
                        })
                        add_log(f"✅ 工具 {tool_name} 执行成功")
                    else:
                        add_log(f"❌ 工具 {tool_name} 执行失败")
                except Exception as e:
                    add_log(f"❌ 工具 {tool_name} 执行出错: {str(e)}")
                    results.append({
                        'tool': tool_name,
                        'error': str(e)
                    })
            
            # 4. 返回结果
            result_text = f"MCP服务器 \"{mcp_server['name']}\" 执行完成\n\n"
            result_text += f"输入: {input_text}\n\n"
            result_text += f"执行了 {len(results)} 个工具调用:\n\n"
            
            for result in results:
                result_text += f"工具: {result['tool']}\n"
                if 'result' in result:
                    result_text += f"结果: {json.dumps(result['result'], ensure_ascii=False, indent=2)}\n"
                elif 'error' in result:
                    result_text += f"错误: {result['error']}\n"
                result_text += "\n"
            
            result_text += "\n执行日志:\n" + "\n".join(logs)
            
            return result_text
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        error_msg = str(e)
        add_log(f"❌ 执行出错: {error_msg}")
        import traceback
        traceback.print_exc()
        return {'error': error_msg, 'logs': logs}

def call_llm_api(llm_config: dict, system_prompt: str, user_input: str, add_log=None):
    """调用LLM API"""
    if add_log:
        add_log(f"调用LLM API: {llm_config['provider']} - {llm_config['model']}")
    
    provider = llm_config['provider']
    api_key = llm_config.get('api_key', '')
    api_url = llm_config.get('api_url', '')
    model = llm_config.get('model', '')
    
    if provider == 'openai':
        default_url = 'https://api.openai.com/v1/chat/completions'
        # 处理api_url格式，确保包含完整的路径
        if not api_url or '/chat/completions' not in api_url:
            if api_url and not api_url.endswith('/'):
                api_url = api_url.rstrip('/')
            if not api_url.endswith('/v1/chat/completions'):
                url = f"{api_url}/v1/chat/completions" if api_url else default_url
            else:
                url = api_url
        else:
            url = api_url
        
        if add_log:
            add_log(f"使用API URL: {url}")
        
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_input}
            ],
            'temperature': 0.7,
        }
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.ok:
            data = response.json()
            return data['choices'][0]['message']['content']
        else:
            if add_log:
                add_log(f"❌ LLM API调用失败: {response.status_code} - {response.text}")
                add_log(f"请求URL: {url}")
                add_log(f"请求头: {headers}")
            return None
            
    elif provider == 'anthropic':
        default_url = 'https://api.anthropic.com/v1/messages'
        url = api_url or default_url
        
        payload = {
            'model': model,
            'max_tokens': 4096,
            'messages': [
                {'role': 'user', 'content': f"{system_prompt}\n\n用户输入: {user_input}"}
            ],
        }
        
        headers = {
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.ok:
            data = response.json()
            return data['content'][0]['text']
        else:
            if add_log:
                add_log(f"❌ LLM API调用失败: {response.status_code} - {response.text}")
            return None
    else:
        if add_log:
            add_log(f"❌ 不支持的LLM提供商: {provider}")
        return None

@app.route('/api/messages/<message_id>/execution', methods=['GET', 'OPTIONS'])
def get_message_execution(message_id):
    """获取消息的执行记录"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            cursor.execute("""
                SELECT execution_id, message_id, component_type, component_id, component_name,
                       llm_config_id, input, result, status, error_message,
                       created_at, updated_at
                FROM message_executions
                WHERE message_id = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (message_id,))
            
            execution = cursor.fetchone()
            if not execution:
                return jsonify({'error': 'Execution not found'}), 404
            
            return jsonify({
                'execution_id': execution['execution_id'],
                'message_id': execution['message_id'],
                'component_type': execution['component_type'],
                'component_id': execution['component_id'],
                'component_name': execution['component_name'],
                'llm_config_id': execution['llm_config_id'],
                'input': execution['input'],
                'result': execution['result'],
                'status': execution['status'],
                'error_message': execution['error_message'],
                'created_at': execution['created_at'].isoformat() if execution['created_at'] else None,
                'updated_at': execution['updated_at'].isoformat() if execution['updated_at'] else None,
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Message Execution API] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # 初始化服务
    from database import init_mysql, init_redis
    init_services()
    
    port = config.get('server', {}).get('port', 3001)
    debug = config.get('server', {}).get('debug', False)
    
    print(f"Starting Flask server on http://0.0.0.0:{port}")
    print(f"Debug mode: {debug}")
    print()
    
    # 打印所有注册的路由（用于调试）
    if debug:
        print("Registered routes:")
        for rule in app.url_map.iter_rules():
            if '/api/mcp/oauth' in rule.rule or '/mcp' in rule.rule:
                print(f"  {rule.methods} {rule.rule}")
    print()
    
    app.run(host='0.0.0.0', port=port, debug=debug)

