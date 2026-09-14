from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.studio import (
    CameraAngle,
    CameraMovement,
    CameraShotType,
    Chapter,
    Project,
    ProjectStyle,
    ProjectVisualStyle,
    Shot,
    ShotDetail,
)
from app.schemas.skills.script_processing import ShotSemanticSuggestion, StudioScriptExtractionDraft, StudioShotDraft
from app.services.script_processing_worker import apply_script_result
from app.services.studio.shot_extraction_draft import build_script_extraction_draft_for_shot
from app.services.studio.shot_semantic_defaults import apply_shot_semantic_defaults_from_draft


async def _seed_async_graph(db: AsyncSession) -> str:
    """构造最小项目/章节/镜头图，便于验证镜头语言默认值写回。"""

    project = Project(
        id="project-1",
        name="项目一",
        style=ProjectStyle.guoman,
        visual_style=ProjectVisualStyle.anime,
    )
    chapter = Chapter(id="chapter-1", project_id=project.id, index=1, title="章节一")
    shot = Shot(id="shot-1", chapter_id=chapter.id, index=1, title="镜头一", script_excerpt="原始摘录")
    detail = ShotDetail(
        id=shot.id,
        camera_shot=CameraShotType.ms,
        angle=CameraAngle.eye_level,
        movement=CameraMovement.static,
        duration=4,
    )
    db.add_all([project, chapter, shot, detail])
    await db.flush()
    return shot.id




def _build_semantic_draft() -> StudioScriptExtractionDraft:
    """构造带镜头语言默认建议的提取草稿。"""

    return StudioScriptExtractionDraft(
        project_id="project-1",
        chapter_id="chapter-1",
        script_text="测试文本",
        characters=[],
        scenes=[],
        props=[],
        costumes=[],
        shots=[
            StudioShotDraft(
                index=1,
                title="镜头一",
                script_excerpt="摘录",
                scene_name=None,
                character_names=[],
                prop_names=[],
                costume_names=[],
                dialogue_lines=[],
                actions=["听到声音后僵住"],
                semantic_suggestion=ShotSemanticSuggestion(
                    camera_shot=CameraShotType.cu,
                    angle=CameraAngle.low_angle,
                    movement=CameraMovement.track,
                    duration=6,
                    action_beats=["听到异响骤然僵住", "修枝剪脱手下坠"],
                ),
            )
        ],
    )


@pytest.mark.asyncio
async def test_apply_shot_semantic_defaults_from_draft_updates_shot_detail() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.studio  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        shot_id = await _seed_async_graph(db)
        draft = _build_semantic_draft()

        await apply_shot_semantic_defaults_from_draft(db, chapter_id="chapter-1", draft=draft)
        detail = await db.get(ShotDetail, shot_id)

        assert detail is not None
        assert detail.camera_shot == CameraShotType.cu
        assert detail.angle == CameraAngle.low_angle
        assert detail.movement == CameraMovement.track
        assert detail.duration == 6
        assert detail.action_beats == ["听到异响骤然僵住", "修枝剪脱手下坠"]

    await engine.dispose()


@pytest.mark.asyncio
async def test_build_script_extraction_draft_for_shot_includes_semantic_suggestion() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.studio  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        shot_id = await _seed_async_graph(db)
        draft = await build_script_extraction_draft_for_shot(db, shot_id)

        assert len(draft.shots) == 1
        semantic = draft.shots[0].semantic_suggestion
        assert semantic is not None
        assert semantic.camera_shot == CameraShotType.ms
        assert semantic.angle == CameraAngle.eye_level
        assert semantic.movement == CameraMovement.static
        assert semantic.duration == 4
        assert semantic.action_beats == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_apply_script_result_updates_shot_detail() -> None:
    """新脚本交付入口仍将镜头语言建议写回业务表。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            shot_id = await _seed_async_graph(db)
            draft = _build_semantic_draft()
            await apply_script_result(db, kind="script_extract", run_args={"chapter_id": "chapter-1"}, result=draft)
            await db.commit()
            detail = await db.get(ShotDetail, shot_id)
            await db.refresh(detail)
            assert detail.camera_shot == CameraShotType.cu
            assert detail.angle == CameraAngle.low_angle
            assert detail.movement == CameraMovement.track
            assert detail.duration == 6
            assert detail.action_beats == ["听到异响骤然僵住", "修枝剪脱手下坠"]
    finally:
        await engine.dispose()
