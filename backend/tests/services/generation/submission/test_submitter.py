"""生成提交的受支持操作、目标和执行方式门禁。"""

import pytest

from app.core.contracts.generation import GenerationCommand, GenerationOperation, GenerationDelivery, GenerationTargetKind
from app.services.generation.submission import GenerationSubmitter, UnsupportedGenerationDeliveryError, generation_capability_registry
from app.services.generation.gate import GenerationEntityGate

def test_capability_registry_exposes_only_planned_matrix() -> None:
    """图片不允许 inline，文本聊天仍允许 streaming。"""
    assert not generation_capability_registry.supports(
        operation=GenerationOperation.image_generation,
        delivery=GenerationDelivery.inline,
    )
    assert generation_capability_registry.supports(
        operation=GenerationOperation.text_chat,
        delivery=GenerationDelivery.streaming,
    )


def test_capability_registry_restricts_delivery_by_trusted_target() -> None:
    """同一异步模态只能提交到已经定义终态交付语义的目标。"""
    assert generation_capability_registry.supports(
        operation=GenerationOperation.image_generation,
        delivery=GenerationDelivery.async_polling,
        target_kind=GenerationTargetKind.experiment_session,
    )
    assert not generation_capability_registry.supports(
        operation=GenerationOperation.image_generation,
        delivery=GenerationDelivery.async_polling,
        target_kind=GenerationTargetKind.shot_video,
    )
    with pytest.raises(UnsupportedGenerationDeliveryError, match="target_unsupported"):
        generation_capability_registry.require_supported(
            operation=GenerationOperation.video_generation,
            delivery=GenerationDelivery.async_polling,
            target_kind=GenerationTargetKind.asset_image_slot,
        )



@pytest.mark.asyncio
async def test_unsupported_delivery_fails_before_database_access():
    """不支持的执行方式必须在访问实体和写任务之前拒绝。"""
    command = GenerationCommand.model_validate({
        "modality": "image", "operation": "image_generation", "delivery": "inline",
        "target": {"kind": "experiment_session", "entity_id": "session"},
        "request": {"model_id": "model", "execution_prompt": "test", "operation_input": {"kind": "image_generation"}},
    })
    with pytest.raises(UnsupportedGenerationDeliveryError, match="delivery_unsupported"):
        await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(None, command)
