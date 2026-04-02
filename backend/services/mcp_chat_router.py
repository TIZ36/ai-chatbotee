"""
聊天场景下的 MCP 服务器选择与时机判断。

参考 OpenCode：MCP 工具聚合后交给模型决策；本后端在 Actor 流程中先选定「本轮要尝试的 MCP 实例」，
再交给 execute_mcp_with_llm 做 tools/list + LLM 选工具。

设计要点：
1. 显式选择（ext 里带 mcp_servers 等）始终优先；
2. auto_select 开启时，按名称/描述/metadata 关键词与用户输入做轻量打分，避免额外 LLM 路由调用；
3. 时机门控：过短、纯寒暄、显式关闭 auto_mcp 时不走 MCP。
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_DEFAULT_INTENT_PATTERNS = [
    r"notion",
    r"\bmcp\b",
    r"工具",
    r"fetch",
    r"查询",
    r"查一下",
    r"搜索",
    r"调用",
    r"执行",
    r"同步",
    r"拉取",
]

_GREETING_RE = re.compile(
    r"^(你好|您好|嗨|hi|hello|hey|谢谢|感谢|多谢|好的|好滴|嗯|嗯嗯|在吗|在么|ok|okay|👋|🙏)\s*[!！。.…?？]*$",
    re.I,
)


@lru_cache(maxsize=1)
def _get_mcp_chat_config() -> Dict[str, Any]:
    """从 backend/config.yaml 读取 mcp.chat（带默认值）。"""
    defaults: Dict[str, Any] = {
        "auto_select": True,
        "max_servers": 2,
        "min_score": 2,
        "min_message_length": 6,
        "skip_greeting": True,
        "intent_patterns": list(_DEFAULT_INTENT_PATTERNS),
    }
    try:
        import yaml

        path = Path(__file__).resolve().parent.parent / "config.yaml"
        if not path.exists():
            return defaults
        with open(path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        mcp = cfg.get("mcp") or {}
        chat = mcp.get("chat") if isinstance(mcp, dict) else None
        if isinstance(chat, dict):
            out = {**defaults, **chat}
            if "intent_patterns" in chat and isinstance(chat["intent_patterns"], list):
                out["intent_patterns"] = [str(x) for x in chat["intent_patterns"] if x]
            return out
    except Exception as e:
        logger.debug("[mcp_chat_router] config load: %s", e)
    return defaults


def _normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _tokens(text: str) -> List[str]:
    """英文/数字词 + 连续中文片段（2 字及以上）。"""
    t = _normalize_text(text)
    out: List[str] = []
    out.extend(re.findall(r"[a-z0-9]{2,}", t))
    for m in re.findall(r"[\u4e00-\u9fff]{2,}", t):
        out.append(m)
        # 额外拆成 2 字子串，提高「飞书」类匹配
        if len(m) >= 4:
            for i in range(0, len(m) - 1):
                out.append(m[i : i + 2])
    return list(dict.fromkeys(out))


def _server_haystack(server: Dict[str, Any]) -> str:
    parts = [
        server.get("name") or "",
        server.get("description") or "",
        server.get("url") or "",
    ]
    meta = server.get("metadata") or {}
    if isinstance(meta, dict):
        for k in ("keywords", "auto_keywords", "tags", "alias"):
            v = meta.get(k)
            if isinstance(v, str):
                parts.append(v)
            elif isinstance(v, list):
                parts.extend(str(x) for x in v)
    ext = server.get("ext") or {}
    if isinstance(ext, dict):
        v = ext.get("keywords") or ext.get("tags")
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, list):
            parts.extend(str(x) for x in v)
    return _normalize_text(" ".join(parts))


def _score_server(server: Dict[str, Any], user_tokens: List[str]) -> int:
    hay = _server_haystack(server)
    if not hay or not user_tokens:
        return 0
    score = 0
    for tok in user_tokens:
        if len(tok) < 2:
            continue
        if tok in hay:
            score += 1
    return score


def _intent_match(content: str, patterns: List[str]) -> bool:
    t = content or ""
    for p in patterns:
        try:
            if re.search(p, t, re.I):
                return True
        except re.error:
            continue
    return False


def should_attempt_mcp_for_message(content: str, ext: Optional[Dict[str, Any]], cfg: Dict[str, Any]) -> bool:
    """时机：是否值得进入 MCP 路径（自动分支）。"""
    ext = ext or {}
    if ext.get("auto_mcp") is False:
        return False
    raw = (content or "").strip()
    if len(raw) < int(cfg.get("min_message_length", 6)):
        return False
    if cfg.get("skip_greeting", True) and _GREETING_RE.match(raw):
        return False
    return True


def resolve_mcp_server_ids_for_message(
    content: str,
    ext: Optional[Dict[str, Any]] = None,
) -> Tuple[List[str], str]:
    """
    解析本轮应使用的 MCP server_id 列表（最多 3 个与 ChatAgent 一致）。

    Returns:
        (server_ids, reason)  reason 用于日志/调试
    """
    ext = ext or {}
    # 前端显式传空列表表示「本轮不要 MCP」，勿走自动路由
    for key in ("mcp_servers", "selectedMcpServerIds", "selected_mcp_server_ids"):
        if key in ext and isinstance(ext.get(key), list) and len(ext[key]) == 0:
            return [], "explicit_empty"

    explicit = (
        ext.get("mcp_servers")
        or ext.get("selectedMcpServerIds")
        or ext.get("selected_mcp_server_ids")
        or []
    )
    if isinstance(explicit, str):
        explicit = [explicit]
    explicit = [x for x in explicit if x][:3]
    if explicit:
        return explicit, "explicit"

    if ext.get("auto_mcp") is False:
        return [], "auto_mcp_false"

    cfg = _get_mcp_chat_config()
    if not cfg.get("auto_select", True):
        return [], "config_auto_select_off"

    if not should_attempt_mcp_for_message(content, ext, cfg):
        return [], "timing_skip"

    try:
        from database import get_mysql_connection
        from services.mcp_service import MCPService

        svc = MCPService(get_mysql_connection, {})
        servers = svc.get_all_servers(enabled_only=True)
    except Exception as e:
        logger.warning("[mcp_chat_router] list servers failed: %s", e)
        return [], "list_failed"

    if not servers:
        return [], "no_enabled_servers"

    user_tokens = _tokens(content)
    scored: List[Tuple[Dict[str, Any], int]] = []
    for s in servers:
        sc = _score_server(s, user_tokens)
        scored.append((s, sc))
    scored.sort(key=lambda x: -x[1])

    min_score = int(cfg.get("min_score", 2))
    max_n = min(3, int(cfg.get("max_servers", 2)))
    picked: List[str] = []
    for s, sc in scored:
        if sc >= min_score and s.get("server_id"):
            picked.append(s["server_id"])
        if len(picked) >= max_n:
            break

    if picked:
        return picked, f"auto_score>={min_score}"

    patterns = list(cfg.get("intent_patterns") or _DEFAULT_INTENT_PATTERNS)
    if _intent_match(content, patterns):
        fallback: List[str] = []
        for s, _ in scored[:max_n]:
            sid = s.get("server_id")
            if sid:
                fallback.append(sid)
        if fallback:
            return fallback, "intent_fallback"

    return [], "no_auto_match"


def explain_mcp_resolution(content: str, ext: Optional[Dict[str, Any]] = None) -> str:
    """供日志打印的人类可读说明。"""
    ids, reason = resolve_mcp_server_ids_for_message(content, ext)
    return f"reason={reason}, servers={ids}"
