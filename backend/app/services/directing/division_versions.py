"""章节锁内记录不可变划分快照，供整章和基本信息写入共同使用。"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.workspace import ChapterSequences, DivisionVersionRef
from app.models.directing import ChapterShootingExplanation, DivisionHead, DivisionVersion
from app.services.directing.shooting_explanations import inherited_preparation


async def current_version(db: AsyncSession, chapter_id: str, *, locked: bool = False) -> DivisionVersionRef | None:
    """只读当前指向；写事务使用当前读，避免重复读快照掩盖竞争提交。"""
    query = select(DivisionVersion.id, DivisionVersion.number).join(DivisionHead,
        (DivisionHead.chapter_id == DivisionVersion.chapter_id) & (DivisionHead.revision_id == DivisionVersion.id)
    ).where(DivisionHead.chapter_id == chapter_id)
    if locked:
        query = query.with_for_update()
    row = (await db.execute(query)).first()
    return DivisionVersionRef(id=row.id, number=row.number) if row else None


async def record_version(db: AsyncSession, snapshot: ChapterSequences, *, origin: str,
                         source_task_id: str | None = None, source_revision_id: str | None = None,
                         request_id: str | None = None, mapping: dict | None = None,
                         make_current: bool = True, created_at: datetime | None = None) -> ChapterSequences:
    """调用者须持章节锁并位于保存点内；快照、指向和业务写入一起回滚。"""
    head = await db.get(DivisionHead, snapshot.chapter_id, populate_existing=True, with_for_update=True)
    if make_current and origin not in ('restore', 'baseline') and await db.get(
            ChapterShootingExplanation, (snapshot.chapter_id, snapshot.source_version), with_for_update=True) is None:
        value = await inherited_preparation(db, snapshot.chapter_id, snapshot.source_version, snapshot.raw_text, locked=True)
        if value.notes:
            db.add(ChapterShootingExplanation(chapter_id=snapshot.chapter_id,
                source_version=snapshot.source_version, raw_text=snapshot.raw_text,
                version=1, preparation=value.model_dump(mode='json')))
    # 版本行不会删除；章节锁序列化编号分配，不能用前端列表长度推算版本号。
    number = (await db.scalar(select(func.max(DivisionVersion.number)).where(
        DivisionVersion.chapter_id == snapshot.chapter_id).with_for_update()) or 0) + 1
    identity = uuid4().hex
    saved = snapshot.model_copy(update={'task_ids': [], 'current_version': DivisionVersionRef(id=identity, number=number)})
    db.add(DivisionVersion(id=identity, chapter_id=snapshot.chapter_id, number=number, origin=origin,
        source_version=snapshot.source_version, sequence_count=len(snapshot.sequences),
        source_task_id=source_task_id, source_revision_id=source_revision_id,
        base_revision_id=head.revision_id if head and make_current else None, request_id=request_id,
        snapshot=saved.model_dump(mode='json'), mapping=mapping or {},
        **({'created_at': created_at} if created_at else {})))
    await db.flush()
    if make_current:
        if head:
            head.revision_id = identity
        else:
            db.add(DivisionHead(chapter_id=snapshot.chapter_id, revision_id=identity))
    await db.flush()
    return snapshot.model_copy(update={'current_version': saved.current_version})
