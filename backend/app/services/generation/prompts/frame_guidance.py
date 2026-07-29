"""分镜帧提示词渲染所需的服务端 guidance 加载能力。"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import ShotFrameType
from app.services.generation.prompts.frame_context import FrameRenderGuidance, build_frame_render_guidance


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
        return await build_frame_render_guidance(
            db=db,
            shot_id=shot_id,
            frame_type=frame_type.value if hasattr(frame_type, "value") else str(frame_type),
        )
    except HTTPException:
        return _empty_frame_render_guidance()
