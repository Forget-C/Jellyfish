"""分镜帧提示词渲染所需的服务端 guidance 加载能力。"""

from __future__ import annotations

from typing import TypedDict

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import ShotFrameType
from app.services.film.shot_frame_prompt_tasks import build_run_args as build_shot_frame_prompt_run_args


class FrameRenderGuidance(TypedDict):
    """定义提示词 Renderer 可消费的镜头高优先级约束字段。"""

    director_command_summary: str
    continuity_guidance: str
    frame_specific_guidance: str
    composition_anchor: str
    screen_direction_guidance: str


def _empty_frame_render_guidance() -> FrameRenderGuidance:
    """返回缺少镜头上下文时的稳定空 guidance，避免渲染接口泄漏旧任务错误。"""
    return {
        "director_command_summary": "",
        "continuity_guidance": "",
        "frame_specific_guidance": "",
        "composition_anchor": "",
        "screen_direction_guidance": "",
    }


async def load_frame_render_guidance(
    *,
    db: AsyncSession,
    shot_id: str,
    frame_type: ShotFrameType,
) -> FrameRenderGuidance:
    """加载指定分镜帧的服务端约束，供统一 Renderer 注入不可编辑的业务事实。"""
    try:
        run_args = await build_shot_frame_prompt_run_args(
            db,
            shot_id=shot_id,
            frame_type=frame_type.value if hasattr(frame_type, "value") else str(frame_type),
        )
    except HTTPException:
        return _empty_frame_render_guidance()

    input_dict = dict(run_args.get("input") or {})
    return {
        "director_command_summary": str(input_dict.get("director_command_summary") or "").strip(),
        "continuity_guidance": str(input_dict.get("continuity_guidance") or "").strip(),
        "frame_specific_guidance": str(input_dict.get("frame_specific_guidance") or "").strip(),
        "composition_anchor": str(input_dict.get("composition_anchor") or "").strip(),
        "screen_direction_guidance": str(input_dict.get("screen_direction_guidance") or "").strip(),
    }
