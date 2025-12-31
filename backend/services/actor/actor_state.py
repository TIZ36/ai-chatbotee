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
        
        # 媒体上下文（最近一次媒体，用于引用"上图/这张图"）
        self.last_media: Optional[List[Dict[str, Any]]] = None
        
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
        self.topic_id = topic_id
        svc = get_message_service()
        
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
            
            # 提取媒体（缓存最近一次）
            try:
                ext = m.get('ext') or {}
                media = ext.get('media')
                if isinstance(media, list) and media:
                    self.last_media = media
            except Exception:
                pass
            
            self.history.append({
                'message_id': m.get('message_id'),
                'role': m.get('role'),
                'content': m.get('content'),
                'created_at': m.get('created_at'),
                'sender_id': m.get('sender_id'),
                'sender_type': m.get('sender_type'),
            })
        
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
        # 提取媒体
        try:
            ext = msg.get('ext') or {}
            media = ext.get('media')
            if isinstance(media, list) and media:
                self.last_media = media
        except Exception:
            pass
        
        # 追加轻量消息
        self.history.append({
            'message_id': msg.get('message_id'),
            'role': msg.get('role'),
            'content': msg.get('content'),
            'created_at': msg.get('created_at') or msg.get('timestamp'),
            'sender_id': msg.get('sender_id'),
            'sender_type': msg.get('sender_type'),
        })
    
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
        max_messages: int = 24,
        max_total_chars: int = 18000,
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
            if not content:
                continue
            
            # 截断单条消息
            if len(content) > max_per_message_chars:
                content = content[:max_per_message_chars] + '…'
            
            msgs.append({'role': role, 'content': content})
        
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
        """获取最近的媒体"""
        if isinstance(self.last_media, list) and self.last_media:
            return self.last_media
        return None
