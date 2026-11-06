"""文档保存策略：按原顺序规范化及校验；在调用方事务内读数据库和锁定媒体。"""
from dataclasses import dataclass
from pydantic import ValidationError
from sqlalchemy import select
from app.schemas.generation_canvas import CanvasDocument, ModelCard, SoundDirectionCard, PerformanceDirectionCard, MediaContentCard
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.graph import validate_graph
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.saved_media import SavedMediaReference


@dataclass(frozen=True)
class PreparedDocument:
    """全部校验通过后的文档、累积身份与文件保护清单；不代表已保存。"""
    document: CanvasDocument
    identities: dict[str, str]
    media_references: dict[str, list[SavedMediaReference]]


async def prepare_document(db, project_id: str, canvas, raw_document: dict) -> PreparedDocument:
    """调用方已锁画布并核对回执及 revision；保持首个诊断顺序，不写文档或替换保护。"""
    canvas_id = canvas.id
    try:
        document = CanvasDocument.model_validate(raw_document)
    except ValidationError as exc:
        error = exc.errors()[0]
        raise diagnostic('INVALID_DOCUMENT', error['msg'], {'canvas_id': canvas_id, 'path': list(error['loc'])}) from exc
    if document.id != canvas_id or document.project_id != project_id:
        raise diagnostic('INVALID_IDENTITY', '画布身份不可修改', {'canvas_id': canvas_id})
    previous_document = CanvasDocument.model_validate(canvas.document)
    document, previous_document = _normalize_document(document, previous_document)
    identities = dict(canvas.card_types)
    seen = set()
    for card in document.cards:
        if card.id in seen or (card.id in identities and identities[card.id] != card.type):
            raise diagnostic('INVALID_CARD_IDENTITY', '卡片身份必须唯一且类型不可修改', {'card_id': card.id})
        seen.add(card.id)
        identities[card.id] = card.type
    from app.models.generation_canvas import CanvasScopeOccupancy
    occupied = list(await db.scalars(select(CanvasScopeOccupancy.card_id).where(CanvasScopeOccupancy.canvas_id == canvas_id)))
    if any(card_id not in seen for card_id in occupied):
        raise diagnostic("RUN_SCOPE_BUSY", "活动模型卡不可删除", {"canvas_id": canvas_id}, status=409)
    # Provenance cannot be removed or rewritten by edits to independent content.
    previous_cards = {card['id']: card for card in canvas.document.get('cards', [])}
    object_names = {}
    object_ids = set()
    from app.schemas.generation_canvas import ObjectDescriptionCard, NamedImageReferenceCard
    for card in document.cards:
        if not isinstance(card, ObjectDescriptionCard):
            continue
        previous = previous_cards.get(card.id)
        if previous and previous.get('object_id') and previous['object_id'] != card.object_id:
            raise diagnostic('IMMUTABLE_OBJECT_IDENTITY', '已建立对象的身份不可修改', {'card_id': card.id, 'path': ['object_id']})
        if card.object_id:
            if card.object_id in object_ids:
                raise diagnostic('DUPLICATE_OBJECT_IDENTITY', '独立描述卡不可复用同一对象身份', {'card_id': card.id, 'path': ['object_id']})
            object_ids.add(card.object_id)
        name = card.name.strip()
        if name:
            if (card.type, name) in object_names:
                raise diagnostic('DUPLICATE_OBJECT_NAME', '同一画布内同类型描述名称必须唯一', {'card_id': card.id, 'path': ['name']})
            object_names[(card.type, name)] = card.id
    for card in document.cards:
        origin = getattr(card, 'origin', None)
        previous = previous_cards.get(card.id)
        if previous and previous.get('origin') != (origin.model_dump() if origin else None):
            raise diagnostic('IMMUTABLE_ORIGIN', '已保存内容的历史来源不可修改', {'card_id': card.id, 'path': ['origin']})
        if origin and not previous:
            from app.services.generation_canvas.runtime import CanvasRuntime
            if origin.canvas_id != canvas_id:
                raise diagnostic('INVALID_ORIGIN', '历史来源必须属于当前画布', {'card_id': card.id})
            node = await CanvasRuntime(db, project_id).output_node(canvas_id, origin.run_id, origin.node_id, origin.position)
            output = node.outputs[origin.position]
            if origin.incomplete != (node.status != 'succeeded') or card.type != 'content.' + output['modality'] or (
                output['modality'] == 'text' and card.text != output.get('text')) or (
                output['modality'] != 'text' and card.file_id != output.get('file_id')):
                raise diagnostic('INVALID_ORIGIN', '另存内容须与固定成果及完成状态一致', {'card_id': card.id})
    for card in document.cards:
        target = getattr(card, 'frame_target', None)
        if target and target.card_id in previous_cards and (not any(source.id == target.card_id for source in document.cards) or any(edge['source_card'] == target.card_id and edge['target_card'] == card.id for edge in canvas.document.get('edges', [])) and not any(edge.source_card == target.card_id and edge.target_card == card.id for edge in document.edges)):
            raise diagnostic('REFERENCE_IN_USE', '请先解除构图的运镜关联再删除来源', {'card_id': card.id, 'path': ['frame_target']})
    validate_graph(document, previous_document)
    # 最终文档中的实际引用决定保护；同一次保存清理引用即可断线或删来源。
    from app.services.generation_canvas.compiler import prompt_references
    for receiver in document.cards:
        if not isinstance(receiver, (ModelCard, NamedImageReferenceCard, PerformanceDirectionCard, SoundDirectionCard)):
            continue
        references = [(reference.source, reference.id, path) for reference, path in prompt_references(receiver)] if isinstance(receiver, ModelCard) else [
            (binding.source, binding.id, ['input_bindings', binding.id]) for binding in getattr(receiver, 'input_bindings', [])]
        from app.services.generation_canvas.design_references import design_field_references
        references.extend((ref.source, ref.id, path) for ref, _, path in design_field_references(receiver))
        if isinstance(receiver, NamedImageReferenceCard) and receiver.name_binding:
            references.append((receiver.name_binding, 'name', ['name_binding']))
        if isinstance(receiver, NamedImageReferenceCard) and receiver.image_binding and receiver.image_binding.source:
            references.append((receiver.image_binding.source, 'image', ['image_binding']))
        if isinstance(receiver, (PerformanceDirectionCard, SoundDirectionCard)):
            references.extend((example.source, example.id, ['examples', example.id]) for example in receiver.examples)
        for source, reference_id, path in references:
            was_connected = any(edge['source_card'] == source.card_id and edge['source_port'] == source.port_id
                                and edge['target_card'] == receiver.id for edge in canvas.document.get('edges', []))
            connected = any(edge.source_card == source.card_id and edge.source_port == source.port_id
                            and edge.target_card == receiver.id for edge in document.edges)
            if source.canvas_id == canvas_id and was_connected and not connected:
                raise diagnostic('REFERENCE_IN_USE', '请先清理实际引用再断开或删除来源',
                                 {'card_id': receiver.id, 'segment_id': reference_id, 'path': path})
    previous_edges = {(edge['source_card'], edge['source_port'], edge['target_card'], edge['target_port'])
                      for edge in canvas.document.get('edges', [])}
    by_id = {card.id: card for card in document.cards}
    previous_models = {card['id']: card.get('model_id') for card in canvas.document.get('cards', [])}
    for edge in document.edges:
        endpoint = (edge.source_card, edge.source_port, edge.target_card, edge.target_port)
        card = by_id[edge.target_card]
        # 完整文档不带操作日志；模型已切换时也保留尚未单独保存的候选。
        # 同模型新建连接校验动态能力，实际使用的能力由运行预检再次核实。
        model_changed = card.id in previous_models and isinstance(card, ModelCard) and previous_models[card.id] != card.model_id
        if endpoint not in previous_edges and isinstance(card, ModelCard) and card.model_id and not model_changed:
            cap = await model_capability(db, card.model_id)
            if edge.target_port not in cap.input_ports or card.type != 'model.' + cap.modality:
                raise diagnostic('UNSUPPORTED_INPUT', '所选模型未接入该输入用途',
                                 {'edge_id': edge.id, 'card_id': card.id, 'port_id': edge.target_port})
    from app.services.generation_canvas.output_resolution import CanvasOutputContext
    context = CanvasOutputContext(document)
    from app.services.generation_canvas.saved_media import collect_media_references, validate_media_file
    media_references = collect_media_references(document)
    from app.services.generation_canvas.references import validate_references
    await validate_references(db, document, previous_document.model_dump(), project_id, media_references, context=context)
    if any(isinstance(card, (PerformanceDirectionCard, SoundDirectionCard)) for card in document.cards):
        from app.services.generation_canvas.current_state import CanvasCurrentState
        from app.services.generation_canvas.performance import validate_design_relations, validate_design_examples
        published = await CanvasCurrentState(db, project_id).current_outputs(canvas)
        models = {card.id for card in document.cards if isinstance(card, ModelCard)}
        published = {card_id: values for card_id, values in published.items() if card_id in models}
        from app.services.generation_canvas.spatial import validate_spatial_relations
        from app.services.generation_canvas.narrative import validate_narrative_relations
        from app.services.generation_canvas.guidance import validate_guidance_relations
        validate_guidance_relations(document, published, canvas.document, context=context)
        from app.services.generation_canvas.continuity import validate_constraint_relations
        validate_constraint_relations(document, published, context=context)
        validate_narrative_relations(document, published, canvas.document, context=context)
        validate_spatial_relations(document, published, canvas.document, context=context)
        from app.services.generation_canvas.sound import validate_sound_relations
        validate_sound_relations(document, published, canvas.document, context=context)
        validate_design_relations(document, published, context=context)
        await validate_design_examples(db, document, published, project_id, canvas.document, media_references, context=context)
    # Validate all replacements before releasing existing protection in this transaction.
    for card in document.cards:
        if isinstance(card, MediaContentCard) and card.file_id:
            await validate_media_file(db, project_id, media_references[card.id][0])
    if document.cover_file_id:
        await validate_media_file(db, project_id, media_references[''][0])
    return PreparedDocument(document, identities, media_references)


def _normalize_document(document, previous_document):
    """旧文档只做参考源清理；新文档依次同步来源、采用与设计连线。"""
    from app.services.generation_canvas.stacks import validate_stack_edit
    from app.services.generation_canvas.reference_rules import clean_reference_image_sources
    document = clean_reference_image_sources(document, previous_document)
    previous_document = clean_reference_image_sources(previous_document)
    from app.services.generation_canvas.design_connections import expand_design_source_connections
    document = expand_design_source_connections(document, previous_document)
    from app.services.generation_canvas.acceptance import synchronize_acceptance
    document = synchronize_acceptance(document, previous_document)
    from app.services.generation_canvas.design_connections import synchronize_design_connections
    document = synchronize_design_connections(document, previous_document)
    validate_stack_edit(previous_document.model_dump(), document)
    return document, previous_document
