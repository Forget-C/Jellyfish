"""章节视频时间线：读取合并默认镜头顺序与持久化片段，以及全量保存。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import (
    ChapterTimelineSegment,
    ChapterTimelineState,
    FileItem,
    FileType,
    Shot,
)
from app.services.studio.chapter_timeline_media import probe_video_duration_ms_from_storage
from app.services.studio.chapter_timeline_trim import (
    resolve_effective_trim_ms,
    validate_effective_trim_ms,
)
from app.schemas.studio.chapter_timeline import (
    ChapterTimelineRead,
    ChapterTimelineSegmentRead,
    ChapterTimelineWrite,
    TimelineClipStatus,
)


class TimelineLayoutConflictError(Exception):
    """客户端提交的 layout_version 与服务器不一致（乐观锁冲突）。"""

    def __init__(self, *, server_version: int, client_version: int) -> None:
        self.server_version = server_version
        self.client_version = client_version
        super().__init__(
            f"layout_version mismatch: server={server_version}, client={client_version}",
        )


def _clip_status_and_file_id(
    shot: Shot,
    files_by_id: dict[str, FileItem],
) -> tuple[TimelineClipStatus, str | None]:
    fid = shot.generated_video_file_id
    if not fid:
        return TimelineClipStatus.missing_video, None
    item = files_by_id.get(fid)
    if item is None or item.type != FileType.video:
        return TimelineClipStatus.file_missing, fid
    return TimelineClipStatus.ready, fid


def _merge_shot_order(
    segments_db: Sequence[ChapterTimelineSegment],
    shots_sorted: Sequence[Shot],
) -> list[tuple[ChapterTimelineSegment | None, Shot]]:
    """先按已保存 position 排列镜头，再将未出现在时间线中的镜头按 index 追加。"""
    by_shot: dict[str, Shot] = {s.id: s for s in shots_sorted}
    ordered: list[tuple[ChapterTimelineSegment | None, Shot]] = []
    seen: set[str] = set()
    for seg in sorted(segments_db, key=lambda x: x.position):
        sh = by_shot.get(seg.shot_id)
        if sh is None:
            continue
        ordered.append((seg, sh))
        seen.add(seg.shot_id)
    for sh in sorted(shots_sorted, key=lambda x: x.index):
        if sh.id not in seen:
            ordered.append((None, sh))
            seen.add(sh.id)
    return ordered


async def build_timeline_read(db: AsyncSession, chapter_id: str) -> ChapterTimelineRead:
    """构造章节时间线读取视图（假设 chapter 已存在）。"""
    state = await db.get(ChapterTimelineState, chapter_id)
    layout_version = int(state.layout_version) if state else 1

    shots_res = await db.execute(select(Shot).where(Shot.chapter_id == chapter_id).order_by(Shot.index))
    shots = list(shots_res.scalars().all())

    seg_res = await db.execute(
        select(ChapterTimelineSegment).where(ChapterTimelineSegment.chapter_id == chapter_id),
    )
    segments_db = list(seg_res.scalars().all())

    file_ids = [s.generated_video_file_id for s in shots if s.generated_video_file_id]
    files_by_id: dict[str, FileItem] = {}
    if file_ids:
        fres = await db.execute(select(FileItem).where(FileItem.id.in_(file_ids)))
        for fi in fres.scalars().all():
            files_by_id[fi.id] = fi

    merged = _merge_shot_order(segments_db, shots)
    reads: list[ChapterTimelineSegmentRead] = []
    for position, (seg_row, shot) in enumerate(merged):
        status, fid = _clip_status_and_file_id(shot, files_by_id)
        sid = seg_row.id if seg_row else ""
        trim_start = seg_row.trim_start_ms if seg_row else None
        trim_end = seg_row.trim_end_ms if seg_row else None
        reads.append(
            ChapterTimelineSegmentRead(
                id=sid,
                shot_id=shot.id,
                position=position,
                trim_start_ms=trim_start,
                trim_end_ms=trim_end,
                clip_status=status,
                file_id=fid,
                label=shot.title,
            ),
        )

    return ChapterTimelineRead(
        layout_version=layout_version,
        segments=reads,
    )


async def replace_timeline_segments(
    db: AsyncSession,
    chapter_id: str,
    body: ChapterTimelineWrite,
) -> ChapterTimelineRead:
    """事务内全量替换片段表并递增 layout_version。

    - 校验镜头归属本章节且无重复 shot_id；
    - 若提供 layout_version，须与当前服务端版本一致。
    """
    shots_res = await db.execute(select(Shot).where(Shot.chapter_id == chapter_id))
    shots = {s.id: s for s in shots_res.scalars().all()}

    seen_shots: set[str] = set()
    for row in body.segments:
        if row.shot_id not in shots:
            raise ValueError(f"shot_id 不属于该章节: {row.shot_id}")
        if row.shot_id in seen_shots:
            raise ValueError(f"重复的 shot_id: {row.shot_id}")
        seen_shots.add(row.shot_id)

    for row in body.segments:
        if row.trim_start_ms is None and row.trim_end_ms is None:
            continue
        shot = shots[row.shot_id]
        fid = shot.generated_video_file_id
        if not fid:
            raise ValueError(f"镜头尚无成片，无法设置裁剪: shot_id={row.shot_id}")
        file_obj = await db.get(FileItem, fid)
        if file_obj is None or file_obj.type != FileType.video or not file_obj.storage_key:
            raise ValueError(f"镜头成片文件无效，无法设置裁剪: shot_id={row.shot_id}")
        dur_ms = await probe_video_duration_ms_from_storage(file_obj.storage_key)
        if dur_ms <= 0:
            raise ValueError(f"无法解析镜头成片时长: shot_id={row.shot_id}")
        effective = resolve_effective_trim_ms(dur_ms, row.trim_start_ms, row.trim_end_ms)
        if effective is None:
            continue
        validate_effective_trim_ms(dur_ms, effective, shot_id=row.shot_id)

    state = await db.get(ChapterTimelineState, chapter_id)
    current_v = int(state.layout_version) if state else 1
    if body.layout_version is not None and body.layout_version != current_v:
        raise TimelineLayoutConflictError(server_version=current_v, client_version=body.layout_version)

    await db.execute(delete(ChapterTimelineSegment).where(ChapterTimelineSegment.chapter_id == chapter_id))

    for position, row in enumerate(body.segments):
        db.add(
            ChapterTimelineSegment(
                id=str(uuid.uuid4()),
                chapter_id=chapter_id,
                shot_id=row.shot_id,
                position=position,
                trim_start_ms=row.trim_start_ms,
                trim_end_ms=row.trim_end_ms,
            ),
        )

    new_version = current_v + 1
    if state is None:
        db.add(
            ChapterTimelineState(
                chapter_id=chapter_id,
                layout_version=new_version,
            ),
        )
    else:
        state.layout_version = new_version

    await db.flush()
    return await build_timeline_read(db, chapter_id)
