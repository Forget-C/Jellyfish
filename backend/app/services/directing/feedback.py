"""场次审片、章节播放与反馈查询；模型任务只由既有显式生产入口创建。"""
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.feedback import (
    FeedbackRead, FeedbackWrite, KnowledgeCandidate,
    RepairItem, RepairRead,
)
from app.core.contracts.directing.production import SequenceCut
from app.core.contracts.directing.style import ProjectStyleProfile, StyleRule, StyleWrite
from app.core.contracts.directing.common import Source
from app.models.directing import DirectingRevision, RepairPlanLink
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
