"""图片 snapshot Worker 的安全输入投影测试。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.contracts.generation import (
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.media import ImageMediaInput, MediaReference
from app.services.studio import image_task_runner


class _RevisionSession:
    """为图片输入投影提供最小 revision 查询能力。"""

    async def get(self, model: object, identifier: str) -> object | None:
        """只返回冻结模型配置，避免测试依赖真实数据库。"""
        if identifier == "revision-1":
            return SimpleNamespace(model_name="image-model")
        return None


class _FakeResolver:
    """记录 Worker 是否通过 FileResolver 取得执行期媒体内容。"""

    references: list[MediaReference] = []

    def __init__(self, _session: object) -> None:
        """保持与真实 resolver 相同的构造签名。"""

    async def resolve(self, reference: MediaReference) -> SimpleNamespace:
        """返回仅存在于测试内存中的 PNG 内容。"""
        self.references.append(reference)
        return SimpleNamespace(content=b"png-bytes", content_type="image/png")


@pytest.mark.asyncio
async def test_snapshot_image_input_resolves_file_reference_only_in_worker_memory(monkeypatch) -> None:
    """Worker 从 snapshot 的 file_id 解析媒体，不接触历史 run_args URL 或凭据。"""
    monkeypatch.setattr(image_task_runner, "FileResolver", _FakeResolver)
    snapshot = ResolvedGenerationSnapshot(
        model_id="model-1",
        model_revision_id="revision-1",
        canonical_target=GenerationTarget(
            kind=GenerationTargetKind.shot_frame_slot,
            entity_id="shot-1",
            slot_id="12",
        ),
        expected_version_id=1,
        media=ImageMediaInput(references=[MediaReference(file_id="file-1", media_kind="image")]),
        operation_input=ImageGenerationOperationInput(target_ratio="16:9", count=2),
        execution_prompt="冻结提示词",
    )

    input_ = await image_task_runner._resolve_snapshot_image_input(_RevisionSession(), snapshot=snapshot)  # type: ignore[arg-type]

    assert _FakeResolver.references == [MediaReference(file_id="file-1", media_kind="image")]
    assert input_.prompt == "冻结提示词"
    assert input_.model == "image-model"
    assert input_.n == 2
    assert input_.purpose == "video_reference"
    assert input_.images[0].file_id is None
    assert input_.images[0].image_url == "data:image/png;base64,cG5nLWJ5dGVz"
