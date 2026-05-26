from io import BytesIO

import pytest

from app.config import settings
from app.core import storage


@pytest.fixture(autouse=True)
def local_storage_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "s3_bucket_name", None)
    monkeypatch.setattr(settings, "s3_base_path", "")
    monkeypatch.setattr(settings, "local_storage_path", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "local_storage_url_path", "/media")


@pytest.mark.asyncio
async def test_local_storage_upload_download_info_list_delete():
    storage.init_storage()

    info = await storage.upload_file(
        key="images/actor.png",
        data=b"png-bytes",
        content_type="image/png",
    )

    assert info.key == "images/actor.png"
    assert info.url == "/media/images/actor.png"
    assert info.size == len(b"png-bytes")
    assert await storage.download_file(key=info.key) == b"png-bytes"

    metadata = await storage.get_file_info(key=info.key)
    assert metadata.key == info.key
    assert metadata.url == info.url
    assert metadata.size == len(b"png-bytes")
    assert metadata.content_type == "image/png"

    files = await storage.list_files(prefix="images")
    assert [item.key for item in files] == ["images/actor.png"]

    await storage.delete_file(key=info.key)
    assert await storage.list_files(prefix="images") == []


@pytest.mark.asyncio
async def test_local_storage_accepts_file_like_objects():
    info = await storage.upload_file(
        key="uploads/example.txt",
        data=BytesIO(b"hello local storage"),
        content_type="text/plain",
    )

    assert info.key == "uploads/example.txt"
    assert await storage.download_file(key="uploads/example.txt") == b"hello local storage"


def test_local_storage_rejects_path_traversal():
    with pytest.raises(ValueError):
        storage._local_path_for_key("../outside.txt")
