"""分镜帧提示词 guidance 服务的最小行为覆盖。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.studio import ShotFrameType
from app.services.generation.prompts import frame_guidance


@pytest.mark.asyncio
async def test_load_frame_render_guidance_extracts_only_renderer_fields(monkeypatch) -> None:
    """服务应清理任务上下文文本，只暴露 Renderer 允许使用的 guidance 字段。"""

    async def _build_run_args(*_args, **_kwargs):  # noqa: ANN002, ANN003
        return {
            "input": {
                "director_command_summary": " 导演要求 ",
                "continuity_guidance": " 连续性 ",
                "frame_specific_guidance": " 首帧 ",
                "composition_anchor": " 构图 ",
                "screen_direction_guidance": " 轴线 ",
                "unrelated": "不应泄漏",
            }
        }

    monkeypatch.setattr(frame_guidance, "build_shot_frame_prompt_run_args", _build_run_args)

    guidance = await frame_guidance.load_frame_render_guidance(
        db=object(),
        shot_id="shot-1",
        frame_type=ShotFrameType.first,
    )

    assert guidance == {
        "director_command_summary": "导演要求",
        "continuity_guidance": "连续性",
        "frame_specific_guidance": "首帧",
        "composition_anchor": "构图",
        "screen_direction_guidance": "轴线",
    }


@pytest.mark.asyncio
async def test_load_frame_render_guidance_returns_empty_values_when_shot_is_unavailable(monkeypatch) -> None:
    """旧任务上下文无法构建时，渲染仍应使用确定性的空 guidance。"""

    async def _build_run_args(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise HTTPException(status_code=404, detail="shot not found")

    monkeypatch.setattr(frame_guidance, "build_shot_frame_prompt_run_args", _build_run_args)

    guidance = await frame_guidance.load_frame_render_guidance(
        db=object(),
        shot_id="missing-shot",
        frame_type=ShotFrameType.key,
    )

    assert guidance == {
        "director_command_summary": "",
        "continuity_guidance": "",
        "frame_specific_guidance": "",
        "composition_anchor": "",
        "screen_direction_guidance": "",
    }
