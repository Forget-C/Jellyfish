"""统一生成执行期的受控文件解析器。"""

from __future__ import annotations

from app.core import storage
from app.core.contracts.media import MediaReference
from app.models.studio import FileItem, FileType
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.generation.files.types import ResolvedMediaContent, ResolvedMediaSnapshot


class FileResolutionError(ValueError):
    """媒体引用无法安全解析为执行期文件时抛出的可预期错误。"""


class FileResolver:
    """从 ``MediaReference`` 读取受控文件并提供内存态媒体内容。

    该类是唯一允许把 ``FileItem.storage_key`` 交给对象存储的生成层边界。
    返回的快照只冻结文件版本与哈希；下载到的字节不应被写入任务 payload、
    数据库或日志。
    """

    def __init__(self, db: AsyncSession) -> None:
        """绑定当前执行事务使用的异步数据库会话。"""
        self._db = db

    async def snapshot(self, reference: MediaReference) -> ResolvedMediaSnapshot:
        """验证引用文件类型并冻结其内容版本与哈希。"""
        file_item = await self._load_and_validate(reference)
        return self._build_snapshot(file_item, reference)

    async def resolve(self, reference: MediaReference) -> ResolvedMediaContent:
        """下载已验证媒体，供同一 Worker 进程的 Provider Adapter 使用。"""
        file_item = await self._load_and_validate(reference)
        return await self._download(file_item, self._build_snapshot(file_item, reference))

    async def resolve_frozen(self, snapshot: ResolvedMediaSnapshot) -> ResolvedMediaContent:
        """解析任务已持久化的快照，并拒绝内容在排队期间发生漂移的文件。"""
        reference = MediaReference(
            file_id=snapshot.file_id,
            media_kind=snapshot.media_kind,
            ordinal=snapshot.ordinal,
        )
        file_item = await self._load_and_validate(reference)
        current_snapshot = self._build_snapshot(file_item, reference)
        if (
            current_snapshot.file_content_version != snapshot.file_content_version
            or current_snapshot.file_content_hash != snapshot.file_content_hash
        ):
            raise FileResolutionError(f"file content changed for file_id={snapshot.file_id}")
        return await self._download(file_item, snapshot)

    async def _download(
        self,
        file_item: FileItem,
        snapshot: ResolvedMediaSnapshot,
    ) -> ResolvedMediaContent:
        """下载已通过版本校验的文件，并保持字节仅存活于当前执行期。"""
        try:
            content = await storage.download_file(key=file_item.storage_key)
        except Exception as exc:  # noqa: BLE001
            raise FileResolutionError(f"failed to download file_id={snapshot.file_id}") from exc
        if not content:
            raise FileResolutionError(f"file content is empty for file_id={snapshot.file_id}")

        return ResolvedMediaContent(
            snapshot=snapshot,
            content=content,
            content_type=await self._resolve_content_type(file_item.storage_key),
        )

    async def resolve_many(self, references: list[MediaReference]) -> list[ResolvedMediaContent]:
        """按调用方给定顺序解析多个媒体，保留分组内稳定顺序。"""
        return [await self.resolve(reference) for reference in references]

    async def _load_and_validate(self, reference: MediaReference) -> FileItem:
        """加载文件并拒绝不存在、无存储键或类型不匹配的引用。"""
        file_item = await self._db.get(FileItem, reference.file_id)
        if file_item is None:
            raise FileResolutionError(f"file not found for file_id={reference.file_id}")
        if not file_item.storage_key:
            raise FileResolutionError(f"storage key is empty for file_id={reference.file_id}")
        if file_item.type != FileType(reference.media_kind):
            raise FileResolutionError(
                f"media kind mismatch for file_id={reference.file_id}: "
                f"expected={reference.media_kind}, actual={file_item.type.value}"
            )
        return file_item

    @staticmethod
    def _build_snapshot(file_item: FileItem, reference: MediaReference) -> ResolvedMediaSnapshot:
        """将已校验文件投影为可持久化的无正文媒体快照。"""
        return ResolvedMediaSnapshot(
            file_id=file_item.id,
            media_kind=reference.media_kind,
            ordinal=reference.ordinal,
            file_content_version=file_item.content_version,
            file_content_hash=file_item.content_hash,
        )

    @staticmethod
    async def _resolve_content_type(storage_key: str) -> str | None:
        """读取对象元数据中的 MIME 类型；不可用时不影响受控文件解析。"""
        try:
            info = await storage.get_file_info(key=storage_key)
        except Exception:  # noqa: BLE001
            return None
        return (info.content_type or "").strip().lower() or None
