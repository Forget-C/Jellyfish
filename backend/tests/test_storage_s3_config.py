"""S3 客户端构造参数的回归测试（2026-09-19 真实 OSS 预检暴露）。

背景：botocore 新版默认给 PutObject 启用 aws-chunked 校验算法，会发送
``STREAMING-UNSIGNED-PAYLOAD-TRAILER``。阿里云 OSS 对该模式不支持，直接返回

    400 NotImplemented: Aws MultiChunkedEncoding STREAMING-UNSIGNED-PAYLOAD-TRAILER is not supported.

而**不是**权限拒绝 —— 同一请求把校验算法设为 ``when_required`` 后即 200。
这条测试锁住 ``_build_s3_client()`` 的三个配置，避免以后被改回去：

1. ``request_checksum_calculation == "when_required"``
2. ``response_checksum_validation == "when_required"``
3. ``s3.addressing_style == "virtual"``（阿里云 OSS 桶域名形如 bucket.oss-<region>.aliyuncs.com，
   必须虚拟主机风格；path-style 会被 ``SecondLevelDomainForbidden`` 拒绝）

测试只构造 client 对象、不发任何网络请求，也不读取真实凭证（用 dummy 值 + 只读 settings 覆盖）。
"""

from __future__ import annotations

import logging

import pytest

from app.core import storage


@pytest.fixture
def _s3_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """把 S3 配置替换成 dummy 值：只为构造 client，不做任何 I/O。"""
    from app.config import settings

    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket", raising=False)
    monkeypatch.setattr(settings, "s3_endpoint_url", "https://oss-cn-beijing.aliyuncs.com", raising=False)
    monkeypatch.setattr(settings, "s3_region_name", "cn-beijing", raising=False)
    monkeypatch.setattr(settings, "s3_access_key_id", "dummy-key-id", raising=False)
    monkeypatch.setattr(settings, "s3_secret_access_key", "dummy-secret", raising=False)


def test_s3_client_uses_s3_compatible_checksum_and_virtual_addressing(_s3_settings: None) -> None:
    """三个关键配置必须同时成立（少一个都会让 OSS 上的上传/下载失败）。"""
    client = storage._build_s3_client()  # noqa: SLF001 - 直接验证构造结果
    config = client.meta.config

    assert config.request_checksum_calculation == "when_required"
    assert config.response_checksum_validation == "when_required"
    assert config.s3.get("addressing_style") == "virtual"


def test_s3_client_requires_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    """没配 bucket 时仍然明确报错（不要悄悄退化成默认值）。"""
    from app.config import settings

    monkeypatch.setattr(settings, "s3_bucket_name", None, raising=False)
    with pytest.raises(RuntimeError):
        storage._build_s3_client()  # noqa: SLF001


def test_local_storage_driver_needs_no_s3_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """本地驱动分支不应受 S3 配置影响（保住"单机开箱可用"）。"""
    from app.config import settings

    monkeypatch.setattr(settings, "storage_driver", "local", raising=False)
    assert storage._resolve_driver() == "local"
    assert storage.is_local_storage() is True


def test_public_url_for_key_requires_explicit_public_base(monkeypatch: pytest.MonkeyPatch) -> None:
    """地址只有一处口径（``public_url_for_key``）：S3 驱动 + 显式公网基址才给公网地址。

    本地驱动给的是 ``/files/{key}`` **本机回放地址**（上游取不到），所以判定"公网"必须
    再过一道 :func:`storage.is_public_url`，不要靠"非空即公网"。
    """
    from app.config import settings

    monkeypatch.setattr(settings, "storage_driver", "s3", raising=False)
    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket", raising=False)
    monkeypatch.setattr(settings, "s3_base_path", "jellyfish/acceptance", raising=False)
    monkeypatch.setattr(
        settings, "s3_public_base_url", "https://test-bucket.oss-cn-beijing.aliyuncs.com", raising=False
    )
    assert (
        storage.public_url_for_key("generated-images/shot_frame_image/12/a.png")
        == "https://test-bucket.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/generated-images/shot_frame_image/12/a.png"
    )
    assert storage.is_public_url(storage.public_url_for_key("a.png")) is True

    # 未配公网基址 → 空串（绝不回退到 {endpoint}/{bucket}/{key} 这种可能错误的地址）
    monkeypatch.setattr(settings, "s3_public_base_url", "", raising=False)
    assert storage.public_url_for_key("a.png") == ""

    # 本地驱动 → 本机回放地址（/files/...，仍带 s3_base_path 前缀），**不是**公网地址
    monkeypatch.setattr(settings, "storage_driver", "local", raising=False)
    monkeypatch.setattr(settings, "local_storage_base_url", "", raising=False)
    monkeypatch.setattr(settings, "s3_public_base_url", "https://x.example.com", raising=False)
    assert storage.public_url_for_key("a.png") == "/files/jellyfish/acceptance/a.png"
    assert storage.is_public_url(storage.public_url_for_key("a.png")) is False


def test_no_path_style_url_when_public_base_missing(
    _s3_settings: None,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """没配 ``s3_public_base_url`` 时**绝不**退回 path-style ``{endpoint}/{bucket}/{key}``。

    这正是真实故障 A 的成因类别：path-style 地址看起来是个公网地址，在阿里云 OSS 上
    匿名访问却是 404 → 上游取不到图 → 任务 failed（「无法获取输入媒体 URL（404/410）」）。
    这里的口径是「空串 + 一条可操作的 warning」，宁可显式降级也不给假地址。
    """
    from app.config import settings

    monkeypatch.setattr(settings, "storage_driver", "s3", raising=False)
    monkeypatch.setattr(settings, "s3_base_path", "jellyfish/acceptance", raising=False)
    monkeypatch.setattr(settings, "s3_public_base_url", "", raising=False)
    # 「只提醒一次」的进程级标记：本用例要亲自验证那条 warning，先复位。
    monkeypatch.setattr(storage, "_missing_public_base_warned", False, raising=False)

    with caplog.at_level(logging.WARNING, logger="app.core.storage"):
        url = storage.public_url_for_key("files/a.png")

    assert url == ""
    assert storage.is_public_url(url) is False
    # 明确排除 path-style 形状（哪怕是空串也不该"碰巧"像 path-style）
    assert url != f"{settings.s3_endpoint_url.rstrip('/')}/{settings.s3_bucket_name}/files/a.png"
    assert "aliyuncs.com" not in url

    messages = [record.getMessage() for record in caplog.records]
    assert messages, "缺公网基址必须留下一条可排查的 warning"
    joined = " ".join(messages)
    # 可操作：说清配哪个键、怎么配
    assert "s3_public_base_url" in joined
    assert "public-read" in joined
    # 不泄漏凭证 / 本机绝对路径
    assert "dummy-secret" not in joined
    assert "/Users/" not in joined


@pytest.mark.asyncio
async def test_upload_file_does_not_invent_path_style_url(
    _s3_settings: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """缺公网基址时 ``StoredFileInfo.url`` 也必须是空串（同一处口径，不另拼一套）。"""
    from app.config import settings

    monkeypatch.setattr(settings, "storage_driver", "s3", raising=False)
    monkeypatch.setattr(settings, "s3_base_path", "jellyfish/acceptance", raising=False)
    monkeypatch.setattr(settings, "s3_public_base_url", "", raising=False)
    monkeypatch.setattr(storage, "_missing_public_base_warned", False, raising=False)

    class _FakeS3Client:
        """只接住 put_object，绝不发网络请求。"""

        def put_object(self, **_kwargs):  # type: ignore[no-untyped-def]
            return {"ETag": '"stub-etag"'}

    monkeypatch.setattr(storage, "_build_s3_client", _FakeS3Client)

    info = await storage.upload_file(key="files/a.png", data=b"x", content_type="image/png")

    assert info.key == "jellyfish/acceptance/files/a.png"
    assert info.url == ""
    assert storage.is_public_url(info.url) is False


@pytest.mark.asyncio
async def test_reference_resolver_warns_actionably_without_public_base(
    _s3_settings: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """定版参考图解析：缺公网基址 → 空地址 + 中文可操作 warning（**不给** path-style 假地址）。"""
    from app.config import settings
    from app.models.studio import Character, CharacterImage, FileItem
    from app.services.studio.image_pipeline.reference_resolver import resolve_references
    from tests.llm_orchestration_fixtures import build_session

    monkeypatch.setattr(settings, "storage_driver", "s3", raising=False)
    monkeypatch.setattr(settings, "s3_base_path", "jellyfish/acceptance", raising=False)
    monkeypatch.setattr(settings, "s3_public_base_url", "", raising=False)
    monkeypatch.setattr(storage, "_missing_public_base_warned", False, raising=False)

    async def _fake_get_file_info(*, key: str) -> storage.StoredFileInfo:
        # get_file_info 的 url 与 public_url_for_key 同源，缺基址时同样是空串
        return storage.StoredFileInfo(key=key, url=settings.s3_public_base_url or "", size=1)

    monkeypatch.setattr(storage, "get_file_info", _fake_get_file_info)

    db, engine = await build_session()
    try:
        db.add(
            Character(
                id="char-ref", project_id="proj-ref", name="林晓", description="女主", style="真人都市"
            )
        )
        db.add(FileItem(id="file-ref", type="image", name="定版图", storage_key="files/ref.png"))
        await db.flush()
        db.add(
            CharacterImage(
                id=1,
                character_id="char-ref",
                file_id="file-ref",
                is_primary=True,
                view_angle="FRONT",
                quality_level="HIGH",
            )
        )
        await db.flush()
        resolved = await resolve_references(db, asset_type="character", asset_ids=["char-ref"])
    finally:
        await engine.dispose()

    entry = resolved["char-ref"]
    assert entry.url == ""
    assert entry.warnings, "缺公网地址必须如实告警，不能静默"
    joined = " ".join(entry.warnings)
    assert "s3_public_base_url" in joined
    assert f"{settings.s3_endpoint_url}/{settings.s3_bucket_name}" not in joined


@pytest.mark.asyncio
async def test_vendor_ref_maps_s3_backed_relative_key_to_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归：S3 驱动下相对 storage_key 必须解析成公网地址并判为供应商可用。

    这是"关键帧已公网可读、却被判供应商不可用"的真 bug（2026-09-19 实测发现）：
    ``storage_key`` 是逻辑 key，公网地址是 ``{public_base}/{base_path}/{key}``。
    """
    from app.config import settings
    from app.models.studio import FileItem
    from app.utils.files import resolve_vendor_image_ref
    from tests.llm_orchestration_fixtures import build_session

    monkeypatch.setattr(settings, "storage_driver", "s3", raising=False)
    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket", raising=False)
    monkeypatch.setattr(settings, "s3_base_path", "jellyfish/acceptance", raising=False)
    monkeypatch.setattr(
        settings, "s3_public_base_url", "https://test-bucket.oss-cn-beijing.aliyuncs.com", raising=False
    )

    db, engine = await build_session()
    async with db:
        db.add(
            FileItem(
                id="file-frame",
                type="image",
                name="frame",
                storage_key="generated-images/shot_frame_image/12/a.png",
            )
        )
        await db.flush()

        outcome = await resolve_vendor_image_ref(db, file_id="file-frame", vendor="apimart")
        assert outcome.kind == "public"
        assert outcome.vendor_usable is True
        assert outcome.ref == (
            "https://test-bucket.oss-cn-beijing.aliyuncs.com/"
            "jellyfish/acceptance/generated-images/shot_frame_image/12/a.png"
        )
    await engine.dispose()
