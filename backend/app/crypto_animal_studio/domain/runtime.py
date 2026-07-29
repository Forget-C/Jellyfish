"""运行时长派生（domain 层，纯函数）。

唯一的时长真相来源：由镜头时长与（追加式）fact card 派生。
``output.*_ms`` 只是可选断言，永不覆盖派生值。

取整策略只有一种：**round_half_up**（四舍五入、遇 .5 远离零），通过本模块的显式 helper
应用；**不得**依赖 Python 内建 ``round()``（银行家取整）。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable

#: 断言与派生值之间允许的最大偏差（毫秒）；恰好等于 50 ms 视为通过。
RUNTIME_ASSERTION_TOLERANCE_MS: int = 50

#: fact card 计入总时长的 placement 取值。
FACT_CARD_PLACEMENT_APPENDED: str = "append_after_shots"


def round_half_up(value: float | int | Decimal) -> int:
    """把秒数换算后的数值按 round-half-up 取整为整数。

    参数：
        value: 待取整的数值（通常是 ``seconds * 1000``）。
    返回：
        整数（.5 一律远离零进位，例如 0.5→1、-0.5→-1）。
    存在意义：
        Python 内建 ``round()`` 使用银行家取整，会让 ``.5`` 边界结果与规范不一致。
    """
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def seconds_to_ms(seconds: float | int | Decimal) -> int:
    """秒 → 整数毫秒（round-half-up）。"""
    return round_half_up(Decimal(str(seconds)) * 1000)


@dataclass(slots=True)
class DerivedRuntime:
    """派生出的权威时长信息。"""

    generated_ms: int
    fact_card_ms: int
    total_ms: int
    per_shot_ms: tuple[int, ...]


def derive_runtime(shots: Iterable[Any], fact_card: Any | None = None) -> DerivedRuntime:
    """派生权威时长。

    参数：
        shots: 具备 ``duration_seconds`` 的镜头序列（顺序不影响求和）。
        fact_card: 可选 fact card 对象，需具备 ``duration_ms`` 与 ``placement``。
    返回：
        ``DerivedRuntime``：各镜头毫秒、生成footage毫秒、fact card 计入毫秒、总毫秒。
    规则：
        - 每个镜头**单独**应用 round_half_up 后再求和；
        - 仅当 placement 为追加式时，fact card 才计入总时长。
    """
    per_shot = tuple(seconds_to_ms(shot.duration_seconds) for shot in shots)
    generated_ms = sum(per_shot)

    fact_card_ms = 0
    if fact_card is not None:
        placement = getattr(fact_card, "placement", FACT_CARD_PLACEMENT_APPENDED)
        if placement == FACT_CARD_PLACEMENT_APPENDED:
            fact_card_ms = int(getattr(fact_card, "duration_ms", 0) or 0)

    return DerivedRuntime(
        generated_ms=generated_ms,
        fact_card_ms=fact_card_ms,
        total_ms=generated_ms + fact_card_ms,
        per_shot_ms=per_shot,
    )


__all__ = [
    "round_half_up",
    "seconds_to_ms",
    "derive_runtime",
    "DerivedRuntime",
    "RUNTIME_ASSERTION_TOLERANCE_MS",
    "FACT_CARD_PLACEMENT_APPENDED",
]
