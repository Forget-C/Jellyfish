"""把当前会话范围内的创作请求转换成画布协议可核对的预演。"""

from copy import copy
from dataclasses import dataclass
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.schemas.canvas_assistant import CanvasAssistantReadContext
from app.schemas.canvas_assistant_edit import (
    CanvasAssistantEditGroup, CanvasAssistantProposal, CanvasAssistantProposalIssue, ProposedCanvasBatchGroup,
)
from app.schemas.canvas_edit_intents import CanvasEditIntent
from app.schemas.generation_canvas import CanvasCompiledInput, CanvasDocument, CanvasRead
from app.services.generation_canvas.assistant_context import context_page, prioritize_context_cards
from app.services.generation_canvas.assistant_edits import CanvasAssistantEditDraft
from app.services.generation_canvas.catalog import canvas_catalog
from app.services.generation_canvas.edits import (
    CanvasEditGroupPreview, CanvasEditPreview, canvas_edits, project_canvas_edit_group,
)
from app.services.generation_canvas.errors import CanvasDomainError, diagnostic
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.generation_canvas.lifecycle import canvas_lifecycle, free_canvas_lifecycle


class CanvasPlanningPreview(BaseModel):
    """服务端保存的预演及面向对话的摘要。"""

    model_config = ConfigDict(frozen=True)
    preview_id: str | None = None
    plan: CanvasEditPreview | None = None
    proposal: CanvasAssistantProposal | None = None
    issues: tuple[CanvasAssistantProposalIssue, ...] = ()
    reused_cards: tuple[str, ...] = ()

    def tool_result(self) -> dict:
        """模型只读所见差异摘要及预演身份，完整计划留在业务侧。"""
        return self.model_dump(mode='json', exclude={'plan'})


@dataclass(frozen=True)
class _PlanningSnapshot:
    result: CanvasPlanningPreview
    candidates: dict[str, CanvasDocument]


class CanvasPlanningTools:
    """创作工具由已授权的会话组装，其中的项目、画布和目标范围由宿主固定。"""

    def __init__(self, sessions: async_sessionmaker[AsyncSession], project_id: str | None, canvas_id: str,
                 context: CanvasAssistantReadContext, planner: CanvasAssistantEditDraft, *, draft: bool = False):
        project_id = project_id or None
        if (planner.visible_document.id != canvas_id or planner.visible_document.project_id != project_id
                or (draft and project_id is not None)):
            raise ValueError('预演上下文与当前画布不符')
        self.sessions = sessions
        self.project_id = project_id
        self.canvas_id = canvas_id
        self.context = context
        self.planner = planner
        self.draft = draft
        self.latest = CanvasPlanningPreview()
        self._previews: dict[str, _PlanningSnapshot] = {}

    async def _current(self, db: AsyncSession) -> CanvasRead:
        if not self.draft:
            return await canvas_lifecycle(db, self.project_id).read(self.canvas_id)
        current = await free_canvas_lifecycle(db).read_free_draft(self.canvas_id)
        if current.revision >= 0:
            raise diagnostic('REVISION_CONFLICT', '草稿已保存，请重新读取', {'canvas_id': self.canvas_id}, status=409)
        return current.model_copy(update={'revision': 0, 'document': self.planner.visible_document})

    async def read(self, *, offset: int = 0, limit: int = 20) -> dict:
        """分页读取用户所见与有效来源，同时核对当前画布的可用卡片。"""
        async with self.sessions() as db:
            await self._current(db)
            catalog = (canvas_catalog(kind='free') if self.draft
                       else await canvas_lifecycle(db, self.project_id).catalog(self.canvas_id))
        cards = prioritize_context_cards(self.context, self.planner.user_request)
        page = context_page(self.context, cards, offset=max(0, offset), limit=max(1, min(20, limit)))
        return {**page, 'catalog': [{'type': card.type, 'title': card.title} for card in catalog.cards]}

    async def preview(self, groups: list[ProposedCanvasBatchGroup | dict]) -> CanvasPlanningPreview:
        """在原范围内复用创作语义，逐组用画布协议核实差异。"""
        draft = copy(self.planner)
        draft.proposal = None
        draft.reused_cards = set()
        if self.draft:
            draft.saved_cards = {card.id: card for card in draft.visible_document.cards if card.id in draft.cards}
        approved: list[CanvasEditGroupPreview] = []
        summaries = []
        candidates = {}
        async with self.sessions() as db:
            current = await self._current(db)
            draft.video_inputs = await canvas_generation_inputs(db, self.project_id).video_reference_context(
                draft.visible_document, draft.readable_card_ids | draft.cards.keys(),
                expected_revision=None if self.draft else current.revision,
            )
            proposed = draft.preview_batch(groups)
            issues = draft.proposal_issues
            if _changed_cards(draft.visible_document, current.document, draft.reused_cards):
                issues.append(CanvasAssistantProposalIssue(message='沿用的卡片已变化，请重新读取后核对'))
            for group in (proposed.groups if proposed else None) or ():
                try:
                    checked = await self._check_group(db, current, group)
                    if checked.differences:
                        candidates[group.id] = project_canvas_edit_group(current.document, checked)
                except CanvasDomainError as exc:
                    issues.append(CanvasAssistantProposalIssue(group=int(group.id), message=exc.detail['message']))
                    continue
                if checked.differences:
                    approved.append(checked)
                    summaries.append(group)
        preview_id = uuid4().hex if approved else None
        result = CanvasPlanningPreview(
            preview_id=preview_id, issues=tuple(issues), reused_cards=tuple(sorted(draft.reused_cards)),
            plan=CanvasEditPreview(canvas_id=self.canvas_id, revision=current.revision, groups=tuple(approved))
                 if approved else None,
            proposal=CanvasAssistantProposal(**summaries[0].edits[0].model_dump(), groups=summaries)
                     if summaries else None,
        )
        if preview_id:
            self._previews[preview_id] = _PlanningSnapshot(result.model_copy(deep=True), candidates)
        self.latest = result
        return result

    async def _check_group(self, db: AsyncSession, current: CanvasRead,
                           group: CanvasAssistantEditGroup) -> CanvasEditGroupPreview:
        intents = [
            CanvasEditIntent(edit.card_id, edit.target, edit.before, edit.after, edit.copy_of, edit.impact_fingerprint)
            for edit in group.edits
        ]
        return await canvas_edits(db, self.project_id).preview_visible_group(
            self.planner.visible_document, group.id, intents,
            expected_revision=None if self.draft else current.revision,
        )

    def get_preview(self, preview_id: str) -> CanvasPlanningPreview | None:
        """只能从同一会话工具的可信预演记录取得待送审计划。"""
        selected = self._previews.get(preview_id)
        return selected.result.model_copy(deep=True) if selected else None

    async def project_trusted_proposal(self, db: AsyncSession,
                                       proposal: CanvasAssistantProposal) -> CanvasPlanningPreview:
        """Lower an already scoped special preview or field revision to the same domain plan."""
        current = await self._current(db)
        groups = []
        summaries = []
        candidates = {}
        issues = []
        for group in proposal.groups or ():
            try:
                checked = await self._check_group(db, current, group)
                if checked.differences:
                    candidates[group.id] = project_canvas_edit_group(current.document, checked)
                    groups.append(checked)
                    summaries.append(group)
            except CanvasDomainError as exc:
                issues.append(CanvasAssistantProposalIssue(group=int(group.id) if group.id.isdecimal() else None,
                                                           message=exc.detail['message']))
        if groups:
            preview_id = uuid4().hex
            resolved = CanvasAssistantProposal(**summaries[0].edits[0].model_dump(), groups=summaries)
            result = CanvasPlanningPreview(
                preview_id=preview_id, proposal=resolved, issues=tuple(issues),
                plan=CanvasEditPreview(canvas_id=self.canvas_id, revision=current.revision, groups=tuple(groups)),
            )
            self._previews[preview_id] = _PlanningSnapshot(result.model_copy(deep=True), candidates)
        else:
            result = CanvasPlanningPreview(issues=tuple(issues))
        self.latest = result
        return result

    async def inspect_inputs(self, card_id: str, *, group_id: str | None = None,
                             preview_id: str | None = None) -> CanvasCompiledInput:
        """核对所见或指定预演组的实际正文和素材，不创建运行或生成凭据。"""
        async with self.sessions() as db:
            current = await self._current(db)
            document = self.planner.visible_document
            if group_id is None:
                if card_id not in {card['id'] for card in self.context.cards}:
                    raise HTTPException(404, '当前范围未包含此卡片')
            else:
                selected = self._previews.get(preview_id or self.latest.preview_id)
                document = selected.candidates.get(group_id) if selected else None
                if document is None or (card_id not in {card['id'] for card in self.context.cards}
                                        and not any(edit.card_id == card_id for group in selected.result.proposal.groups
                                                    if group.id == group_id for edit in group.edits)):
                    raise HTTPException(404, '此预演组未包含可核对的目标')
                if selected.result.plan.revision != current.revision:
                    raise diagnostic('REVISION_CONFLICT', '画布已变化，请重新预演', {'canvas_id': self.canvas_id}, status=409)
            return await canvas_generation_inputs(db, self.project_id).compile_document(
                document, card_id, draft=self.draft, expected_revision=current.revision,
            )


def _changed_cards(visible: CanvasDocument, current: CanvasDocument, affected: set[str]) -> bool:
    before_cards = {card.id: card for card in visible.cards}
    current_cards = {card.id: card for card in current.cards}
    return any(before_cards.get(key) != current_cards.get(key) for key in affected)
