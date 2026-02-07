"""
媒体创作产出服务层
负责文件存储与数据库 CRUD
"""

from pathlib import Path
from typing import Optional, Dict, Any, List, Union
from datetime import datetime
import uuid
import base64
import logging

from models.media_output import MediaOutput, MediaOutputRepository

logger = logging.getLogger(__name__)

# 后端根目录（backend/）
BACKEND_ROOT = Path(__file__).resolve().parent.parent
UPLOADS_MEDIA = BACKEND_ROOT / 'uploads' / 'media'


media_output_service: Optional['MediaOutputService'] = None


def init_media_output_service(get_connection):
    """初始化媒体产出服务"""
    global media_output_service
    media_output_service = MediaOutputService(get_connection)
    return media_output_service


def get_media_output_service() -> 'MediaOutputService':
    """获取媒体产出服务实例"""
    if media_output_service is None:
        raise RuntimeError('Media output service not initialized')
    return media_output_service


class MediaOutputService:
    """媒体创作产出服务"""

    def __init__(self, get_connection):
        self.get_connection = get_connection
        self.repository = MediaOutputRepository(get_connection)

    def _month_dir(self) -> Path:
        """按月份子目录：uploads/media/YYYY-MM"""
        now = datetime.utcnow()
        sub = UPLOADS_MEDIA / now.strftime('%Y-%m')
        sub.mkdir(parents=True, exist_ok=True)
        return sub

    def _ext_from_mime(self, mime_type: Optional[str], media_type: str) -> str:
        """根据 mime_type 或 media_type 返回扩展名"""
        if mime_type:
            if 'png' in mime_type:
                return 'png'
            if 'jpeg' in mime_type or 'jpg' in mime_type:
                return 'jpg'
            if 'gif' in mime_type:
                return 'gif'
            if 'webp' in mime_type:
                return 'webp'
            if 'mp4' in mime_type or 'video' in mime_type:
                return 'mp4'
            if 'webm' in mime_type:
                return 'webm'
        return 'mp4' if media_type == 'video' else 'png'

    def save_output(
        self,
        file_data: Union[bytes, str],
        media_type: str,
        mime_type: Optional[str] = None,
        prompt: Optional[str] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
        source: str = 'generated',
        metadata: Optional[Dict[str, Any]] = None,
        output_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        保存产出：写入文件 + 写入数据库。
        file_data: 图片或视频的二进制数据，或 base64 字符串（含 data:xxx;base64, 前缀时会自动剥离）。
        """
        if isinstance(file_data, str):
            raw = file_data.strip()
            if raw.startswith('data:'):
                if ';base64,' in raw:
                    raw = raw.split(';base64,', 1)[1]
                else:
                    raw = raw.split(',', 1)[-1]
            try:
                file_data = base64.b64decode(raw)
            except Exception as e:
                return {'error': f'base64 解码失败: {e}'}
        output_id = output_id or f"mo_{uuid.uuid4().hex[:16]}"
        ext = self._ext_from_mime(mime_type, media_type)
        month_dir = self._month_dir()
        filename = f"{output_id}.{ext}"
        file_path_obj = month_dir / filename
        # 存库用相对路径，便于迁移
        relative_path = f"uploads/media/{month_dir.name}/{filename}"
        file_size = len(file_data)

        try:
            file_path_obj.write_bytes(file_data)
        except Exception as e:
            logger.exception("[MediaOutput] Failed to write file")
            return {'error': f'写入文件失败: {e}'}

        output = MediaOutput(
            output_id=output_id,
            media_type=media_type,
            file_path=relative_path,
            mime_type=mime_type or ('video/mp4' if media_type == 'video' else 'image/png'),
            prompt=prompt,
            model=model,
            provider=provider,
            source=source,
            file_size=file_size,
            metadata=metadata,
        )
        if not self.repository.save(output):
            try:
                file_path_obj.unlink(missing_ok=True)
            except Exception:
                pass
            return {'error': '写入数据库失败'}

        return output.to_dict()

    def list_outputs(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """分页列表"""
        rows = self.repository.find_all(limit=limit, offset=offset)
        return [r.to_dict() for r in rows]

    def get_output(self, output_id: str) -> Optional[Dict[str, Any]]:
        """获取单条"""
        out = self.repository.find_by_id(output_id)
        return out.to_dict() if out else None

    def get_output_file_path(self, output_id: str) -> Optional[Path]:
        """获取产出文件的绝对路径，用于 send_file。不存在或越权则返回 None。"""
        out = self.repository.find_by_id(output_id)
        if not out:
            return None
        full = BACKEND_ROOT / out.file_path
        try:
            full = full.resolve()
            root_resolved = BACKEND_ROOT.resolve()
            if root_resolved not in full.parents and full != root_resolved:
                return None
            if not full.is_file():
                return None
        except Exception:
            return None
        return full

    def delete_output(self, output_id: str) -> Dict[str, Any]:
        """删除产出：删文件 + 删库记录"""
        out = self.repository.find_by_id(output_id)
        if not out:
            return {'error': '产出不存在', 'deleted': False}
        full = BACKEND_ROOT / out.file_path
        try:
            if full.is_file():
                full.unlink()
        except Exception as e:
            logger.warning("[MediaOutput] Failed to delete file %s: %s", full, e)
        if not self.repository.delete(output_id):
            return {'error': '删除数据库记录失败', 'deleted': False}
        return {'deleted': True}
