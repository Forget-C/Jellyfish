"""Derive automatic approval from the current user message and locked selection."""

import re

from app.schemas.canvas_assistant_edit import DeleteCardEdit, MovementFieldEdit, ReleaseBindingEdit, VideoPromptSegmentEdit
from app.schemas.generation_canvas import CanvasDocument
from app.services.automatic_approval import ApprovalEffect
from app.services.generation_canvas.assistant_targets import explicit_generation_quantity, shot_request_matches

_AMBIGUOUS = re.compile(r'[?？「」『』“”"`]|不要|别|是否|可以吗|怎么样|如何|如果|能否|例如|比如|建议|'
                        r'\b(?:do not|don.t|should|could|might|if|example|suggest)\b', re.I)
_PREFIX = r'(?:(?:请\s*)?(?:帮我\s*)?|please\s+)'
_DELETE = re.compile(_PREFIX + r'(?:删除|删掉|移除|delete|remove)\s*(.+)', re.I)
_RELEASE = re.compile(_PREFIX + r'(?:解除|取消(?:采用)?|断开|unlink|release|disconnect)\s*(.+)', re.I)
_FIELD = re.compile(_PREFIX + r'(?:(?:把|将).+(?:改|设|换|放慢|加快|缩短|延长|减慢)|'
                    r'(?:修改|改写|调整|更新|替换|放慢|加快|缩短|延长|change|replace|set|slow|update).+)', re.I)
_SPEED = re.compile(r'速度|放慢|加快|减慢|慢一点|快一点|\bspeed\b|\bslower\b|\bfaster\b', re.I)
_PUSH = re.compile(r'推近|推进|推镜|\bpush(?:ing)?\s+in\b', re.I)
_PULL = re.compile(r'拉远|后拉|拉开|\bpull(?:ing)?\s+(?:out|back)\b', re.I)
_MOVEMENT_FIELD_NAMES = {
    'movement_type': '运镜类型', 'movement_start': '运动起点', 'movement_trigger': '运动触发',
    'movement_path': '运动路径', 'movement_speed': '运动速度', 'end_frame': '结束画面',
}
_INPUT_NAMES = {
    'first_frame': '首帧', 'last_frame': '尾帧', 'key_frame': '关键帧', 'text': '文本',
    'subject_image': '主体图', 'subject_video': '主体视频', 'audio': '音频',
}


def automatically_reviewed_change(proposal, group_ids=None):
    """Resolve one safe change in the explicit scope of this automatic decision."""
    if not proposal.groups:
        return proposal if group_ids is None else None
    groups = proposal.groups if group_ids is None else [group for group in proposal.groups if group.id in group_ids]
    if len(groups) != 1 or group_ids is not None and len(group_ids) != 1 or len(groups[0].edits) != 1:
        return None
    return groups[0].edits[0] if groups[0].state == 'pending' else None


def automatic_approval_allowed(text: str, context: dict | None, proposal, document, group_ids=None) -> bool:
    """Authorize one unambiguous change using the user's words, never model output."""
    if not context or _AMBIGUOUS.search(text):
        return False
    change = automatically_reviewed_change(proposal, group_ids)
    if change is None or change.card_id not in context.get('target_card_ids', []):
        return False
    command = text.strip().rstrip('。.!！')
    target = change.target
    if isinstance(target, DeleteCardEdit):
        return _explicit_delete(command, context, change.card_id)
    if context.get('scope') != 'selection' or context.get('target_card_ids') != [change.card_id]:
        return False
    if isinstance(target, ReleaseBindingEdit):
        return _explicit_release(command, context, change.card_id, target.binding_id)
    return _matches_edit_request(change, command, document, context)


def explicit_canvas_effects(text: str, context: dict, document: CanvasDocument,
                            effects: tuple[ApprovalEffect, ...]) -> frozenset[ApprovalEffect]:
    """从可信用户原话及固定指代提取对象、绑定和生成数量均匹配的明确指令。"""
    if _AMBIGUOUS.search(text):
        return frozenset()
    command = text.strip().rstrip('。.!！')
    resolved_ids = context.get('target_card_ids', [])
    generation = explicit_generation_quantity(text)
    approved = set()
    for effect in effects:
        card_id = effect.target_id
        if card_id not in resolved_ids:
            continue
        if effect.kind == 'delete_card' and _explicit_delete(command, context, card_id):
            approved.add(effect)
        if (effect.kind == 'release_binding' and context.get('scope') == 'selection'
                and resolved_ids == [card_id] and _explicit_release(command, context, card_id, effect.binding_id)):
            approved.add(effect)
        if (effect.kind == 'generate' and generation and generation[0] == effect.count
                and context.get('scope') == 'selection'):
            matches = [card.id for card in document.cards if card.id in resolved_ids and card.type.startswith('model.')
                       and shot_request_matches(text, document, card.id)]
            if matches == [card_id]:
                approved.add(effect)
    return frozenset(approved)


def _explicit_delete(command: str, context: dict, card_id: str) -> bool:
    match = _DELETE.fullmatch(command)
    return bool(match and _names_card(match[1], context, card_id))


def _explicit_release(command: str, context: dict, card_id: str, binding_id: str) -> bool:
    match = _RELEASE.fullmatch(command)
    return bool(match and _names_binding(match[1], context, card_id, binding_id))


def _matches_edit_request(change, command, document, context):
    edit = re.split(r'[,，;；。]|并\s*(?=生成)', command, maxsplit=1)[0]
    if not _FIELD.fullmatch(edit) or not shot_request_matches(edit, document, change.card_id):
        return False
    target = change.target
    if isinstance(target, MovementFieldEdit):
        return (_MOVEMENT_FIELD_NAMES[target.field] in edit
                or target.field == 'movement_speed' and bool(_SPEED.search(edit)))
    if not isinstance(target, VideoPromptSegmentEdit) or not re.search(r'提示词|推近|拉远|运镜|\bprompt\b', edit, re.I):
        return False
    if (_PUSH.search(edit) and _PULL.search(change.after)) or (_PULL.search(edit) and _PUSH.search(change.after)):
        return False
    card = next((entry for entry in context['cards'] if entry['id'] == change.card_id), {})
    segments = [segment for segment in card.get('prompt', {}).get('segments', []) if segment['kind'] == 'text']
    if len(segments) == 1:
        return True
    matching = [segment['id'] for segment in segments if any(
        cue in edit and cue in segment.get('text', '') for cue in ('推近', '拉远', '运镜')
    )]
    return matching == [target.segment_id]


def _names_card(value: str, context: dict, card_id: str) -> bool:
    label = value.strip().casefold()
    if context.get('scope') == 'selection' and context['target_card_ids'] == [card_id] and label in {
        '这张卡', '这张卡片', '这张参考卡', '此卡', '所选卡片', 'this card', 'selected card', 'the selected card',
    }:
        return True
    named_cards = [card['id'] for card in context['cards'] if label in {
        card['id'].casefold(), (card.get('name') or '').strip().casefold(),
    }]
    return named_cards == [card_id]


def _names_binding(value: str, context: dict, card_id: str, binding_id: str) -> bool:
    card = next((entry for entry in context['cards'] if entry['id'] == card_id), {})
    bindings = card.get('input_bindings', [])
    binding = next((item for item in bindings if item['id'] == binding_id), None)
    if binding is None:
        return False
    label = value.strip().casefold()
    if label in {binding_id.casefold(), '引用 ' + binding_id.casefold()}:
        return True
    if len(bindings) == 1 and label in {'这条引用', '该引用', '当前引用', 'this reference'}:
        return True
    port = binding['input_port']
    return (_INPUT_NAMES.get(port) and label == _INPUT_NAMES[port] + '引用'
            and sum(item['input_port'] == port for item in bindings) == 1) or False
