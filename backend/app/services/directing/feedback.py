"""场次审片、章节播放与反馈查询；模型任务只由既有显式生产入口创建。"""
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.feedback import (
    ChapterAssemblyRead, ChapterSequenceRead, FeedbackRead, FeedbackWrite, KnowledgeCandidate,
    ObservedRange, RepairItem, RepairRead, TransitionRead, TransitionWrite,
)
from app.core.contracts.directing.production import SequenceCut
from app.core.contracts.directing.style import ProjectStyleProfile, StyleRule, StyleWrite
from app.core.contracts.directing.common import Source
from app.models.directing import ChapterTransition, DirectingRevision, RepairPlanLink, Sequence
from app.models.studio import Chapter
from app.services.directing.continuity import ContinuityService
from app.services.directing.feedback_rules import changed_factors
from app.services.directing.store import RevisionConflict


class FeedbackService(ContinuityService):
    """复用统一存储，汇总当前验收状态并保留失效历史。"""

    async def feedback(self, sequence_id: str) -> FeedbackRead:
        """当前验收只取当前采用上的最后确认结论，草稿不改变验收状态。"""
        active = await self.active_cut(sequence_id)
        rows = list(await self.db.scalars(select(DirectingRevision).where(DirectingRevision.sequence_id == sequence_id,
            DirectingRevision.kind.in_(['cut_review', 'repair', 'knowledge'])).order_by(DirectingRevision.created_at, DirectingRevision.id)))
        reviews, repairs, knowledge = [], [], []
        for row in rows:
            snapshot = await self.read_revision(row.id)
            if row.kind == 'cut_review':
                reviews.append(snapshot)
            elif row.kind == 'knowledge':
                knowledge.append(snapshot)
            else:
                repairs.append(RepairRead(revision=snapshot, current=bool(active and active.id == snapshot.content.cut_revision_id),
                    changed_factors=await changed_factors(self, sequence_id, snapshot.content),
                    prepared_plan_ids=list(await self.db.scalars(select(RepairPlanLink.plan_revision_id).where(RepairPlanLink.repair_revision_id == row.id)))))
        current = sorted((row for row in reviews if row.confirmed_at and active and row.content.cut_revision_id == active.id),
                         key=lambda row: (row.confirmed_at, row.id))
        return FeedbackRead(active_cut_revision_id=active.id if active else None,
            current_review_id=current[-1].id if current else None, reviews=reviews, repairs=repairs, knowledge=knowledge)

    async def write_feedback(self, sequence_id: str, body: FeedbackWrite):
        """保存草稿或从已确认记录派生新版本，修订沿用 CAS。"""
        await self.current_sequence(sequence_id)
        return await self.save_revision(sequence_id, kind=body.document.kind, payload=body.document.content.model_dump(mode='json'),
            revision_id=body.revision_id, expected_version=body.expected_version, parent_id=body.parent_id)

    async def chapter_assembly(self, chapter_id: str) -> ChapterAssemblyRead:
        """实时组合章节顺序和当前采用；预演、空白、未验收与待后期分别暴露。"""
        chapter = await self.list_sequences(chapter_id)
        sequences, gaps = [], []
        for sequence in chapter.sequences:
            feedback = await self.feedback(sequence.id)
            cut = await self.active_cut(sequence.id)
            items = sorted(SequenceCut.model_validate(cut.payload).items, key=lambda item: item.timeline_start_ms) if cut else []
            review = next((row.content for row in feedback.reviews if row.id == feedback.current_review_id), None)
            missing, media, starts, end = [], [], [], 0
            for item in items:
                if item.timeline_start_ms > end:
                    missing.append(f'{end / 1000:g}–{item.timeline_start_ms / 1000:g} 秒为空白')
                if item.kind == 'planned':
                    missing.append(f'预演 {item.id} 尚无真实素材')
                    end = item.timeline_start_ms + item.estimated_duration_ms
                else:
                    media.append(ObservedRange(take_id=item.take_id, media_range=item.media_range))
                    starts.append(item.timeline_start_ms)
                    end = item.timeline_start_ms + item.media_range.source_out_ms - item.media_range.source_in_ms
            if not items:
                missing.append('尚无已确认采用')
            if not review or review.verdict != 'pass':
                missing.append('场次尚未验收通过')
            if sequence.source_changed:
                missing.append('原文已变化，需核对场次')
            sound = review.sound_status if review else 'pending_postproduction'
            if sound == 'pending_postproduction':
                missing.append('声音待后期处理')
            gaps.extend(f'{sequence.title}：{message}' for message in missing)
            sequences.append(ChapterSequenceRead(sequence_id=sequence.id, title=sequence.title, position=sequence.position,
                cut_revision_id=cut.id if cut else None, review_id=feedback.current_review_id,
                verdict=review.verdict if review else 'unreviewed', sound_status=sound, source_changed=sequence.source_changed,
                items=media, timeline_starts_ms=starts, duration_ms=end, gaps=missing))
        pairs = {(left.sequence_id, right.sequence_id): (left.cut_revision_id, right.cut_revision_id)
                 for left, right in zip(sequences, sequences[1:])}
        rows = list(await self.db.scalars(select(ChapterTransition).where(ChapterTransition.chapter_id == chapter_id)
            .order_by(ChapterTransition.created_at, ChapterTransition.id)))
        transitions = [TransitionRead(id=row.id, current=pairs.get((row.left_sequence_id, row.right_sequence_id)) ==
            (row.left_cut_revision_id, row.right_cut_revision_id), content=TransitionWrite.model_validate(row.payload)) for row in rows]
        for pair in pairs:
            relevant = [row for row in transitions if row.current and (row.content.left_sequence_id, row.content.right_sequence_id) == pair]
            if not relevant or relevant[-1].content.verdict != 'pass':
                gaps.append('跨场衔接尚未通过：' + ' → '.join(next(row.title for row in sequences if row.sequence_id == identity) for identity in pair))
        return ChapterAssemblyRead(chapter_id=chapter_id, title=chapter.title, sequences=sequences, transitions=transitions, gaps=gaps)

    async def review_transition(self, chapter_id: str, body: TransitionWrite):
        """锁定章节顺序与两场采用，以真正首尾边界保存一次跨场观察。"""
        await self.chapter(chapter_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id).with_for_update())
        ids = [body.left_sequence_id, body.right_sequence_id]
        for identity in sorted(ids):
            sequence = await self.current_sequence(identity)
            if sequence.chapter_id != chapter_id:
                raise ValueError('跨场审查只能使用本章节场次')
            await self.db.scalar(select(Sequence).where(Sequence.id == identity).with_for_update())
        assembly = await self.chapter_assembly(chapter_id)
        if not any(left.sequence_id == ids[0] and right.sequence_id == ids[1] for left, right in zip(assembly.sequences, assembly.sequences[1:])):
            raise RevisionConflict('章节相邻顺序已变化，请刷新')
        for sequence_id, cut_id, frame_id, edge in [(ids[0], body.left_cut_revision_id, body.left_frame_id, 'end'),
                                                   (ids[1], body.right_cut_revision_id, body.right_frame_id, 'start')]:
            _, items = await self.current_items(sequence_id, expected_cut_id=cut_id)
            frame = await self.cut_frame(sequence_id, frame_id)
            boundary = items[-1] if edge == 'end' and items else items[0] if items else None
            if boundary is None or frame.edge != edge or not self.frame_matches(frame, boundary):
                raise ValueError('跨场审查必须选择整场实际首尾片段的边界帧')
        if not body.observation.text or not body.observation.sources:
            raise ValueError('跨场观察必须有内容和来源')
        # Notes are tied to this observed boundary; arbitrary foreign file/revision claims are rejected.
        for note in (body.observation, body.sound):
            for source in note.sources:
                if source.kind != 'human' or source.file_id or source.media_range:
                    raise ValueError('跨场记录使用人工署名；媒体证据由所选边界帧提供')
        row = ChapterTransition(id=uuid4().hex, chapter_id=chapter_id, **{key: getattr(body, key) for key in (
            'left_sequence_id', 'right_sequence_id', 'left_cut_revision_id', 'right_cut_revision_id', 'left_frame_id', 'right_frame_id')},
            payload=body.model_dump(mode='json'), actor_id='local-user')
        self.db.add(row)
        await self.db.flush()
        return await self.chapter_assembly(chapter_id)

    async def propose_style(self, sequence_id: str, candidate_id: str):
        """显式将已确认经验转为本场适用的风格草稿，仍须在风格页确认。"""
        row = await self.revision(candidate_id, kind='knowledge', sequence_id=sequence_id, confirmed=True)
        candidate = KnowledgeCandidate.model_validate(row.payload)
        source = Source(kind='revision', reference=row.id, version=str(row.version))
        return await self.save_style(StyleWrite(content=ProjectStyleProfile(title='经验候选：' + candidate.claim.text,
            rules=[StyleRule(id='experience', role=candidate.role, requirement=candidate.recommendation + '\n适用条件：' + candidate.conditions,
                exceptions=candidate.exceptions, sequence_ids=[sequence_id], sources=[source])], sources=[source])))

    async def ledger(self, sequence_id: str):
        """在业务页聚合真值，任务中心继续只显示通用任务状态。"""
        from app.core.contracts.directing.ledger import LedgerAction, LedgerExecution, LedgerRead
        from app.models.task import Task
        from app.models.directing import DirectingAction
        workspace = await self.workspace(sequence_id)
        actions = list(await self.db.scalars(select(DirectingAction).where(DirectingAction.sequence_id == sequence_id)
            .order_by(DirectingAction.created_at, DirectingAction.id)))
        tasks = list(await self.db.scalars(select(Task).where(Task.project_id == self.project_id,
            Task.id.in_({*workspace.task_ids, *(take.task_id for take in workspace.takes)}))))
        executions = []
        for task in tasks:
            snapshot = task.input_snapshot
            operation = snapshot.get('operation_input') or {}
            executions.append(LedgerExecution(task_id=task.id, status=task.status, model_name=snapshot.get('model_name'),
                provider_key=snapshot.get('provider_key'), ratio=operation.get('ratio'), seconds=operation.get('seconds'),
                seed=operation.get('seed'), snapshot_available=operation.get('kind') == 'video_generation'))
        return LedgerRead(workspace=workspace, executions=executions, continuity=await self.continuity(sequence_id), feedback=await self.feedback(sequence_id),
            actions=[LedgerAction(revision_id=row.revision_id, review_revision_id=row.review_revision_id,
                action=row.action, actor_id=row.actor_id, displayed_label=row.displayed_label,
                unit_id=row.unit_id, task_id=row.task_id, created_at=row.created_at) for row in actions])


    async def prepare_repair_plan(self, sequence_id, repair_id, body):
        """复制问题所属单元的明确覆盖为局部草稿，保留好片段且不执行模型。"""
        await self.current_sequence(sequence_id)
        from copy import deepcopy
        from app.core.contracts.directing.production import ProductionPlan
        row = await self.revision(repair_id, kind='repair', sequence_id=sequence_id, confirmed=True)
        repair = RepairItem.model_validate(row.payload)
        if not repair.needs_new_media:
            raise ValueError('返工单尚未明确需要新素材，请先派生并确认修法')
        active = await self.active_cut(sequence_id)
        if active is None or active.id != repair.cut_revision_id:
            raise RevisionConflict('返工依据已不是当前采用，请先核对并派生返工记录')
        cut = SequenceCut.model_validate(active.payload)
        item = next(item for item in cut.items if item.id == repair.item_id)
        take = await self.take(item.take_id, sequence_id=sequence_id)
        original = await self.revision(take.plan_revision_id, kind='plan', confirmed=True)
        old = ProductionPlan.model_validate(original.payload)
        unit = deepcopy(next(unit for unit in old.units if unit.id == take.unit_id))
        if len(set(body.coverage_item_ids)) != len(body.coverage_item_ids) or not set(body.coverage_item_ids) <= {item.id for item in unit.coverage}:
            raise ValueError('局部补拍范围必须来自原单元的明确覆盖项')
        unit.coverage = [item for item in unit.coverage if item.id in body.coverage_item_ids]
        for coverage in unit.coverage:
            coverage.action_scope = body.action_scope
        unit.duration_ms = body.duration_ms
        unit.id = 'repair-' + uuid4().hex[:12]
        plan = await self.save_revision(sequence_id, kind='plan', parent_id=original.id,
            payload=ProductionPlan(design_revision_id=old.design_revision_id, units=[unit]).model_dump(mode='json'))
        self.db.add(RepairPlanLink(repair_revision_id=row.id, plan_revision_id=plan.id))
        await self.db.flush()
        return plan
