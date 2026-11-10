"""工作台固定帧采用的来源与实际生成用途检查。"""
from app.schemas.generation_canvas import ImageContentCard, ModelCard, VideoModelCard
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.compiler import compile_card
from app.services.generation_canvas.current_state import CanvasCurrentState
from app.services.generation_canvas.errors import diagnostic


def _binding(card, binding_id):
    return next((item for item in card.input_bindings if item.id == binding_id), None) if isinstance(card, VideoModelCard) else None


async def validate_visual_continuity(db, canvas, document, previous, context):
    """仅核实新采用；固定素材独立使用，旧来源失效不改写已保存关系。"""
    storyboard = document.storyboard
    prior = previous.storyboard.visual_continuity if previous.storyboard else {}
    old_cards = {item.id: item for item in previous.cards}
    shot_index = {card_id: index for index, shot in enumerate(storyboard.shots) for card_id in shot.model_card_ids}
    published = None
    for target_id, relation in storyboard.visual_continuity.items():
        target = {'card_id': target_id, 'path': ['input_bindings', relation.binding_id]}
        card = context.cards.get(target_id)
        binding = _binding(card, relation.binding_id)
        if relation == prior.get(target_id) and (not binding or binding == _binding(old_cards.get(target_id), relation.binding_id)):
            continue
        frame = context.cards.get(binding.source.card_id) if binding else None
        origin = frame.frame_origin if isinstance(frame, ImageContentCard) else None
        if not canvas.sequence_id or not origin or not origin.result or not origin.result_set_id:
            raise diagnostic('INVALID_VISUAL_CONTINUITY', '请选择工作台中完整视频成果的画面', target)
        source_index, target_index = shot_index.get(origin.source_card_id), shot_index.get(target_id)
        source_card = context.cards.get(origin.source_card_id)
        if source_index is None or target_index is None or source_index >= target_index or not isinstance(source_card, VideoModelCard):
            raise diagnostic('INVALID_VISUAL_CONTINUITY', '请选择当前画布前序镜头的完整视频帧', target)
        source = binding.source
        if (source.canvas_id, source.port_id, source.position) != (document.id, 'image', 0):
            raise diagnostic('INVALID_VISUAL_CONTINUITY', '承接采用必须指向本画布的固定图片出口', target)
        cap = await model_capability(db, card.model_id) if card.model_id else None
        if not cap or cap.modality != 'video' or binding.input_port not in cap.input_ports:
            raise diagnostic('UNSUPPORTED_INPUT', '当前模型不支持所选承接用途', target)
        if published is None:
            published = await CanvasCurrentState(db, document.project_id).current_outputs(canvas)
        compiled = compile_card(document, target_id, model_outputs={
            key: outputs for key, outputs in published.items() if isinstance(context.cards.get(key), ModelCard)
        }, capability=cap, context=context)
        conflict = next((issue for issue in compiled.diagnostics if issue.code in {
            'UNSUPPORTED_REFERENCE_COMBINATION', 'FRAME_COUNT_EXCEEDED', 'SUBJECT_LIMIT_EXCEEDED',
        }), None)
        if conflict:
            raise diagnostic(conflict.code, conflict.message, target)
        media = compiled.video_media
        role = binding.input_port
        if role == 'subject_image':
            name = (binding.subject_name or '').strip().casefold()
            files = [item.file_id for group in media.subjects for item in group.media
                     if item.media_kind == 'image' and group.name.casefold() == name]
        elif role in ('first_frame', 'last_frame', 'key_frame'):
            frames = {'first_frame': [media.frames.first], 'last_frame': [media.frames.last], 'key_frame': media.frames.keys}
            files = [item.file_id for item in frames[role] if item]
        else:
            files = []
        if frame.file_id not in files:
            raise diagnostic('INVALID_VISUAL_CONTINUITY', '固定帧未进入所选生成用途', target)
