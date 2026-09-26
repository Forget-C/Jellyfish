"""出口 A 交付清单的**选中镜头范围**（`shot_ids`）。

为什么需要这一档：工作室里用户是按「当前镜头 / 已勾选 N 镜」干活的，
如果导出与就绪判定永远按"整集"，就会出现"一镜试通就显示整集已就绪"的假象。
本测试锁住三件事：选中范围只回选中镜头、优先级（shot_id > shot_ids > chapter_id）、
以及不在选中范围内的镜头**不会**出现在清单里。
"""

from __future__ import annotations

import pytest

from app.models.studio import Chapter, Project, Shot, ShotDetail
from app.services.studio.prompt_delivery import fetch_delivery_rows
from tests.llm_orchestration_fixtures import build_session


async def _seed_three_shots(db) -> None:
    db.add(Project(id="proj-1", name="测试项目", description="", style="真人古装", visual_style="现实"))
    await db.flush()
    db.add(
        Chapter(
            id="proj-1::EP01",
            project_id="proj-1",
            index=1,
            title="EP01",
            raw_text="文本",
            condensed_text="文本",
        )
    )
    await db.flush()
    for index in (1, 2, 3):
        shot_id = f"proj-1_EP01_SHOT_{index:03d}"
        db.add(Shot(id=shot_id, chapter_id="proj-1::EP01", index=index, title=f"镜头{index}", status="ready"))
        db.add(
            ShotDetail(
                id=shot_id,
                camera_shot="中景",
                angle="平视",
                movement="固定",
                video_prompt=f"提示词{index}",
                video_prompt_source="manual",
            )
        )
    await db.flush()


@pytest.mark.asyncio
async def test_shot_ids_scope_returns_only_selected_shots():
    db, engine = await build_session()
    try:
        await _seed_three_shots(db)
        rows = await fetch_delivery_rows(
            db,
            project_id="proj-1",
            chapter_id="proj-1::EP01",
            shot_ids=["proj-1_EP01_SHOT_001", "proj-1_EP01_SHOT_003"],
        )
    finally:
        await engine.dispose()

    assert [row["shot_id"] for row in rows] == ["proj-1_EP01_SHOT_001", "proj-1_EP01_SHOT_003"]


@pytest.mark.asyncio
async def test_shot_id_takes_precedence_over_shot_ids_and_chapter():
    db, engine = await build_session()
    try:
        await _seed_three_shots(db)
        rows = await fetch_delivery_rows(
            db,
            project_id="proj-1",
            chapter_id="proj-1::EP01",
            shot_id="proj-1_EP01_SHOT_002",
            shot_ids=["proj-1_EP01_SHOT_001"],
        )
    finally:
        await engine.dispose()

    assert [row["shot_id"] for row in rows] == ["proj-1_EP01_SHOT_002"]


@pytest.mark.asyncio
async def test_chapter_scope_unchanged_when_no_selection():
    db, engine = await build_session()
    try:
        await _seed_three_shots(db)
        rows = await fetch_delivery_rows(db, project_id="proj-1", chapter_id="proj-1::EP01")
    finally:
        await engine.dispose()

    assert len(rows) == 3
