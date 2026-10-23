"""实际使用的目标 DAG：受理固定配置，终态只唤起本轮必要后继。"""
from types import SimpleNamespace
from sqlalchemy import delete, select
from fastapi import HTTPException
from pydantic import ValidationError
from app.models.generation_canvas import CanvasRun, CanvasRunNode, CanvasScopeOccupancy
from app.schemas.generation_canvas import CanvasDocument, CanvasNodeRead, CanvasResolvedOutput, ModelCard, CanvasDiagnostic
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.compiler import prompt_references


async def plan(runtime, canvas, command, *, lock_config=False):
    """只沿实际引用展开；即使生产者在范围内也不准许缺失位置。"""
    from app.services.generation_canvas.runtime import digest
    document = CanvasDocument.model_validate(canvas.document)
    cards = {card.id: card for card in document.cards}
    outputs = await runtime.current_outputs(canvas)
    nodes, diagnostics, reused = {}, [], set()
    selected = {card.id for card in document.cards if isinstance(card, ModelCard) and card.id in command.card_ids}
    if command.kind == 'selection' and not selected:
        from app.services.generation_canvas.errors import diagnostic
        raise diagnostic('SELECTION_EMPTY', '请至少选择一张模型卡', {'card_id': command.card_id}, blocks=['run'])

    def has_selected_ancestor(card_id, visited=None):
        visited = set() if visited is None else visited
        if card_id in visited or not isinstance(cards.get(card_id), ModelCard):
            return False
        if card_id in selected:
            return True
        visited.add(card_id)
        return any(has_selected_ancestor(ref.source.card_id, visited) for ref, _ in prompt_references(cards[card_id]))

    async def visit(card_id):
        if card_id in nodes:
            return
        compiled, basis, fingerprint, config = await runtime._basis(canvas, card_id, outputs, lock_config=lock_config)
        dependencies = []
        if command.kind in ('target', 'selection'):
            for item in compiled.used:
                source_id = item.source.card_id
                execute = source_id in selected if command.kind == 'selection' else not item.basis_current
                if isinstance(cards.get(source_id), ModelCard) and execute:
                    await visit(source_id)
                    if source_id not in dependencies:
                        dependencies.append(source_id)
                elif command.kind == 'selection' and has_selected_ancestor(source_id):
                    diagnostics.append(CanvasDiagnostic(code='SELECTION_INCOMPLETE',
                        message='所选节点之间缺少必要中间模型，请补选此卡',
                        target={'card_id': source_id, 'consumer_card_id': card_id}, blocks=['run']))
        if dependencies and command.kind == 'target':
            compiled.diagnostics = [issue for issue in compiled.diagnostics if issue.code != 'INPUT_STALE']
            compiled.can_run = not any('run' in issue.blocks for issue in compiled.diagnostics)
        if command.kind == 'selection':
            # Outside the explicit execution scope, only valid published inputs may be reused.
            compiled.diagnostics = [issue for issue in compiled.diagnostics if issue.code != 'INPUT_STALE']
            for item in compiled.used:
                if not item.basis_current and item.source.card_id not in selected:
                    compiled.diagnostics.append(CanvasDiagnostic(code='INPUT_STALE',
                        message='范围外模型结果依据已变，请补选来源或先独立补齐结果',
                        target={'card_id': item.source.card_id, 'consumer_card_id': card_id}, blocks=['run']))
            compiled.can_run = not any('run' in issue.blocks for issue in compiled.diagnostics)
        diagnostics.extend(compiled.diagnostics)
        for item in compiled.used:
            if item.result_set_id and item.source.card_id not in nodes:
                if command.kind != 'selection' or item.source.card_id not in selected:
                    reused.add(item.result_set_id)
        used_sources = {ref.source.card_id for ref, _ in prompt_references(cards[card_id])}
        nodes[card_id] = {'compiled': compiled, 'basis': basis, 'hash': fingerprint, 'dependencies': dependencies,
            'private': {'document': document.model_dump(), 'revision': canvas.revision,
                'outputs': {key: [item.model_dump() for item in values] for key, values in outputs.items() if key in used_sources},
                'execution_config': config,
                'capability': (await model_capability(runtime.db, cards[card_id].model_id)).model_dump() if config else None}}
    if command.kind == 'selection':
        for card in document.cards:
            if card.id in selected:
                await visit(card.id)
    else:
        await visit(command.card_id)
    return {'nodes': nodes, 'diagnostics': diagnostics, 'can_run': all(item['compiled'].can_run for item in nodes.values()) and not any('run' in issue.blocks for issue in diagnostics),
        'reused': sorted(reused), 'hash': digest({key: {'hash': item['hash'], 'dependencies': item['dependencies']} for key, item in nodes.items()})}


async def start_node(db, node, producers=None):
    """使用受理快照和本轮成功结果创建真实 Task；不重新解析可变配置。"""
    from app.core.contracts.generation import GenerationCommand, GenerationTarget, GenerationSubmitRequest
    from app.core.contracts.text_generation import TextChatInput, TextChatMessage
    from app.services.generation.gate import GenerationEntityGate
    from app.services.generation.submission.submitter import GenerationSubmitter
    from app.services.generation_canvas.runtime import CanvasRuntime
    private = node.execution_snapshot
    outputs = {key: [CanvasResolvedOutput.model_validate(item) for item in values] for key, values in private['outputs'].items()}
    for card_id in private['dependencies']:
        producer = producers[card_id]
        # Replace the entire producer output, including missing positions. No old-output fallback.
        outputs[card_id] = [CanvasResolvedOutput.model_validate(item) for item in producer.outputs]
    canvas = SimpleNamespace(document=private['document'], revision=private['revision'])
    compiled, basis, fingerprint, _ = await CanvasRuntime(db, private['document']['project_id'])._basis(
        canvas, node.card_id, outputs, admission=private)
    if not compiled.can_run:
        raise HTTPException(422, {'code': 'INPUT_VALIDATION_FAILED', 'message': '固定上游结果不满足下游输入要求'})
    node.basis, node.basis_hash = basis, fingerprint
    node.status, node.stage = 'queued', 'queued'
    card = next(card for card in CanvasDocument.model_validate(private['document']).cards if card.id == node.card_id)
    modality = card.type.removeprefix('model.')
    if modality == 'text':
        request = GenerationSubmitRequest(model_id=basis['model']['id'], operation_input=TextChatInput(
            messages=[TextChatMessage(role='user', content=compiled.text, sequence=1)]))
    elif modality == 'image':
        from app.core.contracts.generation import ImageGenerationOperationInput
        from app.core.contracts.media import ImageMediaInput, MediaReference
        request = GenerationSubmitRequest(model_id=basis['model']['id'], execution_prompt=compiled.text,
            operation_input=ImageGenerationOperationInput(**card.config.model_dump()),
            media=ImageMediaInput(references=[MediaReference(file_id=item.file_id, media_kind='image', ordinal=index)
                for index, item in enumerate(compiled.media)]))
    else:
        from app.core.contracts.generation import VideoGenerationOperationInput
        request = GenerationSubmitRequest(model_id=basis['model']['id'], execution_prompt=compiled.text,
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
                await stop_waiting(db, node, head, 'failed', 'INPUT_VALIDATION_FAILED', str(exc))
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
