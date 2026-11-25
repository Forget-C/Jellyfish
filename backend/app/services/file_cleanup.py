"""删除文件字节并清理遗留上传，保留任务历史与文件元信息。"""

from datetime import UTC, datetime, timedelta
from hashlib import sha256
import json
import logging
from pathlib import Path

from sqlalchemy import or_, select, update
from sqlalchemy.engine import URL, make_url

from app.config import settings
from app.core import storage
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import Task
from app.services.task_service import utcnow

logger = logging.getLogger(__name__)


def orphan_cleanup_scope(database: URL) -> str | None:
    """Identify the database and storage namespace without using database credentials."""
    endpoint = (settings.s3_endpoint_url or "").strip().rstrip("/")
    # Driver options can override the database target, and boto can discover another endpoint.
    if not endpoint or not settings.s3_bucket_name or database.query or not database.database or database.database == ":memory:":
        return None
    location = str(Path(database.database).resolve()) if database.get_backend_name() == "sqlite" else database.database
    scope = (
        database.get_backend_name(), database.host, database.port, location,
        endpoint, settings.s3_region_name, settings.s3_addressing_style,
        settings.s3_bucket_name, settings.s3_base_path.strip().strip("/"),
    )
    return sha256(json.dumps(scope).encode()).hexdigest()


class FileCleaner:
    """每轮只处理一批删除和一页孤儿对象；游标仅用于公平扫描，不承担恢复执行。"""

    def __init__(self, sessions, *, batch_size: int = 100):
        """注入会话工厂，存储调用前关闭读事务。"""
        self.sessions = sessions
        self.batch_size = batch_size
        self.delete_cursor = ""
        self.prefix = "files/"
        self.object_cursor = None

    async def run_once(self) -> None:
        """失败删除保留标记供后续轮次重试，不阻塞其他文件。"""
        await self._delete_requested()
        configured_scope = settings.s3_orphan_cleanup_scope
        bind = getattr(self.sessions, "kw", {}).get("bind")
        database = getattr(bind, "url", None)
        if configured_scope and database is not None and configured_scope == orphan_cleanup_scope(database):
            await self._scan_orphans()

    async def _delete_requested(self) -> None:
        """先读取不可变 key，删除完成后另开事务记账；重复删除对象安全。"""
        async with self.sessions() as db:
            rows = list((await db.execute(select(FileItem.id, FileItem.storage_key, FileItem.thumbnail_key).where(
                FileItem.delete_requested_at.is_not(None), FileItem.deleted_at.is_(None),
                FileItem.id > self.delete_cursor,
            ).order_by(FileItem.id).limit(self.batch_size))).all())
        for file_id, key, thumbnail in rows:
            try:
                for object_key in dict.fromkeys(value for value in (key, thumbnail) if value):
                    await storage.delete_file(key=object_key)
                async with self.sessions() as db:
                    await db.execute(update(FileItem).where(
                        FileItem.id == file_id, FileItem.delete_requested_at.is_not(None), FileItem.deleted_at.is_(None),
                    ).values(deleted_at=utcnow()))
                    await db.commit()
            except Exception as error:
                logger.warning("file cleanup failed: file=%s error=%s", file_id, type(error).__name__)
        self.delete_cursor = rows[-1].id if len(rows) == self.batch_size else ""

    async def _scan_orphans(self) -> None:
        """只清理专属前缀下超过一天且无文件登记、无活动任务的对象。"""
        objects, cursor = await storage.list_files_page(
            prefix=self.prefix, cursor=self.object_cursor, limit=self.batch_size,
        )
        cutoff = datetime.now(UTC) - timedelta(days=1)
        for obj in objects:
            modified = (obj.extra or {}).get("LastModified")
            if not isinstance(modified, datetime) or modified.tzinfo is None or modified > cutoff:
                continue
            async with self.sessions() as db:
                registered = await db.scalar(select(FileItem.id).where(or_(
                    FileItem.storage_key == obj.key, FileItem.thumbnail_key == obj.key,
                )).limit(1))
                if registered:
                    continue
                if obj.key.startswith("generated/"):
                    task_id = obj.key.split("/", 2)[1]
                    active = await db.scalar(select(Task.id).where(
                        Task.id == task_id, Task.status.in_(["queued", "running"]),
                    ))
                    if active:
                        continue
            try:
                await storage.delete_file(key=obj.key)
            except Exception as error:
                logger.warning("orphan cleanup failed: error=%s", type(error).__name__)
        self.object_cursor = cursor
        if cursor is None:
            self.prefix = "generated/" if self.prefix == "files/" else "files/"


if __name__ == "__main__":
    configured = orphan_cleanup_scope(make_url(settings.database_url))
    if configured is None:
        raise SystemExit("A persistent database without URL options, an explicit S3 endpoint and a bucket are required")
    print(configured)
