"""生成实体门禁的目标归属校验测试。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    GenerationModality,
    GenerationOperation,
    GenerationSubmitRequest,
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
)
from app.models.studio import ShotFrameImage
from app.services.generation.gate import GenerationEntityGate


class _ShotFrameSession:
    """提供分镜帧槽位读取的最小异步会话替身。"""

    def __init__(self, *, shot_detail_id: str) -> None:
        """以指定所属镜头细节构造一个可读取的分镜帧槽位。"""

        self.frame = SimpleNamespace(shot_detail_id=shot_detail_id)

    async def get(self, model: object, identifier: int) -> object | None:
        """仅响应门禁对指定帧槽位的读取。"""

        if model is ShotFrameImage and identifier == 12:
            return self.frame
        return None


def _shot_frame_command(*, shot_id: str) -> GenerationCommand:
    """构造只用于目标验证的图片分镜帧任务命令。"""

    return GenerationCommand(
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        delivery=GenerationDelivery.async_polling,
        target=GenerationTarget(
            kind=GenerationTargetKind.shot_frame_slot,
            entity_id=shot_id,
            slot_id="12",
        ),
        request=GenerationSubmitRequest(
            execution_prompt="生成首帧",
            operation_input=ImageGenerationOperationInput(),
        ),
    )


@pytest.mark.asyncio
async def test_shot_frame_slot_rejects_slot_owned_by_another_shot_detail() -> None:
    """帧槽位虽存在但不属于 target 镜头时，必须拒绝跨镜头写回。"""

    gate = GenerationEntityGate()

    with pytest.raises(HTTPException) as error:
        await gate._validate_target(_ShotFrameSession(shot_detail_id="shot-other"), _shot_frame_command(shot_id="shot-1"))  # type: ignore[arg-type]

    assert error.value.status_code == 404
    assert error.value.detail == "target_not_found"


@pytest.mark.asyncio
async def test_shot_frame_slot_accepts_slot_owned_by_target_shot_detail() -> None:
    """帧槽位归属与 target 镜头一致时，目标门禁应允许后续模型与媒体校验。"""

    await GenerationEntityGate()._validate_target(  # type: ignore[arg-type]
        _ShotFrameSession(shot_detail_id="shot-1"),
        _shot_frame_command(shot_id="shot-1"),
    )
