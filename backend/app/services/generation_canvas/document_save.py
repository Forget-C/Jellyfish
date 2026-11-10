"""文档保存策略：按原顺序规范化及校验；在调用方事务内读数据库和锁定媒体。"""
from dataclasses import dataclass
from typing import Any
from pydantic import ValidationError
from sqlalchemy import select
from app.core.contracts.task import TaskStatus
from app.schemas.generation_canvas import CanvasDocument, CanvasResultScope, CheckCard, ModelCard, SoundDirectionCard, PerformanceDirectionCard, MediaContentCard
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.graph import validate_graph
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.saved_media import SavedMediaReference


@dataclass(frozen=True)
class PreparedDocument:
    """全部校验通过后的文档、累积身份与文件保护清单；不代表已保存。"""
    document: CanvasDocument
    previous_document: CanvasDocument
    identities: dict[str, str]
    media_references: dict[str, list[SavedMediaReference]]
    detached_proofs: dict[str, dict[str, Any]]


async def prepare_document(db, project_id: str, canvas, raw_document: dict, *, scene_sources: dict | None = None) -> PreparedDocument:
    """调用方已锁画布并核对回执及 revision；保持首个诊断顺序，不写文档或替换保护。"""
    canvas_id = canvas.id
    try:
        document = CanvasDocument.model_validate(raw_document)
    except ValidationError as exc:
        error = exc.errors()[0]
        raise diagnostic('INVALID_DOCUMENT', error['msg'], {'canvas_id': canvas_id, 'path': list(error['loc'])}) from exc
    if document.id != canvas_id or document.project_id != project_id:
        raise diagnostic('INVALID_IDENTITY', '画布身份不可修改', {'canvas_id': canvas_id})
    for card in document.cards:
        if isinstance(card, CheckCard) and card.id not in canvas.card_types and 'enabled_categories' not in card.model_fields_set:
            from app.services.generation_canvas.check_selection import initial_check_categories
            card.enabled_categories = initial_check_categories()
    previous_document = CanvasDocument.model_validate(canvas.document)
    _validate_fixed_source(previous_document, document, scene_sources)
    document, previous_document = _normalize_document(document, previous_document)
    await _mark_storyboard_edits(db, document)
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
    from app.services.generation_canvas.historical_content import CanvasHistoricalContent
    from app.services.generation_canvas.video_frames import validate_video_frame_origin
    history = CanvasHistoricalContent(db, project_id)
    for card in document.cards:
        previous = previous_cards.get(card.id)
        await history.validate_origin(canvas_id, card, previous, (canvas.detached_proofs or {}).get(card.id))
        validate_video_frame_origin(canvas_id, card, previous)
    for card in document.cards:
        target = getattr(card, 'frame_target', None)
        if target and target.card_id in previous_cards and (not any(source.id == target.card_id for source in document.cards) or any(edge['source_card'] == target.card_id and edge['target_card'] == card.id for edge in canvas.document.get('edges', [])) and not any(edge.source_card == target.card_id and edge.target_card == card.id for edge in document.edges)):
            raise diagnostic('REFERENCE_IN_USE', '请先解除构图的运镜关联再删除来源', {'card_id': card.id, 'path': ['frame_target']})
    validate_graph(document, previous_document)
    detached_proofs, moved_sources = await history.validate_detached_results(
        document, previous_document, canvas.detached_proofs,
    )
    from app.services.generation_canvas.result_positions import known_result_positions
    scoped_edges = [edge for edge in document.edges if edge.result_scope]
    if scoped_edges:
        known = await known_result_positions(db, canvas_id, {edge.source_card for edge in scoped_edges})
        for edge in scoped_edges:
            if not set(edge.result_scope.positions) <= known.get((edge.source_card, edge.source_port), set()):
                raise diagnostic('INVALID_RESULT_SCOPE', '结果范围包含未发布的输出位置',
                                 {'edge_id': edge.id, 'card_id': edge.target_card, 'port_id': edge.target_port})
    # 最终文档中的实际引用决定保护；同一次保存清理引用即可断线或删来源。
    from app.services.generation_canvas.compiler import prompt_references
    for receiver in document.cards:
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
            def same_source(edge, identity=source, target_id=receiver.id):
                return edge.source_card == identity.card_id and edge.source_port == identity.port_id and edge.target_card == target_id

            was_connected = any(same_source(edge) and edge.includes_position(source.position)
                                for edge in previous_document.edges)
            matching = [edge for edge in document.edges if same_source(edge)]
            connected = any(edge.includes_position(source.position) for edge in matching)
            if source.canvas_id == canvas_id and (was_connected or matching) and not connected:
                raise diagnostic('REFERENCE_IN_USE', '请先清理实际引用再断开或删除来源',
                                 {'card_id': receiver.id, 'segment_id': reference_id, 'path': path})
    previous_pairs = {(edge['source_card'], edge['target_card']) for edge in canvas.document.get('edges', [])}
    previous_scopes = {(edge.source_card, edge.source_port, edge.target_card): edge.result_scope
                       for edge in previous_document.edges if edge.result_scope}
    endpoint = lambda edge: (edge.source_card, edge.source_port, edge.target_card, edge.target_port)
    previous_edges = {endpoint(edge): edge for edge in previous_document.edges}
    next_edges = {endpoint(edge): edge for edge in document.edges}
    fixed_ids = {result.content_card_id for card in document.cards if isinstance(card, ModelCard)
                 for result in card.detached_results}
    former_fixed = {result.content_card_id for card in previous_document.cards if isinstance(card, ModelCard)
                    for result in card.detached_results} - fixed_ids
    restored_slots = {}
    for edge in previous_document.edges:
        proof = detached_proofs.get(edge.source_card) if edge.source_card in former_fixed else None
        if proof and endpoint(edge) not in next_edges and [edge.target_card, edge.target_port] in proof['routes']:
            original = (proof['model_id'], edge.source_port, edge.target_card, edge.target_port)
            restored_slots.setdefault(original, set()).add(proof['position'])
    by_id = {card.id: card for card in document.cards}
    new_pairs = {}
    for edge in document.edges:
        pair = (edge.source_card, edge.target_card)
        source = moved_sources.get(edge.source_card)
        if source and source['port_id'] == edge.source_port:
            original = (source['card_id'], source['port_id'], edge.target_card, edge.target_port)
            prior, remaining = previous_edges.get(original), next_edges.get(original)
            position = source['position']
            # 保留旧用途的候选，不借固定操作扩大不兼容模型的输入范围。
            if prior and prior.includes_position(position) and not (remaining and remaining.includes_position(position)):
                proof = detached_proofs[edge.source_card]
                route = [edge.target_card, edge.target_port]
                if route not in proof['routes']:
                    proof['routes'] = [*proof['routes'], route]
                continue
        key = endpoint(edge)
        if key in restored_slots and _restores_only_moved_slots(previous_edges.get(key), edge.result_scope, restored_slots[key]):
            continue
        previous_scope = previous_scopes.get((edge.source_card, edge.source_port, edge.target_card))
        if pair not in previous_pairs or (previous_scope and _expands_result_scope(previous_scope, edge.result_scope)):
            new_pairs.setdefault(pair, []).append(edge)
    capabilities = {}

    async def supports(model_id, card, edges):
        if model_id not in capabilities:
            capabilities[model_id] = await model_capability(db, model_id)
        cap = capabilities[model_id]
        return card.type == 'model.' + cap.modality and any(edge.target_port in cap.input_ports for edge in edges)

    for (_, target_id), edges in new_pairs.items():
        card = by_id[target_id]
        if not isinstance(card, ModelCard) or not card.model_id or await supports(card.model_id, card, edges):
            continue
        # 一次保存可包含连线后切换模型，旧模型支持该来源时保留已建立的候选。
        prior_model = previous_cards.get(target_id, {}).get('model_id')
        if prior_model and prior_model != card.model_id and await supports(prior_model, card, edges):
            continue
        raise diagnostic('UNSUPPORTED_INPUT', '所选模型未接入该来源的任何输入用途',
                         {'edge_id': edges[0].id, 'card_id': target_id, 'port_id': edges[0].target_port})
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
    if document.storyboard and document.storyboard.visual_continuity:
        from app.services.directing.storyboard_visual_continuity import validate_visual_continuity
        await validate_visual_continuity(db, canvas, document, previous_document, context)
    return PreparedDocument(document, previous_document, identities, media_references, detached_proofs)


def _expands_result_scope(previous: CanvasResultScope, current: CanvasResultScope | None) -> bool:
    """与旧范围比较新增可用位置，包括尚未生成的未来结果。"""
    if current is None:
        return True
    if previous.mode == 'only':
        return current.mode == 'except' or bool(set(current.positions) - set(previous.positions))
    if current.mode == 'only':
        return bool(set(current.positions) & set(previous.positions))
    return bool(set(previous.positions) - set(current.positions))


def _restores_only_moved_slots(previous, current: CanvasResultScope | None, positions: set[int]) -> bool:
    """撤销可补回经证明的旧位置，但不能扩大到额外位置或未来输出。"""
    if previous is None:
        return bool(current and current.mode == 'only' and set(current.positions) <= positions)
    scope = previous.result_scope
    if scope is None:
        return True
    if scope.mode == 'only':
        return bool(current and current.mode == 'only' and set(current.positions) <= set(scope.positions) | positions)
    still_excluded = set(scope.positions) - positions
    if current is None:
        return not still_excluded
    if current.mode == 'only':
        return not still_excluded.intersection(current.positions)
    return still_excluded <= set(current.positions)


async def _mark_storyboard_edits(db, document: CanvasDocument) -> None:
    """以已应用任务的原始卡片判断人工修改，撤销到原样可恢复未修改状态。"""
    storyboard = document.storyboard
    if not storyboard:
        return
    from app.models.task import Task
    task = await db.get(Task, storyboard.task_id)
    if (not task or task.kind != 'directing_storyboard' or task.status != TaskStatus.succeeded
            or task.project_id != document.project_id):
        return
    baseline = (task.result or {}).get('document', {})
    if baseline.get('id') != document.id:
        return
    original = {card['id']: card for card in baseline.get('cards', ())}
    for card in document.cards:
        origin = storyboard.origins.get(card.id)
        if origin and card.id in original:
            origin.manually_edited = original[card.id] != card.model_dump(mode='json')


def fixed_source_state(document: CanvasDocument) -> dict:
    """Exact fixed evidence that can be authorized by a scoped application receipt."""
    sources = [source for source in [document.fixed_source, *document.archived_sources] if source]
    ids = {source.card_id for source in sources}
    return {'fixed_source': document.fixed_source.model_dump(mode='json') if document.fixed_source else None,
            'archived_sources': [source.model_dump(mode='json') for source in document.archived_sources],
            'cards': {card.id: card.model_dump(mode='json') for card in document.cards if card.id in ids}}


def _validate_fixed_source(previous: CanvasDocument, current: CanvasDocument, scene_sources: dict | None) -> None:
    """Ordinary saves must retain the exact fixed evidence and its identity."""
    expected = scene_sources if scene_sources is not None else fixed_source_state(previous)
    if fixed_source_state(current) == expected:
        return
    source = previous.fixed_source or current.fixed_source
    raise diagnostic('FIXED_SOURCE_IMMUTABLE', '固定原文不可修改或删除',
                     {'card_id': source.card_id} if source else {'canvas_id': current.id})


def _normalize_document(document, previous_document):
    """旧文档只做参考源清理；新文档依次同步来源、采用与设计连线。"""
    from app.services.generation_canvas.stacks import validate_stack_edit
    from app.services.generation_canvas.reference_rules import clean_reference_image_sources
    document = clean_reference_image_sources(document, previous_document)
    previous_document = clean_reference_image_sources(previous_document)
    from app.services.generation_canvas.design_connections import expand_source_connections
    document = expand_source_connections(document, previous_document)
    from app.services.generation_canvas.acceptance import synchronize_acceptance
    document = synchronize_acceptance(document, previous_document)
    from app.services.generation_canvas.design_connections import synchronize_design_connections
    document = synchronize_design_connections(document, previous_document)
    edges = {edge.id for edge in document.edges}
    previous_anchors = {edge.id: edge.order_anchor for edge in previous_document.edges if edge.order_anchor}
    for edge in document.edges:
        if edge.order_anchor and edge.order_anchor.edge_id not in edges and previous_anchors.get(edge.id) == edge.order_anchor:
            edge.order_anchor = None
    validate_stack_edit(previous_document.model_dump(), document)
    return document, previous_document
