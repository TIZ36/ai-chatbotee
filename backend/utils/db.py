"""
数据库工具模块
提供连接管理、JSON/日期时间序列化等通用功能，消除路由中的样板代码。
"""

import json
import traceback
from datetime import datetime, date
from contextlib import contextmanager
from functools import wraps
from typing import Any, Optional

from flask import jsonify


# ==================== 数据库连接上下文管理器 ====================


@contextmanager
def get_db_cursor(dict_cursor=False):
    """
    数据库游标上下文管理器，自动管理连接和游标的生命周期。

    Usage:
        with get_db_cursor(dict_cursor=True) as (conn, cursor):
            cursor.execute("SELECT ...")
            rows = cursor.fetchall()
            conn.commit()  # 如需写操作

    Yields:
        (conn, cursor) 元组

    Raises:
        DatabaseUnavailableError: MySQL 不可用
    """
    from database import get_mysql_connection
    import pymysql

    conn = get_mysql_connection()
    if not conn:
        raise DatabaseUnavailableError("MySQL not available")

    cursor_type = pymysql.cursors.DictCursor if dict_cursor else None
    cursor = conn.cursor(cursor_type) if cursor_type else conn.cursor()
    try:
        yield conn, cursor
    finally:
        cursor.close()
        conn.close()


class DatabaseUnavailableError(Exception):
    """MySQL 数据库不可用异常"""

    pass


def with_db(dict_cursor=False):
    """
    路由装饰器：自动注入 (conn, cursor) 参数并处理连接管理。

    Usage:
        @app.route('/api/xxx')
        @with_db(dict_cursor=True)
        def my_route(conn, cursor):
            cursor.execute("SELECT ...")
            return jsonify(cursor.fetchall())
    """

    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            try:
                with get_db_cursor(dict_cursor=dict_cursor) as (conn, cursor):
                    kwargs["conn"] = conn
                    kwargs["cursor"] = cursor
                    return f(*args, **kwargs)
            except DatabaseUnavailableError:
                return jsonify({"error": "MySQL not available"}), 503

        return wrapper

    return decorator


# ==================== JSON / 日期时间序列化工具 ====================


def parse_json_field(value: Any, default: Any = None) -> Any:
    """
    安全解析 JSON 字段（兼容数据库返回的 str 和已解析的 dict/list）。

    Args:
        value: 待解析的值
        default: 解析失败时的默认值

    Returns:
        解析后的 Python 对象
    """
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, ValueError):
            return default if default is not None else value
    return value


def serialize_datetime(dt: Any) -> Optional[str]:
    """
    安全地将日期时间对象序列化为 ISO 格式字符串。

    Args:
        dt: datetime/date 对象或其他值

    Returns:
        ISO 格式字符串或 None
    """
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


def serialize_row(
    row: dict,
    json_fields: list = None,
    datetime_fields: list = None,
    bool_fields: list = None,
) -> dict:
    """
    统一序列化数据库行：解析 JSON 字段、格式化日期、转换布尔值。

    Args:
        row: 数据库行字典
        json_fields: 需要 JSON 解析的字段名列表
        datetime_fields: 需要日期格式化的字段名列表
        bool_fields: 需要转换为 bool 的字段名列表

    Returns:
        处理后的行字典
    """
    if not row:
        return row

    if json_fields:
        for field in json_fields:
            if field in row:
                row[field] = parse_json_field(row[field], default={})

    if datetime_fields:
        for field in datetime_fields:
            if field in row:
                row[field] = serialize_datetime(row[field])

    if bool_fields:
        for field in bool_fields:
            if field in row:
                row[field] = bool(row[field])

    return row


# ==================== 统一错误处理 ====================


def safe_route(fallback=None, log_prefix="API"):
    """
    路由装饰器：统一异常处理和日志。

    Args:
        fallback: 异常时的回退响应（如空列表），为 None 时返回 500 错误
        log_prefix: 日志前缀

    Usage:
        @app.route('/api/xxx')
        @safe_route(fallback={'items': [], 'total': 0}, log_prefix="MCP")
        def my_route():
            ...
    """

    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            try:
                return f(*args, **kwargs)
            except DatabaseUnavailableError:
                return jsonify({"error": "MySQL not available"}), 503
            except Exception as e:
                error_trace = traceback.format_exc()
                print(f"[{log_prefix}] Error in {f.__name__}: {e}")
                print(f"[{log_prefix}] Traceback: {error_trace}")
                if fallback is not None:
                    result = dict(fallback)
                    result["error"] = str(e)
                    return jsonify(result)
                return jsonify({"error": str(e)}), 500

        return wrapper

    return decorator


# ==================== OAuth HTML 模板工具 ====================


def render_oauth_error(title: str, message: str, status_code: int = 400) -> tuple:
    """
    渲染 OAuth 错误页面的统一模板。

    Args:
        title: 页面标题
        message: 错误描述
        status_code: HTTP 状态码

    Returns:
        (html_string, status_code)
    """
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>{title}</title>
    <meta charset="utf-8">
    <style>
        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f9fafb; }}
        .card {{ max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
        .error {{ color: #dc2626; margin-bottom: 16px; }}
        .msg {{ color: #6b7280; line-height: 1.6; }}
        a {{ color: #2563eb; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
    </style>
</head>
<body>
    <div class="card">
        <h1 class="error">{title}</h1>
        <p class="msg">{message}</p>
        <p><a href="/mcp-config">返回 MCP 配置页面</a></p>
    </div>
</body>
</html>"""
    return html, status_code


def render_oauth_success(title: str, message: str, auto_close: bool = True) -> tuple:
    """
    渲染 OAuth 成功页面的统一模板。

    Args:
        title: 页面标题
        message: 成功描述
        auto_close: 是否自动关闭窗口

    Returns:
        (html_string, 200)
    """
    close_script = (
        "<script>setTimeout(() => window.close(), 2000);</script>" if auto_close else ""
    )
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>{title}</title>
    <meta charset="utf-8">
    <style>
        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f9fafb; }}
        .card {{ max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
        .success {{ color: #16a34a; margin-bottom: 16px; }}
        .msg {{ color: #6b7280; line-height: 1.6; }}
    </style>
    {close_script}
</head>
<body>
    <div class="card">
        <h1 class="success">{title}</h1>
        <p class="msg">{message}</p>
    </div>
</body>
</html>"""
    return html, 200
