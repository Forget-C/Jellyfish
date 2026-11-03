"""单模型规划与历史运行推进：新请求固定当前模型，已受理依赖按快照执行。"""
from sqlalchemy import delete, select
from fastapi import HTTPException
from pydantic import ValidationError
from app.models.generation_canvas import CanvasRun, CanvasRunNode, CanvasScopeOccupancy
from app.schemas.generation_canvas import CanvasDocument, CanvasNodeRead
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.generation_canvas.execution_basis import digest, restore_basis


async def plan(runtime, canvas, command, *, lock_config=False):
    """只规划当前模型并固定直接输入；保留单节点计划结构供受理与快照消费。"""
    if command.kind != 'single' or command.card_ids:
        from app.services.generation_canvas.errors import diagnostic
        raise diagnostic('SINGLE_MODEL_ONLY', '仅支持从模型编辑区提交当前模型，不支持批量或自动执行上游',
            {'card_id': command.card_id}, blocks=['run'])
    document = CanvasDocument.model_validate(canvas.document)
    for group in document.groups:
        if group.kind == 'stack' and command.card_id in group.card_ids:
            from app.services.generation_canvas.errors import diagnostic
            raise diagnostic('STACK_READ_ONLY', '请先解除堆叠，再提交模型',
                             {'group_id': group.id, 'card_id': command.card_id}, blocks=['run'])
    context = CanvasOutputContext(document)
    outputs = await runtime.current_outputs(canvas, context=context)
    card_id = command.card_id
    basis = await runtime._current_basis(canvas, card_id, outputs, lock_config=lock_config, context=context)
    compiled = basis.compiled
    nodes = {card_id: {'compiled': compiled, 'basis': basis.public_basis, 'hash': basis.basis_hash,
        'dependencies': [], 'private': basis.to_snapshot()}}
    reused = {item.result_set_id for item in compiled.used if item.result_set_id}
    return {'nodes': nodes, 'diagnostics': compiled.diagnostics,
        'can_run': compiled.can_run and not any('run' in issue.blocks for issue in compiled.diagnostics),
        'reused': sorted(reused), 'hash': digest({key: {'hash': item['hash'], 'dependencies': item['dependencies']} for key, item in nodes.items()})}


async def start_node(db, node, producers=None):
    """使用受理快照和本轮成功结果创建真实 Task；不重新解析可变配置。"""
    from app.core.contracts.generation import GenerationCommand, GenerationTarget, GenerationSubmitRequest
    from app.core.contracts.text_generation import TextChatInput, TextChatMessage
    from app.services.generation.gate import GenerationEntityGate
    from app.services.generation.submission.submitter import GenerationSubmitter
    private = node.execution_snapshot
    basis = restore_basis(private, node.card_id,
        {card_id: producers[card_id].outputs for card_id in private['dependencies']})
    compiled = basis.compiled
    if not compiled.can_run:
        raise HTTPException(422, {'code': 'INPUT_VALIDATION_FAILED', 'message': '固定上游结果不满足下游输入要求'})
    node.basis, node.basis_hash = basis.public_basis, basis.basis_hash
    node.status, node.stage = 'queued', 'queued'
    card = basis.card
    modality = card.type.removeprefix('model.')
    if modality == 'text':
        request = GenerationSubmitRequest(model_id=basis.card.model_id, operation_input=TextChatInput(
            messages=[TextChatMessage(role='user', content=compiled.text, sequence=1)]))
    elif modality == 'image':
        from app.core.contracts.generation import ImageGenerationOperationInput
        from app.core.contracts.media import ImageMediaInput, MediaReference
        request = GenerationSubmitRequest(model_id=basis.card.model_id, execution_prompt=compiled.text,
            operation_input=ImageGenerationOperationInput(**card.config.model_dump()),
            media=ImageMediaInput(references=[MediaReference(file_id=item.file_id, media_kind='image', ordinal=index)
                for index, item in enumerate(compiled.media)]))
    else:
        from app.core.contracts.generation import VideoGenerationOperationInput
        request = GenerationSubmitRequest(model_id=basis.card.model_id, execution_prompt=compiled.text,
            operation_input=VideoGenerationOperationInput(**card.config.model_dump()), media=compiled.video_media)
    command = GenerationCommand(modality=modality, operation='text_chat' if modality == 'text' else modality + '_generation',
        delivery='async_polling', target=GenerationTarget(kind='canvas_node', entity_id=node.id), request=request)
    accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, command)
    node.task_id = accepted.task_id
    await db.flush()


async def stop_waiting(db, node, head, status, code, message):
    """无 Task 的节点也必须产生明确终态、事件并释放占用。"""
    from app.services.generation_canvas.runtime import append_event
    node.status, node.stage = status, status
    node.error_code, node.error_message = code, message
    await db.execute(delete(CanvasScopeOccupancy).where(CanvasScopeOccupancy.node_id == node.id))
    await db.flush()
    await append_event(db, head, 'node.finished', node=node, payload={'node': CanvasNodeRead.model_validate(node).model_dump()})


async def advance(db, run_id, head, *, interrupted=False):
    """事件头已锁；只创建新 Task，不取得既有 Task 锁，避免反向死锁。"""
    from app.services.generation_canvas.runtime import TERMINAL, append_event
    nodes = list(await db.scalars(select(CanvasRunNode).where(CanvasRunNode.run_id == run_id).execution_options(populate_existing=True)))
    producers = {node.card_id: node for node in nodes}
    for node in nodes:
        if node.status != 'waiting':
            continue
        dependencies = [producers[card_id] for card_id in node.execution_snapshot['dependencies']]
        if interrupted:
            await stop_waiting(db, node, head, 'blocked', 'FLOW_INTERRUPTED', '画布流程已确认中断，请明确发起新的运行')
        elif any(item.status in TERMINAL and item.status != 'succeeded' for item in dependencies):
            await stop_waiting(db, node, head, 'blocked', 'UPSTREAM_FAILED', '必要上游未成功完成')
        elif all(item.status == 'succeeded' for item in dependencies):
            try:
                async with db.begin_nested():
                    await start_node(db, node, producers)
            except (HTTPException, ValidationError) as exc:
                await db.refresh(node)
                code = 'LEGACY_DESIGN_SNAPSHOT' if isinstance(exc, HTTPException) and isinstance(exc.detail, dict) and exc.detail.get('code') == 'LEGACY_DESIGN_SNAPSHOT' else 'INPUT_VALIDATION_FAILED'
                await stop_waiting(db, node, head, 'failed', code, str(exc))
            else:
                await append_event(db, head, 'node.updated', node=node, payload={'node': CanvasNodeRead.model_validate(node).model_dump()})
    # Failure may have occurred after a follower was visited; cascade to a fixed point.
    changed = True
    while changed:
        changed = False
        for node in nodes:
            if node.status == 'waiting' and any(producers[key].status in TERMINAL and producers[key].status != 'succeeded'
                                               for key in node.execution_snapshot['dependencies']):
                await stop_waiting(db, node, head, 'blocked', 'UPSTREAM_FAILED', '必要上游未成功完成')
                changed = True
    if all(node.status in TERMINAL for node in nodes):
        run = await db.get(CanvasRun, run_id)
        if run.lifecycle != 'finished':
            run.lifecycle = 'finished'
            await append_event(db, head, 'run.finished', run_id=run.id, payload={'run_id': run.id})
