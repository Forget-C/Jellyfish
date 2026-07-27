"""ArtifactStore 的多产物、幂等和 TaskLink 隔离测试。"""

from __future__ import annotations

from typing import Any

import pytest

from app.core.contracts.image_generation import ImageGenerationResult, ImageItem
from app.core.contracts.video_generation import VideoGenerationResult
from app.models.generation_artifacts import GenerationArtifact, GenerationArtifactPublishStatus
from app.models.studio import FileItem
from app.models.types import FileType
from app.services.generation.runtime.artifacts import ArtifactStore


class _ScalarResult:
    """模拟 SQLAlchemy 的单行结果接口。"""

    def __init__(self, value: GenerationArtifact | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> GenerationArtifact | None:
        """返回指定的已归档产物。"""
        return self._value


class _Session:
    """只实现 ArtifactStore 所需会话能力的内存替身。"""

    def __init__(self) -> None:
        self.artifacts: dict[tuple[str, int], GenerationArtifact] = {}
        self.files: dict[str, FileItem] = {}
        self.added: list[object] = []

    async def execute(self, statement: Any) -> _ScalarResult:
        """从查询绑定参数读取 task/ordinal 并返回已有产物。"""
        params = statement.compile().params
        return _ScalarResult(self.artifacts.get((params["task_id_1"], params["ordinal_1"])))

    async def get(self, _model: type[FileItem], file_id: str) -> FileItem | None:
        """读取既有素材。"""
        return self.files.get(file_id)

    def add(self, instance: object) -> None:
        """记录新增对象并按幂等键索引产物。"""
        self.added.append(instance)
        if isinstance(instance, GenerationArtifact):
            self.artifacts[(instance.task_id or "", instance.ordinal)] = instance

    async def flush(self) -> None:
        """模拟 flush。"""


def _image_result() -> ImageGenerationResult:
    """构造两张图片的 Provider 结果。"""
    return ImageGenerationResult(
        provider="openai",
        provider_task_id="provider-image-1",
        status="succeeded",
        images=[ImageItem(url="https://provider.test/one.png"), ImageItem(b64_json="aW1hZ2U=")],
    )


@pytest.mark.asyncio
async def test_store_images_keeps_all_ordinals_and_never_writes_task_link(monkeypatch: pytest.MonkeyPatch) -> None:
    """多图完整归档，Provider 的 URL/Base64 不进入 Artifact 元数据。"""
    db = _Session()
    created: list[FileItem] = []

    async def _create_file(_db: _Session, **_kwargs: Any) -> FileItem:
        file_item = FileItem(
            id=f"file-{len(created)}", type=FileType.image, name="generated", thumbnail="", tags=[], storage_key="key"
        )
        created.append(file_item)
        return file_item

    monkeypatch.setattr("app.services.generation.runtime.artifacts.create_file_from_url_or_b64", _create_file)
    artifacts = await ArtifactStore().store_images(db, task_id="task-1", result=_image_result())  # type: ignore[arg-type]

    assert [artifact.ordinal for artifact in artifacts] == [0, 1]
    assert [artifact.file_id for artifact in artifacts] == ["file-0", "file-1"]
    assert all(artifact.publish_status is GenerationArtifactPublishStatus.skipped for artifact in artifacts)
    assert [artifact.publish_error for artifact in artifacts] == ["no_target_slot", "non_primary_artifact"]
    assert "https://" not in str(artifacts[0].provider_result)
    assert "aW1hZ2U=" not in str(artifacts[1].provider_result)
    assert len(created) == 2


@pytest.mark.asyncio
async def test_store_images_is_idempotent_per_task_and_ordinal(monkeypatch: pytest.MonkeyPatch) -> None:
    """重复执行同一任务不重复下载，也不新增 Artifact。"""
    db = _Session()
    create_calls = 0

    async def _create_file(_db: _Session, **_kwargs: Any) -> FileItem:
        nonlocal create_calls
        create_calls += 1
        return FileItem(id=f"file-{create_calls}", type=FileType.image, name="generated", thumbnail="", tags=[], storage_key="key")

    monkeypatch.setattr("app.services.generation.runtime.artifacts.create_file_from_url_or_b64", _create_file)
    store = ArtifactStore()
    first = await store.store_images(db, task_id="task-1", result=_image_result())  # type: ignore[arg-type]
    second = await store.store_images(db, task_id="task-1", result=_image_result())  # type: ignore[arg-type]

    assert create_calls == 2
    assert [artifact.id for artifact in second] == [artifact.id for artifact in first]
    assert len(db.artifacts) == 2


@pytest.mark.asyncio
async def test_store_video_reuses_provider_file_id_without_creating_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provider 已落库的视频仅建 Artifact，且其重复投递返回同一记录。"""
    db = _Session()
    video = FileItem(id="video-file", type=FileType.video, name="video", thumbnail="", tags=[], storage_key="video-key")
    db.files[video.id] = video

    async def _unexpected_create(*_args: Any, **_kwargs: Any) -> FileItem:
        raise AssertionError("file_id result must not create another file")

    monkeypatch.setattr("app.services.generation.runtime.artifacts.create_file_from_url_or_b64", _unexpected_create)
    result = VideoGenerationResult(file_id=video.id, provider="openai", provider_task_id="video-1", status="succeeded")
    store = ArtifactStore()
    first = await store.store_video(db, task_id="task-video", result=result)  # type: ignore[arg-type]
    second = await store.store_video(db, task_id="task-video", result=result)  # type: ignore[arg-type]

    assert first.file_id == video.id
    assert second.id == first.id
    assert len(db.artifacts) == 1
