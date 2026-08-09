"""Step 7：假供应商端到端编排测试。

**真实的部分**（不打桩）：CasProductionJob/Shot、``create_shot_render_task``、
TaskManager、GenerationTask/GenerationTaskLink、注册到 task_executor_registry 的
``cas_render_shot`` runner ``run_cas_shot_render_task``、CAS 产物落库、以及
``render_views`` 读取投影。

**被伪造的边界**（明确声明）：
1. 供应商 HTTP —— 用假的 ``VideoGenerationTask`` 顶替，不发真实网络请求；
2. 对象存储上传 —— 用假的 ``create_file_from_url_or_b64`` 顶替，但它**真的**
   在数据库里创建 FileItem 行，因此持久化边界仍然是真的；
3. **没有使用 Celery broker**。执行通过与既有任务测试相同的 worker 边界
   （直接调用已注册 runner）驱动。因此这**不是** broker 级 E2E，不作此声明。
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# 必须在打桩之前导入：bootstrap 的 TASK_ADAPTER_SPECS 在模块导入期就引用了
# 真实的 VideoGenerationTask 静态构造器；若先打桩再首次导入，就会读到假类。
import app.core.tasks.bootstrap as tasks_bootstrap  # noqa: F401  # isort:skip
import app.core.tasks.video_generation_tasks as vgt
import app.utils.files as files_util
from app.core.contracts.video_generation import VideoGenerationResult
from app.core.db import Base, async_session_maker
from app.core.task_manager import SqlAlchemyTaskStore
from app.crypto_animal_studio.application import render_tasks as rt
from app.crypto_animal_studio.application.render_request import build_render_request
from app.crypto_animal_studio.application.render_views import (
    build_artifact_view,
    build_render_task_view,
    latest_render_task,
)
from app.crypto_animal_studio.production.enums import ArtifactType
from app.crypto_animal_studio.production.models import (
    CasProductionArtifact,
    CasProductionJob,
    CasProductionShot,
)
from app.models.studio import FileItem, FileType
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink
from app.services.common import create_and_refresh
from app.services.worker.task_registry import task_executor_registry

def _status_of(row) -> str:
    """GenerationTask.status 可能是枚举或字符串，统一取值。"""
    status = getattr(row, "status", "")
    return status.value if hasattr(status, "value") else str(status)


JOB_ID = "job-e2e"
SHOT_ID = "pshot-e2e"


# --------------------------------------------------------------------------- #
# 假边界
# --------------------------------------------------------------------------- #
class _FakeVideoTask:
    """假供应商任务：不发网络请求，按脚本返回结果或失败。"""

    script: dict = {"mode": "success", "provider_job_id": "prompt-e2e"}
    calls: list = []

    def __init__(self, **kwargs):
        type(self).calls.append(kwargs)
        self._result = None
        self._error = ""

    async def run(self, *_a, **_k):
        mode = type(self).script.get("mode")
        if mode == "success":
            self._result = VideoGenerationResult(
                url="http://provider.invalid/view?filename=out.mp4",
                provider_task_id=type(self).script.get("provider_job_id", "prompt-e2e"),
                provider="comfyui",
                status="succeeded",
            )
        else:
            self._error = type(self).script.get("error", "boom")
        return None

    async def get_result(self):
        return self._result

    async def status(self):
        return {"error": self._error}


async def _fake_create_file(session, *, url=None, name=None, prefix="files", **_kwargs):
    """真的写 FileItem 行，只跳过对象存储上传。"""
    item = FileItem(
        id=str(uuid.uuid4()),
        type=FileType.video,
        name=name or "video",
        thumbnail="",
        tags=["cas", "render"],
        storage_key=f"{prefix}/{name or 'video'}.mp4",
    )
    return await create_and_refresh(session, item)


# --------------------------------------------------------------------------- #
# 夹具
# --------------------------------------------------------------------------- #
async def _make_env():
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    import app.crypto_animal_studio.production.models  # noqa: F401
    import app.models.studio  # noqa: F401
    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        db.add(
            CasProductionJob(
                id=JOB_ID, project_id="proj-1", episode_id="CAS-EP001", status="running"
            )
        )
        db.add(
            CasProductionShot(
                id=SHOT_ID,
                job_id=JOB_ID,
                source_shot_id="SC01",
                sequence=1,
                status="pending",
                duration_seconds=3.0,
                video_prompt="Bruno bursts in, arms rising",
            )
        )
        await db.commit()
    return engine, factory


def _request():
    class _S:
        id = SHOT_ID
        source_shot_id = "SC01"
        sequence = 1
        duration_seconds = 3.0
        video_prompt = "Bruno bursts in, arms rising"

    return build_render_request(_S(), context={"scene": "The Burrow"}, seed=7)


async def _start_attempt(factory) -> str:
    """走真实服务创建一次渲染尝试。"""
    async with factory() as db:
        job = await db.get(CasProductionJob, JOB_ID)
        shot = await db.get(CasProductionShot, SHOT_ID)
        task_row, _attempt = await rt.create_shot_render_task(
            db,
            job=job,
            production_shot=shot,
            render_request=_request(),
            provider="comfyui",
            base_url="http://comfy.invalid:8188",
        )
        await db.commit()
        return task_row.id


def _run_env(coro_fn):
    """在一次事件循环内建环境、跑用例、释放引擎。"""

    async def _wrapper():
        engine, factory = await _make_env()
        original = async_session_maker._maker  # pylint: disable=protected-access
        async_session_maker.configure(factory)
        _FakeVideoTask.calls = []
        _FakeVideoTask.script = {"mode": "success", "provider_job_id": "prompt-e2e"}
        try:
            await coro_fn(factory)
        finally:
            async_session_maker.configure(original)
            await engine.dispose()

    asyncio.run(_wrapper())


@pytest.fixture(autouse=True)
def _fake_boundaries(monkeypatch: pytest.MonkeyPatch):
    """只伪造供应商与对象存储两个边界。"""
    monkeypatch.setattr(vgt, "VideoGenerationTask", _FakeVideoTask)
    monkeypatch.setattr(files_util, "create_file_from_url_or_b64", _fake_create_file)


# --------------------------------------------------------------------------- #
# 1–10 主干路径
# --------------------------------------------------------------------------- #
def test_success_path_creates_single_task_link_file_and_artifact() -> None:
    """一次渲染 → 1 个任务、1 条链接、1 个 FileItem、1 条产物，读视图字段齐全。"""

    async def _case(factory):
        task_id = await _start_attempt(factory)

        # 3. 创建后立即返回：此时尚未执行，任务仍非终态
        async with factory() as db:
            view = build_render_task_view(await db.get(GenerationTask, task_id))
        assert view.is_terminal is False

        await rt.run_cas_shot_render_task(task_id)

        async with factory() as db:
            tasks = (await db.execute(select(GenerationTask))).scalars().all()
            links = (await db.execute(select(GenerationTaskLink))).scalars().all()
            files = (await db.execute(select(FileItem))).scalars().all()
            artifacts = (await db.execute(select(CasProductionArtifact))).scalars().all()
            final_view = build_render_task_view(await db.get(GenerationTask, task_id))
            artifact_view = build_artifact_view(artifacts[0])

        assert len(tasks) == 1 and len(links) == 1
        assert links[0].relation_type == "cas_shot_render"
        assert links[0].relation_entity_id == SHOT_ID
        assert len(files) == 1
        assert len(artifacts) == 1
        art = artifacts[0]
        assert art.job_id == JOB_ID and art.production_shot_id == SHOT_ID
        assert art.artifact_type == ArtifactType.video.value

        assert final_view.status == "succeeded"
        assert final_view.is_terminal is True
        assert final_view.progress == 100
        assert final_view.provider_task_id == "prompt-e2e"

        assert artifact_view.file_id == files[0].id
        assert artifact_view.download_url == f"/api/v1/studio/files/{files[0].id}/download"
        assert artifact_view.provider_job_id == "prompt-e2e"
        assert artifact_view.attempt == 1
        # 无真实大小 → None，不伪造 0
        assert artifact_view.size_bytes is None
        assert artifact_view.checksum == ""

    _run_env(_case)


def test_refresh_recovers_state_purely_from_database() -> None:
    """刷新恢复：仅用数据库即可重建最新尝试与产物。"""

    async def _case(factory):
        task_id = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(task_id)

        async with factory() as db:  # 全新会话，模拟刷新
            latest = await latest_render_task(db, production_shot_id=SHOT_ID)
            view = build_render_task_view(latest)
            arts = (
                await db.execute(
                    select(CasProductionArtifact).where(
                        CasProductionArtifact.production_shot_id == SHOT_ID
                    )
                )
            ).scalars().all()
        assert view.task_id == task_id and view.status == "succeeded"
        assert len(arts) == 1

    _run_env(_case)


# --------------------------------------------------------------------------- #
# 11–16 幂等 / 重试 / 确定性
# --------------------------------------------------------------------------- #
def test_redelivery_of_same_task_reuses_artifact() -> None:
    """Celery 重投递同一任务：复用既有产物，不新建。"""

    async def _case(factory):
        task_id = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(task_id)
        provider_calls = len(_FakeVideoTask.calls)

        await rt.run_cas_shot_render_task(task_id)  # 重投递

        async with factory() as db:
            count = (
                await db.execute(select(func.count()).select_from(CasProductionArtifact))
            ).scalar()
            row = await db.get(GenerationTask, task_id)
        assert count == 1
        assert (row.result or {}).get("reused") is True
        # 幂等短路：没有再次调用供应商
        assert len(_FakeVideoTask.calls) == provider_calls

    _run_env(_case)


def test_retry_after_failure_creates_new_attempt_and_preserves_artifacts() -> None:
    """失败后重试：新任务+新链接、尝试号递增；既有成功产物不被覆盖。"""

    async def _case(factory):
        _FakeVideoTask.script = {"mode": "fail", "error": "ComfyUI execution failed: x"}
        first = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(first)

        async with factory() as db:
            assert _status_of(await db.get(GenerationTask, first)) == "failed"

        _FakeVideoTask.script = {"mode": "success", "provider_job_id": "prompt-2"}
        second = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(second)

        async with factory() as db:
            tasks = (await db.execute(select(GenerationTask))).scalars().all()
            links = (await db.execute(select(GenerationTaskLink))).scalars().all()
            arts = (await db.execute(select(CasProductionArtifact))).scalars().all()
            latest = await latest_render_task(db, production_shot_id=SHOT_ID)
        assert len(tasks) == 2 and len(links) == 2
        assert second != first
        assert len(arts) == 1
        assert arts[0].metadata_json["attempt"] == 2
        assert latest.id == second

    _run_env(_case)


def test_latest_attempt_deterministic_over_three_attempts_ignoring_unrelated_links() -> None:
    """三次尝试后 latest 稳定；无关 relation_type 的链接被忽略。"""

    async def _case(factory):
        ids = [await _start_attempt(factory) for _ in range(3)]
        async with factory() as db:  # 无关链接（另一种业务关系）
            db.add(
                GenerationTaskLink(
                    task_id=ids[0],
                    resource_type="task_link",
                    relation_type="chapter_division",
                    relation_entity_id=SHOT_ID,
                )
            )
            await db.commit()
        async with factory() as db:
            first = await latest_render_task(db, production_shot_id=SHOT_ID)
            again = await latest_render_task(db, production_shot_id=SHOT_ID)
            attempts = await rt.count_render_attempts(db, production_shot_id=SHOT_ID)
        assert first.id == again.id
        assert first.id in ids
        assert attempts == 3  # 只计 cas_shot_render

    _run_env(_case)


# --------------------------------------------------------------------------- #
# 17–21 取消与失败
# --------------------------------------------------------------------------- #
def test_cancellation_before_submission_creates_no_artifact() -> None:
    """提交前取消：不产生产物，也不调用供应商。"""

    async def _case(factory):
        task_id = await _start_attempt(factory)
        async with factory() as db:
            await SqlAlchemyTaskStore(db).request_cancel(task_id, "user")
            await db.commit()

        await rt.run_cas_shot_render_task(task_id)

        async with factory() as db:
            count = (
                await db.execute(select(func.count()).select_from(CasProductionArtifact))
            ).scalar()
        assert count == 0
        assert _FakeVideoTask.calls == []

    _run_env(_case)


@pytest.mark.parametrize(
    "error_text,expected_code",
    [
        ("workflow mapping path is not configured", "config"),
        ("ComfyUI render timed out after 1800s", "timeout"),
        ("ComfyUI execution failed: node 5", "provider"),
        ("node 9 produced no video output", "output"),
    ],
)
def test_failure_modes_reach_terminal_failed_with_safe_reason(
    error_text: str, expected_code: str
) -> None:
    """各类失败都落终态 failed，且原因安全。"""

    async def _case(factory):
        _FakeVideoTask.script = {"mode": "fail", "error": error_text}
        task_id = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(task_id)

        async with factory() as db:
            row = await db.get(GenerationTask, task_id)
            shot = await db.get(CasProductionShot, SHOT_ID)
            view = build_render_task_view(row)
            count = (
                await db.execute(select(func.count()).select_from(CasProductionArtifact))
            ).scalar()
        assert _status_of(row) == "failed"
        assert view.is_terminal is True
        assert view.error_reason.startswith(expected_code)
        assert shot.status == "failed"
        assert count == 0

    _run_env(_case)


def test_error_reason_leaks_no_secrets_or_provider_body() -> None:
    """失败原因不含凭据、内网地址、工作流体或堆栈。"""

    async def _case(factory):
        _FakeVideoTask.script = {
            "mode": "fail",
            "error": "ComfyUI execution failed: {'api_key':'sk-live-99',"
            "'base_url':'http://10.1.2.3:8188','workflow':{'6':{'class_type':'CLIPTextEncode'}}}",
        }
        task_id = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(task_id)
        async with factory() as db:
            view = build_render_task_view(await db.get(GenerationTask, task_id))
        reason = view.error_reason or ""
        for banned in ("sk-live-99", "10.1.2.3", "api_key", "class_type", "Traceback", "{"):
            assert banned not in reason

    _run_env(_case)


# --------------------------------------------------------------------------- #
# 22–25 既有行为不受影响
# --------------------------------------------------------------------------- #
def test_no_unique_constraint_exists_on_artifacts() -> None:
    """如实记录并发限制：产物表只有普通索引，没有唯一约束。

    因此「常规重投递幂等」有测试保证，但**并发**双写在极端情况下仍可能各插一条。
    这是已知限制，不声称严格 exactly-once。
    """
    constraints = {
        type(c).__name__ for c in CasProductionArtifact.__table__.constraints
    }
    unique_cols = [
        tuple(col.name for col in c.columns)
        for c in CasProductionArtifact.__table__.constraints
        if type(c).__name__ == "UniqueConstraint"
    ]
    assert "UniqueConstraint" not in constraints or unique_cols == []


def test_openai_and_volcengine_resolution_unaffected() -> None:
    """既有供应商解析不受影响。"""
    from app.core.tasks.registry import list_registered_task_adapters

    tasks_bootstrap.bootstrap_task_adapters()
    registered = list_registered_task_adapters("video_generation")
    assert ("video_generation", "openai") in registered
    assert ("video_generation", "volcengine") in registered
    assert ("video_generation", "comfyui") in registered


def test_worker_boundary_is_the_registered_executor() -> None:
    """执行入口确实是注册在既有 registry 上的 runner（非测试专用捷径）。"""
    executor = task_executor_registry.resolve("cas_render_shot")
    assert executor.task_kind == "cas_render_shot"
    assert executor._runner is rt.run_cas_shot_render_task  # pylint: disable=protected-access


def test_mock_artifact_does_not_short_circuit_a_real_render() -> None:
    """回归：Step 6 的 mock 视频产物不得让真实渲染秒回 succeeded。

    这正是「API 返回 pending、Celery 收到任务、36ms 就 succeeded、ComfyUI 没收到
    workflow」的根因：mock 流水线为每个镜头产出 ArtifactType.video，旧的幂等判定
    只看 (job, shot, type)，于是把 mock 占位当成「已渲染」。
    """

    async def _case(factory):
        # 预置一条 mock 产物，模拟先用 mode=mock 建过任务
        async with factory() as db:
            db.add(
                CasProductionArtifact(
                    id="mock-art",
                    job_id=JOB_ID,
                    production_shot_id=SHOT_ID,
                    artifact_type="video",
                    stage="video_generation",
                    provider=rt.MOCK_VIDEO_PROVIDER,
                    provider_model="",
                    file_path="mock/shot.txt",
                    mime_type="video/mp4",
                    checksum="",
                    metadata_json={},
                )
            )
            await db.commit()

        task_id = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(task_id)

        # 供应商必须真的被调用（不是短路）
        assert len(_FakeVideoTask.calls) == 1, "real render must call the provider"

        async with factory() as db:
            arts = (await db.execute(select(CasProductionArtifact))).scalars().all()
            row = await db.get(GenerationTask, task_id)
        # mock 产物保留，另外新增一条真实渲染产物
        providers = sorted(a.provider for a in arts)
        assert providers == ["comfyui", rt.MOCK_VIDEO_PROVIDER]
        assert _status_of(row) == "succeeded"
        assert (row.result or {}).get("reused") is False

    _run_env(_case)


def test_missing_run_args_fails_instead_of_silent_success() -> None:
    """run_args 缺必要字段 → 明确 failed，绝不静默成功。"""

    async def _case(factory):
        task_id = await _start_attempt(factory)
        await rt.run_cas_shot_render_task(task_id, {"job_id": JOB_ID})  # 缺 input 等

        async with factory() as db:
            row = await db.get(GenerationTask, task_id)
        assert _status_of(row) == "failed"
        assert _FakeVideoTask.calls == [], "provider must not be called with invalid args"

    _run_env(_case)
