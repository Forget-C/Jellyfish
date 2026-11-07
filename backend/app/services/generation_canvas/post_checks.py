"""Manual checks of one retained text output and its frozen generation basis."""
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.generation_canvas import CanvasRun, CanvasRunNode, GenerationCanvas
from app.schemas.canvas_checks import (
    CanvasCheckBasis, CanvasCheckExecution, CanvasCheckOmission, CanvasCheckProduct,
    CanvasCheckReportRead, CanvasPostCheckPreview, CanvasPostCheckRequest,
)
from app.schemas.generation_canvas import CanvasCompiledInput, CanvasDocument
from app.services.generation_canvas.check_product_text import (
    PRODUCT_TEXT_CATEGORY, PRODUCT_TEXT_LABEL, text_product_items,
)
from app.services.generation_canvas.check_selection import select_check_items
from app.services.generation_canvas.checks import CHECK_REPORT_TARGET, CanvasChecks, check_target, persist_check_report
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.execution_basis import digest
from app.services.generation_canvas.historical_content import CanvasHistoricalContent
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.task_service import TaskService

_RETAINED_STATUSES = ('succeeded', 'failed', 'cancelled')


def _product(node, output: dict, position: int, revision: int, *, include_text: bool = False) -> CanvasCheckProduct:
    return CanvasCheckProduct(run_id=node.run_id, node_id=node.id, position=position, source=output['source'],
                              generation_status=node.status, result_set_id=node.result_set_id, revision=revision,
                              text=output['text'] if include_text else None)


def _historical_basis(node: CanvasRunNode, product: CanvasCheckProduct) -> CanvasCheckBasis:
    """Project the admitted public basis using its historical revision and product identity."""
    original = node.basis or {}
    model = original.get('model') or {}
    parameters = {key: value for key, value in (model.get('params') or {}).items()
                  if key in ('temperature', 'max_tokens', 'max_completion_tokens', 'top_p',
                             'frequency_penalty', 'presence_penalty', 'seed') and type(value) in (int, float)}
    raw = original.get('input') or {}
    try:
        compiled = CanvasCompiledInput.model_validate({**raw, 'card_id': node.card_id, 'revision': product.revision})
    except ValidationError:
        compiled = CanvasCompiledInput(card_id=node.card_id, revision=product.revision,
                                       text=raw.get('text', '') if isinstance(raw.get('text'), str) else '')
    return CanvasCheckBasis(target_card_id=node.card_id, revision=product.revision, model_id=model.get('id'),
                            input=compiled, parameters=parameters,
                            basis_hash=digest({'original_basis': original, 'product': product.model_dump(mode='json')}))


class CanvasPostChecks:
    """Observe historical outputs without recomputing the active target or updating generation."""

    def __init__(self, db: AsyncSession, project_id: str):
        self.db, self.project_id = db, project_id
        self.checks = CanvasChecks(db, project_id)
        self.history = CanvasHistoricalContent(db, project_id)

    async def products(self, canvas_id: str, card_id: str) -> list[CanvasCheckProduct]:
        """List text outcomes of the linked model, including terminal retained partial text."""
        canvas = await self.checks.store.get(canvas_id)
        _, target_id = check_target(CanvasOutputContext(CanvasDocument.model_validate(canvas.document)), card_id)
        if target_id is None:
            return []
        rows = await self.db.execute(select(CanvasRunNode.id, CanvasRunNode.run_id, CanvasRunNode.status,
            CanvasRunNode.result_set_id, CanvasRunNode.outputs, CanvasRun.revision).join(CanvasRun, CanvasRun.id == CanvasRunNode.run_id)
            .where(CanvasRunNode.canvas_id == canvas_id, CanvasRunNode.card_id == target_id, CanvasRunNode.status.in_(_RETAINED_STATUSES))
            .order_by(CanvasRun.created_at.desc(), CanvasRun.revision.desc(), CanvasRun.id.desc()))
        return [_product(row, output, index, row.revision) for row in rows
                for index, output in enumerate(row.outputs) if output.get('modality') == 'text' and output.get('text', '').strip()]

    async def _prepare(self, canvas: GenerationCanvas, card_id: str, run_id: str, node_id: str, position: int):
        card, target_id = check_target(CanvasOutputContext(CanvasDocument.model_validate(canvas.document)), card_id)
        node = await self.history.output_node(canvas.id, run_id, node_id, position)
        output = node.outputs[position]
        if (node.card_id != target_id or node.status not in _RETAINED_STATUSES
                or output.get('modality') != 'text' or not output.get('text', '').strip()):
            raise diagnostic('CHECK_PRODUCT_UNAVAILABLE', '请选择当前连接目标的固定文字产物',
                             {'card_id': card_id, 'node_id': node_id, 'position': position}, blocks=['check'])
        run = await self.db.get(CanvasRun, run_id)
        product = _product(node, output, position, run.revision, include_text=True)
        basis = _historical_basis(node, product)
        model, unavailable = await self.checks.check_model(card)
        items, requirements = text_product_items(basis.input, unavailable=unavailable)
        reason = unavailable if items else '依据缺失：原生成依据未保留可用的明确文字要求'
        preview = CanvasPostCheckPreview(revision=canvas.revision, product=product, basis=basis, items=items,
                                         estimated_calls=int(bool(items and model)), reason=reason)
        return card, preview, requirements, model

    async def preview(self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int) -> CanvasPostCheckPreview:
        """Show the pinned historical text and estimated calls without executing a model."""
        canvas = await self.checks.store.get(canvas_id)
        _, preview, _, _ = await self._prepare(canvas, card_id, run_id, node_id, position)
        return preview

    async def run(self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int,
                  request: CanvasPostCheckRequest) -> CanvasCheckReportRead:
        """Freeze one explicitly selected historical product and admit one grouped text call."""
        canvas = await self.checks.store.get(canvas_id, lock=True)
        target = {'card_id': card_id, 'node_id': node_id, 'position': position}
        if canvas.revision != request.expected_revision:
            raise diagnostic('CHECK_BASIS_CHANGED', '检查卡修订已变，请重新确认产物', target, status=409, blocks=['check'])
        card, preview, requirements, model = await self._prepare(canvas, card_id, run_id, node_id, position)
        if preview.basis.basis_hash != request.basis_hash:
            raise diagnostic('CHECK_BASIS_CHANGED', '产物版本与检查依据不一致', target, status=409, blocks=['check'])
        if preview.estimated_calls != request.expected_calls:
            raise diagnostic('CHECK_ESTIMATE_CHANGED', '预计调用次数已变化，请重新确认', target, status=409, blocks=['check'])
        selected, omitted = select_check_items(preview.items, request.item_id)
        if request.item_id is not None and not selected:
            raise diagnostic('CHECK_ITEM_UNAVAILABLE', '所选检查项不可执行', target, blocks=['check'])
        if not preview.items:
            omitted.append(CanvasCheckOmission(item_id=PRODUCT_TEXT_CATEGORY, label=PRODUCT_TEXT_LABEL,
                source_card_id=preview.basis.target_card_id, status='unavailable', reason=preview.reason))
        report = CanvasCheckReportRead(id=uuid4().hex, check_card_id=card_id, created_at=datetime.now(UTC),
            scope='item' if request.item_id is not None else 'all', basis=preview.basis, product=preview.product,
            items=selected, results=[], omitted=omitted, check_model_id=card.check_model_id,
            enabled_item_ids=[item.id for item in preview.items if item.enabled])
        tasks = {}
        if selected and model:
            task = await TaskService(self.db).submit(kind='canvas_check', project_id=self.project_id,
                target_type=CHECK_REPORT_TARGET, target_id=report.id, title=PRODUCT_TEXT_LABEL,
                provider_id=model.provider_id, expected_target_version=canvas.revision, snapshot={
                    'check_category': PRODUCT_TEXT_CATEGORY, 'execution_config': model.model_dump(mode='json'),
                    'observation': {
                        'requirements': [requirements[item.id] for item in selected],
                        'output_text': preview.product.text,
                        'incomplete': preview.product.generation_status != 'succeeded',
                    },
                })
            tasks = {item.id: task.id for item in selected}
            report.executions = [CanvasCheckExecution(item_id=item.id, status='queued') for item in selected]
        return await persist_check_report(self.db, canvas_id, report, tasks)
