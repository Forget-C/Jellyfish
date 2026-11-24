"""Preview and apply assistant input adoptions using the normal canvas compiler."""
import hashlib
from uuid import uuid4

from fastapi import HTTPException
from langchain_core.tools import ToolException

from app.core.contracts.generation_canvas import InputBinding
from app.schemas.canvas_assistant_edit import CanvasAssistantChange
from app.schemas.canvas_assistant_structure import VideoInputTarget, VideoTextUse
from app.schemas.generation_canvas import GenerationCanvasEdge, PromptReference, PromptText, VideoModelCard
from app.services.generation_canvas.graph_edit import append_edge
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.compiler import compile_card, published_card_outputs
from app.services.generation_canvas.current_state import CanvasCurrentState
from app.services.generation_canvas.output_resolution import CanvasOutputContext


async def video_input_context(db, canvas, document, ids):
    """Resolve current assets and declared model input ports before running the model."""
    videos = [card for card in document.cards if card.id in ids and isinstance(card, VideoModelCard)]
    capabilities = {}
    for key in {v.model_id for v in videos if v.model_id}:
        try:
            capabilities[key] = await model_capability(db, key)
        except HTTPException as error:
            if error.status_code != 404:
                raise
    outputs = {}
    if videos or any(c.type == 'reference.character' and c.id in ids for c in document.cards):
        outputs = await CanvasCurrentState(db, canvas.project_id).current_outputs(canvas, context=CanvasOutputContext(document))
    return outputs, capabilities


def adopt_video_input(document, use, outputs, capabilities, identity=None):
    """Mutate a tentative document only. Return the same typed preview at approval or a no-op."""
    cards = {card.id: card for card in document.cards}
    source, video = cards.get(use.source_card), cards.get(use.target_card)
    text = isinstance(use, VideoTextUse)
    port = 'text' if text else 'subject_image'
    if not isinstance(video, VideoModelCard) or not source or source.type != ('content.text' if text else 'reference.character'):
        raise ToolException('请选择文本内容卡或角色参考卡，以及接收输入的视频卡。')
    capability = capabilities.get(video.model_id)
    if video.model_id and capability is None:
        raise ToolException('视频卡所选模型不可用，请重新选择模型。')
    if capability and port not in capability.input_ports:
        raise ToolException('当前视频模型不支持该输入用途。')
    output_port = 'text' if text else 'image'
    item = next((o for o in published_card_outputs(document, source.id, outputs)
                 if o.source.port_id == output_port and o.available and o.source.position == (0 if text else use.position)), None)
    if not text and document.storyboard:
        object_id = source.name_binding.object_id if source.name_binding else source.object_id or (source.scene_object_source.object_id if source.scene_object_source else source.id)
        for shot in document.storyboard.shots:
            override = shot.reference_overrides.get(object_id)
            if video.id in shot.model_card_ids and override and override != source.id:
                raise ToolException('该镜头已指定其他角色参考卡，请沿用镜头指定的参考图。')
    if not item or (text and not source.text.strip()):
        raise ToolException('来源卡尚无可用正文或角色图片。')
    subject = None if text else use.subject_name.strip()
    if not text and not subject:
        raise ToolException('请指定角色主体名称。')
    file_id = None if text else item.file_id or item.payload.file_id
    identity = identity or uuid4().hex
    before = compile_card(document, video.id, model_outputs=outputs, capability=capability)
    basis = hashlib.sha256((source.model_dump_json() + video.model_dump_json() + str(file_id)).encode()).hexdigest()
    binding = next((b for b in video.input_bindings if b.source == item.source and b.input_port == port), None)
    if binding and not text and binding.subject_name != subject:
        raise ToolException('此角色图已有其他主体名称，请先确认改绑。')
    segments = video.prompt.segments
    replaced = None
    if text:
        exact = [s for s in segments if isinstance(s, PromptText) and s.text.strip() == source.text.strip()]
        if use.replace_segment_id:
            replaced = next((s for s in segments if s.id == use.replace_segment_id and isinstance(s, PromptText)), None)
            if replaced and replaced.text.strip() != source.text.strip():
                raise ToolException('所选片段还有其他镜头内容，请保留补充并先拆分相同描述。')
            if not replaced and not (binding and any(isinstance(s, PromptReference) and s.binding_id == binding.id for s in segments)):
                raise ToolException('待替换的正文片段已变化。')
        elif len(exact) == 1:
            replaced = exact[0]
        if any(s is not replaced and isinstance(s, PromptText) and source.text.strip() in s.text for s in segments):
            raise ToolException('正文已包含该描述，请指定替换片段并保留镜头补充。')
    anchor = None
    if use.before_segment_id:
        anchor = next((s for s in segments if s.id == use.before_segment_id), None)
        if not anchor or replaced:
            raise ToolException('请选择一个已有片段作为插入位置，或仅指定正文替换位置。')
    changed = not binding
    if not binding:
        binding = InputBinding(id=identity, source=item.source, input_port=port, subject_name=subject, prompt_owned=text)
        video.input_bindings.append(binding)
    if text or anchor:
        mentioned = any(isinstance(s, PromptReference) and s.binding_id == binding.id for s in segments)
        if replaced:
            index = segments.index(replaced)
            segments.pop(index)
            changed = True
        else:
            index = segments.index(anchor) if anchor else len(segments)
        if not mentioned:
            segments.insert(index, PromptReference(id=replaced.id if replaced else identity, kind='reference',
                                                   binding_id=binding.id, source=item.source))
            changed = True
    exists = any((e.source_card, e.source_port, e.target_card, e.target_port) ==
                 (source.id, output_port, video.id, port) for e in document.edges)
    if not exists:
        edge = GenerationCanvasEdge(id=identity, source_card=source.id, source_port=output_port,
                                    target_card=video.id, target_port=port)
        append_edge(document, edge)
        changed = True
    if not changed:
        return None
    if (text or anchor) and video.generated_prompt:
        video.generated_prompt.edit_confirmed = True
    compiled = compile_card(document, video.id, model_outputs=outputs, capability=capability)
    previous_errors = {d.model_dump_json() for d in before.diagnostics if 'run' in d.blocks}
    for diagnostic in compiled.diagnostics:
        if 'run' in diagnostic.blocks and diagnostic.model_dump_json() not in previous_errors:
            raise ToolException(diagnostic.message)
    if not text and not any(group.name == subject and any(media.file_id == file_id for media in group.media)
                            for group in (compiled.video_media.subjects if compiled.video_media else [])):
        raise ToolException('角色图片未能进入该主体的生成输入。')
    return CanvasAssistantChange(card_id=video.id, card_name='视频生成卡', before=before.text, after=compiled.text,
        impact_fingerprint=basis, target=VideoInputTarget(kind='adopt_video_input', use=use, file_id=file_id, adds_edge=not exists, identity=identity))


async def check_video_input(store, canvas, document, edit):
    """Re-resolve media, model and prompt in the approval transaction before accepting a change."""
    target = edit.target
    inputs = await video_input_context(store.db, canvas, document, {target.use.source_card, target.use.target_card})
    try:
        checked = adopt_video_input(document, target.use, *inputs, identity=target.identity)
    except ToolException as error:
        return str(error)
    if checked and checked == edit:
        return None
    return '视频输入或来源已变化，请重新预演。'
