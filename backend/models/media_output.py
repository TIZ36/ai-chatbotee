"""
媒体创作产出数据模型
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List
import json


@dataclass
class MediaOutput:
    """媒体创作产出数据模型"""

    output_id: str
    media_type: str  # image / video
    file_path: str
    mime_type: Optional[str] = None
    prompt: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    source: str = 'generated'
    file_size: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None

    @classmethod
    def from_db_row(cls, row: dict) -> 'MediaOutput':
        """从数据库行创建实例"""
        metadata = row.get('metadata')
        if isinstance(metadata, str):
            metadata = json.loads(metadata) if metadata else None

        return cls(
            output_id=row['output_id'],
            media_type=row['media_type'],
            file_path=row['file_path'],
            mime_type=row.get('mime_type'),
            prompt=row.get('prompt'),
            model=row.get('model'),
            provider=row.get('provider'),
            source=row.get('source', 'generated'),
            file_size=row.get('file_size'),
            metadata=metadata,
            created_at=row.get('created_at'),
        )

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'output_id': self.output_id,
            'media_type': self.media_type,
            'file_path': self.file_path,
            'mime_type': self.mime_type,
            'prompt': self.prompt,
            'model': self.model,
            'provider': self.provider,
            'source': self.source,
            'file_size': self.file_size,
            'metadata': self.metadata,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def to_db_params(self) -> dict:
        """转换为数据库插入参数"""
        return {
            'output_id': self.output_id,
            'media_type': self.media_type,
            'file_path': self.file_path,
            'mime_type': self.mime_type,
            'prompt': self.prompt,
            'model': self.model,
            'provider': self.provider,
            'source': self.source,
            'file_size': self.file_size,
            'metadata': json.dumps(self.metadata) if self.metadata else None,
        }


class MediaOutputRepository:
    """媒体产出数据仓库"""

    def __init__(self, get_connection):
        self.get_connection = get_connection

    def find_all(self, limit: int = 50, offset: int = 0) -> List[MediaOutput]:
        """分页获取产出列表，按创建时间倒序"""
        conn = self.get_connection()
        if not conn:
            return []

        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(
                """
                SELECT * FROM media_outputs
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            )
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            return [MediaOutput.from_db_row(row) for row in rows]
        except Exception as e:
            print(f"[MediaOutputRepository] Error find_all: {e}")
            if conn:
                conn.close()
            return []

    def find_by_id(self, output_id: str) -> Optional[MediaOutput]:
        """根据 output_id 获取单条"""
        conn = self.get_connection()
        if not conn:
            return None

        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM media_outputs WHERE output_id = %s", (output_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if row:
                return MediaOutput.from_db_row(row)
            return None
        except Exception as e:
            print(f"[MediaOutputRepository] Error find_by_id: {e}")
            if conn:
                conn.close()
            return None

    def save(self, output: MediaOutput) -> bool:
        """保存产出（插入）"""
        conn = self.get_connection()
        if not conn:
            return False

        try:
            cursor = conn.cursor()
            params = output.to_db_params()
            sql = """
                INSERT INTO media_outputs
                (output_id, media_type, file_path, mime_type, prompt, model,
                 provider, source, file_size, metadata)
                VALUES (%(output_id)s, %(media_type)s, %(file_path)s, %(mime_type)s,
                        %(prompt)s, %(model)s, %(provider)s, %(source)s,
                        %(file_size)s, %(metadata)s)
            """
            cursor.execute(sql, params)
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[MediaOutputRepository] Error save: {e}")
            if conn:
                conn.close()
            return False

    def delete(self, output_id: str) -> bool:
        """删除产出记录"""
        conn = self.get_connection()
        if not conn:
            return False

        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM media_outputs WHERE output_id = %s", (output_id,))
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected > 0
        except Exception as e:
            print(f"[MediaOutputRepository] Error delete: {e}")
            if conn:
                conn.close()
            return False
