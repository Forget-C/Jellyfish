"""统一终态交付 DTO 的最小契约覆盖。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.contracts.generation import GenerationModality
from app.core.contracts.generation_delivery import (
    DeliveredArtifact,
    DeliveredArtifactPublishState,
    GenerationDeliveryResult,
    GenerationOutcome,
)


def _image_artifact() -> DeliveredArtifact:
    """构造一个可安全投影给调用方的图片产物。"""
    return DeliveredArtifact(
        artifact_id="artifact-1",
        modality=GenerationModality.image,
        ordinal=0,
        file_id="file-1",
        publish_state=DeliveredArtifactPublishState.skipped,
        publish_error="no_target_slot",
    )


def test_delivery_result_accepts_experiment_artifact_without_slot_publish() -> None:
    """实验室产物可跳过自动采用，但仍是成功且可预览的终态。"""
    result = GenerationDeliveryResult(
        outcome=GenerationOutcome.succeeded,
        artifacts=[_image_artifact()],
        primary_file_id="file-1",
    )

    assert result.artifacts[0].publish_state is DeliveredArtifactPublishState.skipped


def test_delivered_artifact_requires_exactly_one_content_type() -> None:
    """交付层不能同时泄漏文本和文件两种内容来源。"""
    with pytest.raises(ValidationError, match="exactly one"):
        DeliveredArtifact(
            artifact_id="artifact-1",
            modality=GenerationModality.image,
            ordinal=0,
            file_id="file-1",
            text_content="unexpected",
            publish_state=DeliveredArtifactPublishState.published,
        )


def test_non_success_delivery_requires_stable_error_code() -> None:
    """失败和取消终态必须提供可被前端稳定识别的错误码。"""
    with pytest.raises(ValidationError, match="requires error_code"):
        GenerationDeliveryResult(outcome=GenerationOutcome.failed)
