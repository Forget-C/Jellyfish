"""风格输出仅来自本卡字段，不传递示例媒体。"""
from app.core.contracts.generation_canvas import DesignTextPayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.formatting import design_field_line

STYLE_LABELS = {'direction': '风格方向', 'visual_features': '视觉特征', 'materials': '材质倾向', 'colors': '色彩倾向', 'notes': '自定义说明'}


def publish_style(canvas_id, card):
    """风格保持完整设计与字段状态；空和不适用不变成生成要求。"""
    lines = [design_field_line(STYLE_LABELS[key], value, source=False)
             for key, value in card.fields if value.state not in ('empty', 'not_applicable') and (value.text or value.state == 'absent')]
    if card.scope.description:
        lines.append('适用范围：' + card.scope.description)
    if card.scope.phase:
        lines.append('制作阶段：' + card.scope.phase)
    if card.scope.condition:
        lines.append('适用条件：' + card.scope.condition)
    if card.source_locator:
        lines.append('来源：' + card.source_locator)
    if not lines:
        return []
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=card.fields,
                                scope=card.scope, source_locator=card.source_locator)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]
