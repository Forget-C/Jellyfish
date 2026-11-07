"""Task 事实到画布成果的事务结算；运行受理和历史调度不属于此模块。"""
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import CanvasRunNode, CanvasCurrentOutput, CanvasResultSet, GenerationCanvas
from app.schemas.generation_canvas import CanvasDocument, CanvasNodeRead, CanvasResolvedOutput, OutputIdentity
from app.services.generation_canvas.events import TERMINAL, event_head, append_event
from app.services.generation_canvas.node_completion import finish_node
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.generation_canvas.current_state import CanvasCurrentState


async def sync_task_fact(db: AsyncSession, task, *, delta: str | None = None):
    """Task 已锁定并写事实后调用；覆盖所有真实终态，不能自行提交或发网络请求。"""
    if task.target_type != 'canvas_node':
        return
    node = await db.get(CanvasRunNode, task.target_id, populate_existing=True)
    if node is None:
        return
    head = await event_head(db, node.canvas_id)
    if node.status in TERMINAL:
        return
    node.status, node.stage, node.progress = task.status, task.stage, task.progress
    if task.cancel_requested_at is not None and node.status not in TERMINAL:
        node.stage = 'cancelling'
    node.error_code, node.error_message = task.error_code, task.error_message
    if delta:
        node.text += delta
    terminal = node.status in TERMINAL
    if terminal:
        if task.result and isinstance(task.result.get('text'), str):
            node.text = task.result['text']
        if node.text:
            node.outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=node.canvas_id, card_id=node.card_id,
                port_id='text', position=0), modality='text', text=node.text).model_dump()]
        if task.kind in ('image_generation', 'video_generation'):
            from app.models.task import TaskOutput
            from app.services.studio.file_usages import upsert_file_usage
            modality = 'image' if task.kind == 'image_generation' else 'video'
            outputs = list(await db.scalars(select(TaskOutput).where(TaskOutput.task_id == task.id).order_by(TaskOutput.ordinal)))
            node.outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=node.canvas_id, card_id=node.card_id,
                port_id=modality, position=item.ordinal), modality=modality, file_id=item.file_id).model_dump() for item in outputs]
            for item in outputs:
                await upsert_file_usage(db, file_id=item.file_id, project_id=task.project_id, chapter_id=None,
                    usage_kind='canvas_history', source_ref=f'{node.canvas_id}:{node.id}:{item.ordinal}')
        if node.status == 'succeeded':
            result = CanvasResultSet(id=uuid4().hex, canvas_id=node.canvas_id, node_id=node.id, card_id=node.card_id,
                basis=node.basis, basis_hash=node.basis_hash, outputs=node.outputs)
            db.add(result)
            node.result_set_id = result.id
            node.outputs = [{**item, 'result_set_id': result.id} for item in node.outputs]
            result.outputs = node.outputs
            await db.flush()
            from app.services.generation_canvas.automatic_checks import enqueue_automatic_checks
            await enqueue_automatic_checks(db, node, task.project_id)
            canvas = await db.get(GenerationCanvas, node.canvas_id, populate_existing=True)
            current_state = CanvasCurrentState(db, canvas.project_id)
            try:
                context = CanvasOutputContext(CanvasDocument.model_validate(canvas.document))
                basis = await current_state.current_basis(canvas, node.card_id,
                    await current_state.current_outputs(canvas, context=context), context=context)
                can_publish = basis.compiled.can_run and basis.basis_hash == node.basis_hash
            except HTTPException:
                can_publish = False
            if can_publish:
                pointer = await db.get(CanvasCurrentOutput, (node.canvas_id, node.card_id))
                if pointer:
                    pointer.result_set_id = result.id
                else:
                    db.add(CanvasCurrentOutput(canvas_id=node.canvas_id, card_id=node.card_id, result_set_id=result.id))
                node.current_output_updated = True
    await db.flush()
    payload = {'node': CanvasNodeRead.model_validate(node).model_dump()}
    if terminal and node.current_output_updated:
        # Publication also changes downstream validity; the shared stream must
        # carry that authoritative view without executing those downstream cards.
        payload['current_outputs'] = {key: [item.model_dump() for item in values]
            for key, values in (await current_state.current_outputs(canvas)).items()}
    if delta:
        payload.update(delta=delta, position=0)
    if terminal:
        await finish_node(db, node, head, payload=payload)
        from app.services.generation_canvas.planner import advance
        await advance(db, node.run_id, head, interrupted=task.error_code in ('execution_interrupted', 'submission_interrupted'))
    else:
        await append_event(db, head, 'text.delta' if delta else 'node.updated', node=node, payload=payload)

