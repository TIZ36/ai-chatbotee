"""
Well-known MCP 服务器实现
包含特定 MCP 服务器（如 Notion）的认证和 token 管理逻辑
"""

from .notion import (
    NotionOAuthHandler,
    generate_short_hash,
    check_workspace_alias_unique,
    get_notion_token_by_short_hash,
    save_notion_token_by_short_hash,
    get_notion_registration_from_db,
    get_notion_oauth_config,
    generate_notion_authorization_url,
    exchange_notion_token,
    refresh_notion_token,
    parse_notion_custom_response,
    parse_notion_sse_event
)

__all__ = [
    'NotionOAuthHandler',
    'generate_short_hash',
    'check_workspace_alias_unique',
    'get_notion_token_by_short_hash',
    'save_notion_token_by_short_hash',
    'get_notion_registration_from_db',
    'get_notion_oauth_config',
    'generate_notion_authorization_url',
    'exchange_notion_token',
    'refresh_notion_token',
    'parse_notion_custom_response',
    'parse_notion_sse_event',
]

