"""统一生成 P1 契约的快速单元测试。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    GenerationModality,
    GenerationOperation,
    GenerationSubmitRequest,
    GenerationTarget,
    GenerationTargetKind,
    VideoGenerationOperationInput,
)
from app.core.contracts.media import (
    MediaReference,
    VideoMediaInput,
    VideoSubjectMediaReference,
)


def test_video_media_round_trip_preserves_frame_and_subject_groups() -> None:
    """视频媒体序列化后仍保留帧槽位与命名主体的独立分组语义。"""
    media = VideoMediaInput.model_validate(
        {
            "frames": {"first": {"file_id": "frame-1", "media_kind": "image", "ordinal": 0}},
            "subjects": [
                {
                    "name": "Hero",
                    "media": [
                        {"file_id": "hero-image", "media_kind": "image", "ordinal": 0},
                        {"file_id": "hero-video", "media_kind": "video", "ordinal": 1},
                    ],
                }
            ],
        }
    )

    assert media.model_dump(mode="json") == {
        "frames": {"first": {"file_id": "frame-1", "media_kind": "image", "ordinal": 0}, "last": None, "keys": []},
        "subjects": [{"name": "Hero", "media": [{"file_id": "hero-image", "media_kind": "image", "ordinal": 0}, {"file_id": "hero-video", "media_kind": "video", "ordinal": 1}]}],
    }


def test_video_media_rejects_duplicate_normalized_subject_and_ordinal() -> None:
    """主体名称和组内 ordinal 必须是稳定且无歧义的。"""
    reference = MediaReference(file_id="file-1", media_kind="image", ordinal=0)
    with pytest.raises(ValidationError, match="ordinals"):
        VideoSubjectMediaReference(name="Hero", media=[reference, reference])
    with pytest.raises(ValidationError, match="subject names"):
        VideoMediaInput(
            subjects=[
                VideoSubjectMediaReference(name="Hero", media=[reference]),
                VideoSubjectMediaReference(name=" hero ", media=[MediaReference(file_id="file-2", media_kind="video")]),
            ]
        )


def test_external_submit_request_forbids_orchestration_fields() -> None:
    """外部 body 不能覆盖 Binder 根据路径派生的内部编排字段。"""
    body = {
        "execution_prompt": "A moonlit city",
        "operation_input": {"kind": "image_generation", "count": 1},
        "target": {"kind": "shot_video", "entity_id": "shot-1"},
    }
    with pytest.raises(ValidationError, match="Extra inputs"):
        GenerationSubmitRequest.model_validate(body)


def test_generation_command_serializes_final_input_without_url_media() -> None:
    """内部命令可完整序列化，媒体仅包含 file_id 与强类型语义。"""
    command = GenerationCommand(
        modality=GenerationModality.video,
        operation=GenerationOperation.video_generation,
        delivery=GenerationDelivery.async_polling,
        target=GenerationTarget(kind=GenerationTargetKind.shot_video, entity_id="shot-1"),
        request=GenerationSubmitRequest(
            execution_prompt="A moonlit city",
            media=VideoMediaInput(),
            operation_input=VideoGenerationOperationInput(ratio="16:9"),
        ),
    )

    assert "url" not in command.model_dump_json()
    assert command.request.execution_prompt == "A moonlit city"
