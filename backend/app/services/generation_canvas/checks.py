"""读取模型生成依据和执行显式检查；检查报告独立于生成任务。"""
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.generation_canvas import CanvasCheckReport, GenerationCanvas
from app.schemas.canvas_checks import CanvasCheckBasis, CanvasCheckPreview, CanvasCheckReportRead, CanvasCheckRequest
from app.schemas.generation_canvas import CheckCard, CanvasDocument, TextModelCard
from app.services.generation_canvas.check_selection import check_items, select_check_items
from app.services.generation_canvas.current_state import CanvasCurrentState
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.execution_basis import CanvasBasis, digest
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.generation_canvas.store import CanvasStore


_TEXT_PARAMETERS = ('temperature', 'max_tokens', 'max_completion_tokens', 'top_p',
                    'frequency_penalty', 'presence_penalty', 'seed')


def public_check_basis(basis: CanvasBasis) -> CanvasCheckBasis:
    """投影可核对参数和输入；模型供应商路由、密钥和执行配置不进入报告。"""
    parameters = basis.card.config.model_dump()
    if isinstance(basis.card, TextModelCard):
        params = basis.public_basis['model'].get('params') or {}
        parameters.update({key: params[key] for key in _TEXT_PARAMETERS
                           if key in params and type(params[key]) in (int, float)})
    data = {
        'target_card_id': basis.card.id, 'revision': basis.compiled.revision,
        'model_id': basis.card.model_id, 'parameters': parameters,
        'capability': basis.capability.model_dump() if basis.capability else None,
        'input': basis.compiled.model_dump(mode='json'),
    }
    return CanvasCheckBasis(**data, basis_hash=digest(data))


class CanvasChecks:
    """与画布保存使用相同项目边界，规则执行与报告写入处于同一事务。"""

    def __init__(self, db: AsyncSession, project_id: str):
        self.db = db
        self.store = CanvasStore(db, project_id)
        self.current = CanvasCurrentState(db, project_id)

    async def _basis(self, canvas: GenerationCanvas, card_id: str, *, lock_config: bool = False):
        context = CanvasOutputContext(CanvasDocument.model_validate(canvas.document))
        card = context.cards.get(card_id)
        if not isinstance(card, CheckCard):
            raise diagnostic('CHECK_CARD_NOT_FOUND', '检查卡不存在', {'card_id': card_id}, status=404, blocks=['check'])
        relation = next((edge for edge in context.incoming.get(card_id, ()) if edge.target_port == 'check_basis'), None)
        if relation is None:
            return card, None
        outputs = await self.current.current_outputs(canvas, context=context)
        return card, await self.current.current_basis(canvas, relation.source_card, outputs,
                                                      lock_config=lock_config, context=context)

    async def preview(self, canvas_id: str, card_id: str) -> CanvasCheckPreview:
        """读取保存后的当前目标和适用项，不启动模型或写报告。"""
        canvas = await self.store.get(canvas_id)
        card, basis = await self._basis(canvas, card_id)
        if basis is None:
            return CanvasCheckPreview(reason='请连接模型生成卡的生成检查依据')
        categories, items, _ = check_items(basis, card)
        return CanvasCheckPreview(basis=public_check_basis(basis), categories=categories, items=items)

    async def run(self, canvas_id: str, card_id: str, request: CanvasCheckRequest) -> CanvasCheckReportRead:
        """比较版本后执行本轮所选范围；不同检查拥有不同报告身份。"""
        canvas = await self.store.get(canvas_id, lock=True)
        target = {'card_id': card_id, 'canvas_id': canvas_id}
        if canvas.revision != request.expected_revision:
            raise diagnostic('CHECK_BASIS_CHANGED', '画布修订已变，请刷新检查依据', target, status=409, blocks=['check'])
        card, basis = await self._basis(canvas, card_id, lock_config=True)
        if basis is None:
            raise diagnostic('CHECK_TARGET_REQUIRED', '请连接模型生成卡的生成检查依据', target, blocks=['check'])
        public = public_check_basis(basis)
        if public.basis_hash != request.basis_hash:
            raise diagnostic('CHECK_BASIS_CHANGED', '检查依据已变，请刷新后再检查', target, status=409, blocks=['check'])
        _, items, comparisons = check_items(basis, card)
        selected, omitted = select_check_items(items, request.item_id)
        if not selected:
            unavailable = next((item.reason for item in items if item.id == request.item_id), None)
            raise diagnostic('CHECK_ITEM_UNAVAILABLE', unavailable or '本轮没有所选的可执行检查项', target, blocks=['check'])

        report = CanvasCheckReportRead(id=uuid4().hex, check_card_id=card_id, created_at=datetime.now(UTC),
                                       scope='item' if request.item_id is not None else 'all',
                                       basis=public, items=selected, omitted=omitted,
                                       results=[comparisons[item.id].evaluate() for item in selected],
                                       enabled_item_ids=[item.id for item in items if item.enabled])
        self.db.add(CanvasCheckReport(id=report.id, canvas_id=canvas_id, check_card_id=card_id,
                                      created_at=report.created_at.replace(tzinfo=None), report=report.model_dump(mode='json')))
        await self.db.flush()
        return report

    async def reports(self, canvas_id: str, card_id: str) -> list[CanvasCheckReportRead]:
        """保留断线前报告，按检查卡原身份查询，不用当前目标覆盖历史依据。"""
        canvas = await self.store.get(canvas_id)
        if canvas.card_types.get(card_id) != 'review.check':
            raise diagnostic('CHECK_CARD_NOT_FOUND', '检查卡不存在', {'card_id': card_id}, status=404, blocks=[])
        rows = await self.db.scalars(select(CanvasCheckReport).where(
            CanvasCheckReport.canvas_id == canvas_id, CanvasCheckReport.check_card_id == card_id
        ).order_by(CanvasCheckReport.created_at.desc(), CanvasCheckReport.id.desc()))
        return [CanvasCheckReportRead.model_validate(row.report) for row in rows]
