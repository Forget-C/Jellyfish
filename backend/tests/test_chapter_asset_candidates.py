"""集级资产清单（六步流程·步骤2）聚合与去重测试。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.studio.chapter_asset_candidates import build_chapter_asset_candidates
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot


async def _seed_candidates(db) -> None:  # type: ignore[no-untyped-def]
    from app.models.studio import Shot, ShotExtractedCandidate

    db.add(Shot(id="shot-2", chapter_id="chap-1", index=2, title="第二镜", script_excerpt="续"))
    await db.flush()
    rows = [
        # 同一人物在多镜头重复出现，且写法有全/半角差异 → 应聚合为一条并记别名
        ("shot-1", "character", "姜岁欢", "pending", None),
        ("shot-2", "character", "姜岁欢 ", "pending", None),
        ("shot-1", "scene", "将军府庭院", "linked", "SCENE_将军府庭院"),
        ("shot-2", "prop", "拐杖", "pending", None),
        ("shot-2", "prop", "被忽略的道具", "ignored", None),
    ]
    for shot_id, ctype, name, cstatus, linked in rows:
        db.add(
            ShotExtractedCandidate(
                shot_id=shot_id,
                candidate_type=ctype,
                candidate_name=name,
                candidate_status=cstatus,
                linked_entity_id=linked,
                source="test",
            )
        )
    await db.flush()


@pytest.mark.asyncio
async def test_aggregates_and_merges_duplicates() -> None:
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        await _seed_candidates(db)
        result = await build_chapter_asset_candidates(db, chapter_id="chap-1")

    assert result["chapter_id"] == "chap-1"
    assert result["project_id"] == "proj-1"
    assert result["shot_total"] == 2
    names = {(i["candidate_type"], i["name"]) for i in result["items"]}
    # 「姜岁欢」两镜重复 → 只应出现一次
    assert ("character", "姜岁欢") in names
    assert len([n for t, n in names if t == "character"]) == 1
    # 已忽略的候选默认不计入
    assert all(i["name"] != "被忽略的道具" for i in result["items"])
    # 场景已关联 → linked_entity_id 保留
    scene = next(i for i in result["items"] if i["candidate_type"] == "scene")
    assert scene["linked_entity_id"] == "SCENE_将军府庭院"
    assert scene["shot_count"] == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_include_ignored_flag() -> None:
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        await _seed_candidates(db)
        result = await build_chapter_asset_candidates(db, chapter_id="chap-1", include_ignored=True)

    assert any(i["name"] == "被忽略的道具" for i in result["items"])
    await engine.dispose()


@pytest.mark.asyncio
async def test_recommends_create_new_when_no_existing_asset() -> None:
    """库里没有同名资产 → 建议 create_new。"""
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        await _seed_candidates(db)
        result = await build_chapter_asset_candidates(db, chapter_id="chap-1")

    jiang = next(i for i in result["items"] if i["name"] == "姜岁欢")
    assert jiang["recommendation"] == "create_new"
    assert jiang["shot_count"] == 2  # 两镜都提到
    assert result["summary"]["create_new_count"] >= 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_recommends_link_existing_when_asset_exists() -> None:
    """已有同名角色 → 建议 link_existing（支持"选用已有资产"）。"""
    from app.models.studio import Character

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        db.add(Character(id="char-x", project_id="proj-1", name="姜岁欢", description="已存在", style="真人古装"))
        await db.flush()
        await _seed_candidates(db)
        result = await build_chapter_asset_candidates(db, chapter_id="chap-1")

    jiang = next(i for i in result["items"] if i["name"] == "姜岁欢")
    assert jiang["recommendation"] == "link_existing"
    assert jiang["existing_asset_id"] == "char-x"
    assert result["summary"]["link_existing_count"] >= 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_unknown_chapter_raises_404() -> None:
    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await build_chapter_asset_candidates(db, chapter_id="chap-missing")
    assert exc_info.value.status_code == 404
    await engine.dispose()


@pytest.mark.asyncio
async def test_empty_chapter_returns_empty_items_not_error() -> None:
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        result = await build_chapter_asset_candidates(db, chapter_id="chap-1")

    assert result["items"] == []
    assert result["summary"]["merged_groups"] == 0
    assert result["notes"]  # 明确写清"不写库"
    assert any("不创建资产" in n for n in result["notes"])
    await engine.dispose()
