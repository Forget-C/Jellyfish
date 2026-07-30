"""单镜头渲染请求的确定性构造（application 层）。

职责：把一个 ``CasProductionShot`` 及其 EP001 上下文，组装成**供应商中立**的
``VideoGenerationInput``，并产出一份可复现快照。

纪律：
- 提示词只在这里拼装。API 路由与 React UI **不得**参与提示词构造；
- 相同输入必产出逐字节相同的输出（无时间戳、无随机数、无字典序抖动）；
- 快照只保留可复现所需的最小信息，**不含**密钥，也**不含**整个 ComfyUI 工作流。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from app.core.contracts.video_generation import VideoGenerationInput

#: 提示词各段的固定顺序 —— 确定性的关键。
_SECTION_ORDER: tuple[str, ...] = (
    "style",
    "shot_type",
    "camera_angle",
    "camera_movement",
    "scene",
    "characters",
    "action",
    "beginning_state",
    "ending_state",
    "atmosphere",
    "continuity",
)

#: 快照 schema 版本，便于日后演进时区分历史记录。
SNAPSHOT_VERSION = "step7.render-request.v1"

#: 缺省负向提示词：抑制 Bible 中反复出现的生成风险（多角、文字、重复肢体）。
DEFAULT_NEGATIVE_PROMPT = (
    "extra limbs, duplicated characters, extra horns, asymmetric horns, "
    "readable text, watermark, subtitles, logo, deformed hands, "
    "low quality, blurry, oversaturated neon wash"
)


def _clean(value: Any) -> str:
    """规范化任意字段为单行紧凑文本；None/空白 → 空串。"""
    if value is None:
        return ""
    text = str(value).strip()
    return " ".join(text.split())


@dataclass(frozen=True, slots=True)
class RenderRequest:
    """一次单镜头渲染的完整请求。"""

    shot_id: str
    production_shot_id: str
    prompt: str
    negative_prompt: str
    ratio: str
    seconds: int
    seed: int | None
    snapshot: dict[str, Any] = field(default_factory=dict)

    def to_video_input(self) -> VideoGenerationInput:
        """转为共享的供应商中立契约。"""
        return VideoGenerationInput(
            prompt=self.prompt,
            ratio=self.ratio,  # type: ignore[arg-type]
            seconds=self.seconds,
            seed=self.seed,
        )


def _compose_sections(shot: Any, context: dict[str, Any]) -> dict[str, str]:
    """收集提示词各段落（空段落后续会被丢弃）。"""
    sections: dict[str, str] = {
        "style": _clean(context.get("visual_style")),
        "shot_type": _clean(context.get("shot_type")),
        "camera_angle": _clean(context.get("camera_angle")),
        "camera_movement": _clean(context.get("camera_movement")),
        "scene": _clean(context.get("scene")),
        "characters": _clean(context.get("characters")),
        "action": _clean(getattr(shot, "video_prompt", "") or context.get("action")),
        "beginning_state": _clean(context.get("beginning_state")),
        "ending_state": _clean(context.get("ending_state")),
        "atmosphere": _clean(context.get("atmosphere")),
        "continuity": _clean(context.get("continuity_notes")),
    }
    return sections


def build_render_request(
    shot: Any,
    *,
    context: dict[str, Any] | None = None,
    ratio: str = "9:16",
    seed: int | None = None,
    negative_prompt: str | None = None,
) -> RenderRequest:
    """由生产镜头与上下文构造确定性渲染请求。

    参数：
        shot: ``CasProductionShot``（或具备同名属性的对象）。
        context: EP001 侧的补充信息（角色、场景、相机、创意方向、输出规格等）。
        ratio: 输出宽高比；EP001 为 9:16。
        seed: 可选随机种子；提供后渲染可复现。
        negative_prompt: 覆盖缺省负向提示词。
    返回：
        RenderRequest（含可复现快照）。
    异常：
        ValueError：镜头没有任何可用于成像的描述。
    """
    ctx = dict(context or {})
    sections = _compose_sections(shot, ctx)

    ordered = [(key, sections[key]) for key in _SECTION_ORDER if sections.get(key)]
    if not any(key in {"action", "scene", "characters"} for key, _ in ordered):
        raise ValueError(
            f"shot {getattr(shot, 'source_shot_id', '?')!r} has no action, scene or character "
            "description to render from"
        )
    prompt = ". ".join(text.rstrip(".") for _key, text in ordered) + "."

    seconds_raw = getattr(shot, "duration_seconds", None) or ctx.get("duration_seconds") or 0
    seconds = max(1, int(round(float(seconds_raw)))) if seconds_raw else 1

    negative = _clean(negative_prompt if negative_prompt is not None else DEFAULT_NEGATIVE_PROMPT)

    snapshot: dict[str, Any] = {
        "snapshot_version": SNAPSHOT_VERSION,
        "source_shot_id": _clean(getattr(shot, "source_shot_id", "")),
        "sequence": getattr(shot, "sequence", None),
        "ratio": ratio,
        "seconds": seconds,
        "seed": seed,
        "sections": dict(ordered),
        "negative_prompt": negative,
        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
    }

    return RenderRequest(
        shot_id=_clean(getattr(shot, "source_shot_id", "")),
        production_shot_id=_clean(getattr(shot, "id", "")),
        prompt=prompt,
        negative_prompt=negative,
        ratio=ratio,
        seconds=seconds,
        seed=seed,
        snapshot=snapshot,
    )


def snapshot_fingerprint(snapshot: dict[str, Any]) -> str:
    """快照的稳定指纹：用于判定重试是否使用了相同请求。"""
    canonical = json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


__all__ = [
    "DEFAULT_NEGATIVE_PROMPT",
    "RenderRequest",
    "SNAPSHOT_VERSION",
    "build_render_request",
    "snapshot_fingerprint",
]
