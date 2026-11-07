"""P06 的明确数值分支；自由文字的解释不在本规则内。"""
import re
from dataclasses import dataclass
from decimal import Decimal

from app.core.contracts.generation_canvas import DesignTextPayload, ShotDesignFields
from app.schemas.canvas_checks import CanvasCheckItem, CanvasCheckResult
from app.schemas.generation_canvas import CheckCard, VideoModelCard
from app.services.generation_canvas.execution_basis import CanvasBasis

_DURATION = re.compile(r'(预计|固定|至少|最低)?\s*(\d{1,4}(?:\.\d{1,3})?)\s*秒')
_BOUNDARY = '仅核对同一直接采用镜头的明确时长数值，不预测动作可行性或生成结果。'
DURATION_CATEGORY = 'P06'
DURATION_LABEL = '明确时长要求匹配'


@dataclass(frozen=True)
class DurationCheck:
    """可比较的时长依据；显式执行才形成结论。"""
    item: CanvasCheckItem
    kind: str | None
    expected: Decimal
    actual: int

    def evaluate(self) -> CanvasCheckResult:
        """最低时长使用下界，固定和预计时长分别产生问题与风险。"""
        hard = self.kind in ('固定', '至少', '最低')
        matches = self.actual >= self.expected if self.kind in ('至少', '最低') else self.actual == self.expected
        outcome = 'conforming' if matches else 'nonconforming' if hard else 'risk'
        message = f'本次生成 {self.actual} 秒；镜头时长依据：{self.item.requirement}。'
        if not hard:
            message += ' 预计时长作为参考。'
        return CanvasCheckResult(item_id=self.item.id, outcome=outcome, message=message, boundary=_BOUNDARY)


def _comparison(field, scope, seconds, same_scope):
    """同时核实本次秒数、同范围和明确数值；返回不可比较时的原因。"""
    if seconds is None or seconds <= 0:
        return None, '请先填写本次生成时长'
    if not same_scope or scope.condition or scope.description or scope.phase:
        return None, '无法确认镜头时长与本次生成属于同一范围'
    match = _DURATION.fullmatch(field.text.strip())
    if not match or Decimal(match.group(2)) <= 0:
        return None, '没有可直接比较的明确时长数值'
    kind, value = match.groups()
    if kind in ('固定', '至少', '最低') and (field.state != 'fact' or field.purpose != 'constraint'):
        return None, '所填时长尚未声明为明确约束'
    return (kind, Decimal(value), seconds), None


def duration_checks(basis: CanvasBasis, card: CheckCard) -> tuple[list[CanvasCheckItem], dict[str, DurationCheck]]:
    """派生实际采用来源的时长项目；只有同范围的单一镜头允许数值比较。"""
    if not isinstance(basis.card, VideoModelCard):
        return [], {}
    direct = {binding.source.card_id for binding in basis.card.input_bindings
              if binding.input_port == 'text' and binding.source.port_id == 'text'}
    shots = {item.source.card_id: item for item in basis.compiled.used if item.available and item.source.card_id in direct
             and isinstance(item.payload, DesignTextPayload) and isinstance(item.payload.fields, ShotDesignFields)}
    items, comparisons = [], {}
    for source in shots.values():
        field = source.payload.fields.estimated_duration
        if field.state not in ('proposal', 'fact') or field.purpose == 'background' or not field.text.strip():
            continue
        item_id = f'{DURATION_CATEGORY}:{source.source.card_id}:estimated_duration'
        comparison, reason = _comparison(field, source.payload.scope, basis.card.config.seconds, len(shots) == 1)
        item = CanvasCheckItem(id=item_id, category=DURATION_CATEGORY, label=DURATION_LABEL,
                              source=source.source, field_id='estimated_duration', requirement=field.text,
                              enabled=DURATION_CATEGORY in card.enabled_categories and item_id not in card.disabled_items,
                              availability='ready' if comparison else 'unavailable', reason=reason,
                              scope_note=card.scope_notes.get(item_id))
        items.append(item)
        if comparison:
            comparisons[item_id] = DurationCheck(item, *comparison)
    return items, comparisons
