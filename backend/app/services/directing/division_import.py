"""显式接入完整旧回执与实际当前划分；普通读取绝不调用导入。"""

from hashlib import sha256

from pydantic import ValidationError
from sqlalchemy import select

from app.core.contracts.directing.division import DivisionSaved
from app.core.contracts.directing.workspace import ChapterSequences
from app.models.directing import DivisionCommit, DivisionHead, DivisionVersion, Sequence
from app.services.directing.division import DivisionService
from app.services.directing.division_versions import current_version, record_version


def snapshot_content(snapshot: ChapterSequences) -> dict:
    """仅比较保存内容；任务列表、展示版本与章节标题不代表划分变化。"""
    return snapshot.model_dump(mode='json', exclude={'task_ids', 'current_version', 'title'})


async def receipt_snapshot(db, project_id: str, chapter_id: str, receipt: DivisionCommit, *, locked: bool = False) -> ChapterSequences:
    """只读取可验证的旧快照；不从当前对象或任务猜测缺失的历史正文。"""
    try:
        saved = DivisionSaved.model_validate(receipt.response)
    except ValidationError as error:
        raise ValueError('历史回执资料不完整或格式不正确') from error
    snapshot = saved.chapter
    if saved.request_id != receipt.request_id or snapshot.chapter_id != chapter_id:
        raise ValueError('历史回执身份与所属章节不一致')
    if sha256(snapshot.raw_text.encode()).hexdigest() != snapshot.source_version:
        raise ValueError('历史原文与版本标识不一致')
    ids = [row.id for row in snapshot.sequences]
    positions = [row.position for row in snapshot.sequences]
    if len(ids) != len(set(ids)) or positions != list(range(len(ids))):
        raise ValueError('历史场次身份或顺序不完整')
    created = list(saved.created_sequence_ids.values())
    if len(created) != len(set(created)) or not set(created) <= set(ids):
        raise ValueError('历史新建身份映射与保存快照不一致')
    query = select(Sequence).where(Sequence.id.in_(ids)).execution_options(populate_existing=True)
    existing = {row.id: row for row in await db.scalars(query.with_for_update() if locked else query)}
    for row in snapshot.sequences:
        actual = existing.get(row.id)
        if row.project_id != project_id or row.chapter_id != chapter_id or not row.is_current:
            raise ValueError('历史快照场次归属或成员状态不一致')
        if actual is None or actual.chapter_id != chapter_id or actual.version < row.version:
            raise ValueError('历史场次身份缺失或对象版本不一致')
        if row.source.kind != 'chapter' or row.source.reference != chapter_id:
            raise ValueError('历史场次来源不属于当前章节')
        if row.span and row.source.version == snapshot.source_version:
            if row.span.end > len(snapshot.raw_text) or snapshot.raw_text[row.span.start:row.span.end] != row.source_text:
                raise ValueError('历史场次范围与原文不一致')
    return snapshot


class DivisionImportService(DivisionService):
    """以章节为单位导入，调用者提交或回滚；可重复执行，不修改原回执。"""

    async def import_history(self, chapter_id: str) -> dict:
        """历史版本不自动成为当前；当前基线取锁定的实际成员集合。"""
        chapter = await self._lock_chapter(chapter_id)
        result = {'imported': 0, 'skipped': 0, 'baseline_created': False, 'issues': []}
        receipts = list(await self.db.scalars(select(DivisionCommit).where(DivisionCommit.chapter_id == chapter_id)
            .order_by(DivisionCommit.created_at, DivisionCommit.request_id).with_for_update().execution_options(populate_existing=True)))
        async with self.db.begin_nested():
            for receipt in receipts:
                existing = await self.db.scalar(select(DivisionVersion).where(
                    DivisionVersion.chapter_id == chapter_id, DivisionVersion.request_id == receipt.request_id).with_for_update())
                if existing is not None:
                    result['skipped'] += 1
                    continue
                try:
                    snapshot = await receipt_snapshot(self.db, self.project_id, chapter_id, receipt, locked=True)
                except ValueError as error:
                    result['issues'].append({'request_id': receipt.request_id, 'reason': str(error)})
                    continue
                await record_version(self.db, snapshot, origin='imported', request_id=receipt.request_id,
                    make_current=False, created_at=receipt.created_at,
                    mapping={'imported_from': 'receipt', 'source_task_unknown': True, 'lineage_unknown': True,
                             'created_sequence_ids': receipt.response['created_sequence_ids']})
                result['imported'] += 1
            rows = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id,
                Sequence.is_current.is_(True)).order_by(Sequence.position).with_for_update().execution_options(populate_existing=True)))
            actual = self.division_snapshot(chapter, rows)
            current = await current_version(self.db, chapter_id, locked=True)
            if current:
                head = await self.db.get(DivisionVersion, current.id, populate_existing=True, with_for_update=True)
                if snapshot_content(ChapterSequences.model_validate(head.snapshot)) != snapshot_content(actual):
                    # 原文变化不会产生一次划分保存，只比较成员避免误补版本。
                    recorded = ChapterSequences.model_validate(head.snapshot)
                    if [row.model_dump(exclude={'source_changed'}) for row in recorded.sequences] != [row.model_dump(exclude={'source_changed'}) for row in actual.sequences]:
                        raise ValueError('当前版本与实际场次不一致，请先排查未记录的写入')
                return result
            if not rows and not receipts:
                return result
            versions = list(await self.db.scalars(select(DivisionVersion).where(DivisionVersion.chapter_id == chapter_id)
                .order_by(DivisionVersion.number.desc()).with_for_update()))
            matching = next((row for row in versions if snapshot_content(ChapterSequences.model_validate(row.snapshot)) == snapshot_content(actual)), None)
            if matching:
                self.db.add(DivisionHead(chapter_id=chapter_id, revision_id=matching.id))
                await self.db.flush()
            else:
                await record_version(self.db, actual, origin='baseline', mapping={'imported_from': 'current_members'})
                result['baseline_created'] = True
        return result
