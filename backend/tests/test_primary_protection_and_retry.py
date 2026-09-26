"""定版保护（不得静默替换定版）+ 重试键（失败项可重试）的回归测试。

用户明确要求两件事，本文件把它们钉成可回归的事实：

1. **不得静默替换定版**：``/adopt`` 的 ``set_primary`` 默认 ``false``；该资产已有定版图
   （``is_primary=True`` 且 ``file_id`` 非空）而本次会顶掉它时，必须显式传
   ``confirm_replace_primary=true``，否则结构化 **409**，并且**库里一行都不改**
   （判定发生在下载/入库之前）；``entity_images`` 的 create / update 两条写入路径同一口径。
2. **失败项可重试**：``build_source_task_id`` 支持 ``attempt``；``attempt=0`` 与改动前
   **逐字一致**（历史幂等键不改），``attempt>0`` 拿到**新键**；提交链路把 ``attempt``
   透传下去，并在结果里回显本次真正使用的 ``source_task_id``；同一 ``attempt`` 重复提交
   仍是同一个键（上游去重，不会重复下单）。

**零真实出网**：下载入库 → stub，匿名探活 → stub/演练短路，出图服务 → DRY_RUN 占位；
DRY_RUN 由 ``tests/conftest.py`` 钉死，本文件不打开任何守卫。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio import Character, CharacterImage, FileItem, Project, Prop, PropImage
from app.schemas.studio.image_pipeline import AdoptImageRequest
from app.services.studio import entity_images as entity_images_service
from app.services.studio.image_pipeline import adopt as adopt_module
from app.services.studio.image_pipeline.adopt import adopt_generated_image
from app.services.studio.image_pipeline.image_pipeline import (
    build_source_task_id,
    build_targets,
)
from app.services.studio.image_pipeline.reference_preflight import UploadReachability
from app.services.studio.primary_protection import PRIMARY_REPLACE_REQUIRED_CODE
from tests.llm_orchestration_fixtures import build_session

REAL_URL = "https://oss.example.com/generated/new-char.png"
OLD_FILE_ID = "file-old-primary"
OLD_STORAGE_KEY = "jellyfish/proj-1/character/char-1_front.png"


# ---------------------------------------------------------------------------
# 公共桩：下载入库 + 探活（一个字节都不出网）
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _stub_adopt_io(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    """把「下载远端图片 + 上传存储」和「匿名探活」都换成记录型 stub。

    记录下载次数是为了断言 409 分支**连下载都没发生**（也就不会有任何 files 行）。
    """
    calls: dict[str, list[str]] = {"download": [], "probe": []}

    async def _fake_download(session, *, url=None, b64_data=None, name=None, prefix="files", **kwargs):  # type: ignore[no-untyped-def]
        calls["download"].append(str(url))
        item = FileItem(
            id=str(uuid.uuid4()),
            type="image",
            name=name or "generated",
            thumbnail=str(url),
            storage_key=f"{prefix}/{uuid.uuid4()}.png",
        )
        session.add(item)
        await session.flush()
        return item

    async def _fake_probe(url: str, **kwargs):  # type: ignore[no-untyped-def]
        calls["probe"].append(str(url))
        return UploadReachability(
            url=str(url), reachable=True, probe={"result": "reachable", "http_status": 200}
        )

    monkeypatch.setattr(adopt_module, "create_file_from_url_or_b64", _fake_download)
    monkeypatch.setattr(adopt_module, "verify_uploaded_url_reachable", _fake_probe)
    monkeypatch.setattr("app.utils.files.create_file_from_url_or_b64", _fake_download)
    return calls


@pytest.fixture(autouse=True)
def _no_real_storage_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """测试期**一个字节都不出网**：把 app 启动时的对象存储初始化换掉。

    `with TestClient(app)` 会跑 lifespan，而 lifespan 里的 ``init_storage()`` 在配了 S3 的
    机器上会真的发一次 ``HeadBucket``（本机实测返回 403）。本文件要的是「零真实出网」，
    所以这里把它替换成空实现（只影响本文件的用例）。
    """
    import app.main as main_module  # noqa: PLC0415 - 只为在这个文件里做局部隔离

    monkeypatch.setattr(main_module, "init_storage", lambda: None)


async def _seed_character_with_primary(db: AsyncSession, *, entity_id: str = "char-1") -> None:
    """一个角色 + 一张**已定版且已绑图**的槽位（定版图文件名「旧定版.png」）。"""
    db.add(Character(id=entity_id, project_id="proj-1", name="林晓", description="女主", style="真人都市"))
    db.add(
        FileItem(
            id=OLD_FILE_ID,
            type="image",
            name="旧定版.png",
            thumbnail="https://oss.example.com/old-primary.png",
            storage_key=OLD_STORAGE_KEY,
        )
    )
    await db.flush()
    db.add(
        CharacterImage(
            id=1,
            character_id=entity_id,
            file_id=OLD_FILE_ID,
            is_primary=True,
            view_angle="FRONT",
            quality_level="HIGH",
        )
    )
    await db.flush()


async def _all_images(db: AsyncSession, model: type) -> list[object]:    return list((await db.execute(select(model))).scalars().all())


async def _count(db: AsyncSession, model: type) -> int:
    return len(await _all_images(db, model))


# ---------------------------------------------------------------------------
# 1) /adopt：默认不设版 + 已有定版必须显式确认
# ---------------------------------------------------------------------------


def test_adopt_request_schema_defaults_to_not_setting_primary() -> None:
    """①④ 请求 schema：``set_primary`` 默认 false，``confirm_replace_primary`` 默认 false。"""
    body = AdoptImageRequest(entity_type="character", entity_id="char-1", url=REAL_URL)
    assert body.set_primary is False
    assert body.confirm_replace_primary is False
    # 字段名没改（向后兼容：老调用方传 set_primary=true 照旧有效）
    assert AdoptImageRequest(
        entity_type="character", entity_id="char-1", url=REAL_URL, set_primary=True
    ).set_primary is True


@pytest.mark.asyncio
async def test_adopt_sets_primary_when_no_existing_primary_image() -> None:
    """① 没有定版时，显式 set_primary=true 正常设版（不弹 409）。"""
    db, engine = await build_session()
    async with db:
        db.add(Prop(id="prop-1", name="交付文档", description="x", style="真人都市"))
        await db.flush()

        adopted = await adopt_generated_image(
            db, entity_type="prop", entity_id="prop-1", url=REAL_URL, set_primary=True
        )
        assert adopted.is_primary is True
        assert adopted.replaced_primary is None
        row = await db.get(PropImage, adopted.image_id)
        assert row is not None and row.is_primary is True and row.file_id == adopted.file_id
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_default_does_not_set_primary_anymore() -> None:
    """④ 不传 set_primary 时**不再**默认设版（改动前默认 true）。"""
    db, engine = await build_session()
    async with db:
        db.add(Prop(id="prop-1", name="交付文档", description="x", style="真人都市"))
        await db.flush()

        adopted = await adopt_generated_image(db, entity_type="prop", entity_id="prop-1", url=REAL_URL)
        assert adopted.is_primary is False
        row = await db.get(PropImage, adopted.image_id)
        assert row is not None and row.is_primary is False
        assert row.file_id == adopted.file_id  # 图照旧写进去了
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_409_without_confirmation_and_nothing_written(
    _stub_adopt_io: dict[str, list[str]],
) -> None:
    """② 已有定版且未确认 → 409；库里一行未改，连下载都没发生。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)
        before_files = await _count(db, FileItem)

        with pytest.raises(HTTPException) as exc_info:
            # 不传 image_id → 复用第一个槽位（id asc），而它正是当前定版那一行
            await adopt_generated_image(db, entity_type="character", entity_id="char-1", url=REAL_URL)

        exc = exc_info.value
        assert exc.status_code == 409
        detail = exc.detail
        assert isinstance(detail, dict)
        assert detail["code"] == PRIMARY_REPLACE_REQUIRED_CODE
        assert "已有定版图" in detail["message"]
        assert "confirm_replace_primary=true" in detail["message"]
        # 只读摘要：槽位 id / 文件名 / 是否 OSS 公网地址
        assert detail["existing_primary"] == {
            "image_id": 1,
            "file_name": "旧定版.png",
            "url_is_public": True,
        }
        # 不输出凭证、不输出本机绝对路径、不输出 file_id
        dumped = json.dumps(detail, ensure_ascii=False)
        assert OLD_STORAGE_KEY not in dumped
        assert OLD_FILE_ID not in dumped
        assert "/Users/" not in dumped
        assert "oss.example.com" not in dumped

        # 库里一行未改
        rows = await _all_images(db, CharacterImage)
        assert len(rows) == 1
        assert rows[0].file_id == OLD_FILE_ID
        assert rows[0].is_primary is True
        assert await _count(db, FileItem) == before_files
        assert _stub_adopt_io["download"] == []  # 判定在下载之前
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_with_confirmation_replaces_and_echoes_old_primary(
    _stub_adopt_io: dict[str, list[str]],
) -> None:
    """③ 已有定版 + 显式确认 → 替换成功，响应回显被替换的槽位 id 与文件名。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)
        db.add(CharacterImage(id=2, character_id="char-1", view_angle="BACK", quality_level="LOW"))
        await db.flush()

        adopted = await adopt_generated_image(
            db,
            entity_type="character",
            entity_id="char-1",
            url=REAL_URL,
            image_id=2,
            set_primary=True,
            confirm_replace_primary=True,
        )
        assert adopted.is_primary is True
        assert adopted.replaced_primary == {
            "image_id": 1,
            "file_name": "旧定版.png",
            "url_is_public": True,
        }
        old_row = await db.get(CharacterImage, 1)
        new_row = await db.get(CharacterImage, 2)
        assert old_row is not None and old_row.is_primary is False
        assert old_row.file_id == OLD_FILE_ID  # 旧图没有被删，只是不再是定版
        assert new_row is not None and new_row.is_primary is True
        assert new_row.file_id == adopted.file_id
        assert _stub_adopt_io["download"] == [REAL_URL]
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_confirmed_in_place_keeps_slot_primary(
    _stub_adopt_io: dict[str, list[str]],
) -> None:
    """确认后**就地**替换定版图：槽位保持定版（否则一确认反倒把资产的定版弄没了）。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)

        adopted = await adopt_generated_image(
            db,
            entity_type="character",
            entity_id="char-1",
            url=REAL_URL,
            image_id=1,
            confirm_replace_primary=True,  # set_primary 不传（默认 false）
        )
        assert adopted.is_primary is True
        assert adopted.replaced_primary is not None
        assert adopted.replaced_primary["image_id"] == 1
        row = await db.get(CharacterImage, 1)
        assert row is not None and row.is_primary is True
        assert row.file_id == adopted.file_id != OLD_FILE_ID
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_onto_other_slot_without_setting_primary_is_allowed(
    _stub_adopt_io: dict[str, list[str]],
) -> None:
    """向后兼容：把图采纳到**另一个**槽位且不设版时，不动既有定版 → 不需要确认。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)
        db.add(CharacterImage(id=2, character_id="char-1", view_angle="BACK", quality_level="LOW"))
        await db.flush()

        adopted = await adopt_generated_image(
            db, entity_type="character", entity_id="char-1", url=REAL_URL, image_id=2
        )
        assert adopted.replaced_primary is None
        assert adopted.is_primary is False
        old_row = await db.get(CharacterImage, 1)
        assert old_row is not None and old_row.is_primary is True and old_row.file_id == OLD_FILE_ID
    await engine.dispose()


@pytest.mark.asyncio
async def test_adopt_does_not_clear_primary_flag_of_reused_slot(
    _stub_adopt_io: dict[str, list[str]],
) -> None:
    """向后兼容：set_primary 默认 false 后，不再「顺手把定版标记抹掉」。

    旧实现在 set_primary=False 时无条件写 ``is_primary=False``；默认值改成 false 之后
    那个副作用会变成默认行为（空槽位被定版标记着的时候，采纳一次就把标记清了）。
    """
    db, engine = await build_session()
    async with db:
        db.add(Prop(id="prop-1", name="玉佩", description="x", style="真人都市"))
        await db.flush()
        # 定版标记在，但还没绑图（不算「已有定版图」，因此不需要确认）
        db.add(PropImage(id=1, prop_id="prop-1", view_angle="FRONT", quality_level="LOW", is_primary=True))
        await db.flush()

        adopted = await adopt_generated_image(db, entity_type="prop", entity_id="prop-1", url=REAL_URL)
        row = await db.get(PropImage, 1)
        assert row is not None and row.file_id == adopted.file_id
        assert row.is_primary is True  # 标记没被抹掉
    await engine.dispose()


# ---------------------------------------------------------------------------
# 2) entity_images：create / update 两条写入路径同一口径
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_entity_image_create_with_primary_requires_confirmation() -> None:
    """⑦-a 新建一行并设版 → 会顶掉既有定版 → 未确认 409，且一行未写。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)

        with pytest.raises(HTTPException) as exc_info:
            await entity_images_service.create_entity_image(
                db,
                entity_type="character",
                entity_id="char-1",
                body={"view_angle": "BACK", "quality_level": "LOW", "is_primary": True},
            )
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["existing_primary"]["image_id"] == 1
        assert len(await _all_images(db, CharacterImage)) == 1  # 没新建行
    await engine.dispose()


@pytest.mark.asyncio
async def test_entity_image_create_with_confirmation_replaces_and_echoes() -> None:
    """⑦-a 确认后照旧能建行并设版，响应回显被替换的旧定版。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)

        payload = await entity_images_service.create_entity_image(
            db,
            entity_type="character",
            entity_id="char-1",
            body={
                "view_angle": "BACK",
                "quality_level": "LOW",
                "file_id": None,
                "is_primary": True,
                "confirm_replace_primary": True,
            },
        )
        assert payload["is_primary"] is True
        assert payload["replaced_primary"] == {
            "image_id": 1,
            "file_name": "旧定版.png",
            "url_is_public": True,
        }
        rows = await _all_images(db, CharacterImage)
        assert len(rows) == 2
        old_row = await db.get(CharacterImage, 1)
        assert old_row is not None and old_row.is_primary is False
    await engine.dispose()


@pytest.mark.asyncio
async def test_entity_image_update_setting_primary_on_other_slot_requires_confirmation() -> None:
    """⑦-b PATCH 把另一行设成定版 → 顶掉既有定版 → 未确认 409，且一行未改。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)
        db.add(CharacterImage(id=2, character_id="char-1", view_angle="BACK", quality_level="LOW"))
        await db.flush()

        with pytest.raises(HTTPException) as exc_info:
            await entity_images_service.update_entity_image(
                db,
                entity_type="character",
                entity_id="char-1",
                image_id=2,
                body={"is_primary": True},
            )
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["message"].startswith("该资产已有定版图")
        assert (await db.get(CharacterImage, 2)).is_primary is False
        assert (await db.get(CharacterImage, 1)).is_primary is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_entity_image_update_file_id_on_primary_requires_confirmation() -> None:
    """⑦-b PATCH **定版那一行**的 file_id → 等于把定版图换成另一张 → 未确认 409。

    这正是页面「上传图片」直接写 ``file_id`` 的路径：上传到当前定版槽位不能静默换掉定版。
    """
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)

        with pytest.raises(HTTPException) as exc_info:
            await entity_images_service.update_entity_image(
                db,
                entity_type="character",
                entity_id="char-1",
                image_id=1,
                body={"file_id": "file-brand-new", "format": "png"},
            )
        assert exc_info.value.status_code == 409
        row = await db.get(CharacterImage, 1)
        assert row is not None and row.file_id == OLD_FILE_ID  # 一个字都没改
        assert row.is_primary is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_entity_image_update_same_primary_is_idempotent() -> None:
    """向后兼容：对**已经是定版**的那一行再点一次「设为定版」照旧成功（不算替换）。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)

        payload = await entity_images_service.update_entity_image(
            db,
            entity_type="character",
            entity_id="char-1",
            image_id=1,
            body={"is_primary": True},
        )
        assert payload["is_primary"] is True
        assert payload["replaced_primary"] is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_entity_image_update_explicit_unset_primary_is_allowed() -> None:
    """向后兼容：显式把 is_primary 关掉（不设新版）不算替换，照旧放行。"""
    db, engine = await build_session()
    async with db:
        await _seed_character_with_primary(db)

        payload = await entity_images_service.update_entity_image(
            db,
            entity_type="character",
            entity_id="char-1",
            image_id=1,
            body={"is_primary": False},
        )
        assert payload["is_primary"] is False
        assert payload["replaced_primary"] is None
    await engine.dispose()


# ---------------------------------------------------------------------------
# 3) 重试键：attempt=0 逐字一致 / attempt>0 新键
# ---------------------------------------------------------------------------


def test_source_task_id_attempt_zero_is_byte_identical_to_pre_change_implementation() -> None:
    """⑤ attempt=0（含不传）必须与**改动前**的实现逐字一致。

    期望值由改动前的实现算出并写死（旧实现：
    ``sha1(prompt)[:8]`` + ``jellyfish:{project}:{type}:{id}:{digest}``）：
    这是「历史幂等键不改」的硬证据，不是自称。
    """
    assert (
        build_source_task_id(
            project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A"
        )
        == "jellyfish:proj-1:character:char-1:6dcd4ce2"
    )
    assert (
        build_source_task_id(
            project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A", attempt=0
        )
        == "jellyfish:proj-1:character:char-1:6dcd4ce2"
    )
    assert (
        build_source_task_id(project_id="proj-1", asset_type="character", asset_id="char-1", prompt="")
        == "jellyfish:proj-1:character:char-1:da39a3ee"  # sha1("") 前 8 位
    )
    assert (
        build_source_task_id(project_id="", asset_type="scene", asset_id="scene-9", prompt="一个雨夜的小巷")
        == "jellyfish:unknown:scene:scene-9:8731111a"
    )


def test_source_task_id_attempt_changes_the_key_and_stays_stable_per_attempt() -> None:
    """⑥ attempt=1/2 得到**不同**的键；同一 attempt 重复调用仍然稳定（幂等保护还在）。"""
    first = build_source_task_id(
        project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A"
    )
    retry1 = build_source_task_id(
        project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A", attempt=1
    )
    retry1_again = build_source_task_id(
        project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A", attempt=1
    )
    retry2 = build_source_task_id(
        project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A", attempt=2
    )

    assert retry1 != first
    assert retry2 not in {first, retry1}
    assert retry1 == retry1_again  # 同一轮重复点 → 同一个键 → 上游去重，不会重复下单
    assert retry1.startswith("jellyfish:proj-1:character:char-1:")
    assert retry1.endswith(":r1") and retry2.endswith(":r2")
    # 负数/异常输入不改变 attempt=0 的历史口径
    assert build_source_task_id(
        project_id="proj-1", asset_type="character", asset_id="char-1", prompt="A", attempt=-3
    ) == first


@pytest.mark.asyncio
async def test_build_targets_passes_attempt_into_the_idempotency_key() -> None:
    """提交链路：``build_targets(attempt=1)`` 里的 source_task_id 就是重试用的新键。"""
    db, engine = await build_session()
    async with db:
        db.add(Project(id="proj-1", name="测试项目", description="", style="真人古装", visual_style="现实"))
        db.add(Character(id="char-1", project_id="proj-1", name="林晓", description="女主", style="真人都市"))
        await db.flush()

        first, _ = await build_targets(
            db, project_id="proj-1", asset_type="character", stage="character_sheet"
        )
        retried, _ = await build_targets(
            db, project_id="proj-1", asset_type="character", stage="character_sheet", attempt=1
        )

    assert first[0].source_task_id != retried[0].source_task_id
    assert first[0].source_task_id.startswith("jellyfish:proj-1:character:char-1:")
    assert not first[0].source_task_id.endswith(":r1")
    assert retried[0].source_task_id.endswith(":r1")
    await engine.dispose()


# ---------------------------------------------------------------------------
# 4) 路由层：结构化 409 的响应形状 + attempt 回显（DRY_RUN，不触网）
# ---------------------------------------------------------------------------


def _build():
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    asyncio.run(_create_all(engine))
    return factory, engine


async def _create_all(engine) -> None:  # type: ignore[no-untyped-def]
    from app.core.db import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _override(factory: async_sessionmaker[AsyncSession]):
    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return override_db


def test_adopt_route_returns_structured_409_envelope() -> None:
    """① /adopt 的 409：统一信封 + ``meta.error`` 里的只读摘要，且一行未改。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        asyncio.run(_seed_route_data(factory))
        with TestClient(app) as client:
            res = client.post(
                "/api/v1/studio/image-pipeline/adopt",
                json={
                    "entity_type": "character",
                    "entity_id": "char-1",
                    "url": "https://cdn.example.com/generated.png",
                },
            )
            assert res.status_code == 409, res.text
            body = res.json()
            assert body["code"] == 409
            assert body["data"] is None
            assert "已有定版图" in body["message"]
            error = body["meta"]["error"]
            assert error["code"] == PRIMARY_REPLACE_REQUIRED_CODE
            assert error["existing_primary"] == {
                "image_id": 1,
                "file_name": "旧定版.png",
                "url_is_public": True,
            }
            assert error["confirm_field"] == "confirm_replace_primary"
            # 没有确认字段时不允许替换：库里仍是原来那一行、仍指向旧文件
            rows = asyncio.run(_route_images(factory))
            assert [(row.id, row.file_id, row.is_primary) for row in rows] == [
                (1, OLD_FILE_ID, True)
            ]
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_adopt_route_echoes_replaced_primary_on_confirmed_replace() -> None:
    """③ 路由层：确认替换后响应回显被替换的槽位 id 与文件名（read 模型也接受新字段）。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        asyncio.run(_seed_route_data(factory, extra_slot=True))
        with TestClient(app) as client:
            res = client.post(
                "/api/v1/studio/image-pipeline/adopt",
                json={
                    "entity_type": "character",
                    "entity_id": "char-1",
                    "url": "https://cdn.example.com/generated.png",
                    "image_id": 2,
                    "set_primary": True,
                    "confirm_replace_primary": True,
                },
            )
            assert res.status_code == 200, res.text
            data = res.json()["data"]
            assert data["image_id"] == 2
            assert data["is_primary"] is True
            assert data["replaced_primary"] == {
                "image_id": 1,
                "file_name": "旧定版.png",
                "url_is_public": True,
            }
            rows = asyncio.run(_route_images(factory))
            assert [(row.id, row.is_primary) for row in rows] == [(1, False), (2, True)]
            assert rows[0].file_id == OLD_FILE_ID  # 旧图没被删，只是不再是定版
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_entity_image_route_returns_structured_409_envelope() -> None:
    """⑦ 路由层：PATCH 设版顶掉既有定版 → 同一个结构化 409（meta.error 里带旧定版摘要）。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        asyncio.run(_seed_route_data(factory, extra_slot=True))
        with TestClient(app) as client:
            res = client.patch(
                "/api/v1/studio/entities/character/char-1/images/2",
                json={"is_primary": True},
            )
            assert res.status_code == 409, res.text
            body = res.json()
            assert body["code"] == 409
            assert body["meta"]["error"]["existing_primary"]["file_name"] == "旧定版.png"
            assert "confirm_replace_primary=true" in body["message"]
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_submit_route_echoes_retry_source_task_id() -> None:
    """⑥ 路由层：``attempt=1`` 透传到幂等键并在每条结果里回显；同 attempt 重复提交键不变。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    body = {
        "project_id": "proj-1",
        "asset_type": "character",
        "stage": "character_sheet",
        "asset_ids": ["char-1"],
    }
    try:
        asyncio.run(_seed_submit_data(factory))
        with TestClient(app) as client:
            first = client.post("/api/v1/studio/image-pipeline/submit", json=body)
            retry = client.post("/api/v1/studio/image-pipeline/submit", json={**body, "attempt": 1})
            retry_again = client.post("/api/v1/studio/image-pipeline/submit", json={**body, "attempt": 1})
            assert first.status_code == 200, first.text
            assert retry.status_code == 200, retry.text

            first_id = first.json()["data"]["results"][0]["source_task_id"]
            retry_id = retry.json()["data"]["results"][0]["source_task_id"]
            retry_again_id = retry_again.json()["data"]["results"][0]["source_task_id"]
            assert retry_id != first_id
            assert retry_id.endswith(":r1")
            assert retry_again_id == retry_id  # 同一轮不会重复下单
            assert first.json()["data"]["results"][0]["dry_run"] is True  # 全程演练，未出网
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


async def _seed_route_data(
    factory: async_sessionmaker[AsyncSession], *, extra_slot: bool = False
) -> None:
    async with factory() as db:
        await _seed_character_with_primary(db)
        if extra_slot:
            db.add(CharacterImage(id=2, character_id="char-1", view_angle="BACK", quality_level="LOW"))
            await db.flush()
        await db.commit()


async def _route_images(factory: async_sessionmaker[AsyncSession]) -> list[CharacterImage]:
    async with factory() as db:
        return list((await db.execute(select(CharacterImage).order_by(CharacterImage.id))).scalars().all())


async def _seed_submit_data(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as db:
        db.add(Project(id="proj-1", name="测试项目", description="", style="真人古装", visual_style="现实"))
        db.add(Character(id="char-1", project_id="proj-1", name="林晓", description="女主", style="真人都市"))
        await db.commit()
