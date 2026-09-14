"""镜头运行时任务态聚合。"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Shot, ShotFrameImage
from app.models.task import Task
from app.core.contracts.task import TaskStatus
from app.schemas.studio.shots import ShotRuntimeSummaryRead


_ACTIVE_TASK_STATUSES = (TaskStatus.queued, TaskStatus.running)

async def list_shot_runtime_summary_by_chapter(
    db: AsyncSession,
    *,
    chapter_id: str,
) -> list[ShotRuntimeSummaryRead]:
    """按任务的明确目标聚合活动任务，不把数字槽位 ID 误认成镜头 ID。"""
    shot_stmt = select(Shot.id).where(Shot.chapter_id == chapter_id).order_by(Shot.index.asc())
    shot_ids = [str(x) for x in (await db.execute(shot_stmt)).scalars().all()]
    if not shot_ids:
        return []

    frame_stmt = select(ShotFrameImage.id, ShotFrameImage.shot_detail_id).where(
        ShotFrameImage.shot_detail_id.in_(shot_ids)
    )
    frame_rows = (await db.execute(frame_stmt)).all()
    frame_id_to_shot_id = {str(frame_id): str(shot_id) for frame_id, shot_id in frame_rows}
    frame_ids = list(frame_id_to_shot_id.keys())
    task_stmt = select(Task.id, Task.kind, Task.target_type, Task.target_id).where(
        Task.status.in_(_ACTIVE_TASK_STATUSES),
        or_(
            (Task.target_type.in_(["shot_video", "shot_detail"]) & Task.target_id.in_(shot_ids)),
            ((Task.target_type == "shot_frame_slot") & Task.target_id.in_(frame_ids)),
        ),
    )
    rows = (await db.execute(task_stmt)).all()

    task_ids_by_shot: dict[str, set[str]] = defaultdict(set)
    video_by_shot: dict[str, bool] = defaultdict(bool)
    frame_by_shot: dict[str, bool] = defaultdict(bool)

    for task_id, task_kind, target_type, target_id in rows:
        shot_id = frame_id_to_shot_id.get(target_id) if target_type == "shot_frame_slot" else target_id
        if not shot_id:
            continue
        task_ids_by_shot[shot_id].add(str(task_id))
        if task_kind == "video_generation":
            video_by_shot[shot_id] = True
        elif task_kind == "image_generation":
            frame_by_shot[shot_id] = True

    return [
        ShotRuntimeSummaryRead(
            shot_id=shot_id,
            has_active_tasks=bool(task_ids_by_shot.get(shot_id)),
            has_active_video_tasks=bool(video_by_shot.get(shot_id)),
            has_active_frame_tasks=bool(frame_by_shot.get(shot_id)),
            active_task_count=len(task_ids_by_shot.get(shot_id, set())),
        )
        for shot_id in shot_ids
    ]
