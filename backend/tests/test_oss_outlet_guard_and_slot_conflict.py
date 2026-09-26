"""演练模式下的**对象存储写入守卫** + 同槽位重复建图的**结构化 409**。

本文件锁住两个演练验收挖出的后端缺陷（D2 / D4）：

D2（安全）：``JELLYFISH_DRY_RUN=1`` 时 ``POST /api/v1/studio/files/upload`` 仍然**真实写入
OSS**（201 + 真实公网地址），而状态接口把 ``oss`` 出口标成 ``allowed=false`` —— 口径自相
矛盾。要求：

1. 「对象存储上传」与出图 / 出视频 / 大模型走**同一套**闸门
   （``paid_outlet_guard.require_outlet``），不允许自造第二套守卫；
2. 演练模式：**一个字节都不上传、不写文件记录**，返回结构化 409
   （中文 ``message`` + ``reason=dry_run`` + ``how_to_enable`` + ``paid_call_made=false``）；
3. 本地驱动（``is_local_storage()``）落盘**不是** OSS 上传，不能被误伤；
4. 真实模式照旧可用（不能改成默认拒绝真实上传）。

D4：对已有 ``FRONT/LOW`` 槽位的角色再建同槽位图 → ``IntegrityError`` 穿透成 500。要求转成
结构化 409（中文说明「该槽位已存在」+ 改法），其它完整性错误照旧抛出，不吞。

**全程零出网**：

- 对象存储客户端构造（``storage._build_s3_client``）被换成「被调用即 AssertionError」；
- ``httpx.AsyncClient.send`` 除了进程内 ``MockTransport`` 以外一律 AssertionError；
- ``init_storage``（lifespan 里的只读 HeadBucket）被屏蔽；
- 演练模式用例把 ``storage.upload_file`` 换成一个调用即 AssertionError 的桩。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core import storage
from app.dependencies import get_db
from app.main import app
from app.models.studio import Character, CharacterImage, FileItem
from app.services import paid_outlet_guard as guard
from app.services.studio.entity_images import (
    SLOT_CONFLICT_CODE,
    EntityImageSlotConflict,
    create_entity_image,
)
from app.services.studio.files import upload_file
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.llm_orchestration import dry_run
from app.utils.files import create_file_from_url_or_b64
from tests.llm_orchestration_fixtures import build_session

#: 落库地址用一个**测试专用**的假桶（不指向任何真实 OSS）。
OSS_URL = "https://test-bucket.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/cover.png"

UPLOAD_URL = "/api/v1/studio/files/upload"

#: 真探活实现 / 真 send：注入桩之后仍要能调到它们，否则桩会递归调自己。
_REAL_PROBE = reference_preflight.probe_reference_url
_ORIGINAL_ASYNC_SEND = httpx.AsyncClient.send


# ---------------------------------------------------------------------------
# 0) 脚手架：零出网 + S3 驱动 + 上传函数桩
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _no_real_outbound(monkeypatch: pytest.MonkeyPatch):
    """任何真实出网都直接失败；顺带屏蔽 lifespan 里的只读 HeadBucket。"""

    def _boom_client(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("本文件不该构造对象存储客户端（构造即可能真实出网）")

    async def _guarded_send(self: httpx.AsyncClient, request: httpx.Request, *args: Any, **kwargs: Any):
        # 只用进程内 MockTransport（探活的测试桩）放行，其余一律视为真实出网。
        if isinstance(getattr(self, "_transport", None), httpx.MockTransport):
            return await _ORIGINAL_ASYNC_SEND(self, request, *args, **kwargs)
        raise AssertionError(f"本文件不该有任何真实出网：{request.method} {request.url}")

    monkeypatch.setattr(storage, "_build_s3_client", _boom_client)
    monkeypatch.setattr("app.main.init_storage", lambda: None)
    monkeypatch.setattr(httpx.AsyncClient, "send", _guarded_send)
    dry_run.clear_audit_log()
    yield
    dry_run.clear_audit_log()


@pytest.fixture(autouse=True)
def _s3_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认按 **S3 驱动**跑：只有这个驱动下「写存储」才是 OSS 上传，守卫才有意义。

    用假桶名，绝不指向 ``backend/.env`` 里的真实桶。
    """
    monkeypatch.setattr(settings, "storage_driver", "s3", raising=False)
    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket", raising=False)
    monkeypatch.setattr(settings, "s3_base_path", "", raising=False)
    monkeypatch.setattr(
        settings, "s3_public_base_url", "https://test-bucket.oss-cn-beijing.aliyuncs.com", raising=False
    )


@pytest.fixture
def _upload_forbidden(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """演练模式用例：上传函数被调用就是失败（「任何出网即 AssertionError」的桩）。"""
    calls: list[str] = []

    async def _boom(*, key: str, data: Any, content_type: Any = None, extra_args: Any = None) -> Any:
        calls.append(key)
        raise AssertionError("演练模式下不应调用 storage.upload_file：一个字节都不该上传")

    monkeypatch.setattr(storage, "upload_file", _boom)
    return calls


@pytest.fixture
def _upload_spy(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[dict[str, Any]]]:
    """真实模式 / 本地驱动用例：记录每一次「写存储」的入参。"""
    state: dict[str, list[dict[str, Any]]] = {"calls": []}

    async def _fake_upload_file(*, key: str, data: Any, content_type: Any = None, extra_args: Any = None) -> Any:
        size = len(data) if isinstance(data, (bytes, bytearray)) else None
        state["calls"].append(
            {"key": key, "acl": extra_args, "size": size, "content_type": content_type}
        )
        return storage.StoredFileInfo(
            key=key, url=OSS_URL, size=size, content_type=content_type, etag="stub-etag"
        )

    monkeypatch.setattr(storage, "upload_file", _fake_upload_file)
    return state


def _stub_probe(monkeypatch: pytest.MonkeyPatch, status: int = 200) -> list[str]:
    """探活换成 MockTransport（进程内，不出网）；``status`` 控制结论。"""
    calls: list[str] = []

    async def _probe(url: str, *, label: str = "", **kwargs: Any) -> Any:
        calls.append(url)
        return await _REAL_PROBE(
            url,
            label=label,
            transport=httpx.MockTransport(lambda _request: httpx.Response(status)),
        )

    monkeypatch.setattr(reference_preflight, "probe_reference_url", _probe)
    return calls


class _FakeUploadFile:
    """够用的 UploadFile 替身（只用到 filename / content_type / read）。"""

    def __init__(
        self, filename: str = "封面.png", *, content_type: str = "image/png", data: bytes = b"\x89PNG-stub"
    ) -> None:
        self.filename = filename
        self.content_type = content_type
        self._data = data

    async def read(self) -> bytes:
        return self._data


class _RecordingDB:
    """路由用例的会话占位：记录 ``add``，证明**没有写任何文件行**。"""

    def __init__(self) -> None:
        self.added: list[Any] = []

    async def get(self, *_args: Any, **_kwargs: Any) -> Any:
        return None

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def refresh(self, *_args: Any, **_kwargs: Any) -> None:
        return None


def _override_db(db: Any):
    async def _get_db() -> AsyncGenerator[Any, None]:
        yield db

    return _get_db


async def _count_rows(db: AsyncSession, model: Any) -> int:
    result = await db.execute(select(func.count()).select_from(model))
    return int(result.scalar_one())


# ---------------------------------------------------------------------------
# 1) D2 · 服务层：演练模式必须在上传之前被拦（0 次上传 + 0 行）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_service_dry_run_blocks_before_upload_and_writes_no_row(
    monkeypatch: pytest.MonkeyPatch, _upload_forbidden: list[str]
) -> None:
    """演练模式：抛结构化 409（oss 出口），上传函数 0 次调用，``files`` 表 0 行。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "1")
    monkeypatch.delenv(dry_run.CONFIRM_ENV, raising=False)

    db, engine = await build_session()
    try:
        with pytest.raises(guard.PaidOutletBlocked) as caught:
            await upload_file(db, file=_FakeUploadFile(), name="封面图")
        rows = await _count_rows(db, FileItem)
    finally:
        await engine.dispose()

    payload = caught.value.payload
    assert caught.value.status_code == guard.BLOCKED_STATUS_CODE == 409
    assert _upload_forbidden == [], "演练模式下上传函数必须一次都没被调用"
    assert rows == 0, "演练模式不写 files 记录"

    # 与其它付费出口同一套口径（reason / how_to_enable / paid_call_made）
    assert payload["code"] == guard.BLOCKED_ERROR_CODE
    assert payload["reason"] == dry_run.BLOCKED_REASON_DRY_RUN
    assert payload["outlet"] == guard.OUTLET_OSS == dry_run.OUTLET_OSS == "oss"
    assert payload["outlet_label"] == "对象存储上传"
    assert "[DRY_RUN]" in payload["message"] and "对象存储上传" in payload["message"]
    assert "对象存储" in payload["message"]
    assert f"{dry_run.DRY_RUN_ENV}=0" in payload["how_to_enable"]
    assert f"{dry_run.CONFIRM_ENV}=1" in payload["how_to_enable"]
    assert any("重启" in step for step in payload["enable_steps"])
    assert payload["paid_call_made"] is False
    assert payload["guard"]["mode"] == dry_run.MODE_DRY_RUN

    # 审计日志如实记录是哪个出口被拦（排查用）
    blocked = [item for item in dry_run.audit_log() if item["action"] == "blocked"]
    assert blocked and blocked[-1]["target"] == guard.OUTLET_OSS


def test_upload_endpoint_dry_run_returns_structured_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, _upload_forbidden: list[str]
) -> None:
    """HTTP 层：``POST /studio/files/upload`` 演练模式返回结构化 409，且没有写任何行。

    不用 ``with TestClient(app)``（那会跑 lifespan）；``init_storage`` 另有屏蔽。
    """
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "1")
    monkeypatch.delenv(dry_run.CONFIRM_ENV, raising=False)
    db = _RecordingDB()
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.post(UPLOAD_URL, files={"file": ("封面.png", b"stub-bytes", "image/png")})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == 409
    assert body["data"] is None
    assert "[DRY_RUN]" in body["message"]

    error = body["meta"]["error"]
    assert error["code"] == guard.BLOCKED_ERROR_CODE
    assert error["reason"] == dry_run.BLOCKED_REASON_DRY_RUN
    assert error["outlet"] == "oss"
    assert error["outlet_label"] == "对象存储上传"
    assert error["paid_call_made"] is False
    assert f"{dry_run.DRY_RUN_ENV}=0" in error["how_to_enable"]
    assert error["guard"]["mode"] == dry_run.MODE_DRY_RUN

    assert _upload_forbidden == [], "被拦时连上传函数都不该进"
    assert db.added == [], "被拦时不该写任何 FileItem 行"


@pytest.mark.asyncio
async def test_upload_service_real_mode_still_uploads(
    monkeypatch: pytest.MonkeyPatch, _upload_spy: dict[str, list[dict[str, Any]]]
) -> None:
    """真实模式（显式关闸 + 确认）：照旧上传成功 —— 不能改成默认拒绝真实上传。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.setenv(dry_run.CONFIRM_ENV, "1")
    _stub_probe(monkeypatch, 200)

    db, engine = await build_session()
    try:
        outcome = await upload_file(db, file=_FakeUploadFile(), name="封面图")
        row = await db.get(FileItem, outcome.file.id)
    finally:
        await engine.dispose()

    assert len(_upload_spy["calls"]) == 1
    assert _upload_spy["calls"][0]["acl"] == {"ACL": "public-read"}
    assert outcome.url == OSS_URL
    assert outcome.url_reachable is True
    assert row is not None and row.storage_key == "files/封面.png"
    assert [item["action"] for item in dry_run.audit_log()] == ["allowed_real"]


@pytest.mark.asyncio
async def test_upload_service_local_driver_is_not_blocked_in_dry_run(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    """本地驱动落盘**不是** OSS 上传：演练模式下照旧可用（不能误伤单机用法）。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "1")
    monkeypatch.delenv(dry_run.CONFIRM_ENV, raising=False)
    monkeypatch.setattr(settings, "storage_driver", "local", raising=False)
    monkeypatch.setattr(settings, "local_storage_root", str(tmp_path / "storage"), raising=False)
    monkeypatch.setattr(settings, "local_storage_base_url", "", raising=False)
    assert storage.is_local_storage() is True

    db, engine = await build_session()
    try:
        outcome = await upload_file(db, file=_FakeUploadFile(), name="封面图")
        row = await db.get(FileItem, outcome.file.id)
    finally:
        await engine.dispose()

    assert row is not None, "本地驱动下演练模式照旧落盘落库"
    assert (tmp_path / "storage" / "files" / "封面.png").is_file(), "字节真的写到本地磁盘"
    # 本地驱动的地址是本机回放地址（``/files/...``），不是公网地址
    assert storage.is_public_url(outcome.url) is False


# ---------------------------------------------------------------------------
# 2) D2 · ``create_file_from_url_or_b64``（落库上传）同一道闸门
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_file_from_url_or_b64_dry_run_blocks_before_download(
    monkeypatch: pytest.MonkeyPatch, _upload_forbidden: list[str]
) -> None:
    """演练模式：守卫在**下载之前**，所以既不出网也不落库（httpx 出站被换成 AssertionError）。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "1")
    monkeypatch.delenv(dry_run.CONFIRM_ENV, raising=False)

    db, engine = await build_session()
    try:
        with pytest.raises(guard.PaidOutletBlocked) as caught:
            await create_file_from_url_or_b64(
                db, url="https://cdn.example.com/generated.png", name="生成图"
            )
        rows = await _count_rows(db, FileItem)
    finally:
        await engine.dispose()

    assert caught.value.status_code == 409
    assert caught.value.payload["reason"] == dry_run.BLOCKED_REASON_DRY_RUN
    assert caught.value.payload["outlet"] == "oss"
    assert _upload_forbidden == []
    assert rows == 0


@pytest.mark.asyncio
async def test_create_file_from_url_or_b64_real_mode_uploads(
    monkeypatch: pytest.MonkeyPatch, _upload_spy: dict[str, list[dict[str, Any]]]
) -> None:
    """真实模式：照旧上传 + 落库（b64 路径不下载，天然不出网）。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.setenv(dry_run.CONFIRM_ENV, "1")

    db, engine = await build_session()
    try:
        item = await create_file_from_url_or_b64(
            db, b64_data="data:image/png;base64,aGVsbG8=", name="生成图"
        )
    finally:
        await engine.dispose()

    assert len(_upload_spy["calls"]) == 1
    assert _upload_spy["calls"][0]["acl"] == {"ACL": "public-read"}
    assert item.storage_key.startswith("files/")
    assert item.thumbnail == OSS_URL


@pytest.mark.asyncio
async def test_create_file_from_url_or_b64_local_driver_is_not_blocked_in_dry_run(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    """本地驱动 + 演练模式：b64 落库照旧（本地落盘不算 OSS 上传）。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "1")
    monkeypatch.delenv(dry_run.CONFIRM_ENV, raising=False)
    monkeypatch.setattr(settings, "storage_driver", "local", raising=False)
    monkeypatch.setattr(settings, "local_storage_root", str(tmp_path / "storage"), raising=False)
    monkeypatch.setattr(settings, "local_storage_base_url", "", raising=False)

    db, engine = await build_session()
    try:
        item = await create_file_from_url_or_b64(
            db, b64_data="data:image/png;base64,aGVsbG8=", name="生成图"
        )
    finally:
        await engine.dispose()

    assert item.storage_key.startswith("files/")
    written = list((tmp_path / "storage" / "files").glob("*.png"))
    assert written, "本地驱动下应真的写出文件"


# ---------------------------------------------------------------------------
# 3) D4 · 同槽位重复建图 → 结构化 409（而不是 500），且库里仍只有一行
# ---------------------------------------------------------------------------


async def _seed_character_with_slot(db: AsyncSession, *, image_id: int | None = 1) -> None:
    db.add(
        Character(id="char-1", project_id="proj-1", name="林晓", description="女主", style="真人都市")
    )
    await db.flush()
    if image_id is not None:
        db.add(
            CharacterImage(
                id=image_id, character_id="char-1", view_angle="FRONT", quality_level="LOW"
            )
        )
        await db.flush()


@pytest.mark.asyncio
async def test_duplicate_slot_create_returns_409_and_keeps_single_row() -> None:
    """服务层：同槽位再建 → 409 结构化明细；库里仍只有一行；会话仍可继续用。"""
    db, engine = await build_session()
    try:
        await _seed_character_with_slot(db)

        with pytest.raises(EntityImageSlotConflict) as caught:
            await create_entity_image(
                db,
                entity_type="character",
                entity_id="char-1",
                body={"view_angle": "FRONT", "quality_level": "LOW"},
            )

        detail = caught.value.detail
        assert caught.value.status_code == 409
        assert await _count_rows(db, CharacterImage) == 1, "冲突之后库里仍然只有一行"

        # 会话没被留在 pending rollback：换一个槽位照旧能建
        payload = await create_entity_image(
            db,
            entity_type="character",
            entity_id="char-1",
            body={"view_angle": "BACK", "quality_level": "LOW"},
        )
        rows = (await db.execute(select(CharacterImage).order_by(CharacterImage.id))).scalars().all()
    finally:
        await engine.dispose()

    assert detail["code"] == SLOT_CONFLICT_CODE
    assert "该槽位已存在" in detail["message"]
    assert "LOW" in detail["message"] and "FRONT" in detail["message"]
    assert detail["quality_level"] == "LOW" and detail["view_angle"] == "FRONT"
    assert detail["existing_image_id"] == 1
    assert "更新" in detail["how_to_fix"] and "PATCH" in detail["how_to_fix"]
    assert detail["paid_call_made"] is False
    assert "没有新建" in detail["note"]

    assert payload["view_angle"] == "BACK"
    assert [(row.id, row.view_angle) for row in rows] == [(1, "FRONT"), (2, "BACK")]


@pytest.mark.asyncio
async def test_duplicate_slot_seeds_are_clean_after_conflict() -> None:
    """连续两次同槽位冲突：每次都 409、每次都只有一行（不会因为回滚失败变成 500）。"""
    db, engine = await build_session()
    try:
        await _seed_character_with_slot(db, image_id=None)
        first = await create_entity_image(
            db, entity_type="character", entity_id="char-1", body={"view_angle": "FRONT", "quality_level": "LOW"}
        )
        assert first["view_angle"] == "FRONT"

        for _ in range(2):
            with pytest.raises(EntityImageSlotConflict):
                await create_entity_image(
                    db,
                    entity_type="character",
                    entity_id="char-1",
                    body={"view_angle": "FRONT", "quality_level": "LOW"},
                )
            assert await _count_rows(db, CharacterImage) == 1
    finally:
        await engine.dispose()


class _NestedStub:
    """``begin_nested()`` 的替身：进入/退出什么都不做，异常照常向外传。"""

    async def __aenter__(self) -> "_NestedStub":
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        return False


class _NonSlotIntegritySession:
    """把 ``flush`` 换成抛**非槽位**完整性错误的代理：证明其它异常不被吞掉。"""

    def __init__(self, inner: AsyncSession, message: str) -> None:
        self._inner = inner
        self._message = message

    def begin_nested(self) -> _NestedStub:
        return _NestedStub()

    async def flush(self) -> None:
        raise IntegrityError("INSERT INTO x", {}, Exception(self._message))

    async def rollback(self) -> None:
        await self._inner.rollback()

    def add(self, obj: Any) -> None:
        self._inner.add(obj)

    async def get(self, *args: Any, **kwargs: Any) -> Any:
        return await self._inner.get(*args, **kwargs)

    async def execute(self, *args: Any, **kwargs: Any) -> Any:
        return await self._inner.execute(*args, **kwargs)

    async def refresh(self, *args: Any, **kwargs: Any) -> Any:
        return await self._inner.refresh(*args, **kwargs)


@pytest.mark.asyncio
async def test_other_integrity_errors_are_not_swallowed() -> None:
    """不是槽位唯一约束的完整性错误必须原样抛出（不能都变成 409）。"""
    db, engine = await build_session()
    try:
        await _seed_character_with_slot(db, image_id=None)
        proxy = _NonSlotIntegritySession(
            db, "UNIQUE constraint failed: characters.project_id, name"
        )
        with pytest.raises(IntegrityError):
            await create_entity_image(
                proxy,  # type: ignore[arg-type]
                entity_type="character",
                entity_id="char-1",
                body={"view_angle": "FRONT", "quality_level": "LOW"},
            )
    finally:
        await engine.dispose()


def test_slot_conflict_classifier_only_accepts_slot_unique_violation() -> None:
    """分类器只认「槽位唯一约束」：SQLite 的列名文本与命名约束两种形态都认，别的都不认。"""
    from app.services.studio.entity_images import _is_slot_conflict  # noqa: PLC0415

    sqlite_slot = IntegrityError(
        "stmt", {},
        Exception("UNIQUE constraint failed: character_images.character_id, quality_level, view_angle"),
    )
    named_slot = IntegrityError(
        "stmt", {}, Exception('duplicate key value violates unique constraint "uq_prop_images_quality_angle"')
    )
    other_unique = IntegrityError(
        "stmt", {}, Exception("UNIQUE constraint failed: characters.project_id, name")
    )
    foreign_key = IntegrityError("stmt", {}, Exception("FOREIGN KEY constraint failed"))

    assert _is_slot_conflict(sqlite_slot) is True
    assert _is_slot_conflict(named_slot) is True
    assert _is_slot_conflict(other_unique) is False
    assert _is_slot_conflict(foreign_key) is False


# ---------------------------------------------------------------------------
# 4) D4 · 路由层：结构化 409 的响应形状（原来是 500）
# ---------------------------------------------------------------------------


def _build_route_db():
    import app.models  # noqa: F401  # 注册全部表（Base.metadata 需要模型模块被 import）

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    asyncio.run(_create_all(engine))
    return factory, engine


async def _create_all(engine: Any) -> None:
    from app.core.db import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _override_route_db(factory: async_sessionmaker[AsyncSession]):
    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return _get_db


async def _seed_route_slot(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as session:
        await _seed_character_with_slot(session)
        await session.commit()


async def _route_rows(factory: async_sessionmaker[AsyncSession]) -> list[CharacterImage]:
    async with factory() as session:
        result = await session.execute(select(CharacterImage).order_by(CharacterImage.id))
        return list(result.scalars().all())


def test_duplicate_slot_route_returns_structured_409(client: TestClient) -> None:
    """HTTP 层：同槽位重复 POST → 409 + ``meta.error``（此前是 IntegrityError → 500）。"""
    factory, engine = _build_route_db()
    app.dependency_overrides[get_db] = _override_route_db(factory)
    try:
        asyncio.run(_seed_route_slot(factory))
        response = client.post(
            "/api/v1/studio/entities/character/char-1/images",
            json={"view_angle": "FRONT", "quality_level": "LOW"},
        )
        assert response.status_code == 409, response.text
        body = response.json()
        error = body["meta"]["error"]
        rows = asyncio.run(_route_rows(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert body["code"] == 409
    assert body["data"] is None
    assert error["code"] == SLOT_CONFLICT_CODE
    assert "该槽位已存在" in error["message"]
    assert "该槽位已存在" in body["message"]
    assert error["existing_image_id"] == 1
    assert error["paid_call_made"] is False
    assert len(rows) == 1 and rows[0].view_angle == "FRONT"


def test_new_slot_route_still_creates_row(client: TestClient) -> None:
    """同一个写入路径：换一个槽位照旧 201（修复不能把正常建图堵死）。"""
    factory, engine = _build_route_db()
    app.dependency_overrides[get_db] = _override_route_db(factory)
    try:
        asyncio.run(_seed_route_slot(factory))
        response = client.post(
            "/api/v1/studio/entities/character/char-1/images",
            json={"view_angle": "BACK", "quality_level": "LOW"},
        )
        rows = asyncio.run(_route_rows(factory))
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())

    assert response.status_code == 201, response.text
    assert response.json()["data"]["view_angle"] == "BACK"
    assert [row.view_angle for row in rows] == ["FRONT", "BACK"]
