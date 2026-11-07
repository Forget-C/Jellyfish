"""读取模型生成依据和执行显式检查；检查报告独立于生成任务。"""
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import FrozenGenerationConfig
from app.core.contracts.task import TERMINAL_TASK_STATUSES, TaskStatus
from app.models.generation_canvas import CanvasCheckReport, GenerationCanvas
from app.models.llm import Model, ModelCategoryKey, Provider
from app.models.task import Task
from app.schemas.canvas_checks import (
    CanvasCheckBasis, CanvasCheckExecution, CanvasCheckPreview, CanvasCheckReportRead, CanvasCheckRequest, CanvasCheckResult,
)
from app.schemas.generation_canvas import CheckCard, CanvasDocument, TextModelCard
from app.services.generation_canvas.check_media import owned_check_files, supports_check_image
from app.services.generation_canvas.check_reference_media import REFERENCE_CATEGORY, reference_checks
from app.services.generation_canvas.check_selection import check_items, describe_category, select_check_items
from app.services.generation_canvas.current_state import CanvasCurrentState
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.execution_basis import CanvasBasis, digest
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.generation_canvas.store import CanvasStore
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.task_service import TaskService

CHECK_REPORT_TARGET = 'canvas_check_report'


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
        self.db, self.project_id = db, project_id
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

    async def _check_model(self, card: CheckCard) -> tuple[FrozenGenerationConfig | None, str | None]:
        """Resolve the explicitly selected text route, keeping credentials server-side."""
        if not card.check_model_id:
            return None, '请选择独立的文字检查模型'
        # One consistent read avoids locking two different models in opposite order across canvases.
        selected = (await self.db.execute(select(Model, Provider).outerjoin(Provider, Model.provider_id == Provider.id)
            .where(Model.id == card.check_model_id).execution_options(populate_existing=True))).one_or_none()
        if selected is None or selected.Model.category != ModelCategoryKey.text:
            return None, '所选检查模型不存在或不支持文字检查'
        model, provider = selected
        if provider is not None:
            try:
                config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
                return FrozenGenerationConfig(model_name=model.name, model_params=model.params or {},
                    provider_id=provider.id, provider_key=config.provider_key, api_key=config.api_key,
                    base_url=config.base_url), None
            except (HTTPException, ValidationError):
                pass
        return None, '所选检查模型的供应商配置不可用'

    async def _items(self, basis, card, check_model, model_reason, *, lock_files=False):
        categories, items, comparisons, observations = check_items(basis, card, model_reason)
        references = reference_checks(basis)
        model_ready = supports_check_image(check_model)
        owned = await owned_check_files(self.db, self.project_id,
            {ref.media.file_id for ref in references if ref.media.modality == 'image' and ref.media.file_id} if model_ready else set(),
            lock=lock_files)
        for ref in references:
            file = owned.get(ref.media.file_id)
            if ref.media.modality != 'image':
                reason = '当前参考素材检查未接入此媒体模态'
            elif not ref.media.available or not ref.media.basis_current or not ref.media.file_id:
                reason = '实际采用的参考素材不可用'
            elif not ref.purposes:
                reason = '实际提交中没有可核对的素材用途'
            elif not model_ready:
                reason = model_reason or '所选检查模型未接入图片读取能力'
            else:
                reason = None if file and file.type == 'image' else '实际采用的参考素材不可用'
            items.append(ref.item(card, reason))
            if reason is None:
                observations[ref.item_id] = ref.observation()
        categories.append(describe_category(card, REFERENCE_CATEGORY, items, '未采用具备明确关联要求的参考素材'))
        return categories, items, comparisons, observations

    async def preview(self, canvas_id: str, card_id: str) -> CanvasCheckPreview:
        """读取保存后的当前目标和适用项，不启动模型或写报告。"""
        canvas = await self.store.get(canvas_id)
        card, basis = await self._basis(canvas, card_id)
        if basis is None:
            return CanvasCheckPreview(reason='请连接模型生成卡的生成检查依据')
        check_model, reason = await self._check_model(card)
        categories, items, _, _ = await self._items(basis, card, check_model, reason)
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
        check_model, reason = await self._check_model(card)
        _, items, comparisons, observations = await self._items(basis, card, check_model, reason, lock_files=True)
        selected, omitted = select_check_items(items, request.item_id)
        if not selected:
            unavailable = next((item.reason for item in items if item.id == request.item_id), None)
            raise diagnostic('CHECK_ITEM_UNAVAILABLE', unavailable or '本轮没有所选的可执行检查项', target, blocks=['check'])

        report = CanvasCheckReportRead(id=uuid4().hex, check_card_id=card_id, created_at=datetime.now(UTC),
                                       scope='item' if request.item_id is not None else 'all',
                                       basis=public, items=selected, omitted=omitted,
                                       results=[comparisons[item.id].evaluate() for item in selected if item.id in comparisons],
                                       check_model_id=card.check_model_id,
                                       enabled_item_ids=[item.id for item in items if item.enabled])
        tasks = {}
        if check_model is not None:
            for item in selected:
                if item.id not in observations:
                    continue
                observation = observations[item.id]
                inputs = [('check_reference', 0, observation['file_id'])] if item.category == REFERENCE_CATEGORY else ()
                task = await TaskService(self.db).submit(
                    kind='canvas_check', project_id=self.project_id, target_type=CHECK_REPORT_TARGET, target_id=report.id,
                    title=f'{item.label} · {item.source.card_id}/{item.field_id}', provider_id=check_model.provider_id,
                    expected_target_version=canvas.revision, snapshot={
                        'item_id': item.id, 'execution_config': check_model.model_dump(mode='json'),
                        'observation': observation, 'check_category': item.category,
                    }, inputs=inputs)
                tasks[item.id] = task.id
                report.executions.append(CanvasCheckExecution(item_id=item.id, status='queued'))
        stored = report.model_dump(mode='json')
        if tasks:
            stored['_tasks'] = tasks
        self.db.add(CanvasCheckReport(id=report.id, canvas_id=canvas_id, check_card_id=card_id,
                                      created_at=report.created_at.replace(tzinfo=None), report=stored))
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
        return await self._read_reports(list(rows))

    async def archived_reports(self, canvas_id: str) -> list[CanvasCheckReportRead]:
        """List reports whose original check card is absent from the saved canvas."""
        canvas = await self.store.get(canvas_id)
        document = CanvasDocument.model_validate(canvas.document)
        live = [card.id for card in document.cards if isinstance(card, CheckCard)]
        rows = await self.db.scalars(select(CanvasCheckReport).where(
            CanvasCheckReport.canvas_id == canvas_id, CanvasCheckReport.check_card_id.not_in(live),
        ).order_by(CanvasCheckReport.created_at.desc(), CanvasCheckReport.id.desc()))
        return await self._read_reports(list(rows))

    async def cancel_changed_targets(self, previous: CanvasDocument, current: CanvasDocument) -> None:
        """Called during CAS save with the canvas locked; only original changed targets stop."""
        before = {edge.target_card: edge.source_card for edge in previous.edges if edge.target_port == 'check_basis'}
        after = {edge.target_card: edge.source_card for edge in current.edges if edge.target_port == 'check_basis'}
        changed = {card_id: target for card_id, target in before.items() if after.get(card_id) != target}
        if not changed:
            return
        rows = await self.db.scalars(select(CanvasCheckReport).where(
            CanvasCheckReport.canvas_id == previous.id, CanvasCheckReport.check_card_id.in_(changed),
        ))
        related = [row for row in rows
                   if row.report['basis']['target_card_id'] == changed[row.check_card_id]]
        await self._cancel_tasks(related, '原检查目标已断开或变更')

    async def cancel(self, canvas_id: str, card_id: str, report_id: str) -> CanvasCheckReportRead:
        """Cancel unfinished tasks belonging to the original report only."""
        await self.store.get(canvas_id)
        row = await self.db.scalar(select(CanvasCheckReport).where(
            CanvasCheckReport.canvas_id == canvas_id, CanvasCheckReport.check_card_id == card_id,
            CanvasCheckReport.id == report_id,
        ))
        if row is None:
            raise diagnostic('CHECK_REPORT_NOT_FOUND', '检查报告不存在', {'card_id': card_id}, status=404, blocks=[])
        await self._cancel_tasks([row], '用户取消检查')
        return (await self._read_reports([row]))[0]

    async def _cancel_tasks(self, reports: list[CanvasCheckReport], reason: str) -> None:
        """Request task cancellation in stable order, without acquiring generation locks."""
        targets = {task_id: row.id for row in reports for task_id in row.report.get('_tasks', {}).values()}
        if not targets:
            return
        tasks = await self.db.execute(select(Task.id, Task.target_id).where(
            Task.id.in_(targets), Task.project_id == self.project_id, Task.kind == 'canvas_check',
            Task.target_type == CHECK_REPORT_TARGET, Task.status.not_in(TERMINAL_TASK_STATUSES),
        ).order_by(Task.id))
        service = TaskService(self.db)
        for task_id, report_id in tasks:
            if targets[task_id] == report_id:
                await service.request_cancel(task_id, reason=reason)

    async def _read_reports(self, rows: list[CanvasCheckReport]) -> list[CanvasCheckReportRead]:
        """Project task facts without a canvas lock or copying task-private snapshots."""
        task_ids = {task_id for row in rows for task_id in row.report.get('_tasks', {}).values()}
        tasks = {}
        if task_ids:
            facts = await self.db.execute(select(Task.id, Task.target_id, Task.status, Task.result, Task.error_message,
                                                      Task.cancel_requested_at)
                .where(Task.id.in_(task_ids), Task.project_id == self.project_id, Task.kind == 'canvas_check',
                       Task.target_type == CHECK_REPORT_TARGET))
            tasks = {(fact.target_id, fact.id): fact for fact in facts}
        reports = []
        for row in rows:
            report = CanvasCheckReportRead.model_validate(row.report)
            for execution in report.executions:
                task_id = row.report.get('_tasks', {}).get(execution.item_id)
                fact = tasks.get((report.id, task_id))
                if fact is None:
                    execution.status, execution.reason = 'failed', '检查任务记录不可用'
                else:
                    execution.status, execution.reason = TaskStatus(fact.status).value, fact.error_message
                    execution.cancel_requested = fact.cancel_requested_at is not None
                    if fact.status == TaskStatus.succeeded:
                        report.results.append(CanvasCheckResult.model_validate(fact.result))
            reports.append(report)
        return reports
