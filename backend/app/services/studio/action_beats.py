"""镜头动作拍点辅助服务。

该模块负责对 `ShotDetail.action_beats` 做轻量阶段推断，帮助关键帧与视频链
在不引入复杂结构化模型的前提下，更稳定地区分：

- trigger：触发 / 起始反应
- peak：动作峰值 / 戏剧张力最高阶段
- aftermath：结果态 / 收束阶段
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ActionBeatPhase = Literal["trigger", "peak", "aftermath"]

_TRIGGER_KEYWORDS = (
    "听到",
    "看到",
    "看见",
    "发现",
    "察觉",
    "突然",
    "骤然",
    "刚",
    "开始",
    "初次",
    "异响",
    "咔嚓",
    "响起",
    "推门",
    "转头",
    "回头",
)

_AFTERMATH_KEYWORDS = (
    "呼吸急促",
    "喘",
    "余韵",
    "停留",
    "停住",
    "站定",
    "蹲着",
    "倒在",
    "保持",
    "恢复",
    "看向",
    "余波",
    "收束",
)

_PEAK_KEYWORDS = (
    "脱手",
    "下坠",
    "落地",
    "捂住",
    "捂耳",
    "蹲下",
    "扑",
    "冲",
    "举起",
    "挥",
    "对峙",
    "爆发",
    "僵住",
    "下沉",
)


@dataclass(frozen=True, slots=True)
class ActionBeatPhaseItem:
    """单条动作拍点的阶段推断结果。"""

    text: str
    phase: ActionBeatPhase


def _count_hits(text: str, keywords: tuple[str, ...]) -> int:
    """统计一段文本中命中的阶段关键词数量。"""
    return sum(1 for keyword in keywords if keyword in text)


def _phase_from_position(index: int, total: int) -> ActionBeatPhase:
    """位置兜底（无关键词命中时使用）。

    - 首条 -> trigger
    - 总数 >= 3 时的尾条 -> aftermath
    - 其余 -> peak
    """
    if index == 0:
        return "trigger"
    if total >= 3 and index == total - 1:
        return "aftermath"
    return "peak"


def infer_action_beat_phase(*, text: str, index: int, total: int) -> ActionBeatPhase:
    """为单条动作拍点推断阶段。

    规则优先级：
    1. 明显的 aftermath 关键词
    2. 明显的 trigger 关键词
    3. 明显的 peak 关键词
    4. 按位置兜底：
       - 首条默认 trigger
       - 尾条默认 aftermath（总数 >= 3）
       - 其余默认 peak
    """

    normalized = str(text or "").strip()
    if not normalized:
        return "peak"

    aftermath_hits = _count_hits(normalized, _AFTERMATH_KEYWORDS)
    trigger_hits = _count_hits(normalized, _TRIGGER_KEYWORDS)
    peak_hits = _count_hits(normalized, _PEAK_KEYWORDS)

    if aftermath_hits > 0 and aftermath_hits >= max(trigger_hits, peak_hits):
        return "aftermath"
    if trigger_hits > 0 and trigger_hits >= peak_hits:
        return "trigger"
    if peak_hits > 0:
        return "peak"

    return _phase_from_position(index, total)


def infer_action_beat_sequence(action_beats: list[str] | None) -> list[ActionBeatPhaseItem]:
    """将动作拍点列表转换为带阶段信息的序列。"""
    beats = [str(item).strip() for item in list(action_beats or []) if str(item).strip()]
    total = len(beats)
    return [
        ActionBeatPhaseItem(
            text=text,
            phase=infer_action_beat_phase(text=text, index=index, total=total),
        )
        for index, text in enumerate(beats)
    ]


def pick_action_beat_for_frame(frame_type: str, action_beats: list[str] | None) -> ActionBeatPhaseItem | None:
    """按帧类型挑选最适合作为当前帧主拍点的动作项。"""
    sequence = infer_action_beat_sequence(action_beats)
    if not sequence:
        return None

    if frame_type == "first":
        return next((item for item in sequence if item.phase == "trigger"), sequence[0])
    if frame_type == "last":
        return next((item for item in sequence if item.phase == "aftermath"), sequence[-1])

    peak_items = [item for item in sequence if item.phase == "peak"]
    if peak_items:
        return peak_items[-1]
    return sequence[min(len(sequence) // 2, len(sequence) - 1)]
