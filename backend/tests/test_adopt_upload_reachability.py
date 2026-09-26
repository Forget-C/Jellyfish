"""上传 / 采纳之后的**匿名可达性验证**（故障 A 的收尾动作）。

为什么需要它：对象存储写入成功 ≠ 这个对象**匿名可读**。真实验收里，
本机可读、匿名访问 404 的地址被当成公网地址交给了上游 → 上游任务 failed
（原文「无法获取输入媒体 URL（404/410）」）。把验证放在**上传之后**，
用户当场就能看到「已入库，但这个地址匿名取不到」以及怎么修。

本文件锁住三件事：

1. 验证实现**只有一份**（``reference_preflight.verify_uploaded_url_reachable``），
   ``adopt`` 与 ``POST /studio/files/upload`` 都用它，没有第二份 HEAD/GET 探测；
2. 上传接口响应**只增不删**地带回 ``url`` / ``url_reachable`` / ``url_probe`` / ``warnings``，
   **不可达不阻断上传**（文件照样落库），但必须如实告警 + 给修法；
3. DRY_RUN 下**一个字节都不出站**（用「任何出网即 AssertionError」的桩证明）；
   并且写对象存储这一「oss」出口在演练模式下被守卫拦在**写入之前**（409，不落库）。

全部不联网：探活一律注入 stub 或 ``httpx.MockTransport``，对象存储写入一律 stub 掉。
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.v1.routes.studio import files as files_route
from app.core import storage
from app.dependencies import get_db
from app.main import app
from app.models.studio import Character, CharacterImage, FileItem, FileType, Prop
from app.services.studio.files import UploadFileOutcome, upload_file
from app.services.studio.image_pipeline import adopt as adopt_module
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.adopt import (
    adopt_generated_image,
    verify_uploaded_url_reachable,
)
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV
from tests.llm_orchestration_fixtures import build_session

OSS_URL = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/generated-images/character/x.png"

#: 真探活实现（注入 stub 后仍要能调到它，否则 stub 会递归调自己）
_REAL_PROBE = reference_preflight.probe_reference_url


# ---------------------------------------------------------------------------
# 0) 测试脚手架：stub 探活 / stub 存储写入（绝不触网、绝不碰真实 OSS）
# ---------------------------------------------------------------------------


def _install_probe(monkeypatch: pytest.MonkeyPatch, status: int | None) -> list[str]:
    """把统一实现用的探活换成 MockTransport。

    ``status=None`` 表示「本用例不该有任何探活」：真被调到就直接 AssertionError。
    """
    calls: list[str] = []

    async def _probe(url: str, *, label: str = "", **kwargs) -> reference_preflight.ReferenceProbeResult:  # type: ignore[no-untyped-def]
        calls.append(url)
        assert status is not None, "本用例不应该发起任何探活请求"
        return await _REAL_PROBE(
            url,
            label=label,
            transport=httpx.MockTransport(lambda _request: httpx.Response(status)),
        )

    monkeypatch.setattr(reference_preflight, "probe_reference_url", _probe)
    return calls


def _forbid_any_outbound(monkeypatch: pytest.MonkeyPatch) -> None:
    """任何 HTTP 出站都直接失败（DRY_RUN 用例的兜底证明）。"""

    async def _boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("DRY_RUN 下不应有任何出网请求")

    monkeypatch.setattr(httpx.AsyncClient, "request", _boom)


class _FakeUploadFile:
    """够用的 UploadFile 替身（只用到 filename / content_type / read）。"""

    def __init__(self, filename: str, *, content_type: str = "image/png", data: bytes = b"\x89PNG-stub"):
        self.filename = filename
        self.content_type = content_type
        self._data = data

    async def read(self) -> bytes:
        return self._data


@pytest.fixture
def _stored_url(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """把「写对象存储」换掉：返回一个可控的落库地址，并记录调用。"""
    state = {"url": OSS_URL, "key": ""}

    async def _fake_upload_file(*, key, data, content_type=None, extra_args=None):  # type: ignore[no-untyped-def]
        state["key"] = key
        # 与真实实现同口径：ACL public-read 是既有写入路径，测试照样断言
        assert extra_args == {"ACL": "public-read"}, "写入仍须走既有的 public-read 出口"
        return storage.StoredFileInfo(
            key=key,
            url=state["url"],
            size=len(data) if isinstance(data, (bytes, bytearray)) else None,
            content_type=content_type,
            etag="stub-etag",
        )

    monkeypatch.setattr(storage, "upload_file", _fake_upload_file)
    return state


@pytest.fixture(autouse=True)
def _fake_adopt_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    """采纳路径的「下载远端图片 + 上传存储」也替换掉（与既有 adopt 测试同款做法）。"""
    import uuid

    async def _fake(session, *, url=None, b64_data=None, name=None, prefix="files", **kwargs):  # type: ignore[no-untyped-def]
        item = FileItem(
            id=str(uuid.uuid4()),
            type="image",
            name=name or "generated",
            thumbnail=OSS_URL,
            storage_key=f"{prefix}/{uuid.uuid4()}.png",
        )
        session.add(item)
        await session.flush()
        return item

    monkeypatch.setattr(adopt_module, "create_file_from_url_or_b64", _fake)


class _DummyDB:
    """上传路由用例只需要一个能被 Depends 解析的会话占位（服务已被 stub）。"""

    async def get(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return None


def _override_db(db: _DummyDB):  # type: ignore[no-untyped-def]
    async def _get_db() -> AsyncGenerator[_DummyDB, None]:
        yield db

    return _get_db


# ---------------------------------------------------------------------------
# 1) 统一实现的三种结论（上传后验证）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unreachable_upload_is_reported_with_fix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    calls = _install_probe(monkeypatch, 404)

    outcome = await verify_uploaded_url_reachable(OSS_URL, label="封面图")

    assert calls == [OSS_URL]
    assert outcome.reachable is False
    assert outcome.probe["http_status"] == 404
    assert outcome.warnings and "匿名公网访问不可达" in outcome.warnings[0]
    assert "重新上传" in outcome.warnings[0]
    # 修法必须可操作（公共读 / bucket 策略 / 公网基址）
    assert "ACL" in outcome.warnings[0] or "公共读" in outcome.warnings[0]
    # 不泄漏内部标识与本机路径
    assert "file_id" not in outcome.warnings[0]
    assert "/Users/" not in outcome.warnings[0]


@pytest.mark.asyncio
async def test_reachable_upload_produces_no_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    _install_probe(monkeypatch, 200)

    outcome = await verify_uploaded_url_reachable(OSS_URL, label="封面图")

    assert outcome.reachable is True
    assert outcome.probe["result"] == "reachable"
    assert outcome.warnings == []


@pytest.mark.asyncio
async def test_dry_run_does_not_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """演练模式：不触网，如实标注「未验证」（不是失败）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    calls = _install_probe(monkeypatch, None)
    _forbid_any_outbound(monkeypatch)

    outcome = await verify_uploaded_url_reachable(OSS_URL, label="封面图")

    assert calls == []
    assert outcome.reachable is None
    assert outcome.probe["result"] == "skipped"
    assert outcome.warnings == []


@pytest.mark.asyncio
async def test_empty_url_reports_missing_public_address(monkeypatch: pytest.MonkeyPatch) -> None:
    """上传之后连地址都没有（典型：没配 ``s3_public_base_url``）→ 未验证 + 可操作告警。

    注意与「演练模式」的区别：同样 ``reachable=None``，但这里必须告警 ——
    上游**一定**取不到，用户得知道去改哪个配置。
    """
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    calls = _install_probe(monkeypatch, None)

    outcome = await verify_uploaded_url_reachable("   ", label="封面图")

    assert calls == []
    assert outcome.reachable is None
    assert outcome.probe["result"] == reference_preflight.PROBE_RESULT_NO_URL
    assert outcome.warnings == [storage.PUBLIC_BASE_MISSING_REASON]
    assert "s3_public_base_url" in outcome.warnings[0]
    assert "public-read" in outcome.warnings[0]


def test_verify_uploaded_url_reachable_is_single_implementation() -> None:
    """``adopt`` 导出的只是同一个函数（不是第二份实现）。"""
    assert verify_uploaded_url_reachable is reference_preflight.verify_uploaded_url_reachable


# ---------------------------------------------------------------------------
# 2) POST /studio/files/upload：上传后验证 + 响应新字段
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_reachable_marks_true_and_keeps_file(
    monkeypatch: pytest.MonkeyPatch, _stored_url: dict[str, str]
) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    calls = _install_probe(monkeypatch, 200)

    db, engine = await build_session()
    try:
        outcome = await upload_file(db, file=_FakeUploadFile("封面.png"), name="封面图")
        row = await db.get(FileItem, outcome.file.id)
    finally:
        await engine.dispose()

    assert calls == [OSS_URL], "探活的必须是落库后的那个地址，且只探一次"
    assert _stored_url["key"] == "files/封面.png"
    assert outcome.url == OSS_URL
    assert outcome.url_reachable is True
    assert outcome.warnings == []
    assert row is not None, "上传本身成功：文件行必须在库里"

    read = outcome.to_read()
    assert read["url_reachable"] is True
    assert read["url_probe"]["http_status"] == 200
    # 探活明细里既要有状态码，也要有用了哪个方法（HEAD 还是回退 GET）
    assert read["url_probe"]["method"] == read["url_probe"]["probe_method"]
    assert read["url_probe"]["method"] in reference_preflight.PROBE_METHODS
    assert read["warnings"] == []
    # 只增不删：原有字段照旧
    assert read["id"] == outcome.file.id
    assert read["name"] == "封面图"
    assert read["thumbnail"] == OSS_URL
    assert read["type"] == "image"


@pytest.mark.asyncio
async def test_upload_unreachable_warns_but_does_not_block(
    monkeypatch: pytest.MonkeyPatch, _stored_url: dict[str, str]
) -> None:
    """匿名 404（真实故障 A 那个状态）：如实告警，但**上传照旧成功**。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    _install_probe(monkeypatch, 404)

    db, engine = await build_session()
    try:
        outcome = await upload_file(db, file=_FakeUploadFile("封面.png"), name="封面图")
        row = await db.get(FileItem, outcome.file.id)
    finally:
        await engine.dispose()

    assert outcome.url_reachable is False
    assert outcome.url_probe["http_status"] == 404
    assert outcome.url_probe["method"] == "GET", "HEAD 404 之后应回退 GET 复核"
    assert outcome.warnings, "不可达必须告警"
    warning = outcome.warnings[0]
    assert "匿名公网访问不可达" in warning
    assert "404" in warning
    assert "ACL" in warning or "公共读" in warning
    assert "s3_public_base_url" in warning
    assert "file_id" not in warning
    assert "/Users/" not in warning

    # 失败不阻断：库里的文件行仍然存在（只报告，不回滚）
    assert row is not None
    assert row.storage_key == "files/封面.png"


@pytest.mark.asyncio
async def test_upload_without_public_base_reports_missing_address(
    monkeypatch: pytest.MonkeyPatch, _stored_url: dict[str, str]
) -> None:
    """没配 ``s3_public_base_url``：落库地址是空串（不再产 path-style 假地址）+ 明确修法。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    calls = _install_probe(monkeypatch, None)
    _forbid_any_outbound(monkeypatch)
    _stored_url["url"] = ""

    db, engine = await build_session()
    try:
        outcome = await upload_file(db, file=_FakeUploadFile("封面.png"), name="封面图")
        row = await db.get(FileItem, outcome.file.id)
    finally:
        await engine.dispose()

    assert calls == []
    assert outcome.url == ""
    assert outcome.url_reachable is None
    assert outcome.url_probe["result"] == reference_preflight.PROBE_RESULT_NO_URL
    assert outcome.warnings and "s3_public_base_url" in outcome.warnings[0]
    assert row is not None, "没有公网地址也不阻断上传（文件已落库）"


@pytest.mark.asyncio
async def test_upload_dry_run_never_probes_and_never_uploads(
    monkeypatch: pytest.MonkeyPatch, _stored_url: dict[str, str]
) -> None:
    """DRY_RUN：上传被**对象存储出口守卫**拦在写入之前 —— 不探活、不上传、不落库。

    口径修正（演练验收 D2）：写对象存储是「oss」付费出口，演练模式下**一个字节都不上传**、
    不写 ``files`` 行，返回与其它出口同一套结构化 409。此前这里断言的是「上传落库照旧、
    只是不探活」，那正是「演练模式下仍然真实写 OSS」那个缺陷的测试化版本。
    """
    from app.services import paid_outlet_guard as guard

    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    calls = _install_probe(monkeypatch, None)
    _forbid_any_outbound(monkeypatch)
    uploaded: list[str] = []

    async def _no_upload(*, key, data, content_type=None, extra_args=None):  # type: ignore[no-untyped-def]
        uploaded.append(key)
        raise AssertionError("演练模式下不应有人调用 storage.upload_file")

    monkeypatch.setattr(storage, "upload_file", _no_upload)

    db, engine = await build_session()
    try:
        with pytest.raises(guard.PaidOutletBlocked) as caught:
            await upload_file(db, file=_FakeUploadFile("封面.png"), name="封面图")
        rows = (await db.execute(select(func.count()).select_from(FileItem))).scalar_one()
    finally:
        await engine.dispose()

    assert caught.value.status_code == 409
    assert caught.value.payload["reason"] == "dry_run"
    assert caught.value.payload["outlet"] == "oss"
    assert caught.value.payload["paid_call_made"] is False
    assert uploaded == []
    assert calls == []
    assert rows == 0


def test_upload_api_response_shape_carries_reachability(client: TestClient, monkeypatch) -> None:
    """HTTP 响应壳：新增字段必须真的出现在 JSON 里（不是被 response_model 吃掉）。

    不用 ``with TestClient(app)`` —— 那样会跑 lifespan（含对象存储 HeadBucket 探测）。
    """
    now = datetime.now(UTC)
    file_item = FileItem(
        id="file-up-1",
        type=FileType.image,
        name="封面图",
        thumbnail=OSS_URL,
        tags=["cover"],
        storage_key="files/封面.png",
    )
    file_item.created_at = now
    file_item.updated_at = now
    outcome = UploadFileOutcome(
        file=file_item,
        url=OSS_URL,
        url_reachable=False,
        url_probe={"result": "unreachable", "http_status": 404, "probe_method": "GET", "method": "GET"},
        warnings=["已入库，但「封面图」的地址**匿名公网访问不可达**（HTTP 404）：…"],
    )

    async def _fake_upload(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return outcome

    monkeypatch.setattr(files_route, "upload_file", _fake_upload)
    app.dependency_overrides[get_db] = _override_db(_DummyDB())
    try:
        response = client.post(
            "/api/v1/studio/files/upload",
            files={"file": ("封面.png", b"stub-bytes", "image/png")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == 201
    data = body["data"]
    # 原有字段不删
    assert data["id"] == "file-up-1"
    assert data["type"] == "image"
    assert data["name"] == "封面图"
    assert data["thumbnail"] == OSS_URL
    assert data["tags"] == ["cover"]
    # 新增字段
    assert data["url"] == OSS_URL
    assert data["url_reachable"] is False
    assert data["url_probe"]["http_status"] == 404
    assert data["url_probe"]["probe_method"] == "GET"
    assert data["warnings"]


# ---------------------------------------------------------------------------
# 3) 采纳端点：走同一个实现（只报告，不阻断）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adopt_reports_unreachable_url_without_blocking(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    _install_probe(monkeypatch, 404)

    db, engine = await build_session()
    try:
        db.add(Character(id="char-1", project_id="proj-1", name="林晓", description="女主", style="真人都市"))
        await db.flush()
        adopted = await adopt_generated_image(
            db,
            entity_type="character",
            entity_id="char-1",
            url="https://cdn.example.com/generated.png",
        )
        row = await db.get(CharacterImage, adopted.image_id)
    finally:
        await engine.dispose()

    # 采纳本身照旧成功（图已经落库了），但如实报告地址不可达
    assert adopted.file_id
    assert row is not None and row.file_id == adopted.file_id
    assert adopted.url_reachable is False
    assert adopted.url_probe["http_status"] == 404
    assert adopted.warnings and "匿名公网访问不可达" in adopted.warnings[0]

    read = adopted.to_read()
    assert read["url_reachable"] is False
    assert read["url_probe"]["result"] == "unreachable"
    assert read["warnings"]


@pytest.mark.asyncio
async def test_adopt_dry_run_marks_reachability_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    calls = _install_probe(monkeypatch, None)
    _forbid_any_outbound(monkeypatch)

    db, engine = await build_session()
    try:
        db.add(Prop(id="prop-1", name="玉佩", description="x", style="真人都市"))
        await db.flush()
        adopted = await adopt_generated_image(
            db,
            entity_type="prop",
            entity_id="prop-1",
            url="https://cdn.example.com/generated.png",
        )
    finally:
        await engine.dispose()

    assert calls == []
    assert adopted.url_reachable is None
    assert adopted.url_probe["result"] == "skipped"
    assert adopted.warnings == []
