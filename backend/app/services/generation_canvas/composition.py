"""独立构图完整发布文字与结构化景别，不推断运镜关联。"""
from app.core.contracts.generation_canvas import DesignTextPayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS

COMPOSITION_LABELS = {'shot_size': '景别', 'composition': '构图重心', 'frame_position': '画面位置', 'depth_layers': '空间层次', 'negative_space': '留白', 'composition_requirements': '构图要求'}
SHOT_SIZE_LABELS = {'extreme_close_up': '大特写', 'close_up': '特写', 'medium': '中景', 'full': '全身', 'wide': '远景', 'extreme_wide': '大远景'}


def publish_composition(canvas_id, card):
    """保留字段状态与结构化景别；空白不虚构设计要求。"""
    lines = []
    for key, value in card.fields:
        text = value.text
        if key == 'shot_size' and value.size:
            text = ' / '.join(filter(None, [SHOT_SIZE_LABELS[value.size], text]))
        if value.state not in ('empty', 'not_applicable') and (text or value.state == 'absent'):
            lines.append(f'{PURPOSE_LABELS[value.purpose]} / {COMPOSITION_LABELS[key]} [{STATE_LABELS[value.state]}]：{text}')
    for label, value in (('适用范围', card.scope.description), ('制作阶段', card.scope.phase), ('适用条件', card.scope.condition), ('来源', card.source_locator)):
        if value:
            lines.append(label + '：' + value)
    if not lines:
        return []
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=card.fields,
                                scope=card.scope, source_locator=card.source_locator)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]
