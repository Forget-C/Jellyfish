"""公开引用解析与单次编译边界；候选关系不等于实际输入。"""
import re
from app.core.contracts.media import MediaReference, VideoMediaInput, VideoSubjectMediaReference
from app.schemas.generation_canvas import (
    CanvasDocument, CanvasResolvedOutput, CanvasCompiledInput, CanvasDiagnostic,
    ModelCard, PromptReference, PromptInstruction, TextContentCard, MediaContentCard,
    CanvasModelCapability, OutputIdentity,
)
from app.services.generation_canvas.capabilities import parameter_diagnostics

COMMAND_PORTS = {'首帧参考': 'first_frame', '尾帧参考': 'last_frame', '关键帧参考': 'key_frame', '主体参考': 'subject_image'}

LABELS = {'text': '文本', 'image': '图片', 'video': '视频', 'audio': '音频'}


def identity_key(source: OutputIdentity) -> tuple:
    """身份包含来源卡和结果位置，文件 ID 不参与身份。"""
    return source.canvas_id, source.card_id, source.port_id, source.position


def prompt_references(card: ModelCard):
    """正文和指令共享实际引用遍历，返回稳定字段路径。"""
    for segment in card.prompt.segments:
        if isinstance(segment, PromptReference):
            yield segment, ['prompt', 'segments', segment.id]
        elif isinstance(segment, PromptInstruction):
            for reference in segment.references:
                yield reference, ['prompt', 'segments', segment.id, 'references', reference.id]


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
            outputs = []
            if isinstance(source, TextContentCard) and source.text:
                outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=document.id, card_id=source.id, port_id='text', position=0), modality='text', text=source.text)]
            elif isinstance(source, MediaContentCard) and source.file_id and not source.uploading:
                outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=document.id, card_id=source.id, port_id=edge.source_port, position=0), modality=edge.source_port, file_id=source.file_id)]
            elif isinstance(source, ModelCard):
                outputs = (model_outputs or {}).get(source.id, [])
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
    result = CanvasCompiledInput(card_id=card_id)
    if not isinstance(card, ModelCard):
        return result
    candidates = resolve_outputs(document, card_id, model_outputs)
    by_source = {identity_key(item.source): item for item in candidates}
    refs = list(prompt_references(card))
    used_keys = {identity_key(ref.source) for ref, _ in refs}
    result.used = [item for item in candidates if identity_key(item.source) in used_keys and item.available]
    result.media = [item for item in result.used if item.modality != 'text']
    def issue(code, message, segment_id, path=None, warning=False):
        result.diagnostics.append(CanvasDiagnostic(code=code, message=message, severity='warning' if warning else 'error',
            target={'card_id': card_id, 'segment_id': segment_id, 'path': path or ['prompt', 'segments', segment_id]}, blocks=[] if warning else ['run']))
    for ref, path in refs:
        source = by_source.get(identity_key(ref.source))
        if ref.source.canvas_id != document.id:
            issue('FOREIGN_CANVAS_REFERENCE', '引用来源属于其他画布，请手动替换', ref.id, path)
        elif source is None:
            issue('SOURCE_NOT_CONNECTED', '引用来源未连接，请手动连接或替换', ref.id, path)
        elif not source.available:
            issue('OUTPUT_MISSING', '引用的来源位置暂无实际输出', ref.id, path)
    for item in result.used:
        media_position = result.media.index(item) + 1 if item in result.media else None
        result.mapping.append({'token': item.token, 'source': item.source.model_dump(), 'media_position': media_position})
    subjects = video_subjects(card) if card.type == 'model.video' else {}
    command_counts = {}
    used_ports = set()
    for segment in card.prompt.segments:
        if segment.kind == 'text':
            result.text += re.sub(r'\\(?=[@/])', '', segment.text)
            if re.search(r'(?<!\\)@(?:文本|图片|视频|音频)\d*', segment.text):
                issue('UNCONFIRMED_REFERENCE', '代号尚未确认或不存在，请选择实际输出', segment.id)
        elif isinstance(segment, PromptReference):
            port = segment.source.port_id
            if card.type == 'model.video' and port in ('image', 'video'):
                port = 'subject_' + port
            used_ports.add((segment.source.card_id, segment.source.port_id, port))
            if capability and port not in capability.input_ports:
                issue('UNSUPPORTED_INPUT', '当前模型不支持实际使用的输入', segment.id)
            item = by_source.get(identity_key(segment.source))
            if item and item.available:
                if item.modality == 'text':
                    result.text += item.text
                elif card.type == 'model.video':
                    names = subjects.get(identity_key(item.source), [])
                    result.text += '@' + (names[0] if len(names) == 1 else f'media{result.media.index(item) + 1}')
                else:
                    result.text += f'[media:{result.media.index(item) + 1}]'
        elif isinstance(segment, PromptInstruction):
            port = COMMAND_PORTS.get(segment.command)
            command_counts[segment.command] = command_counts.get(segment.command, 0) + 1
            if card.type != 'model.video' or not port:
                issue('UNSUPPORTED_INSTRUCTION', '当前卡片不支持此系统指令', segment.id)
            if not segment.references:
                issue('INSTRUCTION_REFERENCE_REQUIRED', '指令缺少实际引用', segment.id)
            if segment.command in ('首帧参考', '尾帧参考') and (command_counts[segment.command] > 1 or len(segment.references) > 1):
                issue('INSTRUCTION_COUNT_EXCEEDED', '首尾帧指令各至多一项', segment.id)
            if segment.command == '主体参考' and not segment.parameters.get('name', '').strip():
                issue('INSTRUCTION_PARAMETER_REQUIRED', '主体参考缺少主体名称', segment.id)
            for reference in segment.references:
                actual_port = 'subject_video' if port == 'subject_image' and reference.source.port_id == 'video' else port
                used_ports.add((reference.source.card_id, reference.source.port_id, actual_port))
                if reference.source.port_id not in (('image', 'video') if segment.command == '主体参考' else ('image',)):
                    issue('INSTRUCTION_REFERENCE_TYPE', '指令引用类型不匹配', reference.id)
                if capability and actual_port not in capability.input_ports:
                    issue('UNSUPPORTED_INPUT', '当前模型不支持此指令用途', segment.id)

    if card.type == 'model.video' and capability:
        groups = {}
        for segment in card.prompt.segments:
            if not isinstance(segment, PromptInstruction) or segment.command != '主体参考':
                continue
            name = segment.parameters.get('name', '').strip().casefold()
            groups.setdefault(name, []).extend(segment.references)
            if any(command_counts.get(command) for command in ('首帧参考', '尾帧参考', '关键帧参考')) and not capability.supports_subject_reference_with_frame_reference:
                issue('UNSUPPORTED_REFERENCE_COMBINATION', '当前模型不支持主体与帧参考组合', segment.id)
            references = groups[name]
            images = sum(ref.source.port_id == 'image' for ref in references)
            videos = sum(ref.source.port_id == 'video' for ref in references)
            limits = ((capability.max_subjects, len(groups)), (capability.max_images_per_subject, images),
                      (capability.max_videos_per_subject, videos), (capability.max_media_per_subject, len(references)),
                      (capability.max_total_subject_videos, sum(ref.source.port_id == 'video' for refs_ in groups.values() for ref in refs_)))
            if any(limit is not None and count > limit for limit, count in limits):
                issue('SUBJECT_LIMIT_EXCEEDED', '主体参考数量超出模型限制', segment.id)
    if capability:
        result.diagnostics.extend(CanvasDiagnostic.model_validate(item) for item in parameter_diagnostics(card, capability))
        for edge in document.edges:
            if edge.target_card == card_id and edge.target_port not in capability.input_ports:
                used = (edge.source_card, edge.source_port, edge.target_port) in used_ports
                issue('UNSUPPORTED_INPUT' if used else 'UNUSED_INCOMPATIBLE_INPUT', '当前模型不支持此输入用途', '',
                      ['edges', edge.id], warning=not used)
    if card.type == 'model.video':
        result.video_media = video_media(document, card_id, result)
    result.can_run = not any('run' in item.blocks for item in result.diagnostics)
    return result


def video_subjects(card):
    """显式名称按不区分大小写合并；素材可同时归属多个人物。"""
    result, names = {}, {}
    for segment in card.prompt.segments:
        if isinstance(segment, PromptInstruction) and segment.command == '主体参考':
            name = segment.parameters.get('name', '').strip()
            if not name:
                continue
            name = names.setdefault(name.casefold(), name)
            for reference in segment.references:
                groups = result.setdefault(identity_key(reference.source), [])
                if name not in groups:
                    groups.append(name)
    return result


def video_media(document: CanvasDocument, card_id: str, compiled: CanvasCompiledInput) -> VideoMediaInput:
    """把本地用途片段编译为标准视频媒体 DTO；不会解析展开文本。"""
    card = next(card for card in document.cards if card.id == card_id)
    available = {identity_key(item.source): item for item in compiled.media}
    result = VideoMediaInput()
    groups = {}
    def reference(ref, ordinal):
        item = available.get(identity_key(ref.source))
        return MediaReference(file_id=item.file_id, media_kind=item.modality, ordinal=ordinal) if item and item.modality in ('image', 'video') else None
    def add_subject(name, refs):
        group = groups.setdefault(name.casefold(), {'name': name, 'media': []})
        for ref in refs:
            media = reference(ref, len(group['media']))
            if media:
                group['media'].append(media)
    for segment in card.prompt.segments:
        if not isinstance(segment, PromptInstruction):
            continue
        refs = segment.references
        if segment.command == '主体参考':
            name = segment.parameters.get('name', '').strip()
            if name:
                add_subject(name, refs)
        elif segment.command in ('首帧参考', '尾帧参考') and refs:
            media = reference(refs[0], 0)
            if media and media.media_kind == 'image':
                setattr(result.frames, 'first' if segment.command == '首帧参考' else 'last', media)
        elif segment.command == '关键帧参考':
            for ref in refs:
                media = reference(ref, len(result.frames.keys))
                if media and media.media_kind == 'image':
                    result.frames.keys.append(media)
    named = video_subjects(card)
    for item in compiled.media:
        key = identity_key(item.source)
        if any(isinstance(segment, PromptReference) and identity_key(segment.source) == key for segment in card.prompt.segments) and len(named.get(key, [])) != 1:
            add_subject(f'media{compiled.media.index(item) + 1}', [PromptReference(kind='reference', id='implicit', source=item.source)])
    result.subjects = [VideoSubjectMediaReference(**group) for group in groups.values() if group['media']]
    return result
