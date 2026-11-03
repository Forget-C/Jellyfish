"""公开引用解析与单次编译边界；候选关系不等于实际输入。"""
import re
from dataclasses import dataclass
from app.core.contracts.generation_canvas import DescriptionTextPayload, SoundDesignFields
from app.core.contracts.media import MediaReference, VideoMediaInput, VideoSubjectMediaReference
from app.schemas.generation_canvas import (
    CanvasDocument, CanvasResolvedOutput, CanvasCompiledInput, CanvasDiagnostic,
    DesignTextPayload, ModelCard, SoundDirectionCard, PerformanceDirectionCard, NamedImageReferenceCard, NamedImagePayload, CanvasSourceMapping, NamedImageMapping, PromptReference, PromptInstruction,
    CanvasModelCapability,
)
from app.services.generation_canvas.capabilities import parameter_diagnostics
from app.services.generation_canvas.output_resolution import CanvasOutputContext, identity_key, prompt_references
from app.services.generation_canvas.reference_rules import reference_name_issue

COMMAND_PORTS = {'首帧参考': 'first_frame', '尾帧参考': 'last_frame', '关键帧参考': 'key_frame', '主体参考': 'subject_image'}

def published_card_outputs(document, card_id, model_outputs=None, *, allow_reference_drafts=False):
    """独立解析入口；操作内复用时直接使用 CanvasOutputContext。"""
    return CanvasOutputContext(document).published_outputs(card_id, model_outputs=model_outputs,
                                                         allow_reference_drafts=allow_reference_drafts)


def resolve_outputs(document: CanvasDocument, card_id: str,
                    model_outputs: dict[str, list[CanvasResolvedOutput]] | None = None, *, allow_reference_drafts=False) -> list[CanvasResolvedOutput]:
    """独立候选入口，保留原调用契约及草稿模式。"""
    return CanvasOutputContext(document).resolve_outputs(card_id, model_outputs=model_outputs,
                                                       allow_reference_drafts=allow_reference_drafts)


def compile_card(document: CanvasDocument, card_id: str, *,
                 model_outputs: dict[str, list[CanvasResolvedOutput]] | None = None,
                 capability: CanvasModelCapability | None = None,
                 context: CanvasOutputContext | None = None) -> CanvasCompiledInput:
    """只遍历本地结构化片段一次，展开内容永不重新解释；保存不要求编译通过。

    显式 context 须绑定传入的同一份 document，且操作期间文档不再修改。"""
    context = context or CanvasOutputContext(document)
    card = context.cards[card_id]
    if not isinstance(card, ModelCard):
        return CanvasCompiledInput(card_id=card_id)
    result = compile_inputs(document.id, card, context.resolve_outputs(card_id, model_outputs=model_outputs), capability)
    for binding in card.input_bindings:
        source = context.cards.get(binding.source.card_id)
        if isinstance(source, NamedImageReferenceCard) and (problem := reference_name_issue(document, source)):
            result.diagnostics.append(CanvasDiagnostic(code=problem[0], message=problem[1], severity='error', target={'card_id': source.id, 'path': ['name']}, blocks=['run']))
    if capability:
        used_ports = {(binding.source.card_id, binding.source.port_id, binding.input_port) for binding in card.input_bindings}
        for edge in context.incoming.get(card_id, ()):
            if edge.target_port not in capability.input_ports:
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
    video = build_video_inputs(card, result.media) if card.type == 'model.video' else None
    def issue(code, message, segment_id, path=None, warning=False):
        result.diagnostics.append(CanvasDiagnostic(code=code, message=message, severity='warning' if warning else 'error',
            target={'card_id': card_id, 'segment_id': segment_id, 'path': path or ['prompt', 'segments', segment_id]}, blocks=[] if warning else ['run']))
    for item in result.used:
        if item.payload and item.payload.kind == 'photography':
            issue('LEGACY_DESIGN_OUTPUT', '旧摄影输出已不受支持，请重新配置独立设计', item.source.card_id)
    for source_id in card.missing_designs:
        issue('DESIGN_BASIS_MISSING', '旧摄影设计已移除，请补充设计或明确处理缺失依据', source_id, ['missing_designs'])
    for ref, path in refs:
        source = by_source.get(identity_key(ref.source))
        if ref.source.canvas_id != canvas_id:
            issue('FOREIGN_CANVAS_REFERENCE', '引用来源属于其他画布，请手动替换', ref.id, path)
        elif source is None:
            issue('SOURCE_NOT_CONNECTED', '引用来源未连接，请手动连接或替换', ref.id, path)
        elif not source.available:
            issue('OUTPUT_MISSING', '引用的来源位置暂无实际输出', ref.id, path)
    def design_text(item):
        # 描述归属只取本次直接采用的载荷，不从命名图片或同名卡片反查正文。
        if isinstance(item.payload, DescriptionTextPayload) and item.payload.name:
            description = item.payload
            identity = '，'.join(value for value in (description.object_id, description.category) if value)
            return f'对象：{description.name}（{identity}）\n{description.text}'
        if isinstance(item.payload, DesignTextPayload) and item.payload.design_type in ('direction.dialogue', 'direction.sound'):
            note = '仅表达可见声源或说话状态；图片不包含声音。' if card.type == 'model.image' else '声音要求按模型实际能力执行；制作安排不代表已生成声音。' if card.type == 'model.video' else ''
            return item.text + ('\n' + note if note else '')
        return item.text
    for item in result.used:
        if isinstance(item.payload, DesignTextPayload):
            for problem in item.payload.reference_issues:
                result.diagnostics.append(CanvasDiagnostic(code=problem.code, message=problem.message, target={'card_id': item.source.card_id, 'segment_id': problem.reference_id, 'path': (['phases', problem.field_id[6:], 'frame', 'document'] if problem.field_id.startswith('phase:') else ['fields', problem.field_id, 'document'])}, blocks=['run']))
            if item.payload.material_references:
                issue('DESIGN_MEDIA_CARRY_NOT_READY', '该设计引用了媒体，接收模型尚未配置素材携带，请处理设计引用后再生成', item.source.card_id)
        target = getattr(item.payload, 'frame_target_state', None)
        if target and not target.available:
            result.diagnostics.append(CanvasDiagnostic(code='DESIGN_FRAME_TARGET_MISSING', message='构图定位的运镜画面已失效，请替换或取消定位', target={'card_id': item.source.card_id, 'path': ['frame_target']}, blocks=['run']))
    for item in result.used:
        if card.type in ('model.image', 'model.video') and isinstance(item.payload, DesignTextPayload):
            design = item.payload
            # 明确没有对白无需虚构说话对象；文本分析允许不完整设计。
            requires_subject = design.design_type in ('direction.situation', 'direction.performance', 'direction.blocking', 'direction.activity') or (design.design_type == 'direction.dialogue' and isinstance(design.fields, SoundDesignFields) and design.fields.content and design.fields.content.state != 'absent')
            if requires_subject and not design.participant_id:
                binding_id = next(binding.id for binding in card.input_bindings if identity_key(binding.source) == identity_key(item.source))
                issue('DESIGN_SUBJECT_REQUIRED', '本次视觉生成所用情境、表演或对白须明确对象', binding_id,
                      ['input_bindings', binding_id])
        media_position = result.media.index(item) + 1 if item in result.media else None
        result.mapping.append(CanvasSourceMapping(token=item.token, source=item.source, media_position=media_position))
    if card.type in ('model.image', 'model.video'):
        for position, item in enumerate(result.media, 1):
            if isinstance(item.payload, NamedImagePayload):
                for obj in item.payload.objects:
                    purposes = [binding for binding in card.input_bindings if identity_key(binding.source) == identity_key(item.source)] if card.type == 'model.video' else [None]
                    for binding in purposes:
                        group, ordinal = video.mapping_locations[binding.id] if binding else (None, None)
                        result.mapping.append(NamedImageMapping(**obj.model_dump(), media_position=position, angle=item.payload.angle,
                            input_port=binding.input_port if binding else None,
                            subject_name=group, purpose_position=ordinal))
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
                    result.text += design_text(item)
                elif card.type == 'model.video':
                    result.text += '@' + video.body_subject_names[identity_key(item.source)] if port in ('subject_image', 'subject_video') else f'[media:{result.media.index(item) + 1}]'
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
            result.text += ('\n' if result.text else '') + design_text(item)

    if card.type in ('model.image', 'model.video'):
        def mapping_line(entry):
            label = f'image {entry.media_position}'
            if entry.input_port == 'subject_image' and entry.subject_name:
                label = f'@{entry.subject_name} 图片 {entry.purpose_position}'
            elif entry.input_port in ('first_frame', 'last_frame', 'key_frame'):
                label = {'first_frame': '首帧', 'last_frame': '尾帧', 'key_frame': f'关键帧 {entry.purpose_position}'}[entry.input_port]
            category = {'character': '人物', 'place': '场所', 'prop': '道具', 'costume': '服装'}[entry.category]
            return f"{category}·{entry.name} = {label}（{entry.angle}" + (f"，{entry.position}" if entry.position else '') + '）'
        lines = [mapping_line(entry) for entry in result.mapping if isinstance(entry, NamedImageMapping)]
        if lines:
            result.text += ('\n' if result.text else '') + '\n'.join(lines)
    if card.type == 'model.image':
        validate_frame_targets(card, result, issue)
    if card.type == 'model.video':
        result.video_media = video.video_media
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
    from app.services.generation_canvas.composition import validate_composition_requirements
    validate_composition_requirements(card, result, issue)
    result.can_run = not any('run' in item.blocks for item in result.diagnostics)
    return result


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
        if binding.input_port in ('subject_image', 'subject_video') and (binding.subject_name or '').strip():
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


def video_media(document: CanvasDocument, card_id: str, compiled: CanvasCompiledInput) -> VideoMediaInput:
    """现有公开编译入口只定位本卡，再交给不持有画布的模型编译器。"""
    card = next(item for item in document.cards if item.id == card_id)
    return build_video_inputs(card, compiled.media).video_media



def validate_frame_targets(card, result, issue):
    """仅接受已采用导演输出声明的目标；自由文字不产生阶段。"""
    used = {identity_key(item.source): item for item in result.used}
    bindings = {binding.id: binding for binding in card.input_bindings}
    targets = {target.binding_id: target for target in card.frame_targets}
    for target in card.frame_targets:
        binding = bindings.get(target.binding_id)
        item = used.get(identity_key(binding.source)) if binding else None
        states = getattr(item.payload, 'frame_states', []) if item else []
        if sum(value.binding_id == target.binding_id for value in card.frame_targets) != 1 or target.state_id not in {state.id for state in states}:
            issue('FRAME_TARGET_MISSING', '画面目标不属于当前已采用的明确状态，请替换或取消', target.binding_id, ['frame_targets', target.binding_id])
        else:
            state = next(state for state in states if state.id == target.state_id)
            result.text += ('\n' if result.text else '') + '画面目标：' + state.label + '（' + state.id + '）'
    for binding in card.input_bindings:
        item = used.get(identity_key(binding.source))
        if item and getattr(item.payload, 'requires_frame_target', False) and binding.id not in targets:
            issue('FRAME_TARGET_REQUIRED', '多状态设计用于单张静帧时请选择画面目标', binding.id, ['frame_targets', binding.id])
