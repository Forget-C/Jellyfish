"""商品（第五类资产）**读取侧**的接口级验证。

这条测试为什么必须存在
======================

「广告剧情流程」MVP 只把商品接进**读取侧**：实体 CRUD / 分镜关联 / 帧参考解析。
出图侧（``asset_strategies`` / ``image_tasks`` / ``asset_workbench`` 码 / task stores）**后置**。
因此这里要证明四件事：

1. **通用实体接口对 ``product`` 真的生效**，而且**没有静默落到服装**。
   ``entity_specs.entity_spec()`` 里 costume 是隐式 ``else`` 兜底 —— 漏写 product 分支时，
   创建"商品"会**悄悄建出一件服装**（这是本批最容易犯又最难发现的错），所以必须走真实 HTTP 断言两侧。
2. 商品图的**定版保护**与**同槽位冲突**沿用既有 409 结构（不新开口子），
   沿用既有 ``confirm_replace_primary`` 显式确认。
3. 分镜 ↔ 商品关联的两个专用端点在路由表里真的存在（``/studio/shots/links/product``）。
4. 商品定版图进的是**帧参考**，标签是中文 ``商品「…」的定版图``（口径写死：
   商品外观只走帧参考图，不进文本提示词；文本侧 ``shot_video_prompt_pack`` 刻意没有 product 分支）。

零出网、零付费：不调用任何模型、不出图；库是内存库，路由经 TestClient 打真实服务层。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.services.studio.entity_images import SLOT_CONFLICT_CODE
from app.services.studio.primary_protection import PRIMARY_REPLACE_REQUIRED_CODE

PROJECT_ID = "proj-product"
CHAPTER_ID = "chap-product"
SHOT_ID = "shot-product"
PRODUCT_ID = "prod-1"
FILE_FRONT = "file-front"
FILE_LEFT = "file-left"

ENTITIES = "/api/v1/studio/entities"
LINKS = "/api/v1/studio/shot-links"

PRODUCT_BODY = {
    "id": PRODUCT_ID,
    "name": "紧致焕颜精华",
    "description": "白色磨砂塑料瓶身，金色压泵，正面居中金色字标",
}


# ---------------------------------------------------------------------------
# 脚手架：内存库 + 真实路由（不碰任何正式库）
# ---------------------------------------------------------------------------


def _build_harness() -> tuple[async_sessionmaker[AsyncSession], Any]:
    from app.core.db import Base
    import app.models.studio  # noqa: F401  导入即注册全部表

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create())
    return factory, engine


def _seed_minimum_structure(factory: async_sessionmaker[AsyncSession]) -> None:
    """项目 + 章节 + 镜头 + 两个图片文件（商品图的 file_id 要指向真实文件行）。"""
    from app.models.studio import Chapter, FileItem, Project, Shot

    async def _run() -> None:
        async with factory() as session:
            session.add(
                Project(
                    id=PROJECT_ID,
                    name="广告项目",
                    description="",
                    style="真人都市",
                    visual_style="现实",
                )
            )
            await session.flush()
            session.add(
                Chapter(id=CHAPTER_ID, project_id=PROJECT_ID, index=1, title="第 1 集")
            )
            await session.flush()
            session.add(Shot(id=SHOT_ID, chapter_id=CHAPTER_ID, index=1, title="镜头 1"))
            session.add(
                FileItem(
                    id=FILE_FRONT,
                    type="image",
                    name="商品定版图",
                    storage_key="https://oss.example.com/products/prod-1/front.png",
                )
            )
            session.add(
                FileItem(
                    id=FILE_LEFT,
                    type="image",
                    name="商品左视图",
                    storage_key="https://oss.example.com/products/prod-1/left.png",
                )
            )
            await session.commit()

    asyncio.run(_run())


@pytest.fixture()
def routed_client() -> Iterator[TestClient]:
    """TestClient + 内存库 + 最小项目结构（零出网）。"""
    factory, engine = _build_harness()

    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_db
    _seed_minimum_structure(factory)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def _create_product(client: TestClient) -> None:
    resp = client.post(f"{ENTITIES}/product", json=PRODUCT_BODY)
    assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# 1) 通用实体接口对 product 生效，且没有静默落到 costume
# ---------------------------------------------------------------------------


def test_generic_entity_endpoints_cover_product(routed_client: TestClient) -> None:
    """商品能通过统一实体接口建 / 读 / 列 / 改，且服装那边仍然是空的。"""
    _create_product(routed_client)

    created = routed_client.get(f"{ENTITIES}/product/{PRODUCT_ID}")
    assert created.status_code == 200
    assert created.json()["data"]["name"] == PRODUCT_BODY["name"]
    assert created.json()["data"]["description"] == PRODUCT_BODY["description"]

    listed = routed_client.get(f"{ENTITIES}/product", params={"page": 1, "page_size": 10})
    assert listed.status_code == 200
    items = listed.json()["data"]["items"]
    assert [item["id"] for item in items] == [PRODUCT_ID]

    # 回归锁：costume 是 entity_spec() 的隐式 else 兜底分支。
    # 漏写 product 分支时，上面那次创建会变成一件"服装"，而这里就不会是空列表。
    costumes = routed_client.get(f"{ENTITIES}/costume", params={"page": 1, "page_size": 10})
    assert costumes.status_code == 200
    assert costumes.json()["data"]["items"] == []

    updated = routed_client.patch(
        f"{ENTITIES}/product/{PRODUCT_ID}",
        json={"description": "白色磨砂瓶身 + 烫金外盒"},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["description"] == "白色磨砂瓶身 + 烫金外盒"

    # 未知类型仍然被明确拒绝（不能因为加了 product 就放宽白名单）
    rejected = routed_client.post(f"{ENTITIES}/bottle", json=PRODUCT_BODY)
    assert rejected.status_code == 400
    assert "product" in rejected.json()["message"]


# ---------------------------------------------------------------------------
# 2) 商品图：落 file_id + 定版保护 + 同槽位冲突
# ---------------------------------------------------------------------------


def test_product_image_binds_file_and_protects_primary(routed_client: TestClient) -> None:
    """商品图能落 file_id；顶掉既有定版要显式确认；同槽位重复建图是结构化 409。"""
    _create_product(routed_client)

    first = routed_client.post(
        f"{ENTITIES}/product/{PRODUCT_ID}/images",
        json={
            "file_id": FILE_FRONT,
            "view_angle": "FRONT",
            "quality_level": "HIGH",
            "is_primary": True,
        },
    )
    assert first.status_code == 201, first.text
    assert first.json()["data"]["file_id"] == FILE_FRONT
    assert first.json()["data"]["is_primary"] is True

    # 同槽位（product + quality_level + view_angle）重复建图 → 409 entity_image_slot_exists
    duplicate = routed_client.post(
        f"{ENTITIES}/product/{PRODUCT_ID}/images",
        json={"file_id": FILE_LEFT, "view_angle": "FRONT", "quality_level": "HIGH"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["meta"]["error"]["code"] == SLOT_CONFLICT_CODE

    # 换槽位设定版 → 顶掉既有定版，必须显式确认
    blocked = routed_client.post(
        f"{ENTITIES}/product/{PRODUCT_ID}/images",
        json={
            "file_id": FILE_LEFT,
            "view_angle": "LEFT",
            "quality_level": "HIGH",
            "is_primary": True,
        },
    )
    assert blocked.status_code == 409
    assert blocked.json()["meta"]["error"]["code"] == PRIMARY_REPLACE_REQUIRED_CODE
    assert blocked.json()["data"] is None

    confirmed = routed_client.post(
        f"{ENTITIES}/product/{PRODUCT_ID}/images",
        json={
            "file_id": FILE_LEFT,
            "view_angle": "LEFT",
            "quality_level": "HIGH",
            "is_primary": True,
            "confirm_replace_primary": True,
        },
    )
    assert confirmed.status_code == 201, confirmed.text

    images = routed_client.get(
        f"{ENTITIES}/product/{PRODUCT_ID}/images", params={"page": 1, "page_size": 10}
    )
    assert images.status_code == 200
    rows = images.json()["data"]["items"]
    # 建商品时 ``entity_crud.create_entity`` 会按 ``view_count`` 预建空槽位行
    # （默认 1 → 一个 FRONT 空槽位），所以这里多一行是**预期**的。
    assert any(row["file_id"] is None for row in rows), "应当有预建的空槽位行"
    file_rows = [row for row in rows if row["file_id"]]
    assert {row["file_id"] for row in file_rows} == {FILE_FRONT, FILE_LEFT}
    # 同一商品永远只有一张定版
    assert sum(1 for row in rows if row["is_primary"]) == 1
    primary = next(row for row in rows if row["is_primary"])
    assert primary["file_id"] == FILE_LEFT


# ---------------------------------------------------------------------------
# 3) 分镜 ↔ 商品关联的两个专用端点
# ---------------------------------------------------------------------------


def test_shot_product_link_endpoints(routed_client: TestClient) -> None:
    """``/shots/links/product`` 与 ``/shots/links/product/{link_id}`` 真的可用。"""
    _create_product(routed_client)

    created = routed_client.post(
        f"{LINKS}/product",
        json={"project_id": PROJECT_ID, "chapter_id": CHAPTER_ID, "shot_id": SHOT_ID, "asset_id": PRODUCT_ID},
    )
    assert created.status_code == 201, created.text
    link = created.json()["data"]
    assert link["product_id"] == PRODUCT_ID
    assert link["shot_id"] == SHOT_ID

    # 别人家的类型不能用同一个 link_id 删掉（端点按类型分派，不存在"删错表"）
    deleted = routed_client.delete(f"{LINKS}/product/{link['id']}")
    assert deleted.status_code == 200
    assert deleted.json() == {"code": 200, "message": "success", "data": None, "meta": None}

    again = routed_client.delete(f"{LINKS}/product/{link['id']}")
    assert again.status_code == 200  # 幂等删除：不存在也回空信封


# ---------------------------------------------------------------------------
# 4) 商品定版图进帧参考（标签是中文）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_product_primary_image_enters_frame_reference_labels() -> None:
    """商品定版图必须出现在 ``reference_file_ids`` / 的可读名里，且标签是「商品「…」的定版图」。"""
    from app.models.studio import FileItem, Product, ProductImage, ProjectProductLink
    from app.services.studio.bound_asset_files import (
        resolve_shot_bound_files,
        to_shot_linked_asset_items,
    )
    from app.services.studio.image_pipeline import frame_submit
    from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

    db, engine = await build_session()
    try:
        async with db:
            await seed_project_chapter_shot(db)  # proj-1 / chap-1 / shot-1
            db.add(
                Product(
                    id="prod-frame",
                    name="焕颜精华",
                    description="白色磨砂瓶身，金色压泵",
                    style="真人都市",
                    visual_style="现实",
                )
            )
            db.add(
                FileItem(
                    id="file-frame",
                    type="image",
                    name="商品定版图",
                    storage_key="https://oss.example.com/products/prod-frame/front.png",
                )
            )
            await db.flush()
            db.add(
                ProductImage(
                    id=1,
                    product_id="prod-frame",
                    file_id="file-frame",
                    is_primary=True,
                    view_angle="FRONT",
                    quality_level="HIGH",
                )
            )
            db.add(
                ProjectProductLink(
                    id=1, project_id="proj-1", shot_id="shot-1", product_id="prod-frame"
                )
            )
            await db.flush()

            bound = await resolve_shot_bound_files(db, shot_id="shot-1")
            product_bound = next(item for item in bound if item.asset_type == "product")
            assert product_bound.asset_name == "焕颜精华"
            assert product_bound.file_id == "file-frame"
            assert product_bound.usable is True
            assert product_bound.resolved_from == "is_primary"

            items = to_shot_linked_asset_items(bound)
            assert [item.type for item in items] == ["product"]

            warnings: list[str] = []
            file_ids, labels = await frame_submit.resolve_frame_reference_targets(
                db, shot_id="shot-1", explicit=[], warnings=warnings
            )
    finally:
        await engine.dispose()

    assert file_ids == ["file-frame"]
    assert labels == ["商品「焕颜精华」的定版图"], labels
    assert warnings == []


def test_prompt_pack_has_no_product_branch() -> None:
    """口径写死：商品外观**不进文本提示词**。

    结构性断言（读源码）：``shot_video_prompt_pack`` 组装资产引用时只认
    character / prop / costume / scene 四类，**刻意没有 product 分支**。
    哪天有人"顺手"把商品也塞进文本提示词，这条会红——那时应当先改口径文档。
    """
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "services"
        / "studio"
        / "shot_video_prompt_pack.py"
    ).read_text(encoding="utf-8")
    assert '"product"' not in source, "商品外观只走帧参考图，不应进文本提示词"
