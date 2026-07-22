from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import DeliveryMode
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
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import GenerationTask, GenerationTaskStatus
from app.services.film.generated_video import run_video_generation_task
from app.services.film.shot_frame_prompt_tasks import run_shot_frame_prompt_task
from app.services.studio.image_task_runner import run_image_generation_task


@pytest.mark.asyncio
async def test_run_video_generation_task_marks_cancelled_before_execute(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "video-worker-cancel.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={"task_kind": "video_generation", "run_args": {"shot_id": "shot-1"}},
            mode=DeliveryMode.async_polling,
            task_kind="video_generation",
        )
        db.add_all([
            ExperimentSession(id="video-session-1", lab_type="video", title="视频任务"),
            ExperimentMessage(
                id="video-message-1", session_id="video-session-1", role="task", content="生成中",
                task_id=task.id, status="pending", payload={"ratio": "16:9"}, sequence=1,
            ),
        ])
        await store.request_cancel(task.id, "用户取消")
        await db.commit()

    monkeypatch.setattr("app.services.film.generated_video.async_session_maker", session_local)

    await run_video_generation_task(task_id=task.id, run_args={"shot_id": "shot-1"})

    async with session_local() as db:
        row = await db.get(GenerationTask, task.id)
        assert row is not None
        assert row.status == GenerationTaskStatus.cancelled
        assert bool(row.cancel_requested) is True
        message = (await db.get(ExperimentMessage, "video-message-1"))
        assert message is not None
        assert message.status == "cancelled"
        assert message.payload["error"] == "任务已取消"

    await engine.dispose()


@pytest.mark.asyncio
async def test_run_image_generation_task_marks_cancelled_before_execute(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "image-worker-cancel.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={
                "task_kind": "image_generation",
                "run_args": {"relation_type": "character", "relation_entity_id": "char-1"},
            },
            mode=DeliveryMode.async_polling,
            task_kind="image_generation",
        )
        db.add_all([
            ExperimentSession(id="image-session-1", lab_type="image", title="图片任务"),
            ExperimentMessage(
                id="image-message-1", session_id="image-session-1", role="task", content="生成中",
                task_id=task.id, status="pending", payload={"reference_file_ids": []}, sequence=1,
            ),
        ])
        await store.request_cancel(task.id, "用户取消")
        await db.commit()

    monkeypatch.setattr("app.services.studio.image_task_runner.async_session_maker", session_local)

    await run_image_generation_task(
        task_id=task.id,
        run_args={"relation_type": "character", "relation_entity_id": "char-1"},
    )

    async with session_local() as db:
        row = await db.get(GenerationTask, task.id)
        assert row is not None
        assert row.status == GenerationTaskStatus.cancelled
        assert bool(row.cancel_requested) is True
        message = (await db.get(ExperimentMessage, "image-message-1"))
        assert message is not None
        assert message.status == "cancelled"
        assert message.payload["error"] == "任务已取消"

    await engine.dispose()


@pytest.mark.asyncio
async def test_run_image_generation_task_persists_success_to_experiment_message(monkeypatch, tmp_path) -> None:
    """图片 Worker 成功后应将结果合并写入实验任务气泡。"""
    db_path = tmp_path / "image-worker-session-success.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={"task_kind": "image_generation", "run_args": {}},
            mode=DeliveryMode.async_polling,
            task_kind="image_generation",
        )
        db.add_all([
            ExperimentSession(id="image-success-session", lab_type="image", title="图片成功任务"),
            ExperimentMessage(
                id="image-success-message", session_id="image-success-session", role="task", content="生成中",
                task_id=task.id, status="pending", payload={"reference_file_ids": ["ref-1"]}, sequence=1,
            ),
        ])
        await db.commit()

    class _FakeImageTask:
        """替代供应商调用，提供稳定的图片生成结果。"""

        def __init__(self, *_args, **_kwargs) -> None:
            pass

        async def run(self) -> None:
            return None

        async def get_result(self):
            return type("ImageResult", (), {"model_dump": lambda _self: {"images": [{"url": "https://example.com/image.png"}]}})()

    async def _skip_asset_persistence(*_args, **_kwargs) -> str:
        """实验室结果测试不需要写入业务资产。"""
        return "generated-image-file"

    async def _no_related_shot(*_args, **_kwargs) -> None:
        """图片实验室任务不关联镜头。"""
        return None

    monkeypatch.setattr("app.services.studio.image_task_runner.async_session_maker", session_local)
    monkeypatch.setattr("app.services.studio.image_task_runner.ImageGenerationTask", _FakeImageTask)
    monkeypatch.setattr("app.services.studio.image_task_runner._persist_images_to_assets", _skip_asset_persistence)
    monkeypatch.setattr("app.services.studio.image_task_runner._resolve_related_shot_id", _no_related_shot)

    await run_image_generation_task(
        task.id,
        {
            "provider": "openai", "api_key": "test", "relation_type": "image_lab",
            "relation_entity_id": "image-success-message", "input": {"prompt": "测试图片", "model": "test-model"},
        },
    )

    async with session_local() as db:
        message = await db.get(ExperimentMessage, "image-success-message")
        task_row = await db.get(GenerationTask, task.id)
        assert message is not None
        assert task_row is not None
        assert message.status == "succeeded"
        assert message.payload["reference_file_ids"] == ["ref-1"]
        assert message.payload["result"]["file_id"] == "generated-image-file"
        assert message.payload["result"]["images"][0]["url"] == "https://example.com/image.png"
        assert task_row.result is not None
        assert task_row.result["file_id"] == "generated-image-file"
    await engine.dispose()


@pytest.mark.asyncio
async def test_run_image_generation_task_persists_failure_to_experiment_message(monkeypatch, tmp_path) -> None:
    """图片 Worker 输入失败后应将错误写入实验任务气泡。"""
    db_path = tmp_path / "image-worker-session-failure.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={"task_kind": "image_generation", "run_args": {}},
            mode=DeliveryMode.async_polling,
            task_kind="image_generation",
        )
        db.add_all([
            ExperimentSession(id="image-failure-session", lab_type="image", title="图片失败任务"),
            ExperimentMessage(
                id="image-failure-message", session_id="image-failure-session", role="task", content="生成中",
                task_id=task.id, status="pending", payload={"reference_file_ids": []}, sequence=1,
            ),
        ])
        await db.commit()

    monkeypatch.setattr("app.services.studio.image_task_runner.async_session_maker", session_local)
    await run_image_generation_task(task.id, {"provider": "openai", "api_key": "test", "input": {}})

    async with session_local() as db:
        message = await db.get(ExperimentMessage, "image-failure-message")
        assert message is not None
        assert message.status == "failed"
        assert message.payload["reference_file_ids"] == []
        assert message.payload["error"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_run_video_generation_task_persists_success_to_experiment_message(monkeypatch, tmp_path) -> None:
    """视频 Worker 成功后应持久化进度、产物 file_id 与任务气泡状态。"""
    db_path = tmp_path / "video-worker-session-success.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={"task_kind": "video_generation", "run_args": {}},
            mode=DeliveryMode.async_polling,
            task_kind="video_generation",
        )
        db.add_all([
            ExperimentSession(id="video-success-session", lab_type="video", title="视频成功任务"),
            ExperimentMessage(
                id="video-success-message", session_id="video-success-session", role="task", content="生成中",
                task_id=task.id, status="pending", payload={"ratio": "16:9"}, sequence=1,
            ),
        ])
        await db.commit()

    class _FakeVideoTask:
        """替代供应商调用，提供稳定的视频生成结果。"""

        def __init__(self, *_args, **_kwargs) -> None:
            pass

        async def run(self) -> None:
            return None

        async def get_result(self):
            return type("VideoResult", (), {"model_dump": lambda _self: {"url": "https://example.com/video.mp4"}})()

    async def _persist_to_library(*_args, **_kwargs):
        """实验室结果测试只返回归档文件标识。"""
        return type("VideoFile", (), {"id": "generated-video-file"})()

    monkeypatch.setattr("app.services.film.generated_video.async_session_maker", session_local)
    monkeypatch.setattr("app.services.film.generated_video.VideoGenerationTask", _FakeVideoTask)
    monkeypatch.setattr("app.services.film.generated_video.persist_generated_video_to_library", _persist_to_library)

    await run_video_generation_task(
        task.id,
        {
            "source": "video_lab", "provider": "vidu", "api_key": "test",
            "input": {"prompt": "测试视频", "ratio": "16:9"},
        },
    )

    async with session_local() as db:
        message = await db.get(ExperimentMessage, "video-success-message")
        assert message is not None
        assert message.status == "succeeded"
        assert message.payload["ratio"] == "16:9"
        assert message.payload["progress"] == 100
        assert message.payload["result"]["file_id"] == "generated-video-file"
    await engine.dispose()


@pytest.mark.asyncio
async def test_run_video_generation_task_persists_failure_to_experiment_message(monkeypatch, tmp_path) -> None:
    """视频 Worker 输入失败后应将错误写入实验任务气泡。"""
    db_path = tmp_path / "video-worker-session-failure.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={"task_kind": "video_generation", "run_args": {}},
            mode=DeliveryMode.async_polling,
            task_kind="video_generation",
        )
        db.add_all([
            ExperimentSession(id="video-failure-session", lab_type="video", title="视频失败任务"),
            ExperimentMessage(
                id="video-failure-message", session_id="video-failure-session", role="task", content="生成中",
                task_id=task.id, status="pending", payload={"ratio": "16:9"}, sequence=1,
            ),
        ])
        await db.commit()

    monkeypatch.setattr("app.services.film.generated_video.async_session_maker", session_local)
    await run_video_generation_task(task.id, {"source": "video_lab", "provider": "vidu", "api_key": "test", "input": {}})

    async with session_local() as db:
        message = await db.get(ExperimentMessage, "video-failure-message")
        assert message is not None
        assert message.status == "failed"
        assert message.payload["ratio"] == "16:9"
        assert message.payload["error"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_run_shot_frame_prompt_task_marks_cancelled_before_execute(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "shot-frame-worker-cancel.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={"task_kind": "shot_frame_prompt", "run_args": {"shot_id": "shot-1", "frame_type": "first"}},
            mode=DeliveryMode.async_polling,
            task_kind="shot_frame_prompt",
        )
        await store.request_cancel(task.id, "用户取消")
        await db.commit()

    monkeypatch.setattr("app.services.film.shot_frame_prompt_tasks.async_session_maker", session_local)

    await run_shot_frame_prompt_task(task_id=task.id, run_args={"shot_id": "shot-1", "frame_type": "first"})

    async with session_local() as db:
        row = await db.get(GenerationTask, task.id)
        assert row is not None
        assert row.status == GenerationTaskStatus.cancelled
        assert bool(row.cancel_requested) is True

    await engine.dispose()


@pytest.mark.asyncio
async def test_run_shot_frame_prompt_task_persists_debug_context(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "shot-frame-worker-success.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        db.add_all(
            [
                Project(
                    id="project-1",
                    name="项目一",
                    description="",
                    style=ProjectStyle.real_people_city,
                    visual_style=ProjectVisualStyle.live_action,
                ),
                Chapter(id="chapter-1", project_id="project-1", index=1, title="第一章"),
                Shot(id="shot-1", chapter_id="chapter-1", index=1, title="镜头一", script_excerpt="主角回头。"),
                ShotDetail(
                    id="shot-1",
                    camera_shot=CameraShotType.ms,
                    angle=CameraAngle.eye_level,
                    movement=CameraMovement.static,
                    duration=3,
                    atmosphere="紧张",
                    mood_tags=["紧张"],
                    vfx_type=VFXType.none,
                    vfx_note="无",
                ),
            ]
        )
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={
                "task_kind": "shot_frame_prompt",
                "run_args": {
                    "shot_id": "shot-1",
                    "frame_type": "first",
                    "input": {"script_excerpt": "主角回头。", "visual_style": "现实"},
                },
            },
            mode=DeliveryMode.async_polling,
            task_kind="shot_frame_prompt",
        )
        await db.commit()

    class _FakeAgent:
        def __init__(self, _llm) -> None:
            pass

        async def aextract(self, **_kwargs):
            return type("Result", (), {"prompt": "中景，主角警惕地回头。", "model_dump": lambda self: {"prompt": "中景，主角警惕地回头。"}})()

    monkeypatch.setattr("app.services.film.shot_frame_prompt_tasks.async_session_maker", session_local)
    monkeypatch.setattr("app.services.film.shot_frame_prompt_tasks.build_default_text_llm_sync", lambda *_args, **_kwargs: object())
    monkeypatch.setattr("app.services.film.shot_frame_prompt_tasks.ShotFirstFramePromptAgent", _FakeAgent)

    await run_shot_frame_prompt_task(
        task_id=task.id,
        run_args={
            "shot_id": "shot-1",
            "frame_type": "first",
            "input": {"script_excerpt": "主角回头。", "visual_style": "现实", "character_context": "- 主角：警惕"},
        },
    )

    async with session_local() as db:
        row = await db.get(GenerationTask, task.id)
        detail = await db.get(ShotDetail, "shot-1")
        assert row is not None
        assert row.status == GenerationTaskStatus.succeeded
        assert isinstance(row.result, dict)
        assert row.result["prompt"] == "中景，主角警惕地回头。"
        assert row.result["debug_context"]["visual_style"] == "现实"
        assert row.result["debug_context"]["character_context"] == "- 主角：警惕"
        assert row.result["quality_checks"]["passed"] is True
        assert row.result["quality_checks"]["issues"] == []
        assert detail is not None
        assert detail.first_frame_prompt == "中景，主角警惕地回头。"

    await engine.dispose()


@pytest.mark.asyncio
async def test_run_shot_frame_prompt_task_retries_when_result_contains_mapping_text(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "shot-frame-worker-retry.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        db.add_all(
            [
                Project(
                    id="project-1",
                    name="项目一",
                    description="",
                    style=ProjectStyle.real_people_city,
                    visual_style=ProjectVisualStyle.live_action,
                ),
                Chapter(id="chapter-1", project_id="project-1", index=1, title="第一章"),
                Shot(id="shot-1", chapter_id="chapter-1", index=1, title="镜头一", script_excerpt="主角回头。"),
                ShotDetail(
                    id="shot-1",
                    camera_shot=CameraShotType.ms,
                    angle=CameraAngle.eye_level,
                    movement=CameraMovement.static,
                    duration=3,
                    atmosphere="紧张",
                    mood_tags=["紧张"],
                    vfx_type=VFXType.none,
                    vfx_note="无",
                ),
            ]
        )
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={
                "task_kind": "shot_frame_prompt",
                "run_args": {
                    "shot_id": "shot-1",
                    "frame_type": "first",
                    "input": {"script_excerpt": "主角回头。", "character_context": "- 主角：警惕"},
                },
            },
            mode=DeliveryMode.async_polling,
            task_kind="shot_frame_prompt",
        )
        await db.commit()

    class _FakeAgent:
        calls: list[dict] = []

        def __init__(self, _llm) -> None:
            pass

        async def aextract(self, **kwargs):
            _FakeAgent.calls.append(dict(kwargs))
            if len(_FakeAgent.calls) == 1:
                return type(
                    "Result",
                    (),
                    {
                        "prompt": "## 图片内容说明\n图1: 主角\n## 生成内容\n图1警惕地回头。",
                        "model_dump": lambda self: {"prompt": self.prompt},
                    },
                )()
            return type(
                "Result",
                (),
                {
                    "prompt": "中景，主角警惕地回头。",
                    "model_dump": lambda self: {"prompt": self.prompt},
                },
            )()

    monkeypatch.setattr("app.services.film.shot_frame_prompt_tasks.async_session_maker", session_local)
    monkeypatch.setattr("app.services.film.shot_frame_prompt_tasks.build_default_text_llm_sync", lambda *_args, **_kwargs: object())
    monkeypatch.setattr("app.services.film.shot_frame_prompt_tasks.ShotFirstFramePromptAgent", _FakeAgent)

    await run_shot_frame_prompt_task(
        task_id=task.id,
        run_args={
            "shot_id": "shot-1",
            "frame_type": "first",
            "input": {"script_excerpt": "主角回头。", "character_context": "- 主角：警惕"},
        },
    )

    async with session_local() as db:
        row = await db.get(GenerationTask, task.id)
        detail = await db.get(ShotDetail, "shot-1")
        assert row is not None
        assert row.status == GenerationTaskStatus.succeeded
        assert isinstance(row.result, dict)
        assert row.result["prompt"] == "中景，主角警惕地回头。"
        assert row.result["debug_context"]["retry_guidance"]
        assert row.result["quality_checks"]["passed"] is True
        assert row.result["quality_checks"]["issues"] == []
        assert detail is not None
        assert detail.first_frame_prompt == "中景，主角警惕地回头。"

    assert len(_FakeAgent.calls) == 2
    assert _FakeAgent.calls[1]["retry_guidance"]

    await engine.dispose()
