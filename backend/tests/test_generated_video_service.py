from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
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
    VFXType,
)
from app.bootstrap import bootstrap_all_registries
from app.services.llm import resolve_provider_key_from_name
from app.services.studio.generation.video.derive_preview import derive_video_preview
from app.services.studio.generation.video.build_base import VideoBaseDraft
from app.services.studio.generation.video.build_context import VideoGenerationContext
from app.services.studio.generation.video import validate_images_count
from app.services.studio import get_shot_video_readiness


async def _build_session() -> tuple[AsyncSession, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return session_local(), engine


async def _seed_shot_graph(db: AsyncSession) -> None:
    project = Project(
        id="p1",
        name="项目一",
        description="",
        style=ProjectStyle.real_people_city,
        visual_style=ProjectVisualStyle.live_action,
    )
    chapter = Chapter(id="c1", project_id="p1", index=1, title="第一章")
    prev_shot = Shot(id="s0", chapter_id="c1", index=0, title="镜头零", script_excerpt="角色沿着墙边逼近门口。")
    shot = Shot(id="s1", chapter_id="c1", index=1, title="镜头一", script_excerpt="角色推门而入。")
    next_shot = Shot(id="s2", chapter_id="c1", index=2, title="镜头二", script_excerpt="角色停下脚步，盯向走廊尽头。")
    prev_detail = ShotDetail(
        id="s0",
        camera_shot=CameraShotType.ms,
        angle=CameraAngle.eye_level,
        movement=CameraMovement.dolly_in,
        duration=4,
        description="主角贴墙缓慢逼近门口，视线紧盯前方。",
    )
    detail = ShotDetail(
        id="s1",
        camera_shot=CameraShotType.ms,
        angle=CameraAngle.eye_level,
        movement=CameraMovement.static,
        duration=6,
        follow_atmosphere=True,
        vfx_type=VFXType.none,
        description="角色推门后微微停顿，确认走廊内部情况，再向前迈出一步。",
        first_frame_prompt="首帧提示词",
        last_frame_prompt="尾帧提示词",
        key_frame_prompt="关键帧提示词",
    )
    next_detail = ShotDetail(
        id="s2",
        camera_shot=CameraShotType.cu,
        angle=CameraAngle.eye_level,
        movement=CameraMovement.static,
        duration=3,
        description="角色停住动作，盯向走廊尽头，情绪绷紧。",
    )
    db.add_all([project, chapter, prev_shot, shot, next_shot, prev_detail, detail, next_detail])
    await db.commit()


@pytest.mark.asyncio
async def test_validate_images_count_rejects_wrong_count() -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_images_count("first_last", ["only-one"])

    assert exc_info.value.status_code == 400
    assert "requires exactly 2 images" in exc_info.value.detail


def test_resolve_provider_key_from_name_supports_known_aliases() -> None:
    bootstrap_all_registries()
    assert resolve_provider_key_from_name("OpenAI") == "openai"
    assert resolve_provider_key_from_name("火山引擎") == "volcengine"
    assert resolve_provider_key_from_name("Doubao Video") == "volcengine"
    assert resolve_provider_key_from_name("Vidu") == "vidu"


@pytest.mark.asyncio
async def test_template_render_is_enriched_with_guidance_when_template_omits_it(monkeypatch: pytest.MonkeyPatch) -> None:
    db, engine = await _build_session()
    async with db:
        await _seed_shot_graph(db)

        async def _fake_template(*_args, **_kwargs):
            return type("Template", (), {"id": "tpl-1", "name": "simple", "content": "镜头标题：{{ title }}"})()

        monkeypatch.setattr(
            "app.services.studio.generation.video.derive_preview._resolve_video_prompt_template",
            _fake_template,
        )

        derived = await derive_video_preview(
            db,
            base=VideoBaseDraft(shot_id="s1", prompt=""),
            context=VideoGenerationContext(
                shot_id="s1",
                reference_mode="text_only",
                images=[],
                template_id=None,
            ),
        )

        assert "镜头标题：镜头一" in derived.rendered_prompt
        assert "动作节拍：" in derived.rendered_prompt
        assert "连续性要求：" in derived.rendered_prompt
        assert "构图锚点：" in derived.rendered_prompt
        assert "朝向与视线：" in derived.rendered_prompt
    await engine.dispose()


@pytest.mark.asyncio
async def test_manual_video_prompt_is_also_enriched_with_guidance() -> None:
    db, engine = await _build_session()
    async with db:
        await _seed_shot_graph(db)

        derived = await derive_video_preview(
            db,
            base=VideoBaseDraft(shot_id="s1", prompt="手动视频提示词"),
            context=VideoGenerationContext(
                shot_id="s1",
                reference_mode="text_only",
                images=[],
                template_id=None,
            ),
        )

        assert "手动视频提示词" in derived.rendered_prompt
        assert "动作节拍：" in derived.rendered_prompt
        assert "连续性要求：" in derived.rendered_prompt
        assert "构图锚点：" in derived.rendered_prompt
        assert "朝向与视线：" in derived.rendered_prompt
    await engine.dispose()


@pytest.mark.asyncio
async def test_template_render_keeps_existing_guidance_without_duplicate_suffix(monkeypatch: pytest.MonkeyPatch) -> None:
    db, engine = await _build_session()
    async with db:
        await _seed_shot_graph(db)

        async def _fake_template(*_args, **_kwargs):
            return type(
                "Template",
                (),
                {
                    "id": "tpl-2",
                    "name": "guided",
                    "content": "镜头标题：{{ title }}\n连续性要求：{{ continuity_guidance }}",
                },
            )()

        monkeypatch.setattr(
            "app.services.studio.generation.video.derive_preview._resolve_video_prompt_template",
            _fake_template,
        )

        derived = await derive_video_preview(
            db,
            base=VideoBaseDraft(shot_id="s1", prompt=""),
            context=VideoGenerationContext(
                shot_id="s1",
                reference_mode="text_only",
                images=[],
                template_id=None,
            ),
        )

        assert derived.rendered_prompt.count("连续性要求：") == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_shot_video_readiness_reports_ready_for_text_only() -> None:
    db, engine = await _build_session()
    async with db:
        await _seed_shot_graph(db)
        shot = await db.get(Shot, "s1")
        assert shot is not None
        shot.last_extracted_at = datetime.now(timezone.utc)
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(id="m_video", name="sora-mini", category=ModelCategoryKey.video, provider_id="p1")
        settings = ModelSettings(id=1, default_video_model_id="m_video")
        db.add_all([provider, model, settings])
        await db.flush()

        readiness = await get_shot_video_readiness(db, shot_id="s1", reference_mode="text_only")

        assert readiness.ready is True
        assert {item.key: item.ok for item in readiness.checks}["extraction_ready"] is True
        assert {item.key: item.ok for item in readiness.checks}["reference_frames_ready"] is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_shot_video_readiness_reports_missing_reference_frame() -> None:
    db, engine = await _build_session()
    async with db:
        await _seed_shot_graph(db)
        shot = await db.get(Shot, "s1")
        assert shot is not None
        shot.last_extracted_at = datetime.now(timezone.utc)
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(id="m_video", name="sora-mini", category=ModelCategoryKey.video, provider_id="p1")
        settings = ModelSettings(id=1, default_video_model_id="m_video")
        db.add_all([provider, model, settings])
        await db.flush()

        readiness = await get_shot_video_readiness(db, shot_id="s1", reference_mode="first")

        checks = {item.key: item for item in readiness.checks}
        assert readiness.ready is False
        assert checks["reference_frames_ready"].ok is False
        assert "first" in checks["reference_frames_ready"].message
    await engine.dispose()
