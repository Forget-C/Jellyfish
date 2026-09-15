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
from app.models.studio import ActorImage
from app.services.generation.gate import GenerationEntityGate


class _AssetImageSession:
    """提供资产图片槽位读取的最小异步会话替身。"""

    def __init__(self, *, actor_id: str) -> None:
        """以指定所属资产构造一个可读取的资产图片槽位。"""

        self.frame = SimpleNamespace(actor_id=actor_id)

    async def get(self, model: object, identifier: int) -> object | None:
        """仅响应门禁对指定帧槽位的读取。"""

        if model is ActorImage and identifier == 12:
            return self.frame
        return None


def _asset_image_command(*, asset_id: str) -> GenerationCommand:
    """构造只用于目标验证的图片资产图片任务命令。"""

    return GenerationCommand(
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        delivery=GenerationDelivery.async_polling,
        target=GenerationTarget(
            kind=GenerationTargetKind.asset_image_slot,
            entity_id=asset_id,
            slot_id="12",
            asset_type="actor",
        ),
        request=GenerationSubmitRequest(
            execution_prompt="生成演员图片",
            operation_input=ImageGenerationOperationInput(),
        ),
    )


@pytest.mark.asyncio
async def test_asset_image_slot_rejects_slot_owned_by_another_asset() -> None:
    """帧槽位虽存在但不属于 target 资产时，必须拒绝跨资产写回。"""

    gate = GenerationEntityGate()

    with pytest.raises(HTTPException) as error:
        await gate._validate_target(_AssetImageSession(actor_id="actor-other"), _asset_image_command(asset_id="actor-1"))  # type: ignore[arg-type]

    assert error.value.status_code == 404
    assert error.value.detail == "target_not_found"


@pytest.mark.asyncio
async def test_asset_image_slot_accepts_slot_owned_by_target_asset() -> None:
    """帧槽位归属与 target 资产一致时，目标门禁应允许后续模型与媒体校验。"""

    await GenerationEntityGate()._validate_target(  # type: ignore[arg-type]
        _AssetImageSession(actor_id="actor-1"),
        _asset_image_command(asset_id="actor-1"),
    )
