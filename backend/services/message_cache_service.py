"""
消息缓存服务
使用 Redis 实现高效的消息缓存机制

缓存策略:
1. 消息缓存 (HSET): session:{session_id}:messages -> {message_id: json_data}
2. 消息顺序 (ZSET): session:{session_id}:message_order -> {message_id: timestamp}
3. 媒体索引 (ZSET): session:{session_id}:media -> {message_id: timestamp}
4. 最新消息ID缓存: session:{session_id}:latest_message_id

缓存失效策略:
- 消息编辑时：更新单条消息缓存
- 消息回退/删除时：清空整个会话缓存
- 写入新消息时：更新缓存和索引
"""

import json
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime

from database import get_redis_client


class MessageCacheService:
    """消息缓存服务"""
    
    # 缓存过期时间（秒）- 24小时
    CACHE_TTL = 86400
    # 默认批量获取数量
    DEFAULT_BATCH_SIZE = 50
    
    def __init__(self):
        self.redis = get_redis_client()
    
    def _get_messages_key(self, session_id: str) -> str:
        """获取消息 HSET 的 key"""
        return f"session:{session_id}:messages"
    
    def _get_order_key(self, session_id: str) -> str:
        """获取消息顺序 ZSET 的 key"""
        return f"session:{session_id}:message_order"
    
    def _get_media_key(self, session_id: str) -> str:
        """获取媒体索引 ZSET 的 key"""
        return f"session:{session_id}:media"
    
    def _get_latest_message_key(self, session_id: str) -> str:
        """获取最新消息ID的 key"""
        return f"session:{session_id}:latest_message_id"
    
    def _get_cache_version_key(self, session_id: str) -> str:
        """获取缓存版本号的 key（用于失效检测）"""
        return f"session:{session_id}:cache_version"
    
    def _message_to_json(self, message: Dict[str, Any]) -> str:
        """将消息转换为 JSON 字符串"""
        # 处理 datetime 对象
        msg_copy = message.copy()
        if 'created_at' in msg_copy:
            if isinstance(msg_copy['created_at'], datetime):
                msg_copy['created_at'] = msg_copy['created_at'].isoformat()
        return json.dumps(msg_copy, ensure_ascii=False)
    
    def _json_to_message(self, json_str: str) -> Optional[Dict[str, Any]]:
        """将 JSON 字符串转换为消息"""
        try:
            return json.loads(json_str)
        except (json.JSONDecodeError, TypeError):
            return None
    
    def _get_message_timestamp(self, message: Dict[str, Any]) -> float:
        """获取消息的时间戳（用于排序）"""
        created_at = message.get('created_at')
        if isinstance(created_at, datetime):
            return created_at.timestamp()
        elif isinstance(created_at, str):
            try:
                dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                return dt.timestamp()
            except ValueError:
                pass
        # 如果无法解析，使用当前时间
        return datetime.now().timestamp()
    
    def _has_media(self, message: Dict[str, Any]) -> bool:
        """检查消息是否包含媒体内容"""
        # 检查 ext 字段中的媒体
        ext = message.get('ext', {})
        if ext:
            if isinstance(ext, str):
                try:
                    ext = json.loads(ext)
                except:
                    ext = {}
            # 检查是否有图片、视频、音频等媒体
            if ext.get('media') or ext.get('images') or ext.get('videos') or ext.get('audio'):
                return True
        
        # 检查 mcpdetail 中的媒体
        mcpdetail = message.get('mcpdetail', {})
        if mcpdetail:
            if isinstance(mcpdetail, str):
                try:
                    mcpdetail = json.loads(mcpdetail)
                except:
                    mcpdetail = {}
            # 检查 raw_result 中是否有图片类型内容
            raw_result = mcpdetail.get('raw_result', [])
            if raw_result:
                for item in raw_result:
                    if isinstance(item, dict) and item.get('type') == 'image':
                        return True
        
        # 检查内容中是否有 base64 图片
        content = message.get('content', '')
        if content and ('data:image/' in content or 'base64,' in content):
            return True
        
        return False
    
    # ==================== 缓存读取 ====================
    
    def get_latest_message_id(self, session_id: str) -> Optional[str]:
        """获取会话的最新消息ID"""
        if not self.redis:
            return None
        
        try:
            key = self._get_latest_message_key(session_id)
            result = self.redis.get(key)
            if isinstance(result, bytes):
                result = result.decode('utf-8')
            return result
        except Exception as e:
            print(f"[MessageCache] Error getting latest message id: {e}")
            return None
    
    def get_cached_messages(
        self, 
        session_id: str, 
        limit: int = DEFAULT_BATCH_SIZE,
        before_id: Optional[str] = None,
        after_id: Optional[str] = None
    ) -> Tuple[List[Dict[str, Any]], bool]:
        """
        从缓存获取消息列表
        
        Args:
            session_id: 会话ID
            limit: 获取数量
            before_id: 获取此消息之前的消息
            after_id: 获取此消息之后的消息
            
        Returns:
            (消息列表, 是否有更多消息)
        """
        if not self.redis:
            return [], False
        
        try:
            messages_key = self._get_messages_key(session_id)
            order_key = self._get_order_key(session_id)
            
            # 检查缓存是否存在
            if not self.redis.exists(order_key):
                return [], False
            
            # 获取消息ID顺序
            if before_id:
                # 获取指定消息之前的消息
                # 先获取 before_id 的分数
                before_score = self.redis.zscore(order_key, before_id)
                if before_score is None:
                    return [], False
                
                # 获取分数小于 before_score 的消息ID，按分数降序
                message_ids = self.redis.zrevrangebyscore(
                    order_key,
                    f"({before_score}",  # 不包含 before_id 本身
                    "-inf",
                    start=0,
                    num=limit + 1  # 多取一个用于判断是否有更多
                )
            elif after_id:
                # 获取指定消息之后的消息
                after_score = self.redis.zscore(order_key, after_id)
                if after_score is None:
                    return [], False
                
                # 获取分数大于 after_score 的消息ID，按分数升序
                message_ids = self.redis.zrangebyscore(
                    order_key,
                    f"({after_score}",
                    "+inf",
                    start=0,
                    num=limit + 1
                )
            else:
                # 获取最新的消息（按分数降序）
                message_ids = self.redis.zrevrange(order_key, 0, limit)
            
            if not message_ids:
                return [], False
            
            # 判断是否有更多消息
            has_more = len(message_ids) > limit
            if has_more:
                message_ids = message_ids[:limit]
            
            # 转换为字符串
            message_ids = [
                mid.decode('utf-8') if isinstance(mid, bytes) else mid 
                for mid in message_ids
            ]
            
            # 批量获取消息内容
            if message_ids:
                messages_data = self.redis.hmget(messages_key, message_ids)
                messages = []
                for i, data in enumerate(messages_data):
                    if data:
                        if isinstance(data, bytes):
                            data = data.decode('utf-8')
                        msg = self._json_to_message(data)
                        if msg:
                            messages.append(msg)
                
                # 按时间正序排列（从旧到新）
                if before_id or (not after_id):
                    messages.reverse()
                
                return messages, has_more
            
            return [], False
            
        except Exception as e:
            print(f"[MessageCache] Error getting cached messages: {e}")
            import traceback
            traceback.print_exc()
            return [], False
    
    def get_message(self, session_id: str, message_id: str) -> Optional[Dict[str, Any]]:
        """获取单条消息"""
        if not self.redis:
            return None
        
        try:
            messages_key = self._get_messages_key(session_id)
            data = self.redis.hget(messages_key, message_id)
            if data:
                if isinstance(data, bytes):
                    data = data.decode('utf-8')
                return self._json_to_message(data)
            return None
        except Exception as e:
            print(f"[MessageCache] Error getting message: {e}")
            return None
    
    def get_media_list(
        self, 
        session_id: str, 
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        获取会话的媒体列表
        
        Args:
            session_id: 会话ID
            limit: 获取数量
            offset: 偏移量
            
        Returns:
            (媒体消息列表, 总数)
        """
        if not self.redis:
            return [], 0
        
        try:
            media_key = self._get_media_key(session_id)
            messages_key = self._get_messages_key(session_id)
            
            # 获取媒体总数
            total = self.redis.zcard(media_key)
            
            if total == 0:
                return [], 0
            
            # 获取媒体消息ID（按时间倒序）
            message_ids = self.redis.zrevrange(media_key, offset, offset + limit - 1)
            
            if not message_ids:
                return [], total
            
            # 转换为字符串
            message_ids = [
                mid.decode('utf-8') if isinstance(mid, bytes) else mid 
                for mid in message_ids
            ]
            
            # 批量获取消息内容
            messages_data = self.redis.hmget(messages_key, message_ids)
            messages = []
            for data in messages_data:
                if data:
                    if isinstance(data, bytes):
                        data = data.decode('utf-8')
                    msg = self._json_to_message(data)
                    if msg:
                        messages.append(msg)
            
            return messages, total
            
        except Exception as e:
            print(f"[MessageCache] Error getting media list: {e}")
            return [], 0
    
    def is_cache_valid(self, session_id: str) -> bool:
        """检查会话缓存是否有效"""
        if not self.redis:
            return False
        
        try:
            order_key = self._get_order_key(session_id)
            return self.redis.exists(order_key) > 0
        except Exception as e:
            print(f"[MessageCache] Error checking cache validity: {e}")
            return False
    
    # ==================== 缓存写入 ====================
    
    def cache_message(self, message: Dict[str, Any]) -> bool:
        """
        缓存单条消息
        
        Args:
            message: 消息数据
            
        Returns:
            是否成功
        """
        if not self.redis:
            return False
        
        try:
            session_id = message.get('session_id')
            message_id = message.get('message_id')
            
            if not session_id or not message_id:
                return False
            
            messages_key = self._get_messages_key(session_id)
            order_key = self._get_order_key(session_id)
            latest_key = self._get_latest_message_key(session_id)
            
            # 获取时间戳
            timestamp = self._get_message_timestamp(message)
            
            # 使用 pipeline 批量执行
            pipe = self.redis.pipeline()
            
            # 存储消息内容
            pipe.hset(messages_key, message_id, self._message_to_json(message))
            
            # 更新消息顺序
            pipe.zadd(order_key, {message_id: timestamp})
            
            # 更新最新消息ID
            pipe.set(latest_key, message_id)
            
            # 设置过期时间
            pipe.expire(messages_key, self.CACHE_TTL)
            pipe.expire(order_key, self.CACHE_TTL)
            pipe.expire(latest_key, self.CACHE_TTL)
            
            # 如果消息包含媒体，添加到媒体索引
            if self._has_media(message):
                media_key = self._get_media_key(session_id)
                pipe.zadd(media_key, {message_id: timestamp})
                pipe.expire(media_key, self.CACHE_TTL)
            
            pipe.execute()
            return True
            
        except Exception as e:
            print(f"[MessageCache] Error caching message: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def cache_messages_batch(self, session_id: str, messages: List[Dict[str, Any]]) -> bool:
        """
        批量缓存消息
        
        Args:
            session_id: 会话ID
            messages: 消息列表
            
        Returns:
            是否成功
        """
        if not self.redis or not messages:
            return False
        
        try:
            messages_key = self._get_messages_key(session_id)
            order_key = self._get_order_key(session_id)
            media_key = self._get_media_key(session_id)
            latest_key = self._get_latest_message_key(session_id)
            
            # 使用 pipeline 批量执行
            pipe = self.redis.pipeline()
            
            # 准备数据
            messages_data = {}
            order_data = {}
            media_data = {}
            latest_message_id = None
            latest_timestamp = 0
            
            for msg in messages:
                message_id = msg.get('message_id')
                if not message_id:
                    continue
                
                timestamp = self._get_message_timestamp(msg)
                
                # 消息内容
                messages_data[message_id] = self._message_to_json(msg)
                
                # 消息顺序
                order_data[message_id] = timestamp
                
                # 媒体索引
                if self._has_media(msg):
                    media_data[message_id] = timestamp
                
                # 跟踪最新消息
                if timestamp > latest_timestamp:
                    latest_timestamp = timestamp
                    latest_message_id = message_id
            
            # 批量写入
            if messages_data:
                pipe.hset(messages_key, mapping=messages_data)
            
            if order_data:
                pipe.zadd(order_key, order_data)
            
            if media_data:
                pipe.zadd(media_key, media_data)
            
            if latest_message_id:
                pipe.set(latest_key, latest_message_id)
            
            # 设置过期时间
            pipe.expire(messages_key, self.CACHE_TTL)
            pipe.expire(order_key, self.CACHE_TTL)
            pipe.expire(latest_key, self.CACHE_TTL)
            if media_data:
                pipe.expire(media_key, self.CACHE_TTL)
            
            pipe.execute()
            return True
            
        except Exception as e:
            print(f"[MessageCache] Error caching messages batch: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def update_message(self, session_id: str, message_id: str, message: Dict[str, Any]) -> bool:
        """
        更新单条消息的缓存
        
        Args:
            session_id: 会话ID
            message_id: 消息ID
            message: 更新后的消息数据
            
        Returns:
            是否成功
        """
        if not self.redis:
            return False
        
        try:
            messages_key = self._get_messages_key(session_id)
            media_key = self._get_media_key(session_id)
            
            # 检查缓存是否存在
            if not self.redis.hexists(messages_key, message_id):
                # 缓存不存在，直接返回
                return True
            
            pipe = self.redis.pipeline()
            
            # 更新消息内容
            pipe.hset(messages_key, message_id, self._message_to_json(message))
            
            # 更新媒体索引
            timestamp = self._get_message_timestamp(message)
            if self._has_media(message):
                pipe.zadd(media_key, {message_id: timestamp})
            else:
                # 如果不再有媒体，从媒体索引中移除
                pipe.zrem(media_key, message_id)
            
            pipe.execute()
            return True
            
        except Exception as e:
            print(f"[MessageCache] Error updating message cache: {e}")
            return False
    
    # ==================== 缓存失效 ====================
    
    def invalidate_session_cache(self, session_id: str) -> bool:
        """
        使会话缓存失效（用于消息删除/回退等操作）
        
        Args:
            session_id: 会话ID
            
        Returns:
            是否成功
        """
        if not self.redis:
            return False
        
        try:
            # 删除所有相关缓存
            keys = [
                self._get_messages_key(session_id),
                self._get_order_key(session_id),
                self._get_media_key(session_id),
                self._get_latest_message_key(session_id),
                self._get_cache_version_key(session_id),
            ]
            
            self.redis.delete(*keys)
            print(f"[MessageCache] Invalidated cache for session: {session_id}")
            return True
            
        except Exception as e:
            print(f"[MessageCache] Error invalidating session cache: {e}")
            return False
    
    def remove_message_from_cache(self, session_id: str, message_id: str) -> bool:
        """
        从缓存中移除单条消息
        
        Args:
            session_id: 会话ID
            message_id: 消息ID
            
        Returns:
            是否成功
        """
        if not self.redis:
            return False
        
        try:
            messages_key = self._get_messages_key(session_id)
            order_key = self._get_order_key(session_id)
            media_key = self._get_media_key(session_id)
            
            pipe = self.redis.pipeline()
            pipe.hdel(messages_key, message_id)
            pipe.zrem(order_key, message_id)
            pipe.zrem(media_key, message_id)
            pipe.execute()
            
            return True
            
        except Exception as e:
            print(f"[MessageCache] Error removing message from cache: {e}")
            return False
    
    # ==================== 统计信息 ====================
    
    def get_cache_stats(self, session_id: str) -> Dict[str, Any]:
        """
        获取会话缓存统计信息
        
        Args:
            session_id: 会话ID
            
        Returns:
            统计信息
        """
        if not self.redis:
            return {'cached': False}
        
        try:
            messages_key = self._get_messages_key(session_id)
            order_key = self._get_order_key(session_id)
            media_key = self._get_media_key(session_id)
            
            message_count = self.redis.hlen(messages_key)
            media_count = self.redis.zcard(media_key)
            
            # 获取最旧和最新消息的时间
            oldest = self.redis.zrange(order_key, 0, 0, withscores=True)
            newest = self.redis.zrevrange(order_key, 0, 0, withscores=True)
            
            oldest_time = None
            newest_time = None
            
            if oldest:
                oldest_time = datetime.fromtimestamp(oldest[0][1]).isoformat()
            if newest:
                newest_time = datetime.fromtimestamp(newest[0][1]).isoformat()
            
            return {
                'cached': message_count > 0,
                'message_count': message_count,
                'media_count': media_count,
                'oldest_message_time': oldest_time,
                'newest_message_time': newest_time,
            }
            
        except Exception as e:
            print(f"[MessageCache] Error getting cache stats: {e}")
            return {'cached': False, 'error': str(e)}


# 全局服务实例
message_cache_service: Optional[MessageCacheService] = None


def init_message_cache_service() -> MessageCacheService:
    """初始化消息缓存服务"""
    global message_cache_service
    message_cache_service = MessageCacheService()
    return message_cache_service


def get_message_cache_service() -> MessageCacheService:
    """获取消息缓存服务实例"""
    global message_cache_service
    if message_cache_service is None:
        message_cache_service = MessageCacheService()
    return message_cache_service

