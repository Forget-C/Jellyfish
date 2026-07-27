"""统一 PromptRenderer 的最小单元覆盖。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.studio import ShotFrameType
from app.schemas.studio.shots import ShotLinkedAssetItem
from app.services.generation.prompts import (
    PromptRendererName,
    PromptRendererRegistry,
    PromptRenderRequest,
    ShotFramePromptRenderInput,
    prompt_renderer_registry,
)
from app.services.generation.prompts.renderers import ShotFramePromptRenderer


def test_registry_resolves_only_registered_fixed_renderer() -> None:
    """注册表只为 Binder 已确定的名称提供渲染器。"""
    renderer = prompt_renderer_registry.resolve(PromptRendererName.shot_frame)

    assert isinstance(renderer, ShotFramePromptRenderer)
    with pytest.raises(LookupError, match="not registered"):
        PromptRendererRegistry().resolve(PromptRendererName.shot_frame)


def test_render_request_rejects_target_and_renderer_override() -> None:
    """渲染请求不能携带路由 Binder 负责的 target 或 renderer 字段。"""
    with pytest.raises(ValidationError):
        PromptRenderRequest.model_validate(
            {
                "renderer": "shot_video",
                "target": {"kind": "shot_video", "entity_id": "shot-1"},
                "input": {"kind": "shot_frame", "shot_id": "shot-1", "frame_type": "first"},
            }
        )


@pytest.mark.asyncio
async def test_shot_frame_renderer_returns_prompt_snapshot_and_ordered_media() -> None:
    """分镜帧 Renderer 复用既有预览逻辑，并冻结映射和推荐媒体顺序。"""
    request = PromptRenderRequest(
        input=ShotFramePromptRenderInput(
            shot_id="shot-1",
            frame_type=ShotFrameType.first,
            prompt="张三看向李四",
            images=[
                ShotLinkedAssetItem(type="character", id="char-1", name="张三", file_id="file-1"),
                ShotLinkedAssetItem(type="character", id="char-2", name="李四", file_id="file-2"),
            ],
            director_command_summary="保持人物左右站位",
        )
    )

    snapshot = await prompt_renderer_registry.resolve(PromptRendererName.shot_frame).render(None, request)  # type: ignore[arg-type]

    assert snapshot.renderer == PromptRendererName.shot_frame
    assert snapshot.execution_prompt.endswith("图1看向图2")
    assert snapshot.variables_snapshot["reference_mappings"][0]["file_id"] == "file-1"
    assert snapshot.recommended_media is not None
    assert [item.file_id for item in snapshot.recommended_media.references] == ["file-1", "file-2"]
    assert [item.ordinal for item in snapshot.recommended_media.references] == [0, 1]
