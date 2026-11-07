"""连接语义唯一声明：公开目录和保存校验消费同一份端点策略。"""
from functools import lru_cache

from app.core.contracts.canvas_catalog import CanvasConnectionPolicy


SINGLE_SOURCE_PORTS = {
    'situation': ('participant', 'beat', 'shot'), 'performance': ('participant', 'beat', 'shot'),
    'anchor': ('space', 'participant', 'area_anchor', 'change_event', 'trigger_event'),
    'blocking': ('space', 'participant', 'area_anchor', 'change_event', 'trigger_event'),
    'activity': ('space', 'participant', 'area_anchor', 'change_event', 'trigger_event'),
    'space_rule': ('space', 'participant', 'related_event'), 'continuity': ('space', 'participant', 'related_event'),
    'model.video': ('first_frame', 'last_frame'),
    'dialogue': ('speaker',), 'camera': ('shot',), 'lighting': ('shot',), 'focus': ('shot',), 'movement': ('shot',), 'composition': ('shot',),
}


def single_source_port(card_type, port):
    """单值用途冲突不能按顺序猜选；编辑器明确替换，清理时全部撤回。"""
    return port in SINGLE_SOURCE_PORTS.get(card_type.removeprefix('direction.'), ())


def adoption_allowed(source_type, source_port, target_port):
    """对象候选可供预览；具体业务用途仍要求正确对象类别。"""
    if source_port != 'object':
        return True
    category = source_type.split('.')[-1]
    if target_port == 'space':
        return category == 'place'
    if target_port in ('participant', 'attention_object', 'focus_object'):
        return category in ('character', 'prop', 'costume')
    if target_port == 'speaker':
        return category in ('character', 'prop')
    return True


def connection_policies(cards):
    """白名单只在来源与接收卡之间有唯一兼容用途时直接生效。"""
    policies = []
    for source in cards:
        for target in cards:
            options = [(output.id, port.id) for output in source.outputs for port in target.inputs
                       if output.value_kind in port.accepts
                       and not (target.type.startswith('reference.') and port.id == 'image_source' and source.type != 'content.image')
                       and not (target.type.startswith('reference.') and port.id == 'name' and source.type != target.type.replace('reference.', 'content.'))
                       and not (source.type == 'direction.criterion' and target.type.startswith('direction.') and output.id == 'text')]
            for output, port in options:
                mode = 'candidate'
                if len(options) == 1:
                    if source.type.startswith('direction.') and target.type.startswith('model.') and output == port == 'text':
                        mode = 'adopt_design'
                    elif source.type == 'direction.criterion' and target.type.startswith('direction.') and output == 'criterion' and port == 'acceptance_basis':
                        mode = 'associate_acceptance'
                frame = source.type == 'direction.movement' and target.type == 'direction.composition'
                policies.append(CanvasConnectionPolicy(source_type=source.type, source_port=output, target_type=target.type, target_port=port,
                    adoption_allowed=adoption_allowed(source.type, output, port), connect=mode, cancel='keep_connection' if mode == 'candidate' else 'remove_connection',
                    disconnect='confirm_frame' if frame else 'release' if mode != 'candidate' else 'protect',
                    message={'candidate': '连接提供候选，请明确选择内容和用途', 'adopt_design': '连接即采用完整设计', 'associate_acceptance': '连接即关联验收要求'}[mode]))
    return policies


@lru_cache(maxsize=1)
def _policies():
    from app.services.generation_canvas.catalog import canvas_catalog
    return {(rule.source_type, rule.source_port, rule.target_type, rule.target_port): rule
            for rule in canvas_catalog().connection_policies}


def connection_policy(edge, cards):
    """未知或不兼容的端点没有策略，由图校验报告非法连接。"""
    source, target = cards.get(edge.source_card), cards.get(edge.target_card)
    return _policies().get((source.type, edge.source_port, target.type, edge.target_port)) if source and target else None


@lru_cache(maxsize=None)
def source_connection_policies(source_type, target_type):
    """All static purposes of one source connection, in catalog order."""
    return tuple(rule for (source, _, target, _), rule in _policies().items()
                 if source == source_type and target == target_type)
