"""章节时间线导出：活跃任务检测、可导出性校验与任务入队参数。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import GenerationTask, GenerationTaskStatus
from app.models.task_links import GenerationTaskLink
from app.schemas.studio.chapter_timeline import ChapterTimelineRead, TimelineClipStatus


EXPORT_TASK_KIND = "chapter_timeline_export"
EXPORT_RESOURCE_TYPE = "video"
EXPORT_RELATION_TYPE = "chapter_timeline_export"


async def find_active_chapter_timeline_export_task_id(
    db: AsyncSession,
    chapter_id: str,
) -> str | None:
    """若存在进行中的章节时间线导出任务则返回其 task_id，否则 None。"""
    stmt = (
        select(GenerationTask.id)
        .join(GenerationTaskLink, GenerationTaskLink.task_id == GenerationTask.id)
        .where(
            GenerationTask.task_kind == EXPORT_TASK_KIND,
            GenerationTaskLink.resource_type == EXPORT_RESOURCE_TYPE,
            GenerationTaskLink.relation_type == EXPORT_RELATION_TYPE,
            GenerationTaskLink.relation_entity_id == chapter_id,
            GenerationTask.status.in_(
                (
                    GenerationTaskStatus.pending,
                    GenerationTaskStatus.running,
                ),
            ),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


def ensure_timeline_exportable(read: ChapterTimelineRead) -> None:
    """导出前置校验：时间线非空且全部片段具备可用成片文件。"""
    if not read.segments:
        raise ValueError("时间线为空，无法导出")
    for seg in read.segments:
        if seg.clip_status != TimelineClipStatus.ready:
            raise ValueError(
                f"存在未就绪片段：shot_id={seg.shot_id} status={seg.clip_status.value}",
            )
