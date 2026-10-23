"""实际使用的目标 DAG：受理固定配置，终态只唤起本轮必要后继。"""
from types import SimpleNamespace
from sqlalchemy import delete, select
from fastapi import HTTPException
from pydantic import ValidationError
from app.models.generation_canvas import CanvasRun, CanvasRunNode, CanvasScopeOccupancy
from app.schemas.generation_canvas import CanvasDocument, CanvasNodeRead, CanvasResolvedOutput, ModelCard
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.compiler import prompt_references


async def plan(runtime, canvas, command, *, lock_config=False):
    """只沿实际引用展开；即使生产者在范围内也不准许缺失位置。"""
    from app.services.generation_canvas.runtime import digest
    document = CanvasDocument.model_validate(canvas.document)
    cards = {card.id: card for card in document.cards}
    outputs = await runtime.current_outputs(canvas)
    nodes, diagnostics, reused = {}, [], set()

    async def visit(card_id):
        if card_id in nodes:
            return
        compiled, basis, fingerprint, config = await runtime._basis(canvas, card_id, outputs, lock_config=lock_config)
        dependencies = []
        if command.kind == 'target':
            for item in compiled.used:
                source_id = item.source.card_id
                if isinstance(cards.get(source_id), ModelCard) and not item.basis_current:
                    await visit(source_id)
                    if source_id not in dependencies:
                        dependencies.append(source_id)
        if dependencies:
            compiled.diagnostics = [issue for issue in compiled.diagnostics if issue.code != 'INPUT_STALE']
            compiled.can_run = not any('run' in issue.blocks for issue in compiled.diagnostics)
        diagnostics.extend(compiled.diagnostics)
        for item in compiled.used:
            if item.result_set_id and item.source.card_id not in nodes:
                reused.add(item.result_set_id)
        used_sources = {ref.source.card_id for ref, _ in prompt_references(cards[card_id])}
        nodes[card_id] = {'compiled': compiled, 'basis': basis, 'hash': fingerprint, 'dependencies': dependencies,
            'private': {'document': document.model_dump(), 'revision': canvas.revision,
                'outputs': {key: [item.model_dump() for item in values] for key, values in outputs.items() if key in used_sources},
                'execution_config': config,
                'capability': (await model_capability(runtime.db, cards[card_id].model_id)).model_dump() if config else None}}
    await visit(command.card_id)
    return {'nodes': nodes, 'diagnostics': diagnostics, 'can_run': all(item['compiled'].can_run for item in nodes.values()),
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
    command = GenerationCommand(modality='text', operation='text_chat', delivery='async_polling',
        target=GenerationTarget(kind='canvas_node', entity_id=node.id),
        request=GenerationSubmitRequest(model_id=basis['model']['id'], operation_input=TextChatInput(
            messages=[TextChatMessage(role='user', content=compiled.text, sequence=1)])))
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
