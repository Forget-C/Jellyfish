"""字幕产物：把 v1.1 的 ``localization.subtitle_tracks[]`` 落成 WebVTT 文件产物。

**一致性说明（不声称原子性）。**
对象存储（``app.core.storage``，S3/RustFS）**不参与数据库事务**。因此本模块采用
「确定性键 + 补偿清理」而不是分布式事务：

1. **确定性存储键**：``cas/subtitles/{project_id}/{episode_id}/{language_tag}.vtt``。
   同一剧集重复导入会写到同一个 key，内容也逐字节相同 → 覆盖而非新增，不会产生重复对象。
2. **先写对象、后写数据库行**：这样数据库里绝不会出现指向不存在对象的记录
   （宁可短暂存在「对象在、行未提交」的状态）。
3. **补偿清理**：若上传成功之后导入失败，``rollback_uploads()`` 会删除**本次新建**的对象
   （不删除本次之前就已存在的对象，避免破坏上一次成功导入的产物）。
4. **残留边界**：进程被强杀导致补偿未执行时，可能残留一个确定性 key 的孤儿对象；
   它会被下一次成功导入原地覆盖，且因为没有数据库行而不会被前端引用。

数据库侧的幂等由 ``file_usages`` 的唯一约束
``UNIQUE(file_id, usage_kind, source_ref)`` 与稳定的 ``source_ref`` 共同保证。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.crypto_animal_studio.domain.webvtt import WEBVTT_MIME_TYPE, render_webvtt_bytes
from app.models.studio import FileItem, FileType, FileUsage, FileUsageKind
from app.services.common import create_and_refresh


class SubtitleArtifactError(Exception):
    """字幕产物生成或关联失败。"""


@dataclass(slots=True)
class SubtitleArtifactRecord:
    """一条已生成/复用的字幕产物。"""

    file_id: str
    language_tag: str
    storage_key: str
    cue_count: int
    byte_size: int
    created: bool


@dataclass(slots=True)
class SubtitleArtifactOutcome:
    """本次导入的字幕产物结果与补偿信息。"""

    records: list[SubtitleArtifactRecord] = field(default_factory=list)
    #: 本次**新建**的对象键（补偿清理只删这些）。
    uploaded_keys: list[str] = field(default_factory=list)

    async def rollback_uploads(self) -> list[str]:
        """删除本次新建的对象；返回删除失败的键（best-effort，不抛出）。"""
        failed: list[str] = []
        for key in self.uploaded_keys:
            try:
                await storage.delete_file(key=key)
            except Exception:  # noqa: BLE001  # 补偿清理不得掩盖原始异常
                failed.append(key)
        return failed


def subtitle_storage_key(project_id: str, episode_id: str, language_tag: str) -> str:
    """确定性对象键。相同 (project, episode, language) 永远得到同一个 key。"""
    return f"cas/subtitles/{project_id}/{episode_id}/{language_tag}.vtt"


def subtitle_source_ref(episode_id: str, language_tag: str) -> str:
    """``file_usages.source_ref`` 幂等键（配合唯一约束实现同槽位 upsert）。"""
    return f"cas:{episode_id}:{language_tag}"


def _artifact_name(episode_id: str, language_tag: str) -> str:
    """产物展示名。"""
    return f"{episode_id}.{language_tag}.vtt"


async def _object_exists(key: str) -> bool:
    """对象是否已存在（用于判断本次是否为新建，从而决定补偿是否删除它）。"""
    try:
        await storage.get_file_info(key=key)
        return True
    except Exception:  # noqa: BLE001  # 不存在或后端不支持 head → 视为不存在
        return False


async def ensure_subtitle_artifacts(
    db: AsyncSession,
    *,
    package: Any,
    project_id: str,
    chapter_id: str,
) -> SubtitleArtifactOutcome:
    """为包内每条字幕轨生成/复用一个 WebVTT 产物，并关联到 Project + Chapter。

    v1 文档没有 ``localization``，直接返回空结果，因此既有 v1 行为完全不变。

    参数：
        db: 当前导入事务的会话（只 flush，不 commit）。
        package: 已通过 QA 闸门的 EpisodePackage（v1 或 v1.1）。
        project_id: 目标项目。
        chapter_id: 本次导入产生的章节。
    返回：
        SubtitleArtifactOutcome（含产物列表与补偿用的新建对象键）。
    异常：
        SubtitleArtifactError：渲染或上传失败（调用方须回滚事务并执行补偿清理）。
    """
    outcome = SubtitleArtifactOutcome()
    localization = getattr(package, "localization", None)
    if localization is None:
        return outcome

    episode_id = package.episode_id
    for track in localization.subtitle_tracks:
        key = subtitle_storage_key(project_id, episode_id, track.language_tag)
        source_ref = subtitle_source_ref(episode_id, track.language_tag)

        try:
            payload = render_webvtt_bytes(track)
        except ValueError as exc:
            raise SubtitleArtifactError(
                f"subtitle track '{track.language_tag}': {exc}"
            ) from exc

        existed_before = await _object_exists(key)
        try:
            await storage.upload_file(key=key, data=payload, content_type=WEBVTT_MIME_TYPE)
        except Exception as exc:  # noqa: BLE001  # 统一转为领域异常，交由调用方回滚
            raise SubtitleArtifactError(
                f"failed to upload subtitle artifact '{key}': {exc}"
            ) from exc
        if not existed_before:
            outcome.uploaded_keys.append(key)

        # 数据库侧：按 (usage_kind, source_ref) 复用既有 FileItem，避免重复行。
        existing_usage = (
            await db.execute(
                select(FileUsage).where(
                    FileUsage.usage_kind == FileUsageKind.subtitle,
                    FileUsage.source_ref == source_ref,
                    FileUsage.project_id == project_id,
                )
            )
        ).scalars().first()

        if existing_usage is not None:
            file_item = await db.get(FileItem, existing_usage.file_id)
            if file_item is not None:
                # 确定性更新：key 与展示名保持一致，章节指向最新一次导入。
                file_item.storage_key = key
                file_item.name = _artifact_name(episode_id, track.language_tag)
                existing_usage.chapter_id = chapter_id
                await db.flush()
                outcome.records.append(
                    SubtitleArtifactRecord(
                        file_id=file_item.id,
                        language_tag=track.language_tag,
                        storage_key=key,
                        cue_count=len(track.cues),
                        byte_size=len(payload),
                        created=False,
                    )
                )
                continue

        file_item = FileItem(
            id=str(uuid.uuid4()),
            type=FileType.subtitle,
            name=_artifact_name(episode_id, track.language_tag),
            thumbnail="",
            tags=["cas", "subtitle", track.language_tag, episode_id],
            storage_key=key,
        )
        await create_and_refresh(db, file_item)
        await create_and_refresh(
            db,
            FileUsage(
                file_id=file_item.id,
                project_id=project_id,
                chapter_id=chapter_id,
                shot_id=None,  # 轨是剧集级的；单条 cue 的镜头引用保留在 WebVTT NOTE 中
                usage_kind=FileUsageKind.subtitle,
                source_ref=source_ref,
            ),
        )
        outcome.records.append(
            SubtitleArtifactRecord(
                file_id=file_item.id,
                language_tag=track.language_tag,
                storage_key=key,
                cue_count=len(track.cues),
                byte_size=len(payload),
                created=True,
            )
        )

    return outcome


async def lookup_subtitle_artifacts(
    db: AsyncSession, *, package: Any, project_id: str
) -> list[SubtitleArtifactRecord]:
    """查询该剧集已存在的字幕产物（用于幂等重放时如实报告，不做任何写入）。"""
    records: list[SubtitleArtifactRecord] = []
    localization = getattr(package, "localization", None)
    if localization is None:
        return records

    for track in localization.subtitle_tracks:
        source_ref = subtitle_source_ref(package.episode_id, track.language_tag)
        usage = (
            await db.execute(
                select(FileUsage).where(
                    FileUsage.usage_kind == FileUsageKind.subtitle,
                    FileUsage.source_ref == source_ref,
                    FileUsage.project_id == project_id,
                )
            )
        ).scalars().first()
        if usage is None:
            continue
        file_item = await db.get(FileItem, usage.file_id)
        if file_item is None:
            continue
        records.append(
            SubtitleArtifactRecord(
                file_id=file_item.id,
                language_tag=track.language_tag,
                storage_key=file_item.storage_key,
                cue_count=len(track.cues),
                byte_size=len(render_webvtt_bytes(track)),
                created=False,
            )
        )
    return records


__all__ = [
    "SubtitleArtifactError",
    "lookup_subtitle_artifacts",
    "SubtitleArtifactOutcome",
    "SubtitleArtifactRecord",
    "ensure_subtitle_artifacts",
    "subtitle_source_ref",
    "subtitle_storage_key",
]
