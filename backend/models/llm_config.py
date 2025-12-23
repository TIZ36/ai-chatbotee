"""
LLM 配置数据模型
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
import json


@dataclass
class LLMConfig:
    """LLM 配置数据模型"""
    
    config_id: str
    name: str
    provider: str  # openai, anthropic, gemini, ollama, local, custom
    api_key: Optional[str] = None
    api_url: Optional[str] = None
    model: Optional[str] = None
    tags: Optional[List[str]] = None
    enabled: bool = True
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    @classmethod
    def from_db_row(cls, row: dict) -> 'LLMConfig':
        """从数据库行创建实例"""
        tags = row.get('tags')
        if isinstance(tags, str):
            tags = json.loads(tags)
        
        metadata = row.get('metadata')
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        
        return cls(
            config_id=row['config_id'],
            name=row['name'],
            provider=row['provider'],
            api_key=row.get('api_key'),
            api_url=row.get('api_url'),
            model=row.get('model'),
            tags=tags,
            enabled=bool(row.get('enabled', True)),
            description=row.get('description'),
            metadata=metadata,
            created_at=row.get('created_at'),
            updated_at=row.get('updated_at'),
        )
    
    def to_dict(self, include_api_key: bool = False) -> dict:
        """
        转换为字典
        
        Args:
            include_api_key: 是否包含 API Key（安全考虑，默认不包含）
        """
        result = {
            'config_id': self.config_id,
            'name': self.name,
            'provider': self.provider,
            'api_url': self.api_url,
            'model': self.model,
            'tags': self.tags or [],
            'enabled': self.enabled,
            'description': self.description,
            'metadata': self.metadata,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        
        if include_api_key:
            result['api_key'] = self.api_key
        else:
            # 只显示 API Key 是否存在
            result['has_api_key'] = bool(self.api_key)
        
        return result
    
    def to_db_params(self) -> dict:
        """转换为数据库插入/更新参数"""
        return {
            'config_id': self.config_id,
            'name': self.name,
            'provider': self.provider,
            'api_key': self.api_key,
            'api_url': self.api_url,
            'model': self.model,
            'tags': json.dumps(self.tags) if self.tags else None,
            'enabled': 1 if self.enabled else 0,
            'description': self.description,
            'metadata': json.dumps(self.metadata) if self.metadata else None,
        }


class LLMConfigRepository:
    """LLM 配置数据仓库"""
    
    def __init__(self, get_connection):
        """
        Args:
            get_connection: 获取数据库连接的函数
        """
        self.get_connection = get_connection
    
    def find_all(self, enabled_only: bool = False) -> List[LLMConfig]:
        """获取所有配置"""
        conn = self.get_connection()
        if not conn:
            return []
        
        try:
            cursor = conn.cursor()
            if enabled_only:
                cursor.execute("SELECT * FROM llm_configs WHERE enabled = 1 ORDER BY created_at DESC")
            else:
                cursor.execute("SELECT * FROM llm_configs ORDER BY created_at DESC")
            
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            
            # 转换为字典列表（假设使用 DictCursor 或手动转换）
            columns = [desc[0] for desc in cursor.description] if hasattr(cursor, 'description') else []
            return [LLMConfig.from_db_row(dict(zip(columns, row)) if not isinstance(row, dict) else row) for row in rows]
        except Exception as e:
            print(f"[LLMConfigRepository] Error finding all: {e}")
            if conn:
                conn.close()
            return []
    
    def find_by_id(self, config_id: str) -> Optional[LLMConfig]:
        """根据 ID 获取配置"""
        conn = self.get_connection()
        if not conn:
            return None
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM llm_configs WHERE config_id = %s", (config_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if row:
                return LLMConfig.from_db_row(row)
            return None
        except Exception as e:
            print(f"[LLMConfigRepository] Error finding by id: {e}")
            if conn:
                conn.close()
            return None
    
    def save(self, config: LLMConfig) -> bool:
        """保存配置（插入或更新）"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            params = config.to_db_params()
            
            sql = """
            INSERT INTO llm_configs 
            (config_id, name, provider, api_key, api_url, model, tags, enabled, description, metadata)
            VALUES (%(config_id)s, %(name)s, %(provider)s, %(api_key)s, %(api_url)s, 
                    %(model)s, %(tags)s, %(enabled)s, %(description)s, %(metadata)s)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                provider = VALUES(provider),
                api_key = VALUES(api_key),
                api_url = VALUES(api_url),
                model = VALUES(model),
                tags = VALUES(tags),
                enabled = VALUES(enabled),
                description = VALUES(description),
                metadata = VALUES(metadata),
                updated_at = CURRENT_TIMESTAMP
            """
            cursor.execute(sql, params)
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[LLMConfigRepository] Error saving: {e}")
            if conn:
                conn.close()
            return False
    
    def delete(self, config_id: str) -> bool:
        """删除配置"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM llm_configs WHERE config_id = %s", (config_id,))
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected > 0
        except Exception as e:
            print(f"[LLMConfigRepository] Error deleting: {e}")
            if conn:
                conn.close()
            return False
