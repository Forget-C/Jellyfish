"""出图计划预览里的**生成依据**（`generation_basis`）：页面「生成依据」不靠先花一次模型调用。

为什么需要：改造前「生成依据」面板的数据只来自**一次提示词生成响应**，
于是"还没生成"时页面只能显示「本次未提供生成依据」——用户看不到这份资产到底有什么资料，
更没法在花钱之前核对。现在只读的出图计划预览（`POST /image-pipeline/plan/preview`）
按项目 + 章节装配同一份依据（与图片提示词链路**同源**：chapter_asset_profiles），
页面在**零调用**的情况下就能逐项核对 ① 剧本与分镜 ② 规范化资料 ③ 隔离边界。

覆盖：

- 给了 ``chapter_id`` → 每个目标带 ``generation_basis``（结构化资料 / 分镜依据 / 剧本片段 / 来源码）；
- 没给 ``chapter_id`` → 依据为空（**行为与加这个功能之前完全一致**，不猜章节）；
- 本章没有该资产的结构化资料行 → 如实说明来源，**不编造**资料。
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.services.studio.image_pipeline.image_pipeline import build_targets
from app.services.studio.llm_orchestration.json_utils import normalize_name

PROJECT_ID = "proj-basis"
CHAPTER_ID = "chap-basis"


async def _build_db() -> tuple[AsyncSession, object]:
    from app.core.db import Base
    from app.models.studio import (
        Chapter,
        ChapterAssetProfile,
        Project,
        Prop,
        Shot,
    )

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    db = maker()
    db.add(
        Project(id=PROJECT_ID, name="依据验收项目", description="", style="真人古装", visual_style="现实")
    )
    await db.flush()
    db.add(
        Chapter(
            id=CHAPTER_ID,
            project_id=PROJECT_ID,
            index=1,
            title="验收集",
            raw_text="秦老夫人拄着乌木拐杖立在听雨轩堂前。",
            condensed_text="秦老夫人拄着乌木拐杖立在听雨轩堂前。",
        )
    )
    await db.flush()
    db.add(
        Shot(
            id="shot-b1",
            chapter_id=CHAPTER_ID,
            index=3,
            title="老夫人逼问",
            script_excerpt="秦老夫人拄着乌木拐杖立在听雨轩堂前，逼问嫁妆下落。",
        )
    )
    db.add(
        Prop(
            id="prop-cane",
            name="乌木拐杖",
            description="一根深色硬木拐杖（全局通用资料）",
            style="真人古装",
        )
    )
    await db.flush()
    # 出图计划按**项目关联**装载资产（场景/道具/服装走链接表）
    from app.models.studio import ProjectPropLink

    db.add(
        ProjectPropLink(
            project_id=PROJECT_ID,
            prop_id="prop-cane",
            chapter_id=CHAPTER_ID,
        )
    )
    await db.flush()
    db.add(
        ChapterAssetProfile(
            project_id=PROJECT_ID,
            chapter_id=CHAPTER_ID,
            asset_type="prop",
            name="乌木拐杖",
            name_key=normalize_name("乌木拐杖"),
            aliases=["拐杖"],
            profile={
                "material": "乌木",
                "shape": "杖首雕兽",
                "owner": "秦老夫人",
                "plot_role": "逼问嫁妆时的持物",
            },
            manual_overrides={"state": "拄立（人工补充）"},
            user_notes=["按导演要求：杖身要有摩挲包浆"],
            shot_refs=[
                {
                    "shot_id": "shot-b1",
                    "shot_index": 3,
                    "title": "老夫人逼问",
                    "matched": "乌木拐杖",
                    "script_excerpt": "秦老夫人拄着乌木拐杖立在听雨轩堂前，逼问嫁妆下落。",
                }
            ],
            evidence=[{"snippet": "秦老夫人拄着乌木拐杖立在听雨轩堂前", "grounded": True, "from_name": "乌木拐杖"}],
            status="confirmed",
            asset_id="prop-cane",
            source_hash="hash-basis",
            source_summary={"script_chars": 16, "shot_total": 1, "shot_indexes": [3]},
        )
    )
    await db.commit()
    return db, engine


def test_plan_preview_carries_generation_basis_when_chapter_given() -> None:
    async def _run() -> dict:
        db, engine = await _build_db()
        async with db:
            targets, _warnings = await build_targets(
                db,
                project_id=PROJECT_ID,
                asset_type="prop",
                stage="character_sheet",
                chapter_id=CHAPTER_ID,
            )
        await engine.dispose()
        assert targets, "项目里应当有可提交的道具"
        return targets[0].to_read().model_dump()

    target = asyncio.run(_run())
    basis = target["generation_basis"]
    assert basis, "给了 chapter_id 就必须带生成依据"

    # ② 规范化资料：模型字段 + 人工修改**合并生效**
    assert basis["asset_profile"]["material"] == "乌木"
    assert basis["asset_profile"]["state"] == "拄立（人工补充）", "人工修改必须出现在依据里"
    assert "导演要求" in basis["user_supplement"]
    # ① 剧本与分镜
    assert basis["shot_refs"] and basis["shot_refs"][0]["shot_index"] == 3
    assert basis["script_excerpts"] and "乌木拐杖" in basis["script_excerpts"][0]["text"]
    # ③ 隔离边界与来源
    assert basis["global_asset"] is True
    assert basis["structured_source"] == "asset_description+chapter_record"
    assert "本章" in basis["notes"][1] or "全局资产" in basis["notes"][1]
    # 项目风格 / 类型要求 / 本次会用的提示词
    assert "真人古装" in basis["project_style"]
    assert basis["asset_type_requirement"]
    assert basis["final_prompt"]


def test_plan_preview_basis_is_absent_without_chapter() -> None:
    """没给 chapter_id → 不装配依据（旧调用方行为一个字不变）。"""

    async def _run() -> dict:
        db, engine = await _build_db()
        async with db:
            targets, _warnings = await build_targets(
                db, project_id=PROJECT_ID, asset_type="prop", stage="character_sheet"
            )
        await engine.dispose()
        return targets[0].to_read().model_dump()

    target = asyncio.run(_run())
    assert target["generation_basis"] == {}
    assert target["prompt"]  # 其它字段照旧


def test_plan_preview_basis_does_not_fabricate_when_record_missing() -> None:
    """本章没有该资产的结构化资料行 → 如实说明来源，`asset_profile` 留空，绝不编造。"""

    async def _run() -> dict:
        db, engine = await _build_db()
        async with db:
            from app.models.studio import ChapterAssetProfile
            from sqlalchemy import delete

            await db.execute(delete(ChapterAssetProfile))
            await db.commit()
            targets, _warnings = await build_targets(
                db,
                project_id=PROJECT_ID,
                asset_type="prop",
                stage="character_sheet",
                chapter_id=CHAPTER_ID,
            )
        await engine.dispose()
        return targets[0].to_read().model_dump()

    basis = asyncio.run(_run())["generation_basis"]
    assert basis["asset_profile"] == {}
    assert basis["shot_refs"] == []
    assert basis["structured_source"] == "asset_description"
    assert "没有这份资产的结构化资料行" in " ".join(basis["notes"])
