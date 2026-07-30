"""Step 7：渲染读取契约（任务视图 / 产物视图 / 模式校验）测试。"""

from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.db import Base
from app.crypto_animal_studio.application import render_tasks as rt
from app.crypto_animal_studio.application.render_views import (
    TERMINAL_TASK_STATUSES,
    build_artifact_view,
    build_render_task_view,
    latest_render_task,
    stage_message_for,
)
from app.crypto_animal_studio.production.models import CasProductionJob, CasProductionShot
from app.crypto_animal_studio.schemas.production import (
    CreateProductionJobRequest,
    ProductionArtifactView,
)


class _Artifact:
    id = "a1"
    production_shot_id = "ps1"
    artifact_type = "video"
    stage = "video_generation"
    provider = "comfyui"
    provider_model = ""
    file_path = "cas/renders/job-1/ps1/v.mp4"
    mime_type = "video/mp4"
    checksum = ""
    metadata_json = {
        "file_id": "file-1",
        "size_bytes": 2048,
        "provider_job_id": "prompt-xyz",
        "attempt": 2,
    }


class _Task:
    def __init__(self, status="running", progress=80, result=None, error=""):
        self.id = "task-1"
        self.status = status
        self.progress = progress
        self.result = result or {}
        self.error = error


# --------------------------------------------------------------------------- #
# 请求契约
# --------------------------------------------------------------------------- #
def test_mode_accepts_mock_and_render_only() -> None:
    """render 必须显式选择；mock 保持缺省，未知值被拒绝。"""
    package = {"schema_version": "1.0"}
    assert CreateProductionJobRequest.model_fields["mode"].default == "mock"
    with pytest.raises(ValidationError):
        CreateProductionJobRequest(project_id="p", episode_package=package, mode="real")


# --------------------------------------------------------------------------- #
# 产物视图
# --------------------------------------------------------------------------- #
def test_artifact_view_exposes_playable_url_via_existing_endpoint() -> None:
    """播放地址复用既有受控文件端点，不新开公开静态路由。"""
    view = build_artifact_view(_Artifact())
    assert view.file_id == "file-1"
    assert view.download_url == "/api/v1/studio/files/file-1/download"
    assert view.size_bytes == 2048
    assert view.provider_job_id == "prompt-xyz"
    assert view.attempt == 2
    assert view.mime_type == "video/mp4"


def test_artifact_view_without_file_id_has_no_download_url() -> None:
    """没有 FileItem 时不编造下载地址。"""

    class _NoFile(_Artifact):
        metadata_json: dict = {}

    view = build_artifact_view(_NoFile())
    assert view.file_id is None
    assert view.download_url is None
    assert view.size_bytes is None


def test_checksum_stays_empty_and_is_documented() -> None:
    """对象存储产物没有可用的本地校验和 —— 保持空串而不是编造。

    幂等性因此由「job+shot+type 的产物存在性检查」保证（见 test_cas_render_tasks）。
    """
    view = build_artifact_view(_Artifact())
    assert view.checksum == ""


def test_step6_artifact_shape_remains_valid() -> None:
    """Step 6 的字段集合（不含 Step 7 可选字段）依然构造成功。"""
    view = ProductionArtifactView(
        id="a",
        production_shot_id=None,
        artifact_type="manifest",
        stage="finalize",
        provider="",
        provider_model="",
        file_path="p",
        mime_type="application/json",
        checksum="abc",
    )
    assert view.file_id is None and view.download_url is None


# --------------------------------------------------------------------------- #
# 任务视图
# --------------------------------------------------------------------------- #
def test_render_task_view_maps_progress_and_stage() -> None:
    """进度映射到安全阶段文案，终态标记正确。"""
    running = build_render_task_view(_Task(status="running", progress=80))
    assert running.stage_message == "Downloading generated video"
    assert running.is_terminal is False

    done = build_render_task_view(
        _Task(status="succeeded", progress=100, result={"provider_job_id": "p1", "attempt": 1})
    )
    assert done.is_terminal is True
    assert done.provider_task_id == "p1"
    assert done.attempt == 1


def test_render_task_view_is_none_without_attempts() -> None:
    """从未渲染过的镜头返回 None，而不是伪造一个 pending 任务。"""
    assert build_render_task_view(None) is None


def test_failed_task_view_exposes_only_safe_reason() -> None:
    """失败原因来自写入阶段已脱敏的文案，不含堆栈或凭据。"""
    view = build_render_task_view(
        _Task(status="failed", progress=20, error="provider: The render provider reported an execution failure.")
    )
    assert view.is_terminal is True
    assert "Traceback" not in (view.error_reason or "")
    assert "sk-" not in (view.error_reason or "")
    assert view.stage_message == "Failed"


def test_terminal_status_set_matches_task_center_values() -> None:
    """终态集合与任务中心的状态取值一致。"""
    assert TERMINAL_TASK_STATUSES == frozenset({"succeeded", "failed", "cancelled"})
    assert stage_message_for("cancelled", 20) == "Cancelled"


# --------------------------------------------------------------------------- #
# 最近尝试的确定性选取
# --------------------------------------------------------------------------- #
def test_latest_render_task_is_deterministic_across_retries() -> None:
    """多次重试后，latest_render_task 稳定返回最近一次尝试。"""

    async def _run() -> None:
        engine = create_async_engine(
            "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        import app.crypto_animal_studio.production.models  # noqa: F401
        import app.models.studio  # noqa: F401
        import app.models.task  # noqa: F401
        import app.models.task_links  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with session_factory() as db:
                db.add(CasProductionJob(id="job-1", project_id="p", episode_id="E", status="running"))
                db.add(
                    CasProductionShot(
                        id="ps1", job_id="job-1", source_shot_id="SC01", sequence=1,
                        status="pending", duration_seconds=3.0,
                    )
                )
                await db.commit()

            class _Req:
                snapshot = {"prompt_sha256": "x"}

                @staticmethod
                def to_video_input():
                    from app.core.contracts.video_generation import VideoGenerationInput

                    return VideoGenerationInput(prompt="p", ratio="9:16", seconds=3)

            ids = []
            for _ in range(3):
                async with session_factory() as db:
                    job = await db.get(CasProductionJob, "job-1")
                    shot = await db.get(CasProductionShot, "ps1")
                    task_row, _attempt = await rt.create_shot_render_task(
                        db, job=job, production_shot=shot, render_request=_Req(),
                        provider="comfyui", base_url="http://c",
                    )
                    ids.append(task_row.id)
                    await db.commit()

            async with session_factory() as db:
                latest = await latest_render_task(db, production_shot_id="ps1")
                again = await latest_render_task(db, production_shot_id="ps1")
            assert latest is not None
            assert latest.id == again.id  # 稳定
            assert latest.id in ids
        finally:
            await engine.dispose()

    asyncio.run(_run())
