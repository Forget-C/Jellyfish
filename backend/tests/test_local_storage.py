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


def test_s3_client_uses_path_style_addressing(monkeypatch):
    """S3-compatible local endpoints should not require bucket DNS names."""

    captured = {}

    def _fake_boto3_client(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return object()

    monkeypatch.setattr(settings, "s3_bucket_name", "jellyfish-assets")
    monkeypatch.setattr(settings, "s3_endpoint_url", "http://rustfs:9000")
    monkeypatch.setattr(settings, "s3_region_name", "us-east-1")
    monkeypatch.setattr(settings, "s3_access_key_id", "access")
    monkeypatch.setattr(settings, "s3_secret_access_key", "secret")
    monkeypatch.setattr(storage.boto3, "client", _fake_boto3_client)

    storage._build_s3_client()

    assert captured["args"] == ("s3",)
    assert captured["kwargs"]["config"].s3["addressing_style"] == "path"
