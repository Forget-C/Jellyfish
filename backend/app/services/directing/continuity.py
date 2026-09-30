"""实际采用证据、人工接缝审查与局部失效查询，所有记录经领域校验保存。"""
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.continuity import (
    ContinuityRead, CutFrameRead, CutFrameRequest, SeamRead, SeamReviewRequest, UnitContinuityRead,
)
from app.core.contracts.directing.production import ProductionPlan, SequenceCut
from app.models.directing import CutFrame, DirectingRevision, SeamReview, Sequence
from app.services.directing.workspace import WorkspaceService


class ContinuityService(WorkspaceService):
    """连续性消费真实采用区间，不自动改变采用、计划或启动任务。"""

    async def current_items(self, sequence_id, *, expected_cut_id=None):
        """显式动作必须仍基于当前确认剪辑，拒绝旧页面覆盖新的采用依据。"""
        row = await self.active_cut(sequence_id)
        if expected_cut_id is not None and (row is None or row.id != expected_cut_id):
            raise ValueError("当前采用版本已变化，请刷新后再操作")
        return row, sorted(SequenceCut.model_validate(row.payload).items, key=lambda item: item.timeline_start_ms) if row else []

    async def read_frame(self, sequence_id, frame, items):
        """返回固定提帧来源；有效性仅相对于当前采用，不改写旧证据。"""
        take = await self.take(frame.take_id, sequence_id=sequence_id)
        return CutFrameRead(id=frame.id, cut_revision_id=frame.cut_revision_id, item_id=frame.item_id,
            take_id=frame.take_id, plan_revision_id=take.plan_revision_id, unit_id=take.unit_id,
            file_id=frame.file_id, media_range={'source_in_ms': frame.source_in_ms, 'source_out_ms': frame.source_out_ms},
            at_ms=frame.at_ms, edge=frame.edge, current=any(self.frame_matches(frame, item) for item in items))

    async def extract_cut_frame(self, sequence_id: str, body: CutFrameRequest) -> CutFrameRead:
        """从明确采用的真实区间提取首尾帧，预演卡不能成为真实接缝证据。"""
        await self.current_sequence(sequence_id)
        _, items = await self.current_items(sequence_id, expected_cut_id=body.cut_revision_id)
        item = next((item for item in items if item.id == body.item_id), None)
        if item is None or item.kind != 'media':
            raise ValueError('只能从当前采用的真实视频片段提帧')
        at_ms = item.media_range.source_in_ms if body.edge == 'start' else item.media_range.source_out_ms - 1
        extracted = await self.extract_take_frame(sequence_id, item.take_id, at_ms, adopted_range=item.media_range, edge=body.edge)
        at_ms = extracted.source.media_range.source_in_ms
        frame = CutFrame(id=uuid4().hex, sequence_id=sequence_id, cut_revision_id=body.cut_revision_id,
            item_id=item.id, take_id=item.take_id, file_id=extracted.file_id, edge=body.edge, at_ms=at_ms,
            source_in_ms=item.media_range.source_in_ms, source_out_ms=item.media_range.source_out_ms)
        self.db.add(frame)
        await self.db.flush()
        await self.cut_frame(sequence_id, frame.id)
        # 提帧期间可能确认了新剪辑，仍保存真实来源但不冒充当前证据。
        _, latest = await self.current_items(sequence_id)
        return await self.read_frame(sequence_id, frame, latest)

    @staticmethod
    def adjacent_pairs(items):
        """只比较时间线上直接相接的两个真实片段，跳过预演和有意留白。"""
        return [(left, right) for left, right in zip(items, items[1:])
                if left.kind == right.kind == 'media'
                and left.timeline_start_ms + left.media_range.source_out_ms - left.media_range.source_in_ms == right.timeline_start_ms]

    async def review_seam(self, sequence_id: str, body: SeamReviewRequest):
        """用户看到真实入落幅后显式审查；与采用确认共用锁，保存不可变结论。"""
        await self.current_sequence(sequence_id)
        await self.sequence(sequence_id)
        await self.db.scalar(select(Sequence).where(Sequence.id == sequence_id).with_for_update())
        _, items = await self.current_items(sequence_id, expected_cut_id=body.cut_revision_id)
        left = await self.cut_frame(sequence_id, body.left_frame_id)
        right = await self.cut_frame(sequence_id, body.right_frame_id)
        if left.edge != 'end' or right.edge != 'start' or not any(
            self.frame_matches(left, a) and self.frame_matches(right, b) for a, b in self.adjacent_pairs(items)
        ):
            raise ValueError('接缝审查需要当前相邻真实片段的落幅和入幅')
        self.db.add(SeamReview(id=uuid4().hex, sequence_id=sequence_id, cut_revision_id=body.cut_revision_id,
            left_frame_id=left.id, right_frame_id=right.id, verdict=body.verdict, rationale=body.rationale,
            actor_id='local-user'))
        await self.db.flush()
        return await self.continuity(sequence_id)

    async def continuity(self, sequence_id: str) -> ContinuityRead:
        """重算当前接缝与有关单元状态，未变化的实际片段保留既有复核。"""
        active, items = await self.current_items(sequence_id)
        frames = list(await self.db.scalars(select(CutFrame).where(CutFrame.sequence_id == sequence_id).order_by(CutFrame.id)))
        by_id = {frame.id: frame for frame in frames}
        reviews = list(await self.db.scalars(select(SeamReview).where(SeamReview.sequence_id == sequence_id)
            .order_by(SeamReview.created_at.desc(), SeamReview.id.desc())))
        seams = []
        for left, right in self.adjacent_pairs(items):
            review = next((row for row in reviews if self.frame_matches(by_id[row.left_frame_id], left)
                and self.frame_matches(by_id[row.right_frame_id], right)), None)
            seams.append(SeamRead(left_item_id=left.id, right_item_id=right.id,
                status=review.verdict if review else 'pending', review_id=review.id if review else None,
                rationale=review.rationale if review else None, reviewed_at=review.created_at if review else None))
        units = []
        plans = await self.db.scalars(select(DirectingRevision).where(DirectingRevision.sequence_id == sequence_id,
            DirectingRevision.kind == 'plan').order_by(DirectingRevision.created_at, DirectingRevision.id))
        for plan in plans:
            for unit in ProductionPlan.model_validate(plan.payload).units:
                if not unit.dependencies:
                    continue
                errors = await self.continuity_errors(sequence_id, unit)
                units.append(UnitContinuityRead(plan_revision_id=plan.id, unit_id=unit.id,
                    status='blocked' if errors else 'ready', errors=errors))
        return ContinuityRead(active_cut_revision_id=active.id if active else None,
            frames=[await self.read_frame(sequence_id, frame, items) for frame in frames], seams=seams, units=units)
