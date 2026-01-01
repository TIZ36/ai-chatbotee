"""
Actor 状态管理

管理 Agent 的运行时状态：
- 历史消息
- 记忆摘要
- 参与者信息
- 媒体上下文
- 已处理消息去重
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from token_counter import estimate_messages_tokens, get_model_max_tokens
from services.message_service import get_message_service


class ActorState:
    """Actor 状态管理"""
    
    def __init__(self, topic_id: str = None):
        self.topic_id = topic_id
        
        # 历史消息（轻量结构，不含 ext/media 等大字段）
        self.history: List[Dict[str, Any]] = []
        
        # 记忆摘要
        self.summary: Optional[str] = None
        self.summary_until: Optional[str] = None  # 摘要覆盖到的最后消息 ID
        
        # 参与者信息
        self.participants: List[Dict[str, Any]] = []
        self.agent_abilities: Dict[str, str] = {}  # agent_id -> 能力描述
        
        # 媒体上下文（最近一次媒体消息 ID，用于引用"上图/这张图"）
        # 使用 message_id 作为占位符，需要时再从数据库获取实际媒体数据
        self._last_media_message_id: Optional[str] = None
        self._media_cache: Dict[str, List[Dict[str, Any]]] = {}  # message_id -> media list
        
        # 已处理消息 ID 集合（去重）
        self._processed_ids: Set[str] = set()
        
        # 配置
        self._max_processed_ids = 1000
    
    def load_history(self, topic_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """
        加载历史消息
        
        Args:
            topic_id: 话题 ID
            limit: 最大加载数量
            
        Returns:
            加载的消息列表
        """
        import logging
        logger = logging.getLogger(__name__)
        
        self.topic_id = topic_id
        svc = get_message_service()
        
        logger.info(f"[ActorState] Loading history for topic {topic_id}, limit={limit}")
        
        # 分页加载全部历史
        all_msgs: List[Dict[str, Any]] = []
        before_id: Optional[str] = None
        page_size = min(200, limit)
        
        while len(all_msgs) < limit:
            try:
                batch, has_more, _latest_id = svc.get_messages_paginated(
                    topic_id,
                    limit=page_size,
                    before_id=before_id,
                    use_cache=False,
                )
            except TypeError:
                # 兼容老版本
                try:
                    batch = svc.get_messages(topic_id, limit=page_size, before=before_id, use_cache=False)
                    has_more = len(batch) >= page_size
                except Exception:
                    batch = svc.get_messages(topic_id, limit=page_size)
                    has_more = False
            
            if not batch:
                break
            
            # 合并结果（batch 内部是从早到晚）
            if before_id is None:
                all_msgs = batch
            else:
                all_msgs = batch + all_msgs
            
            if not has_more or len(all_msgs) >= limit:
                break
            
            # 下一页游标
            before_id = (batch[0] or {}).get('message_id')
            if not before_id:
                break
        
        # 转换为轻量结构
        self.history = []
        for m in all_msgs[-limit:]:
            if not isinstance(m, dict):
                continue
            
            # 检测是否有媒体（仅记录占位符，不存储实际数据）
            has_media = False
            media_count = 0
            try:
                ext = m.get('ext') or {}
                media = ext.get('media')
                if isinstance(media, list) and media:
                    has_media = True
                    media_count = len(media)
                    # 缓存最近一次媒体的消息 ID（而非实际数据）
                    self._last_media_message_id = m.get('message_id')
            except Exception:
                pass
            
            history_item = {
                'message_id': m.get('message_id'),
                'role': m.get('role'),
                'content': m.get('content'),
                'created_at': m.get('created_at'),
                'sender_id': m.get('sender_id'),
                'sender_type': m.get('sender_type'),
            }
            
            # 如果有媒体，添加占位符信息
            if has_media:
                history_item['has_media'] = True
                history_item['media_count'] = media_count
                # 在 content 中添加占位符提示（如果原 content 为空）
                if not history_item.get('content'):
                    history_item['content'] = f'[图片×{media_count}]'
            
            self.history.append(history_item)
        
        logger.info(f"[ActorState] Loaded {len(self.history)} messages for topic {topic_id}")
        if self.history:
            # 打印前3条和后3条消息的摘要
            for i, h in enumerate(self.history[:3]):
                logger.debug(f"  [{i}] {h.get('role')}: {(h.get('content') or '')[:50]}...")
            if len(self.history) > 6:
                logger.debug(f"  ... ({len(self.history) - 6} more messages) ...")
            for i, h in enumerate(self.history[-3:]):
                idx = len(self.history) - 3 + i
                logger.debug(f"  [{idx}] {h.get('role')}: {(h.get('content') or '')[:50]}...")
        
        return self.history
    
    def estimate_tokens(self, model: str) -> int:
        """
        估算当前记忆的 token 数
        
        Args:
            model: 模型名称
            
        Returns:
            估算的 token 数
        """
        msgs = [
            {'role': m.get('role', 'user'), 'content': m.get('content', '')}
            for m in self.history
            if m.get('content')
        ]
        
        # 加上摘要的 token
        if self.summary:
            msgs.insert(0, {'role': 'system', 'content': self.summary})
        
        return estimate_messages_tokens(msgs, model)
    
    def check_memory_budget(self, model: str, threshold: float = 0.8) -> bool:
        """
        检查记忆是否超过预算
        
        Args:
            model: 模型名称
            threshold: 阈值（0-1），默认 80%
            
        Returns:
            True 表示超过预算，需要摘要
        """
        max_tokens = get_model_max_tokens(model)
        current_tokens = self.estimate_tokens(model)
        return current_tokens > max_tokens * threshold
    
    def append_history(self, msg: Dict[str, Any]):
        """
        追加历史消息（轻量结构）
        
        Args:
            msg: 消息数据
        """
        message_id = msg.get('message_id')
        
        # 去重检查：如果消息已存在于历史中，不重复添加
        if message_id:
            existing_ids = {h.get('message_id') for h in self.history if h.get('message_id')}
            if message_id in existing_ids:
                return  # 跳过重复消息
        
        has_media = False
        media_count = 0
        
        # 检测是否有媒体
        try:
            ext = msg.get('ext') or {}
            media = ext.get('media')
            if isinstance(media, list) and media:
                has_media = True
                media_count = len(media)
                # 更新最近媒体消息 ID
                if message_id:
                    self._last_media_message_id = message_id
                    # 缓存媒体数据（当前消息的媒体可以直接缓存）
                    self._media_cache[message_id] = media
        except Exception:
            pass
        
        # 追加轻量消息
        history_item = {
            'message_id': message_id,
            'role': msg.get('role'),
            'content': msg.get('content'),
            'created_at': msg.get('created_at') or msg.get('timestamp'),
            'sender_id': msg.get('sender_id'),
            'sender_type': msg.get('sender_type'),
        }
        
        # 如果有媒体，添加占位符
        if has_media:
            history_item['has_media'] = True
            history_item['media_count'] = media_count
            if not history_item.get('content'):
                history_item['content'] = f'[图片×{media_count}]'
        
        self.history.append(history_item)
    
    def clear_after(self, message_id: str):
        """
        清除指定消息之后的历史（用于回退）
        
        Args:
            message_id: 目标消息 ID，该消息之后的所有消息将被删除
        """
        idx = next(
            (i for i, m in enumerate(self.history) if m.get('message_id') == message_id),
            None
        )
        if idx is not None:
            self.history = self.history[:idx + 1]  # 保留目标消息本身
            
            # 如果摘要覆盖范围已不在历史中，清除摘要
            if self.summary_until:
                history_ids = {m.get('message_id') for m in self.history}
                if self.summary_until not in history_ids:
                    self.summary = None
                    self.summary_until = None
    
    def is_processed(self, message_id: str) -> bool:
        """
        检查消息是否已处理（去重）
        
        Args:
            message_id: 消息 ID
            
        Returns:
            True 表示已处理
        """
        if not message_id:
            return False
        
        if message_id in self._processed_ids:
            return True
        
        self._processed_ids.add(message_id)
        
        # 限制集合大小
        if len(self._processed_ids) > self._max_processed_ids:
            # 移除最早的一半
            keep_count = self._max_processed_ids // 2
            self._processed_ids = set(list(self._processed_ids)[-keep_count:])
        
        return False
    
    def get_recent_history(
        self,
        max_messages: int = 10,
        max_total_chars: int = 8000,
        max_per_message_chars: int = 2400,
        include_summary: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        获取最近的历史消息（用于构建 LLM 上下文）
        
        Args:
            max_messages: 最大消息数
            max_total_chars: 总字符上限
            max_per_message_chars: 单条消息字符上限
            include_summary: 是否包含摘要
            
        Returns:
            消息列表（适合发送给 LLM）
        """
        result: List[Dict[str, Any]] = []
        
        # 添加摘要
        if include_summary and self.summary:
            result.append({
                'role': 'system',
                'content': '【对话摘要（自动生成）】\n' + self.summary.strip(),
            })
        
        # 排序历史（按时间）
        sorted_history = self._sort_history_by_time(self.history)
        
        # 取最近 N 条
        tail = sorted_history[-max_messages:] if max_messages > 0 else []
        
        # 筛选 user/assistant 消息
        msgs: List[Dict[str, Any]] = []
        for m in tail:
            if not isinstance(m, dict):
                continue
            
            role = (m.get('role') or '').strip()
            if role not in ('user', 'assistant'):
                continue
            
            content = self._clean_content(m.get('content', ''))
            
            # 如果有媒体占位符但内容为空，添加提示
            if m.get('has_media') and not content:
                media_count = m.get('media_count', 1)
                content = f'[图片×{media_count}]'
            
            if not content:
                continue
            
            # 截断单条消息
            if len(content) > max_per_message_chars:
                content = content[:max_per_message_chars] + '…'
            
            msg_item = {'role': role, 'content': content}
            
            # 保留媒体占位符信息，供后续按需获取
            if m.get('has_media'):
                msg_item['has_media'] = True
                msg_item['message_id'] = m.get('message_id')
            
            msgs.append(msg_item)
        
        # 总字符预算
        total = sum(len(x.get('content', '')) for x in msgs)
        if total > max_total_chars and max_total_chars > 0:
            # 从最旧开始丢弃
            trimmed: List[Dict[str, Any]] = []
            running = 0
            for x in reversed(msgs):
                c = x.get('content', '')
                if running + len(c) > max_total_chars and trimmed:
                    continue
                running += len(c)
                trimmed.append(x)
            msgs = list(reversed(trimmed))
        
        result.extend(msgs)
        return result
    
    def _sort_history_by_time(self, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """按时间排序历史消息"""
        def _sort_key(m: dict) -> float:
            try:
                v = (m or {}).get('created_at')
                if isinstance(v, (int, float)):
                    return float(v)
                if isinstance(v, str) and v:
                    try:
                        return datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp()
                    except Exception:
                        return 0.0
                return 0.0
            except Exception:
                return 0.0
        
        try:
            return sorted([m for m in history if isinstance(m, dict)], key=_sort_key)
        except Exception:
            return history
    
    def _clean_content(self, content: str) -> str:
        """清理消息内容"""
        if not isinstance(content, str):
            return ''
        
        t = content.strip()
        
        # 去掉工具提示前缀
        t = re.sub(r"^\[你已获得工具使用权：.*?\]\s*", "", t).strip()
        
        # 去掉 data:image markdown
        t = re.sub(r"!\[[^\]]*\]\(data:image\/[^)]+\)", "", t)
        
        return t.strip()
    
    def update_participants(self, participants: List[Dict[str, Any]]):
        """
        更新参与者信息
        
        Args:
            participants: 参与者列表
        """
        self.participants = participants
        
        # 提取 Agent 能力描述
        self.agent_abilities = {}
        for p in participants:
            if p.get('participant_type') == 'agent':
                pid = p.get('participant_id')
                # 从 system_prompt 提取前 80 字作为能力描述
                ability = (p.get('system_prompt') or '')[:80]
                self.agent_abilities[pid] = ability
    
    def should_attach_last_media(self, text: str) -> bool:
        """
        判断是否需要附加最近的媒体（用户引用"上图/这张图"）
        
        Args:
            text: 用户输入文本
            
        Returns:
            True 表示需要附加
        """
        if not text:
            return False
        
        t = text.lower()
        keywords = [
            '上图', '这张图', '那张图', '图里', '图中', '看图',
            '描述一下图', '识别图片', '图片', 'photo', 'image', 'screenshot',
            '根据图片', '根据上面的图', '根据刚才的图', '帮我看下图',
        ]
        return any(k in t for k in keywords)
    
    def get_last_media(self) -> Optional[List[Dict[str, Any]]]:
        """
        获取最近的媒体（按需从数据库/缓存加载）
        
        Returns:
            媒体列表，或 None
        """
        if not self._last_media_message_id:
            return None
        
        return self.get_media_by_message_id(self._last_media_message_id)
    
    def get_media_by_message_id(self, message_id: str) -> Optional[List[Dict[str, Any]]]:
        """
        按消息 ID 获取媒体数据（优先缓存，其次数据库）
        
        Args:
            message_id: 消息 ID
            
        Returns:
            媒体列表，或 None
        """
        if not message_id:
            return None
        
        # 1. 检查缓存
        if message_id in self._media_cache:
            return self._media_cache[message_id]
        
        # 2. 从数据库加载
        try:
            svc = get_message_service()
            msg = svc.get_message(message_id)
            if msg:
                ext = msg.get('ext') or {}
                media = ext.get('media')
                if isinstance(media, list) and media:
                    # 缓存并返回
                    self._media_cache[message_id] = media
                    return media
        except Exception:
            pass
        
        return None
    
    def clear_media_cache(self):
        """清理媒体缓存（内存优化）"""
        # 只保留最近的几条
        max_cache = 10
        if len(self._media_cache) > max_cache:
            # 保留最近的条目（按插入顺序，保留最后 max_cache 个）
            keys = list(self._media_cache.keys())
            for k in keys[:-max_cache]:
                del self._media_cache[k]
