"""
AI聊天机器人后端服务
使用Flask实现，支持LLM配置、MCP服务器、工作流、会话管理等功能
"""

import os
import sys
import json
import yaml
import threading
import time
import requests
import pymysql
import uuid
import gzip
import io
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from flask import Flask, request, jsonify, send_file, Response, stream_with_context
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge
from flask_compress import Compress


app = Flask(__name__)
# 确保JSON响应正确处理中文
app.config['JSON_AS_ASCII'] = False
app.config['JSONIFY_MIMETYPE'] = 'application/json; charset=utf-8'

# ==================== HTTP 压缩（响应 gzip） ====================
# 说明：
# - 对 JSON/文本等响应启用 gzip，减少大段对话/多媒体元数据的传输体积
# - 不压缩 text/event-stream（SSE）等流式响应，避免影响实时性
app.config.setdefault('COMPRESS_ALGORITHM', 'gzip')
app.config.setdefault('COMPRESS_LEVEL', 6)
app.config.setdefault('COMPRESS_MIN_SIZE', 1024)
app.config.setdefault(
    'COMPRESS_MIMETYPES',
    [
        'application/json',
        'application/javascript',
        'application/xml',
        'text/plain',
        'text/html',
        'text/css',
        'text/xml',
        'text/markdown',
    ],
)
Compress(app)

# 加载配置
def load_config():
    config_path = Path(__file__).parent / 'config.yaml'
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

config = load_config()

# ==================== Upload Limits (Research / multipart) ====================
# 防止目录/大文件上传触发 werkzeug 413（默认限制较小）
try:
    research_cfg = (config or {}).get('research', {}) or {}
    upload_max_mb = int(research_cfg.get('upload_max_mb', 512))
    max_form_memory_mb = int(research_cfg.get('max_form_memory_mb', 64))
    max_form_parts = int(research_cfg.get('max_form_parts', 20000))

    app.config['MAX_CONTENT_LENGTH'] = upload_max_mb * 1024 * 1024
    app.config['MAX_FORM_MEMORY_SIZE'] = max_form_memory_mb * 1024 * 1024
    app.config['MAX_FORM_PARTS'] = max_form_parts
    print(f"[Upload Limits] MAX_CONTENT_LENGTH={app.config['MAX_CONTENT_LENGTH']} bytes, "
          f"MAX_FORM_MEMORY_SIZE={app.config['MAX_FORM_MEMORY_SIZE']} bytes, "
          f"MAX_FORM_PARTS={app.config['MAX_FORM_PARTS']}")
except Exception as e:
    print(f"[Upload Limits] ⚠️ Failed to apply upload limits: {e}")

@app.errorhandler(RequestEntityTooLarge)
def handle_request_entity_too_large(e):
    """统一将 413 返回为 JSON，前端可展示友好提示"""
    limit = app.config.get('MAX_CONTENT_LENGTH')
    return jsonify({
        'error': 'RequestEntityTooLarge',
        'message': 'Upload too large. Reduce file count/size or increase backend config research.upload_max_mb.',
        'max_bytes': limit,
    }), 413

# ==================== CORS 统一配置 ====================
# 统一定义所有允许的CORS请求头，确保所有API接口使用相同的配置
CORS_ALLOWED_HEADERS = [
    'Content-Type',
    'Content-Encoding',
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

# ==================== HTTP 压缩（请求体 gzip） ====================
# 前端可在 JSON 请求体较大时发送 Content-Encoding: gzip，本处统一解压，业务代码无感知。
@app.before_request
def gunzip_request_body():
    enc = (request.headers.get('Content-Encoding') or '').lower().strip()
    if enc != 'gzip':
        return None

    # 仅处理可能有 body 的方法
    if request.method not in ('POST', 'PUT', 'PATCH'):
        return None

    try:
        compressed = request.get_data(cache=False) or b''
    except Exception:
        compressed = request.get_data() or b''

    if not compressed:
        return None

    try:
        decompressed = gzip.decompress(compressed)
    except Exception as e:
        return jsonify({
            'error': 'BadRequest',
            'message': 'Invalid gzip request body',
            'detail': str(e),
        }), 400

    # 替换 WSGI input，让后续 request.get_json / request.form 等读取到解压后的内容
    request.environ['wsgi.input'] = io.BytesIO(decompressed)
    request.environ['CONTENT_LENGTH'] = str(len(decompressed))
    # Flask 内部缓存（兼容 get_data/get_json）
    try:
        request._cached_data = decompressed  # type: ignore[attr-defined]
    except Exception:
        pass

    return None

# 将列表转换为字符串（用于响应头）
CORS_ALLOWED_HEADERS_STR = ', '.join(CORS_ALLOWED_HEADERS)
CORS_ALLOWED_METHODS_STR = ', '.join(CORS_ALLOWED_METHODS)
CORS_EXPOSE_HEADERS_STR = ', '.join(CORS_EXPOSE_HEADERS)

# ==================== IP 地址处理 ====================
def get_client_ip():
    """获取客户端真实IP地址（考虑代理）"""
    # 优先从 X-Forwarded-For 获取（如果经过代理）
    forwarded_for = request.headers.get('X-Forwarded-For')
    if forwarded_for:
        # X-Forwarded-For 可能包含多个IP，取第一个
        ip = forwarded_for.split(',')[0].strip()
        if ip:
            return ip
    
    # 其次从 X-Real-IP 获取
    real_ip = request.headers.get('X-Real-IP')
    if real_ip:
        return real_ip.strip()
    
    # 最后使用 request.remote_addr
    return request.remote_addr or 'unknown'

def is_owner_ip(ip: str) -> bool:
    """检查IP是否为软件拥有者（仅配置IP/本机）"""
    # 1. 检查配置的拥有者IP列表
    owner_config = config.get('owner', {}) or {}
    owner_ips_str = owner_config.get('ip_addresses', '127.0.0.1,::1')
    owner_ips = [ip.strip() for ip in owner_ips_str.split(',') if ip.strip()]
    if ip in owner_ips:
        return True
    
    # 2. 检查本机访问（127.0.0.1, ::1, localhost）
    if ip in ['127.0.0.1', '::1', 'localhost']:
        return True
    
    return False

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
    response = Response(status=200)
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

# ==================== Role Versions（角色版本） ====================

def _role_version_id_now() -> str:
    return f"rv-{int(time.time() * 1000)}"


def _get_session_skill_packs_list(cursor, session_id: str) -> list:
    """获取会话的技能包列表（内部使用，不返回 Response）"""
    cursor.execute("""
        SELECT sp.skill_pack_id, sp.name, sp.summary, sp.source_session_id,
               sp.created_at, sp.updated_at,
               spa.assignment_id, spa.target_type, spa.created_at as assigned_at
        FROM skill_packs sp
        INNER JOIN skill_pack_assignments spa ON sp.skill_pack_id = spa.skill_pack_id
        WHERE spa.target_session_id = %s
        ORDER BY spa.created_at DESC
    """, (session_id,))
    
    skill_packs = cursor.fetchall()
    for sp in skill_packs:
        if sp.get('created_at'):
            sp['created_at'] = sp['created_at'].isoformat()
        if sp.get('updated_at'):
            sp['updated_at'] = sp['updated_at'].isoformat()
        if sp.get('assigned_at'):
            sp['assigned_at'] = sp['assigned_at'].isoformat()
    return skill_packs


def _get_session_row(cursor, session_id: str) -> Optional[dict]:
    cursor.execute(
        """
        SELECT session_id, session_type, title, name, llm_config_id, avatar, system_prompt, ext, updated_at
        FROM sessions
        WHERE session_id = %s
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    if row and row.get('ext'):
        try:
            row['ext'] = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
        except:
            row['ext'] = {}
    return row


def _ensure_role_current_version(conn, role_id: str) -> str:
    """
    确保 role_versions 中存在该角色的 current 版本；如果不存在则按当前角色快照创建一个。
    返回 current 的 version_id。
    """
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    try:
        role = _get_session_row(cursor, role_id)
        if not role or role.get('session_type') != 'agent':
            raise ValueError('role_id is not a valid agent session')

        cursor.execute(
            """
            SELECT version_id
            FROM role_versions
            WHERE role_id = %s AND is_current = 1
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (role_id,),
        )
        row = cursor.fetchone()
        if row and row.get('version_id'):
            return row['version_id']

        version_id = _role_version_id_now()
        cursor.execute("UPDATE role_versions SET is_current = 0 WHERE role_id = %s", (role_id,))
        cursor.execute(
            """
            INSERT INTO role_versions
              (role_id, version_id, name, avatar, system_prompt, llm_config_id, is_current, metadata)
            VALUES
              (%s, %s, %s, %s, %s, %s, 1, %s)
            """,
            (
                role_id,
                version_id,
                role.get('name'),
                role.get('avatar'),
                role.get('system_prompt'),
                role.get('llm_config_id'),
                json.dumps({'reason': 'bootstrap'}, ensure_ascii=False),
            ),
        )
        conn.commit()
        return version_id
    finally:
        cursor.close()


def _create_role_version(conn, role_id: str, metadata: Optional[dict] = None) -> str:
    """从当前角色会话快照创建一个新版本，并设置为 current。"""
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    try:
        role = _get_session_row(cursor, role_id)
        if not role or role.get('session_type') != 'agent':
            raise ValueError('role_id is not a valid agent session')

        version_id = _role_version_id_now()
        cursor.execute("UPDATE role_versions SET is_current = 0 WHERE role_id = %s", (role_id,))
        cursor.execute(
            """
            INSERT INTO role_versions
              (role_id, version_id, name, avatar, system_prompt, llm_config_id, is_current, metadata)
            VALUES
              (%s, %s, %s, %s, %s, %s, 1, %s)
            """,
            (
                role_id,
                version_id,
                role.get('name'),
                role.get('avatar'),
                role.get('system_prompt'),
                role.get('llm_config_id'),
                json.dumps(metadata or {'reason': 'update'}, ensure_ascii=False),
            ),
        )
        conn.commit()
        return version_id
    finally:
        cursor.close()


def _get_role_version(conn, role_id: str, version_id: str) -> Optional[dict]:
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    try:
        cursor.execute(
            """
            SELECT role_id, version_id, name, avatar, system_prompt, llm_config_id, metadata, is_current, created_at
            FROM role_versions
            WHERE role_id = %s AND version_id = %s
            """,
            (role_id, version_id),
        )
        return cursor.fetchone()
    finally:
        cursor.close()

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
    # 如果配置中包含 '*' 或者 origin 在允许列表中，则允许该 origin
    # 注意：当使用 supports_credentials=True 时，不能直接使用 '*'，需要动态设置具体的 origin
    if origin:
        # 如果配置允许所有来源（包含 '*'），或者 origin 在允许列表中
        if '*' in cors_origins or origin in cors_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS_STR
            response.headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS_STR
            response.headers['Access-Control-Expose-Headers'] = CORS_EXPOSE_HEADERS_STR
    elif '*' in cors_origins:
        # 如果没有 Origin 头但配置允许所有来源，则允许所有来源（不使用 credentials）
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS_STR
        response.headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS_STR
        response.headers['Access-Control-Expose-Headers'] = CORS_EXPOSE_HEADERS_STR
    return response


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
                # 使用连接池（对于 GET 请求，也使用 Session 以复用连接）
                from mcp_server.mcp_common_logic import get_mcp_session
                session = get_mcp_session(target_url)
                sse_response = session.get(
                    target_url,
                    headers=headers,
                    stream=True,
                    timeout=120  # 增加SSE连接超时到120秒
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
                        chunk_timeout = 180  # 每个chunk的超时时间（秒），增加到180秒以支持慢速MCP服务器
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
                
                # 转发到目标服务器（使用连接池）
                from mcp_server.mcp_common_logic import get_mcp_session
                session = get_mcp_session(target_url)
                post_response = session.post(
                    target_url,
                    json=json_data,
                    headers=headers,
                    timeout=120  # 增加POST请求超时到120秒
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
                
                # 从缓存/数据库获取服务器配置，检查响应格式
                response_format = 'json'  # 默认 JSON
                try:
                    from mcp_server.mcp_common_logic import get_mcp_server_config
                    server_config = get_mcp_server_config(target_url)
                    if server_config and server_config.get("found"):
                        ext = server_config.get("ext") or {}
                        response_format = ext.get('response_format', 'json')
                        print(f"[MCP Proxy] Server response_format: {response_format}")
                except Exception as config_error:
                    print(f"[MCP Proxy] Warning: Failed to get response_format from cache/DB: {config_error}")
                
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
                            chunk_timeout = 180  # 每个chunk的超时时间（秒），增加到180秒以支持慢速MCP服务器
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


@app.route('/mcp/health', methods=['GET', 'OPTIONS'])
def mcp_health_proxy():
    """
    MCP 服务器健康检查代理端点
    用于检查 MCP 服务器是否支持标准 /health 接口
    
    规范要求：
    - MCP 服务应实现 GET /health 接口
    - 返回格式: {"status": "healthy"} 或 {"status": "unhealthy"}
    - 也支持: {"healthy": true} 或 {"ok": true}
    """
    from urllib.parse import unquote
    
    # 处理 CORS 预检请求
    if request.method == 'OPTIONS':
        response = Response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS_STR
        return response
    
    try:
        # 获取目标健康检查 URL
        target_url = request.args.get('url')
        if not target_url:
            return jsonify({'error': 'Missing url parameter'}), 400
        
        target_url = unquote(target_url)
        print(f"[MCP Health Proxy] Checking health of: {target_url}")
        
        # 设置较短的超时时间（5秒）
        try:
            response = requests.get(
                target_url,
                headers={
                    'Accept': 'application/json',
                },
                timeout=5
            )
            
            # 构建响应头
            response_headers = {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
            }
            
            # 检查响应状态
            if response.status_code == 404 or response.status_code == 405:
                # /health 接口不存在
                print(f"[MCP Health Proxy] Health endpoint not found: {response.status_code}")
                return jsonify({
                    'supported': False,
                    'healthy': False,
                    'message': f'Health endpoint returned {response.status_code}'
                }), 200
            
            if not response.ok:
                # 服务器返回错误状态
                print(f"[MCP Health Proxy] Health endpoint error: {response.status_code}")
                return jsonify({
                    'supported': True,
                    'healthy': False,
                    'status_code': response.status_code,
                    'message': f'Server returned {response.status_code}'
                }), 200
            
            # 解析响应
            try:
                data = response.json()
                
                # 检查健康状态
                is_healthy = (
                    data.get('status') == 'healthy' or 
                    data.get('status') == 'ok' or
                    data.get('healthy') is True or
                    data.get('ok') is True
                )
                
                print(f"[MCP Health Proxy] Health check result: supported=True, healthy={is_healthy}")
                return jsonify({
                    'supported': True,
                    'healthy': is_healthy,
                    'details': data
                }), 200
                
            except Exception as e:
                # JSON 解析失败，但接口存在
                print(f"[MCP Health Proxy] Failed to parse JSON response: {e}")
                return jsonify({
                    'supported': True,
                    'healthy': False,
                    'message': f'Invalid JSON response: {str(e)}'
                }), 200
                
        except requests.exceptions.Timeout:
            print(f"[MCP Health Proxy] Health check timeout")
            return jsonify({
                'supported': True,
                'healthy': False,
                'message': 'Health check timeout'
            }), 200
            
        except requests.exceptions.ConnectionError as e:
            # 连接错误，可能是服务器不可用
            print(f"[MCP Health Proxy] Connection error: {e}")
            return jsonify({
                'supported': False,
                'healthy': False,
                'message': f'Connection error: {str(e)}'
            }), 200
            
    except Exception as e:
        print(f"[MCP Health Proxy] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'supported': False,
            'healthy': False,
            'error': str(e)
        }), 500


@app.route('/api/cache/stats', methods=['GET', 'OPTIONS'])
def get_cache_stats():
    """
    获取缓存统计信息（用于性能监控）
    
    返回:
    - llm_config: LLM 配置缓存统计
    - mcp_server: MCP 服务器配置缓存统计
    - tools_list: 工具列表缓存统计
    - mcp_common: MCP 通用模块缓存统计
    """
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from services.cache import get_cache_stats as get_service_cache_stats
        from mcp_server.mcp_common_logic import get_mcp_health_status
        
        stats = get_service_cache_stats()
        stats['mcp_health'] = get_mcp_health_status()
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cache/clear', methods=['POST', 'OPTIONS'])
def clear_cache():
    """
    清理缓存（用于调试）
    
    Body (可选):
    - type: 要清理的缓存类型 (llm_config, mcp_server, all)
    """
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from services.cache import llm_config_cache, mcp_server_cache
        
        data = request.get_json() or {}
        cache_type = data.get('type', 'all')
        
        cleared = []
        if cache_type in ('llm_config', 'all'):
            llm_config_cache.clear()
            cleared.append('llm_config')
        if cache_type in ('mcp_server', 'all'):
            mcp_server_cache.clear()
            cleared.append('mcp_server')
        
        return jsonify({
            'success': True,
            'cleared': cleared,
        })
    except Exception as e:
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
        
        response = requests.post(target_url, json=mcp_request, timeout=90)

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
        # 对于 Notion，从数据库读取注册信息
        is_notion = resource and 'mcp.notion.com' in resource
        if is_notion:
            # 从数据库读取 Notion 注册信息
            from mcp_server.well_known.notion import get_notion_registration_from_db
            notion_registration = get_notion_registration_from_db(client_id)
            if notion_registration:
                redirect_uri = notion_registration.get('redirect_uri')
                print(f"[MCP OAuth] Detected Notion MCP, using redirect_uri from database: {redirect_uri}")
            else:
                # 向后兼容：如果没有数据库记录，使用 config.yaml
                notion_config = config.get('notion', {})
                redirect_uri = notion_config.get('redirect_uri', f"{config.get('server', {}).get('url', 'http://localhost:3001')}/mcp/oauth/callback/")
                print(f"[MCP OAuth] ⚠️ No Notion registration in DB, using redirect_uri from config.yaml")
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
        
        # 保存 OAuth 配置到 Redis（使用 state 作为 key）
        # 只保存 client_id，其他信息从 MySQL 获取
        from database import save_oauth_config
        
        # 获取 token_endpoint 和其他配置
        token_endpoint = data.get('token_endpoint')
        client_secret = data.get('client_secret', '')
        token_endpoint_auth_methods_supported = data.get('token_endpoint_auth_methods_supported', ['none'])
        
        oauth_config = {
            'client_id': client_id,  # 只保存 client_id，其他信息从数据库获取
            'code_verifier': code_verifier,
            'code_challenge': code_challenge,
            'code_challenge_method': code_challenge_method,
            'token_endpoint': token_endpoint,  # 从请求中获取
            'client_secret': client_secret,
            'redirect_uri': redirect_uri,
            'resource': resource,
            'token_endpoint_auth_methods_supported': token_endpoint_auth_methods_supported,
            'mcp_url': mcp_url,  # 保存 MCP URL，用于后续 token 管理
        }
        
        # 使用 state 作为 key 保存到 Redis，TTL 10 分钟
        save_success = save_oauth_config(state, oauth_config, ttl=600)
        if not save_success:
            print(f"[MCP OAuth] ⚠️ WARNING: Failed to save OAuth config to Redis!")
            return jsonify({
                'error': 'Failed to save OAuth configuration',
                'message': 'Could not save OAuth configuration to Redis. Please check Redis connection.'
            }), 500
        print(f"[MCP OAuth] ✅ OAuth config saved to Redis")
        print(f"[MCP OAuth] Redis key: oauth:config:{state}")
        print(f"[MCP OAuth] Client ID: {client_id}")
        
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

@app.route('/mcp/oauth/callback/<short_hash>', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/mcp/oauth/callback/<short_hash>/', methods=['GET', 'POST', 'OPTIONS'])
def mcp_oauth_callback_with_hash(short_hash: str):
    """处理 OAuth 回调，支持动态hash路由（用于多Notion工作空间）
    
    Args:
        short_hash: 8位短hash，用于识别不同的Notion工作空间
    """
    print(f"\n{'='*80}")
    print(f"==== MCP OAUTH CALLBACK WITH HASH: {short_hash} ====")
    print(f"Method: {request.method}")
    print(f"{'='*80}\n")
    
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        import requests
        import json
        
        # 从 URL 参数获取 code 和 state
        code = request.args.get('code')
        state = request.args.get('state')
        error = request.args.get('error')
        error_description = request.args.get('error_description')
        
        print(f"[OAuth Callback Hash] short_hash: {short_hash}")
        print(f"[OAuth Callback Hash] Code: {code}")
        print(f"[OAuth Callback Hash] State: {state}")
        print(f"[OAuth Callback Hash] Error: {error}")
        
        # 检查是否有错误
        if error:
            print(f"[OAuth Callback Hash] ❌ ERROR: {error}")
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
        
        if not code:
            print(f"[OAuth Callback Hash] ❌ ERROR: Missing code")
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
        
        # 从数据库查询short_hash对应的Notion注册信息
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            print(f"[OAuth Callback Hash] ❌ Database connection failed")
            return jsonify({'error': 'Database connection failed'}), 500
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, client_id, client_name, workspace_alias, redirect_uri, registration_data
            FROM notion_registrations
            WHERE short_hash = %s
        """, (short_hash,))
        
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row:
            print(f"[OAuth Callback Hash] ❌ No Notion registration found for short_hash: {short_hash}")
            error_html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Notion工作空间未找到</title>
                <meta charset="utf-8">
                <style>
                    body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                    .error {{ color: #dc2626; }}
                </style>
            </head>
            <body>
                <h1 class="error">Notion工作空间未找到</h1>
                <p>无法找到对应的Notion工作空间配置</p>
                <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
            </body>
            </html>
            """
            return error_html, 400
        
        reg_id, client_id, client_name, workspace_alias, redirect_uri, reg_data_json = row
        
        print(f"[OAuth Callback Hash] ✅ Found registration: client_id={client_id}, workspace_alias={workspace_alias}")
        
        # 解析registration_data获取registration_uri（由Notion返回）
        if isinstance(reg_data_json, str):
            try:
                registration_data = json.loads(reg_data_json)
            except:
                registration_data = {}
        else:
            registration_data = reg_data_json or {}
        
        # 从Redis获取OAuth配置（使用state作为key）
        from database import get_oauth_config, delete_oauth_config
        oauth_config = get_oauth_config(state)
        
        if not oauth_config:
            print(f"[OAuth Callback Hash] ⚠️ OAuth config not found in Redis for state: {state[:30]}...")
            error_html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>OAuth 配置过期</title>
                <meta charset="utf-8">
                <style>
                    body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                    .error {{ color: #dc2626; }}
                </style>
            </head>
            <body>
                <h1 class="error">OAuth 配置过期</h1>
                <p>OAuth 配置已过期。请重新开始授权流程。</p>
                <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
            </body>
            </html>
            """
            return error_html, 400
        
        # 从Redis配置中提取PKCE信息
        code_verifier = oauth_config.get('code_verifier')
        token_endpoint = oauth_config.get('token_endpoint')
        resource = oauth_config.get('resource')
        mcp_url = oauth_config.get('mcp_url')
        
        print(f"[OAuth Callback Hash] Token endpoint: {token_endpoint}")
        print(f"[OAuth Callback Hash] Code verifier ready: {bool(code_verifier)}")
        print(f"[OAuth Callback Hash] MCP URL: {mcp_url}")
        
        # 交换token（Notion MCP）
        try:
            from mcp_server.well_known.notion import exchange_notion_token
            token_data = exchange_notion_token(config, code, code_verifier, redirect_uri, client_id)
            access_token = token_data.get('access_token')
            refresh_token = token_data.get('refresh_token')
            expires_in = token_data.get('expires_in')
        except Exception as e:
            print(f"[OAuth Callback Hash] ❌ Notion token exchange failed: {e}")
            import traceback
            traceback.print_exc()
            error_html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Token交换失败</title>
                <meta charset="utf-8">
                <style>
                    body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                    .error {{ color: #dc2626; }}
                </style>
            </head>
            <body>
                <h1 class="error">Token交换失败</h1>
                <p>无法从Notion获取访问令牌。请重试。</p>
                <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
            </body>
            </html>
            """
            return error_html, 500
        
        print(f"[OAuth Callback Hash] ✅ Token exchanged successfully")
        print(f"[OAuth Callback Hash] workspace_alias: {workspace_alias}")
        print(f"[OAuth Callback Hash] Access token length: {len(access_token) if access_token else 0}")
        
        # 使用workspace_alias对应的short_hash作为Redis缓存前缀
        # 保存token到Redis（使用short_hash作为前缀）
        redis_cache_key = f"notion_token:{short_hash}"
        
        # 创建token信息字典
        token_info = {
            'client_id': client_id,
            'access_token': access_token,
            'refresh_token': refresh_token,
            'token_type': token_data.get('token_type', 'bearer'),
            'expires_in': expires_in,
            'expires_at': int(time.time()) + expires_in if expires_in else None,
            'scope': token_data.get('scope', ''),
            'state': state,
            'mcp_url': mcp_url,
            'workspace_id': token_data.get('workspace_id'),
            'workspace_name': token_data.get('workspace_name'),
            'workspace_alias': workspace_alias,
            'short_hash': short_hash,
            'bot_id': token_data.get('bot_id'),
        }
        
        # 保存到Redis
        from database import get_redis_client
        redis_client = get_redis_client()
        if redis_client:
            redis_client.setex(
                redis_cache_key,
                86400 * 30,  # 30天过期
                json.dumps(token_info)
            )
            print(f"[OAuth Callback Hash] ✅ Token saved to Redis: {redis_cache_key}")
        
        # 清理OAuth配置（已使用）
        delete_oauth_config(state)
        
        # 返回成功页面
        success_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Notion连接成功</title>
            <meta charset="utf-8">
            <style>
                body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f3f4f6; }}
                .container {{ max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
                .success {{ color: #10b981; font-size: 24px; margin-bottom: 20px; }}
                .info {{ color: #666; margin: 15px 0; font-size: 14px; }}
                .details {{ background: #f9fafb; padding: 15px; border-radius: 5px; text-align: left; font-family: monospace; font-size: 12px; margin: 20px 0; }}
                a {{ color: #3b82f6; text-decoration: none; }}
                a:hover {{ text-decoration: underline; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="success">✓ Notion连接成功</div>
                <p class="info">您的Notion工作空间已成功连接</p>
                <div class="details">
                    <div>工作空间别名: <strong>{workspace_alias}</strong></div>
                    <div>工作空间名称: <strong>{token_data.get('workspace_name', 'N/A')}</strong></div>
                    <div>短Hash: <strong>{short_hash}</strong></div>
                    <div>缓存前缀: <strong>notion_token:{short_hash}</strong></div>
                    <div>过期时间: <strong>{expires_in}秒</strong></div>
                </div>
                <p class="info">您现在可以关闭此窗口或<a href="/mcp-config">返回MCP配置</a></p>
            </div>
        </body>
        </html>
        """
        
        return success_html, 200
        
    except Exception as e:
        print(f"[OAuth Callback Hash] ❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        error_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>发生错误</title>
            <meta charset="utf-8">
            <style>
                body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                .error {{ color: #dc2626; }}
            </style>
        </head>
        <body>
            <h1 class="error">发生错误</h1>
            <p>{str(e)}</p>
            <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
        </body>
        </html>
        """
        return error_html, 500

@app.route('/mcp/oauth/callback', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/mcp/oauth/callback/', methods=['GET', 'POST', 'OPTIONS'])  # 支持末尾斜杠
def mcp_oauth_callback():
    """处理 OAuth 回调，交换 access token（通用）
    GET: 接收 OAuth 服务器的重定向回调
    POST: 前端手动触发的回调（向后兼容）
    
    从 config.yaml 读取 client_id，用于从 Redis 获取配置
    """
    # 不再从 config.yaml 读取 client_id，而是从 state 对应的 Redis 配置中获取
    
    # 立即打印请求信息（无论什么方法）
    import sys
    # 同时输出到 stdout 和 stderr，确保日志可见
    msg = f"""
{'='*80}
==== MCP OAUTH CALLBACK ENDPOINT HIT ====
Method: {request.method}
URL: {request.url}
Path: {request.path}
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
            
            # 从 Redis 获取 OAuth 配置（使用 state 作为 key）
            from database import get_oauth_config, delete_oauth_config, save_oauth_config, get_redis_client
            
            print(f"[OAuth Callback] Looking for OAuth config with state: {state[:30]}...")
            print(f"[OAuth Callback] Full state: {state}")
            
            # 尝试获取配置
            oauth_config = get_oauth_config(state)
            
            # 如果找不到，尝试列出所有OAuth配置key以便调试
            if not oauth_config:
                print(f"[OAuth Callback] ⚠️ OAuth config not found for state: {state[:30]}...")
                try:
                    redis_client = get_redis_client()
                    if redis_client:
                        all_keys = redis_client.keys('oauth:config:*')
                        print(f"[OAuth Callback] Available OAuth config keys in Redis: {[k.decode('utf-8') if isinstance(k, bytes) else k for k in all_keys[:20]]}")
                except Exception as e:
                    print(f"[OAuth Callback] Error checking Redis keys: {e}")
            
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
                    <p class="info">State: {state[:30]}...</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 400
            
            # 从 Redis 配置中提取所需信息
            code_verifier = oauth_config.get('code_verifier')
            token_endpoint = oauth_config.get('token_endpoint')
            # client_id 从 OAuth 配置中获取（之前保存的）
            config_client_id = oauth_config.get('client_id')
            if not config_client_id:
                print(f"[OAuth Callback] ❌ ERROR: client_id not found in OAuth config")
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
                    <p>OAuth 配置中缺少 client_id</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 400
            
            print(f"[OAuth Callback] Using client_id from OAuth config: {config_client_id[:10]}...")
            
            client_secret = oauth_config.get('client_secret', '')
            resource = oauth_config.get('resource')
            # 使用固定的回调地址（不包含client_id）
            # 对于 Notion，从数据库读取注册信息
            is_notion = resource and 'mcp.notion.com' in resource
            if is_notion:
                # 从数据库读取 Notion 注册信息
                from mcp_server.well_known.notion import get_notion_registration_from_db
                notion_registration = get_notion_registration_from_db(config_client_id)
                if notion_registration:
                    redirect_uri = notion_registration.get('redirect_uri')
                    print(f"[MCP OAuth Callback] Detected Notion MCP, using redirect_uri from database: {redirect_uri}")
                else:
                    # 向后兼容：如果没有数据库记录，使用 config.yaml
                    notion_config = config.get('notion', {})
                    redirect_uri = notion_config.get('redirect_uri', f"{config.get('server', {}).get('url', 'http://localhost:3001')}/mcp/oauth/callback/")
                    print(f"[MCP OAuth Callback] ⚠️ No Notion registration in DB, using redirect_uri from config.yaml")
            else:
                backend_url = config.get('server', {}).get('url', 'http://localhost:3001')
                redirect_uri = f"{backend_url}/mcp/oauth/callback"
            token_endpoint_auth_methods = oauth_config.get('token_endpoint_auth_methods_supported', ['none'])
            mcp_url = oauth_config.get('mcp_url')  # 保存的 MCP 服务器 URL
            
            print("[OAuth Callback] OAuth Config from Redis:")
            print(f"  token_endpoint: {token_endpoint}")
            print(f"  client_id (from config): {config_client_id}")
            print(f"  redirect_uri (fixed): {redirect_uri}")
            print(f"  resource: {resource}")
            print(f"  mcp_url: {mcp_url}")
            print(f"  code_verifier present: {bool(code_verifier)}")
            
            if not code_verifier or not token_endpoint or not config_client_id or not redirect_uri:
                missing_fields = []
                if not code_verifier:
                    missing_fields.append('code_verifier')
                if not token_endpoint:
                    missing_fields.append('token_endpoint')
                if not config_client_id:
                    missing_fields.append('client_id')
                if not redirect_uri:
                    missing_fields.append('redirect_uri')
                
                print(f"[OAuth Callback] ❌ ERROR: Missing required fields in OAuth config: {missing_fields}")
                print(f"[OAuth Callback] Full OAuth config from Redis: {oauth_config}")
                print(f"[OAuth Callback] Config keys: {list(oauth_config.keys()) if oauth_config else 'None'}")
                print(f"[OAuth Callback] Field values:")
                print(f"  code_verifier: {'present' if code_verifier else 'MISSING'} ({type(code_verifier).__name__})")
                print(f"  token_endpoint: {'present' if token_endpoint else 'MISSING'} ({type(token_endpoint).__name__})")
                print(f"  client_id: {'present' if config_client_id else 'MISSING'} ({type(config_client_id).__name__ if config_client_id else 'None'})")
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
            
            # 从 OAuth 配置中获取 client_id（之前保存的）
            config_client_id = oauth_config.get('client_id')
            if not config_client_id:
                print(f"[OAuth Callback] ❌ ERROR: client_id not found in OAuth config")
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
                    <p>OAuth 配置中缺少 client_id</p>
                    <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
                </body>
                </html>
                """
                return error_html, 400
            
            print(f"[OAuth Callback] Using client_id from OAuth config: {config_client_id[:10]}...")
            
            # 自动交换 token
            print(f"[MCP OAuth] Exchanging code for access token")
            
            # 对于 Notion，使用专用模块
            if is_notion:
                try:
                    from mcp_server.well_known.notion import exchange_notion_token
                    # 传递 client_id 以便从数据库读取注册信息
                    token_data = exchange_notion_token(config, code, code_verifier, redirect_uri, config_client_id)
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
                    'client_id': config_client_id,
                }
                
                # 根据 token_endpoint_auth_methods 选择认证方式
                if 'client_secret_basic' in token_endpoint_auth_methods and client_secret:
                    import base64
                    auth_string = f"{config_client_id}:{client_secret}"
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
                'client_id': config_client_id,  # 关联 Client ID
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
            save_oauth_token(f"client:{config_client_id}", token_info)
            print(f"[MCP OAuth] ✅ Token also saved with client_id: oauth:token:client:{config_client_id[:10]}...")
            print(f"[MCP OAuth] Client ID: {config_client_id}")
            
            # 保存 OAuth 配置到 Redis（用于后续刷新 token）
            oauth_config_for_refresh = {
                'client_id': config_client_id,
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
            
            save_oauth_config(f"refresh_client:{config_client_id}", oauth_config_for_refresh, ttl=None)  # 永不过期
            print(f"[MCP OAuth] ✅ Refresh config saved with client_id: refresh_client:{config_client_id[:10]}...")
            
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
            
            # 删除临时的 OAuth 配置（state 相关的临时配置）
            delete_oauth_config(state)
            print(f"[MCP OAuth] ✅ Temporary OAuth config deleted (state: {state[:30]}...)")
            
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
                    // 浏览器环境：如果是弹窗，尝试关闭
                    if (window.opener) {
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
        print(f"  code: {code[:50] + '...' if code and len(code) > 50 else code}")
        print(f"  state: {state}")
        print("="*80 + "\n")
        
        if not code:
            return jsonify({'error': 'Missing authorization code'}), 400
        
        if not state:
            return jsonify({'error': 'Missing state parameter'}), 400
        
        # 从 Redis 获取 OAuth 配置（使用 state 作为 key）
        from database import get_oauth_config, delete_oauth_config, save_oauth_config, save_oauth_token
        
        print(f"[Callback POST] Looking for OAuth config with state: {state[:30]}...")
        oauth_config = get_oauth_config(state)
        
        if not oauth_config:
            return jsonify({
                'error': 'OAuth configuration not found',
                'message': f'OAuth configuration for state {state[:30]}... expired or not found. Please restart the authorization flow.'
            }), 400
        
        # 从 Redis 配置中提取所需信息
        code_verifier = oauth_config.get('code_verifier')
        token_endpoint = oauth_config.get('token_endpoint')
        # client_id 从 OAuth 配置中获取（之前保存的）
        config_client_id = oauth_config.get('client_id')
        if not config_client_id:
            return jsonify({
                'error': 'OAuth configuration incomplete',
                'message': 'client_id not found in OAuth configuration'
            }), 400
        client_secret = oauth_config.get('client_secret', '')
        resource = oauth_config.get('resource')
        # 使用固定的回调地址（不包含client_id）
        # 对于 Notion，从数据库读取注册信息
        is_notion = resource and 'mcp.notion.com' in resource
        if is_notion:
            # 从数据库读取 Notion 注册信息
            from mcp_server.well_known.notion import get_notion_registration_from_db
            notion_registration = get_notion_registration_from_db(config_client_id)
            if notion_registration:
                redirect_uri = notion_registration.get('redirect_uri')
                print(f"[MCP OAuth POST Callback] Detected Notion MCP, using redirect_uri from database: {redirect_uri}")
            else:
                # 向后兼容：如果没有数据库记录，使用 config.yaml
                notion_config = config.get('notion', {})
                redirect_uri = notion_config.get('redirect_uri', f"{config.get('server', {}).get('url', 'http://localhost:3001')}/mcp/oauth/callback/")
                print(f"[MCP OAuth POST Callback] ⚠️ No Notion registration in DB, using redirect_uri from config.yaml")
        else:
            backend_url = config.get('server', {}).get('url', 'http://localhost:3001')
            redirect_uri = f"{backend_url}/mcp/oauth/callback"
        token_endpoint_auth_methods = oauth_config.get('token_endpoint_auth_methods_supported', ['none'])
        mcp_url = oauth_config.get('mcp_url')
        
        print("[Callback] OAuth Config from Redis:")
        print(f"  token_endpoint: {token_endpoint}")
        print(f"  client_id: {config_client_id[:10]}...")
        print(f"  redirect_uri: {redirect_uri}")
        print(f"  resource: {resource}")
        print(f"  code_verifier: {code_verifier[:30] + '...' if code_verifier else 'None'}")
        print("="*80 + "\n")
        
        if not code_verifier:
            return jsonify({'error': 'Missing code_verifier in OAuth configuration'}), 400
        
        if not token_endpoint:
            return jsonify({'error': 'Missing token_endpoint in OAuth configuration'}), 400
        
        if not config_client_id:
            return jsonify({'error': 'Missing client_id in OAuth configuration'}), 400
        
        if not redirect_uri:
            return jsonify({'error': 'Missing redirect_uri in OAuth configuration'}), 400
        
        print(f"[MCP OAuth] Exchanging code for access token")
        
        # 对于 Notion，使用专用模块
        if is_notion:
            try:
                from mcp_server.well_known.notion import exchange_notion_token
                # 传递 client_id 以便从数据库读取注册信息
                token_data = exchange_notion_token(config, code, code_verifier, redirect_uri, config_client_id)
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
                'client_id': config_client_id,
            }
            
            # 根据 token_endpoint_auth_methods 选择认证方式
            if 'client_secret_basic' in token_endpoint_auth_methods and client_secret:
                import base64
                auth_string = f"{config_client_id}:{client_secret}"
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
            'client_id': config_client_id,
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
        
        save_oauth_token(f"client:{config_client_id}", token_info)
        print(f"[MCP OAuth POST] ✅ Token also saved with client_id: oauth:token:client:{config_client_id[:10]}...")
        
        # 保存 OAuth 配置到 Redis（用于后续刷新 token）
        oauth_config_for_refresh = {
            'client_id': config_client_id,
            'token_endpoint': token_endpoint,
            'client_secret': client_secret,
            'resource': resource,
            'token_endpoint_auth_methods_supported': token_endpoint_auth_methods,
            'mcp_url': normalized_mcp_url,
        }
        
        if normalized_mcp_url:
            save_oauth_config(f"refresh_{normalized_mcp_url}", oauth_config_for_refresh, ttl=None)
            print(f"[MCP OAuth POST] ✅ Refresh config saved with key: refresh_{normalized_mcp_url}")
        
        save_oauth_config(f"refresh_client:{config_client_id}", oauth_config_for_refresh, ttl=None)
        print(f"[MCP OAuth POST] ✅ Refresh config saved with client_id: refresh_client:{config_client_id[:10]}...")
        
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
        
        # 删除临时的 OAuth 配置（state 相关的临时配置）
        delete_oauth_config(state)
        print(f"[MCP OAuth POST] ✅ Temporary OAuth config deleted (state: {state[:30]}...)")
        
        return jsonify({
            'success': True,
            'access_token': access_token,
            'token_type': token_data.get('token_type', 'bearer'),
            'expires_in': expires_in,
            'refresh_token': refresh_token,
            'scope': token_data.get('scope', ''),
            'client_id': config_client_id,
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

# ==================== Notion 注册管理 API ====================

@app.route('/api/notion/register', methods=['POST', 'OPTIONS'])
def register_notion_client():
    """注册新的 Notion OAuth 客户端"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        data = request.get_json()
        client_name = data.get('client_name', '').strip()
        workspace_alias = data.get('workspace_alias', '').strip()  # 新增：工作区别名
        redirect_uri_base = data.get('redirect_uri_base', '').strip() or 'http://localhost:3001'
        client_uri = data.get('client_uri', 'https://github.com/TIZ36/youtubemgr')
        
        if not client_name:
            return jsonify({'error': 'client_name is required'}), 400
        
        if not workspace_alias:
            return jsonify({'error': 'workspace_alias is required (用于区分不同的Notion工作空间)'}), 400
        
        # 验证 client_name：只允许英文、数字、下划线、连字符
        import re
        if not re.match(r'^[a-zA-Z0-9_-]+$', client_name):
            return jsonify({'error': 'client_name must contain only letters, numbers, underscores, and hyphens'}), 400
        
        # 验证 workspace_alias：只允许英文、数字、下划线、连字符
        if not re.match(r'^[a-zA-Z0-9_-]+$', workspace_alias):
            return jsonify({'error': 'workspace_alias must contain only letters, numbers, underscores, and hyphens'}), 400
        
        # 检查workspace_alias是否全局唯一
        from mcp_server.well_known.notion import check_workspace_alias_unique, generate_short_hash
        if not check_workspace_alias_unique(workspace_alias):
            return jsonify({'error': f'workspace_alias "{workspace_alias}" 已被使用，请使用其他别名'}), 400
        
        # 生成8位短hash
        short_hash = generate_short_hash(workspace_alias)
        print(f"[Notion Register] Generated short_hash: {short_hash}")
        
        # 构建动态的redirect_uri：host + 固定path + 短hash
        redirect_uri = f"{redirect_uri_base.rstrip('/')}/mcp/oauth/callback/{short_hash}/"
        
        # 调用 Notion 注册 API
        import requests
        register_url = 'https://mcp.notion.com/register'
        register_payload = {
            'client_name': client_name,
            'client_uri': client_uri,
            'grant_types': ['authorization_code', 'refresh_token'],
            'redirect_uris': [redirect_uri],
            'response_types': ['code'],
            'scope': '',
            'token_endpoint_auth_method': 'none'
        }
        
        print(f"[Notion Register] Registering client: {client_name}")
        print(f"[Notion Register] Workspace Alias: {workspace_alias}")
        print(f"[Notion Register] Short Hash: {short_hash}")
        print(f"[Notion Register] Dynamic Redirect URI: {redirect_uri}")
        
        response = requests.post(
            register_url,
            json=register_payload,
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        if not response.ok:
            error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
            error_msg = error_data.get('error', {}).get('message', response.text) if isinstance(error_data, dict) else str(error_data)
            print(f"[Notion Register] ❌ Registration failed: {response.status_code} - {error_msg}")
            return jsonify({
                'error': 'Registration failed',
                'message': error_msg,
                'status_code': response.status_code
            }), response.status_code
        
        registration_data = response.json()
        client_id = registration_data.get('client_id')
        
        if not client_id:
            return jsonify({'error': 'No client_id in registration response'}), 500
        
        print(f"[Notion Register] ✅ Registration successful: {client_id}")
        
        # 保存到数据库（包括workspace_alias和short_hash）
        try:
            from database import get_mysql_connection
            conn = get_mysql_connection()
            if not conn:
                return jsonify({'error': 'Database connection failed'}), 500
            
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO `notion_registrations` 
                (`client_id`, `client_name`, `workspace_alias`, `short_hash`, `redirect_uri`, `redirect_uri_base`, `client_uri`, `registration_data`)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    `client_name` = VALUES(`client_name`),
                    `workspace_alias` = VALUES(`workspace_alias`),
                    `short_hash` = VALUES(`short_hash`),
                    `redirect_uri` = VALUES(`redirect_uri`),
                    `redirect_uri_base` = VALUES(`redirect_uri_base`),
                    `client_uri` = VALUES(`client_uri`),
                    `registration_data` = VALUES(`registration_data`),
                    `updated_at` = CURRENT_TIMESTAMP
            """, (
                client_id,
                client_name,
                workspace_alias,
                short_hash,
                redirect_uri,
                redirect_uri_base,
                client_uri,
                json.dumps(registration_data)
            ))
            conn.commit()
            cursor.close()
            conn.close()
            
            print(f"[Notion Register] ✅ Saved to database: {client_id}")
        except Exception as db_error:
            print(f"[Notion Register] ❌ Failed to save to database: {db_error}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': 'Failed to save registration to database'}), 500
        
        return jsonify({
            'success': True,
            'client_id': client_id,
            'client_name': client_name,
            'workspace_alias': workspace_alias,
            'short_hash': short_hash,
            'redirect_uri': redirect_uri,
            'registration_data': registration_data
        })
        
    except Exception as e:
        print(f"[Notion Register] ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/notion/registrations', methods=['GET', 'OPTIONS'])
def list_notion_registrations():
    """获取所有已注册的 Notion 工作空间列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database connection failed'}), 500
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                id, client_id, client_name, redirect_uri, redirect_uri_base, 
                client_uri, registration_data, created_at, updated_at
            FROM `notion_registrations`
            ORDER BY created_at DESC
        """)
        
        rows = cursor.fetchall()
        registrations = []
        
        for row in rows:
            registration_data = row[6]  # registration_data JSON
            if isinstance(registration_data, str):
                try:
                    registration_data = json.loads(registration_data)
                except:
                    registration_data = {}
            
            registrations.append({
                'id': row[0],
                'client_id': row[1],
                'client_name': row[2],
                'redirect_uri': row[3],
                'redirect_uri_base': row[4],
                'client_uri': row[5],
                'registration_data': registration_data,
                'created_at': row[7].isoformat() if row[7] else None,
                'updated_at': row[8].isoformat() if row[8] else None,
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({'registrations': registrations})
        
    except Exception as e:
        print(f"[Notion Registrations] ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/notion/registrations/<int:registration_id>', methods=['DELETE', 'OPTIONS'])
def delete_notion_registration(registration_id: int):
    """删除指定的 Notion 工作空间注册"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection, get_redis_client
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database connection failed'}), 500
        
        cursor = conn.cursor()
        
        # 首先查询该注册信息，获取 short_hash 以清理 Redis
        # 兼容旧数据库：可能没有 workspace_alias / short_hash 字段
        try:
            cursor.execute("""
                SELECT client_id, client_name, workspace_alias, short_hash
                FROM `notion_registrations`
                WHERE id = %s
            """, (registration_id,))
            row = cursor.fetchone()
        except Exception as schema_error:
            schema_error_message = str(schema_error)
            if 'Unknown column' in schema_error_message and ('workspace_alias' in schema_error_message or 'short_hash' in schema_error_message):
                cursor.execute("""
                    SELECT client_id, client_name
                    FROM `notion_registrations`
                    WHERE id = %s
                """, (registration_id,))
                row = cursor.fetchone()
                if row:
                    client_id, client_name = row
                    workspace_alias, short_hash = None, None
                    row = (client_id, client_name, workspace_alias, short_hash)
            else:
                raise
        if not row:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Registration not found'}), 404
        
        client_id, client_name, workspace_alias, short_hash = row
        
        print(f"[Notion Registration] Deleting registration: id={registration_id}, client_id={client_id}, workspace_alias={workspace_alias}")
        
        # 删除数据库记录
        cursor.execute("""
            DELETE FROM `notion_registrations`
            WHERE id = %s
        """, (registration_id,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[Notion Registration] ✅ Database record deleted")
        
        # 清理 Redis 中的 token（如果存在）
        try:
            redis_client = get_redis_client()
            if redis_client and short_hash:
                redis_key = f"notion_token:{short_hash}"
                redis_client.delete(redis_key)
                print(f"[Notion Registration] ✅ Redis token deleted: {redis_key}")
        except Exception as redis_error:
            print(f"[Notion Registration] ⚠️ Warning: Failed to delete Redis token: {redis_error}")
        
        return jsonify({
            'success': True,
            'message': f'Registration "{client_name}" deleted successfully'
        })
        
    except Exception as e:
        print(f"[Notion Registration Delete] ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/notion/registrations/<client_id>', methods=['GET', 'OPTIONS'])
def get_notion_registration(client_id):
    """获取特定的 Notion 注册信息"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database connection failed'}), 500
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                id, client_id, client_name, redirect_uri, redirect_uri_base, 
                client_uri, registration_data, created_at, updated_at
            FROM `notion_registrations`
            WHERE client_id = %s
            LIMIT 1
        """, (client_id,))
        
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Registration not found'}), 404
        
        registration_data = row[6]  # registration_data JSON
        if isinstance(registration_data, str):
            try:
                registration_data = json.loads(registration_data)
            except:
                registration_data = {}
        
        return jsonify({
            'id': row[0],
            'client_id': row[1],
            'client_name': row[2],
            'redirect_uri': row[3],
            'redirect_uri_base': row[4],
            'client_uri': row[5],
            'registration_data': registration_data,
            'created_at': row[7].isoformat() if row[7] else None,
            'updated_at': row[8].isoformat() if row[8] else None,
        })
        
    except Exception as e:
        print(f"[Notion Registration] ❌ ERROR: {e}")
        import traceback
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
            
            # 查询 MCP 服务器，并关联查询 Notion 注册信息（如果有）
            cursor.execute("""
                SELECT 
                    s.server_id, s.name, s.url, s.type, s.enabled, s.use_proxy, s.description, 
                    s.metadata, s.ext, s.created_at, s.updated_at,
                    n.client_name, n.client_id as notion_client_id
                FROM mcp_servers s
                LEFT JOIN notion_registrations n ON (
                    s.ext IS NOT NULL 
                    AND JSON_EXTRACT(s.ext, '$.client_id') = n.client_id
                )
                ORDER BY s.created_at DESC
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
                
                # 如果是 Notion 服务器，从 ext 或关联查询中获取 client_name
                if server.get('ext') and server['ext'].get('server_type') == 'notion':
                    # 优先使用 ext 中的 client_name
                    ext_client_name = server['ext'].get('client_name')
                    if ext_client_name:
                        server['display_name'] = ext_client_name
                        server['client_name'] = ext_client_name
                    # 如果没有，使用关联查询的 client_name
                    elif server.get('client_name'):
                        server['display_name'] = server['client_name']
                        # 确保 ext 中也保存 client_name
                        if server.get('ext'):
                            server['ext']['client_name'] = server['client_name']
                    # 如果都没有，使用服务器名称
                    else:
                        server['display_name'] = server.get('name', 'Notion')
                
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
            
            # 检查是否需要 OAuth token（对于 Notion 等服务器）
            server_type = server_data.get('ext', {}).get('server_type')
            if server_type == 'notion':
                # 检查是否有 Authorization header
                if 'Authorization' not in headers:
                    return jsonify({
                        'success': False,
                        'error': 'OAuth token not found. Please authorize first.',
                        'step': 'oauth_required',
                        'requires_oauth': True
                    }), 401
            
            # 1. 初始化会话
            print(f"[MCP Test] Step 1: Initializing session...")
            init_response = initialize_mcp_session(target_url, headers)
            
            if not init_response:
                # 检查是否是认证错误
                error_msg = 'Failed to initialize MCP session'
                requires_oauth = False
                
                # 如果是 Notion 服务器且没有 token，提示需要 OAuth
                if server_type == 'notion' and 'Authorization' not in headers:
                    error_msg = 'OAuth token not found. Please authorize first.'
                    requires_oauth = True
                
                return jsonify({
                    'success': False,
                    'error': error_msg,
                    'step': 'initialize',
                    'requires_oauth': requires_oauth
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

# ==================== MCP 市场（Market）API ====================

@app.route('/api/mcp/market/sources', methods=['GET', 'POST', 'OPTIONS'])
def mcp_market_sources():
    """列出/创建 MCP 市场源"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        from services.mcp_market_service import MCPMarketService

        service = MCPMarketService(get_mysql_connection)
        # 确保默认源存在
        service.ensure_default_sources()

        if request.method == 'GET':
            sources = service.list_sources()
            return jsonify({
                'sources': [
                    {
                        'source_id': s.source_id,
                        'display_name': s.display_name,
                        'type': s.type,
                        'enabled': s.enabled,
                        'config': s.config,
                        'sync_interval_seconds': s.sync_interval_seconds,
                        'last_sync_at': s.last_sync_at,
                    }
                    for s in sources
                ]
            })

        # POST
        data = request.get_json() or {}
        source = service.upsert_source(data)
        return jsonify({
            'source': {
                'source_id': source.source_id,
                'display_name': source.display_name,
                'type': source.type,
                'enabled': source.enabled,
                'config': source.config,
                'sync_interval_seconds': source.sync_interval_seconds,
            }
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/mcp/market/sources/<source_id>', methods=['PUT', 'OPTIONS'])
def mcp_market_update_source(source_id):
    """更新 MCP 市场源"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        from services.mcp_market_service import MCPMarketService

        data = request.get_json() or {}
        data['source_id'] = source_id
        service = MCPMarketService(get_mysql_connection)
        source = service.upsert_source(data)
        return jsonify({
            'source': {
                'source_id': source.source_id,
                'display_name': source.display_name,
                'type': source.type,
                'enabled': source.enabled,
                'config': source.config,
                'sync_interval_seconds': source.sync_interval_seconds,
            }
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/mcp/market/sources/<source_id>/sync', methods=['POST', 'OPTIONS'])
def mcp_market_sync_source(source_id):
    """同步指定市场源"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        from services.mcp_market_service import MCPMarketService

        data = request.get_json() or {}
        force = bool(data.get('force', False))
        service = MCPMarketService(get_mysql_connection)
        result = service.sync_source(source_id, force=force)
        return jsonify(result)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/mcp/market/search', methods=['GET', 'OPTIONS'])
def mcp_market_search():
    """搜索市场条目（从缓存表搜索）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        from services.mcp_market_service import MCPMarketService

        q = request.args.get('q', '') or ''
        runtime_type = request.args.get('runtime_type')
        source_id = request.args.get('source_id')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)

        service = MCPMarketService(get_mysql_connection)
        result = service.search_items(q=q, runtime_type=runtime_type, source_id=source_id, limit=limit, offset=offset)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'items': [], 'total': 0}), 500


@app.route('/api/mcp/market/items/<item_id>', methods=['GET', 'OPTIONS'])
def mcp_market_item_detail(item_id):
    """获取市场条目详情"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        from services.mcp_market_service import MCPMarketService

        service = MCPMarketService(get_mysql_connection)
        item = service.get_item(item_id)
        if not item:
            return jsonify({'error': 'item not found'}), 404
        return jsonify(item)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/mcp/market/install', methods=['POST', 'OPTIONS'])
def mcp_market_install():
    """一键安装市场条目：转换为 mcp_servers 记录"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        data = request.get_json() or {}
        item_id = data.get('item_id')
        if not item_id:
            return jsonify({'error': 'item_id is required'}), 400

        from database import get_mysql_connection
        from services.mcp_market_service import MCPMarketService

        service = MCPMarketService(get_mysql_connection)
        server_data = service.install_item(item_id, overrides=data.get('overrides') or {})

        # 落库复用现有 create_mcp_server 逻辑（这里直接写 DB，避免 HTTP 自调用）
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        cursor = None
        try:
            cursor = conn.cursor()
            import uuid
            server_id = server_data.get('id') or f"mcp-{uuid.uuid4().hex[:12]}"
            cursor.execute(
                """
                INSERT INTO mcp_servers
                (server_id, name, url, type, enabled, use_proxy, description, metadata, ext)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    server_id,
                    server_data['name'],
                    server_data['url'],
                    server_data.get('type', 'http-stream'),
                    server_data.get('enabled', True),
                    server_data.get('use_proxy', True),
                    server_data.get('description'),
                    json.dumps(server_data.get('metadata', {})),
                    json.dumps(server_data.get('ext', {})) if server_data.get('ext') else None,
                ),
            )
            conn.commit()
            return jsonify({'server_id': server_id, 'message': 'installed'}), 201
        finally:
            try:
                if cursor:
                    cursor.close()
            except Exception:
                pass
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
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
                SELECT config_id, name, shortname, provider, api_url, model, tags, enabled, 
                       description, metadata, created_at, updated_at,
                       (CASE WHEN api_key IS NOT NULL AND LENGTH(TRIM(IFNULL(api_key, ''))) > 0 THEN 1 ELSE 0 END) AS has_api_key
                FROM llm_configs
                ORDER BY created_at DESC
            """)
            
            columns = [desc[0] for desc in cursor.description]
            configs = []
            # 导入 token_counter 函数
            from token_counter import get_model_max_tokens
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
                config['has_api_key'] = bool(config.get('has_api_key'))
                # 转换日期时间为字符串
                if config.get('created_at'):
                    config['created_at'] = config['created_at'].isoformat() if hasattr(config['created_at'], 'isoformat') else str(config['created_at'])
                if config.get('updated_at'):
                    config['updated_at'] = config['updated_at'].isoformat() if hasattr(config['updated_at'], 'isoformat') else str(config['updated_at'])
                # 不返回API密钥（列表中已用 has_api_key 表示）
                config.pop('api_key', None)
                # 添加模型的最大 token 限制
                model_name = config.get('model', 'gpt-4')
                config['max_tokens'] = get_model_max_tokens(model_name)
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
            (config_id, name, shortname, provider, api_key, api_url, model, tags, enabled, description, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            config_id,
            name,
            data.get('shortname'),
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
            SELECT config_id, name, shortname, provider, api_url, model, tags, enabled, 
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
        
        # 添加模型的最大 token 限制
        model_name = config.get('model', 'gpt-4')
        from token_counter import get_model_max_tokens
        config['max_tokens'] = get_model_max_tokens(model_name)
        
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
        if 'shortname' in data:
            updates.append('shortname = %s')
            values.append(data['shortname'])
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

@app.route('/api/llm/configs/<config_id>/export', methods=['GET', 'OPTIONS'])
def export_llm_config(config_id):
    """导出单个LLM配置（包含API密钥）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute("""
            SELECT config_id, name, shortname, provider, api_key, api_url, model, 
                   tags, enabled, description, metadata, created_at
            FROM llm_configs WHERE config_id = %s
        """, (config_id,))
        
        config = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not config:
            return jsonify({'error': 'Config not found'}), 404
        
        # 处理 JSON 字段
        if config.get('tags') and isinstance(config['tags'], str):
            config['tags'] = json.loads(config['tags'])
        if config.get('metadata') and isinstance(config['metadata'], str):
            config['metadata'] = json.loads(config['metadata'])
        
        export_data = {
            'version': '1.0',
            'export_type': 'llm_config',
            'exported_at': datetime.now().isoformat(),
            'llm_config': {
                'name': config['name'],
                'provider': config['provider'],
                'api_key': config['api_key'],
                'api_url': config['api_url'],
                'model': config['model'],
                'tags': config['tags'],
                'enabled': bool(config['enabled']),
                'description': config['description'],
                'metadata': config['metadata'],
            }
        }
        
        return jsonify(export_data)
        
    except Exception as e:
        print(f"[LLM Config API] Error exporting config: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/llm/configs/export-all', methods=['GET', 'OPTIONS'])
def export_all_llm_configs():
    """导出所有LLM配置（包含API密钥）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute("""
            SELECT config_id, name, shortname, provider, api_key, api_url, model, 
                   tags, enabled, description, metadata, created_at
            FROM llm_configs ORDER BY created_at DESC
        """)
        
        configs = cursor.fetchall()
        cursor.close()
        conn.close()
        
        config_list = []
        for config in configs:
            # 处理 JSON 字段
            if config.get('tags') and isinstance(config['tags'], str):
                config['tags'] = json.loads(config['tags'])
            if config.get('metadata') and isinstance(config['metadata'], str):
                config['metadata'] = json.loads(config['metadata'])
            
            config_list.append({
                'name': config['name'],
                'provider': config['provider'],
                'api_key': config['api_key'],
                'api_url': config['api_url'],
                'model': config['model'],
                'tags': config['tags'],
                'enabled': bool(config['enabled']),
                'description': config['description'],
                'metadata': config['metadata'],
            })
        
        export_data = {
            'version': '1.0',
            'export_type': 'llm_configs',
            'exported_at': datetime.now().isoformat(),
            'llm_configs': config_list
        }
        
        return jsonify(export_data)
        
    except Exception as e:
        print(f"[LLM Config API] Error exporting all configs: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/llm/configs/import', methods=['POST', 'OPTIONS'])
def import_llm_configs():
    """导入LLM配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        import uuid
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        export_type = data.get('export_type')
        if export_type not in ['llm_config', 'llm_configs']:
            return jsonify({'error': 'Invalid export type'}), 400
        
        # 处理单个配置或多个配置
        if export_type == 'llm_config':
            configs = [data.get('llm_config')]
        else:
            configs = data.get('llm_configs', [])
        
        if not configs:
            return jsonify({'error': 'No configs to import'}), 400
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        imported = []
        skipped = []
        
        for config in configs:
            if not config:
                continue
                
            config_name = config.get('name')
            if not config_name:
                continue
            
            # 检查是否已存在同名配置
            cursor.execute("SELECT config_id FROM llm_configs WHERE name = %s", (config_name,))
            existing = cursor.fetchone()
            
            skip_mode = request.args.get('skip_existing', 'false').lower() == 'true'
            
            if existing:
                if skip_mode:
                    skipped.append(config_name)
                    continue
                else:
                    # 添加后缀
                    config_name = f"{config_name}_导入_{datetime.now().strftime('%m%d%H%M')}"
            
            # 创建新配置
            new_config_id = str(uuid.uuid4())
            
            cursor.execute("""
                INSERT INTO llm_configs 
                (config_id, name, shortname, provider, api_key, api_url, model, tags, enabled, description, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                new_config_id,
                config_name,
                config.get('shortname'),
                config.get('provider'),
                config.get('api_key'),
                config.get('api_url'),
                config.get('model'),
                json.dumps(config.get('tags')) if config.get('tags') else None,
                1 if config.get('enabled', True) else 0,
                config.get('description'),
                json.dumps(config.get('metadata')) if config.get('metadata') else None,
            ))
            
            imported.append({
                'config_id': new_config_id,
                'name': config_name,
            })
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'message': f'Imported {len(imported)} config(s)',
            'imported': imported,
            'skipped': skipped,
        }), 201
        
    except Exception as e:
        print(f"[LLM Config API] Error importing configs: {e}")
        import traceback
        traceback.print_exc()
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
    
    # 初始化 TopicService 和 ActorManager
    try:
        from database import get_mysql_connection, get_redis_client
        from services.topic_service import init_topic_service
        from services.actor import ActorManager

        init_topic_service(get_mysql_connection, get_redis_client())
        ActorManager.get_instance()  # 触发单例初始化
        print("[Services] TopicService and ActorManager initialized")
    except Exception as e:
        print(f"[Services] Error initializing Topic/Actor services: {e}")
        import traceback
        traceback.print_exc()

    # 注册新架构的 API 路由
    try:
        from database import get_mysql_connection
        from api import register_api_routes
        register_api_routes(app, get_mysql_connection, config)
        print("[Services] New API routes registered")
    except Exception as e:
        print(f"[Services] Warning: Failed to register new API routes: {e}")
        import traceback
        traceback.print_exc()
    
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

# ==================== Topic 参与者管理 API ====================

@app.route('/api/topics/<session_id>/participants', methods=['GET', 'OPTIONS'])
@app.route('/api/sessions/<session_id>/participants', methods=['GET', 'OPTIONS'])
def list_topic_participants(session_id):
    """获取 Topic 参与者列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from services.topic_service import get_topic_service
        participants = get_topic_service().get_participants(session_id)
        return jsonify({'participants': participants})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/topics/<session_id>/participants', methods=['POST', 'OPTIONS'])
@app.route('/api/sessions/<session_id>/participants', methods=['POST', 'OPTIONS'])
def add_topic_participant(session_id):
    """添加参与者到 Topic"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from services.topic_service import get_topic_service
        from services.actor import activate_agent
        data = request.json
        participant_id = data.get('participant_id')
        p_type = data.get('participant_type', 'agent')
        role = data.get('role', 'member')

        if not participant_id:
            return jsonify({'error': 'participant_id is required'}), 400

        success = get_topic_service().add_participant(session_id, participant_id, p_type, role)
        if success and p_type == 'agent':
            # 激活该 Agent 的 Actor 并订阅该 Topic
            activate_agent(participant_id, session_id)
            
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/topics/<session_id>/interrupt', methods=['POST', 'OPTIONS'])
@app.route('/api/sessions/<session_id>/interrupt', methods=['POST', 'OPTIONS'])
def interrupt_agent_processing(session_id):
    """中断 Agent 处理 - 前端打断生成"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from services.topic_service import get_topic_service
        data = request.get_json() or {}
        agent_id = data.get('agent_id')
        reason = data.get('reason', 'user_interrupt')
        
        if not agent_id:
            return jsonify({'error': 'agent_id is required'}), 400
        
        success = get_topic_service().publish_interrupt(session_id, agent_id, reason)
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/topics/<session_id>/participants/<participant_id>', methods=['DELETE', 'OPTIONS'])
@app.route('/api/sessions/<session_id>/participants/<participant_id>', methods=['DELETE', 'OPTIONS'])
def remove_topic_participant(session_id, participant_id):
    """从 Topic 移除参与者"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from services.topic_service import get_topic_service
        success = get_topic_service().remove_participant(session_id, participant_id)
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== 会话和消息管理 API ====================

@app.route('/api/topics/<session_id>/stream', methods=['GET', 'OPTIONS'])
@app.route('/api/sessions/<session_id>/stream', methods=['GET', 'OPTIONS'])
def stream_topic_events(session_id):
    """订阅 Topic 事件流 (SSE)"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()

    from database import get_redis_client
    from flask import stream_with_context
    redis_client = get_redis_client()
    if not redis_client:
        return jsonify({'error': 'Redis not available'}), 503
    # 防止“半初始化 Redis client”（init_redis 失败但对象仍存在）导致流式接口直接 500
    try:
        redis_client.ping()
    except Exception as e:
        return jsonify({'error': 'Redis not available', 'detail': str(e)}), 503

    def generate():
        pubsub = redis_client.pubsub()
        channel = f"topic:{session_id}"
        pubsub.subscribe(channel)
        print(f"[Topic Stream] Client subscribed to {channel}")
        
        try:
            # 发送初始连接成功消息，确保连接建立
            yield f"data: {json.dumps({'type': 'connected', 'topic_id': session_id})}\n\n"
            # 心跳：防止 SSE 在中间层（Electron/代理/WSGI）被判定为 idle 而断开
            # 降低心跳间隔到 10 秒，以适应更严格的超时设置
            last_ping = time.time()
            heartbeat_interval = 10  # 秒
            message_count = 0
            
            while True:
                try:
                    message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if message and message.get('type') == 'message':
                        data = message.get('data')
                        if isinstance(data, bytes):
                            data = data.decode('utf-8', errors='ignore')
                        # 确保符合 SSE 格式（只发送 data 行）
                        yield f"data: {data}\n\n"
                        message_count += 1
                        last_ping = time.time()  # 发送消息也算作活动
                    else:
                        # 无消息时定时发送 SSE 注释行作为心跳（客户端会忽略）
                        now = time.time()
                        if now - last_ping >= heartbeat_interval:
                            yield ": ping\n\n"
                            last_ping = now
                except Exception as inner_e:
                    # 处理异常：可能是 Redis 连接错误或其他错误
                    error_type = type(inner_e).__name__
                    error_msg = str(inner_e).lower()
                    is_connection_error = 'connection' in error_type.lower() or 'connection' in error_msg
                    
                    if is_connection_error:
                        print(f"[Topic Stream] Redis connection error for {session_id}: {inner_e}")
                        # 尝试重新订阅
                        try:
                            pubsub.close()
                            pubsub = redis_client.pubsub()
                            pubsub.subscribe(channel)
                            print(f"[Topic Stream] Resubscribed to {channel} after connection error")
                        except Exception as resub_err:
                            print(f"[Topic Stream] Failed to resubscribe: {resub_err}")
                            break
                    else:
                        print(f"[Topic Stream] Inner error for {session_id}: {inner_e}")
                        # 短暂等待后继续
                        time.sleep(0.5)
                    continue
                # 轻微 sleep，避免空转占用 CPU
                time.sleep(0.05)
        except GeneratorExit:
            # 客户端正常断开连接
            print(f"[Topic Stream] Client disconnected normally from {channel} (messages sent: {message_count})")
        except Exception as e:
            print(f"[Topic Stream] Error for {session_id}: {e}")
            import traceback
            traceback.print_exc()
        finally:
            try:
                pubsub.unsubscribe(channel)
                pubsub.close()
            except:
                pass
            print(f"[Topic Stream] Cleanup complete for {channel}")

    resp = Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'  # 禁用 Nginx 缓存
        }
    )
    # SSE 场景下明确附加 CORS 头（某些中间层/错误分支会导致 after_request 未覆盖到）
    try:
        origin = request.headers.get('Origin')
        if origin:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Vary'] = 'Origin'
    except Exception:
        pass
    return resp

def _list_topics_or_sessions():
    """内部：获取 Topic/会话列表（话题，不含智能体）。返回 (sessions_list, total)，MySQL 不可用时返回 (None, 0)。"""
    from database import get_mysql_connection
    conn = get_mysql_connection()
    if not conn:
        return None, 0
    cursor = None
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute("""
            SELECT 
                s.session_id, s.title, s.name, s.llm_config_id, s.avatar, 
                s.system_prompt, s.session_type, s.owner_id, s.ext,
                s.created_at, s.updated_at, s.last_message_at,
                (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) as message_count,
                (SELECT content FROM messages 
                 WHERE session_id = s.session_id AND role = 'user' 
                 ORDER BY created_at ASC LIMIT 1) as first_user_message
            FROM sessions s
            WHERE s.session_type != 'temporary' AND s.session_type NOT LIKE 'agent%'
            ORDER BY COALESCE(s.last_message_at, s.updated_at, s.created_at) DESC
            LIMIT 300
        """)
        rows = cursor.fetchall()
        sessions = []
        for row in rows:
            first_message = row.get('first_user_message', '') or ''
            preview_text = (first_message[:30] + '...') if len(first_message) > 30 else first_message
            ext = row.get('ext')
            if isinstance(ext, str):
                try:
                    ext = json.loads(ext)
                except Exception:
                    ext = {}
            sessions.append({
                'session_id': row['session_id'],
                'title': row['title'],
                'name': row.get('name'),
                'llm_config_id': row['llm_config_id'],
                'avatar': row['avatar'],
                'session_type': row.get('session_type', 'topic_general'),
                'owner_id': row.get('owner_id'),
                'ext': ext,
                'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None,
                'last_message_at': row['last_message_at'].isoformat() if row['last_message_at'] else None,
                'message_count': row['message_count'] or 0,
                'preview_text': preview_text.replace('\n', ' ').strip(),
            })
        return sessions, len(sessions)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route('/api/topics', methods=['GET', 'OPTIONS'])
def list_topics():
    """获取 Topic 列表（与 /api/sessions 一致，供前端 topics 统计与圆桌列表使用）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        sessions, total = _list_topics_or_sessions()
        if sessions is None:
            return jsonify({'sessions': [], 'topics': [], 'total': 0, 'error': 'MySQL not available'}), 503
        return jsonify({'sessions': sessions, 'topics': sessions, 'total': total})
    except Exception as e:
        print(f"[Topic API] Error listing topics: {e}")
        return jsonify({'error': str(e), 'sessions': [], 'topics': [], 'total': 0}), 500


@app.route('/api/sessions', methods=['GET', 'OPTIONS'])
def list_sessions():
    """获取 Topic 列表 (兼容旧 sessions 接口)"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        sessions, total = _list_topics_or_sessions()
        if sessions is None:
            return jsonify({'sessions': [], 'total': 0, 'error': 'MySQL not available'}), 503
        return jsonify({'sessions': sessions, 'total': total})
    except Exception as e:
        print(f"[Topic API] Error listing sessions: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions', methods=['POST', 'OPTIONS'])
def create_session():
    """创建新 Topic"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from services.topic_service import get_topic_service
        data = request.json
        owner_id = get_client_ip() # 暂时用 IP 作为 User ID
        
        # 使用 TopicService 创建
        topic = get_topic_service().create_topic(data, owner_id, creator_ip=owner_id)
        
        return jsonify(topic), 201
                
    except Exception as e:
        print(f"[Topic API] Error creating topic: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/session-type', methods=['PUT', 'OPTIONS'])
def update_session_type(session_id):
    """更新会话类型（用于切换积极模式）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from services.topic_service import get_topic_service
        data = request.json
        new_session_type = data.get('session_type')
        
        if not new_session_type:
            return jsonify({'error': 'session_type is required'}), 400
        
        # 只允许在 topic_general 和 agent 之间切换（积极模式切换）
        # topic_general: 普通模式（需要决策）
        # agent: 积极模式（直接回答）
        if new_session_type not in ('topic_general', 'agent'):
            return jsonify({'error': 'session_type must be topic_general or agent'}), 400
        
        # 使用 TopicService 更新类型
        success = get_topic_service().update_topic_type(session_id, new_session_type)
        
        if success:
            return jsonify({
                'message': 'Session type updated successfully',
                'session_type': new_session_type
            })
        else:
            return jsonify({'error': 'Failed to update session type'}), 500
                
    except Exception as e:
        print(f"[Topic API] Error updating session type: {e}")
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
                    s.name,
                    s.llm_config_id,
                    s.avatar,
                    s.system_prompt,
                    s.ext,
                    s.session_type,
                    s.role_id,
                    s.role_version_id,
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
            
            # 处理 ext 字段
            ext_data = row.get('ext')
            if ext_data and isinstance(ext_data, str):
                try:
                    ext_data = json.loads(ext_data)
                except:
                    ext_data = {}
            elif ext_data is None:
                ext_data = {}

            session = {
                'session_id': row['session_id'],
                'title': row['title'],
                'name': row['name'],
                'llm_config_id': row['llm_config_id'],
                'avatar': row['avatar'],
                'system_prompt': row['system_prompt'],
                'ext': ext_data,
                'session_type': row.get('session_type', 'memory'),  # 会话类型
                'role_id': row.get('role_id'),
                'role_version_id': row.get('role_version_id'),
                'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None,
                'last_message_at': row['last_message_at'].isoformat() if row['last_message_at'] else None,
                'message_count': row['message_count'] or 0,
                'skill_packs': _get_session_skill_packs_list(cursor, session_id)
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

def _cache_messages_to_redis(session_id: str, messages: list):
    """将消息缓存到Redis zset（按message_id排序）"""
    try:
        from database import get_redis_client
        redis_client = get_redis_client()
        if not redis_client:
            return
        
        cache_key = f"messages:session:{session_id}"
        
        # 使用pipeline批量操作，提高性能
        pipe = redis_client.pipeline()
        
        for msg in messages:
            message_id = msg.get('message_id')
            if not message_id:
                continue
            
            # 使用message_id作为score（如果是数字则直接使用，否则使用hash）
            try:
                # 尝试从message_id中提取数字部分作为score
                # message_id格式通常是 "msg-1234567890" 或类似
                score = int(message_id.split('-')[-1]) if '-' in message_id else hash(message_id)
            except (ValueError, AttributeError):
                score = hash(message_id)
            
            # 将消息序列化为JSON存储
            message_json = json.dumps(msg, ensure_ascii=False)
            # Redis zadd: 新版本使用字典，旧版本使用位置参数
            try:
                pipe.zadd(cache_key, {message_json: score})
            except TypeError:
                # 兼容旧版本Redis
                pipe.zadd(cache_key, score, message_json)
        
        # 设置过期时间（7天）
        pipe.expire(cache_key, 7 * 24 * 3600)
        pipe.execute()
        
        print(f"[Message Cache] Cached {len(messages)} messages to Redis for session {session_id}")
    except Exception as e:
        print(f"[Message Cache] Error caching messages to Redis: {e}")

def _load_messages_in_background(session_id: str, page: int, page_size: int, lightweight: bool):
    """后台线程加载消息（低优先级）"""
    def load_task():
        try:
            # 设置线程为低优先级
            import os
            if hasattr(os, 'nice'):
                try:
                    os.nice(10)  # 降低优先级（Linux）
                except:
                    pass
            
            from database import get_mysql_connection
            conn = get_mysql_connection()
            if not conn:
                return
            
            cursor = None
            try:
                cursor = conn.cursor(pymysql.cursors.DictCursor)
                
                # 计算偏移量（跳过前10条）
                offset = 10 + (page - 1) * page_size
                
                # 获取消息
                if lightweight:
                    cursor.execute("""
                        SELECT 
                            message_id,
                            role,
                            content,
                            created_at
                        FROM messages
                        WHERE session_id = %s
                        ORDER BY created_at DESC
                        LIMIT %s OFFSET %s
                    """, (session_id, page_size, offset))
                else:
                    cursor.execute("""
                        SELECT 
                            message_id,
                            session_id,
                            role,
                            content,
                            thinking,
                            tool_calls,
                            token_count,
                            acc_token,
                            ext,
                            mcpdetail,
                            created_at
                        FROM messages
                        WHERE session_id = %s
                        ORDER BY created_at DESC
                        LIMIT %s OFFSET %s
                    """, (session_id, page_size, offset))
                
                messages = []
                for row in cursor.fetchall():
                    if lightweight:
                        message = {
                            'message_id': row['message_id'],
                            'role': row['role'],
                            'content': row['content'],
                            'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                        }
                    else:
                        # 处理完整消息
                        ext_data = None
                        if row.get('ext'):
                            try:
                                ext_data = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
                            except (json.JSONDecodeError, TypeError):
                                pass
                        
                        mcpdetail_data = None
                        if row.get('mcpdetail'):
                            try:
                                mcpdetail_data = json.loads(row['mcpdetail']) if isinstance(row['mcpdetail'], str) else row['mcpdetail']
                            except (json.JSONDecodeError, TypeError):
                                pass
                        
                        message = {
                            'message_id': row['message_id'],
                            'session_id': row['session_id'],
                            'role': row['role'],
                            'content': row['content'],
                            'thinking': row.get('thinking'),
                            'tool_calls': json.loads(row['tool_calls']) if row.get('tool_calls') else None,
                            'token_count': row.get('token_count'),
                            'ext': ext_data,
                            'mcpdetail': mcpdetail_data,
                            'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                        }
                    messages.append(message)
                
                # 缓存到Redis
                if messages:
                    _cache_messages_to_redis(session_id, messages)
                    
            finally:
                if cursor:
                    cursor.close()
                if conn:
                    conn.close()
        except Exception as e:
            print(f"[Message Cache] Error in background load task: {e}")
    
    # 启动低优先级后台线程
    thread = threading.Thread(target=load_task, daemon=True)
    thread.start()

def _process_message_row(row):
    """处理消息数据库行，返回格式化的消息字典"""
    # 解析 ext 字段
    ext_data = None
    if row.get('ext'):
        try:
            ext_data = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
        except (json.JSONDecodeError, TypeError):
            pass
    
    # 解析 mcpdetail 字段
    mcpdetail_data = None
    if row.get('mcpdetail'):
        try:
            mcpdetail_data = json.loads(row['mcpdetail']) if isinstance(row['mcpdetail'], str) else row['mcpdetail']
        except (json.JSONDecodeError, TypeError):
            pass
    
    return {
        'message_id': row['message_id'],
        'session_id': row.get('session_id'),
        'role': row['role'],
        'content': row['content'],
        'thinking': row.get('thinking'),
        'tool_calls': json.loads(row['tool_calls']) if row.get('tool_calls') else None,
        'token_count': row.get('token_count'),
        'ext': ext_data,
        'mcpdetail': mcpdetail_data,
        'created_at': row['created_at'].isoformat() if row['created_at'] else None,
    }


@app.route('/api/sessions/<session_id>/messages', methods=['GET', 'OPTIONS'])
def get_session_messages(session_id):
    """获取会话消息（分页）- 支持游标分页和传统分页两种模式"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection, get_redis_client
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'messages': [], 'total': 0, 'error': 'MySQL not available'}), 503
        
        # 游标分页参数（优先使用，更高效）
        before_id = request.args.get('before_id')  # 获取此消息之前的消息
        limit_param = request.args.get('limit')  # 如果有 limit 参数，使用游标分页模式
        limit = int(limit_param) if limit_param else 20
        
        # 传统分页参数（向后兼容）
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 20))
        
        # 轻量级模式：只返回必要字段，用于快速加载
        lightweight = request.args.get('lightweight', 'false').lower() == 'true'
        
        # 判断使用哪种分页模式：有 limit 参数或 before_id 参数时使用游标分页
        use_cursor_pagination = limit_param is not None or before_id is not None
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # ========== 游标分页模式（高效） ==========
            if use_cursor_pagination:
                if before_id:
                    # 有 before_id：获取该消息之前的消息
                    cursor.execute(
                        "SELECT created_at FROM messages WHERE message_id = %s",
                        (before_id,)
                    )
                    before_row = cursor.fetchone()
                    if not before_row:
                        return jsonify({'messages': [], 'has_more': False, 'next_cursor': None, 'error': 'before_id not found'}), 404
                    
                    before_time = before_row['created_at']
                    
                    # 获取 created_at < before_time 的消息
                    if lightweight:
                        cursor.execute("""
                            SELECT message_id, role, content, created_at
                            FROM messages
                            WHERE session_id = %s AND created_at < %s
                            ORDER BY created_at DESC
                            LIMIT %s
                        """, (session_id, before_time, limit + 1))
                    else:
                        cursor.execute("""
                            SELECT message_id, session_id, role, content, thinking, 
                                   tool_calls, token_count, acc_token, ext, mcpdetail, created_at
                            FROM messages
                            WHERE session_id = %s AND created_at < %s
                            ORDER BY created_at DESC
                            LIMIT %s
                        """, (session_id, before_time, limit + 1))
                else:
                    # 没有 before_id：获取最新的消息
                    if lightweight:
                        cursor.execute("""
                            SELECT message_id, role, content, created_at
                            FROM messages
                            WHERE session_id = %s
                            ORDER BY created_at DESC
                            LIMIT %s
                        """, (session_id, limit + 1))
                    else:
                        cursor.execute("""
                            SELECT message_id, session_id, role, content, thinking, 
                                   tool_calls, token_count, acc_token, ext, mcpdetail, created_at
                            FROM messages
                            WHERE session_id = %s
                            ORDER BY created_at DESC
                            LIMIT %s
                        """, (session_id, limit + 1))
                
                rows = cursor.fetchall()
                has_more = len(rows) > limit
                if has_more:
                    rows = rows[:limit]
                
                # 处理消息
                messages = []
                for row in rows:
                    if lightweight:
                        messages.append({
                            'message_id': row['message_id'],
                            'role': row['role'],
                            'content': row['content'],
                            'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                        })
                    else:
                        messages.append(_process_message_row(row))
                
                # 反转顺序，使最旧的在前（用于前端显示）
                messages.reverse()
                
                return jsonify({
                    'messages': messages,
                    'has_more': has_more,
                    'next_cursor': messages[0]['message_id'] if messages and has_more else None,
                })
            
            # ========== 传统分页模式（向后兼容） ==========
            # 获取总数
            cursor.execute("SELECT COUNT(*) as total FROM messages WHERE session_id = %s", (session_id,))
            total = cursor.fetchone()['total']
            
            # 第一页：只返回前10条，其他后台加载到Redis
            if page == 1:
                immediate_limit = 10
                offset = 0
            else:
                immediate_limit = page_size
                offset = (page - 1) * page_size
            
            # 获取消息（按时间倒序，最新的在前）
            if lightweight:
                cursor.execute("""
                    SELECT 
                        message_id,
                        role,
                        content,
                        created_at
                    FROM messages
                    WHERE session_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """, (session_id, immediate_limit, offset))
            else:
                cursor.execute("""
                    SELECT 
                        message_id,
                        session_id,
                        role,
                        content,
                        thinking,
                        tool_calls,
                        token_count,
                        acc_token,
                        ext,
                        mcpdetail,
                        created_at
                    FROM messages
                    WHERE session_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                    """, (session_id, immediate_limit, offset))
            
            messages = []
            invalid_message_ids = []
            for row in cursor.fetchall():
                # 轻量级模式：只返回基本字段
                if lightweight:
                    message = {
                        'message_id': row['message_id'],
                        'role': row['role'],
                        'content': row['content'],
                        'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                    }
                    messages.append(message)
                    continue
                
                # 完整模式：处理所有字段
                # 过滤掉无效的感知组件消息（pending状态且没有content的workflow消息）
                if row['role'] == 'tool':
                    if not row['content'] or row['content'].strip() == '' or row['content'] == '[]':
                        if row.get('tool_calls'):
                            try:
                                tool_calls = json.loads(row['tool_calls']) if isinstance(row['tool_calls'], str) else row['tool_calls']
                                if isinstance(tool_calls, dict) and tool_calls.get('workflowStatus') == 'pending':
                                    invalid_message_ids.append(row['message_id'])
                                    continue  # 跳过这个无效消息
                            except (json.JSONDecodeError, TypeError):
                                pass
                
                # 解析 ext 字段
                ext_data = None
                if row.get('ext'):
                    try:
                        ext_data = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                # 解析 mcpdetail 字段
                mcpdetail_data = None
                if row.get('mcpdetail'):
                    try:
                        mcpdetail_data = json.loads(row['mcpdetail']) if isinstance(row['mcpdetail'], str) else row['mcpdetail']
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                message = {
                    'message_id': row['message_id'],
                    'session_id': row['session_id'],
                    'role': row['role'],
                    'content': row['content'],
                    'thinking': row.get('thinking'),
                    'tool_calls': json.loads(row['tool_calls']) if row.get('tool_calls') else None,
                    'token_count': row.get('token_count'),
                    'ext': ext_data,  # 扩展数据（如 Gemini 的 thoughtSignature）
                    'mcpdetail': mcpdetail_data,  # MCP 执行详情
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
            
            # 第一页：启动后台线程加载剩余消息到Redis
            if page == 1 and total > immediate_limit:
                _load_messages_in_background(session_id, 1, page_size, lightweight)
            
            return jsonify({
                'messages': messages,
                'total': total,
                'page': page,
                'page_size': page_size,
                'total_pages': (total + page_size - 1) // page_size,
                'has_more_in_cache': page == 1 and total > immediate_limit  # 提示前端有更多消息在后台加载
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


# ==================== 媒体库 API ====================

@app.route('/api/media-library/items', methods=['GET', 'OPTIONS'])
def get_media_library_items():
    """媒体库：聚合多个会话的媒体条目（使用 Redis 缓存 7 天）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()

    try:
        session_ids_raw = request.args.get('session_ids', '') or ''
        session_ids = [s.strip() for s in session_ids_raw.split(',') if s.strip()]
        if not session_ids:
            return jsonify({'items': [], 'has_more': False, 'next_cursor': None}), 200

        limit = int(request.args.get('limit', 200))
        limit = max(1, min(500, limit))
        before_ts = request.args.get('before_ts')
        order = (request.args.get('order') or 'desc').lower()
        order_desc = order != 'asc'

        before_ts_f = float(before_ts) if before_ts else None

        from services.media_library_service import get_media_library_service
        svc = get_media_library_service()

        merged = []
        for sid in session_ids:
            merged.extend(svc.get_session_media_items(sid))

        # 仅图片（当前媒体库先聚焦图片；后续可扩展视频/音频）
        media_type = (request.args.get('type') or 'image').lower()
        if media_type in ('image', 'video', 'audio'):
            merged = [x for x in merged if x.get('type') == media_type]

        # 时间过滤（游标）
        if before_ts_f is not None:
            merged = [x for x in merged if float(x.get('created_at_ts') or 0.0) < before_ts_f]

        merged.sort(key=lambda x: float(x.get('created_at_ts') or 0.0), reverse=order_desc)

        has_more = len(merged) > limit
        page = merged[:limit]
        next_cursor = None
        if has_more and page:
            next_cursor = page[-1].get('created_at_ts')

        return jsonify({'items': page, 'has_more': has_more, 'next_cursor': next_cursor}), 200

    except Exception as e:
        print(f"[MediaLibrary API] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'items': [], 'has_more': False, 'next_cursor': None}), 500

@app.route('/api/messages/<message_id>', methods=['GET', 'OPTIONS'])
def get_message(message_id):
    """获取单个消息（基于message_id），用于增量加载"""
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
            
            # 获取消息
            cursor.execute("""
                SELECT 
                    message_id,
                    session_id,
                    role,
                    content,
                    thinking,
                    tool_calls,
                    token_count,
                    acc_token,
                    ext,
                    mcpdetail,
                    created_at
                FROM messages
                WHERE message_id = %s
            """, (message_id,))
            
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Message not found'}), 404
            
            # 解析 ext 字段
            ext_data = None
            if row.get('ext'):
                try:
                    ext_data = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
                except (json.JSONDecodeError, TypeError):
                    pass
            
            # 解析 mcpdetail 字段
            mcpdetail_data = None
            if row.get('mcpdetail'):
                try:
                    mcpdetail_data = json.loads(row['mcpdetail']) if isinstance(row['mcpdetail'], str) else row['mcpdetail']
                except (json.JSONDecodeError, TypeError):
                    pass
            
            message = {
                'message_id': row['message_id'],
                'session_id': row['session_id'],
                'role': row['role'],
                'content': row['content'],
                'thinking': row.get('thinking'),
                'tool_calls': json.loads(row['tool_calls']) if row.get('tool_calls') else None,
                'token_count': row.get('token_count'),
                'ext': ext_data,
                'mcpdetail': mcpdetail_data,
                'created_at': row['created_at'].isoformat() if row['created_at'] else None,
            }
            
            return jsonify(message)
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error getting message: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def recalculate_acc_tokens_after_message(session_id: str, after_message_id: str, cursor):
    """
    重新计算指定消息之后所有消息的累积 token
    
    Args:
        session_id: 会话ID
        after_message_id: 基准消息ID（该消息之后的消息需要重新计算）
        cursor: 数据库游标
    """
    try:
        from token_counter import estimate_tokens
        
        # 获取基准消息的累积 token
        cursor.execute("""
            SELECT COALESCE(acc_token, token_count, 0) as acc_token, created_at
            FROM messages 
            WHERE session_id = %s AND message_id = %s
        """, (session_id, after_message_id))
        
        base_row = cursor.fetchone()
        if not base_row:
            return
        
        base_acc_token = base_row['acc_token'] or 0
        base_created_at = base_row['created_at']
        
        # 获取基准消息之后的所有消息
        cursor.execute("""
            SELECT message_id, role, content, thinking, model, created_at
            FROM messages 
            WHERE session_id = %s 
            AND created_at > %s
            ORDER BY created_at ASC
        """, (session_id, base_created_at))
        
        subsequent_messages = cursor.fetchall()
        
        # 重新计算每条消息的累积 token
        current_acc_token = base_acc_token
        for msg in subsequent_messages:
            # 估算当前消息的 token
            msg_model = msg.get('model') or 'gpt-4'
            msg_tokens = estimate_tokens(msg['content'] or '', msg_model)
            if msg.get('thinking'):
                msg_tokens += estimate_tokens(msg['thinking'], msg_model)
            
            # 更新累积 token
            current_acc_token += msg_tokens
            
            # 更新数据库
            cursor.execute("""
                UPDATE messages 
                SET acc_token = %s, token_count = %s
                WHERE message_id = %s
            """, (current_acc_token, msg_tokens, msg['message_id']))
        
    except Exception as e:
        print(f"[Recalculate Acc Tokens] Error: {e}")
        import traceback
        traceback.print_exc()

@app.route('/api/topics/<session_id>/messages', methods=['POST', 'OPTIONS'])
@app.route('/api/sessions/<session_id>/messages', methods=['POST', 'OPTIONS'])
def save_message(session_id):
    """保存消息并触发 Topic 通知 (统一 Topic 接口)"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from services.topic_service import get_topic_service
        data = request.json
        sender_id = data.get('sender_id') or get_client_ip()
        sender_type = data.get('sender_type', 'user')
        role = data.get('role', 'user')
        content = data.get('content', '')
        mentions = data.get('mentions', [])
        ext = data.get('ext', {})
        
        # 使用 TopicService 发送消息
        # 内部会处理数据库持久化和 Redis Pub/Sub 发布
        msg = get_topic_service().send_message(
            topic_id=session_id,
            sender_id=sender_id,
            sender_type=sender_type,
            content=content,
            role=role,
            mentions=mentions,
            ext=ext,
            message_id=data.get('message_id')
        )

        # 媒体库缓存增量更新已在 TopicService.send_message 内统一处理（包含 AgentActor 直连场景）
        
        if msg:
            # 确保智能体处于激活状态 (Actor 模型)，并直接处理触发消息
            # - topic_general：激活话题中的所有 Agent 参与者
            # - agent：激活私聊的单个 Agent（session_id 就是 agent_id）
            try:
                from database import get_mysql_connection
                conn = get_mysql_connection()
                if conn:
                    import pymysql
                    cursor = conn.cursor(pymysql.cursors.DictCursor)
                    cursor.execute("SELECT session_type FROM sessions WHERE session_id = %s", (session_id,))
                    session_row = cursor.fetchone()
                    cursor.close()
                    conn.close()
                    
                    session_type = session_row.get('session_type') if session_row else None
                    
                    # 构建触发消息数据（用于 AgentActor 直接处理）
                    trigger_message = {
                        'message_id': msg.get('message_id'),
                        'sender_id': msg.get('sender_id'),
                        'sender_type': msg.get('sender_type'),
                        'content': msg.get('content'),
                        'role': msg.get('role'),
                        'mentions': msg.get('mentions'),
                        'ext': msg.get('ext'),
                        'timestamp': msg.get('timestamp'),
                        'model': data.get('model'),  # 传递用户选择的模型
                    }
                    
                    if session_type == 'topic_general':
                        # topic_general：激活话题中的所有 Agent 参与者，并传入触发消息
                        from services.actor import activate_agent
                        participants = get_topic_service().get_participants(session_id)
                        for p in participants:
                            if p.get('participant_type') == 'agent':
                                activate_agent(p['participant_id'], session_id, trigger_message)
                    elif session_type == 'agent':
                        # agent 私聊：只激活该 Agent，并传入触发消息
                        from services.actor import activate_agent
                        activate_agent(session_id, session_id, trigger_message)
            except Exception as e:
                print(f"[Message API] Warning: Failed to auto-activate agents: {e}")

            return jsonify(msg), 201
        else:
            return jsonify({'error': 'Failed to save message'}), 500
                
    except Exception as e:
        print(f"[Message API] Error saving message: {e}")
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
            
            # 媒体库缓存增量更新：移除被删除消息关联的媒体条目（不做 delete 全缓存）
            try:
                from services.media_library_service import get_media_library_service
                svc = get_media_library_service()
                svc.remove_message_media(session_id=session_id, message_id=message_id)
                for mid in invalid_messages:
                    svc.remove_message_media(session_id=session_id, message_id=mid)
            except Exception as e:
                print(f"[Session API] Warning: Failed to update media cache incrementally: {e}")

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

# ==================== Research Sources / Retrieval API ====================

def _research_safe_relpath(name: str) -> str:
    """Allow client to pass webkitRelativePath as filename; prevent path traversal."""
    import re
    # Normalize slashes
    name = (name or '').replace('\\', '/')
    # Remove drive letters and leading slashes
    name = re.sub(r'^[a-zA-Z]:', '', name).lstrip('/')
    # Drop .. segments
    parts = [p for p in name.split('/') if p and p not in ('.', '..')]
    safe = '/'.join(parts)
    # Fallback
    return safe or f'file-{int(time.time() * 1000)}'

def _unique_source_title(cursor, session_id: str, base_title: str) -> str:
    """Make source title unique within a session (for $alias reference)."""
    base = (base_title or '').strip() or f'source-{int(time.time()*1000)}'
    title = base
    i = 2
    while True:
        cursor.execute("""
            SELECT 1 FROM research_sources WHERE session_id=%s AND title=%s LIMIT 1
        """, (session_id, title))
        if not cursor.fetchone():
            return title
        title = f"{base}-{i}"
        i += 1

def _is_text_mime(mime: str) -> bool:
    if not mime:
        return False
    mime = mime.lower()
    return mime.startswith('text/') or mime in (
        'application/json',
        'application/xml',
        'application/x-yaml',
        'application/yaml',
        'application/javascript',
    )

@app.route('/api/research/sources/url', methods=['POST', 'OPTIONS'])
def research_add_url_source():
    """添加 URL 来源记录（仅登记，不自动抓取）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        data = request.json or {}
        session_id = data.get('session_id')
        url = data.get('url')
        title = data.get('title') or url
        if not session_id or not url:
            return jsonify({'error': 'session_id and url are required'}), 400

        source_id = data.get('source_id') or f"rs-{int(time.time() * 1000)}"
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                INSERT INTO research_sources (source_id, session_id, source_type, title, url, meta)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                source_id,
                session_id,
                'url',
                title,
                url,
                json.dumps({'added_by': 'user'}, ensure_ascii=False),
            ))
            conn.commit()
            return jsonify({'source_id': source_id, 'session_id': session_id, 'source_type': 'url', 'title': title, 'url': url}), 201
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[Research API] Error adding url source: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/research/sources/upload', methods=['POST', 'OPTIONS'])
def research_upload_sources():
    """
    上传文件/图片/目录（通过 webkitdirectory 上传时 filename 带相对路径），并将可文本化的内容写入 research_documents。
    """
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({'error': 'session_id is required'}), 400

        upload_kind = request.form.get('upload_kind') or 'files'  # files|dir
        dir_alias = request.form.get('dir_alias')  # optional human alias for directory

        files = request.files.getlist('files')
        if not files:
            return jsonify({'error': 'files are required'}), 400

        import mimetypes
        from pathlib import Path

        base_dir = Path(__file__).resolve().parent / 'uploads' / 'research' / session_id
        base_dir.mkdir(parents=True, exist_ok=True)

        created_sources = []
        created_docs = 0

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)

            # If uploading a directory, create ONE dir source (alias) and index docs under it.
            dir_source_id = None
            dir_title = None
            if upload_kind == 'dir':
                dir_source_id = f"rs-dir-{int(time.time() * 1000)}"
                dir_title = _unique_source_title(cursor, session_id, dir_alias or f"dir-{int(time.time()*1000)}")
                cursor.execute("""
                    INSERT INTO research_sources (source_id, session_id, source_type, title, file_path, mime_type, meta)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    dir_source_id,
                    session_id,
                    'dir',
                    dir_title,
                    str(base_dir),
                    None,
                    json.dumps({'kind': 'dir', 'alias': dir_title}, ensure_ascii=False),
                ))
                created_sources.append({
                    'source_id': dir_source_id,
                    'session_id': session_id,
                    'source_type': 'dir',
                    'title': dir_title,
                    'file_path': str(base_dir),
                })

            for f in files:
                rel = _research_safe_relpath(f.filename)
                target_path = (base_dir / rel).resolve()
                # Ensure under base_dir
                if str(target_path).startswith(str(base_dir.resolve())) is False:
                    continue
                target_path.parent.mkdir(parents=True, exist_ok=True)

                # Save file
                f.save(str(target_path))

                guessed_mime, _ = mimetypes.guess_type(str(target_path))
                mime = f.mimetype or guessed_mime or 'application/octet-stream'

                # For directory upload, do NOT create per-file source records.
                # For normal file upload, create per-file sources as before.
                source_id_for_doc = None
                if upload_kind == 'dir' and dir_source_id:
                    source_id_for_doc = dir_source_id
                else:
                    source_type = 'image' if mime.lower().startswith('image/') else 'file'
                    source_id = f"rs-{int(time.time() * 1000)}-{created_docs}"
                    title = _unique_source_title(cursor, session_id, rel)
                    cursor.execute("""
                        INSERT INTO research_sources (source_id, session_id, source_type, title, file_path, mime_type, meta)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        source_id,
                        session_id,
                        source_type,
                        title,
                        str(target_path),
                        mime,
                        json.dumps({'rel_path': rel}, ensure_ascii=False),
                    ))
                    created_sources.append({
                        'source_id': source_id,
                        'session_id': session_id,
                        'source_type': source_type,
                        'title': title,
                        'file_path': str(target_path),
                        'mime_type': mime,
                    })
                    source_id_for_doc = source_id

                # Index text-like files
                if _is_text_mime(mime):
                    try:
                        # Limit size to 2MB per file to avoid huge DB writes
                        size = target_path.stat().st_size
                        if size <= 2 * 1024 * 1024:
                            content_text = target_path.read_text(encoding='utf-8', errors='ignore')
                            doc_id = f"rd-{int(time.time() * 1000)}-{created_docs}"
                            cursor.execute("""
                                INSERT INTO research_documents (doc_id, session_id, source_id, rel_path, content_text)
                                VALUES (%s, %s, %s, %s, %s)
                            """, (doc_id, session_id, source_id_for_doc, rel, content_text))
                            created_docs += 1
                    except Exception as ie:
                        print(f"[Research API] Index text failed: {ie}")

            conn.commit()
            return jsonify({'sources': created_sources, 'indexed_documents': created_docs}), 201
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except RequestEntityTooLarge as e:
        # 解析 multipart 前就会触发；不要转 500
        limit = app.config.get('MAX_CONTENT_LENGTH')
        return jsonify({
            'error': 'RequestEntityTooLarge',
            'message': 'Upload too large. Please reduce file count/size, or increase research.upload_max_mb in backend/config.yaml.',
            'max_bytes': limit,
        }), 413
    except Exception as e:
        print(f"[Research API] Error uploading sources: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/research/sources', methods=['GET', 'OPTIONS'])
def research_list_sources():
    """列出指定 Research 会话的 sources"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        session_id = request.args.get('session_id')
        if not session_id:
            return jsonify({'error': 'session_id is required'}), 400

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT source_id, session_id, source_type, title, url, file_path, mime_type, meta, created_at
                FROM research_sources
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT 500
            """, (session_id,))
            rows = cursor.fetchall()
            for r in rows:
                try:
                    if r.get('meta') and isinstance(r['meta'], str):
                        r['meta'] = json.loads(r['meta'])
                except Exception:
                    pass
                if r.get('created_at'):
                    r['created_at'] = r['created_at'].isoformat()
            return jsonify({'sources': rows}), 200
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[Research API] Error listing sources: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/research/sources/file', methods=['GET', 'OPTIONS'])
def research_get_source_file():
    """下载/预览某个 source 对应的文件内容（用于图片缩略图等）。"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        session_id = request.args.get('session_id')
        source_id = request.args.get('source_id')
        if not session_id or not source_id:
            return jsonify({'error': 'session_id and source_id are required'}), 400

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT source_id, session_id, source_type, title, file_path, mime_type
                FROM research_sources
                WHERE session_id=%s AND source_id=%s
                LIMIT 1
            """, (session_id, source_id))
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'source not found'}), 404
            file_path = row.get('file_path')
            if not file_path:
                return jsonify({'error': 'source has no file_path'}), 400

            # Security: ensure file under backend/uploads/research/<session_id>/
            try:
                base_dir = (Path(__file__).resolve().parent / 'uploads' / 'research' / session_id).resolve()
                target = Path(file_path).resolve()
                if base_dir not in target.parents and target != base_dir:
                    return jsonify({'error': 'invalid file path'}), 403
                if not target.exists() or not target.is_file():
                    return jsonify({'error': 'file not found on server'}), 404
            except Exception:
                return jsonify({'error': 'invalid file path'}), 403

            mime = row.get('mime_type') or 'application/octet-stream'
            # inline preview (no attachment) so <img src> works
            return send_file(str(target), mimetype=mime, as_attachment=False, download_name=row.get('title') or target.name)
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[Research API] Error get source file: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/research/retrieve', methods=['POST', 'OPTIONS'])
def research_retrieve():
    """基于 MySQL FULLTEXT 检索 research_documents"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        data = request.json or {}
        session_id = data.get('session_id')
        query = data.get('query')
        limit = int(data.get('limit', 8))
        if not session_id or not query:
            return jsonify({'error': 'session_id and query are required'}), 400

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT
                    doc_id,
                    source_id,
                    rel_path,
                    MATCH(content_text, rel_path) AGAINST (%s IN NATURAL LANGUAGE MODE) AS score,
                    LEFT(content_text, 800) AS snippet
                FROM research_documents
                WHERE session_id = %s
                  AND MATCH(content_text, rel_path) AGAINST (%s IN NATURAL LANGUAGE MODE)
                ORDER BY score DESC
                LIMIT %s
            """, (query, session_id, query, limit))
            rows = cursor.fetchall()
            return jsonify({'results': rows}), 200
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[Research API] Error retrieve: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/research/sources/resolve', methods=['POST', 'OPTIONS'])
def research_resolve_sources():
    """Resolve $alias references into structured info (url/snippet/dir stats)."""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        data = request.json or {}
        session_id = data.get('session_id')
        tokens = data.get('tokens') or []
        if not session_id or not isinstance(tokens, list) or len(tokens) == 0:
            return jsonify({'error': 'session_id and tokens[] are required'}), 400

        tokens = [str(t) for t in tokens if str(t).strip()]
        if not tokens:
            return jsonify({'resolved': []}), 200

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT source_id, session_id, source_type, title, url, file_path, mime_type, meta, created_at
                FROM research_sources
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT 2000
            """, (session_id,))
            sources = cursor.fetchall() or []
            for s in sources:
                try:
                    if s.get('meta') and isinstance(s['meta'], str):
                        s['meta'] = json.loads(s['meta'])
                except Exception:
                    s['meta'] = None
                if s.get('created_at'):
                    s['created_at'] = s['created_at'].isoformat()

            def find_source(tok: str):
                # exact match by source_id
                for s in sources:
                    if s.get('source_id') == tok:
                        return s
                # exact match by title (alias)
                for s in sources:
                    if (s.get('title') or '') == tok:
                        return s
                # exact match by url
                for s in sources:
                    if (s.get('url') or '') == tok:
                        return s
                # fallback: prefix match title
                for s in sources:
                    if (s.get('title') or '').startswith(tok):
                        return s
                return None

            resolved = []
            for tok in tokens:
                s = find_source(tok)
                if not s:
                    resolved.append({'token': tok, 'found': False})
                    continue
                item = {'token': tok, 'found': True, 'source': s}

                if s.get('source_type') == 'url':
                    item['url'] = s.get('url')
                elif s.get('source_type') == 'dir':
                    cursor.execute("""
                        SELECT COUNT(*) AS total
                        FROM research_documents
                        WHERE session_id=%s AND source_id=%s
                    """, (session_id, s.get('source_id')))
                    total = cursor.fetchone().get('total', 0)
                    cursor.execute("""
                        SELECT rel_path
                        FROM research_documents
                        WHERE session_id=%s AND source_id=%s
                        ORDER BY created_at DESC
                        LIMIT 30
                    """, (session_id, s.get('source_id')))
                    paths = [r.get('rel_path') for r in cursor.fetchall() or [] if r.get('rel_path')]
                    item['dir'] = {'doc_count': total, 'sample_paths': paths}
                else:
                    # file/image: try return snippet if indexed
                    cursor.execute("""
                        SELECT LEFT(content_text, 2500) AS snippet, rel_path
                        FROM research_documents
                        WHERE session_id=%s AND source_id=%s
                        ORDER BY created_at DESC
                        LIMIT 1
                    """, (session_id, s.get('source_id')))
                    row = cursor.fetchone()
                    if row and row.get('snippet'):
                        item['snippet'] = row.get('snippet')
                        item['rel_path'] = row.get('rel_path')

                resolved.append(item)

            return jsonify({'resolved': resolved}), 200
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[Research API] Error resolve sources: {e}")
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
        
        # 记录模型的最大 token 限制（用于日志和验证）
        max_tokens = get_model_max_tokens(model)
        # 使用 token_counter 模块的 logger
        from token_counter import logger as token_logger
        token_logger.info(f"[Summarize] Processing summarize request for model '{model}' (max_tokens: {max_tokens})")
        
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
                
                elif provider == 'gemini':
                    # Gemini API
                    default_url = 'https://generativelanguage.googleapis.com/v1beta'
                    base_url = api_url or default_url
                    model_name = model_name or 'gemini-2.5-flash'
                    
                    # 构建完整的 API URL
                    if base_url.endswith('/'):
                        url = f"{base_url}models/{model_name}:generateContent"
                    else:
                        url = f"{base_url}/models/{model_name}:generateContent"
                    
                    # 转换消息格式为 Gemini 格式
                    contents = []
                    for msg in llm_messages:
                        if msg['role'] == 'system':
                            # system 消息作为 systemInstruction
                            continue
                        elif msg['role'] == 'user':
                            contents.append({
                                'role': 'user',
                                'parts': [{'text': msg['content']}]
                            })
                        elif msg['role'] == 'assistant':
                            contents.append({
                                'role': 'model',
                                'parts': [{'text': msg['content']}]
                            })
                    
                    # 提取 system 消息
                    system_msg = next((m['content'] for m in llm_messages if m['role'] == 'system'), None)
                    
                    payload = {
                        'contents': contents,
                        'generationConfig': {
                            'temperature': 1.0,
                            'thinkingLevel': 'high',
                        },
                    }
                    
                    # 添加 systemInstruction（如果存在）
                    if system_msg:
                        payload['systemInstruction'] = {
                            'parts': [{'text': system_msg}]
                        }
                    
                    # 如果有 metadata 中的 thinking_level，使用它
                    if llm_config.get('metadata') and llm_config['metadata'].get('thinking_level'):
                        payload['generationConfig']['thinkingLevel'] = llm_config['metadata']['thinking_level']
                    
                    response = requests.post(
                        url,
                        headers={
                            'Content-Type': 'application/json',
                            'x-goog-api-key': api_key,
                        },
                        json=payload,
                        timeout=60
                    )
                    
                    if response.ok:
                        result = response.json()
                        if result.get('candidates') and len(result['candidates']) > 0:
                            candidate = result['candidates'][0]
                            if candidate.get('content') and candidate['content'].get('parts'):
                                # 提取所有文本内容
                                text_parts = [part.get('text', '') for part in candidate['content']['parts'] if part.get('text')]
                                summary_content = ''.join(text_parts)
                            else:
                                summary_content = f"[自动总结] 已精简 {len(messages_to_summarize)} 条消息的关键信息"
                        else:
                            summary_content = f"[自动总结] 已精简 {len(messages_to_summarize)} 条消息的关键信息"
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
            
            # 计算总结前后的 token（使用累积 token）
            # 获取被总结的第一条消息之前的累积 token
            first_summarized_msg_id = messages_to_summarize[0].get('message_id') if messages_to_summarize else None
            token_count_before_acc = 0
            if first_summarized_msg_id:
                cursor.execute("""
                    SELECT COALESCE(acc_token, token_count, 0) as acc_token
                    FROM messages 
                    WHERE session_id = %s AND message_id = %s
                """, (session_id, first_summarized_msg_id))
                first_msg_row = cursor.fetchone()
                if first_msg_row:
                    # 获取第一条被总结消息之前的累积 token
                    cursor.execute("""
                        SELECT COALESCE(acc_token, token_count, 0) as prev_acc_token
                        FROM messages 
                        WHERE session_id = %s 
                        AND created_at < (SELECT created_at FROM messages WHERE message_id = %s)
                        ORDER BY created_at DESC 
                        LIMIT 1
                    """, (session_id, first_summarized_msg_id))
                    prev_row = cursor.fetchone()
                    if prev_row:
                        token_count_before_acc = prev_row['prev_acc_token'] or 0
            
            # 计算被总结消息的总 token（累积值）
            last_summarized_msg_id = messages_to_summarize[-1].get('message_id') if messages_to_summarize else None
            token_count_before = 0
            if last_summarized_msg_id:
                cursor.execute("""
                    SELECT COALESCE(acc_token, token_count, 0) as acc_token
                    FROM messages 
                    WHERE session_id = %s AND message_id = %s
                """, (session_id, last_summarized_msg_id))
                last_msg_row = cursor.fetchone()
                if last_msg_row:
                    token_count_before = last_msg_row['acc_token'] or 0
            
            token_count_after = estimated_tokens
            
            cursor.execute("""
                INSERT INTO summaries (summary_id, session_id, summary_content, last_message_id, token_count_before, token_count_after)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (summary_id, session_id, summary_content, last_message_id, token_count_before, token_count_after))
            
            # 总结消息会在 processSummarize 中保存，这里不需要处理
            # 但需要记录总结前的累积 token，用于后续重新计算 acc_token
            
            # 缓存总结结果
            if redis_conn and cache_key:
                summary_data = {
                    'summary_id': summary_id,
                    'summary_content': summary_content,
                    'token_count_before': token_count_before,
                    'token_count_after': token_count_after,
                    'token_count_before_acc': token_count_before_acc,  # 保存总结前的累积 token
                }
                redis_conn.setex(cache_key, 3600, json.dumps(summary_data))  # 缓存1小时
            
            conn.commit()
            
            # 总结消息会在 processSummarize 中保存，这里需要：
            # 1. 保存总结消息时，设置正确的 acc_token（总结前的累积 token + 总结消息的 token）
            # 2. 重新计算总结后所有消息的 acc_token
            
            # 注意：总结消息的保存在前端的 processSummarize 中完成
            # 这里只返回总结信息，前端会调用 saveMessage 保存总结消息
            
            return jsonify({
                'summary_id': summary_id,
                'summary_content': summary_content,
                'token_count_before': token_count_before,
                'token_count_after': token_count_after,
                'token_count_before_acc': token_count_before_acc,  # 返回总结前的累积 token，用于设置总结消息的 acc_token
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

@app.route('/api/sessions/<session_id>/name', methods=['PUT', 'OPTIONS'])
def update_session_name(session_id):
    """更新会话的用户自定义名称"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        data = request.get_json()
        name = data.get('name', '').strip() if data else ''
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)

            cursor.execute(
                "SELECT session_type FROM sessions WHERE session_id = %s",
                (session_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Session not found'}), 404
            session_type = row.get('session_type') or 'memory'
            
            # 更新会话名称（允许设置为空字符串）
            cursor.execute("""
                UPDATE sessions 
                SET name = %s, updated_at = NOW()
                WHERE session_id = %s
            """, (name if name else None, session_id))
            
            conn.commit()
            # 如果是角色（agent），则沉淀一个新版本
            if session_type == 'agent':
                try:
                    _create_role_version(conn, session_id, {'reason': 'name_update'})
                except Exception as e:
                    print(f"[RoleVersion] Failed to create version on name update: {e}")
            return jsonify({'success': True, 'name': name or None})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error updating session name: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/avatar', methods=['PUT', 'OPTIONS'])
def update_session_avatar(session_id):
    """更新会话的机器人头像"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        avatar = data.get('avatar')  # base64编码的头像字符串
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 检查会话是否存在
            cursor.execute(
                "SELECT session_id, session_type FROM sessions WHERE session_id = %s",
                (session_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Session not found'}), 404
            session_type = row.get('session_type') or 'memory'
            
            # 更新头像
            cursor.execute("""
                UPDATE sessions 
                SET avatar = %s, updated_at = NOW()
                WHERE session_id = %s
            """, (avatar, session_id))
            conn.commit()

            # 如果是角色（agent），则沉淀一个新版本
            if session_type == 'agent':
                try:
                    _create_role_version(conn, session_id, {'reason': 'avatar_update'})
                except Exception as e:
                    print(f"[RoleVersion] Failed to create version on avatar update: {e}")
            
            return jsonify({
                'session_id': session_id,
                'message': 'Avatar updated successfully'
            }), 200
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error updating avatar: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/system-prompt', methods=['PUT', 'OPTIONS'])
def update_session_system_prompt(session_id):
    """更新会话的系统提示词（人设）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        system_prompt = data.get('system_prompt')  # 系统提示词文本
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 检查会话是否存在
            cursor.execute(
                "SELECT session_id, session_type FROM sessions WHERE session_id = %s",
                (session_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Session not found'}), 404
            session_type = row.get('session_type') or 'memory'
            
            # 更新系统提示词
            cursor.execute("""
                UPDATE sessions 
                SET system_prompt = %s, updated_at = NOW()
                WHERE session_id = %s
            """, (system_prompt, session_id))
            conn.commit()

            # 如果是角色（agent），则沉淀一个新版本
            if session_type == 'agent':
                try:
                    _create_role_version(conn, session_id, {'reason': 'system_prompt_update'})
                except Exception as e:
                    print(f"[RoleVersion] Failed to create version on system prompt update: {e}")
            
            return jsonify({
                'session_id': session_id,
                'system_prompt': system_prompt,
                'message': 'System prompt updated successfully'
            }), 200
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error updating system prompt: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/media-output-path', methods=['PUT', 'OPTIONS'])
def update_session_media_output_path(session_id):
    """更新会话/智能体的媒体输出路径"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        media_output_path = data.get('media_output_path')  # 媒体输出路径
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 检查会话是否存在
            cursor.execute("SELECT session_id FROM sessions WHERE session_id = %s", (session_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Session not found'}), 404
            
            # 更新媒体输出路径
            cursor.execute("""
                UPDATE sessions 
                SET media_output_path = %s 
                WHERE session_id = %s
            """, (media_output_path, session_id))
            conn.commit()
            
            print(f"[Session API] Updated media_output_path for session {session_id}: {media_output_path}")
            return jsonify({'success': True, 'media_output_path': media_output_path})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error updating media output path: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/llm-config', methods=['PUT', 'OPTIONS'])
def update_session_llm_config(session_id):
    """更新会话/智能体的默认 LLM 配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        llm_config_id = data.get('llm_config_id')  # LLM 配置ID
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 检查会话是否存在
            cursor.execute(
                "SELECT session_id, session_type FROM sessions WHERE session_id = %s",
                (session_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Session not found'}), 404
            session_type = row.get('session_type') or 'memory'
            
            # 更新 LLM 配置
            cursor.execute("""
                UPDATE sessions 
                SET llm_config_id = %s, updated_at = NOW()
                WHERE session_id = %s
            """, (llm_config_id, session_id))
            conn.commit()

            # 如果是角色（agent），则沉淀一个新版本
            if session_type == 'agent':
                try:
                    _create_role_version(conn, session_id, {'reason': 'llm_config_update'})
                except Exception as e:
                    print(f"[RoleVersion] Failed to create version on llm config update: {e}")
            
            print(f"[Session API] Updated llm_config_id for session {session_id}: {llm_config_id}")
            return jsonify({'success': True, 'llm_config_id': llm_config_id})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error updating LLM config: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<session_id>/apply-role', methods=['PUT', 'OPTIONS'])
def apply_role_to_session(session_id):
    """将某个角色版本应用到会话（会话绑定角色版本，便于回放/复盘）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()

    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        data = request.json or {}
        role_id = (data.get('role_id') or '').strip()
        role_version_id = (data.get('role_version_id') or '').strip() or None
        keep_session_llm_config = bool(data.get('keep_session_llm_config', False))

        if not role_id:
            return jsonify({'error': 'role_id is required'}), 400

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(
                "SELECT session_id, session_type, llm_config_id FROM sessions WHERE session_id = %s",
                (session_id,),
            )
            session = cursor.fetchone()
            if not session:
                return jsonify({'error': 'Session not found'}), 404
            if (session.get('session_type') or 'memory') == 'agent':
                return jsonify({'error': 'Cannot apply role to an agent session'}), 400

            if not role_version_id:
                role_version_id = _ensure_role_current_version(conn, role_id)

            role_version = _get_role_version(conn, role_id, role_version_id)
            if not role_version:
                return jsonify({'error': 'Role version not found'}), 404

            new_llm_config_id = session.get('llm_config_id') if keep_session_llm_config else role_version.get('llm_config_id')
            snapshot = {
                'role_id': role_id,
                'role_version_id': role_version_id,
                'name': role_version.get('name'),
                'avatar': role_version.get('avatar'),
                'llm_config_id': role_version.get('llm_config_id'),
                'system_prompt': role_version.get('system_prompt'),
                'created_at': role_version.get('created_at').isoformat() if role_version.get('created_at') else None,
            }

            cursor.execute(
                """
                UPDATE sessions
                SET avatar = %s,
                    system_prompt = %s,
                    llm_config_id = %s,
                    role_id = %s,
                    role_version_id = %s,
                    role_snapshot = %s,
                    role_applied_at = NOW(),
                    updated_at = NOW()
                WHERE session_id = %s
                """,
                (
                    role_version.get('avatar'),
                    role_version.get('system_prompt'),
                    new_llm_config_id,
                    role_id,
                    role_version_id,
                    json.dumps(snapshot, ensure_ascii=False),
                    session_id,
                ),
            )
            conn.commit()

            return jsonify({
                'success': True,
                'session_id': session_id,
                'role_id': role_id,
                'role_version_id': role_version_id,
                'llm_config_id': new_llm_config_id,
            })
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()

    except Exception as e:
        print(f"[Session API] Error applying role: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/upgrade-to-agent', methods=['PUT', 'OPTIONS'])
def upgrade_to_agent(session_id):
    """升级记忆体为智能体"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        name = data.get('name', '').strip()
        avatar = data.get('avatar', '').strip()
        system_prompt = data.get('system_prompt', '').strip()
        llm_config_id = data.get('llm_config_id', '').strip()
        
        # 验证必填字段
        if not name:
            return jsonify({'error': '智能体名称是必填的'}), 400
        if not avatar:
            return jsonify({'error': '智能体头像是必填的'}), 400
        if not system_prompt:
            return jsonify({'error': '智能体人设是必填的'}), 400
        if not llm_config_id:
            return jsonify({'error': 'LLM模型是必填的'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 检查会话是否存在且是记忆体
            cursor.execute("""
                SELECT session_id, session_type 
                FROM sessions 
                WHERE session_id = %s
            """, (session_id,))
            session = cursor.fetchone()
            
            if not session:
                return jsonify({'error': 'Session not found'}), 404
            
            if session.get('session_type') != 'memory':
                return jsonify({'error': '只能将记忆体升级为智能体'}), 400
            
            # 升级为智能体（关联固定的LLM模型）
            # 记录创建者IP（如果还没有记录）
            creator_ip = get_client_ip()
            cursor.execute("""
                UPDATE sessions 
                SET session_type = 'agent',
                    name = %s,
                    avatar = %s,
                    system_prompt = %s,
                    llm_config_id = %s,
                    creator_ip = COALESCE(creator_ip, %s),
                    updated_at = NOW()
                WHERE session_id = %s
            """, (name, avatar, system_prompt, llm_config_id, creator_ip, session_id))
            conn.commit()

            # 为该角色创建初始版本（如果不存在）
            try:
                current_version_id = _ensure_role_current_version(conn, session_id)
            except Exception as e:
                current_version_id = None
                print(f"[RoleVersion] Failed to bootstrap role version for agent {session_id}: {e}")
            
            # 获取更新后的会话信息
            cursor.execute("""
                SELECT session_id, title, name, llm_config_id, avatar, system_prompt, ext, session_type, created_at, updated_at
                FROM sessions
                WHERE session_id = %s
            """, (session_id,))
            updated_session = cursor.fetchone()
            
            # 处理 ext 字段
            ext_data = updated_session.get('ext')
            if ext_data and isinstance(ext_data, str):
                try:
                    ext_data = json.loads(ext_data)
                except:
                    ext_data = {}
            elif ext_data is None:
                ext_data = {}

            return jsonify({
                'session_id': updated_session['session_id'],
                'title': updated_session.get('title'),
                'name': updated_session.get('name'),
                'llm_config_id': updated_session.get('llm_config_id'),
                'avatar': updated_session.get('avatar'),
                'system_prompt': updated_session.get('system_prompt'),
                'ext': ext_data,
                'session_type': updated_session.get('session_type', 'agent'),
                'current_role_version_id': current_version_id,
                'created_at': updated_session.get('created_at').isoformat() if updated_session.get('created_at') else None,
                'updated_at': updated_session.get('updated_at').isoformat() if updated_session.get('updated_at') else None,
                'skill_packs': _get_session_skill_packs_list(cursor, session_id),
                'message': 'Upgraded to agent successfully'
            }), 200
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error upgrading to agent: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/agents', methods=['GET', 'OPTIONS'])
def list_agents():
    """获取智能体列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'agents': [], 'total': 0, 'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 查询所有 agent（移除用户访问控制）
            # 优化：使用子查询计算message_count，避免JOIN messages表导致性能问题
            # 优化：列表查询不返回完整的system_prompt，减少数据传输量
            try:
                cursor.execute("""
                    SELECT 
                        s.session_id,
                        s.title,
                        s.name,
                        s.llm_config_id,
                        s.avatar,
                        s.system_prompt,
                        s.ext,
                        s.session_type,
                        rv.version_id as current_role_version_id,
                        s.created_at,
                        s.updated_at,
                        s.last_message_at,
                        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) as message_count
                    FROM sessions s
                    LEFT JOIN role_versions rv ON rv.role_id = s.session_id AND rv.is_current = 1
                    WHERE s.session_type = 'agent'
                    ORDER BY s.updated_at DESC, s.created_at DESC
                """)
            except Exception as join_error:
                print(f"[Agent API] Warning: role_versions join failed, fallback without versions: {join_error}")
                cursor.execute("""
                    SELECT 
                        s.session_id,
                        s.title,
                        s.name,
                        s.llm_config_id,
                        s.avatar,
                        s.system_prompt,
                        s.ext,
                        s.session_type,
                        NULL as current_role_version_id,
                        s.created_at,
                        s.updated_at,
                        s.last_message_at,
                        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) as message_count
                    FROM sessions s
                    WHERE s.session_type = 'agent'
                    ORDER BY s.updated_at DESC, s.created_at DESC
                """)
            
            agents = []
            rows = cursor.fetchall()
            for row in rows:
                # 处理 ext 字段
                ext_data = row.get('ext')
                if ext_data and isinstance(ext_data, str):
                    try:
                        ext_data = json.loads(ext_data)
                    except:
                        ext_data = {}
                elif ext_data is None:
                    ext_data = {}

                agent = {
                    'session_id': row['session_id'],
                    'title': row['title'],
                    'name': row.get('name'),
                    'llm_config_id': row['llm_config_id'],
                    'avatar': row['avatar'],
                    'system_prompt': row.get('system_prompt'),
                    'ext': ext_data,
                    'session_type': row.get('session_type', 'agent'),
                    'current_role_version_id': row.get('current_role_version_id'),
                    'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                    'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None,
                    'last_message_at': row['last_message_at'].isoformat() if row['last_message_at'] else None,
                    'message_count': row['message_count'] or 0,
                    'skill_packs': _get_session_skill_packs_list(cursor, row['session_id'])
                }
                agents.append(agent)
            
            return jsonify({'agents': agents, 'total': len(agents)})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Agent API] Error listing agents: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'agents': [], 'total': 0, 'error': str(e)}), 500


@app.route('/api/memories', methods=['GET', 'OPTIONS'])
def list_memories():
    """获取记忆体/话题列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'memories': [], 'total': 0, 'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取客户端IP
            client_ip = get_client_ip()
            is_owner = is_owner_ip(client_ip)
            
            # 查询 session_type = 'memory' 的会话（话题）
            cursor.execute("""
                SELECT 
                    s.session_id,
                    s.title,
                    s.name,
                    s.llm_config_id,
                    s.avatar,
                    s.system_prompt,
                    s.ext,
                    s.session_type,
                    s.created_at,
                    s.updated_at,
                    s.last_message_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) as message_count,
                    (SELECT content FROM messages m WHERE m.session_id = s.session_id AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) as first_user_message
                FROM sessions s
                WHERE s.session_type = 'memory'
                ORDER BY COALESCE(s.last_message_at, s.updated_at, s.created_at) DESC
            """)
            
            rows = cursor.fetchall()
            memories = []
            for row in rows:
                first_message = row.get('first_user_message', '') or ''
                preview_text = (first_message[:30] + '...') if len(first_message) > 30 else first_message
                
                # 解析 ext
                ext = row.get('ext')
                if isinstance(ext, str):
                    try:
                        ext = json.loads(ext)
                    except:
                        ext = {}
                
                memories.append({
                    'session_id': row['session_id'],
                    'title': row['title'],
                    'name': row.get('name'),
                    'llm_config_id': row['llm_config_id'],
                    'avatar': row['avatar'],
                    'system_prompt': row.get('system_prompt'),
                    'ext': ext,
                    'session_type': row.get('session_type', 'memory'),
                    'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                    'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None,
                    'last_message_at': row['last_message_at'].isoformat() if row['last_message_at'] else None,
                    'message_count': row['message_count'] or 0,
                    'preview_text': preview_text.replace('\n', ' ').strip() if preview_text else '',
                })
            
            return jsonify({'memories': memories, 'total': len(memories)})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Memory API] Error listing memories: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'memories': [], 'total': 0, 'error': str(e)}), 500


@app.route('/api/role-generator/dimension-options', methods=['GET', 'OPTIONS'])
def get_role_dimension_options():
    """获取自定义维度选项"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'options': []}), 503
        
        dimension_type = request.args.get('dimension_type')
        role_type = request.args.get('role_type')
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            query = "SELECT option_value FROM role_dimension_options WHERE 1=1"
            params = []
            
            if dimension_type:
                query += " AND dimension_type = %s"
                params.append(dimension_type)
            
            if role_type:
                query += " AND role_type = %s"
                params.append(role_type)
            
            query += " ORDER BY created_at DESC"
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            
            options = [row['option_value'] for row in rows]
            
            return jsonify({'options': options})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[RoleDimensionOptions] Error getting options: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'options': [], 'error': str(e)}), 500

@app.route('/api/role-generator/dimension-options', methods=['POST', 'OPTIONS'])
def save_role_dimension_option():
    """保存自定义维度选项"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        dimension_type = data.get('dimension_type')
        role_type = data.get('role_type')
        option_value = data.get('option_value')
        
        if not dimension_type or not role_type or not option_value:
            return jsonify({'error': 'dimension_type, role_type, and option_value are required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            option_id = str(uuid.uuid4())
            
            cursor.execute("""
                INSERT INTO role_dimension_options 
                (option_id, dimension_type, role_type, option_value)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    updated_at = CURRENT_TIMESTAMP
            """, (option_id, dimension_type, role_type, option_value))
            
            conn.commit()
            
            return jsonify({
                'success': True,
                'option_id': option_id,
                'option_value': option_value
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[RoleDimensionOptions] Error saving option: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/agents/<role_id>/profile', methods=['PUT', 'OPTIONS'])
def update_agent_profile(role_id):
    """批量更新角色档案（避免多次更新导致版本噪音）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()

    try:
        from database import get_mysql_connection

        data = request.get_json() or {}

        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)

            role = _get_session_row(cursor, role_id)
            if not role:
                return jsonify({'error': 'Session not found'}), 404
            
            # 允许所有会话类型更新配置，但版本控制只对 agent 类型生效
            is_agent = role.get('session_type') == 'agent'

            update_fields = []
            update_values = []
            updated_keys = []

            def add_field(field_name, value, key_name):
                update_fields.append(f"{field_name} = %s")
                update_values.append(value)
                updated_keys.append(key_name)

            if 'name' in data:
                name = (data.get('name') or '').strip()
                next_value = name if name else None
                if next_value != role.get('name'):
                    add_field('name', next_value, 'name')
            if 'title' in data:
                title = (data.get('title') or '').strip()
                next_value = title if title else None
                if next_value != role.get('title'):
                    add_field('title', next_value, 'title')
            if 'avatar' in data:
                avatar = data.get('avatar')
                if avatar != role.get('avatar'):
                    add_field('avatar', avatar, 'avatar')
            if 'system_prompt' in data:
                system_prompt = data.get('system_prompt')
                if system_prompt != role.get('system_prompt'):
                    add_field('system_prompt', system_prompt, 'system_prompt')
            if 'llm_config_id' in data:
                llm_config_id = data.get('llm_config_id')
                if llm_config_id != role.get('llm_config_id'):
                    add_field('llm_config_id', llm_config_id, 'llm_config_id')
            if 'media_output_path' in data:
                media_output_path = data.get('media_output_path')
                if media_output_path != role.get('media_output_path'):
                    add_field('media_output_path', media_output_path, 'media_output_path')
            
            # 支持 ext 字段更新（用于 persona 配置等）
            if 'ext' in data:
                import json
                new_ext = data.get('ext')
                current_ext = role.get('ext')
                # 如果 current_ext 是字符串，解析为字典
                if isinstance(current_ext, str):
                    try:
                        current_ext = json.loads(current_ext)
                    except:
                        current_ext = {}
                elif current_ext is None:
                    current_ext = {}
                # 合并 ext 字段（保留现有字段，更新新字段）
                merged_ext = {**current_ext, **new_ext} if new_ext else current_ext
                if merged_ext != current_ext:
                    add_field('ext', json.dumps(merged_ext), 'ext')

            if not update_fields:
                current_id = None
                # 版本控制只对 agent 类型会话生效
                if is_agent:
                    try:
                        current_id = _ensure_role_current_version(conn, role_id)
                    except Exception:
                        current_id = None
                return jsonify({'success': True, 'role_id': role_id, 'current_role_version_id': current_id, 'message': 'No fields updated'}), 200

            update_fields.append('updated_at = NOW()')
            update_values.append(role_id)

            sql = f"""
                UPDATE sessions
                SET {', '.join(update_fields)}
                WHERE session_id = %s
            """
            cursor.execute(sql, tuple(update_values))

            version_id = None
            # 版本控制只对 agent 类型会话生效
            if is_agent:
                try:
                    reason = (data.get('reason') or 'profile_update').strip()
                    metadata = {'reason': reason, 'fields': updated_keys}
                    version_id = _create_role_version(conn, role_id, metadata)
                except Exception as e:
                    # 兼容：版本表不可用时，仍允许更新角色档案
                    print(f"[RoleVersion] Failed to create version on profile update: {e}")

            return jsonify({'success': True, 'role_id': role_id, 'current_role_version_id': version_id})
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[Agent API] Error updating agent profile: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/agents/<role_id>/versions', methods=['GET', 'OPTIONS'])
def list_role_versions(role_id):
    """获取角色版本列表（按时间倒序）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()

    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'versions': [], 'error': 'MySQL not available'}), 503

        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)

            # 角色必须存在且为 agent
            role = _get_session_row(cursor, role_id)
            if not role:
                return jsonify({'error': 'Agent not found'}), 404
            if role.get('session_type') != 'agent':
                return jsonify({'error': 'Session is not an agent'}), 400

            # 确保存在 current 版本（兼容历史数据）
            try:
                _ensure_role_current_version(conn, role_id)
            except Exception as e:
                print(f"[RoleVersion] Failed to ensure current version: {e}")

            cursor.execute(
                """
                SELECT version_id, is_current, created_at, updated_at, metadata
                FROM role_versions
                WHERE role_id = %s
                ORDER BY created_at DESC
                LIMIT 200
                """,
                (role_id,),
            )
            versions = []
            for row in cursor.fetchall():
                meta = row.get('metadata')
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except Exception:
                        meta = None
                versions.append({
                    'version_id': row.get('version_id'),
                    'is_current': bool(row.get('is_current')),
                    'created_at': row.get('created_at').isoformat() if row.get('created_at') else None,
                    'updated_at': row.get('updated_at').isoformat() if row.get('updated_at') else None,
                    'metadata': meta,
                })
            return jsonify({'versions': versions})
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[RoleVersion API] Error listing role versions: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'versions': [], 'error': str(e)}), 500


@app.route('/api/agents/<role_id>/versions/<version_id>/activate', methods=['PUT', 'OPTIONS'])
def activate_role_version(role_id, version_id):
    """激活某个角色版本（将角色档案回滚/切换到该版本）"""
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
            role = _get_session_row(cursor, role_id)
            if not role:
                return jsonify({'error': 'Agent not found'}), 404
            if role.get('session_type') != 'agent':
                return jsonify({'error': 'Session is not an agent'}), 400

            role_version = _get_role_version(conn, role_id, version_id)
            if not role_version:
                return jsonify({'error': 'Role version not found'}), 404

            # 切换 current 标记
            cursor.execute("UPDATE role_versions SET is_current = 0 WHERE role_id = %s", (role_id,))
            cursor.execute(
                "UPDATE role_versions SET is_current = 1 WHERE role_id = %s AND version_id = %s",
                (role_id, version_id),
            )

            # 将角色会话字段回滚到该版本快照
            cursor.execute(
                """
                UPDATE sessions
                SET name = %s,
                    avatar = %s,
                    system_prompt = %s,
                    llm_config_id = %s,
                    updated_at = NOW()
                WHERE session_id = %s
                """,
                (
                    role_version.get('name'),
                    role_version.get('avatar'),
                    role_version.get('system_prompt'),
                    role_version.get('llm_config_id'),
                    role_id,
                ),
            )
            conn.commit()

            return jsonify({'success': True, 'role_id': role_id, 'current_role_version_id': version_id})
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    except Exception as e:
        print(f"[RoleVersion API] Error activating role version: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/agents/<session_id>/export', methods=['GET', 'OPTIONS'])
def export_agent(session_id):
    """导出智能体配置（包含LLM配置和密钥）"""
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
            
            # 获取智能体信息
            cursor.execute("""
                SELECT 
                    session_id, title, name, llm_config_id, avatar, 
                    system_prompt, session_type, created_at
                FROM sessions 
                WHERE session_id = %s
            """, (session_id,))
            
            agent = cursor.fetchone()
            if not agent:
                return jsonify({'error': 'Agent not found'}), 404
            
            if agent.get('session_type') != 'agent':
                return jsonify({'error': 'Session is not an agent'}), 400
            
            # 获取关联的 LLM 配置（包含密钥）
            llm_config = None
            if agent.get('llm_config_id'):
                cursor.execute("""
                    SELECT 
                        config_id, name, provider, api_key, api_url, 
                        model, tags, enabled, description, metadata
                    FROM llm_configs 
                    WHERE config_id = %s
                """, (agent['llm_config_id'],))
                llm_config = cursor.fetchone()
                
                if llm_config:
                    # 处理 JSON 字段
                    if llm_config.get('tags'):
                        if isinstance(llm_config['tags'], str):
                            llm_config['tags'] = json.loads(llm_config['tags'])
                    if llm_config.get('metadata'):
                        if isinstance(llm_config['metadata'], str):
                            llm_config['metadata'] = json.loads(llm_config['metadata'])
            
            # 构建导出数据
            export_data = {
                'version': '1.0',
                'export_type': 'agent',
                'exported_at': datetime.now().isoformat(),
                'agent': {
                    'name': agent.get('name') or agent.get('title'),
                    'avatar': agent.get('avatar'),
                    'system_prompt': agent.get('system_prompt'),
                },
                'llm_config': llm_config if llm_config else None,
            }
            
            return jsonify(export_data)
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Agent API] Error exporting agent: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/agents/import', methods=['POST', 'OPTIONS'])
def import_agent():
    """导入智能体配置"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        import uuid
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # 验证数据格式
        if data.get('export_type') != 'agent':
            return jsonify({'error': 'Invalid export type'}), 400
        
        agent_data = data.get('agent')
        if not agent_data:
            return jsonify({'error': 'Agent data is required'}), 400
        
        llm_config_data = data.get('llm_config')
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 如果有 LLM 配置，先创建或更新
            llm_config_id = None
            if llm_config_data:
                # 检查是否已存在同名配置
                cursor.execute("""
                    SELECT config_id FROM llm_configs WHERE name = %s
                """, (llm_config_data.get('name'),))
                existing = cursor.fetchone()
                
                if existing:
                    # 使用现有配置，或创建新的带后缀的配置
                    import_mode = request.args.get('llm_mode', 'use_existing')
                    
                    if import_mode == 'use_existing':
                        llm_config_id = existing['config_id']
                    else:
                        # 创建新配置，名称加后缀
                        new_config_id = str(uuid.uuid4())
                        new_name = f"{llm_config_data.get('name')}_导入_{datetime.now().strftime('%m%d%H%M')}"
                        
                        cursor.execute("""
                            INSERT INTO llm_configs 
                            (config_id, name, provider, api_key, api_url, model, tags, enabled, description, metadata)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            new_config_id,
                            new_name,
                            llm_config_data.get('provider'),
                            llm_config_data.get('api_key'),
                            llm_config_data.get('api_url'),
                            llm_config_data.get('model'),
                            json.dumps(llm_config_data.get('tags')) if llm_config_data.get('tags') else None,
                            1 if llm_config_data.get('enabled', True) else 0,
                            llm_config_data.get('description'),
                            json.dumps(llm_config_data.get('metadata')) if llm_config_data.get('metadata') else None,
                        ))
                        llm_config_id = new_config_id
                else:
                    # 创建新配置
                    new_config_id = llm_config_data.get('config_id') or str(uuid.uuid4())
                    
                    cursor.execute("""
                        INSERT INTO llm_configs 
                        (config_id, name, provider, api_key, api_url, model, tags, enabled, description, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        new_config_id,
                        llm_config_data.get('name'),
                        llm_config_data.get('provider'),
                        llm_config_data.get('api_key'),
                        llm_config_data.get('api_url'),
                        llm_config_data.get('model'),
                        json.dumps(llm_config_data.get('tags')) if llm_config_data.get('tags') else None,
                        1 if llm_config_data.get('enabled', True) else 0,
                        llm_config_data.get('description'),
                        json.dumps(llm_config_data.get('metadata')) if llm_config_data.get('metadata') else None,
                    ))
                    llm_config_id = new_config_id
            
            # 创建智能体会话
            session_id = str(uuid.uuid4())
            agent_name = agent_data.get('name', '导入的智能体')
            
            # 检查是否已存在同名智能体
            cursor.execute("""
                SELECT name FROM sessions WHERE name = %s AND session_type = 'agent'
            """, (agent_name,))
            if cursor.fetchone():
                agent_name = f"{agent_name}_导入_{datetime.now().strftime('%m%d%H%M')}"
            
            # 记录导入者的IP
            creator_ip = get_client_ip()
            
            cursor.execute("""
                INSERT INTO sessions 
                (session_id, title, name, llm_config_id, avatar, system_prompt, session_type, creator_ip)
                VALUES (%s, %s, %s, %s, %s, %s, 'agent', %s)
            """, (
                session_id,
                agent_name,
                agent_name,
                llm_config_id,
                agent_data.get('avatar'),
                agent_data.get('system_prompt'),
                creator_ip,
            ))
            
            conn.commit()
            
            return jsonify({
                'message': 'Agent imported successfully',
                'session_id': session_id,
                'name': agent_name,
                'llm_config_id': llm_config_id,
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Agent API] Error importing agent: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== 技能包 API ====================

@app.route('/api/skill-packs', methods=['GET', 'OPTIONS'])
def list_skill_packs():
    """获取所有技能包列表"""
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
                SELECT skill_pack_id, name, summary, source_session_id, source_messages,
                       created_at, updated_at
                FROM skill_packs
                ORDER BY created_at DESC
            """)
            
            skill_packs = cursor.fetchall()
            
            # 处理JSON字段和datetime
            for sp in skill_packs:
                if sp['source_messages']:
                    try:
                        sp['source_messages'] = json.loads(sp['source_messages']) if isinstance(sp['source_messages'], str) else sp['source_messages']
                    except:
                        sp['source_messages'] = []
                if sp['created_at']:
                    sp['created_at'] = sp['created_at'].isoformat()
                if sp['updated_at']:
                    sp['updated_at'] = sp['updated_at'].isoformat()
            
            return jsonify({'skill_packs': skill_packs})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error listing skill packs: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs', methods=['POST', 'OPTIONS'])
def create_skill_pack():
    """创建技能包（从选定的消息范围生成）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        session_id = data.get('session_id')
        message_ids = data.get('message_ids', [])  # 选定的消息ID列表
        llm_config_id = data.get('llm_config_id')  # 用于生成总结的LLM配置
        
        if not message_ids:
            return jsonify({'error': 'message_ids is required'}), 400
        if not llm_config_id:
            return jsonify({'error': 'llm_config_id is required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取选定的消息内容（包含ext字段，可能存储媒体信息）
            # 移除ORDER BY避免排序缓冲区溢出，改为在应用层排序
            placeholders = ','.join(['%s'] * len(message_ids))
            cursor.execute(f"""
                SELECT message_id, role, content, tool_calls, thinking, ext, created_at
                FROM messages
                WHERE message_id IN ({placeholders})
            """, message_ids)
            
            messages = cursor.fetchall()
            if not messages:
                return jsonify({'error': 'No messages found'}), 404
            
            # 在应用层按照message_ids的顺序排序（避免MySQL排序缓冲区溢出）
            message_dict = {msg['message_id']: msg for msg in messages}
            messages = [message_dict[mid] for mid in message_ids if mid in message_dict]
            
            # 获取LLM配置
            cursor.execute("""
                SELECT config_id, name, provider, api_key, api_url, model, metadata
                FROM llm_configs
                WHERE config_id = %s
            """, (llm_config_id,))
            
            llm_config = cursor.fetchone()
            if not llm_config:
                return jsonify({'error': 'LLM config not found'}), 404
            
            # 格式化消息用于LLM总结（参考总结功能的处理方式）
            formatted_messages = []
            media_info_list = []  # 收集所有媒体资源信息
            all_process_steps = []  # 收集所有执行轨迹（Topic会话特有）
            process_info = {
                'messages_count': len(messages),
                'thinking_count': 0,
                'tool_calls_count': 0,
                'media_count': 0,
                'media_types': set(),
                'process_steps_count': 0,
            }
            
            for msg in messages:
                role_label = {'user': '用户', 'assistant': 'AI助手', 'system': '系统', 'tool': '工具'}.get(msg['role'], msg['role'])
                content = msg['content'] or ''
                
                # 处理ext字段中的媒体资源和执行轨迹(processSteps)
                if msg.get('ext'):
                    try:
                        ext_data = json.loads(msg['ext']) if isinstance(msg['ext'], str) else msg['ext']
                        if isinstance(ext_data, dict):
                            # 处理媒体资源
                            if 'media' in ext_data:
                                media_list = ext_data['media']
                                if isinstance(media_list, list):
                                    for media_item in media_list:
                                        if isinstance(media_item, dict):
                                            media_type = media_item.get('type', '').lower()
                                            if media_type == 'image':
                                                media_info_list.append('{image}')
                                                process_info['media_count'] += 1
                                                process_info['media_types'].add('image')
                                            elif media_type == 'video':
                                                media_info_list.append('{video}')
                                                process_info['media_count'] += 1
                                                process_info['media_types'].add('video')
                                            elif media_type == 'audio':
                                                media_info_list.append('{audio}')
                                                process_info['media_count'] += 1
                                                process_info['media_types'].add('audio')
                            
                            # 处理执行轨迹（优先新协议 processMessages）
                            if 'processMessages' in ext_data and isinstance(ext_data['processMessages'], list):
                                messages = ext_data['processMessages']
                                for pm in messages:
                                    if not isinstance(pm, dict):
                                        continue
                                    all_process_steps.append(pm)
                                    process_info['process_steps_count'] += 1
                                    pm_type = pm.get('type', 'unknown')
                                    title = pm.get('title', '')
                                    content_type = pm.get('contentType', 'text')
                                    content_text = pm.get('content', '') or ''
                                    if pm_type == 'thinking':
                                        content += f"\n[执行轨迹-思考]: {content_text[:500]}"
                                    elif pm_type == 'mcp_call':
                                        content += f"\n[执行轨迹-MCP调用]: {title} ({content_type})"
                                    elif pm_type == 'workflow':
                                        content += f"\n[执行轨迹-工作流]: {title}"
                            # 兼容旧结构 processSteps
                            elif 'processSteps' in ext_data:
                                steps = ext_data['processSteps']
                                if isinstance(steps, list):
                                    for step in steps:
                                        if isinstance(step, dict):
                                            all_process_steps.append(step)
                                            process_info['process_steps_count'] += 1
                                            # 提取执行步骤信息添加到内容
                                            step_type = step.get('type', 'unknown')
                                            if step_type == 'thinking':
                                                thinking_text = step.get('thinking', '')
                                                duration = step.get('duration')
                                                duration_str = f" ({duration}ms)" if duration else ""
                                                content += f"\n[执行轨迹-思考{duration_str}]: {thinking_text[:500]}"
                                            elif step_type == 'mcp_call':
                                                server = step.get('mcpServer', '')
                                                tool = step.get('toolName', '')
                                                status = step.get('status', '')
                                                duration = step.get('duration')
                                                duration_str = f" ({duration}ms)" if duration else ""
                                                args = step.get('arguments', {})
                                                args_str = json.dumps(args, ensure_ascii=False)[:200] if args else ''
                                                content += f"\n[执行轨迹-MCP调用{duration_str}]: {server}/{tool} ({status}) 参数: {args_str}"
                                            elif step_type == 'workflow':
                                                wf_info = step.get('workflowInfo', {})
                                                wf_name = wf_info.get('name', 'Unknown')
                                                status = step.get('status', '')
                                                content += f"\n[执行轨迹-工作流]: {wf_name} ({status})"
                    except Exception as e:
                        print(f"[SkillPack] 解析ext字段失败: {e}")
                
                # 处理工具调用信息（包含媒体资源）
                if msg['tool_calls']:
                    process_info['tool_calls_count'] += 1
                    try:
                        tool_calls = json.loads(msg['tool_calls']) if isinstance(msg['tool_calls'], str) else msg['tool_calls']
                        if tool_calls:
                            # 检查是否有媒体资源
                            media_info = []
                            if isinstance(tool_calls, dict):
                                # 检查是否有media字段
                                if 'media' in tool_calls and isinstance(tool_calls['media'], list):
                                    for media_item in tool_calls['media']:
                                        if isinstance(media_item, dict):
                                            media_type = media_item.get('type', '').lower()
                                            if media_type == 'image':
                                                media_info.append('{image}')
                                                media_info_list.append('{image}')
                                                process_info['media_count'] += 1
                                                process_info['media_types'].add('image')
                                            elif media_type == 'video':
                                                media_info.append('{video}')
                                                media_info_list.append('{video}')
                                                process_info['media_count'] += 1
                                                process_info['media_types'].add('video')
                                            elif media_type == 'audio':
                                                media_info.append('{audio}')
                                                media_info_list.append('{audio}')
                                                process_info['media_count'] += 1
                                                process_info['media_types'].add('audio')
                                
                                # 移除media字段，避免在JSON中显示大量base64数据
                                tool_calls_for_json = {k: v for k, v in tool_calls.items() if k != 'media'}
                            else:
                                tool_calls_for_json = tool_calls
                            
                            # 添加媒体占位符到内容中
                            if media_info:
                                content += f"\n[媒体资源]: {', '.join(media_info)}"
                            
                            # 添加工具调用信息（不包含media字段）
                            if tool_calls_for_json:
                                # 限制工具调用JSON的长度，避免过长
                                tool_calls_str = json.dumps(tool_calls_for_json, ensure_ascii=False, indent=2)
                                if len(tool_calls_str) > 5000:
                                    tool_calls_str = tool_calls_str[:5000] + "...[已截断]"
                                content += f"\n[工具调用]: {tool_calls_str}"
                    except Exception as e:
                        print(f"[SkillPack] 解析tool_calls失败: {e}")
                        pass
                
                # 如果有思考过程，也包含（截断过长的思考）
                if msg['thinking']:
                    process_info['thinking_count'] += 1
                    thinking_content = msg['thinking']
                    if len(thinking_content) > 2000:
                        thinking_content = thinking_content[:2000] + "...[已截断]"
                    content += f"\n[思考过程]: {thinking_content}"
                
                formatted_messages.append(f"【{role_label}】\n{content}")
            
            # 如果有媒体资源，在对话开头添加说明
            if media_info_list:
                media_summary = f"[对话包含以下媒体资源: {', '.join(set(media_info_list))}]"
                formatted_messages.insert(0, media_summary)
            
            conversation_text = "\n\n".join(formatted_messages)
            
            # 参考总结功能的处理方式，不限制长度（总结功能可以处理大量字符）
            # 如果内容过长，LLM API会自动处理或返回错误，由调用方处理
            print(f"[SkillPack] 对话记录总长度: {len(conversation_text)} 字符，消息数量: {len(messages)}")
            
            # 构建提示词让LLM生成技能包
            prompt = f"""请分析以下对话记录，总结其中涉及的执行步骤和能力，要求：
1. 不要遗漏任何与执行相关的信息（工具调用、参数、步骤顺序）
2. 总结应让其他AI阅读后能够重现这些能力
3. 输出格式必须严格遵循：
   第一行：技能包名称（10字以内，简洁概括核心能力）
   第二行开始：详细的执行步骤和能力描述

对话记录：
{conversation_text}"""

            print(f"[SkillPack] 准备调用LLM生成技能包总结，提示词长度: {len(prompt)} 字符")
            
            # 调用LLM生成总结（使用app.py中已有的call_llm_api函数）
            llm_config_dict = {
                'provider': llm_config['provider'],
                'api_key': llm_config['api_key'],
                'api_url': llm_config['api_url'],
                'model': llm_config['model'],
                'metadata': json.loads(llm_config['metadata']) if llm_config['metadata'] else None
            }
            
            # 创建日志回调函数来捕获详细错误信息
            error_logs = []
            def log_callback(msg):
                print(f"[SkillPack LLM] {msg}")
                error_logs.append(msg)
            
            try:
                llm_response = call_llm_api(
                    llm_config=llm_config_dict,
                    system_prompt="你是一个专业的技能总结助手，擅长分析对话记录并提取关键执行步骤。",
                    user_input=prompt,
                    add_log=log_callback
                )
                
                if not llm_response:
                    error_detail = f"LLM API调用失败。"
                    if error_logs:
                        error_detail += f" 详细信息: {'; '.join(error_logs[-3:])}"  # 只显示最后3条日志
                    else:
                        error_detail += " 请检查：1. API密钥是否正确 2. 模型是否可用 3. 网络连接是否正常 4. 提示词是否过长"
                    print(f"[SkillPack] {error_detail}")
                    return jsonify({'error': error_detail}), 500
                
                print(f"[SkillPack] LLM响应成功，响应长度: {len(str(llm_response))} 字符")
            except Exception as llm_error:
                error_detail = f"LLM调用异常: {str(llm_error)}"
                if error_logs:
                    error_detail += f" 日志: {'; '.join(error_logs[-3:])}"
                print(f"[SkillPack] {error_detail}")
                import traceback
                traceback.print_exc()
                return jsonify({'error': error_detail}), 500
            
            # 解析LLM响应，提取名称和总结
            response_content = llm_response.strip() if isinstance(llm_response, str) else str(llm_response)
            
            if not response_content:
                return jsonify({'error': 'LLM返回了空响应'}), 500
            
            print(f"[SkillPack] LLM响应内容预览: {response_content[:200]}...")
            
            lines = response_content.split('\n', 1)
            
            # 提取技能包名称（第一行）
            skill_name = lines[0].strip()[:50]  # 限制长度
            if not skill_name:
                skill_name = "未命名技能包"
            
            # 提取技能包总结（第二行开始，如果没有第二行则使用全部内容）
            skill_summary = lines[1].strip() if len(lines) > 1 else response_content
            
            if not skill_summary:
                skill_summary = response_content  # 如果总结为空，使用全部响应
            
            print(f"[SkillPack] 解析结果 - 名称: {skill_name}, 总结长度: {len(skill_summary)} 字符")
            
            # 准备制作过程信息
            process_info['media_types'] = list(process_info['media_types'])
            process_info['conversation_length'] = len(conversation_text)
            process_info['prompt_length'] = len(prompt)
            
            # 不直接保存，返回制作过程信息和总结结果，让用户选择是否保存
            return jsonify({
                'name': skill_name,
                'summary': skill_summary,
                'source_session_id': session_id,
                'source_messages': message_ids,
                'process_info': process_info,
                'conversation_text': conversation_text,  # 用于优化时重新生成
                'process_steps': all_process_steps,  # Topic会话的执行轨迹
            }), 200
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error creating skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/save', methods=['POST', 'OPTIONS'])
def save_skill_pack():
    """保存技能包（用户确认后）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        name = data.get('name')
        summary = data.get('summary')
        source_session_id = data.get('source_session_id')
        source_messages = data.get('source_messages', [])
        process_steps = data.get('process_steps', [])  # Topic会话的执行轨迹
        
        if not name or not summary:
            return jsonify({'error': 'name and summary are required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            # 生成技能包ID并保存
            skill_pack_id = str(uuid.uuid4())
            
            # 构建扩展数据（存储执行轨迹等）
            ext_data = None
            if process_steps:
                ext_data = json.dumps({'processSteps': process_steps})
            
            cursor.execute("""
                INSERT INTO skill_packs 
                (skill_pack_id, name, summary, source_session_id, source_messages, ext)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                skill_pack_id,
                name,
                summary,
                source_session_id,
                json.dumps(source_messages) if source_messages else None,
                ext_data
            ))
            
            conn.commit()
            
            return jsonify({
                'skill_pack_id': skill_pack_id,
                'name': name,
                'summary': summary,
                'source_session_id': source_session_id,
                'source_messages': source_messages,
                'process_steps': process_steps,
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error saving skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/sop', methods=['POST', 'OPTIONS'])
def create_sop_skill_pack():
    """创建纯文本SOP技能包（用户手动输入）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        name = data.get('name')
        sop_text = data.get('sop_text')
        assign_to_session_id = data.get('assign_to_session_id')  # 可选：分配到某个会话
        set_as_current = data.get('set_as_current', False)  # 可选：设为该会话的当前SOP
        
        if not name or not sop_text:
            return jsonify({'error': 'name and sop_text are required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 生成技能包ID并保存
            skill_pack_id = str(uuid.uuid4())
            
            # 构建扩展数据（标记为SOP类型）
            ext_data = json.dumps({'type': 'sop'})
            
            cursor.execute("""
                INSERT INTO skill_packs 
                (skill_pack_id, name, summary, ext)
                VALUES (%s, %s, %s, %s)
            """, (
                skill_pack_id,
                name,
                sop_text,
                ext_data
            ))
            
            # 如果指定了分配目标，创建分配记录
            if assign_to_session_id:
                assignment_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO skill_pack_assignments 
                    (assignment_id, skill_pack_id, target_session_id)
                    VALUES (%s, %s, %s)
                """, (
                    assignment_id,
                    skill_pack_id,
                    assign_to_session_id
                ))
                
                # 如果要设为当前SOP，更新会话的ext
                if set_as_current:
                    # 先获取当前会话的ext
                    cursor.execute("""
                        SELECT ext FROM sessions WHERE session_id = %s
                    """, (assign_to_session_id,))
                    row = cursor.fetchone()
                    current_ext = {}
                    if row and row.get('ext'):
                        try:
                            current_ext = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
                        except:
                            current_ext = {}
                    
                    # 更新currentSopSkillPackId
                    current_ext['currentSopSkillPackId'] = skill_pack_id
                    cursor.execute("""
                        UPDATE sessions SET ext = %s WHERE session_id = %s
                    """, (json.dumps(current_ext), assign_to_session_id))
            
            conn.commit()
            
            return jsonify({
                'skill_pack_id': skill_pack_id,
                'name': name,
                'summary': sop_text,
                'ext': {'type': 'sop'},
                'assigned_to': assign_to_session_id,
                'is_current_sop': set_as_current and assign_to_session_id is not None,
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error creating SOP skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/optimize', methods=['POST', 'OPTIONS'])
def optimize_skill_pack_summary():
    """优化技能包总结"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        conversation_text = data.get('conversation_text')
        current_summary = data.get('current_summary')
        optimization_prompt = data.get('optimization_prompt', '')  # 用户附加的优化提示词
        llm_config_id = data.get('llm_config_id')
        mcp_server_ids = data.get('mcp_server_ids', [])  # 要使用的MCP服务器ID列表
        
        if not conversation_text or not llm_config_id:
            return jsonify({'error': 'conversation_text and llm_config_id are required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取LLM配置
            cursor.execute("""
                SELECT config_id, name, provider, api_key, api_url, model, metadata
                FROM llm_configs
                WHERE config_id = %s
            """, (llm_config_id,))
            
            llm_config = cursor.fetchone()
            if not llm_config:
                return jsonify({'error': 'LLM config not found'}), 404
            
            # 获取MCP工具列表（如果指定了MCP服务器）
            all_tools = []
            tools_by_server = {}
            if mcp_server_ids:
                from mcp_server.mcp_common_logic import get_mcp_tools_list, prepare_mcp_headers
                
                cursor.execute("""
                    SELECT server_id, name, url, type, metadata, ext
                    FROM mcp_servers
                    WHERE server_id IN ({}) AND enabled = 1
                """.format(','.join(['%s'] * len(mcp_server_ids))), mcp_server_ids)
                
                mcp_servers = cursor.fetchall()
                
                for server in mcp_servers:
                    server_id = server['server_id']
                    server_name = server['name']
                    server_url = server['url']
                    
                    # 准备请求头
                    base_headers = {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'mcp-protocol-version': '2025-06-18',
                    }
                    headers = prepare_mcp_headers(server_url, base_headers, base_headers)
                    
                    # 获取工具列表
                    tools_response = get_mcp_tools_list(server_url, headers)
                    if tools_response and 'result' in tools_response:
                        tools = tools_response['result'].get('tools', [])
                        tools_by_server[server_name] = tools
                        all_tools.extend(tools)
                        print(f"[SkillPack Optimize] 获取到 {server_name} 的 {len(tools)} 个工具")
            
            # 构建工具描述（用于提示词）
            tools_description = ""
            if all_tools:
                tools_description = "\n\n【可用工具列表】\n你可以使用以下工具来验证和确认工具名称、参数等信息：\n\n"
                for server_name, tools in tools_by_server.items():
                    tools_description += f"来自 {server_name} 的工具：\n"
                    for tool in tools:
                        tool_name = tool.get('name', '')
                        tool_desc = tool.get('description', '')
                        input_schema = tool.get('inputSchema', {})
                        properties = input_schema.get('properties', {})
                        required = input_schema.get('required', [])
                        
                        tools_description += f"- {tool_name}: {tool_desc}\n"
                        if properties:
                            tools_description += "  参数：\n"
                            for param_name, param_info in properties.items():
                                param_type = param_info.get('type', 'string')
                                param_desc = param_info.get('description', '')
                                is_required = param_name in required
                                tools_description += f"    - {param_name} ({param_type}{', 必填' if is_required else ''}): {param_desc}\n"
                    tools_description += "\n"
            
            # 构建优化提示词
            base_prompt = """请优化以下技能包总结，要求：
1. 更清晰地描述执行步骤
2. 确保不遗漏关键信息，特别是工具调用的准确名称和参数
3. 让其他AI更容易理解和重现这些能力
4. 输出格式：第一行是技能包名称，第二行开始是优化后的总结

当前总结：
{current_summary}

对话记录：
{conversation_text}"""
            
            if tools_description:
                base_prompt += tools_description
                base_prompt += "\n【重要】如果对话记录中提到了工具调用，请使用上述工具列表来验证工具名称和参数的准确性。你可以调用工具来确认具体的工具名称和参数格式。"
            
            if optimization_prompt:
                base_prompt += f"\n\n额外优化要求：\n{optimization_prompt}"
            
            prompt = base_prompt.format(
                current_summary=current_summary or '（无）',
                conversation_text=conversation_text
            )
            
            # 调用LLM优化总结
            llm_config_dict = {
                'provider': llm_config['provider'],
                'api_key': llm_config['api_key'],
                'api_url': llm_config['api_url'],
                'model': llm_config['model'],
                'metadata': json.loads(llm_config['metadata']) if llm_config['metadata'] else None
            }
            
            error_logs = []
            def log_callback(msg):
                print(f"[SkillPack Optimize LLM] {msg}")
                error_logs.append(msg)
            
            # 将MCP工具转换为LLM Function格式（OpenAI兼容）
            llm_functions = []
            if all_tools:
                for tool in all_tools:
                    llm_function = {
                        'type': 'function',
                        'function': {
                            'name': tool.get('name', ''),
                            'description': tool.get('description', ''),
                            'parameters': tool.get('inputSchema', {})
                        }
                    }
                    llm_functions.append(llm_function)
            
            try:
                # 如果提供了工具，使用支持工具调用的API
                if llm_functions and llm_config['provider'] in ['openai', 'anthropic', 'gemini']:
                    # 使用支持工具调用的方式调用LLM
                    optimized_result = call_llm_with_tools_for_optimization(
                        llm_config_dict=llm_config_dict,
                        system_prompt="你是一个专业的技能总结优化助手，擅长改进技能包总结的清晰度和完整性。你可以使用提供的工具来验证工具名称和参数。",
                        user_input=prompt,
                        tools=llm_functions,
                        tools_by_server=tools_by_server,
                        add_log=log_callback
                    )
                    
                    if not optimized_result:
                        error_detail = f"LLM API调用失败。"
                        if error_logs:
                            error_detail += f" 详细信息: {'; '.join(error_logs[-3:])}"
                        return jsonify({'error': error_detail}), 500
                    
                    # 解析优化后的响应
                    response_content = optimized_result.strip() if isinstance(optimized_result, str) else str(optimized_result)
                    lines = response_content.split('\n', 1)
                    
                    optimized_name = lines[0].strip()[:50] if lines else "未命名技能包"
                    optimized_summary = lines[1].strip() if len(lines) > 1 else response_content
                    
                    return jsonify({
                        'name': optimized_name,
                        'summary': optimized_summary,
                    }), 200
                else:
                    # 没有工具或LLM不支持工具调用，使用普通方式
                    llm_response = call_llm_api(
                        llm_config=llm_config_dict,
                        system_prompt="你是一个专业的技能总结优化助手，擅长改进技能包总结的清晰度和完整性。",
                        user_input=prompt,
                        add_log=log_callback
                    )
                    
                    if not llm_response:
                        error_detail = f"LLM API调用失败。"
                        if error_logs:
                            error_detail += f" 详细信息: {'; '.join(error_logs[-3:])}"
                        return jsonify({'error': error_detail}), 500
                    
                    # 解析优化后的响应
                    response_content = llm_response.strip() if isinstance(llm_response, str) else str(llm_response)
                    lines = response_content.split('\n', 1)
                    
                    optimized_name = lines[0].strip()[:50] if lines else "未命名技能包"
                    optimized_summary = lines[1].strip() if len(lines) > 1 else response_content
                    
                    return jsonify({
                        'name': optimized_name,
                        'summary': optimized_summary,
                    }), 200
                
            except Exception as llm_error:
                error_detail = f"LLM调用异常: {str(llm_error)}"
                if error_logs:
                    error_detail += f" 日志: {'; '.join(error_logs[-3:])}"
                return jsonify({'error': error_detail}), 500
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error optimizing skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/<skill_pack_id>', methods=['GET', 'OPTIONS'])
def get_skill_pack(skill_pack_id):
    """获取技能包详情"""
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
                SELECT skill_pack_id, name, summary, source_session_id, source_messages,
                       created_at, updated_at
                FROM skill_packs
                WHERE skill_pack_id = %s
            """, (skill_pack_id,))
            
            skill_pack = cursor.fetchone()
            if not skill_pack:
                return jsonify({'error': 'Skill pack not found'}), 404
            
            # 处理JSON字段和datetime
            if skill_pack['source_messages']:
                try:
                    skill_pack['source_messages'] = json.loads(skill_pack['source_messages']) if isinstance(skill_pack['source_messages'], str) else skill_pack['source_messages']
                except:
                    skill_pack['source_messages'] = []
            if skill_pack['created_at']:
                skill_pack['created_at'] = skill_pack['created_at'].isoformat()
            if skill_pack['updated_at']:
                skill_pack['updated_at'] = skill_pack['updated_at'].isoformat()
            
            return jsonify(skill_pack)
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error getting skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/<skill_pack_id>', methods=['PUT', 'OPTIONS'])
def update_skill_pack(skill_pack_id):
    """更新技能包"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        name = data.get('name')
        summary = data.get('summary')
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 构建更新语句
            update_fields = []
            update_values = []
            
            if name:
                update_fields.append('name = %s')
                update_values.append(name)
            if summary:
                update_fields.append('summary = %s')
                update_values.append(summary)
            
            if not update_fields:
                return jsonify({'error': 'No fields to update'}), 400
            
            update_values.append(skill_pack_id)
            
            cursor.execute(f"""
                UPDATE skill_packs
                SET {', '.join(update_fields)}
                WHERE skill_pack_id = %s
            """, update_values)
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Skill pack not found'}), 404
            
            conn.commit()
            
            return jsonify({'message': 'Skill pack updated successfully'})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error updating skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/<skill_pack_id>', methods=['DELETE', 'OPTIONS'])
def delete_skill_pack(skill_pack_id):
    """删除技能包"""
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
                DELETE FROM skill_packs
                WHERE skill_pack_id = %s
            """, (skill_pack_id,))
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Skill pack not found'}), 404
            
            conn.commit()
            
            return jsonify({'message': 'Skill pack deleted successfully'})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error deleting skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/<skill_pack_id>/assign', methods=['POST', 'OPTIONS'])
def assign_skill_pack(skill_pack_id):
    """分配技能包到记忆体/智能体"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        target_session_id = data.get('target_session_id')
        target_type = data.get('target_type')  # memory 或 agent
        
        if not target_session_id:
            return jsonify({'error': 'target_session_id is required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 验证技能包存在
            cursor.execute("SELECT skill_pack_id FROM skill_packs WHERE skill_pack_id = %s", (skill_pack_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Skill pack not found'}), 404
            
            # 验证目标会话存在并获取类型
            cursor.execute("SELECT session_id, session_type FROM sessions WHERE session_id = %s", (target_session_id,))
            session = cursor.fetchone()
            if not session:
                return jsonify({'error': 'Target session not found'}), 404
            
            # 如果未指定target_type，使用会话的实际类型
            if not target_type:
                target_type = session['session_type'] or 'memory'
            
            # 创建分配记录
            assignment_id = str(uuid.uuid4())
            
            cursor.execute("""
                INSERT INTO skill_pack_assignments
                (assignment_id, skill_pack_id, target_type, target_session_id)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP
            """, (assignment_id, skill_pack_id, target_type, target_session_id))
            
            conn.commit()
            
            return jsonify({
                'assignment_id': assignment_id,
                'skill_pack_id': skill_pack_id,
                'target_session_id': target_session_id,
                'target_type': target_type,
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error assigning skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/skill-packs/<skill_pack_id>/unassign', methods=['POST', 'OPTIONS'])
def unassign_skill_pack(skill_pack_id):
    """取消技能包分配"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        target_session_id = data.get('target_session_id')
        
        if not target_session_id:
            return jsonify({'error': 'target_session_id is required'}), 400
        
        cursor = None
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM skill_pack_assignments
                WHERE skill_pack_id = %s AND target_session_id = %s
            """, (skill_pack_id, target_session_id))
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Assignment not found'}), 404
            
            conn.commit()
            
            return jsonify({'message': 'Skill pack unassigned successfully'})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error unassigning skill pack: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/skill-packs', methods=['GET', 'OPTIONS'])
def get_session_skill_packs(session_id):
    """获取某会话已分配的技能包列表"""
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
                SELECT sp.skill_pack_id, sp.name, sp.summary, sp.source_session_id,
                       sp.created_at, sp.updated_at,
                       spa.assignment_id, spa.target_type, spa.created_at as assigned_at
                FROM skill_packs sp
                INNER JOIN skill_pack_assignments spa ON sp.skill_pack_id = spa.skill_pack_id
                WHERE spa.target_session_id = %s
                ORDER BY spa.created_at DESC
            """, (session_id,))
            
            skill_packs = cursor.fetchall()
            
            # 处理datetime
            for sp in skill_packs:
                if sp['created_at']:
                    sp['created_at'] = sp['created_at'].isoformat()
                if sp['updated_at']:
                    sp['updated_at'] = sp['updated_at'].isoformat()
                if sp['assigned_at']:
                    sp['assigned_at'] = sp['assigned_at'].isoformat()
            
            return jsonify({'skill_packs': skill_packs})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[SkillPack API] Error getting session skill packs: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/current-sop', methods=['GET', 'OPTIONS'])
def get_current_sop(session_id):
    """获取会话的当前SOP"""
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
            
            # 获取会话的ext
            cursor.execute("""
                SELECT ext FROM sessions WHERE session_id = %s
            """, (session_id,))
            row = cursor.fetchone()
            
            if not row:
                return jsonify({'error': 'Session not found'}), 404
            
            current_ext = {}
            if row.get('ext'):
                try:
                    current_ext = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
                except:
                    current_ext = {}
            
            current_sop_id = current_ext.get('currentSopSkillPackId')
            
            if not current_sop_id:
                return jsonify({'skill_pack': None})
            
            # 获取技能包详情
            cursor.execute("""
                SELECT skill_pack_id, name, summary, source_session_id, ext,
                       created_at, updated_at
                FROM skill_packs
                WHERE skill_pack_id = %s
            """, (current_sop_id,))
            
            skill_pack = cursor.fetchone()
            
            if skill_pack:
                if skill_pack['created_at']:
                    skill_pack['created_at'] = skill_pack['created_at'].isoformat()
                if skill_pack['updated_at']:
                    skill_pack['updated_at'] = skill_pack['updated_at'].isoformat()
                if skill_pack['ext']:
                    try:
                        skill_pack['ext'] = json.loads(skill_pack['ext']) if isinstance(skill_pack['ext'], str) else skill_pack['ext']
                    except:
                        skill_pack['ext'] = {}
            
            return jsonify({'skill_pack': skill_pack})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error getting current SOP: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/current-sop', methods=['PUT', 'OPTIONS'])
def set_current_sop(session_id):
    """设置会话的当前SOP"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        data = request.json
        skill_pack_id = data.get('skill_pack_id')  # 为null则取消当前SOP
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取当前会话的ext
            cursor.execute("""
                SELECT ext, session_type FROM sessions WHERE session_id = %s
            """, (session_id,))
            row = cursor.fetchone()
            
            if not row:
                return jsonify({'error': 'Session not found'}), 404
            
            current_ext = {}
            if row.get('ext'):
                try:
                    current_ext = json.loads(row['ext']) if isinstance(row['ext'], str) else row['ext']
                except:
                    current_ext = {}
            
            # 更新currentSopSkillPackId
            if skill_pack_id:
                # 验证技能包存在
                cursor.execute("""
                    SELECT skill_pack_id FROM skill_packs WHERE skill_pack_id = %s
                """, (skill_pack_id,))
                if not cursor.fetchone():
                    return jsonify({'error': 'Skill pack not found'}), 404
                    
                current_ext['currentSopSkillPackId'] = skill_pack_id
            else:
                # 取消当前SOP
                current_ext.pop('currentSopSkillPackId', None)
            
            cursor.execute("""
                UPDATE sessions SET ext = %s WHERE session_id = %s
            """, (json.dumps(current_ext), session_id))
            
            conn.commit()
            
            return jsonify({
                'message': 'Current SOP updated',
                'current_sop_skill_pack_id': skill_pack_id
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Session API] Error setting current SOP: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

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
            # result: 存到 message_executions.result / 返回给前端用于聊天摘要展示（避免塞入 base64）
            # raw_result/logs: 落库用于“会话扩展面板”回放
            result = None
            raw_result = None
            exec_logs = None
            error_message = None
            status = 'completed'
            
            try:
                if component_type == 'workflow':
                    # 执行工作流，使用聊天选择的LLM替换工作流中的LLM节点
                    workflow_exec = execute_workflow_with_llm(component_id, input_text, llm_config_id)
                    if isinstance(workflow_exec, dict):
                        if workflow_exec.get('error'):
                            status = 'error'
                            error_message = workflow_exec.get('error')
                        exec_logs = workflow_exec.get('logs')
                        raw_result = workflow_exec.get('raw_result')
                        result = workflow_exec.get('summary') or workflow_exec.get('result')
                    else:
                        result = workflow_exec
                elif component_type == 'mcp':
                    # 执行MCP，使用聊天选择的LLM驱动MCP工具
                    mcp_exec = execute_mcp_with_llm(component_id, input_text, llm_config_id)
                    if isinstance(mcp_exec, dict):
                        if mcp_exec.get('error'):
                            status = 'error'
                            error_message = mcp_exec.get('error')
                        exec_logs = mcp_exec.get('logs')
                        raw_result = mcp_exec.get('raw_result')
                        result = mcp_exec.get('summary') or mcp_exec.get('result')
                    else:
                        result = mcp_exec
                else:
                    raise ValueError(f'Unknown component type: {component_type}')
                
                # 兜底：保证 result 是字符串，避免把 raw_result（含 base64）落到 result 中
                if result is not None and not isinstance(result, str):
                    result = json.dumps(result, ensure_ascii=False, indent=2)
                    
            except Exception as e:
                status = 'error'
                error_message = str(e)
                print(f"[Message Execution] Error executing component: {e}")
                import traceback
                traceback.print_exc()
            
            # logs/raw_result 序列化落库（允许 None）
            logs_json = None
            raw_result_json = None
            try:
                if exec_logs is not None:
                    logs_json = json.dumps(exec_logs, ensure_ascii=False)
            except Exception as e:
                print(f"[Message Execution] Failed to serialize logs: {e}")
            try:
                if raw_result is not None:
                    raw_result_json = json.dumps(raw_result, ensure_ascii=False)
            except Exception as e:
                print(f"[Message Execution] Failed to serialize raw_result: {e}")
            
            # 更新执行记录
            cursor.execute("""
                UPDATE message_executions
                SET status = %s,
                    result = %s,
                    error_message = %s,
                    logs = %s,
                    raw_result = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE execution_id = %s
            """, (status, result, error_message, logs_json, raw_result_json, execution_id))
            
            # 如果是 MCP 执行，将详情保存到对应的 assistant 消息的 mcpdetail 字段
            # 找到同 session 中，在当前消息之前最近的 assistant 消息
            if component_type == 'mcp' and raw_result is not None:
                mcp_detail = {
                    'execution_id': execution_id,
                    'component_type': component_type,
                    'component_id': component_id,
                    'component_name': component_name,
                    'status': status,
                    'logs': exec_logs,
                    'raw_result': raw_result,
                    'error_message': error_message,
                    'executed_at': datetime.now().isoformat(),
                }
                mcp_detail_json = json.dumps(mcp_detail, ensure_ascii=False)
                
                # 查找对应的 assistant 消息（当前消息之前最近的 assistant 消息）
                cursor.execute("""
                    SELECT message_id 
                    FROM messages 
                    WHERE session_id = %s 
                      AND role = 'assistant'
                      AND created_at <= (SELECT created_at FROM messages WHERE message_id = %s)
                    ORDER BY created_at DESC 
                    LIMIT 1
                """, (message['session_id'], message_id))
                
                assistant_message = cursor.fetchone()
                if assistant_message:
                    # 更新 assistant 消息的 mcpdetail
                    cursor.execute("""
                        UPDATE messages 
                        SET mcpdetail = %s 
                        WHERE message_id = %s
                    """, (mcp_detail_json, assistant_message['message_id']))
                    print(f"[MCP Detail] Updated mcpdetail for assistant message {assistant_message['message_id']}")
            
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
            
            return {
                'summary': f'✅ 工作流 "{workflow["name"]}" 执行完成（详情见插件面板）',
                'raw_result': {
                    'workflow_id': workflow_id,
                    'workflow_name': workflow['name'],
                    'input': input_text,
                    'llm_config_id': llm_config_id,
                    'output_text': result_text,
                },
                'logs': logs,
            }
            
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
        return {'error': error_msg, 'logs': logs, 'raw_result': None, 'summary': None}

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
            
            # 4. 返回结果（结构化原始结果 + 过程日志 + 聊天摘要）
            tool_names = [r.get('tool') for r in results if r.get('tool')]
            tool_names_text = ', '.join(tool_names[:8]) + ('...' if len(tool_names) > 8 else '')
            summary = f'✅ MCP "{mcp_server["name"]}" 执行完成（{len(results)} 个工具调用：{tool_names_text}）——详情见插件面板'
            
            return {
                'summary': summary,
                'raw_result': {
                    'mcp_server_id': mcp_server_id,
                    'mcp_server_name': mcp_server['name'],
                    'mcp_server_url': mcp_server['url'],
                    'input': input_text,
                    'tool_calls': tool_calls,
                    'results': results,  # results[i].result 保留原始 MCP jsonrpc（含 base64 图片）
                },
                'logs': logs,
            }
            
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
        return {'error': error_msg, 'logs': logs, 'raw_result': None, 'summary': None}

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
        url = api_url or default_url
        
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
            
    elif provider == 'gemini':
        default_url = 'https://generativelanguage.googleapis.com/v1beta'
        base_url = api_url or default_url
        model_name = model or 'gemini-2.5-flash'
        
        # 构建完整的 API URL
        if base_url.endswith('/'):
            url = f"{base_url}models/{model_name}:generateContent"
        else:
            url = f"{base_url}/models/{model_name}:generateContent"
        
        # 转换消息格式为 Gemini 格式
        contents = [
            {
                'role': 'user',
                'parts': [{'text': f"{system_prompt}\n\n用户输入: {user_input}"}]
            }
        ]
        
        payload = {
            'contents': contents,
            'generationConfig': {
                'temperature': 1.0,  # Gemini 推荐使用默认温度
            },
        }
        
        # 只在metadata中明确指定thinking_level时才添加（某些模型不支持此字段）
        if llm_config.get('metadata') and llm_config['metadata'].get('thinking_level'):
            payload['generationConfig']['thinkingLevel'] = llm_config['metadata']['thinking_level']
        
        headers = {
            'x-goog-api-key': api_key,
            'Content-Type': 'application/json',
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.ok:
            data = response.json()
            if data.get('candidates') and len(data['candidates']) > 0:
                candidate = data['candidates'][0]
                if candidate.get('content') and candidate['content'].get('parts'):
                    # 提取所有文本内容
                    text_parts = [part.get('text', '') for part in candidate['content']['parts'] if part.get('text')]
                    return ''.join(text_parts)
            return None
        else:
            if add_log:
                error_data = response.json() if response.content else {}
                error_msg = error_data.get('error', {}).get('message', response.text)
                add_log(f"❌ LLM API调用失败: {response.status_code} - {error_msg}")
            return None
    else:
        if add_log:
            add_log(f"❌ 不支持的LLM提供商: {provider}")
        return None

def call_llm_with_tools_for_optimization(llm_config_dict: dict, system_prompt: str, user_input: str, tools: list, tools_by_server: dict, add_log=None, max_iterations: int = 5):
    """
    使用工具调用优化技能包总结
    支持多轮对话：LLM可以调用工具，然后基于工具结果继续优化
    """
    if add_log:
        add_log(f"使用工具调用优化技能包（最多{max_iterations}轮）")
    
    provider = llm_config_dict['provider']
    api_key = llm_config_dict.get('api_key', '')
    api_url = llm_config_dict.get('api_url', '')
    model = llm_config_dict.get('model', '')
    
    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_input}
    ]
    
    iteration = 0
    while iteration < max_iterations:
        iteration += 1
        if add_log:
            add_log(f"第 {iteration} 轮优化...")
        
        if provider == 'openai':
            default_url = 'https://api.openai.com/v1/chat/completions'
            url = api_url or default_url
            
            payload = {
                'model': model,
                'messages': messages,
                'temperature': 0.7,
                'tools': tools if tools else None,
                'tool_choice': 'auto' if tools else None,
            }
            
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            }
            
            response = requests.post(url, json=payload, headers=headers, timeout=120)
            if not response.ok:
                if add_log:
                    add_log(f"❌ LLM API调用失败: {response.status_code} - {response.text}")
                return None
            
            data = response.json()
            message = data['choices'][0]['message']
            
            # 检查是否有工具调用
            if message.get('tool_calls'):
                if add_log:
                    add_log(f"LLM请求调用 {len(message['tool_calls'])} 个工具")
                
                # 添加助手消息（包含工具调用）
                messages.append({
                    'role': 'assistant',
                    'content': message.get('content', ''),
                    'tool_calls': message['tool_calls']
                })
                
                # 执行工具调用
                from mcp_server.mcp_common_logic import call_mcp_tool, prepare_mcp_headers
                
                for tool_call in message['tool_calls']:
                    tool_name = tool_call['function']['name']
                    tool_args = json.loads(tool_call['function']['arguments'])
                    
                    if add_log:
                        add_log(f"执行工具: {tool_name}")
                    
                    # 找到工具对应的MCP服务器
                    tool_result = None
                    for server_name, server_tools in tools_by_server.items():
                        for tool in server_tools:
                            if tool.get('name') == tool_name:
                                # 找到对应的服务器，执行工具调用
                                # 需要从数据库获取服务器URL
                                from database import get_mysql_connection
                                conn = get_mysql_connection()
                                if conn:
                                    try:
                                        cursor = conn.cursor(pymysql.cursors.DictCursor)
                                        cursor.execute("""
                                            SELECT url, metadata, ext
                                            FROM mcp_servers
                                            WHERE name = %s AND enabled = 1
                                            LIMIT 1
                                        """, (server_name,))
                                        server_row = cursor.fetchone()
                                        if server_row:
                                            server_url = server_row['url']
                                            base_headers = {
                                                'Content-Type': 'application/json',
                                                'Accept': 'application/json',
                                                'mcp-protocol-version': '2025-06-18',
                                            }
                                            headers = prepare_mcp_headers(server_url, base_headers, base_headers)
                                            
                                            tool_result = call_mcp_tool(server_url, tool_name, tool_args, headers)
                                            if add_log:
                                                if tool_result:
                                                    add_log(f"工具 {tool_name} 执行成功")
                                                else:
                                                    add_log(f"工具 {tool_name} 执行失败")
                                        cursor.close()
                                    except Exception as e:
                                        if add_log:
                                            add_log(f"执行工具 {tool_name} 时出错: {str(e)}")
                                    finally:
                                        if conn:
                                            conn.close()
                                break
                        
                        if tool_result is not None:
                            break
                    
                    # 添加工具结果到消息历史
                    messages.append({
                        'role': 'tool',
                        'tool_call_id': tool_call['id'],
                        'content': json.dumps(tool_result, ensure_ascii=False) if tool_result else json.dumps({'error': 'Tool execution failed'}, ensure_ascii=False)
                    })
                
                # 继续下一轮，让LLM基于工具结果继续优化
                continue
            else:
                # 没有工具调用，返回最终结果
                final_content = message.get('content', '')
                if add_log:
                    add_log(f"优化完成（共 {iteration} 轮）")
                return final_content
        
        elif provider == 'anthropic':
            # Anthropic Claude 支持工具调用
            default_url = 'https://api.anthropic.com/v1/messages'
            url = api_url or default_url
            
            # 转换消息格式
            anthropic_messages = []
            anthropic_system_prompt = system_prompt  # 使用传入的system_prompt
            for msg in messages:
                if msg['role'] == 'system':
                    # Anthropic 的 system 消息需要单独处理
                    anthropic_system_prompt = msg['content']
                elif msg['role'] == 'user':
                    anthropic_messages.append({'role': 'user', 'content': msg['content']})
                elif msg['role'] == 'assistant':
                    content = []
                    if msg.get('content'):
                        content.append({'type': 'text', 'text': msg['content']})
                    if msg.get('tool_calls'):
                        for tool_call in msg['tool_calls']:
                            content.append({
                                'type': 'tool_use',
                                'id': tool_call['id'],
                                'name': tool_call['function']['name'],
                                'input': json.loads(tool_call['function']['arguments'])
                            })
                    anthropic_messages.append({'role': 'assistant', 'content': content})
                elif msg['role'] == 'tool':
                    anthropic_messages.append({
                        'role': 'user',
                        'content': [{
                            'type': 'tool_result',
                            'tool_use_id': msg['tool_call_id'],
                            'content': msg['content']
                        }]
                    })
            
            # 转换工具格式
            anthropic_tools = []
            if tools:
                for tool in tools:
                    anthropic_tools.append({
                        'name': tool['function']['name'],
                        'description': tool['function']['description'],
                        'input_schema': tool['function']['parameters']
                    })
            
            payload = {
                'model': model,
                'max_tokens': 4096,
                'messages': anthropic_messages,
                'system': anthropic_system_prompt,
            }
            
            if anthropic_tools:
                payload['tools'] = anthropic_tools
            
            headers = {
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            }
            
            response = requests.post(url, json=payload, headers=headers, timeout=120)
            if not response.ok:
                if add_log:
                    add_log(f"❌ LLM API调用失败: {response.status_code} - {response.text}")
                return None
            
            data = response.json()
            content = data.get('content', [])
            
            # 检查是否有工具使用
            tool_uses = [item for item in content if item.get('type') == 'tool_use']
            if tool_uses:
                if add_log:
                    add_log(f"LLM请求调用 {len(tool_uses)} 个工具")
                
                # 添加助手消息
                assistant_content = []
                text_items = [item for item in content if item.get('type') == 'text']
                if text_items:
                    assistant_content.append({'type': 'text', 'text': text_items[0]['text']})
                for tool_use in tool_uses:
                    assistant_content.append(tool_use)
                
                messages.append({
                    'role': 'assistant',
                    'content': assistant_content,
                    'tool_calls': [{
                        'id': tool_use['id'],
                        'function': {
                            'name': tool_use['name'],
                            'arguments': json.dumps(tool_use['input'], ensure_ascii=False)
                        }
                    } for tool_use in tool_uses]
                })
                
                # 执行工具调用（类似 OpenAI 的处理）
                from mcp_server.mcp_common_logic import call_mcp_tool, prepare_mcp_headers
                
                for tool_use in tool_uses:
                    tool_name = tool_use['name']
                    tool_args = tool_use['input']
                    
                    if add_log:
                        add_log(f"执行工具: {tool_name}")
                    
                    # 找到工具对应的MCP服务器并执行
                    tool_result = None
                    for server_name, server_tools in tools_by_server.items():
                        for tool in server_tools:
                            if tool.get('name') == tool_name:
                                from database import get_mysql_connection
                                conn = get_mysql_connection()
                                if conn:
                                    try:
                                        cursor = conn.cursor(pymysql.cursors.DictCursor)
                                        cursor.execute("""
                                            SELECT url, metadata, ext
                                            FROM mcp_servers
                                            WHERE name = %s AND enabled = 1
                                            LIMIT 1
                                        """, (server_name,))
                                        server_row = cursor.fetchone()
                                        if server_row:
                                            server_url = server_row['url']
                                            base_headers = {
                                                'Content-Type': 'application/json',
                                                'Accept': 'application/json',
                                                'mcp-protocol-version': '2025-06-18',
                                            }
                                            headers = prepare_mcp_headers(server_url, base_headers, base_headers)
                                            tool_result = call_mcp_tool(server_url, tool_name, tool_args, headers)
                                        cursor.close()
                                    except Exception as e:
                                        if add_log:
                                            add_log(f"执行工具 {tool_name} 时出错: {str(e)}")
                                    finally:
                                        if conn:
                                            conn.close()
                                break
                        
                        if tool_result is not None:
                            break
                    
                    # 添加工具结果
                    messages.append({
                        'role': 'tool',
                        'tool_call_id': tool_use['id'],
                        'content': json.dumps(tool_result, ensure_ascii=False) if tool_result else json.dumps({'error': 'Tool execution failed'}, ensure_ascii=False)
                    })
                
                continue
            else:
                # 没有工具使用，返回最终结果
                text_items = [item for item in content if item.get('type') == 'text']
                if text_items:
                    final_content = text_items[0]['text']
                    if add_log:
                        add_log(f"优化完成（共 {iteration} 轮）")
                    return final_content
                return None
        
        elif provider == 'gemini':
            # Gemini 目前不支持标准的工具调用格式，回退到普通调用
            if add_log:
                add_log("Gemini 暂不支持工具调用，使用普通模式")
            return call_llm_api(llm_config_dict, system_prompt, user_input, add_log)
        
        else:
            if add_log:
                add_log(f"❌ 不支持的LLM提供商: {provider}")
            return None
    
    # 达到最大迭代次数，返回最后一轮的结果
    if add_log:
        add_log(f"达到最大迭代次数 {max_iterations}，返回当前结果")
    
    # 尝试从最后一条消息中提取内容
    if messages and messages[-1].get('role') == 'assistant':
        return messages[-1].get('content', '')
    
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
                       llm_config_id, input, result, status, error_message, logs, raw_result,
                       created_at, updated_at
                FROM message_executions
                WHERE message_id = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (message_id,))
            
            execution = cursor.fetchone()
            if not execution:
                return jsonify({'error': 'Execution not found'}), 404
            
            # 尝试解析 logs/raw_result 为结构化对象
            parsed_logs = None
            parsed_raw_result = None
            try:
                if execution.get('logs'):
                    parsed_logs = json.loads(execution['logs'])
            except Exception:
                parsed_logs = execution.get('logs')
            try:
                if execution.get('raw_result'):
                    parsed_raw_result = json.loads(execution['raw_result'])
            except Exception:
                parsed_raw_result = execution.get('raw_result')
            
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
                'logs': parsed_logs,
                'raw_result': parsed_raw_result,
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

@app.route('/api/sessions/<session_id>/executions', methods=['GET', 'OPTIONS'])
def list_session_executions(session_id):
    """列出会话内所有消息执行记录（用于会话扩展面板的时间线视图）"""
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
                SELECT me.execution_id, me.message_id, me.component_type, me.component_id, me.component_name,
                       me.status, me.error_message, me.created_at, me.updated_at
                FROM message_executions me
                INNER JOIN messages m ON m.message_id = me.message_id
                WHERE m.session_id = %s
                ORDER BY me.created_at DESC
            """, (session_id,))
            
            rows = cursor.fetchall() or []
            return jsonify([
                {
                    'execution_id': r.get('execution_id'),
                    'message_id': r.get('message_id'),
                    'component_type': r.get('component_type'),
                    'component_id': r.get('component_id'),
                    'component_name': r.get('component_name'),
                    'status': r.get('status'),
                    'error_message': r.get('error_message'),
                    'created_at': r.get('created_at').isoformat() if r.get('created_at') else None,
                    'updated_at': r.get('updated_at').isoformat() if r.get('updated_at') else None,
                }
                for r in rows
            ])
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Message Execution API] Error listing session executions: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== 爬虫模块 API ====================

@app.route('/api/crawler/fetch', methods=['POST', 'OPTIONS'])
def crawler_fetch():
    """爬取网页"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from web_crawler import WebCrawler
        
        data = request.json
        if not data or 'url' not in data:
            return jsonify({'success': False, 'error': 'INVALID_REQUEST', 'message': '缺少url参数'}), 400
        
        url = data.get('url')
        options = data.get('options', {})
        
        # 验证URL格式
        if not url.startswith(('http://', 'https://')):
            return jsonify({
                'success': False,
                'error': 'INVALID_URL',
                'message': 'URL格式无效，必须以http://或https://开头',
                'url': url
            }), 400
        
        # 创建爬虫实例
        crawler_config = config.get('crawler', {})
        default_timeout = crawler_config.get('default_timeout', 30)
        default_user_agent = crawler_config.get('default_user_agent')
        
        crawler = WebCrawler(
            default_timeout=default_timeout,
            default_user_agent=default_user_agent
        )
        
        # 执行爬取
        result = crawler.fetch(url, options)
        
        # 返回结果
        if result.get('success'):
            return jsonify(result), 200
        else:
            status_code = 500
            if result.get('error') == 'TIMEOUT':
                status_code = 408
            elif result.get('error') == 'CONNECTION_ERROR':
                status_code = 502
            elif result.get('error') == 'AUTHENTICATION_REQUIRED':
                status_code = 401
            elif result.get('error') == 'AUTHENTICATION_FAILED':
                status_code = 403
            elif result.get('error') == 'INVALID_URL':
                status_code = 400
            
            return jsonify(result), status_code
            
    except Exception as e:
        print(f"[Crawler API] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': 'UNKNOWN_ERROR',
            'message': str(e),
            'url': data.get('url', '') if 'data' in locals() else ''
        }), 500

@app.route('/api/crawler/normalize', methods=['POST', 'OPTIONS'])
def crawler_normalize():
    """实时标准化预览（用于前端预览）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from crawler_normalizer import CrawlerNormalizer
        
        data = request.json
        if not data or 'raw_data' not in data:
            return jsonify({'success': False, 'error': 'INVALID_REQUEST', 'message': '缺少raw_data参数'}), 400
        
        raw_data = data.get('raw_data')
        normalize_config = data.get('normalize_config', {})
        
        # 执行标准化
        normalizer = CrawlerNormalizer()
        normalized_result = normalizer.normalize(raw_data, normalize_config)
        
        response = jsonify({
            'success': True,
            'normalized': normalized_result.get('normalized', {})
        })
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 200
        
    except Exception as e:
        print(f"[Crawler API] Normalize error: {e}")
        import traceback
        traceback.print_exc()
        response = jsonify({
            'success': False,
            'error': 'UNKNOWN_ERROR',
            'message': str(e)
        })
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500

@app.route('/api/crawler/modules', methods=['GET', 'POST', 'OPTIONS'])
def crawler_modules():
    """模块管理：获取列表或创建模块"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        if request.method == 'GET':
            # 获取模块列表
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT 
                    module_id,
                    module_name,
                    description,
                    target_url,
                    created_at,
                    updated_at
                FROM crawler_modules
                ORDER BY created_at DESC
            """)
            modules = cursor.fetchall()
            
            # 转换为字典列表
            result = []
            for module in modules:
                result.append({
                    'module_id': module['module_id'],
                    'module_name': module['module_name'],
                    'description': module['description'],
                    'target_url': module['target_url'],
                    'created_at': module['created_at'].isoformat() if module['created_at'] else None,
                    'updated_at': module['updated_at'].isoformat() if module['updated_at'] else None,
                })
            
            cursor.close()
            conn.close()
            return jsonify({'modules': result}), 200
        
        elif request.method == 'POST':
            # 创建模块
            data = request.json
            if not data or 'module_name' not in data or 'target_url' not in data:
                return jsonify({'error': '缺少必要参数：module_name, target_url'}), 400
            
            module_id = f"module_{int(time.time() * 1000)}"
            module_name = data.get('module_name')
            description = data.get('description')
            target_url = data.get('target_url')
            crawler_options = data.get('crawler_options')
            normalize_config = data.get('normalize_config')
            
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                INSERT INTO crawler_modules 
                (module_id, module_name, description, target_url, crawler_options, normalize_config)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                module_id,
                module_name,
                description,
                target_url,
                json.dumps(crawler_options, ensure_ascii=False) if crawler_options else None,
                json.dumps(normalize_config, ensure_ascii=False) if normalize_config else None
            ))
            conn.commit()
            
            # 获取创建的模块
            cursor.execute("""
                SELECT * FROM crawler_modules WHERE module_id = %s
            """, (module_id,))
            module = cursor.fetchone()
            
            result = {
                'module_id': module['module_id'],
                'module_name': module['module_name'],
                'description': module['description'],
                'target_url': module['target_url'],
                'crawler_options': json.loads(module['crawler_options']) if module['crawler_options'] else None,
                'normalize_config': json.loads(module['normalize_config']) if module['normalize_config'] else None,
                'created_at': module['created_at'].isoformat() if module['created_at'] else None,
                'updated_at': module['updated_at'].isoformat() if module['updated_at'] else None,
            }
            
            cursor.close()
            conn.close()
            return jsonify(result), 201
            
    except Exception as e:
        print(f"[Crawler Modules API] Error: {e}")
        import traceback
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/crawler/modules/<module_id>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def crawler_module_detail(module_id):
    """模块详情：获取、更新、删除"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        if request.method == 'GET':
            # 获取模块详情
            cursor.execute("""
                SELECT * FROM crawler_modules WHERE module_id = %s
            """, (module_id,))
            module = cursor.fetchone()
            
            if not module:
                cursor.close()
                conn.close()
                return jsonify({'error': 'Module not found'}), 404
            
            result = {
                'module_id': module['module_id'],
                'module_name': module['module_name'],
                'description': module['description'],
                'target_url': module['target_url'],
                'crawler_options': json.loads(module['crawler_options']) if module['crawler_options'] else None,
                'normalize_config': json.loads(module['normalize_config']) if module['normalize_config'] else None,
                'created_at': module['created_at'].isoformat() if module['created_at'] else None,
                'updated_at': module['updated_at'].isoformat() if module['updated_at'] else None,
            }
            
            cursor.close()
            conn.close()
            return jsonify(result), 200
        
        elif request.method == 'PUT':
            # 更新模块
            data = request.json
            if not data:
                return jsonify({'error': '缺少请求体'}), 400
            
            # 检查模块是否存在
            cursor.execute("SELECT module_id FROM crawler_modules WHERE module_id = %s", (module_id,))
            if not cursor.fetchone():
                cursor.close()
                conn.close()
                return jsonify({'error': 'Module not found'}), 404
            
            # 构建更新语句
            update_fields = []
            update_values = []
            
            if 'module_name' in data:
                update_fields.append('module_name = %s')
                update_values.append(data['module_name'])
            if 'description' in data:
                update_fields.append('description = %s')
                update_values.append(data['description'])
            if 'target_url' in data:
                update_fields.append('target_url = %s')
                update_values.append(data['target_url'])
            if 'crawler_options' in data:
                update_fields.append('crawler_options = %s')
                update_values.append(json.dumps(data['crawler_options'], ensure_ascii=False) if data['crawler_options'] else None)
            if 'normalize_config' in data:
                update_fields.append('normalize_config = %s')
                update_values.append(json.dumps(data['normalize_config'], ensure_ascii=False) if data['normalize_config'] else None)
            
            if not update_fields:
                cursor.close()
                conn.close()
                return jsonify({'error': '没有要更新的字段'}), 400
            
            update_values.append(module_id)
            sql = f"UPDATE crawler_modules SET {', '.join(update_fields)} WHERE module_id = %s"
            cursor.execute(sql, update_values)
            conn.commit()
            
            # 获取更新后的模块
            cursor.execute("SELECT * FROM crawler_modules WHERE module_id = %s", (module_id,))
            module = cursor.fetchone()
            
            result = {
                'module_id': module['module_id'],
                'module_name': module['module_name'],
                'description': module['description'],
                'target_url': module['target_url'],
                'crawler_options': json.loads(module['crawler_options']) if module['crawler_options'] else None,
                'normalize_config': json.loads(module['normalize_config']) if module['normalize_config'] else None,
                'created_at': module['created_at'].isoformat() if module['created_at'] else None,
                'updated_at': module['updated_at'].isoformat() if module['updated_at'] else None,
            }
            
            cursor.close()
            conn.close()
            return jsonify(result), 200
        
        elif request.method == 'DELETE':
            # 删除模块（级联删除批次）
            cursor.execute("SELECT module_id FROM crawler_modules WHERE module_id = %s", (module_id,))
            if not cursor.fetchone():
                cursor.close()
                conn.close()
                return jsonify({'error': 'Module not found'}), 404
            
            cursor.execute("DELETE FROM crawler_modules WHERE module_id = %s", (module_id,))
            conn.commit()
            
            cursor.close()
            conn.close()
            return jsonify({'message': 'Module deleted successfully'}), 200
            
    except Exception as e:
        print(f"[Crawler Module Detail API] Error: {e}")
        import traceback
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/crawler/modules/<module_id>/batches', methods=['GET', 'POST', 'OPTIONS'])
def crawler_module_batches(module_id):
    """批次管理：获取列表或创建批次"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection, get_redis_client
        from web_crawler import WebCrawler
        from crawler_normalizer import CrawlerNormalizer
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # 检查模块是否存在
        cursor.execute("SELECT * FROM crawler_modules WHERE module_id = %s", (module_id,))
        module = cursor.fetchone()
        if not module:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Module not found'}), 404
        
        if request.method == 'GET':
            # 获取批次列表
            cursor.execute("""
                SELECT 
                    batch_id,
                    batch_name,
                    crawled_at,
                    status,
                    error_message,
                    parsed_data
                FROM crawler_batches
                WHERE module_id = %s
                ORDER BY crawled_at DESC
            """, (module_id,))
            batches = cursor.fetchall()
            
            result = []
            for batch in batches:
                # 优先从parsed_data字段获取数据条数
                item_count = 0
                try:
                    if batch.get('parsed_data'):
                        parsed_data = batch['parsed_data']
                        if isinstance(parsed_data, str):
                            parsed_data = json.loads(parsed_data)
                        if isinstance(parsed_data, list):
                            item_count = len(parsed_data)
                except Exception as e:
                    print(f"[Crawler Batches API] Error reading parsed_data for batch {batch['batch_id']}: {e}")
                
                # 如果parsed_data没有数据，尝试从Redis缓存获取
                if item_count == 0:
                    try:
                        redis_client = get_redis_client()
                        if redis_client:
                            cache_key = f"crawler:module:{module_id}:batch:{batch['batch_name']}"
                            cached = redis_client.get(cache_key)
                            if cached:
                                # 确保正确解码（Redis返回bytes）
                                if isinstance(cached, bytes):
                                    cached = cached.decode('utf-8')
                                cached_data = json.loads(cached)
                                normalized = cached_data.get('normalized', {})
                                item_count = normalized.get('total_count', 0)
                    except Exception as e:
                        print(f"[Crawler Batches API] Error reading cache for batch {batch['batch_id']}: {e}")
                
                result.append({
                    'batch_id': batch['batch_id'],
                    'batch_name': batch['batch_name'],
                    'crawled_at': batch['crawled_at'].isoformat() if batch['crawled_at'] else None,
                    'status': batch['status'],
                    'error_message': batch['error_message'],
                    'item_count': item_count
                })
            
            cursor.close()
            conn.close()
            return jsonify({'batches': result}), 200
        
        elif request.method == 'POST':
            # 创建批次（执行爬取）
            data = request.json or {}
            batch_name = data.get('batch_name')
            force_refresh = data.get('force_refresh', False)
            
            if not batch_name:
                batch_name = datetime.now().strftime('%Y-%m-%d')
            
            # 检查批次是否已存在
            cursor.execute("""
                SELECT batch_id, status FROM crawler_batches 
                WHERE module_id = %s AND batch_name = %s
            """, (module_id, batch_name))
            existing_batch = cursor.fetchone()
            
            if existing_batch and not force_refresh:
                # 返回已存在的批次（从Redis或MySQL获取）
                batch_id = existing_batch['batch_id']
                
                # 尝试从Redis获取
                try:
                    redis_client = get_redis_client()
                    if redis_client:
                        cache_key = f"crawler:module:{module_id}:batch:{batch_name}"
                        cached = redis_client.get(cache_key)
                        if cached:
                            # 确保正确解码（Redis返回bytes）
                            if isinstance(cached, bytes):
                                cached = cached.decode('utf-8')
                            cursor.close()
                            conn.close()
                            return jsonify(json.loads(cached)), 200
                except:
                    pass
                
                # 从MySQL获取
                cursor.execute("SELECT * FROM crawler_batches WHERE batch_id = %s", (batch_id,))
                batch = cursor.fetchone()
                
                # 安全地解析 parsed_data（可能是 NULL）
                parsed_data_value = None
                if batch.get('parsed_data'):
                    try:
                        parsed_data_value = json.loads(batch['parsed_data'])
                    except (TypeError, ValueError) as e:
                        print(f"[Crawler Batches API] Warning: Failed to parse parsed_data: {e}")
                        parsed_data_value = None
                
                result = {
                    'batch_id': batch['batch_id'],
                    'module_id': batch['module_id'],
                    'batch_name': batch['batch_name'],
                    'crawled_data': json.loads(batch['crawled_data']),
                    'parsed_data': parsed_data_value,
                    'crawled_at': batch['crawled_at'].isoformat() if batch['crawled_at'] else None,
                    'status': batch['status'],
                    'error_message': batch['error_message']
                }
                
                cursor.close()
                conn.close()
                response = jsonify(result)
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response, 200
            
            # 执行爬取
            target_url = module['target_url']
            crawler_options = json.loads(module['crawler_options']) if module['crawler_options'] else {}
            normalize_config = json.loads(module['normalize_config']) if module['normalize_config'] else {}
            
            # 保存配置快照（用于快速创建新批次）
            config_snapshot = {
                'target_url': target_url,
                'crawler_options': crawler_options,
                'normalize_config': normalize_config
            }
            
            # 创建批次记录（pending状态）
            batch_id = f"batch_{int(time.time() * 1000)}"
            cursor.execute("""
                INSERT INTO crawler_batches 
                (batch_id, module_id, batch_name, crawled_data, crawler_config_snapshot, status)
                VALUES (%s, %s, %s, %s, %s, 'running')
            """, (batch_id, module_id, batch_name, json.dumps({}), json.dumps(config_snapshot)))
            conn.commit()
            
            try:
                # 执行爬取
                crawler_config = config.get('crawler', {})
                default_timeout = crawler_config.get('default_timeout', 30)
                default_user_agent = crawler_config.get('default_user_agent')
                
                crawler = WebCrawler(
                    default_timeout=default_timeout,
                    default_user_agent=default_user_agent
                )
                
                raw_result = crawler.fetch(target_url, crawler_options)
                
                if not raw_result.get('success'):
                    # 爬取失败
                    cursor.execute("""
                        UPDATE crawler_batches 
                        SET status = 'error', error_message = %s
                        WHERE batch_id = %s
                    """, (raw_result.get('message', 'Unknown error'), batch_id))
                    conn.commit()
                    
                    cursor.close()
                    conn.close()
                    return jsonify({
                        'success': False,
                        'error': raw_result.get('error'),
                        'message': raw_result.get('message'),
                        'batch_id': batch_id
                    }), 500
                
                # 标准化处理
                normalizer = CrawlerNormalizer()
                normalized_result = normalizer.normalize(raw_result, normalize_config)
                
                # 保存到数据库（保存完整的数据结构，包含 normalized 字段）
                crawled_data_to_save = {
                    'normalized': normalized_result
                }
                cursor.execute("""
                    UPDATE crawler_batches 
                    SET crawled_data = %s, status = 'completed', error_message = NULL
                    WHERE batch_id = %s
                """, (json.dumps(crawled_data_to_save, ensure_ascii=False), batch_id))
                conn.commit()
                
                # 缓存到Redis（缓存完整的数据结构，与数据库保持一致）
                try:
                    redis_client = get_redis_client()
                    if redis_client:
                        cache_key = f"crawler:module:{module_id}:batch:{batch_name}"
                        redis_client.setex(cache_key, 86400, json.dumps(crawled_data_to_save, ensure_ascii=False))  # 24小时
                except Exception as e:
                    print(f"[Crawler] Error caching batch: {e}")
                
                # 返回结果（确保数据结构一致：crawled_data 包含 normalized 字段）
                result = {
                    'batch_id': batch_id,
                    'module_id': module_id,
                    'batch_name': batch_name,
                    'crawled_data': {
                        'normalized': normalized_result
                    },
                    'crawled_at': datetime.now().isoformat(),
                    'status': 'completed'
                }
                
                cursor.close()
                conn.close()
                return jsonify(result), 201
                
            except Exception as e:
                # 更新错误状态
                cursor.execute("""
                    UPDATE crawler_batches 
                    SET status = 'error', error_message = %s
                    WHERE batch_id = %s
                """, (str(e), batch_id))
                conn.commit()
                
                cursor.close()
                conn.close()
                return jsonify({
                    'success': False,
                    'error': 'CRAWL_ERROR',
                    'message': str(e),
                    'batch_id': batch_id
                }), 500
            
    except Exception as e:
        print(f"[Crawler Batches API] Error: {e}")
        import traceback
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/crawler/modules/<module_id>/batches/<batch_id>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def crawler_batch_detail(module_id, batch_id):
    """批次详情：获取、更新或删除"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        from database import get_redis_client
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        if request.method == 'GET':
            # 先尝试从Redis获取
            try:
                cursor.execute("""
                    SELECT batch_name FROM crawler_batches 
                    WHERE batch_id = %s AND module_id = %s
                """, (batch_id, module_id))
                batch_info = cursor.fetchone()
                
                if batch_info:
                    redis_client = get_redis_client()
                    if redis_client:
                        cache_key = f"crawler:module:{module_id}:batch:{batch_info['batch_name']}"
                        cached = redis_client.get(cache_key)
                        if cached:
                            # 确保正确解码（Redis返回bytes）
                            if isinstance(cached, bytes):
                                cached = cached.decode('utf-8')
                            cursor.close()
                            conn.close()
                            return jsonify(json.loads(cached)), 200
            except:
                pass
            
            # 从MySQL获取
            cursor.execute("""
                SELECT * FROM crawler_batches 
                WHERE batch_id = %s AND module_id = %s
            """, (batch_id, module_id))
            batch = cursor.fetchone()
            
            if not batch:
                cursor.close()
                conn.close()
                return jsonify({'error': 'Batch not found'}), 404
            
            # 安全地解析 parsed_data（可能是 NULL）
            parsed_data_value = None
            if batch.get('parsed_data'):
                try:
                    parsed_data_value = json.loads(batch['parsed_data'])
                except (TypeError, ValueError) as e:
                    print(f"[Crawler Batch Detail API] Warning: Failed to parse parsed_data: {e}")
                    parsed_data_value = None
            
            result = {
                'batch_id': batch['batch_id'],
                'module_id': batch['module_id'],
                'batch_name': batch['batch_name'],
                'crawled_data': json.loads(batch['crawled_data']),
                'parsed_data': parsed_data_value,
                'crawled_at': batch['crawled_at'].isoformat() if batch['crawled_at'] else None,
                'status': batch['status'],
                'error_message': batch['error_message']
            }
            
            cursor.close()
            conn.close()
            response = jsonify(result)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 200
        
        elif request.method == 'PUT':
            # 更新批次的 parsed_data
            print(f"[Crawler Batch Detail API] PUT request received for batch_id={batch_id}, module_id={module_id}")
            data = request.json or {}
            print(f"[Crawler Batch Detail API] Request data: {data}")
            parsed_data = data.get('parsed_data')
            
            if parsed_data is None:
                print(f"[Crawler Batch Detail API] Error: parsed_data is None")
                cursor.close()
                conn.close()
                response = jsonify({'error': 'parsed_data is required'})
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response, 400
            
            # 检查批次是否存在
            cursor.execute("""
                SELECT batch_id FROM crawler_batches 
                WHERE batch_id = %s AND module_id = %s
            """, (batch_id, module_id))
            batch_check = cursor.fetchone()
            if not batch_check:
                print(f"[Crawler Batch Detail API] Error: Batch not found")
                cursor.close()
                conn.close()
                response = jsonify({'error': 'Batch not found'})
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response, 404
            
            # 将 parsed_data 转换为简单的 JSON 结构（只包含 title 和 content）
            # 如果传入的是包含 items 的对象，提取 items 数组
            # 如果传入的是数组，直接使用
            # 最终保存为数组格式，每个元素包含 title 和 content
            simple_parsed_data = None
            try:
                if isinstance(parsed_data, dict):
                    # 如果传入的是对象，提取 items 数组
                    items = parsed_data.get('items', [])
                    print(f"[Crawler Batch Detail API] Parsed data is dict, items count: {len(items) if isinstance(items, list) else 0}")
                    if isinstance(items, list) and len(items) > 0:
                        # 转换为简单的数组结构，每个元素只包含 title 和 content
                        simple_parsed_data = []
                        for item in items:
                            title = item.get('title', '') if isinstance(item, dict) else ''
                            content = item.get('content', '') if isinstance(item, dict) else ''
                            # 保留所有项，即使 title 和 content 都为空（避免数据丢失）
                            simple_parsed_data.append({
                                'title': title,
                                'content': content
                            })
                        print(f"[Crawler Batch Detail API] Converted {len(simple_parsed_data)} items to simple format")
                    else:
                        # 如果没有 items，尝试将整个对象转换为数组
                        print(f"[Crawler Batch Detail API] No items found, converting whole object to array")
                        simple_parsed_data = [parsed_data]
                elif isinstance(parsed_data, list):
                    # 如果传入的是数组，直接使用，但确保每个元素只包含 title 和 content
                    print(f"[Crawler Batch Detail API] Parsed data is list, count: {len(parsed_data)}")
                    simple_parsed_data = []
                    for item in parsed_data:
                        if isinstance(item, dict):
                            simple_parsed_data.append({
                                'title': item.get('title', ''),
                                'content': item.get('content', '')
                            })
                        else:
                            simple_parsed_data.append({
                                'title': '',
                                'content': str(item)
                            })
                else:
                    # 其他情况，转换为数组
                    print(f"[Crawler Batch Detail API] Parsed data is other type: {type(parsed_data)}")
                    simple_parsed_data = [{'title': '', 'content': str(parsed_data)}]
                
                if not simple_parsed_data:
                    print(f"[Crawler Batch Detail API] Warning: simple_parsed_data is empty after conversion")
                    simple_parsed_data = []
                
            except Exception as e:
                print(f"[Crawler Batch Detail API] Error converting parsed_data: {e}")
                import traceback
                traceback.print_exc()
                cursor.close()
                conn.close()
                response = jsonify({'error': f'Failed to convert parsed_data: {str(e)}'})
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response, 500
            
            # 更新 parsed_data（保存为简单的数组结构）
            try:
                parsed_data_json = json.dumps(simple_parsed_data, ensure_ascii=False)
                print(f"[Crawler Batch Detail API] Updating parsed_data, JSON length: {len(parsed_data_json)}, items count: {len(simple_parsed_data)}")
                print(f"[Crawler Batch Detail API] Sample data (first item): {simple_parsed_data[0] if simple_parsed_data else 'empty'}")
                
                cursor.execute("""
                    UPDATE crawler_batches 
                    SET parsed_data = %s 
                    WHERE batch_id = %s AND module_id = %s
                """, (parsed_data_json, batch_id, module_id))
                
                affected_rows = cursor.rowcount
                print(f"[Crawler Batch Detail API] UPDATE executed, affected rows: {affected_rows}")
                
                conn.commit()
                print(f"[Crawler Batch Detail API] Database commit successful")
            except Exception as e:
                print(f"[Crawler Batch Detail API] Error updating database: {e}")
                import traceback
                traceback.print_exc()
                conn.rollback()
                cursor.close()
                conn.close()
                response = jsonify({'error': f'Failed to update database: {str(e)}'})
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response, 500
            
            # 验证更新是否成功
            cursor.execute("""
                SELECT parsed_data FROM crawler_batches 
                WHERE batch_id = %s AND module_id = %s
            """, (batch_id, module_id))
            verify_result = cursor.fetchone()
            if verify_result:
                parsed_data_in_db = verify_result.get('parsed_data')
                print(f"[Crawler Batch Detail API] Verified: parsed_data exists in DB: {parsed_data_in_db is not None}")
                if parsed_data_in_db:
                    try:
                        parsed_obj = json.loads(parsed_data_in_db) if isinstance(parsed_data_in_db, str) else parsed_data_in_db
                        if isinstance(parsed_obj, list):
                            print(f"[Crawler Batch Detail API] Verified: parsed_data contains {len(parsed_obj)} items")
                        else:
                            print(f"[Crawler Batch Detail API] Verified: parsed_data is {type(parsed_obj).__name__}")
                    except Exception as e:
                        print(f"[Crawler Batch Detail API] Warning: Failed to parse verified parsed_data: {e}")
            
            # 清除Redis缓存
            try:
                cursor.execute("SELECT batch_name FROM crawler_batches WHERE batch_id = %s", (batch_id,))
                batch_info = cursor.fetchone()
                if batch_info:
                    redis_client = get_redis_client()
                    if redis_client:
                        cache_key = f"crawler:module:{module_id}:batch:{batch_info['batch_name']}"
                        redis_client.delete(cache_key)
                        print(f"[Crawler Batch Detail API] Redis cache cleared: {cache_key}")
            except Exception as e:
                print(f"[Crawler Batch Detail API] Warning: Failed to clear Redis cache: {e}")
            
            cursor.close()
            conn.close()
            response = jsonify({'success': True, 'message': 'Parsed data saved successfully'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 200
        
        elif request.method == 'DELETE':
            # 删除批次
            cursor.execute("""
                SELECT batch_id FROM crawler_batches 
                WHERE batch_id = %s AND module_id = %s
            """, (batch_id, module_id))
            if not cursor.fetchone():
                cursor.close()
                conn.close()
                return jsonify({'error': 'Batch not found'}), 404
            
            # 删除Redis缓存
            try:
                cursor.execute("SELECT batch_name FROM crawler_batches WHERE batch_id = %s", (batch_id,))
                batch_info = cursor.fetchone()
                if batch_info:
                    redis_client = get_redis_client()
                    if redis_client:
                        cache_key = f"crawler:module:{module_id}:batch:{batch_info['batch_name']}"
                        redis_client.delete(cache_key)
            except:
                pass
            
            cursor.execute("DELETE FROM crawler_batches WHERE batch_id = %s", (batch_id,))
            conn.commit()
            
            cursor.close()
            conn.close()
            response = jsonify({'message': 'Batch deleted successfully'})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 200
    
    except Exception as e:
        print(f"[Crawler Batch Detail API] Error: {e}")
        import traceback
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/crawler/modules/<module_id>/batches/<batch_id>/quick-create', methods=['POST', 'OPTIONS'])
def quick_create_batch_from_history(module_id, batch_id):
    """基于历史批次快速创建新批次"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection, get_redis_client
        from web_crawler import WebCrawler
        from crawler_normalizer import CrawlerNormalizer
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # 获取历史批次信息
        cursor.execute("""
            SELECT batch_id, module_id, batch_name, crawler_config_snapshot, status
            FROM crawler_batches
            WHERE batch_id = %s AND module_id = %s
        """, (batch_id, module_id))
        history_batch = cursor.fetchone()
        
        if not history_batch:
            cursor.close()
            conn.close()
            return jsonify({'error': 'History batch not found'}), 404
        
        if history_batch['status'] != 'completed':
            cursor.close()
            conn.close()
            return jsonify({'error': 'Only completed batches can be used for quick create'}), 400
        
        # 获取配置快照
        config_snapshot = None
        if history_batch.get('crawler_config_snapshot'):
            try:
                if isinstance(history_batch['crawler_config_snapshot'], str):
                    config_snapshot = json.loads(history_batch['crawler_config_snapshot'])
                else:
                    config_snapshot = history_batch['crawler_config_snapshot']
            except:
                pass
        
        if not config_snapshot:
            cursor.close()
            conn.close()
            return jsonify({'error': 'No config snapshot found in history batch'}), 400
        
        # 获取请求参数
        data = request.json or {}
        new_batch_name = data.get('batch_name')
        if not new_batch_name:
            new_batch_name = datetime.now().strftime('%Y-%m-%d')
        
        # 检查新批次是否已存在
        cursor.execute("""
            SELECT batch_id FROM crawler_batches 
            WHERE module_id = %s AND batch_name = %s
        """, (module_id, new_batch_name))
        existing = cursor.fetchone()
        if existing:
            cursor.close()
            conn.close()
            return jsonify({'error': f'Batch with name "{new_batch_name}" already exists'}), 400
        
        # 使用配置快照创建新批次
        target_url = config_snapshot.get('target_url')
        crawler_options = config_snapshot.get('crawler_options', {})
        normalize_config = config_snapshot.get('normalize_config', {})
        
        # 创建批次记录
        new_batch_id = f"batch_{int(time.time() * 1000)}"
        cursor.execute("""
            INSERT INTO crawler_batches 
            (batch_id, module_id, batch_name, crawled_data, crawler_config_snapshot, status)
            VALUES (%s, %s, %s, %s, %s, 'running')
        """, (new_batch_id, module_id, new_batch_name, json.dumps({}), json.dumps(config_snapshot)))
        conn.commit()
        
        try:
            # 执行爬取
            crawler_config = config.get('crawler', {})
            default_timeout = crawler_config.get('default_timeout', 30)
            default_user_agent = crawler_config.get('default_user_agent')
            
            crawler = WebCrawler(
                default_timeout=default_timeout,
                default_user_agent=default_user_agent
            )
            
            raw_result = crawler.fetch(target_url, crawler_options)
            
            if not raw_result.get('success'):
                # 爬取失败
                cursor.execute("""
                    UPDATE crawler_batches 
                    SET status = 'error', error_message = %s
                    WHERE batch_id = %s
                """, (raw_result.get('message', 'Unknown error'), new_batch_id))
                conn.commit()
                
                cursor.close()
                conn.close()
                return jsonify({
                    'success': False,
                    'error': raw_result.get('error'),
                    'message': raw_result.get('message'),
                    'batch_id': new_batch_id
                }), 500
            
            # 标准化处理
            normalizer = CrawlerNormalizer()
            normalized_result = normalizer.normalize(raw_result, normalize_config)
            
            # 保存到数据库
            crawled_data_to_save = {
                'normalized': normalized_result
            }
            cursor.execute("""
                UPDATE crawler_batches 
                SET crawled_data = %s, status = 'completed', error_message = NULL
                WHERE batch_id = %s
            """, (json.dumps(crawled_data_to_save, ensure_ascii=False), new_batch_id))
            conn.commit()
            
            # 缓存到Redis
            try:
                redis_client = get_redis_client()
                if redis_client:
                    cache_key = f"crawler:module:{module_id}:batch:{new_batch_name}"
                    redis_client.setex(cache_key, 86400, json.dumps(crawled_data_to_save, ensure_ascii=False))
            except Exception as e:
                print(f"[Quick Create Batch] Error caching batch: {e}")
            
            # 返回结果
            result = {
                'batch_id': new_batch_id,
                'module_id': module_id,
                'batch_name': new_batch_name,
                'crawled_data': {
                    'normalized': normalized_result
                },
                'crawled_at': datetime.now().isoformat(),
                'status': 'completed'
            }
            
            cursor.close()
            conn.close()
            response = jsonify(result)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response, 200
            
        except Exception as e:
            # 更新批次状态为错误
            cursor.execute("""
                UPDATE crawler_batches 
                SET status = 'error', error_message = %s
                WHERE batch_id = %s
            """, (str(e), new_batch_id))
            conn.commit()
            
            cursor.close()
            conn.close()
            return jsonify({
                'success': False,
                'error': str(e),
                'batch_id': new_batch_id
            }), 500
    
    except Exception as e:
        print(f"[Quick Create Batch] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/crawler/modules/<module_id>/batches/<batch_id>/parsed-data', methods=['PUT', 'OPTIONS'])
def update_batch_parsed_data(module_id, batch_id):
    """保存解析后的数据到 parsed_data 字段"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    print(f"\n{'='*60}")
    print(f"[SaveParsedData] 🚀 开始保存 parsed_data")
    print(f"[SaveParsedData] Module ID: {module_id}")
    print(f"[SaveParsedData] Batch ID: {batch_id}")
    print(f"{'='*60}\n")
    
    try:
        from database import get_mysql_connection, get_redis_client
        
        conn = get_mysql_connection()
        if not conn:
            print(f"[SaveParsedData] ❌ MySQL 不可用")
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # 获取请求数据
        data = request.json or {}
        parsed_data_raw = data.get('parsed_data')
        
        print(f"[SaveParsedData] 📦 收到的数据类型: {type(parsed_data_raw)}")
        
        if parsed_data_raw is None:
            print(f"[SaveParsedData] ❌ parsed_data 为空")
            cursor.close()
            conn.close()
            return jsonify({'error': 'parsed_data is required'}), 400
        
        # 验证批次存在
        cursor.execute("""
            SELECT batch_id FROM crawler_batches 
            WHERE batch_id = %s AND module_id = %s
        """, (batch_id, module_id))
        
        if not cursor.fetchone():
            print(f"[SaveParsedData] ❌ 批次不存在")
            cursor.close()
            conn.close()
            return jsonify({'error': 'Batch not found'}), 404
        
        # 转换为标准格式：[{title, content}, ...]
        final_data = []
        
        if isinstance(parsed_data_raw, list):
            print(f"[SaveParsedData] ✅ 接收到数组，包含 {len(parsed_data_raw)} 项")
            for idx, item in enumerate(parsed_data_raw):
                if isinstance(item, dict):
                    final_data.append({
                        'title': str(item.get('title', '')),
                        'content': str(item.get('content', ''))
                    })
                else:
                    final_data.append({
                        'title': '',
                        'content': str(item)
                    })
                
                # 打印前3项
                if idx < 3:
                    print(f"[SaveParsedData]   #{idx+1}: title='{final_data[-1]['title'][:50]}...', content_len={len(final_data[-1]['content'])}")
        else:
            print(f"[SaveParsedData] ⚠️ 接收到非数组类型: {type(parsed_data_raw)}")
            final_data.append({
                'title': '',
                'content': str(parsed_data_raw)
            })
        
        print(f"[SaveParsedData] 📊 最终数据: {len(final_data)} 条")
        
        if not final_data:
            print(f"[SaveParsedData] ⚠️ 警告：没有数据可保存")
        
        # 保存到数据库
        parsed_data_json = json.dumps(final_data, ensure_ascii=False)
        print(f"[SaveParsedData] 💾 JSON 大小: {len(parsed_data_json)} 字节")
        
        cursor.execute("""
            UPDATE crawler_batches 
            SET parsed_data = %s 
            WHERE batch_id = %s AND module_id = %s
        """, (parsed_data_json, batch_id, module_id))
        
        affected_rows = cursor.rowcount
        print(f"[SaveParsedData] 📝 UPDATE 影响行数: {affected_rows}")
        
        conn.commit()
        print(f"[SaveParsedData] ✅ 提交成功")
        
        # 验证保存结果
        cursor.execute("""
            SELECT parsed_data FROM crawler_batches 
            WHERE batch_id = %s AND module_id = %s
        """, (batch_id, module_id))
        
        verify = cursor.fetchone()
        if verify and verify.get('parsed_data'):
            saved_data = json.loads(verify['parsed_data']) if isinstance(verify['parsed_data'], str) else verify['parsed_data']
            print(f"[SaveParsedData] ✅ 验证成功: 数据库中有 {len(saved_data) if isinstance(saved_data, list) else 0} 条数据")
        else:
            print(f"[SaveParsedData] ⚠️ 验证失败: 未能读取保存的数据")
        
        # 清除缓存
        try:
            cursor.execute("SELECT batch_name FROM crawler_batches WHERE batch_id = %s", (batch_id,))
            batch_info = cursor.fetchone()
            if batch_info:
                redis_client = get_redis_client()
                if redis_client:
                    cache_key = f"crawler:module:{module_id}:batch:{batch_info['batch_name']}"
                    redis_client.delete(cache_key)
                    print(f"[SaveParsedData] 🗑️ 清除缓存: {cache_key}")
        except Exception as e:
            print(f"[SaveParsedData] ⚠️ 清除缓存失败: {e}")
        
        cursor.close()
        conn.close()
        
        print(f"\n{'='*60}")
        print(f"[SaveParsedData] 🎉 保存完成: {len(final_data)} 条数据")
        print(f"{'='*60}\n")
        
        return jsonify({
            'success': True,
            'item_count': len(final_data),
            'message': f'Successfully saved {len(final_data)} items to parsed_data'
        }), 200
    
    except Exception as e:
        print(f"[SaveParsedData] ❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/crawler/modules/search', methods=['GET', 'OPTIONS'])
def crawler_modules_search():
    """搜索模块（用于聊天中的/模块联想）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        from database import get_redis_client
        
        query = request.args.get('q', '').strip()
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # 搜索模块
        if query:
            cursor.execute("""
                SELECT 
                    module_id,
                    module_name,
                    description,
                    target_url
                FROM crawler_modules
                WHERE module_name LIKE %s OR description LIKE %s
                ORDER BY created_at DESC
            """, (f'%{query}%', f'%{query}%'))
        else:
            cursor.execute("""
                SELECT 
                    module_id,
                    module_name,
                    description,
                    target_url
                FROM crawler_modules
                ORDER BY created_at DESC
            """)
        
        modules = cursor.fetchall()
        
        # 获取每个模块的批次列表
        result = []
        for module in modules:
            cursor.execute("""
                SELECT 
                    batch_id,
                    batch_name,
                    crawled_at,
                    status
                FROM crawler_batches
                WHERE module_id = %s AND status = 'completed'
                ORDER BY crawled_at DESC
                LIMIT 10
            """, (module['module_id'],))
            batches = cursor.fetchall()
            
            # 获取批次统计信息
            batches_with_stats = []
            for batch in batches:
                item_count = 0
                
                # 优先从parsed_data字段获取数据条数
                try:
                    cursor.execute("""
                        SELECT parsed_data FROM crawler_batches 
                        WHERE batch_id = %s
                    """, (batch['batch_id'],))
                    batch_data = cursor.fetchone()
                    if batch_data and batch_data.get('parsed_data'):
                        parsed_data = batch_data['parsed_data']
                        if isinstance(parsed_data, str):
                            parsed_data = json.loads(parsed_data)
                        if isinstance(parsed_data, list):
                            item_count = len(parsed_data)
                except Exception as e:
                    print(f"[modules/search] Error reading parsed_data for batch {batch['batch_id']}: {e}")
                
                # 如果parsed_data没有数据，尝试从Redis缓存获取
                if item_count == 0:
                    try:
                        redis_client = get_redis_client()
                        if redis_client:
                            cache_key = f"crawler:module:{module['module_id']}:batch:{batch['batch_name']}"
                            cached = redis_client.get(cache_key)
                            if cached:
                                if isinstance(cached, bytes):
                                    cached = cached.decode('utf-8')
                                cached_data = json.loads(cached)
                                normalized = cached_data.get('normalized', {})
                                item_count = normalized.get('total_count', 0)
                    except Exception as e:
                        print(f"[modules/search] Error reading cache for batch {batch['batch_id']}: {e}")
                
                batches_with_stats.append({
                    'batch_id': batch['batch_id'],
                    'batch_name': batch['batch_name'],
                    'item_count': item_count,
                    'crawled_at': batch['crawled_at'].isoformat() if batch['crawled_at'] else None
                })
            
            result.append({
                'module_id': module['module_id'],
                'module_name': module['module_name'],
                'description': module['description'],
                'target_url': module['target_url'],
                'batches': batches_with_stats
            })
        
        cursor.close()
        conn.close()
        return jsonify({'modules': result}), 200
        
    except Exception as e:
        print(f"[Crawler Modules Search API] Error: {e}")
        import traceback
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # 配置日志
    import logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
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

@app.route('/api/round-tables/<round_table_id>/participants/<session_id>', methods=['DELETE', 'OPTIONS'])
def remove_round_table_participant(round_table_id, session_id):
    """从圆桌会议移除智能体"""
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
            
            # 标记离开时间而不是直接删除
            cursor.execute("""
                UPDATE round_table_participants
                SET left_at = NOW()
                WHERE round_table_id = %s AND session_id = %s AND left_at IS NULL
            """, (round_table_id, session_id))
            
            conn.commit()
            
            if cursor.rowcount == 0:
                return jsonify({'error': 'Participant not found in round table'}), 404
            
            return jsonify({'message': 'Agent removed from round table'})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Round Table API] Error removing participant: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/round-tables/<round_table_id>/participants/<session_id>', methods=['PUT', 'OPTIONS'])
def update_round_table_participant(round_table_id, session_id):
    """更新圆桌会议参与者配置（自定义模型/人设）"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        
        data = request.get_json() or {}
        print(f"[Round Table API] Updating participant: round_table_id={round_table_id}, session_id={session_id}, data={data}")
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        update_cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 先检查参与者是否存在
            cursor.execute("""
                SELECT id, round_table_id, session_id, left_at 
                FROM round_table_participants 
                WHERE round_table_id = %s AND session_id = %s
            """, (round_table_id, session_id))
            existing = cursor.fetchall()
            print(f"[Round Table API] Found participants: {existing}")
            
            active_participant = [p for p in existing if p['left_at'] is None]
            if not active_participant:
                print(f"[Round Table API] No active participant found (left_at IS NULL)")
                return jsonify({'error': 'Participant not found in round table (not active)'}), 404
            
            participant_id = active_participant[0]['id']
            
            # 使用新的游标执行更新
            update_cursor = conn.cursor()
            
            # 构建动态更新语句
            update_fields = []
            update_values = []
            
            if 'custom_llm_config_id' in data:
                update_fields.append('custom_llm_config_id = %s')
                update_values.append(data['custom_llm_config_id'])
            if 'custom_system_prompt' in data:
                update_fields.append('custom_system_prompt = %s')
                update_values.append(data['custom_system_prompt'])
            if 'media_output_path' in data:
                update_fields.append('media_output_path = %s')
                update_values.append(data['media_output_path'])
                
            if not update_fields:
                return jsonify({'error': 'No fields to update'}), 400
            
            update_values.append(participant_id)
            sql = f"UPDATE round_table_participants SET {', '.join(update_fields)} WHERE id = %s"
            print(f"[Round Table API] SQL: {sql}")
            update_cursor.execute(sql, update_values)
            
            print(f"[Round Table API] Update rowcount before commit: {update_cursor.rowcount}")
            conn.commit()
            print(f"[Round Table API] Committed")
            
            # 验证更新是否成功
            verify_cursor = conn.cursor(pymysql.cursors.DictCursor)
            verify_cursor.execute("SELECT custom_llm_config_id, custom_system_prompt FROM round_table_participants WHERE id = %s", (participant_id,))
            after_update = verify_cursor.fetchone()
            verify_cursor.close()
            print(f"[Round Table API] After update check: llm_config={after_update.get('custom_llm_config_id')}, prompt_len={len(after_update.get('custom_system_prompt') or '')}")
            
            # 根据验证结果返回
            return jsonify({'message': 'Participant config updated'})
            
        finally:
            if update_cursor:
                update_cursor.close()
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Round Table API] Error updating participant: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/round-tables/<round_table_id>/messages', methods=['GET', 'OPTIONS'])
def get_round_table_messages(round_table_id):
    """获取圆桌会议消息列表"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 50, type=int)
        offset = (page - 1) * page_size
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 获取消息总数
            cursor.execute("""
                SELECT COUNT(*) as total FROM round_table_messages
                WHERE round_table_id = %s
            """, (round_table_id,))
            total = cursor.fetchone()['total']
            
            # 获取消息列表
            cursor.execute("""
                SELECT 
                    rtm.message_id,
                    rtm.sender_type,
                    rtm.sender_agent_id,
                    rtm.content,
                    rtm.mentions,
                    rtm.is_raise_hand,
                    rtm.media,
                    rtm.reply_to_message_id,
                    rtm.created_at,
                    s.name as agent_name,
                    s.title as agent_title,
                    s.avatar as agent_avatar
                FROM round_table_messages rtm
                LEFT JOIN sessions s ON rtm.sender_agent_id = s.session_id
                WHERE rtm.round_table_id = %s
                ORDER BY rtm.created_at ASC
                LIMIT %s OFFSET %s
            """, (round_table_id, page_size, offset))
            
            messages = []
            for row in cursor.fetchall():
                msg = {
                    'message_id': row['message_id'],
                    'sender_type': row['sender_type'],
                    'sender_agent_id': row['sender_agent_id'],
                    'content': row['content'] or '',
                    'mentions': json.loads(row['mentions']) if row['mentions'] else [],
                    'is_raise_hand': bool(row['is_raise_hand']),
                    'reply_to_message_id': row.get('reply_to_message_id'),
                    'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                }
                
                # 解析媒体内容
                if row.get('media'):
                    try:
                        msg['media'] = json.loads(row['media'])
                    except:
                        msg['media'] = None
                
                if row['sender_type'] == 'agent':
                    msg['agent_name'] = row['agent_name'] or row['agent_title'] or row['sender_agent_id'][:8]
                    msg['agent_avatar'] = row['agent_avatar']
                
                # 获取该消息的所有响应
                cursor.execute("""
                    SELECT 
                        rtr.response_id,
                        rtr.agent_id,
                        rtr.content,
                        rtr.thinking,
                        rtr.tool_calls,
                        rtr.is_selected,
                        rtr.created_at,
                        s.name as agent_name,
                        s.title as agent_title,
                        s.avatar as agent_avatar
                    FROM round_table_responses rtr
                    LEFT JOIN sessions s ON rtr.agent_id = s.session_id
                    WHERE rtr.message_id = %s
                    ORDER BY rtr.created_at ASC
                """, (row['message_id'],))
                
                responses = []
                for resp_row in cursor.fetchall():
                    responses.append({
                        'response_id': resp_row['response_id'],
                        'agent_id': resp_row['agent_id'],
                        'agent_name': resp_row['agent_name'] or resp_row['agent_title'] or resp_row['agent_id'][:8],
                        'agent_avatar': resp_row['agent_avatar'],
                        'content': resp_row['content'],
                        'thinking': resp_row['thinking'],
                        'tool_calls': json.loads(resp_row['tool_calls']) if resp_row['tool_calls'] else None,
                        'is_selected': bool(resp_row['is_selected']),
                        'created_at': resp_row['created_at'].isoformat() if resp_row['created_at'] else None,
                    })
                
                msg['responses'] = responses
                messages.append(msg)
            
            return jsonify({
                'messages': messages,
                'total': total,
                'page': page,
                'page_size': page_size,
                'total_pages': (total + page_size - 1) // page_size,
            })
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Round Table API] Error getting messages: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/round-tables/<round_table_id>/messages', methods=['POST', 'OPTIONS'])
def send_round_table_message(round_table_id):
    """发送圆桌会议消息"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        import uuid
        
        data = request.get_json() or {}
        content = data.get('content', '').strip()
        sender_type = data.get('sender_type', 'user')
        sender_agent_id = data.get('sender_agent_id')
        mentions = data.get('mentions', [])
        is_raise_hand = data.get('is_raise_hand', False)
        media = data.get('media')  # 媒体内容（图片等）
        reply_to_message_id = data.get('reply_to_message_id')  # 引用的消息ID
        
        print(f"[Round Table API] Sending message: content_len={len(content)}, sender={sender_type}, has_media={bool(media)}, media_count={len(media) if media else 0}, reply_to={reply_to_message_id}")
        
        # 允许空内容，但必须有内容或媒体
        if not content and not media:
            return jsonify({'error': 'content or media is required'}), 400
        
        if sender_type not in ['user', 'agent', 'system']:
            return jsonify({'error': 'Invalid sender_type'}), 400
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 检查圆桌会议是否存在且活跃
            cursor.execute("""
                SELECT status FROM round_tables WHERE round_table_id = %s
            """, (round_table_id,))
            
            round_table = cursor.fetchone()
            if not round_table:
                return jsonify({'error': 'Round table not found'}), 404
            
            if round_table['status'] == 'closed':
                return jsonify({'error': 'Round table is closed'}), 400
            
            message_id = str(uuid.uuid4())
            
            # 序列化媒体内容
            media_json = json.dumps(media) if media else None
            
            cursor.execute("""
                INSERT INTO round_table_messages 
                (message_id, round_table_id, sender_type, sender_agent_id, content, mentions, is_raise_hand, media, reply_to_message_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                message_id, 
                round_table_id, 
                sender_type, 
                sender_agent_id,
                content or '',  # 空内容使用空字符串
                json.dumps(mentions) if mentions else None,
                1 if is_raise_hand else 0,
                media_json,
                reply_to_message_id
            ))
            
            conn.commit()
            
            # --- 核心更新: 触发 Agent Actor ---
            # 新架构通过 Redis Pub/Sub 自动触发，这里只需确保消息事件已发布
            # TopicService.send_message 已经会发布 new_message 事件
            # ActorManager 订阅频道后会自动分发给相关 Actor
            
            # 如果是 agent 发送的消息，获取 agent 信息
            agent_name = None
            agent_avatar = None
            if sender_type == 'agent' and sender_agent_id:
                cursor.execute("""
                    SELECT name, avatar FROM sessions WHERE session_id = %s
                """, (sender_agent_id,))
                agent_info = cursor.fetchone()
                if agent_info:
                    agent_name = agent_info['name']
                    agent_avatar = agent_info['avatar']
            
            return jsonify({
                'message_id': message_id,
                'sender_type': sender_type,
                'sender_agent_id': sender_agent_id,
                'agent_name': agent_name,
                'agent_avatar': agent_avatar,
                'content': content or '',
                'mentions': mentions,
                'is_raise_hand': is_raise_hand,
                'media': media,  # 返回媒体内容
                'reply_to_message_id': reply_to_message_id,  # 返回引用消息ID
                'created_at': datetime.now().isoformat(),
                'responses': [],
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Round Table API] Error sending message: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/round-tables/<round_table_id>/messages/<message_id>/responses', methods=['POST', 'OPTIONS'])
def add_round_table_response(round_table_id, message_id):
    """添加智能体对消息的响应"""
    if request.method == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        from database import get_mysql_connection
        import uuid
        
        data = request.get_json() or {}
        agent_id = data.get('agent_id')
        content = data.get('content', '')
        thinking = data.get('thinking')
        tool_calls = data.get('tool_calls')
        
        if not agent_id:
            return jsonify({'error': 'agent_id is required'}), 400
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'MySQL not available'}), 503
        
        cursor = None
        try:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            # 检查消息是否存在
            cursor.execute("""
                SELECT message_id FROM round_table_messages
                WHERE message_id = %s AND round_table_id = %s
            """, (message_id, round_table_id))
            
            if not cursor.fetchone():
                return jsonify({'error': 'Message not found'}), 404
            
            response_id = str(uuid.uuid4())
            
            cursor.execute("""
                INSERT INTO round_table_responses
                (response_id, message_id, agent_id, content, thinking, tool_calls, is_selected)
                VALUES (%s, %s, %s, %s, %s, %s, 0)
            """, (
                response_id,
                message_id,
                agent_id,
                content,
                thinking,
                json.dumps(tool_calls) if tool_calls else None,
            ))
            
            conn.commit()
            
            # 获取智能体信息
            cursor.execute("""
                SELECT name, title, avatar FROM sessions WHERE session_id = %s
            """, (agent_id,))
            agent = cursor.fetchone()
            
            return jsonify({
                'response_id': response_id,
                'message_id': message_id,
                'agent_id': agent_id,
                'agent_name': agent['name'] or agent['title'] or agent_id[:8] if agent else agent_id[:8],
                'agent_avatar': agent['avatar'] if agent else None,
                'content': content,
                'thinking': thinking,
                'tool_calls': tool_calls,
                'is_selected': False,
                'created_at': datetime.now().isoformat(),
            }), 201
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Round Table API] Error adding response: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/round-tables/<round_table_id>/responses/<response_id>/select', methods=['PUT', 'OPTIONS'])
def select_round_table_response(round_table_id, response_id):
    """选择某个响应作为采纳的答案"""
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
            
            # 获取响应所属的消息ID
            cursor.execute("""
                SELECT message_id FROM round_table_responses WHERE response_id = %s
            """, (response_id,))
            
            response = cursor.fetchone()
            if not response:
                return jsonify({'error': 'Response not found'}), 404
            
            message_id = response['message_id']
            
            # 取消该消息下所有响应的选中状态
            cursor.execute("""
                UPDATE round_table_responses
                SET is_selected = 0
                WHERE message_id = %s
            """, (message_id,))
            
            # 选中指定的响应
            cursor.execute("""
                UPDATE round_table_responses
                SET is_selected = 1
                WHERE response_id = %s
            """, (response_id,))
            
            conn.commit()
            
            return jsonify({'message': 'Response selected'})
            
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[Round Table API] Error selecting response: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
