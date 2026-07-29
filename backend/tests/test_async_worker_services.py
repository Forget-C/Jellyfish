from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import DeliveryMode
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import GenerationTask, GenerationTaskStatus
from app.services.film.generated_video import run_video_generation_task
from app.services.studio.image_task_runner import run_image_generation_task


@pytest.mark.asyncio
async def test_run_video_generation_task_uses_snapshot_instead_of_run_args(monkeypatch, tmp_path) -> None:
    """视频 Worker 只消费统一快照，忽略历史 run_args 中的敏感字段。"""
    db_path = tmp_path / "video-worker-snapshot.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    snapshot = {
        "model_id": "video-model-1",
        "model_revision_id": "video-revision-1",
        "canonical_target": {"kind": "shot_video", "entity_id": "shot-1"},
        "expected_version_id": 1,
        "operation_input": {"kind": "video_generation", "ratio": "16:9"},
        "execution_prompt": "镜头运动",
    }
    async with session_local() as db:
        task = await SqlAlchemyTaskStore(db).create(
            payload={"snapshot": snapshot},
            mode=DeliveryMode.async_polling,
            task_kind="video_generation",
        )
        await db.commit()

    received: dict[str, object] = {}

    async def _run_snapshot(*_args, **kwargs):
        """记录传入 Worker 的冻结快照，避免真实调用供应商。"""
        received["snapshot"] = kwargs["snapshot_payload"]
        return {"file_id": "generated-video-file", "publish_status": "published"}

    async def _skip_status_recompute(*_args, **_kwargs) -> None:
        """此测试只验证 Worker 输入边界，不建立完整镜头领域数据。"""
        return None

    monkeypatch.setattr("app.services.film.generated_video.async_session_maker", session_local)
    monkeypatch.setattr("app.services.film.generated_video._run_snapshot_video_generation", _run_snapshot)
    monkeypatch.setattr("app.services.film.generated_video.recompute_shot_status", _skip_status_recompute)

    await run_video_generation_task(
        task.id,
        {"provider": "openai", "api_key": "must-not-be-read", "base_url": "https://invalid.example"},
    )

    async with session_local() as db:
        row = await db.get(GenerationTask, task.id)
        assert row is not None
        assert row.status == GenerationTaskStatus.succeeded
        assert row.result == {"file_id": "generated-video-file", "publish_status": "published"}
    assert received["snapshot"] == snapshot
    await engine.dispose()


@pytest.mark.asyncio
async def test_run_video_generation_task_marks_cancelled_before_execute(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "video-worker-cancel.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

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
    """P4 contract 后，缺少 snapshot 的历史图片 payload 必须明确失败。"""
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
        assert message.status == "failed"
        assert message.payload["reference_file_ids"] == ["ref-1"]
        assert message.payload["error"] == "image generation task snapshot is unavailable"
        assert task_row.error == "image generation task snapshot is unavailable"
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
async def test_run_video_generation_task_rejects_legacy_run_args(monkeypatch, tmp_path) -> None:
    """P4 切换窗口内，旧视频 payload 应明确失败而非读取持久化凭据。"""
    db_path = tmp_path / "video-worker-legacy-payload.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(
            payload={"task_kind": "video_generation", "run_args": {"api_key": "legacy-secret"}},
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

    monkeypatch.setattr("app.services.film.generated_video.async_session_maker", session_local)

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
        assert message.status == "failed"
        assert message.payload["ratio"] == "16:9"
        assert message.payload["error"] == "video generation task requires a unified snapshot payload"
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
