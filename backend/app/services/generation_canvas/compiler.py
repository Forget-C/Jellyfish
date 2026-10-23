"""公开引用解析与单次编译边界；候选关系不等于实际输入。"""
import re
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
            if segment.command == '主体参考' and not segment.parameters.get('name'):
                issue('INSTRUCTION_PARAMETER_REQUIRED', '主体参考缺少主体名称', segment.id)
            for reference in segment.references:
                actual_port = 'subject_video' if port == 'subject_image' and reference.source.port_id == 'video' else port
                used_ports.add((reference.source.card_id, reference.source.port_id, actual_port))
                if reference.source.port_id not in (('image', 'video') if segment.command == '主体参考' else ('image',)):
                    issue('INSTRUCTION_REFERENCE_TYPE', '指令引用类型不匹配', reference.id)
                if capability and actual_port not in capability.input_ports:
                    issue('UNSUPPORTED_INPUT', '当前模型不支持此指令用途', segment.id)

    if capability:
        result.diagnostics.extend(CanvasDiagnostic.model_validate(item) for item in parameter_diagnostics(card, capability))
        for edge in document.edges:
            if edge.target_card == card_id and edge.target_port not in capability.input_ports:
                used = (edge.source_card, edge.source_port, edge.target_port) in used_ports
                issue('UNSUPPORTED_INPUT' if used else 'UNUSED_INCOMPATIBLE_INPUT', '当前模型不支持此输入用途', '',
                      ['edges', edge.id], warning=not used)
    result.can_run = not any('run' in item.blocks for item in result.diagnostics)
    return result
