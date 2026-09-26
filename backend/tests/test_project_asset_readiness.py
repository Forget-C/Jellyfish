"""项目资产准备清单（`asset-readiness`）聚合数据测试。

守的是本轮的核心回归：**场景/道具/服装不再因为「关联行读模型没有 image_prompts」
而无法判定状态**。四类资产必须由同一份清单给出同一组标志，且这些标志与
「实体列 + 图片表 + 提取候选」的现状一致。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio import (
    Chapter,
    ProjectSceneLink,
    PropImage,
    Shot,
    ShotCandidateStatus,
    ShotCandidateType,
    ShotExtractedCandidate,
)

PROJECT_ID = "proj-readiness"


def _build():
    from app.core.db import Base
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    asyncio.run(_create_all(engine))
    return factory, engine


async def _create_all(engine) -> None:
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


def _seed_candidate(
    factory: async_sessionmaker[AsyncSession],
    *,
    candidate_type: str,
    name: str,
    status_value: str,
    linked_entity_id: str | None = None,
    index: int = 0,
) -> None:
    """直接在库里放一条提取候选（提取本身要花 LLM，测试里只关心候选现状）。"""

    async def run() -> None:
        async with factory() as db:
            chapter_id = f"chapter-{index}"
            shot_id = f"shot-{index}"
            if await db.get(Chapter, chapter_id) is None:
                db.add(
                    Chapter(
                        id=chapter_id,
                        project_id=PROJECT_ID,
                        index=index,
                        title=f"第{index}集",
                        summary="",
                        raw_text="",
                        storyboard_count=1,
                    )
                )
                await db.flush()
                db.add(Shot(id=shot_id, chapter_id=chapter_id, index=1, title=f"镜头{index}"))
                await db.flush()
            db.add(
                ShotExtractedCandidate(
                    shot_id=shot_id,
                    candidate_type=candidate_type,
                    candidate_name=name,
                    candidate_status=status_value,
                    linked_entity_id=linked_entity_id,
                    payload={},
                )
            )
            await db.commit()

    asyncio.run(run())


def _readiness(client: TestClient, project_id: str = PROJECT_ID) -> dict:
    res = client.get(f"/api/v1/studio/projects/{project_id}/asset-readiness")
    assert res.status_code == 200, res.text
    return res.json()["data"]


def _item(payload: dict, asset_type: str, asset_id: str) -> dict:
    for item in payload["items"]:
        if item["asset_type"] == asset_type and item["asset_id"] == asset_id:
            return item
    raise AssertionError(f"清单里没有 {asset_type}/{asset_id}")


def _create_project(client: TestClient) -> None:
    res = client.post(
        "/api/v1/studio/projects",
        json={"id": PROJECT_ID, "name": "资产准备项目", "description": "", "visual_style": "现实", "style": "真人都市"},
    )
    assert res.status_code == 201, res.text


def _create_entity(client: TestClient, entity_type: str, entity_id: str, name: str, **extra: object) -> None:
    body: dict[str, object] = {
        "id": entity_id,
        "name": name,
        "description": "",
        "tags": [],
        "visual_style": "现实",
        "style": "真人都市",
        "view_count": 1,
    }
    body.update(extra)
    res = client.post(f"/api/v1/studio/entities/{entity_type}", json=body)
    assert res.status_code == 201, res.text


def _patch_prompts(client: TestClient, entity_type: str, entity_id: str, prompts: dict[str, str]) -> None:
    res = client.patch(
        f"/api/v1/studio/entities/{entity_type}/{entity_id}",
        json={"image_prompts": prompts},
    )
    assert res.status_code == 200, res.text


def _attach_image(
    client: TestClient,
    entity_type: str,
    entity_id: str,
    *,
    file_id: str | None,
    is_primary: bool | None = None,
    view_angle: str = "FRONT",
) -> int:
    """给资产挂一张图。

    关联/创建资产时后端会**自动补一个空槽位行**（`file_id=None`），
    页面上的「上传」正是往这个槽位里填 `file_id`，所以这里也走同一条路：
    已有同视角槽位就 PATCH，没有才 POST。
    """
    listed = client.get(f"/api/v1/studio/entities/{entity_type}/{entity_id}/images?page=1&page_size=100")
    assert listed.status_code == 200, listed.text
    rows = listed.json()["data"]["items"]
    body: dict[str, object] = {"file_id": file_id, "format": "png", "view_angle": view_angle}
    if is_primary is not None:
        body["is_primary"] = is_primary
    for row in rows:
        if str(row.get("view_angle")) == view_angle and row.get("file_id") in (None, ""):
            res = client.patch(
                f"/api/v1/studio/entities/{entity_type}/{entity_id}/images/{row['id']}",
                json=body,
            )
            assert res.status_code == 200, res.text
            return int(row["id"])
    res = client.post(f"/api/v1/studio/entities/{entity_type}/{entity_id}/images", json=body)
    assert res.status_code == 201, res.text
    return int(res.json()["data"]["id"])


def test_scene_prompt_and_image_state_come_from_unified_source() -> None:
    """场景（走项目关联表）+ 提示词 + 图片 + 定版：四个标志都从同一份清单来。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_project(client)
            # 场景挂在关联表上（没有 project_id 列），提示词存在**实体**列上。
            _create_entity(client, "scene", "scene-1", "雨夜咖啡店")
            res = client.post(
                "/api/v1/studio/shot-links/scene",
                json={"project_id": PROJECT_ID, "chapter_id": None, "shot_id": None, "asset_id": "scene-1"},
            )
            assert res.status_code == 201, res.text

            before = _item(_readiness(client), "scene", "scene-1")
            assert before["name"] == "雨夜咖啡店"
            assert before["has_image_prompt"] is False
            assert before["has_image"] is False
            assert before["has_primary"] is False
            assert before["image_id"] is None

            _patch_prompts(client, "scene", "scene-1", {"scene_image_front": "雨夜咖啡店，木质吧台"})
            image_id = _attach_image(client, "scene", "scene-1", file_id="file-scene-1")

            with_prompt = _item(_readiness(client), "scene", "scene-1")
            assert with_prompt["has_image_prompt"] is True
            assert with_prompt["has_image"] is True
            assert with_prompt["has_primary"] is False
            assert with_prompt["image_id"] == image_id

            res = client.patch(
                f"/api/v1/studio/entities/scene/scene-1/images/{image_id}",
                json={"is_primary": True},
            )
            assert res.status_code == 200, res.text

            after = _item(_readiness(client), "scene", "scene-1")
            assert after["has_primary"] is True
            assert after["image_id"] == image_id
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_empty_slot_rows_are_not_images_nor_primary() -> None:
    """资产编辑页会自动补空槽位：没有 `file_id` 的行不算「已有图」，也不算「已定版」。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_project(client)
            _create_entity(client, "prop", "prop-1", "旧录音笔", project_id=PROJECT_ID)
            _patch_prompts(client, "prop", "prop-1", {"prop_image_front": "旧录音笔，磨砂金属"})
            # 空槽位（file_id=None）且被标了 is_primary —— 真实场景里来自「先建槽位再填」
            _attach_image(client, "prop", "prop-1", file_id=None, is_primary=True)

            async def slot_rows() -> list[tuple[str | None, bool]]:
                async with factory() as db:
                    rows = (
                        await db.execute(select(PropImage).where(PropImage.prop_id == "prop-1"))
                    ).scalars().all()
                    return [(row.file_id, bool(row.is_primary)) for row in rows]

            # 先确认测试前提真的成立：库里确实有一条「file_id 为空 + is_primary=True」的行
            assert (None, True) in asyncio.run(slot_rows())

            item = _item(_readiness(client), "prop", "prop-1")
            assert item["has_image_prompt"] is True
            assert item["has_image"] is False
            assert item["has_primary"] is False
            assert item["image_id"] is None
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_four_asset_types_share_one_caliber() -> None:
    """角色（自带 project_id）/ 场景 / 道具 / 服装都返回同一组字段与同一套判定。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_project(client)
            _create_entity(client, "character", "char-1", "林小满", project_id=PROJECT_ID)
            _create_entity(client, "scene", "scene-1", "咖啡店")
            _create_entity(client, "prop", "prop-1", "热咖啡")
            _create_entity(client, "costume", "costume-1", "米色风衣")
            for entity_type, asset_id in (("scene", "scene-1"), ("prop", "prop-1"), ("costume", "costume-1")):
                res = client.post(
                    f"/api/v1/studio/shot-links/{entity_type}",
                    json={"project_id": PROJECT_ID, "chapter_id": None, "shot_id": None, "asset_id": asset_id},
                )
                assert res.status_code == 201, res.text

            payload = _readiness(client)
            assert {item["asset_type"] for item in payload["items"]} == {
                "character",
                "scene",
                "prop",
                "costume",
            }
            assert payload["summary"]["asset_counts"] == {
                "character": 1,
                "scene": 1,
                "prop": 1,
                "costume": 1,
            }
            for item in payload["items"]:
                # 四类资产字段完全一致（没有「角色多一个 image_prompts、场景没有」的分裂）
                assert set(item) == {
                    "asset_type",
                    "asset_id",
                    "name",
                    "has_pending_candidate",
                    "has_image_prompt",
                    "has_image",
                    "has_primary",
                    "thumbnail",
                    "image_id",
                }
                assert item["has_image_prompt"] is False
                assert item["has_image"] is False
                assert item["has_primary"] is False
            assert payload["summary"]["total"] == 4
            assert payload["summary"]["done"] == 0
            assert payload["summary"]["all_done"] is False
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_pending_candidate_blocks_only_same_type_same_name() -> None:
    """待确认候选按「同类型 + 同名」落到资产上；已关联的候选不再把资产推回待确认。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_project(client)
            _create_entity(client, "scene", "scene-1", "咖啡店")
            _create_entity(client, "scene", "scene-2", "对坐处")
            for asset_id in ("scene-1", "scene-2"):
                res = client.post(
                    "/api/v1/studio/shot-links/scene",
                    json={"project_id": PROJECT_ID, "chapter_id": None, "shot_id": None, "asset_id": asset_id},
                )
                assert res.status_code == 201, res.text

            _seed_candidate(
                factory,
                candidate_type="scene",
                name="咖啡店",
                status_value="pending",
                index=1,
            )
            _seed_candidate(
                factory,
                candidate_type="scene",
                name="对坐处",
                status_value="linked",
                linked_entity_id="scene-2",
                index=2,
            )
            # 同名但类型不同（道具）不该影响场景
            _seed_candidate(factory, candidate_type="prop", name="咖啡店", status_value="pending", index=3)

            payload = _readiness(client)
            assert _item(payload, "scene", "scene-1")["has_pending_candidate"] is True
            assert _item(payload, "scene", "scene-2")["has_pending_candidate"] is False
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_summary_matches_item_flags() -> None:
    """汇总数字必须与逐项标志一致（顶部统计与表格同源）。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_project(client)
            # 已定版：提示词 + 图 + is_primary
            _create_entity(client, "scene", "scene-done", "已定版场景")
            res = client.post(
                "/api/v1/studio/shot-links/scene",
                json={"project_id": PROJECT_ID, "chapter_id": None, "shot_id": None, "asset_id": "scene-done"},
            )
            assert res.status_code == 201, res.text
            _patch_prompts(client, "scene", "scene-done", {"scene_image_front": "完成"})
            image_id = _attach_image(client, "scene", "scene-done", file_id="file-done", is_primary=True)
            assert image_id > 0
            # 有图但没提示词：不算完成
            _create_entity(client, "prop", "prop-todo", "待完善道具", project_id=PROJECT_ID)
            _attach_image(client, "prop", "prop-todo", file_id="file-todo")

            payload = _readiness(client)
            summary = payload["summary"]
            assert summary["total"] == 2
            assert summary["with_image_prompt"] == 1
            assert summary["with_image"] == 2
            assert summary["with_primary"] == 1
            assert summary["done"] == 1
            assert summary["all_done"] is False
            assert summary["done"] == sum(
                1
                for item in payload["items"]
                if item["has_image_prompt"] and item["has_image"] and item["has_primary"] and not item["has_pending_candidate"]
            )
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_unknown_project_returns_404_envelope() -> None:
    """项目不存在 → 404（而不是回一个空清单，把故障伪装成「没有资产」）。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            res = client.get("/api/v1/studio/projects/not-exist/asset-readiness")
            assert res.status_code == 404, res.text
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_assets_from_shot_level_links_are_included() -> None:
    """镜头级关联（shot_id 非空）同样算「项目已有该资产」，否则迁移项目会被判成没有资产。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_project(client)
            _create_entity(client, "scene", "scene-shot", "镜头级场景")
            _seed_candidate(factory, candidate_type="scene", name="占位", status_value="ignored", index=9)

            async def link_at_shot_level() -> None:
                async with factory() as db:
                    class_id = "chapter-9"
                    chapter = await db.get(Chapter, class_id)
                    assert chapter is not None
                    db.add(
                        ProjectSceneLink(
                            project_id=PROJECT_ID,
                            chapter_id=class_id,
                            shot_id="shot-9",
                            scene_id="scene-shot",
                        )
                    )
                    await db.commit()

            asyncio.run(link_at_shot_level())
            payload = _readiness(client)
            assert _item(payload, "scene", "scene-shot")["name"] == "镜头级场景"
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_shot_candidate_join_uses_project_chapters() -> None:
    """候选只在**本项目**章节的镜头里生效（别的项目的同名候选不算）。"""
    factory, engine = _build()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_project(client)
            res = client.post(
                "/api/v1/studio/projects",
                json={"id": "proj-other", "name": "别的项目", "description": "", "visual_style": "现实", "style": "真人都市"},
            )
            assert res.status_code == 201, res.text
            _create_entity(client, "scene", "scene-1", "同名场景")
            res = client.post(
                "/api/v1/studio/shot-links/scene",
                json={"project_id": PROJECT_ID, "chapter_id": None, "shot_id": None, "asset_id": "scene-1"},
            )
            assert res.status_code == 201, res.text

            async def seed_other_project_candidate() -> None:
                async with factory() as db:
                    db.add(
                        Chapter(
                            id="chapter-other",
                            project_id="proj-other",
                            index=1,
                            title="别的集",
                            summary="",
                            raw_text="",
                            storyboard_count=1,
                        )
                    )
                    await db.flush()
                    db.add(Shot(id="shot-other", chapter_id="chapter-other", index=1, title="镜头"))
                    await db.flush()
                    db.add(
                        ShotExtractedCandidate(
                            shot_id="shot-other",
                            candidate_type=ShotCandidateType.scene,
                            candidate_name="同名场景",
                            candidate_status=ShotCandidateStatus.pending,
                            payload={},
                        )
                    )
                    await db.commit()

            asyncio.run(seed_other_project_candidate())
            payload = _readiness(client)
            assert _item(payload, "scene", "scene-1")["has_pending_candidate"] is False

            async def count_links() -> int:
                async with factory() as db:
                    return len((await db.execute(select(ProjectSceneLink))).scalars().all())

            assert asyncio.run(count_links()) == 1
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())
