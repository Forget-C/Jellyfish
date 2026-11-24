"""Anchor named shot instructions to the saved canvas scope."""

import re

from app.schemas.generation_canvas import CanvasDocument

_SHOT = re.compile(r'(?:第\s*(?P<ordinal>[\d一二两三四五六七八九十]+)\s*(?:个)?镜头|'
                   r'镜头\s*(?:第\s*)?(?P<label>[\d一二两三四五六七八九十]+)|'
                   r'\bshot\s+(?P<english>[0-9]+)\b)', re.I)
_DIGITS = dict(zip('一二三四五六七八九', range(1, 10))) | {'两': 2}


def _shot_number(match) -> int:
    label = next(value for value in match.groups() if value is not None)
    if label.isdecimal():
        return int(label)
    if '十' in label:
        first, _, rest = label.partition('十')
        return 10 * _DIGITS.get(first, 1) + _DIGITS.get(rest, 0)
    return _DIGITS.get(label, 0)


def _shot_cards(document: CanvasDocument, number: int) -> set[str]:
    groups = [group for group in document.groups
              if (label := _SHOT.fullmatch(group.name.strip())) and _shot_number(label) == number]
    if groups:
        return set(groups[0].card_ids) if len(groups) == 1 else set()
    if document.storyboard is None or not 1 <= number <= len(document.storyboard.shots):
        return set()
    shot = document.storyboard.shots[number - 1]
    return {shot.card_id, *shot.model_card_ids, *(segment.model_card_id for segment in shot.segments)}


def named_shot_cards(text: str, document: CanvasDocument) -> set[str] | None:
    """Return literal shot targets, or None when any explicit shot is unresolved."""
    targets: set[str] = set()
    for match in _SHOT.finditer(text):
        cards = _shot_cards(document, _shot_number(match))
        if not cards:
            return None
        targets.update(cards)
    return targets


def shot_request_matches(text: str, document: CanvasDocument, card_id: str) -> bool:
    """Verify one explicitly numbered shot via saved groups or storyboard identity."""
    references = {_shot_number(match) for match in _SHOT.finditer(text)}
    return not references or len(references) == 1 and card_id in _shot_cards(document, next(iter(references)))


_CHINESE_REQUEST = re.compile(
    r'(?:请|帮我|给我)?(?:再)?生成\s*(?P<count>[1-9][0-9]?|[一二两三四五六七八九]?十[一二三四五六七八九]?'
    r'|[一二两三四五六七八九])\s*(?:个)?(?:版|版本|次)'
    r'(?:[，,。；;]\s*(?:再|完成后|生成后)(?:帮我)?(?P<review>(?:看看|看|复看|审看|点评|检查)[^？?]*))?[。！!]?'
)
_ENGLISH_REQUEST = re.compile(
    r'(?:please )?(?:re)?generate (?P<count>[1-9][0-9]?|one|two|three) versions?[.!]?', re.IGNORECASE,
)
_EDIT_PREFIX = re.compile(r'^(?:请|帮我)?(?:先)?(?:把|将|改|修改|改写|调整|更新|优化|改好后|修改后|调整后|更新后)')
_AFTER_EDIT = ('改好后', '修改后', '调整后', '更新后')


def explicit_generation_quantity(text: str) -> tuple[int, bool, str | None] | None:
    """Match a bounded imperative and optional edit prerequisite in the user turn."""
    if any(mark in text for mark in ('「', '『', '“', '”', '"', '`', '？', '?')):
        return None
    request = text.strip()
    waits_for_edit = request.startswith(_AFTER_EDIT)
    if waits_for_edit:
        ending = next(prefix for prefix in _AFTER_EDIT if request.startswith(prefix))
        request = request.removeprefix(ending).lstrip('，, ')
    else:
        split = re.search(r'(?:[，,、；;。]\s*|(?:改好|修改|调整|更新)后\s*|并\s*)(?:然后|并)?\s*'
                          r'(?=(?:请|帮我|给我|再)?生成)', request)
        if split and _EDIT_PREFIX.match(request):
            prefix = request[:split.start()]
            if any(word in prefix for word in ('生成', '不要', '别', '是否', '能否', '例如', '比如', '如果')):
                return None
            waits_for_edit = True
            request = request[split.end():]
    match = _CHINESE_REQUEST.fullmatch(request) or _ENGLISH_REQUEST.fullmatch(request)
    if match is None:
        return None
    count = match['count'].lower()
    review = match.groupdict().get('review')
    if count.isascii() and count.isdecimal():
        quantity = int(count)
    elif count in ('one', 'two', 'three'):
        quantity = ('one', 'two', 'three').index(count) + 1
    elif '十' in count:
        tens, units = count.split('十')
        quantity = 10 * _DIGITS.get(tens, 1) + _DIGITS.get(units, 0)
    else:
        quantity = _DIGITS[count]
    return quantity, waits_for_edit, review
