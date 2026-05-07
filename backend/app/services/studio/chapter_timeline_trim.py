"""章节时间线裁剪：毫秒坐标解析与校验（PUT 保存与 FFmpeg 导出共用）。

约定：
- ``trim_start_ms`` / ``trim_end_ms`` 均为可选；**皆为 None 表示使用镜头成片全长**。
- 只要至少一端非空，即进入裁剪语义：**入点毫秒 inclusive，出点毫秒 exclusive**， playable 区间为 ``[start_ms, end_ms)``。
- 某一端为 None 时：入点默认 0，出点默认源成片时长（毫秒）。
"""

from __future__ import annotations

# ffprobe duration 与毫秒取整之间的允许误差（毫秒）
_DURATION_MS_SLACK = 2


def source_duration_ms_from_seconds(duration_s: float) -> int:
    """将 ffprobe format.duration 转为毫秒（四舍五入），用于与 trim 坐标对齐。"""
    if duration_s <= 0:
        return 0
    return max(0, int(round(float(duration_s) * 1000)))


def resolve_effective_trim_ms(
    source_duration_ms: int,
    trim_start_ms: int | None,
    trim_end_ms: int | None,
) -> tuple[int, int] | None:
    """若双 None 表示全长，返回 None；否则返回 ``(start_ms, end_ms)``（左闭右开）。"""
    if trim_start_ms is None and trim_end_ms is None:
        return None
    start_ms = 0 if trim_start_ms is None else int(trim_start_ms)
    end_ms = source_duration_ms if trim_end_ms is None else int(trim_end_ms)
    return start_ms, end_ms


def validate_effective_trim_ms(
    source_duration_ms: int,
    effective: tuple[int, int],
    *,
    shot_id: str,
) -> None:
    """校验裁剪区间落在 ``[0, source_duration_ms]``（出点允许 slack）内且长度为正。"""
    start_ms, end_ms = effective
    if start_ms < 0 or end_ms < 0:
        msg = f"裁剪毫秒不可为负: shot_id={shot_id}"
        raise ValueError(msg)
    if start_ms >= end_ms:
        msg = f"裁剪入点必须小于出点: shot_id={shot_id} start_ms={start_ms} end_ms={end_ms}"
        raise ValueError(msg)
    if end_ms > source_duration_ms + _DURATION_MS_SLACK:
        msg = (
            f"裁剪出点超出成片时长: shot_id={shot_id} end_ms={end_ms} "
            f"source_duration_ms={source_duration_ms}"
        )
        raise ValueError(msg)
    if start_ms > source_duration_ms + _DURATION_MS_SLACK:
        msg = (
            f"裁剪入点超出成片时长: shot_id={shot_id} start_ms={start_ms} "
            f"source_duration_ms={source_duration_ms}"
        )
        raise ValueError(msg)


def is_lossless_compatible_trim(
    source_duration_ms: int,
    trim_start_ms: int | None,
    trim_end_ms: int | None,
) -> bool:
    """无损拼接仅接受全长片段（不允许实质裁剪）。"""
    effective = resolve_effective_trim_ms(source_duration_ms, trim_start_ms, trim_end_ms)
    if effective is None:
        return True
    start_ms, end_ms = effective
    return start_ms <= 0 and end_ms >= source_duration_ms - _DURATION_MS_SLACK


def trim_seconds_for_ffmpeg(
    duration_s: float,
    trim_start_ms: int | None,
    trim_end_ms: int | None,
) -> tuple[float, float]:
    """返回 FFmpeg ``trim`` / ``atrim`` 使用的 ``start,end``（秒）。全长时用 probe 浮点时长减小舍入误差。"""
    dur_ms = source_duration_ms_from_seconds(duration_s)
    effective = resolve_effective_trim_ms(dur_ms, trim_start_ms, trim_end_ms)
    if effective is None:
        return 0.0, float(duration_s)
    start_ms, end_ms = effective
    return start_ms / 1000.0, end_ms / 1000.0


__all__ = [
    "is_lossless_compatible_trim",
    "resolve_effective_trim_ms",
    "source_duration_ms_from_seconds",
    "trim_seconds_for_ffmpeg",
    "validate_effective_trim_ms",
]
