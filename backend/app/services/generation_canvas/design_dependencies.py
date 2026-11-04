"""编译采用设计的明确依赖闭包，整卡内容按稳定身份只传递一次。"""
from app.core.contracts.generation_canvas import InputBinding, DesignTextPayload, DesignMediaReference
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.design_references import design_field_references
from app.services.generation_canvas.output_resolution import identity_key, prompt_references


def dependency_sources(card, canvas_id):
    """只追踪实际采用、有效字段引用与完整运镜定位，不收集候选祖先。"""
    yield from (binding.source for binding in getattr(card, 'input_bindings', []))
    yield from (ref.source for ref, _, _ in design_field_references(card, effective=True))
    if getattr(card, 'name_binding', None):
        yield card.name_binding
    target = getattr(card, 'frame_target', None)
    if target:
        from app.core.contracts.generation_canvas import OutputIdentity
        yield OutputIdentity(canvas_id=canvas_id, card_id=target.card_id, port_id='text', position=0)


def design_dependency_inputs(context, card, candidates, model_outputs):
    """按已采用根节点展开设计与具体资产，临时绑定不写回画布或产生连线。"""
    bindings, outputs = list(card.input_bindings), list(candidates)
    selected = {identity_key(ref.source) for ref, _ in prompt_references(card)}
    known = {identity_key(item.source) for item in outputs}
    pending = [item.source.card_id for item in candidates if identity_key(item.source) in selected
               and isinstance(item.payload, DesignTextPayload)]
    visited = set()
    while pending:
        source_id = pending.pop(0)
        if source_id in visited:
            continue
        visited.add(source_id)
        design = context.cards[source_id]
        for source in dependency_sources(design, context.document.id):
            dependency = context.cards.get(source.card_id)
            if not dependency:
                continue  # 保存校验阻止悬空来源；缺失成果仍保留编译诊断占位。
            published = context.published_outputs(source.card_id, model_outputs=model_outputs)
            if dependency.type.startswith('direction.'):
                items = [item for item in published if isinstance(item.payload, DesignTextPayload)]
                pending.append(dependency.id)
            else:
                if dependency.type.startswith('reference.'):
                    pending.append(dependency.id)
                items = [item for item in published if identity_key(item.source) == identity_key(source)]
                if source.port_id == 'object' and dependency.type.startswith(('content.', 'reference.')):
                    items += [item for item in published if item.source.port_id in ('text', 'image')]
            if not items:
                items = [CanvasResolvedOutput(source=source, modality=source.port_id if source.port_id in ('image', 'video', 'audio') else 'text', available=False)]
            for item in items:
                if item.source.port_id == 'object' and not item.available:
                    item = item.model_copy(update={'source': item.source.model_copy(update={'port_id': 'text', 'object_id': None})})
                elif item.source.port_id == 'object':
                    continue  # 身份已在设计关系中表达；描述和固定主图作为完整内容传递。
                if item.modality != 'text':
                    for index, parent in enumerate(outputs):
                        if parent.source.card_id != design.id or not isinstance(parent.payload, DesignTextPayload):
                            continue
                        reference = DesignMediaReference(source=item.source, field_id='relation:' + source.port_id,
                            modality=item.modality, token=item.token, file_id=item.file_id, result_set_id=item.result_set_id,
                            available=item.available, basis_current=item.basis_current, payload=item.payload)
                        references = parent.payload.material_references
                        if not any(identity_key(ref.source) == identity_key(item.source) for ref in references):
                            outputs[index] = parent.model_copy(update={'payload': parent.payload.model_copy(update={'material_references': [*references, reference]})})
                    continue
                key = identity_key(item.source)
                if key not in selected:
                    bindings.append(InputBinding(id='dependency:' + ':'.join(map(str, key)), source=item.source,
                        input_port='text' if item.modality == 'text' else item.modality))
                    selected.add(key)
                if key not in known:
                    outputs.append(item)
                    known.add(key)
    tokens = {identity_key(item.source): '[来源引用：' + item.source.card_id + ']' for item in outputs
              if identity_key(item.source) in selected and item.modality == 'text' and not isinstance(item.payload, DesignTextPayload)}
    rendered = []
    for item in outputs:
        if isinstance(item.payload, DesignTextPayload) and identity_key(item.source) in selected:
            published = context.published_outputs(item.source.card_id, model_outputs=model_outputs, reference_tokens=tokens)
            updated = next((value for value in published if identity_key(value.source) == identity_key(item.source)), item)
            updated = updated.model_copy(update={'token': item.token, 'payload': updated.payload.model_copy(update={'material_references': item.payload.material_references})})
            rendered.append(updated)
        else:
            rendered.append(item)
    return card.model_copy(update={'input_bindings': bindings}), rendered
