"""公开引用解析与单次编译边界；候选关系不等于实际输入。"""
import re
from app.core.contracts.media import MediaReference, VideoMediaInput, VideoSubjectMediaReference
from app.schemas.generation_canvas import (
    CanvasDocument, CanvasResolvedOutput, CanvasCompiledInput, CanvasDiagnostic,
    ModelCard, NamedImageReferenceCard, NamedImagePayload, CanvasSourceMapping, NamedImageMapping, PromptReference, PromptInstruction,
    CanvasModelCapability, OutputIdentity,
)
from app.services.generation_canvas.capabilities import parameter_diagnostics
from app.services.generation_canvas.outputs import card_outputs

COMMAND_PORTS = {'首帧参考': 'first_frame', '尾帧参考': 'last_frame', '关键帧参考': 'key_frame', '主体参考': 'subject_image'}

LABELS = {'text': '文本', 'image': '图片', 'video': '视频', 'audio': '音频'}


def identity_key(source: OutputIdentity) -> tuple:
    """身份包含来源卡和结果位置，文件 ID 不参与身份。"""
    return source.canvas_id, source.card_id, source.port_id, source.object_id or source.position


def prompt_references(card: ModelCard):
    """正文和指令共享实际引用遍历，返回稳定字段路径。"""
    mentioned = set()
    for segment in card.prompt.segments:
        if isinstance(segment, PromptReference):
            mentioned.add(segment.binding_id)
            yield segment, ['prompt', 'segments', segment.id]
        elif isinstance(segment, PromptInstruction):
            for reference in segment.references:
                mentioned.add(reference.binding_id)
                yield reference, ['prompt', 'segments', segment.id, 'references', reference.id]
    for binding in card.input_bindings:
        if binding.id not in mentioned:
            yield PromptReference(id=binding.id, kind='reference', binding_id=binding.id, source=binding.source), ['input_bindings', binding.id]


def published_card_outputs(document, card_id, model_outputs=None):
    """仅把已采用的直接对象出口交给本卡处理器，按 DAG 逐层解析。"""
    card = next(card for card in document.cards if card.id == card_id)
    adopted = []
    if isinstance(card, NamedImageReferenceCard):
        for binding in card.input_bindings:
            if any(edge.source_card == binding.source.card_id and edge.source_port == binding.source.port_id
                   and edge.target_card == card_id and edge.target_port == binding.input_port for edge in document.edges):
                adopted.extend(item for item in published_card_outputs(document, binding.source.card_id, model_outputs)
                    if identity_key(item.source) == identity_key(binding.source))
    return card_outputs(document.id, card, adopted_inputs=tuple(adopted),
                        published_results=tuple((model_outputs or {}).get(card_id, [])))


def resolve_outputs(document: CanvasDocument, card_id: str,
                    model_outputs: dict[str, list[CanvasResolvedOutput]] | None = None) -> list[CanvasResolvedOutput]:
    """按目标端口顺序发布真实候选；模型当前结果由运行层显式提供。缺失位置仅为已有引用保留。"""
    cards = {card.id: card for card in document.cards}
    receiver = cards.get(card_id)
    retained = [ref.source for ref, _ in prompt_references(receiver)] if isinstance(receiver, ModelCard) else []
    result, seen, counts = [], set(), {}
    edges = {edge.id: edge for edge in document.edges}
    for order in document.input_order.get(card_id, {}).values():
        for edge_id in order:
            edge = edges[edge_id]
            source = cards[edge.source_card]
            outputs = [item for item in published_card_outputs(document, source.id, model_outputs) if item.source.port_id == edge.source_port]
            positions = {item.source.position for item in outputs}
            outputs = list(outputs) + [CanvasResolvedOutput(source=ref, modality=edge.source_port, available=False)
                for ref in retained if ref.canvas_id == document.id and ref.card_id == source.id and ref.port_id == edge.source_port and ref.position not in positions]
            for item in sorted(outputs, key=lambda value: value.source.position):
                key = identity_key(item.source)
                if key in seen:
                    continue
                seen.add(key)
                counts[item.modality] = counts.get(item.modality, 0) + 1
                result.append(item.model_copy(update={'token': '@' + LABELS[item.modality] + str(counts[item.modality])}))
    return result


def compile_card(document: CanvasDocument, card_id: str, *,
                 model_outputs: dict[str, list[CanvasResolvedOutput]] | None = None,
                 capability: CanvasModelCapability | None = None) -> CanvasCompiledInput:
    """只遍历本地结构化片段一次，展开内容永不重新解释；保存不要求编译通过。"""
    card = next(card for card in document.cards if card.id == card_id)
    if not isinstance(card, ModelCard):
        return CanvasCompiledInput(card_id=card_id)
    result = compile_inputs(document.id, card, resolve_outputs(document, card_id, model_outputs), capability)
    if capability:
        used_ports = {(binding.source.card_id, binding.source.port_id, binding.input_port) for binding in card.input_bindings}
        for edge in document.edges:
            if edge.target_card == card_id and edge.target_port not in capability.input_ports:
                used = (edge.source_card, edge.source_port, edge.target_port) in used_ports
                result.diagnostics.append(CanvasDiagnostic(code='UNSUPPORTED_INPUT' if used else 'UNUSED_INCOMPATIBLE_INPUT',
                    message='当前模型不支持此输入用途', severity='error' if used else 'warning',
                    target={'card_id': card_id, 'path': ['edges', edge.id]}, blocks=['run'] if used else []))
    result.can_run = not any('run' in item.blocks for item in result.diagnostics)
    return result


def compile_inputs(canvas_id: str, card: ModelCard, candidates: list[CanvasResolvedOutput],
                   capability: CanvasModelCapability | None = None) -> CanvasCompiledInput:
    """模型编译只接收本卡配置、直接输出与能力，不获得整张画布。"""
    card_id = card.id
    result = CanvasCompiledInput(card_id=card_id)
    by_source = {identity_key(item.source): item for item in candidates}
    refs = list(prompt_references(card))
    used_keys = {identity_key(ref.source) for ref, _ in refs}
    result.used = [item for item in candidates if identity_key(item.source) in used_keys and item.available]
    if card.type == 'model.image':
        # 图片接收端采用顺序独立于候选连线顺序；同一输出身份仅提交一次。
        order = list(dict.fromkeys(identity_key(binding.source) for binding in card.input_bindings))
        result.used.sort(key=lambda item: order.index(identity_key(item.source)))
    result.media = [item for item in result.used if item.modality != 'text']
    def issue(code, message, segment_id, path=None, warning=False):
        result.diagnostics.append(CanvasDiagnostic(code=code, message=message, severity='warning' if warning else 'error',
            target={'card_id': card_id, 'segment_id': segment_id, 'path': path or ['prompt', 'segments', segment_id]}, blocks=[] if warning else ['run']))
    for ref, path in refs:
        source = by_source.get(identity_key(ref.source))
        if ref.source.canvas_id != canvas_id:
            issue('FOREIGN_CANVAS_REFERENCE', '引用来源属于其他画布，请手动替换', ref.id, path)
        elif source is None:
            issue('SOURCE_NOT_CONNECTED', '引用来源未连接，请手动连接或替换', ref.id, path)
        elif not source.available:
            issue('OUTPUT_MISSING', '引用的来源位置暂无实际输出', ref.id, path)
    for item in result.used:
        media_position = result.media.index(item) + 1 if item in result.media else None
        result.mapping.append(CanvasSourceMapping(token=item.token, source=item.source, media_position=media_position))
    if card.type in ('model.image', 'model.video'):
        for position, item in enumerate(result.media, 1):
            if isinstance(item.payload, NamedImagePayload):
                for obj in item.payload.objects:
                    purposes = [binding for binding in card.input_bindings if identity_key(binding.source) == identity_key(item.source)] if card.type == 'model.video' else [None]
                    for binding in purposes:
                        group, ordinal = video_mapping_location(card, binding, result.media) if binding else (None, None)
                        result.mapping.append(NamedImageMapping(**obj.model_dump(), media_position=position, angle=item.payload.angle,
                            input_port=binding.input_port if binding else None,
                            subject_name=group, purpose_position=ordinal))
    subjects = video_subjects(card, result.media) if card.type == 'model.video' else {}
    command_counts = {}
    for segment in card.prompt.segments:
        if segment.kind == 'text':
            result.text += re.sub(r'\\(?=[@/])', '', segment.text)
            if re.search(r'(?<!\\)@(?:文本|图片|视频|音频)\d*', segment.text):
                issue('UNCONFIRMED_REFERENCE', '代号尚未确认或不存在，请选择实际输出', segment.id)
        elif isinstance(segment, PromptReference):
            binding = next((binding for binding in card.input_bindings if binding.id == segment.binding_id), None)
            port = binding.input_port if binding else segment.source.port_id
            if capability and port not in capability.input_ports:
                issue('UNSUPPORTED_INPUT', '当前模型不支持实际使用的输入', segment.id)
            item = by_source.get(identity_key(segment.source))
            if item and item.available:
                if item.modality == 'text':
                    result.text += item.text
                elif card.type == 'model.video':
                    names = subjects.get(identity_key(item.source), [])
                    result.text += '@' + names[0] if port in ('subject_image', 'subject_video') else f'[media:{result.media.index(item) + 1}]'
                else:
                    position = result.media.index(item) + 1
                    result.text += f'image {position}' if capability and capability.modality == 'image' else f'[media:{position}]'
        elif isinstance(segment, PromptInstruction):
            port = COMMAND_PORTS.get(segment.command)
            command_counts[segment.command] = command_counts.get(segment.command, 0) + 1
            if card.type != 'model.video' or not port:
                issue('UNSUPPORTED_INSTRUCTION', '当前卡片不支持此系统指令', segment.id)
            if not segment.references:
                issue('INSTRUCTION_REFERENCE_REQUIRED', '指令缺少实际引用', segment.id)
            if segment.command in ('首帧参考', '尾帧参考') and (command_counts[segment.command] > 1 or len(segment.references) > 1):
                issue('INSTRUCTION_COUNT_EXCEEDED', '首尾帧指令各至多一项', segment.id)
            group_names = {binding.id: (binding.subject_name or '').strip() for binding in card.input_bindings}
            if segment.command == '主体参考' and (any(not group_names.get(ref.binding_id) for ref in segment.references)
                    or not segment.references and not segment.parameters.get('name', '').strip()):
                issue('INSTRUCTION_PARAMETER_REQUIRED', '主体参考缺少主体名称', segment.id)
            for reference in segment.references:
                actual_port = 'subject_video' if port == 'subject_image' and reference.source.port_id == 'video' else port
                if reference.source.port_id not in (('image', 'video') if segment.command == '主体参考' else ('image',)):
                    issue('INSTRUCTION_REFERENCE_TYPE', '指令引用类型不匹配', segment.id, ['prompt', 'segments', segment.id, 'references', reference.id])
                if capability and actual_port not in capability.input_ports:
                    issue('UNSUPPORTED_INPUT', '当前模型不支持此指令用途', segment.id)

    mentioned = {reference.binding_id for segment in card.prompt.segments
        for reference in ([segment] if isinstance(segment, PromptReference) else segment.references if isinstance(segment, PromptInstruction) else [])}
    frame_counts = {}
    for binding in card.input_bindings:
        if card.type == 'model.video' and binding.input_port in ('first_frame', 'last_frame'):
            frame_counts[binding.input_port] = frame_counts.get(binding.input_port, 0) + 1
            if frame_counts[binding.input_port] > 1:
                issue('FRAME_COUNT_EXCEEDED', '首尾帧各至多一项', binding.id, ['input_bindings', binding.id])
        if capability and binding.input_port not in capability.input_ports:
            issue('UNSUPPORTED_INPUT', '当前模型不支持实际使用的输入', binding.id, ['input_bindings', binding.id])
        item = by_source.get(identity_key(binding.source))
        expected = {'text': 'text', 'first_frame': 'image', 'last_frame': 'image', 'key_frame': 'image', 'subject_image': 'image', 'subject_video': 'video'}
        if card.type == 'model.video' and expected.get(binding.input_port) != binding.source.port_id:
            issue('INPUT_BINDING_TYPE', '输入用途与来源类型不匹配，不提供隐式转换', binding.id, ['input_bindings', binding.id])
        if (card.type == 'model.video' and (binding.id not in mentioned or binding.subject_name is not None)
                and binding.input_port in ('subject_image', 'subject_video') and not (binding.subject_name or '').strip()):
            issue('SUBJECT_NAME_REQUIRED', '请选择主体分组名称，不自动归组', binding.id, ['input_bindings', binding.id])
        if binding.id not in mentioned and item and item.available and item.modality == 'text':
            result.text += ('\n' if result.text else '') + item.text

    if card.type in ('model.image', 'model.video'):
        def mapping_line(entry):
            label = f'image {entry.media_position}'
            if entry.input_port == 'subject_image' and entry.subject_name:
                label = f'@{entry.subject_name} 图片 {entry.purpose_position}'
            elif entry.input_port in ('first_frame', 'last_frame', 'key_frame'):
                label = {'first_frame': '首帧', 'last_frame': '尾帧', 'key_frame': f'关键帧 {entry.purpose_position}'}[entry.input_port]
            return f"{entry.name} = {label}（{entry.angle}" + (f"，{entry.position}" if entry.position else '') + '）'
        lines = [mapping_line(entry) for entry in result.mapping if isinstance(entry, NamedImageMapping)]
        if lines:
            result.text += ('\n' if result.text else '') + '\n'.join(lines)
    if card.type == 'model.video':
        result.video_media = compile_video_media(card, result)
        if capability:
            media = result.video_media
            total_videos = sum(ref.media_kind == 'video' for group in media.subjects for ref in group.media)
            for group in media.subjects:
                segment = next((segment for segment in card.prompt.segments if isinstance(segment, PromptInstruction)
                    and segment.parameters.get('name', '').strip().casefold() == group.name.casefold()), None)
                binding = next((binding for binding in card.input_bindings if (binding.subject_name or '').strip().casefold() == group.name.casefold()), None)
                target_id = segment.id if segment else binding.id if binding else next((segment.id for segment in card.prompt.segments
                    if isinstance(segment, PromptReference) and segment.source.port_id in ('image', 'video')), '')
                target_path = ['input_bindings', binding.id] if binding and not segment else None
                if (media.frames.first or media.frames.last or media.frames.keys) and not capability.supports_subject_reference_with_frame_reference:
                    issue('UNSUPPORTED_REFERENCE_COMBINATION', '当前模型不支持主体与帧参考组合', target_id, target_path)
                images = sum(ref.media_kind == 'image' for ref in group.media)
                videos = sum(ref.media_kind == 'video' for ref in group.media)
                limits = ((capability.max_subjects, len(media.subjects)), (capability.max_images_per_subject, images),
                          (capability.max_videos_per_subject, videos), (capability.max_media_per_subject, len(group.media)),
                          (capability.max_total_subject_videos, total_videos))
                if any(limit is not None and count > limit for limit, count in limits):
                    issue('SUBJECT_LIMIT_EXCEEDED', '主体参考数量超出模型限制', target_id, target_path)
    if capability:
        if card.type == 'model.image':
            if capability.max_reference_images is not None and len(result.media) > capability.max_reference_images:
                issue('REFERENCE_COUNT_EXCEEDED', '实际提交图片数量超出模型允许范围', '', ['prompt'])
            files = [item.file_id for item in result.media]
            if not capability.supports_duplicate_reference_images and len(files) != len(set(files)):
                issue('DUPLICATE_MEDIA_UNSUPPORTED', '当前模型不支持不同来源使用同一图片文件', '', ['prompt'])
        result.diagnostics.extend(CanvasDiagnostic.model_validate(item) for item in parameter_diagnostics(card, capability))
    result.can_run = not any('run' in item.blocks for item in result.diagnostics)
    return result


def video_mapping_location(card, binding, media):
    """视频映射按实际用途内的图片顺序定位，候选代号不代表主体组内顺序。"""
    if binding.input_port in ('first_frame', 'last_frame'):
        return None, 1
    available = {identity_key(item.source) for item in media if item.modality == 'image'}
    selected = [value for value in card.input_bindings if value.input_port == binding.input_port and identity_key(value.source) in available]
    group = None
    if binding.input_port == 'subject_image':
        selected = [value for value in selected if (value.subject_name or '').strip().casefold() == (binding.subject_name or '').strip().casefold()]
        group = next((value.subject_name or '').strip() for value in card.input_bindings
            if value.input_port in ('subject_image', 'subject_video') and (value.subject_name or '').strip().casefold() == (binding.subject_name or '').strip().casefold()) or None
    keys = [identity_key(value.source) for value in selected]
    if binding.input_port == 'subject_image':
        keys = list(dict.fromkeys(keys))
    return group, (keys.index(identity_key(binding.source)) if binding.input_port == 'subject_image' else selected.index(binding)) + 1


def video_subjects(card, media):
    """显式主体按名称合并；普通引用的自动代指避开全部显式名称及其他自动代指。"""
    result, names = {}, {}
    for binding in card.input_bindings:
        name = (binding.subject_name or '').strip()
        if binding.input_port not in ('subject_image', 'subject_video') or not name:
            continue
        name = names.setdefault(name.casefold(), name)
        groups = result.setdefault(identity_key(binding.source), [])
        if name not in groups:
            groups.append(name)
    subject_ids = {binding.id for binding in card.input_bindings if binding.input_port in ('subject_image', 'subject_video')}
    body_sources = {identity_key(segment.source) for segment in card.prompt.segments if isinstance(segment, PromptReference) and segment.binding_id in subject_ids}
    for position, item in enumerate(media, 1):
        key = identity_key(item.source)
        if key not in body_sources or len(result.get(key, [])) == 1:
            continue
        name = f'media{position}'
        while name.casefold() in names:
            position += 1
            name = f'media{position}'
        names[name.casefold()] = name
        result[key] = [name]
    return result


def compile_video_media(card: ModelCard, compiled: CanvasCompiledInput) -> VideoMediaInput:
    """把本地用途片段编译为标准视频媒体 DTO；不会解析展开文本。"""
    available = {identity_key(item.source): item for item in compiled.media}
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
        media = reference(ref, len(result.frames.keys) if binding.input_port == 'key_frame' else 0)
        if binding.input_port in ('subject_image', 'subject_video') and (binding.subject_name or '').strip():
            add_subject(binding.subject_name.strip(), [ref])
        if media and media.media_kind == 'image':
            if binding.input_port in ('first_frame', 'last_frame'):
                setattr(result.frames, 'first' if binding.input_port == 'first_frame' else 'last', media)
            elif binding.input_port == 'key_frame':
                result.frames.keys.append(media)
    named = video_subjects(card, compiled.media)
    for item in compiled.media:
        key = identity_key(item.source)
        if key in named and any(isinstance(segment, PromptReference) and identity_key(segment.source) == key
                and any(binding.id == segment.binding_id and binding.input_port in ('subject_image', 'subject_video') for binding in card.input_bindings) for segment in card.prompt.segments):
            add_subject(named[key][0], [PromptReference(kind='reference', id='implicit', source=item.source)])
    result.subjects = [VideoSubjectMediaReference(**group) for group in groups.values() if group['media']]
    return result


def video_media(document: CanvasDocument, card_id: str, compiled: CanvasCompiledInput) -> VideoMediaInput:
    """现有公开编译入口只定位本卡，再交给不持有画布的模型编译器。"""
    card = next(item for item in document.cards if item.id == card_id)
    return compile_video_media(card, compiled)
