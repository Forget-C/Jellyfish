"""章节锁内预览并原子提交最终划分；不搬迁任何设计或素材。"""

from hashlib import sha256
import json
from uuid import NAMESPACE_URL, uuid5
from types import SimpleNamespace

from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import aliased

from app.services.chapters.explanations import explanation_basis
from app.core.contracts.directing.shooting_preparation import ShootingPreparation
from app.core.contracts.directing.common import Source
from app.core.contracts.directing.workspace import ChapterSequences
from app.core.contracts.directing.division import DivisionDraft, DivisionImpact, DivisionPreview, DivisionSave, DivisionSaved
from app.models.directing import ActiveCut, CutTakeReference, DirectingRevision, DivisionCommit, DivisionVersion, RevisionDependency, Sequence, Take
from app.models.studio import Chapter
from app.models.task import Task
from app.services.directing.store import RevisionConflict
from app.services.directing.workspace import WorkspaceService
from app.services.directing.division_versions import current_version, record_version


def digest(value) -> str:
    """使用稳定 JSON 摘要比较请求和预览内容，不依赖字典插入顺序。"""
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class DivisionService(WorkspaceService):
    """完整成员基线校验、差异预览与幂等回执共享同一章节事务锁。"""

    async def _lock_chapter(self, chapter_id):
        await self.chapter(chapter_id)
        return await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id)
            .with_for_update().execution_options(populate_existing=True))

    async def _source_chapter(self, chapter, draft):
        """旧原文仅从本章不可变版本取回，不能接受客户端任意正文。"""
        if draft.source_basis_id is None:
            return chapter
        version = await self.db.scalar(select(DivisionVersion).where(
            DivisionVersion.id == draft.source_basis_id, DivisionVersion.chapter_id == chapter.id))
        if version is None or version.source_version != draft.source_version:
            raise ValueError('所选原文版本不属于当前章节')
        snapshot = ChapterSequences.model_validate(version.snapshot)
        return SimpleNamespace(id=chapter.id, title=chapter.title, raw_text=snapshot.raw_text)

    async def _current_rows(self, query):
        """交付先持有任务锁时不反向等待；让用户重试预览，避免形成任务/场次锁环。"""
        try:
            return list(await self.db.scalars(query.with_for_update(nowait=True).execution_options(populate_existing=True)))
        except OperationalError as error:
            if error.orig.args and error.orig.args[0] in (3572, 1205, 1213):
                raise RevisionConflict('相关任务或成果正在更新，请稍后重新预览') from error
            raise

    async def _validate_preparation(self, chapter_id, preparation):
        """报告引用必须属于本项目本章，不能通过版本快照带入他人任务。"""
        if preparation.check_task_id:
            task = await self.db.scalar(select(Task).where(Task.id == preparation.check_task_id,
                Task.project_id == self.project_id, Task.target_type == 'directing_chapter',
                Task.target_id == chapter_id, Task.kind == 'directing_shooting_check'))
            if task is None:
                raise ValueError('拍摄检查报告不属于当前章节')

    async def _stored_preparation(self, chapter_id, text, preparation, start, source_version):
        """在保存版本时固定报告覆盖状态，不在历史阅读时重算。"""
        value = preparation.model_copy(deep=True)
        value.check_covered = None
        if value.check_task_id:
            task = await self.db.get(Task, value.check_task_id)
            args = task.input_snapshot['run_args']
            chapter = await self.chapter(chapter_id)
            explanations = self._check_explanations(
                chapter, SimpleNamespace(source_text=text, source_start=start, source_version=source_version))
            value.check_covered = (task.status == 'succeeded' and args['script_text'] == text
                and task.input_snapshot['request'].get('source_start') == start
                and args['shooting_preparation'].get('notes', []) == [note.model_dump(mode='json') for note in value.notes]
                and args.get('source_explanations', []) == explanations.get('source_explanations', []))
        return value

    @staticmethod
    def _check_explanations(chapter, body):
        """只冻结同版且位置准确的解释，避免新解释套用到旧摘录。"""
        from hashlib import sha256
        from app.services.chapters.explanations import explanation_basis
        if (body.source_version != sha256(chapter.raw_text.encode()).hexdigest()
                or body.source_start is None
                or chapter.raw_text[body.source_start:body.source_start + len(body.source_text)] != body.source_text):
            return {}
        return {'source_explanations': explanation_basis(chapter)['items'], 'source_start': body.source_start}

    async def _state(self, chapter, draft):
        rows = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter.id, Sequence.is_current.is_(True))
            .order_by(Sequence.id).with_for_update().execution_options(populate_existing=True)))
        if {row.id: row.version for row in rows} != {row.sequence_id: row.version for row in draft.baseline}:
            raise RevisionConflict('本章场次集合已变化，请保留草稿并重新核对')
        if sha256(chapter.raw_text.encode()).hexdigest() != draft.source_version:
            raise RevisionConflict('章节原文已变化，请重新定位全部范围')
        restored = await self._restore_rows(chapter, draft)
        if draft.source_task_id is not None:
            tasks = await self._current_rows(select(Task).where(Task.id == draft.source_task_id))
            task = tasks[0] if tasks else None
            if task is None or (task.project_id, task.target_type, task.target_id, task.kind, task.status) != (
                    self.project_id, 'directing_chapter', chapter.id, 'directing_divide', 'succeeded'):
                raise ValueError('分析结果不属于本章节或尚未成功')
            snapshot = task.input_snapshot if isinstance(task.input_snapshot, dict) else {}
            args = snapshot.get('run_args', {})
            if not isinstance(args, dict):
                raise ValueError('历史分析资料不完整，不能载入保存')
            if (args.get('source_version') != draft.source_version or args.get('division_baseline') != {row.id: row.version for row in rows}
                    or args.get('source_explanations', []) != explanation_basis(chapter)['items']):
                if not draft.history_reconfirmed:
                    raise RevisionConflict('分析期间原文或场次集合已变化，请重新分析或手动核对')
                # 旧结果只通过显式核对进入当前草稿，仍保留原始任务来源。
                from app.services.directing.division_history import DivisionHistoryService  # pylint: disable=import-outside-toplevel
                detail = await DivisionHistoryService(self.db, self.project_id).analysis_detail(chapter.id, task.id)
                if detail.issues:
                    raise ValueError('历史分析资料不完整，不能载入保存')
                if detail.source_changed and not all(member.reconfirm_source for member in draft.members):
                    raise ValueError('请基于当前原文重新定位并确认全部场次')
        previous_end = 0
        for member in sorted(draft.members, key=lambda member: member.span.start):
            await self._validate_preparation(chapter.id, member.shooting_preparation)
            if member.span.start < previous_end:
                raise ValueError('最终划分范围重叠，请调整共享边界')
            if member.span.end > len(chapter.raw_text) or not chapter.raw_text[member.span.start:member.span.end].strip():
                raise ValueError('最终划分包含越界或无正文的范围')
            previous_end = member.span.end
        return rows + restored

    async def _restore_rows(self, chapter, draft):
        """只有来源快照明确包含的退出身份可恢复，使用对象最新并发版本。"""
        if draft.source_revision_id is None:
            return []
        version = await self.db.scalar(select(DivisionVersion).where(
            DivisionVersion.id == draft.source_revision_id, DivisionVersion.chapter_id == chapter.id))
        if version is None:
            raise ValueError('来源划分版本不属于当前章节')
        snapshot = ChapterSequences.model_validate(version.snapshot)
        if snapshot.chapter_id != chapter.id or any(row.project_id != self.project_id for row in snapshot.sequences):
            raise ValueError('来源划分版本归属不一致')
        if version.source_version != draft.source_version:
            if not draft.history_reconfirmed or not all(member.reconfirm_source for member in draft.members):
                raise ValueError('历史原文已变化，请重新定位并确认全部场次')
        identities = {row.sequence_id: row.version for row in draft.restored_baseline}
        if not identities.keys() <= {row.id for row in snapshot.sequences}:
            raise ValueError('恢复身份不在来源划分版本中')
        rows = await self._current_rows(select(Sequence).where(Sequence.chapter_id == chapter.id,
            Sequence.id.in_(identities)).order_by(Sequence.id))
        if {row.id: row.version for row in rows if not row.is_current} != identities:
            raise RevisionConflict('待恢复的历史场次已变化，请重新核对')
        return rows

    async def _preview(self, chapter, draft, rows):
        by_id = {row.id: row for row in rows}
        impacts = []
        fingerprints = []
        for position, member in enumerate(draft.members):
            row = by_id.get(member.sequence_id)
            changes = []
            if row is None:
                changes.append('added')
            else:
                if not row.is_current:
                    changes.append('restored')
                if ShootingPreparation.model_validate(row.shooting_preparation or {}).model_dump(mode='json') != member.shooting_preparation.model_dump(mode='json'):
                    changes.append('shooting_preparation')
                if row.title != member.title.strip():
                    changes.append('title')
                if row.position != position:
                    changes.append('position')
                if (row.source_start, row.source_end) != (member.span.start, member.span.end):
                    changes.append('range')
                if member.reconfirm_source:
                    changes.append('source')
                if row.source['version'] != draft.source_version and not member.reconfirm_source:
                    raise ValueError(f'场次「{row.title}」来源已过期，请明确重新定位并确认来源')
            impact, fingerprint = await self._impact(chapter, member.key, row, member, changes)
            impacts.append(impact)
            fingerprints.append(fingerprint)
        for identity in draft.exited_sequence_ids:
            impact, fingerprint = await self._impact(chapter, identity, by_id[identity], None, ['exited'])
            impacts.append(impact)
            fingerprints.append(fingerprint)
        # 非终态任务不能悬空；预览和保存均以当前读重新核对实际状态。
        changing_ids = draft.exited_sequence_ids + [row.sequence_id for row in draft.restored_baseline]
        task_revision_ids = select(DirectingRevision.id).where(DirectingRevision.sequence_id.in_(changing_ids))
        tasks = await self._current_rows(select(Task).where(Task.project_id == self.project_id,
            ((Task.target_type == 'directing_sequence') & Task.target_id.in_(changing_ids)) |
            (Task.target_type.in_(['directing_unit', 'directing_image']) & Task.target_id.in_(task_revision_ids)))
            .order_by(Task.id))
        blockers = [f'任务 {task.id}（{task.status}）尚未结束，场次暂不能退出或恢复' for task in tasks
                    if task.status not in ('succeeded', 'failed', 'cancelled')]
        dependencies = []
        if draft.exited_sequence_ids:
            revision_ids = select(DirectingRevision.id).where(DirectingRevision.sequence_id.in_(draft.exited_sequence_ids))
            # 正常契约要求场内引用；仍检查持久化索引，防止历史或导入引用被静默悬空。
            owner = aliased(Sequence)
            dependents = select(DirectingRevision).join(owner, owner.id == DirectingRevision.sequence_id).where(
                owner.is_current.is_(True), owner.id.not_in(draft.exited_sequence_ids),
                DirectingRevision.id.in_(select(RevisionDependency.revision_id).where(RevisionDependency.dependency_id.in_(revision_ids))) |
                DirectingRevision.id.in_(select(CutTakeReference.revision_id).join(Take, Take.id == CutTakeReference.take_id)
                    .where(Take.sequence_id.in_(draft.exited_sequence_ids))))
            dependencies = await self._current_rows(dependents.order_by(DirectingRevision.id))
            blockers.extend(f'当前场次 {row.sequence_id} 的版本 {row.id} 仍引用退出场次，请先处理依赖' for row in dependencies)
        restored_blockers, restored_references = await self._restoration_dependencies(draft)
        blockers.extend(restored_blockers)
        identity_confirmation = bool(draft.exited_sequence_ids or draft.restored_baseline) or any(len(row.target_keys) != 1 for row in draft.lineage)
        value = dict(impacts=impacts, blockers=blockers,
                     unassigned_character_count=len(chapter.raw_text) - sum(member.span.end - member.span.start for member in draft.members),
                     identity_confirmation_required=identity_confirmation)
        current = await current_version(self.db, chapter.id, locked=True)
        token = digest({'current_version': current.model_dump(mode='json') if current else None,
                        'draft': draft.model_dump(mode='json'), 'impacts': [impact.model_dump(mode='json') for impact in impacts],
                        'tasks': [(task.id, task.status) for task in tasks], 'blockers': blockers, 'fingerprints': fingerprints,
                        'restored_references': restored_references, 'dependencies': [(row.id, row.version) for row in dependencies]})
        return DivisionPreview(preview_token=token, **value)

    async def _restoration_dependencies(self, draft):
        """恢复不能重新启用悬空引用；锁定引用场次以和跨章退出互斥。"""
        restored = {row.sequence_id for row in draft.restored_baseline}
        if not restored:
            return [], []
        owners = select(DirectingRevision.id).where(DirectingRevision.sequence_id.in_(restored))
        revision_targets = select(DirectingRevision.sequence_id).join(RevisionDependency,
            RevisionDependency.dependency_id == DirectingRevision.id).where(RevisionDependency.revision_id.in_(owners))
        take_targets = select(Take.sequence_id).join(CutTakeReference, CutTakeReference.take_id == Take.id).where(
            CutTakeReference.revision_id.in_(owners))
        targets = await self._current_rows(select(Sequence).where(
            Sequence.id.in_(revision_targets.union(take_targets))).order_by(Sequence.id))
        projects = dict((await self.db.execute(select(Chapter.id, Chapter.project_id).where(
            Chapter.id.in_({row.chapter_id for row in targets})))).all())
        blockers = []
        for row in targets:
            if projects.get(row.chapter_id) != self.project_id:
                blockers.append(f'恢复场次引用的场次 {row.id} 不属于当前项目')
            elif row.id in draft.exited_sequence_ids or (not row.is_current and row.id not in restored):
                blockers.append(f'恢复场次引用的场次 {row.id} 不在最终当前集合，请核对关联场次')
        return blockers, [(row.id, row.version, row.is_current) for row in targets]

    async def _impact(self, chapter, key, row, member, changes):
        counts = {}
        revisions = []
        takes = []
        active = None
        if row is not None:
            revisions = list((await self.db.execute(select(DirectingRevision.id, DirectingRevision.kind,
                DirectingRevision.version, DirectingRevision.confirmed_at).where(DirectingRevision.sequence_id == row.id)
                .order_by(DirectingRevision.id).with_for_update())).all())
            for revision in revisions:
                counts[revision.kind] = counts.get(revision.kind, 0) + 1
            takes = list((await self.db.execute(select(Take.id, Take.version).where(Take.sequence_id == row.id)
                .order_by(Take.id).with_for_update())).all())
            active = await self.db.scalar(select(ActiveCut.revision_id).where(ActiveCut.sequence_id == row.id).with_for_update())
        impact = DivisionImpact(key=key, before=self.sequence_read(row, chapter) if row is not None else None,
            after=member, changes=changes, design_count=counts.get('design', 0), plan_count=counts.get('plan', 0),
            cut_count=counts.get('cut', 0), take_count=len(takes), active_cut_revision_id=active)
        fingerprint = {'revisions': [(item.id, item.version, item.confirmed_at.isoformat() if item.confirmed_at else None) for item in revisions],
                       'takes': [tuple(item) for item in takes], 'active_cut': active}
        return impact, fingerprint

    async def preview_division(self, chapter_id: str, draft: DivisionDraft) -> DivisionPreview:
        """读取实时影响；不创建场次、回执或预览记录。"""
        chapter = await self._source_chapter(await self._lock_chapter(chapter_id), draft)
        rows = await self._state(chapter, draft)
        return await self._preview(chapter, draft, rows)

    async def division_receipt(self, chapter_id: str, request_id: str) -> DivisionSaved | None:
        """响应丢失先查回执；章节锁使查询等待同章在途提交完成。"""
        await self._lock_chapter(chapter_id)
        receipt = await self.db.get(DivisionCommit, (chapter_id, request_id), populate_existing=True, with_for_update=True)
        return DivisionSaved.model_validate(receipt.response) if receipt else None

    async def save_division(self, chapter_id: str, body: DivisionSave) -> DivisionSaved:
        """最终方案一次写入；同请求回放回执，任何中间失败回滚整个保存点。"""
        chapter = await self._lock_chapter(chapter_id)
        request_hash = digest(body.model_dump(mode='json'))
        receipt = await self.db.get(DivisionCommit, (chapter_id, body.request_id), populate_existing=True, with_for_update=True)
        if receipt:
            hashes = {request_hash}
            if body.draft.source_revision_id is None and not body.draft.restored_baseline and not body.draft.history_reconfirmed:
                # 旧客户端的原请求不含新增恢复字段；默认值不能让已提交请求失去可重放性。
                legacy = body.model_dump(mode='json')
                for field in ('source_revision_id', 'restored_baseline', 'history_reconfirmed'):
                    legacy['draft'].pop(field)
                hashes.add(digest(legacy))
                if body.draft.source_basis_id is None:
                    legacy['draft'].pop('source_basis_id')
                    hashes.add(digest(legacy))
                    if all(not member.shooting_preparation.notes and member.shooting_preparation.check_task_id is None for member in body.draft.members):
                        for member in legacy['draft']['members']:
                            member.pop('shooting_preparation', None)
                        hashes.add(digest(legacy))
            if receipt.request_hash not in hashes:
                raise RevisionConflict('提交身份已用于另一份划分，不能复用')
            return DivisionSaved.model_validate(receipt.response)
        chapter = await self._source_chapter(chapter, body.draft)
        rows = await self._state(chapter, body.draft)
        preview = await self._preview(chapter, body.draft, rows)
        if preview.preview_token != body.preview_token:
            raise RevisionConflict('划分或受影响成果已变化，请重新预览')
        if preview.blockers:
            raise RevisionConflict('；'.join(preview.blockers))
        if preview.identity_confirmation_required and not body.identity_changes_confirmed:
            raise ValueError('请先明确确认拆分、合并、退出或恢复的身份去向')
        if not any(impact.changes for impact in preview.impacts):
            raise ValueError('本章划分没有变化，无需保存')
        created = {}
        async with self.db.begin_nested():
            if rows and not await current_version(self.db, chapter_id, locked=True):
                await record_version(self.db, self.division_snapshot(chapter, [row for row in rows if row.is_current]), origin='baseline')
            # 移动的当前成员先进入正整数临时槽位，防止交换顺序触发唯一约束。
            temporary = max([row.position for row in rows] + [len(body.draft.members)]) + 1
            for offset, impact in enumerate(preview.impacts):
                if impact.before and ('position' in impact.changes or 'exited' in impact.changes):
                    await self.db.execute(update(Sequence).where(Sequence.id == impact.before.id).values(position=temporary + offset))
            for position, impact in enumerate(preview.impacts):
                if not impact.changes:
                    continue
                if impact.after is None:
                    await self.db.execute(update(Sequence).where(Sequence.id == impact.before.id).values(
                        is_current=False, position=impact.before.position, version=impact.before.version + 1))
                    continue
                member = impact.after
                preparation = member.shooting_preparation.model_copy(deep=True)
                if impact.before and ('range' in impact.changes or impact.before.source_text != chapter.raw_text[member.span.start:member.span.end]):
                    for note in preparation.notes:
                        note.choice = 'review'
                preparation = await self._stored_preparation(chapter_id, chapter.raw_text[member.span.start:member.span.end], preparation, member.span.start, body.draft.source_version)
                if impact.before is None:
                    identity = uuid5(NAMESPACE_URL, f'division:{chapter_id}:{body.request_id}:{member.key}').hex
                    row = Sequence(id=identity, chapter_id=chapter_id, position=position, title=member.title.strip(),
                        version=1, shooting_preparation=preparation.model_dump(mode='json'), source=Source(kind='chapter', reference=chapter_id, version=body.draft.source_version).model_dump(mode='json'),
                        source_start=member.span.start, source_end=member.span.end,
                        source_text=chapter.raw_text[member.span.start:member.span.end])
                    self.db.add(row)
                    created[member.key] = identity
                    await self.db.flush()
                else:
                    values = dict(title=member.title.strip(), position=position, version=impact.before.version + 1, is_current=True,
                                  shooting_preparation=preparation.model_dump(mode='json'))
                    if 'range' in impact.changes or 'source' in impact.changes:
                        values.update(source_start=member.span.start, source_end=member.span.end,
                            source_text=chapter.raw_text[member.span.start:member.span.end],
                            source=Source(kind='chapter', reference=chapter_id, version=body.draft.source_version).model_dump(mode='json'))
                    await self.db.execute(update(Sequence).where(Sequence.id == impact.before.id).values(**values))
            current = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True))
                .order_by(Sequence.position).with_for_update().execution_options(populate_existing=True)))
            task_ids = await self._current_rows(select(Task.id).where(Task.project_id == self.project_id,
                Task.target_type == 'directing_chapter', Task.target_id == chapter_id).order_by(Task.created_at))
            saved_chapter = ChapterSequences(chapter_id=chapter_id, title=chapter.title, raw_text=chapter.raw_text,
                source_version=body.draft.source_version, sequences=[self.sequence_read(row, chapter) for row in current], task_ids=task_ids)
            saved_chapter = await record_version(self.db, saved_chapter,
                origin='restore' if body.draft.source_revision_id else ('ai' if body.draft.source_task_id else 'manual'),
                source_task_id=body.draft.source_task_id, source_revision_id=body.draft.source_revision_id,
                request_id=body.request_id, mapping={'lineage': [row.model_dump(mode='json') for row in body.draft.lineage],
                    'exited_sequence_ids': body.draft.exited_sequence_ids, 'created_sequence_ids': created,
                    'restored_sequence_ids': [row.sequence_id for row in body.draft.restored_baseline],
                    'history_reconfirmed': body.draft.history_reconfirmed})
            result = DivisionSaved(request_id=body.request_id, chapter=saved_chapter,
                created_sequence_ids=created, impacts=preview.impacts)
            self.db.add(DivisionCommit(chapter_id=chapter_id, request_id=body.request_id, request_hash=request_hash,
                                       response=result.model_dump(mode='json')))
            await self.db.flush()
        return result
