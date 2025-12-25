"""
MCP Market Service

- 管理 MCP 市场源（MarketSource）与条目（MarketItem）
- 支持从 GitHub 仓库同步目录（zipball）
- 提供搜索、详情、安装（落库到 mcp_servers）

说明：
- 这是“聚合型市场层”的第一版实现，优先保证可用与可扩展。
- 第三方市场（Smithery/MCPdb/MCP.so）后续可以通过新增 adapter 接入。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
import io
import json
import re
import shlex
import time
import zipfile

import requests


DEFAULT_GITHUB_SOURCES: List[Dict[str, Any]] = [
    {
        "source_id": "github-modelcontextprotocol-servers",
        "display_name": "Official: modelcontextprotocol/servers",
        "type": "github_repo",
        "enabled": True,
        "sync_interval_seconds": 6 * 60 * 60,
        "config": {
            "repo": "modelcontextprotocol/servers",
            "ref": "main",
            # MCP 官方 servers 常见 npm 包前缀（用于过滤噪音包）
            "package_name_prefixes": ["@modelcontextprotocol/server-"],
            "max_items": 400,
        },
    }
]

DEFAULT_HTML_SOURCES: List[Dict[str, Any]] = [
    {
        "source_id": "mcpdb-zh-mcps",
        "display_name": "MCPdb (ZH) /mcps",
        "type": "html_scrape",
        "enabled": True,
        "sync_interval_seconds": 6 * 60 * 60,
        "config": {
            "sitemap_url": "https://mcpdb.org/api/sitemap",
            # 只抓 MCP 条目（中文路径优先；也可去掉 /zh）
            "include_prefixes": ["https://mcpdb.org/zh/mcps/"],
            "max_items": 300,
            "request_delay_ms": 150,
        },
    },
    {
        "source_id": "smithery-servers",
        "display_name": "Smithery /server",
        "type": "html_scrape",
        "enabled": True,
        "sync_interval_seconds": 6 * 60 * 60,
        "config": {
            "sitemap_url": "https://smithery.ai/server/sitemap.xml",
            "include_prefixes": ["https://smithery.ai/server/"],
            "max_items": 200,
            "request_delay_ms": 200,
            # Smithery 详情页通常给出 GitHub 仓库；我们从仓库 zip 提取 package.json 决定 npx 启动方式
            "resolve_github_package": True,
        },
    },
]

@dataclass
class MarketSource:
    source_id: str
    display_name: str
    type: str  # github_repo | http_json | html_scrape
    enabled: bool
    config: Dict[str, Any]
    sync_interval_seconds: int = 3600
    last_sync_at: Optional[int] = None


@dataclass
class MarketItem:
    item_id: str
    source_id: str
    name: str
    description: str
    runtime_type: str  # local_stdio | remote_http
    homepage: Optional[str] = None
    tags: Optional[List[str]] = None
    remote: Optional[Dict[str, Any]] = None
    stdio: Optional[Dict[str, Any]] = None
    raw: Optional[Dict[str, Any]] = None


class MCPMarketService:
    def __init__(self, get_connection):
        self.get_connection = get_connection

    # =========================================================================
    # Sources
    # =========================================================================

    def ensure_default_sources(self) -> None:
        conn = self.get_connection()
        if not conn:
            return
        cur = conn.cursor()
        try:
            for s in (DEFAULT_GITHUB_SOURCES + DEFAULT_HTML_SOURCES):
                cur.execute(
                    """
                    INSERT INTO mcp_market_sources
                      (source_id, display_name, type, enabled, config, sync_interval_seconds)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                      display_name = VALUES(display_name),
                      type = VALUES(type),
                      enabled = VALUES(enabled),
                      config = VALUES(config),
                      sync_interval_seconds = VALUES(sync_interval_seconds)
                    """,
                    (
                        s["source_id"],
                        s["display_name"],
                        s["type"],
                        1 if s.get("enabled", True) else 0,
                        json.dumps(s.get("config", {})),
                        int(s.get("sync_interval_seconds", 3600)),
                    ),
                )
            conn.commit()
        finally:
            try:
                cur.close()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    def list_sources(self) -> List[MarketSource]:
        conn = self.get_connection()
        if not conn:
            return []
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT source_id, display_name, type, enabled, config, sync_interval_seconds, last_sync_at
                FROM mcp_market_sources
                ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()
            sources: List[MarketSource] = []
            for row in rows:
                config = {}
                try:
                    config = json.loads(row[4]) if row[4] else {}
                except Exception:
                    config = {}
                sources.append(
                    MarketSource(
                        source_id=row[0],
                        display_name=row[1],
                        type=row[2],
                        enabled=bool(row[3]),
                        config=config,
                        sync_interval_seconds=int(row[5] or 3600),
                        last_sync_at=int(row[6]) if row[6] else None,
                    )
                )
            return sources
        finally:
            try:
                cur.close()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    def upsert_source(self, source: Dict[str, Any]) -> MarketSource:
        source_id = source.get("source_id") or source.get("id")
        if not source_id:
            raise ValueError("source_id is required")
        display_name = source.get("display_name") or source.get("name") or source_id
        source_type = source.get("type")
        if source_type not in ("github_repo", "http_json", "html_scrape"):
            raise ValueError("type must be one of github_repo/http_json/html_scrape")
        enabled = bool(source.get("enabled", True))
        config = source.get("config") or {}
        sync_interval_seconds = int(source.get("sync_interval_seconds") or 3600)

        conn = self.get_connection()
        if not conn:
            raise RuntimeError("MySQL not available")
        cur = conn.cursor()
        try:
            cur.execute(
                """
                INSERT INTO mcp_market_sources
                  (source_id, display_name, type, enabled, config, sync_interval_seconds)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  display_name = VALUES(display_name),
                  type = VALUES(type),
                  enabled = VALUES(enabled),
                  config = VALUES(config),
                  sync_interval_seconds = VALUES(sync_interval_seconds),
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    source_id,
                    display_name,
                    source_type,
                    1 if enabled else 0,
                    json.dumps(config),
                    sync_interval_seconds,
                ),
            )
            conn.commit()
            return MarketSource(
                source_id=source_id,
                display_name=display_name,
                type=source_type,
                enabled=enabled,
                config=config,
                sync_interval_seconds=sync_interval_seconds,
            )
        finally:
            try:
                cur.close()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    # =========================================================================
    # Sync
    # =========================================================================

    def sync_source(self, source_id: str, force: bool = False) -> Dict[str, Any]:
        conn = self.get_connection()
        if not conn:
            raise RuntimeError("MySQL not available")
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT source_id, display_name, type, enabled, config, sync_interval_seconds, last_sync_at
                FROM mcp_market_sources
                WHERE source_id = %s
                """,
                (source_id,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("source not found")

            enabled = bool(row[3])
            if not enabled:
                return {"source_id": source_id, "skipped": True, "reason": "disabled"}

            config = {}
            try:
                config = json.loads(row[4]) if row[4] else {}
            except Exception:
                config = {}

            sync_interval = int(row[5] or 3600)
            last_sync_at = int(row[6]) if row[6] else None
            now = int(time.time())
            if not force and last_sync_at and now - last_sync_at < sync_interval:
                return {"source_id": source_id, "skipped": True, "reason": "interval_not_elapsed", "last_sync_at": last_sync_at}

            source_type = row[2]
            if source_type == "github_repo":
                items = self._sync_github_repo(config, source_id)
            elif source_type == "html_scrape":
                items = self._sync_html_scrape(config, source_id)
            else:
                raise ValueError(f"unsupported source type: {source_type}")

            # upsert items
            inserted = 0
            updated = 0
            for item in items:
                # 简单按 item_id 唯一
                cur.execute(
                    """
                    INSERT INTO mcp_market_items
                      (item_id, source_id, name, description, runtime_type, homepage, tags, remote, stdio, raw)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                      name = VALUES(name),
                      description = VALUES(description),
                      runtime_type = VALUES(runtime_type),
                      homepage = VALUES(homepage),
                      tags = VALUES(tags),
                      remote = VALUES(remote),
                      stdio = VALUES(stdio),
                      raw = VALUES(raw),
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        item.item_id,
                        item.source_id,
                        item.name,
                        item.description,
                        item.runtime_type,
                        item.homepage,
                        json.dumps(item.tags or []),
                        json.dumps(item.remote) if item.remote else None,
                        json.dumps(item.stdio) if item.stdio else None,
                        json.dumps(item.raw) if item.raw else None,
                    ),
                )
                # MySQL rowcount: 1 insert, 2 update (with ON DUPLICATE)
                if cur.rowcount == 1:
                    inserted += 1
                elif cur.rowcount == 2:
                    updated += 1

            cur.execute(
                "UPDATE mcp_market_sources SET last_sync_at = %s, updated_at = CURRENT_TIMESTAMP WHERE source_id = %s",
                (now, source_id),
            )
            conn.commit()
            return {"source_id": source_id, "inserted": inserted, "updated": updated, "count": len(items), "last_sync_at": now}
        finally:
            try:
                cur.close()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    def _sync_github_repo(self, config: Dict[str, Any], source_id: str) -> List[MarketItem]:
        repo = config.get("repo")
        ref = config.get("ref", "main")
        if not repo or "/" not in repo:
            raise ValueError("github_repo config.repo must be like owner/repo")

        package_prefixes = config.get("package_name_prefixes") or []
        max_items = int(config.get("max_items") or 300)

        zip_url = f"https://codeload.github.com/{repo}/zip/{ref}"
        resp = requests.get(zip_url, timeout=60)
        resp.raise_for_status()

        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        package_json_paths = [p for p in zf.namelist() if p.endswith("package.json")]

        items: List[MarketItem] = []
        for p in package_json_paths:
            if len(items) >= max_items:
                break
            try:
                data = json.loads(zf.read(p).decode("utf-8"))
            except Exception:
                continue

            pkg_name = data.get("name")
            if not pkg_name or not isinstance(pkg_name, str):
                continue

            # 过滤：优先官方 server 前缀；否则看 keywords 中是否包含 mcp
            keywords = data.get("keywords") or []
            if isinstance(keywords, str):
                keywords = [keywords]
            keywords = [k for k in keywords if isinstance(k, str)]

            is_prefixed = any(pkg_name.startswith(pref) for pref in package_prefixes) if package_prefixes else False
            has_mcp_kw = any(k.lower() == "mcp" or "modelcontextprotocol" in k.lower() for k in keywords)
            if not (is_prefixed or has_mcp_kw):
                continue

            description = data.get("description") or ""
            homepage = data.get("homepage") or f"https://github.com/{repo}"
            tags = sorted({k for k in keywords if len(k) <= 40})[:20]

            # stdio 运行形态：第一版默认 npx -y <pkg>
            stdio = {
                "command": "npx",
                "args": ["-y", pkg_name],
                "env": {},
                "install_hint": "npx",
                "permissions_hint": "该 MCP Server 将以本机进程方式运行，可能访问网络/文件系统，请确认来源可信。",
            }

            item_id = f"{source_id}:{pkg_name}"
            items.append(
                MarketItem(
                    item_id=item_id,
                    source_id=source_id,
                    name=pkg_name,
                    description=description,
                    runtime_type="local_stdio",
                    homepage=homepage,
                    tags=tags,
                    stdio=stdio,
                    raw={"package_json_path": p, "package": data, "repo": repo, "ref": ref},
                )
            )

        return items

    def _sync_html_scrape(self, config: Dict[str, Any], source_id: str) -> List[MarketItem]:
        sitemap_url = config.get("sitemap_url")
        if not sitemap_url:
            raise ValueError("html_scrape config.sitemap_url is required")

        include_prefixes = config.get("include_prefixes") or []
        max_items = int(config.get("max_items") or 200)
        request_delay_ms = int(config.get("request_delay_ms") or 0)

        locs = self._fetch_sitemap_locs(sitemap_url)
        if include_prefixes:
            locs = [u for u in locs if any(u.startswith(p) for p in include_prefixes)]

        items: List[MarketItem] = []
        for url in locs:
            if len(items) >= max_items:
                break
            try:
                html = self._fetch_html(url)
            except Exception:
                continue

            item = None
            if source_id.startswith("mcpdb"):
                item = self._parse_mcpdb_item(url, html, source_id)
            elif source_id.startswith("smithery"):
                item = self._parse_smithery_item(url, html, source_id, resolve_github_package=bool(config.get("resolve_github_package", False)))

            if item:
                items.append(item)

            if request_delay_ms > 0:
                time.sleep(request_delay_ms / 1000.0)

        return items

    # =========================================================================
    # HTML / Sitemap Helpers
    # =========================================================================

    def _fetch_sitemap_locs(self, sitemap_url: str) -> List[str]:
        resp = requests.get(sitemap_url, timeout=60, headers={"Accept": "application/xml,text/xml"})
        resp.raise_for_status()
        text = resp.text
        # 简易提取 <loc>...</loc>
        return re.findall(r"<loc>([^<]+)</loc>", text)

    def _fetch_html(self, url: str) -> str:
        resp = requests.get(url, timeout=60, headers={"Accept": "text/html"})
        resp.raise_for_status()
        return resp.text

    def _extract_code_blocks(self, html: str) -> List[str]:
        # MCPdb 页面中常见 <code>...</code>
        blocks = re.findall(r"<code[^>]*>(.*?)</code>", html, flags=re.S | re.I)
        # 去标签 + HTML entity（最小处理）
        cleaned: List[str] = []
        for b in blocks:
            b2 = re.sub(r"<[^>]+>", "", b)
            b2 = b2.replace("&gt;", ">").replace("&lt;", "<").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"')
            b2 = b2.strip()
            if b2:
                cleaned.append(b2)
        return cleaned

    def _parse_title(self, html: str) -> str:
        m = re.search(r"<title>(.*?)</title>", html, flags=re.I | re.S)
        if not m:
            return ""
        t = re.sub(r"\s+", " ", m.group(1)).strip()
        return t

    def _parse_meta_description(self, html: str) -> str:
        m = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', html, flags=re.I)
        return m.group(1).strip() if m else ""

    def _tokenize_command(self, cmd: str) -> Optional[Tuple[str, List[str]]]:
        cmd = (cmd or "").strip()
        if not cmd:
            return None
        try:
            parts = shlex.split(cmd)
        except Exception:
            parts = cmd.split()
        if not parts:
            return None
        return parts[0], parts[1:]

    # =========================================================================
    # MCPdb Parser
    # =========================================================================

    def _parse_mcpdb_item(self, url: str, html: str, source_id: str) -> Optional[MarketItem]:
        # slug
        m = re.search(r"/mcps/([^/?#]+)", url)
        slug = m.group(1) if m else None
        if not slug:
            return None

        title = self._parse_title(html)
        desc = self._parse_meta_description(html)
        if not desc:
            # 尝试从页面正文中找“简介”段落（轻量级）
            m2 = re.search(r"简介</h2>.*?<p[^>]*>(.*?)</p>", html, flags=re.S | re.I)
            if m2:
                desc = re.sub(r"<[^>]+>", "", m2.group(1)).strip()

        # 安装命令：优先找 npx（排除 smithery cli 安装命令）
        code_blocks = self._extract_code_blocks(html)
        install_cmd = None
        for b in code_blocks:
            for line in b.splitlines():
                s = line.strip()
                if s.startswith("npx "):
                    if "@smithery/cli" in s:
                        continue
                    install_cmd = s
                    break
            if install_cmd:
                break

        if not install_cmd:
            # 没有 npx 指令则跳过（避免生成不可一键安装的条目）
            return None

        tok = self._tokenize_command(install_cmd)
        if not tok:
            return None
        command, args = tok

        # 主页/源码：找 GitHub 链接
        gh = None
        mgh = re.search(r'href="(https://github\.com/[^"]+)"', html, flags=re.I)
        if mgh:
            gh = mgh.group(1)

        item_id = f"{source_id}:{slug}"
        return MarketItem(
            item_id=item_id,
            source_id=source_id,
            name=slug,
            description=desc or "",
            runtime_type="local_stdio",
            homepage=gh or url,
            tags=["mcpdb"],
            stdio={
                "command": command,
                "args": args,
                "env": {},
                "install_hint": "from_mcpdb",
                "permissions_hint": "该 MCP Server 将以本机进程方式运行，可能访问网络/文件系统，请确认来源可信。",
            },
            raw={"url": url, "title": title, "install_cmd": install_cmd},
        )

    # =========================================================================
    # Smithery Parser
    # =========================================================================

    def _parse_smithery_item(self, url: str, html: str, source_id: str, resolve_github_package: bool = True) -> Optional[MarketItem]:
        # url 形如 /server/@owner/name
        m = re.search(r"/server/(@[^/]+/[^/?#]+)", url)
        slug = m.group(1) if m else None
        if not slug:
            return None

        title = self._parse_title(html)
        desc = self._parse_meta_description(html)

        # Source Code GitHub URL（页面上有 Source Code 区块）
        gh = None
        mgh = re.search(r'href="(https://github\.com/[^"]+)"', html, flags=re.I)
        if mgh:
            gh = mgh.group(1)

        pkg_name = None
        pkg_desc = None
        homepage = url

        if gh and resolve_github_package:
            repo = self._github_repo_from_url(gh)
            if repo:
                homepage = f"https://github.com/{repo}"
                pkg_name, pkg_desc = self._resolve_npm_package_from_github_repo(repo)

        # 只能在拿到 npm 包名时才生成“可一键安装”的 stdio 条目
        if not pkg_name:
            return None

        item_id = f"{source_id}:{slug}"
        return MarketItem(
            item_id=item_id,
            source_id=source_id,
            name=pkg_name,
            description=pkg_desc or desc or "",
            runtime_type="local_stdio",
            homepage=homepage,
            tags=["smithery"],
            stdio={
                "command": "npx",
                "args": ["-y", pkg_name],
                "env": {},
                "install_hint": "npx",
                "permissions_hint": "该 MCP Server 将以本机进程方式运行，可能访问网络/文件系统，请确认来源可信。",
            },
            raw={"url": url, "title": title, "github": gh, "resolved_repo": homepage},
        )

    def _github_repo_from_url(self, url: str) -> Optional[str]:
        m = re.search(r"github\.com/([^/]+/[^/#?]+)", url)
        if not m:
            return None
        repo = m.group(1).rstrip(".git")
        return repo

    def _resolve_npm_package_from_github_repo(self, repo: str) -> Tuple[Optional[str], Optional[str]]:
        # 下载 repo zip（默认 main），尝试从任何 package.json 里找到 name/description
        # 注意：有些仓库默认分支不是 main，这里尽量兼容：main -> master
        for ref in ("main", "master"):
            try:
                zip_url = f"https://codeload.github.com/{repo}/zip/{ref}"
                resp = requests.get(zip_url, timeout=60)
                if resp.status_code >= 400:
                    continue
                zf = zipfile.ZipFile(io.BytesIO(resp.content))
                package_json_paths = [p for p in zf.namelist() if p.endswith("package.json")]
                for p in package_json_paths[:40]:
                    try:
                        data = json.loads(zf.read(p).decode("utf-8"))
                    except Exception:
                        continue
                    name = data.get("name")
                    if isinstance(name, str) and name:
                        desc = data.get("description")
                        return name, desc if isinstance(desc, str) else None
            except Exception:
                continue
        return None, None

    # =========================================================================
    # Items
    # =========================================================================

    def search_items(
        self,
        q: str = "",
        runtime_type: Optional[str] = None,
        source_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        q = (q or "").strip()
        if limit <= 0:
            limit = 50
        limit = min(limit, 100)
        offset = max(offset, 0)

        conn = self.get_connection()
        if not conn:
            return {"items": [], "total": 0}
        cur = conn.cursor()
        try:
            where = []
            params: List[Any] = []
            if q:
                where.append("(name LIKE %s OR description LIKE %s)")
                like = f"%{q}%"
                params.extend([like, like])
            if runtime_type:
                where.append("runtime_type = %s")
                params.append(runtime_type)
            if source_id:
                where.append("source_id = %s")
                params.append(source_id)

            where_sql = (" WHERE " + " AND ".join(where)) if where else ""

            cur.execute(f"SELECT COUNT(*) FROM mcp_market_items{where_sql}", tuple(params))
            total = int(cur.fetchone()[0])

            cur.execute(
                f"""
                SELECT item_id, source_id, name, description, runtime_type, homepage, tags
                FROM mcp_market_items
                {where_sql}
                ORDER BY updated_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [limit, offset]),
            )

            items = []
            for row in cur.fetchall():
                tags = []
                try:
                    tags = json.loads(row[6]) if row[6] else []
                except Exception:
                    tags = []
                items.append(
                    {
                        "item_id": row[0],
                        "source_id": row[1],
                        "name": row[2],
                        "description": row[3],
                        "runtime_type": row[4],
                        "homepage": row[5],
                        "tags": tags,
                    }
                )
            return {"items": items, "total": total}
        finally:
            try:
                cur.close()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        if not conn:
            return None
        cur = conn.cursor()
        try:
            cur.execute(
                """
                SELECT item_id, source_id, name, description, runtime_type, homepage, tags, remote, stdio, raw
                FROM mcp_market_items
                WHERE item_id = %s
                """,
                (item_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            def _j(v):
                try:
                    return json.loads(v) if v else None
                except Exception:
                    return None
            return {
                "item_id": row[0],
                "source_id": row[1],
                "name": row[2],
                "description": row[3],
                "runtime_type": row[4],
                "homepage": row[5],
                "tags": _j(row[6]) or [],
                "remote": _j(row[7]),
                "stdio": _j(row[8]),
                "raw": _j(row[9]),
            }
        finally:
            try:
                cur.close()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    # =========================================================================
    # Install
    # =========================================================================

    def install_item(self, item_id: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        overrides = overrides or {}
        item = self.get_item(item_id)
        if not item:
            raise ValueError("item not found")

        runtime_type = item.get("runtime_type")
        name = overrides.get("name") or item.get("name") or "MCP Server"

        # stdio/local：url 必填（db schema），用占位 URL 表示本地 stdio
        if runtime_type == "local_stdio":
            stdio_cfg = item.get("stdio") or {}
            command = stdio_cfg.get("command") or "npx"
            args = stdio_cfg.get("args") or []
            env = overrides.get("env") or stdio_cfg.get("env") or {}

            ext = {
                "market": {"item_id": item_id, "source_id": item.get("source_id")},
                "stdio": {"command": command, "args": args, "env": env},
            }
            server_data = {
                "name": name,
                "url": f"stdio://{item_id}",
                "type": "stdio",
                "enabled": True,
                "use_proxy": False,
                "description": item.get("description") or "",
                "metadata": {},
                "ext": ext,
            }
            return server_data

        if runtime_type == "remote_http":
            remote = item.get("remote") or {}
            url = overrides.get("url") or remote.get("url")
            if not url:
                raise ValueError("remote_http item missing url")
            ext = {"market": {"item_id": item_id, "source_id": item.get("source_id")}}
            server_data = {
                "name": name,
                "url": url,
                "type": "http-stream",
                "enabled": True,
                "use_proxy": True,
                "description": item.get("description") or "",
                "metadata": remote.get("metadata") or {},
                "ext": ext,
            }
            return server_data

        raise ValueError(f"unsupported runtime_type: {runtime_type}")


