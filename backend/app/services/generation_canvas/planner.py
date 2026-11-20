"""单模型规划与受理：固定当前模型及实际引用的输入。"""
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.generation_canvas.reference_rules import storyboard_reference_warnings


async def plan(current_state, canvas, command, *, lock_config=False):
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
    outputs = await current_state.current_outputs(canvas, context=context)
    card_id = command.card_id
    basis = await current_state.current_basis(canvas, card_id, outputs, lock_config=lock_config, context=context)
    compiled = basis.compiled
    nodes = {card_id: {'compiled': compiled, 'basis': basis.public_basis}}
    reused = {item.result_set_id for item in compiled.used if item.result_set_id}
    diagnostics = compiled.diagnostics + storyboard_reference_warnings(context, basis.card, basis.capability, model_outputs=outputs)
    return {'nodes': nodes, 'diagnostics': diagnostics,
        'can_run': compiled.can_run and not any('run' in issue.blocks for issue in diagnostics),
        'reused': sorted(reused), 'basis': basis}


async def start_node(db, node, basis):
    """使用已固定的单卡输入创建任务。"""
    from app.core.contracts.generation import GenerationCommand, GenerationTarget, GenerationSubmitRequest
    from app.core.contracts.text_generation import TextChatInput, TextChatMessage
    from app.services.generation.gate import GenerationEntityGate
    from app.services.generation.submission.submitter import GenerationSubmitter
    compiled = basis.compiled
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
