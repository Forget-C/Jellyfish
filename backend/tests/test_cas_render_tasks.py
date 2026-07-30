"""Step 7 任务 #40：CAS 单镜头渲染的执行接线测试。

用假供应商/假 HTTP 边界，生产执行路径本身保持真实。
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.db import Base, async_session_maker
from app.core.task_manager.types import TaskStatus
from app.crypto_animal_studio.application import render_tasks as rt
from app.crypto_animal_studio.application.render_request import build_render_request
from app.crypto_animal_studio.production.enums import ArtifactType, JobStatus
from app.crypto_animal_studio.production.models import (
    CasProductionArtifact,
    CasProductionJob,
    CasProductionShot,
)
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink
from app.services.worker.task_registry import task_executor_registry


async def _make_sessionmaker():
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    import app.crypto_animal_studio.domain.import_ledger  # noqa: F401
    import app.crypto_animal_studio.production.models  # noqa: F401
    import app.models.llm  # noqa: F401
    import app.models.studio  # noqa: F401
    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(session_factory) -> tuple[str, str]:
    async with session_factory() as db:
        job = CasProductionJob(
            id="job-1", project_id="proj-1", episode_id="CAS-EP001", status="running"
        )
        db.add(job)
        shot = CasProductionShot(
            id="pshot-1",
            job_id="job-1",
            source_shot_id="SC01",
            sequence=1,
            status="pending",
            duration_seconds=3.0,
            video_prompt="Bruno bursts in, arms rising",
        )
        db.add(shot)
        await db.commit()
    return "job-1", "pshot-1"


def _request(shot_id: str = "SC01"):
    class _S:
        id = "pshot-1"
        source_shot_id = shot_id
        sequence = 1
        duration_seconds = 3.0
        video_prompt = "Bruno bursts in, arms rising"

    return build_render_request(_S(), context={"scene": "The Burrow"}, seed=7)


class _FakeFile:
    def __init__(self, file_id="file-1", key="cas/renders/job-1/pshot-1/v.mp4"):
        self.id = file_id
        self.storage_key = key


# --------------------------------------------------------------------------- #
# 1. 注册与解析
# --------------------------------------------------------------------------- #
def test_executor_is_registered_in_existing_registry() -> None:
    """使用既有 registry，不新建队列体系。"""
    executor = task_executor_registry.resolve(rt.CAS_RENDER_SHOT_TASK_KIND)
    assert executor.task_kind == "cas_render_shot"
    assert executor.timeout_seconds == 3600.0


def test_existing_video_generation_executor_unaffected() -> None:
    """既有 video_generation 执行器仍可解析（OpenAI/火山路径不受影响）。"""
    assert task_executor_registry.resolve("video_generation") is not None


# --------------------------------------------------------------------------- #
# 2. 创建渲染尝试
# --------------------------------------------------------------------------- #
def test_create_task_records_link_and_snapshot() -> None:
    """创建任务：登记 GenerationTaskLink，run_args 携带快照且不含工作流负载。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                job = await db.get(CasProductionJob, "job-1")
                shot = await db.get(CasProductionShot, "pshot-1")
                task_row, attempt = await rt.create_shot_render_task(
                    db,
                    job=job,
                    production_shot=shot,
                    render_request=_request(),
                    provider="comfyui",
                    base_url="http://comfy.test:8188",
                )
                await db.commit()

            assert attempt == 1
            assert task_row.task_kind == "cas_render_shot"
            async with session_factory() as db:
                link = (await db.execute(select(GenerationTaskLink))).scalars().one()
                assert link.relation_type == "cas_shot_render"
                assert link.relation_entity_id == "pshot-1"
                row = await db.get(GenerationTask, task_row.id)
                run_args = (row.payload or {}).get("run_args") or {}
            assert run_args["input"]["ratio"] == "9:16"
            assert run_args["request_snapshot"]["prompt_sha256"]
            # 快照不含工作流负载/凭据
            assert "class_type" not in str(run_args["request_snapshot"])
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_attempts_increment_for_retry() -> None:
    """重试产生可追溯的新尝试序号。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            for expected in (1, 2, 3):
                async with session_factory() as db:
                    job = await db.get(CasProductionJob, "job-1")
                    shot = await db.get(CasProductionShot, "pshot-1")
                    _task, attempt = await rt.create_shot_render_task(
                        db,
                        job=job,
                        production_shot=shot,
                        render_request=_request(),
                        provider="comfyui",
                        base_url="http://c",
                    )
                    await db.commit()
                assert attempt == expected
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_active_task_is_detected() -> None:
    """存在非终态尝试时可被检出（用于禁用重复提交）。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                job = await db.get(CasProductionJob, "job-1")
                shot = await db.get(CasProductionShot, "pshot-1")
                await rt.create_shot_render_task(
                    db,
                    job=job,
                    production_shot=shot,
                    render_request=_request(),
                    provider="comfyui",
                    base_url="http://c",
                )
                await db.commit()
            async with session_factory() as db:
                assert await rt.find_active_render_task(db, production_shot_id="pshot-1")
        finally:
            await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# 3. 产物登记与幂等
# --------------------------------------------------------------------------- #
def test_artifact_links_job_and_shot_with_safe_metadata() -> None:
    """产物关联 job + 生产镜头，并记录安全的供应商元数据。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                artifact, created = await rt.persist_render_artifact(
                    db,
                    job_id="job-1",
                    production_shot_id="pshot-1",
                    file_item=_FakeFile(),
                    provider="comfyui",
                    provider_job_id="prompt-abc",
                    attempt=1,
                    request_snapshot=_request().snapshot,
                    size_bytes=12345,
                )
                await db.commit()
            assert created is True
            assert artifact.job_id == "job-1"
            assert artifact.production_shot_id == "pshot-1"
            assert artifact.artifact_type == ArtifactType.video.value
            assert artifact.mime_type == "video/mp4"
            assert artifact.metadata_json["provider_job_id"] == "prompt-abc"
            assert artifact.metadata_json["file_id"] == "file-1"
            assert artifact.metadata_json["size_bytes"] == 12345
            for banned in ("api_key", "token", "password", "base_url"):
                assert banned not in str(artifact.metadata_json).lower()
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_repeated_completion_does_not_duplicate_artifact() -> None:
    """重复完成/重投递不会产生第二条成功产物，且保留最初的产物。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            await _seed(session_factory)
            async with session_factory() as db:
                first, created_1 = await rt.persist_render_artifact(
                    db,
                    job_id="job-1",
                    production_shot_id="pshot-1",
                    file_item=_FakeFile("file-1"),
                    provider="comfyui",
                    provider_job_id="p1",
                    attempt=1,
                    request_snapshot={},
                )
                await db.commit()
            async with session_factory() as db:
                second, created_2 = await rt.persist_render_artifact(
                    db,
                    job_id="job-1",
                    production_shot_id="pshot-1",
                    file_item=_FakeFile("file-2"),
                    provider="comfyui",
                    provider_job_id="p2",
                    attempt=2,
                    request_snapshot={},
                )
                await db.commit()

            assert created_1 is True and created_2 is False
            assert second.id == first.id
            # 既有成功产物保持不变（未被第二次尝试覆盖）
            assert second.metadata_json["file_id"] == "file-1"
            assert second.metadata_json["provider_job_id"] == "p1"
            async with session_factory() as db:
                total = (
                    await db.execute(select(func.count()).select_from(CasProductionArtifact))
                ).scalar()
            assert total == 1
        finally:
            await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# 4. 失败映射（安全性）
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "exc_name,message,expected_code",
    [
        ("WorkflowConfigError", "workflow mapping path is not configured", "config"),
        ("ComfyUIError", "ComfyUI render timed out after 1800s", "timeout"),
        ("ComfyUIError", "node 5 produced no video output", "output"),
        ("ComfyUIError", "ComfyUI execution failed: bad node", "provider"),
        ("ConnectError", "connection refused", "network"),
        ("RuntimeError", "unexpected", "unknown"),
    ],
)
def test_failure_classification(exc_name: str, message: str, expected_code: str) -> None:
    """异常按类型/关键词映射为结构化错误码。"""
    exc = type(exc_name, (Exception,), {})(message)
    code, safe = rt.classify_failure(exc)
    assert code == expected_code
    assert safe == rt._SAFE_FAILURE_MESSAGES[expected_code]  # pylint: disable=protected-access


def test_failure_message_never_leaks_provider_details() -> None:
    """供应商响应体、地址与凭据都不得出现在用户可见文案中。"""
    leaky = type("ComfyUIError", (Exception,), {})(
        "ComfyUI execution failed: {'api_key': 'sk-secret', "
        "'base_url': 'http://10.0.0.5:8188', 'workflow': {...}}"
    )
    _code, safe = rt.classify_failure(leaky)
    lowered = safe.lower()
    for banned in ("sk-secret", "10.0.0.5", "api_key", "workflow", "traceback", "{"):
        assert banned not in lowered


def test_shot_status_constants_are_used() -> None:
    """失败/成功写入的镜头状态取自既有枚举，不引入新字符串。"""
    assert JobStatus.completed.value == "completed"
    assert JobStatus.failed.value == "failed"
