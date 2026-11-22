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


def shot_request_matches(text: str, document: CanvasDocument, card_id: str) -> bool:
    """Verify an explicitly numbered shot via saved groups or storyboard identity."""
    references = {_shot_number(match) for match in _SHOT.finditer(text)}
    if not references:
        return True
    if len(references) != 1:
        return False
    number, = references
    named_groups = [group for group in document.groups
                    if (label := _SHOT.fullmatch(group.name.strip())) and _shot_number(label) == number]
    if named_groups:
        return len(named_groups) == 1 and card_id in named_groups[0].card_ids
    if document.storyboard is None or not 1 <= number <= len(document.storyboard.shots):
        return False
    shot = document.storyboard.shots[number - 1]
    return card_id in {shot.card_id, *shot.model_card_ids, *(segment.model_card_id for segment in shot.segments)}
