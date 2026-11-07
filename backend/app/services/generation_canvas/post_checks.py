"""Manual checks of one retained output and its frozen generation basis."""
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.generation_canvas import CanvasRun, CanvasRunNode, GenerationCanvas
from app.schemas.canvas_checks import (
    CanvasCheckBasis, CanvasCheckExecution, CanvasCheckItem, CanvasCheckOmission, CanvasCheckProduct,
    CanvasCheckReportRead, CanvasPostCheckPreview, CanvasPostCheckRequest,
)
from app.schemas.generation_canvas import CanvasCompiledInput, CanvasDocument, CheckCard
from app.services.generation_canvas.check_media import owned_check_files, supports_check_image, supports_check_video
from app.services.generation_canvas.check_product_text import (
    PRODUCT_TEXT_CATEGORY, PRODUCT_TEXT_LABEL, text_product_items,
)
from app.services.generation_canvas.check_product_video import (
    VIDEO_PRODUCT_CHECK, VIDEO_PRODUCT_LABEL, VIDEO_SAMPLE_FPS, VIDEO_SEQUENCE,
)
from app.services.generation_canvas.check_product_visual import (
    VISUAL_PRODUCT_CHECK, VISUAL_PRODUCT_LABEL, visual_check_groups, visual_product_items,
)
from app.services.generation_canvas.check_selection import select_check_items
from app.services.generation_canvas.checks import CHECK_REPORT_TARGET, CanvasChecks, check_configuration, check_target, persist_check_report
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.execution_basis import digest
from app.services.generation_canvas.historical_content import CanvasHistoricalContent
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.task_service import TaskService

_RETAINED_STATUSES = ('succeeded', 'failed', 'cancelled')


def _product(node, output: dict, position: int, revision: int, *, include_text: bool = False) -> CanvasCheckProduct:
    return CanvasCheckProduct(run_id=node.run_id, node_id=node.id, position=position, source=output['source'],
                              generation_status=node.status, result_set_id=node.result_set_id, revision=revision,
                              text=output.get('text') if include_text else None, modality=output['modality'],
                              file_id=output.get('file_id'))


def is_check_product(output):
    if output.get('modality') == 'text':
        return bool((output.get('text') or '').strip())
    return output.get('modality') in ('image', 'video') and bool(output.get('file_id'))


def _historical_basis(node: CanvasRunNode, product: CanvasCheckProduct) -> CanvasCheckBasis:
    """Project the admitted public basis using its historical revision and product identity."""
    original = node.basis or {}
    model = original.get('model') or {}
    parameters = {key: value for key, value in (model.get('params') or {}).items()
                  if key in ('temperature', 'max_tokens', 'max_completion_tokens', 'top_p',
                             'frequency_penalty', 'presence_penalty', 'seed') and type(value) in (int, float)}
    if product.modality != 'text':
        config = (original.get('card') or {}).get('config') or {}
        parameters.update({key: config[key] for key in ('seconds', 'ratio', 'target_ratio', 'count', 'resolution_profile')
                           if key in config})
    raw = original.get('input') or {}
    try:
        compiled = CanvasCompiledInput.model_validate({**raw, 'card_id': node.card_id, 'revision': product.revision})
    except ValidationError:
        compiled = CanvasCompiledInput(card_id=node.card_id, revision=product.revision,
                                       text=raw.get('text', '') if isinstance(raw.get('text'), str) else '')
    return CanvasCheckBasis(target_card_id=node.card_id, revision=product.revision, model_id=model.get('id'),
                            input=compiled, parameters=parameters,
                            basis_hash=digest({'original_basis': original, 'product': product.model_dump(mode='json')}))


def select_product_scope(card: CheckCard, items: list[CanvasCheckItem]) -> None:
    """Apply saved post-check categories and per-item exclusions to derived observations."""
    for item in items:
        item.enabled = item.category in card.post_check_categories and item.id not in card.disabled_items


def _visual_method(modality, selected, observations):
    groups = visual_check_groups(selected, observations)
    if (VIDEO_SEQUENCE, None) in groups:
        method = 'video_mixed' if len(groups) > 1 else 'video_sequence'
    else:
        method = 'image' if modality == 'image' else 'video_frame'
    return method, len(groups)


def _visual_capability_reasons(model, unavailable, modality):
    image = unavailable or (None if supports_check_image(model) else '所选检查模型未接入图片读取能力，无法判断画面')
    sequence = unavailable
    if modality == 'video' and not sequence and not supports_check_video(model):
        sequence = '所选检查模型未接入视频序列读取能力，无法判断动作过程'
    return image, sequence


def estimate_product_calls(compiled, modality, card, model, unavailable, *, generation, canvas_id):
    """Estimate per-product work before a result exists, using the same observation grouping."""
    if modality == 'text':
        items, _ = text_product_items(compiled, unavailable=unavailable, generation=generation, canvas_id=canvas_id)
        select_product_scope(card, items)
        return 'text', int(any(item.enabled and item.availability == 'ready' for item in items)), unavailable
    image, sequence = _visual_capability_reasons(model, unavailable, modality)
    items, observations = visual_product_items(compiled, modality, image, sequence_unavailable=sequence,
                                               generation=generation, canvas_id=canvas_id)
    select_product_scope(card, items)
    selected, _ = select_check_items(items, None)
    method, calls = _visual_method(modality, selected, observations)
    reason = next((item.reason for item in items if item.enabled and item.reason), None)
    return method, calls, unavailable or (reason if not calls else None)


class CanvasPostChecks:
    """Observe historical outputs without recomputing the active target or updating generation."""

    def __init__(self, db: AsyncSession, project_id: str):
        self.db, self.project_id = db, project_id
        self.checks = CanvasChecks(db, project_id)
        self.history = CanvasHistoricalContent(db, project_id)

    async def products(self, canvas_id: str, card_id: str) -> list[CanvasCheckProduct]:
        """List fixed outcomes of the linked model, including retained partial outputs."""
        canvas = await self.checks.store.get(canvas_id)
        _, target_id = check_target(CanvasOutputContext(CanvasDocument.model_validate(canvas.document)), card_id)
        if target_id is None:
            return []
        rows = await self.db.execute(select(CanvasRunNode.id, CanvasRunNode.run_id, CanvasRunNode.status,
            CanvasRunNode.result_set_id, CanvasRunNode.outputs, CanvasRun.revision).join(CanvasRun, CanvasRun.id == CanvasRunNode.run_id)
            .where(CanvasRunNode.canvas_id == canvas_id, CanvasRunNode.card_id == target_id, CanvasRunNode.status.in_(_RETAINED_STATUSES))
            .order_by(CanvasRun.created_at.desc(), CanvasRun.revision.desc(), CanvasRun.id.desc()))
        return [_product(row, output, index, row.revision) for row in rows
                for index, output in enumerate(row.outputs) if is_check_product(output)]

    async def _prepare(self, canvas: GenerationCanvas, card_id: str, run_id: str, node_id: str, position: int,
                       *, lock_files=False):
        card, target_id = check_target(CanvasOutputContext(CanvasDocument.model_validate(canvas.document)), card_id)
        node = await self.history.output_node(canvas.id, run_id, node_id, position)
        output = node.outputs[position]
        if (node.card_id != target_id or node.status not in _RETAINED_STATUSES
                or not is_check_product(output)):
            raise diagnostic('CHECK_PRODUCT_UNAVAILABLE', '请选择当前连接目标的固定产物',
                             {'card_id': card_id, 'node_id': node_id, 'position': position}, blocks=['check'])
        run = await self.db.get(CanvasRun, run_id)
        model, unavailable = await self.checks.check_model(card)
        preview, requirements = await self.prepare_product(
            node, position, run.revision, canvas.revision, card, model, unavailable, lock_files=lock_files)
        return card, preview, requirements, model

    async def prepare_product(self, node, position, generated_revision, check_revision, card, model, unavailable, *, lock_files=False):
        """Derive reports from an immutable product, with either manual or admitted check settings."""
        product = _product(node, node.outputs[position], position, generated_revision, include_text=True)
        basis = _historical_basis(node, product)
        generation = (node.basis or {}).get('card')
        if product.modality == 'text':
            items, requirements = text_product_items(basis.input, unavailable=unavailable, generation=generation, canvas_id=node.canvas_id)
            reason = unavailable if items else '依据缺失：原生成依据未保留可用的明确文字要求'
            select_product_scope(card, items)
            selected, _ = select_check_items(items, None)
            method, calls = 'text', int(bool(selected and model))
        else:
            items, requirements, reason = await self._visual_items(basis, product, model, unavailable,
                                                                 generation=generation, canvas_id=node.canvas_id, lock_files=lock_files)
            select_product_scope(card, items)
            selected, _ = select_check_items(items, None)
            method, calls = _visual_method(product.modality, selected, requirements)
        preview = CanvasPostCheckPreview(revision=check_revision, product=product, basis=basis, items=items,
                                         estimated_calls=calls, observation_method=method, reason=reason)
        return preview, requirements

    async def _visual_items(self, basis, product, model, unavailable, *, generation, canvas_id, lock_files=False):
        """Keep missing capabilities and inaccessible project files local to the affected items."""
        reason, sequence_reason = _visual_capability_reasons(model, unavailable, product.modality)
        items, requirements = visual_product_items(basis.input, product.modality, reason, sequence_unavailable=sequence_reason,
                                                    generation=generation, canvas_id=canvas_id)
        if not items:
            return items, requirements, '依据缺失：原生成依据未保留可核对的视觉要求'
        ready = [item for item in items if item.availability == 'ready']
        if not ready:
            return items, requirements, reason
        references = {requirements[item.id]['reference_file_id'] for item in ready}
        files = await owned_check_files(self.db, self.project_id, (references - {None}) | {product.file_id}, lock=lock_files)
        product_file = files.get(product.file_id)
        for item in ready:
            reference = requirements[item.id]['reference_file_id']
            if not product_file or product_file.type != product.modality:
                item.availability, item.reason = 'unavailable', '历史产物文件不可用，无法判断画面'
            elif reference and (reference not in files or files[reference].type != 'image'):
                item.availability, item.reason = 'unavailable', '该项采用的对照图片不可用，无法判断外观'
        return items, requirements, reason

    async def preview(self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int) -> CanvasPostCheckPreview:
        """Show the pinned historical product and estimated calls without executing a model."""
        canvas = await self.checks.store.get(canvas_id)
        _, preview, _, _ = await self._prepare(canvas, card_id, run_id, node_id, position)
        return preview

    async def run(self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int,
                  request: CanvasPostCheckRequest) -> CanvasCheckReportRead:
        """Freeze one selected historical product and admit grouped observations."""
        canvas = await self.checks.store.get(canvas_id, lock=True)
        target = {'card_id': card_id, 'node_id': node_id, 'position': position}
        if canvas.revision != request.expected_revision:
            raise diagnostic('CHECK_BASIS_CHANGED', '检查卡修订已变，请重新确认产物', target, status=409, blocks=['check'])
        card, preview, requirements, model = await self._prepare(canvas, card_id, run_id, node_id, position, lock_files=True)
        if preview.basis.basis_hash != request.basis_hash:
            raise diagnostic('CHECK_BASIS_CHANGED', '产物版本与检查依据不一致', target, status=409, blocks=['check'])
        if request.item_id is not None and not any(item.id == request.item_id and item.availability == 'ready'
                                                   for item in preview.items):
            raise diagnostic('CHECK_ITEM_UNAVAILABLE', '所选检查项不可执行', target, blocks=['check'])
        expected_calls = 1 if request.item_id is not None else preview.estimated_calls
        if expected_calls != request.expected_calls:
            raise diagnostic('CHECK_ESTIMATE_CHANGED', '预计调用次数已变化，请重新确认', target, status=409, blocks=['check'])
        return await self.write_product_report(canvas_id, card, preview, requirements, model, item_id=request.item_id)

    async def write_product_report(self, canvas_id, card, preview, requirements, model, *, item_id=None, report_id=None, automatic=False):
        """Create a fixed product report and admit its grouped tasks atomically."""
        selected, omitted = select_check_items(preview.items, item_id)
        if not preview.items:
            omitted.append(CanvasCheckOmission(item_id=PRODUCT_TEXT_CATEGORY, label=PRODUCT_TEXT_LABEL,
                source_card_id=preview.basis.target_card_id, status='unavailable', reason=preview.reason))
        report = CanvasCheckReportRead(id=report_id or uuid4().hex, check_card_id=card.id, created_at=datetime.now(UTC),
            scope='item' if item_id is not None else 'all', basis=preview.basis, product=preview.product,
            items=selected, results=[], omitted=omitted, check_model_id=card.check_model_id,
            configuration=check_configuration(card, product=True),
            enabled_item_ids=[item.id for item in preview.items if item.enabled], automatic=automatic)
        tasks = {}
        if selected and model and preview.product.modality == 'text':
            task = await TaskService(self.db).submit(kind='canvas_check', project_id=self.project_id,
                target_type=CHECK_REPORT_TARGET, target_id=report.id, title=PRODUCT_TEXT_LABEL,
                provider_id=None if automatic else model.provider_id, expected_target_version=preview.revision, snapshot={
                    'check_category': PRODUCT_TEXT_CATEGORY, 'execution_config': model.model_dump(mode='json'),
                    'observation': {
                        'requirements': [requirements[item.id] for item in selected],
                        'output_text': preview.product.text,
                        'incomplete': preview.product.generation_status != 'succeeded',
                    },
                })
            tasks = {item.id: task.id for item in selected}
        elif selected and model:
            tasks = await self._submit_visual(report, selected, requirements, model, preview.revision)
        report.executions = [CanvasCheckExecution(item_id=item.id, status='queued') for item in selected if item.id in tasks]
        return await persist_check_report(self.db, canvas_id, report, tasks)


    async def _submit_visual(self, report, selected, observations, model, revision):
        """Store actual file identities and a private model route before Worker reads bytes."""
        product = report.product
        tasks = {}
        for (edge, reference_id), requirements in visual_check_groups(selected, observations).items():
            inputs = [('check_product', 0, product.file_id)]
            if reference_id:
                inputs.append(('check_reference', 0, reference_id))
            observation = {'file_id': product.file_id, 'modality': product.modality, 'frame_edge': edge,
                           'reference_file_id': reference_id, 'requirements': requirements,
                           'incomplete': product.generation_status != 'succeeded'}
            category, title = VISUAL_PRODUCT_CHECK, VISUAL_PRODUCT_LABEL
            if edge == VIDEO_SEQUENCE:
                category, title = VIDEO_PRODUCT_CHECK, VIDEO_PRODUCT_LABEL
                observation['sampling_fps'] = VIDEO_SAMPLE_FPS
            task = await TaskService(self.db).submit(kind='canvas_check', project_id=self.project_id,
                target_type=CHECK_REPORT_TARGET, target_id=report.id, title=title,
                provider_id=None if report.automatic else model.provider_id, expected_target_version=revision, snapshot={
                    'check_category': category, 'execution_config': model.model_dump(mode='json'),
                    'observation': observation,
                }, inputs=inputs)
            tasks.update((row['item_id'], task.id) for row in requirements)
        return tasks
