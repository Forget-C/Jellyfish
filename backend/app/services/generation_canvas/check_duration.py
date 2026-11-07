"""P06 的明确数值分支；自由文字的解释不在本规则内。"""
import re
from decimal import Decimal
from dataclasses import dataclass

from app.core.contracts.generation_canvas import DesignTextPayload, ShotDesignFields
from app.schemas.canvas_checks import CanvasCheckItem, CanvasCheckResult
from app.schemas.generation_canvas import CheckCard, VideoModelCard
from app.services.generation_canvas.execution_basis import CanvasBasis

_DURATION = re.compile(r'(预计|固定|至少|最低)?\s*(\d{1,4}(?:\.\d{1,3})?)\s*秒')
_BOUNDARY = '仅核对同一直接采用镜头的明确时长数值，不预测动作可行性或生成结果。'



@dataclass(frozen=True)
class DurationCheck:
    """可比较的时长依据。读取检查卡只列出项目，显式执行才形成结论。"""
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


def duration_check(basis: CanvasBasis, card: CheckCard) -> DurationCheck | None:
    """只处理直接采用的单一镜头及无条件数值；范围不明留给文字检查。"""
    if not isinstance(basis.card, VideoModelCard) or not basis.card.config.seconds or basis.card.config.seconds < 0:
        return None
    direct = {binding.source.card_id for binding in basis.card.input_bindings
              if binding.input_port == 'text' and binding.source.port_id == 'text'}
    shots = [item for item in basis.compiled.used if item.available and item.source.card_id in direct
             and isinstance(item.payload, DesignTextPayload) and isinstance(item.payload.fields, ShotDesignFields)]
    if len(shots) != 1:
        return None
    source = shots[0]
    scope = source.payload.scope
    if scope.condition or scope.description or scope.phase:
        return None
    field = source.payload.fields.estimated_duration
    if field.state not in ('proposal', 'fact') or field.purpose == 'background':
        return None
    match = _DURATION.fullmatch(field.text.strip())
    if not match:
        return None
    kind, value = match.groups()
    desired = Decimal(value)
    if desired <= 0:
        return None
    hard = kind in ('固定', '至少', '最低')
    if hard and (field.state != 'fact' or field.purpose != 'constraint'):
        return None

    item_id = f'P06:{source.source.card_id}:estimated_duration'
    item = CanvasCheckItem(id=item_id, category='P06', label='明确时长要求匹配', source=source.source,
                          field_id='estimated_duration', requirement=field.text, enabled=item_id not in card.disabled_items)
    return DurationCheck(item=item, kind=kind, expected=desired, actual=basis.card.config.seconds)
