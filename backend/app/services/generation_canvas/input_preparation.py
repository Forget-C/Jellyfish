"""Prepare explicitly declared design media without granting new direct-reference eligibility."""
from dataclasses import dataclass
from app.core.contracts.media import MediaReference, VideoMediaInput, VideoSubjectMediaReference
from app.core.contracts.generation_canvas import DesignMediaOrigin, DesignTextPayload
from app.schemas.generation_canvas import CanvasResolvedOutput, ModelCard, NamedImagePayload, PromptReference
from app.services.generation_canvas.design_references import REFERENCE_DESIGN_TYPES
from app.services.generation_canvas.output_resolution import identity_key, prompt_references


def _design_inputs(context, card, candidates, model_outputs, used_keys, selected):
    """Keep direct candidates separate; merge actual media by stable identity and re-render typed references."""
    if card.type not in ('model.image', 'model.video'):
        return candidates, [], card
    paused = set()
    storyboard = context.document.storyboard
    if card.type == 'model.video' and storyboard and storyboard.visual_continuity.get(card.id):
        from app.services.directing.storyboard_visual_continuity import suspended_subject_sources
        paused = suspended_subject_sources(storyboard, card)
    selected = list(selected)
    order = list(dict.fromkeys(identity_key(binding.source) for binding in card.input_bindings))
    selected.sort(key=lambda item: order.index(identity_key(item.source)) if identity_key(item.source) in order else len(order))
    direct_media = {identity_key(item.source) for item in selected if item.modality != 'text'}
    media = {identity_key(item.source): item for item in selected if item.modality != 'text'}
    known = {identity_key(item.source): item for item in candidates}
    counts = {modality: sum(item.modality == modality for item in candidates) for modality in ('image', 'video', 'audio')}
    for design in selected:
        if not isinstance(design.payload, DesignTextPayload) or design.payload.design_type not in REFERENCE_DESIGN_TYPES:
            continue
        for ref in design.payload.material_references:
            key = identity_key(ref.source)
            if key in paused:
                continue
            if key not in media:
                if key not in known:
                    counts[ref.modality] += 1
                token = known[key].token if key in known else '@' + {'image': '图片', 'video': '视频', 'audio': '音频'}[ref.modality] + str(counts[ref.modality])
                media[key] = CanvasResolvedOutput(source=ref.source, modality=ref.modality, payload=ref.payload,
                    file_id=ref.file_id, result_set_id=ref.result_set_id, available=ref.available,
                    basis_current=ref.basis_current, token=token)
            item = media[key]
            origin = DesignMediaOrigin(source=design.source, field_id=ref.field_id)
            origins = item.design_sources if origin in item.design_sources else [*item.design_sources, origin]
            media[key] = item.model_copy(update={'design_sources': origins, 'basis_current': item.basis_current and ref.basis_current})
    tokens = {key: f'image {position}' for position, key in enumerate(media, 1)}
    if card.type == 'model.video':
        bindings = _effective_video_bindings(card, media.values())
        card = card.model_copy(update={'input_bindings': bindings})
        keyframes = list(dict.fromkeys(identity_key(binding.source) for binding in bindings if binding.input_port == 'key_frame'))
        tokens = {key: ' / '.join(dict.fromkeys(
            ('@' + binding.subject_name.strip() if binding.input_port.startswith('subject_') and (binding.subject_name or '').strip()
             else {'first_frame': '首帧', 'last_frame': '尾帧', 'key_frame': f'关键帧 {keyframes.index(key) + 1}' if key in keyframes else '关键帧'}.get(binding.input_port, '主体分组待配置'))
            for binding in bindings if identity_key(binding.source) == key)) or '素材用途待配置' for key in media}
    if context.whole_designs:
        tokens.update({identity_key(item.source): '[来源引用：' + item.source.card_id + ']' for item in selected if item.modality == 'text' and not isinstance(item.payload, DesignTextPayload)})
    rendered = []
    for candidate in candidates:
        key = identity_key(candidate.source)
        if key in used_keys and isinstance(candidate.payload, DesignTextPayload) and (candidate.payload.material_references or paused):
            outputs = context.published_outputs(candidate.source.card_id, model_outputs=model_outputs,
                reference_tokens=tokens, paused_media=paused)
            updated = next((item for item in outputs if identity_key(item.source) == key), candidate)
            candidate = updated.model_copy(update={'token': candidate.token})
        elif key in media:
            candidate = media[key].model_copy(update={'token': candidate.token})
        rendered.append(candidate)
    return rendered, [item for key, item in media.items() if key not in direct_media], card


def _effective_video_bindings(card, media):
    """只激活实际携带身份的用途，保留同一素材不同用途并去重相同用途。"""
    from app.core.contracts.generation_canvas import InputBinding
    active = {identity_key(item.source) for item in media if item.design_sources}
    bindings = list(card.input_bindings)
    def key(binding):
        return identity_key(binding.source), binding.input_port, (binding.subject_name or '').strip().casefold()
    seen = {key(binding) for binding in bindings}
    for use in card.design_media_uses:
        if identity_key(use.source) not in active or key(use) in seen:
            continue
        seen.add(key(use))
        bindings.append(InputBinding(id='design-use:' + use.id, source=use.source,
                                     input_port=use.input_port, subject_name=use.subject_name))
    return bindings


@dataclass
class VideoInputCompilation:
    """视频计算的内部结果；用途图片位置与 DTO 的混合媒体序号分别保留。"""
    video_media: VideoMediaInput
    body_subject_names: dict[tuple, str]
    mapping_locations: dict[str, tuple[str | None, int]]


def build_video_inputs(card: ModelCard, media: list[CanvasResolvedOutput]) -> VideoInputCompilation:
    """仅消费本卡和实际媒体，统一主体代指、命名图片用途位置及视频 DTO。

    缺失来源仍保留显式名称以参与代指避碰；诊断由外层按原顺序产生。
    """
    source_groups, names = {}, {}
    for binding in card.input_bindings:
        name = (binding.subject_name or '').strip()
        if binding.input_port not in ('subject_image', 'subject_video') or not name:
            continue
        name = names.setdefault(name.casefold(), name)
        groups = source_groups.setdefault(identity_key(binding.source), [])
        if name not in groups:
            groups.append(name)
    subject_ids = {binding.id for binding in card.input_bindings if binding.input_port in ('subject_image', 'subject_video')}
    body_sources = {identity_key(segment.source) for segment in card.prompt.segments if isinstance(segment, PromptReference) and segment.binding_id in subject_ids}
    for position, item in enumerate(media, 1):
        key = identity_key(item.source)
        if key not in body_sources or len(source_groups.get(key, [])) == 1:
            continue
        name = f'media{position}'
        while name.casefold() in names:
            position += 1
            name = f'media{position}'
        names[name.casefold()] = name
        source_groups[key] = [name]
    body_names = {identity_key(item.source): source_groups[identity_key(item.source)][0] for item in media
                  if identity_key(item.source) in body_sources and identity_key(item.source) in source_groups}
    # 映射只覆盖实际命名图片；错误用途也保留位置，交由外层诊断。
    images = {identity_key(item.source) for item in media if item.modality == 'image'}
    named_images = {identity_key(item.source) for item in media if isinstance(item.payload, NamedImagePayload)}
    ordered = {}
    for binding in card.input_bindings:
        if identity_key(binding.source) in images:
            group = (binding.subject_name or '').strip().casefold() if binding.input_port == 'subject_image' else None
            ordered.setdefault((binding.input_port, group), []).append(binding)
    locations = {}
    for binding in card.input_bindings:
        if identity_key(binding.source) not in named_images:
            continue
        port = binding.input_port
        group = (binding.subject_name or '').strip().casefold() if port == 'subject_image' else None
        if port in ('first_frame', 'last_frame'):
            locations[binding.id] = (None, 1)
        elif port == 'subject_image':
            keys = list(dict.fromkeys(identity_key(value.source) for value in ordered[(port, group)]))
            locations[binding.id] = (names.get(group) or None, keys.index(identity_key(binding.source)) + 1)
        else:
            locations[binding.id] = (None, ordered[(port, group)].index(binding) + 1)
    available = {identity_key(item.source): item for item in media}
    result = VideoMediaInput()
    groups, seen = {}, {}
    def reference(ref, ordinal):
        item = available.get(identity_key(ref.source))
        return MediaReference(file_id=item.file_id, media_kind=item.modality, ordinal=ordinal) if item and item.modality in ('image', 'video') else None
    def add_subject(name, refs):
        group = groups.setdefault(name.casefold(), {'name': name, 'media': []})
        for ref in refs:
            key = identity_key(ref.source)
            if key in seen.setdefault(name.casefold(), set()):
                continue
            seen[name.casefold()].add(key)
            media = reference(ref, len(group['media']))
            if media:
                group['media'].append(media)
    for binding in card.input_bindings:
        ref = PromptReference(kind='reference', id=binding.id, source=binding.source)
        frame = reference(ref, len(result.frames.keys) if binding.input_port == 'key_frame' else 0)
        if binding.input_port in ('subject_image', 'subject_video') and binding.source.port_id == binding.input_port.removeprefix('subject_') and (binding.subject_name or '').strip():
            add_subject(binding.subject_name.strip(), [ref])
        if frame and frame.media_kind == 'image':
            if binding.input_port in ('first_frame', 'last_frame'):
                setattr(result.frames, 'first' if binding.input_port == 'first_frame' else 'last', frame)
            elif binding.input_port == 'key_frame':
                result.frames.keys.append(frame)
    for item in media:
        key = identity_key(item.source)
        if key in body_names:
            add_subject(body_names[key], [PromptReference(kind='reference', id='implicit', source=item.source)])
    result.subjects = [VideoSubjectMediaReference(**group) for group in groups.values() if group['media']]
    return VideoInputCompilation(result, body_names, locations)



@dataclass
class PreparedInputs:
    """单次编译事实；候选资格与实际携带素材分别保留，不写回文档。"""
    card: ModelCard
    by_source: dict
    references: list
    used: list[CanvasResolvedOutput]
    media: list[CanvasResolvedOutput]
    video: VideoInputCompilation | None


def prepare_inputs(context, card, candidates, model_outputs) -> PreparedInputs:
    """依赖展开后准备输入；保留视频候选顺序及图片采用顺序。

    原始引用在激活携带用途前固定，携带素材不扩大直接引用资格。
    """
    refs = list(prompt_references(card))
    used_keys = {identity_key(ref.source) for ref, _ in refs}
    selected = [item for item in candidates if identity_key(item.source) in used_keys and item.available]
    candidates, carried, effective_card = _design_inputs(context, card, candidates, model_outputs, used_keys, selected)
    by_source = {identity_key(item.source): item for item in candidates}
    used = [by_source[identity_key(item.source)] for item in selected]
    if card.type == 'model.image':
        order = list(dict.fromkeys(identity_key(binding.source) for binding in card.input_bindings))
        used.sort(key=lambda item: order.index(identity_key(item.source)))
    used.extend(carried)
    media = [item for item in used if item.modality != 'text']
    video = build_video_inputs(effective_card, [item for item in media if item.available and item.file_id]) if card.type == 'model.video' else None
    return PreparedInputs(effective_card, by_source, refs, used, media, video)
