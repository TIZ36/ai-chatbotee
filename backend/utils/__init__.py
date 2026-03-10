"""
工具模块
提供通用功能
"""

from .cors import setup_cors, get_cors_headers
from .auth import get_client_ip, is_owner_ip
from .logger import get_logger, log_request, log_response
from .db import (
    get_db_cursor,
    DatabaseUnavailableError,
    with_db,
    safe_route,
    parse_json_field,
    serialize_datetime,
    serialize_row,
    render_oauth_error,
    render_oauth_success,
)

__all__ = [
    "setup_cors",
    "get_cors_headers",
    "get_client_ip",
    "is_owner_ip",
    "get_logger",
    "log_request",
    "log_response",
    "get_db_cursor",
    "DatabaseUnavailableError",
    "with_db",
    "safe_route",
    "parse_json_field",
    "serialize_datetime",
    "serialize_row",
    "render_oauth_error",
    "render_oauth_success",
]
