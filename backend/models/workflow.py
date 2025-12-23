"""
工作流数据模型
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List
import json


@dataclass
class Workflow:
    """工作流数据模型"""
    
    workflow_id: str
    name: str
    description: Optional[str] = None
    config: Optional[Dict[str, Any]] = None  # 节点、连接等配置
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    @classmethod
    def from_db_row(cls, row: dict) -> 'Workflow':
        """从数据库行创建实例"""
        config = row.get('config')
        if isinstance(config, str):
            config = json.loads(config)
        
        return cls(
            workflow_id=row['workflow_id'],
            name=row['name'],
            description=row.get('description'),
            config=config,
            created_at=row.get('created_at'),
            updated_at=row.get('updated_at'),
        )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'workflow_id': self.workflow_id,
            'name': self.name,
            'description': self.description,
            'config': self.config,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
    
    def to_db_params(self) -> dict:
        """转换为数据库插入参数"""
        return {
            'workflow_id': self.workflow_id,
            'name': self.name,
            'description': self.description,
            'config': json.dumps(self.config) if self.config else None,
        }


class WorkflowRepository:
    """工作流数据仓库"""
    
    def __init__(self, get_connection):
        self.get_connection = get_connection
    
    def find_all(self) -> List[Workflow]:
        """获取所有工作流"""
        conn = self.get_connection()
        if not conn:
            return []
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM workflows ORDER BY created_at DESC")
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            
            return [Workflow.from_db_row(row) for row in rows]
        except Exception as e:
            print(f"[WorkflowRepository] Error finding all: {e}")
            if conn:
                conn.close()
            return []
    
    def find_by_id(self, workflow_id: str) -> Optional[Workflow]:
        """根据 ID 获取工作流"""
        conn = self.get_connection()
        if not conn:
            return None
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM workflows WHERE workflow_id = %s", (workflow_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if row:
                return Workflow.from_db_row(row)
            return None
        except Exception as e:
            print(f"[WorkflowRepository] Error finding by id: {e}")
            if conn:
                conn.close()
            return None
    
    def save(self, workflow: Workflow) -> bool:
        """保存工作流"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            params = workflow.to_db_params()
            
            sql = """
            INSERT INTO workflows 
            (workflow_id, name, description, config)
            VALUES (%(workflow_id)s, %(name)s, %(description)s, %(config)s)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                description = VALUES(description),
                config = VALUES(config),
                updated_at = CURRENT_TIMESTAMP
            """
            cursor.execute(sql, params)
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[WorkflowRepository] Error saving: {e}")
            if conn:
                conn.close()
            return False
    
    def delete(self, workflow_id: str) -> bool:
        """删除工作流"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM workflows WHERE workflow_id = %s", (workflow_id,))
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected > 0
        except Exception as e:
            print(f"[WorkflowRepository] Error deleting: {e}")
            if conn:
                conn.close()
            return False
