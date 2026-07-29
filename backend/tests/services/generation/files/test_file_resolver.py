"""FileResolver 的受控媒体解析覆盖。"""

from __future__ import annotations

import pytest

from app.core import storage
from app.core.contracts.media import MediaReference
from app.core.storage import StoredFileInfo
from app.models.studio import FileItem, FileType
from app.models.generation_artifacts import GenerationTaskMediaReference
from app.services.generation.files import FileResolutionError, FileResolver


class _FakeDB:
    """仅实现 FileResolver 所需 get 接口的数据库替身。"""

    def __init__(self, files: dict[str, FileItem]) -> None:
        self._files = files

    async def get(self, _model, file_id: str):  # noqa: ANN001
        """按文件 ID 返回预设的 FileItem。"""
        return self._files.get(file_id)


class _TaskSnapshotDB(_FakeDB):
    """补充任务媒体快照查询，验证 Worker 不会跳过冻结版本。"""

    def __init__(self, files: dict[str, FileItem], references: list[GenerationTaskMediaReference]) -> None:
        super().__init__(files)
        self._references = references

    async def scalars(self, _statement):  # noqa: ANN001
        """返回测试预置的任务媒体快照。"""
        return self._references


def _file(*, file_id: str = "file-1", file_type: FileType = FileType.image) -> FileItem:
    """构造带版本与哈希的受控文件记录。"""
    return FileItem(
        id=file_id,
        type=file_type,
        name="reference",
        thumbnail="",
        tags=[],
        storage_key=f"files/{file_id}",
        content_version=3,
        content_hash="sha256:stable",
    )


@pytest.mark.asyncio
async def test_snapshot_freezes_file_identity_kind_and_content_revision() -> None:
    """快照只能保存 file_id、类型和不可变内容版本，不泄露存储地址。"""
    resolver = FileResolver(_FakeDB({"file-1": _file()}))  # type: ignore[arg-type]

    snapshot = await resolver.snapshot(MediaReference(file_id="file-1", media_kind="image", ordinal=2))

    assert snapshot.model_dump() == {
        "file_id": "file-1",
        "media_kind": "image",
        "ordinal": 2,
        "file_content_version": 3,
        "file_content_hash": "sha256:stable",
    }
    assert "url" not in snapshot.model_dump_json().lower()
    assert "storage_key" not in snapshot.model_dump()


@pytest.mark.asyncio
async def test_resolve_downloads_only_for_execution_and_returns_memory_content(monkeypatch) -> None:
    """下载结果仅出现在执行期返回值，快照依旧不携带 URL 或 Data URL。"""
    resolver = FileResolver(_FakeDB({"file-1": _file()}))  # type: ignore[arg-type]

    async def _download(*, key: str) -> bytes:
        assert key == "files/file-1"
        return b"image-bytes"

    async def _info(*, key: str) -> StoredFileInfo:
        assert key == "files/file-1"
        return StoredFileInfo(key=key, url="https://internal.example/file-1", content_type="image/png")

    monkeypatch.setattr(storage, "download_file", _download)
    monkeypatch.setattr(storage, "get_file_info", _info)
    resolved = await resolver.resolve(MediaReference(file_id="file-1", media_kind="image"))

    assert resolved.content == b"image-bytes"
    assert resolved.content_type == "image/png"
    assert resolved.snapshot.file_content_hash == "sha256:stable"
    assert "url" not in resolved.snapshot.model_dump_json().lower()


@pytest.mark.asyncio
async def test_resolve_rejects_missing_file_and_media_kind_mismatch() -> None:
    """不存在文件与 image/video 类型错配必须在 Provider 调用前失败。"""
    resolver = FileResolver(_FakeDB({"video-1": _file(file_id="video-1", file_type=FileType.video)}))  # type: ignore[arg-type]

    with pytest.raises(FileResolutionError, match="not found"):
        await resolver.snapshot(MediaReference(file_id="missing", media_kind="image"))
    with pytest.raises(FileResolutionError, match="media kind mismatch"):
        await resolver.snapshot(MediaReference(file_id="video-1", media_kind="image"))


@pytest.mark.asyncio
async def test_resolve_frozen_rejects_content_version_drift() -> None:
    """Worker 只能使用提交时冻结的文件版本，不能静默改用更新内容。"""
    original = _file()
    resolver = FileResolver(_FakeDB({"file-1": original}))  # type: ignore[arg-type]
    snapshot = await resolver.snapshot(MediaReference(file_id="file-1", media_kind="image"))
    original.content_version = 4

    with pytest.raises(FileResolutionError, match="content changed"):
        await resolver.resolve_frozen(snapshot)


@pytest.mark.asyncio
async def test_resolve_task_reference_rejects_drift_from_persisted_snapshot() -> None:
    """Worker 必须依据任务快照而不是当前文件版本解析媒体。"""
    file_item = _file()
    file_item.content_version = 4
    resolver = FileResolver(
        _TaskSnapshotDB(
            {"file-1": file_item},
            [
                GenerationTaskMediaReference(
                    task_id="task-1",
                    file_id="file-1",
                    group_path="references",
                    ordinal=0,
                    media_kind="image",
                    file_content_version=3,
                    file_content_hash="sha256:stable",
                )
            ],
        )
    )

    with pytest.raises(FileResolutionError, match="content changed"):
        await resolver.resolve_task_reference(
            task_id="task-1",
            reference=MediaReference(file_id="file-1", media_kind="image"),
        )
