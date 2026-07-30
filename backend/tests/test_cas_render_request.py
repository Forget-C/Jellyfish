"""Step 7：单镜头渲染请求构造测试（确定性 + 缺字段容错 + 快照安全）。"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.crypto_animal_studio.application.render_request import (
    DEFAULT_NEGATIVE_PROMPT,
    SNAPSHOT_VERSION,
    build_render_request,
    snapshot_fingerprint,
)


@dataclass
class _Shot:
    id: str = "ps-1"
    source_shot_id: str = "SC01"
    sequence: int = 1
    duration_seconds: float = 3.0
    video_prompt: str = ""


def _context() -> dict:
    return {
        "visual_style": "premium stylized 3D",
        "shot_type": "medium wide",
        "camera_angle": "slight low angle",
        "camera_movement": "push in",
        "scene": "The Burrow trading office at night",
        "characters": "Bruno Bull, forest-green shirt, mustard tie",
        "action": "Bruno shoulders through the doorway, both arms rising",
        "beginning_state": "door half open",
        "ending_state": "arms up, hooves planted",
        "atmosphere": "cool office ambience with green chart accent",
        "continuity_notes": "smartwatch on left wrist",
    }


def test_prompt_is_deterministic_for_identical_inputs() -> None:
    """相同输入 → 逐字节相同的提示词与快照指纹。"""
    first = build_render_request(_Shot(), context=_context())
    second = build_render_request(_Shot(), context=_context())
    assert first.prompt == second.prompt
    assert snapshot_fingerprint(first.snapshot) == snapshot_fingerprint(second.snapshot)


def test_sections_appear_in_fixed_order() -> None:
    """段落顺序固定，不随 dict 插入顺序变化。"""
    ctx = _context()
    shuffled = {key: ctx[key] for key in reversed(list(ctx))}
    assert build_render_request(_Shot(), context=ctx).prompt == (
        build_render_request(_Shot(), context=shuffled).prompt
    )
    prompt = build_render_request(_Shot(), context=ctx).prompt
    assert prompt.index("premium stylized 3D") < prompt.index("The Burrow")
    assert prompt.index("The Burrow") < prompt.index("shoulders through the doorway")


def test_optional_fields_may_be_missing() -> None:
    """只有 action 也能构造；缺失段落被跳过而不是留下空句。"""
    request = build_render_request(_Shot(), context={"action": "Milo lowers the mug"})
    assert request.prompt == "Milo lowers the mug."
    assert ".." not in request.prompt
    assert request.negative_prompt == DEFAULT_NEGATIVE_PROMPT


def test_shot_video_prompt_overrides_context_action() -> None:
    """镜头自带 video_prompt 时优先于上下文 action。"""
    shot = _Shot(video_prompt="explicit provider-facing action text")
    request = build_render_request(shot, context={"action": "ignored"})
    assert "explicit provider-facing action text" in request.prompt
    assert "ignored" not in request.prompt


def test_missing_all_visual_fields_is_rejected() -> None:
    """完全没有可成像描述时明确失败，而不是提交空提示词。"""
    with pytest.raises(ValueError, match="no action, scene or character"):
        build_render_request(_Shot(), context={"atmosphere": "moody"})


def test_duration_rounds_to_at_least_one_second() -> None:
    """时长取整且下限为 1 秒。"""
    assert build_render_request(_Shot(duration_seconds=6.5), context=_context()).seconds == 6
    assert build_render_request(_Shot(duration_seconds=0.2), context=_context()).seconds == 1
    assert build_render_request(_Shot(duration_seconds=0), context=_context()).seconds == 1


def test_video_input_conversion_matches_request() -> None:
    """转换为供应商中立契约时字段一致。"""
    request = build_render_request(_Shot(), context=_context(), seed=42)
    video_input = request.to_video_input()
    assert video_input.prompt == request.prompt
    assert video_input.ratio == "9:16"
    assert video_input.seconds == 3
    assert video_input.seed == 42


def test_snapshot_is_reproducible_and_free_of_secrets() -> None:
    """快照可复现，且不含密钥或整个工作流负载。"""
    request = build_render_request(_Shot(), context=_context(), seed=7)
    snapshot = request.snapshot
    assert snapshot["snapshot_version"] == SNAPSHOT_VERSION
    assert snapshot["source_shot_id"] == "SC01"
    assert snapshot["seed"] == 7
    # prompt_sha256 必须是该提示词的真实摘要，而不仅仅是「有个 64 字符的串」
    import hashlib

    assert snapshot["prompt_sha256"] == hashlib.sha256(request.prompt.encode("utf-8")).hexdigest()
    # 快照只保留段落文本，不含供应商负载/节点图/凭据
    for banned in ("api_key", "workflow", "class_type", "base_url", "token", "password"):
        assert banned not in str(snapshot).lower()


def test_seed_change_changes_fingerprint_but_not_prompt() -> None:
    """种子影响可复现性指纹，但不改变提示词文本。"""
    a = build_render_request(_Shot(), context=_context(), seed=1)
    b = build_render_request(_Shot(), context=_context(), seed=2)
    assert a.prompt == b.prompt
    assert snapshot_fingerprint(a.snapshot) != snapshot_fingerprint(b.snapshot)
