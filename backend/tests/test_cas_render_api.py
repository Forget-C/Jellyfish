"""Step 7：渲染启动路由的 HTTP 层测试（走真实 FastAPI 路由与测试客户端）。

只伪造 Celery 入队与供应商边界；路由、服务、模型、任务中心均为真实实现。
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.tasks.execute_task as execute_task
from app.core.db import Base
from app.crypto_animal_studio.api import router as cas_router
from app.crypto_animal_studio.production.models import CasProductionJob, CasProductionShot
from app.dependencies import get_db
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink

JOB_ID = "job-api"
SHOT_ID = "pshot-api"
OTHER_JOB = "job-other"
BASE = "/api/v1/crypto-animal-studio/production"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, async_sessionmaker]]:
    """挂载真实 CAS 路由的最小 app；入队被替换为记录器。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    import app.crypto_animal_studio.production.models  # noqa: F401
    import app.models.studio  # noqa: F401
    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    @asynccontextmanager
    async def _lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_factory() as db:
            db.add(
                CasProductionJob(
                    id=JOB_ID, project_id="proj-1", episode_id="CAS-EP001", status="running"
                )
            )
            db.add(
                CasProductionJob(
                    id=OTHER_JOB, project_id="proj-1", episode_id="CAS-EP002", status="running"
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
            db.add(
                CasProductionShot(
                    id="pshot-other",
                    job_id=OTHER_JOB,
                    source_shot_id="SC01",
                    sequence=1,
                    status="pending",
                    duration_seconds=3.0,
                    video_prompt="other episode shot",
                )
            )
            await db.commit()
        yield
        await engine.dispose()

    enqueued: list[str] = []
    monkeypatch.setattr(execute_task, "enqueue_task_execution", lambda task_id: enqueued.append(task_id))

    app = FastAPI(lifespan=_lifespan)
    app.include_router(cas_router, prefix="/api/v1/crypto-animal-studio")
    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as test_client:
        test_client.enqueued = enqueued  # type: ignore[attr-defined]
        yield test_client, session_factory


def _render(client: TestClient, job=JOB_ID, shot=SHOT_ID):
    return client.post(f"{BASE}/jobs/{job}/shots/{shot}/render")


# --------------------------------------------------------------------------- #
def test_render_route_creates_task_and_returns_view(client) -> None:
    """1+2：请求创建并入队一次尝试，返回 RenderTaskView，且不内联执行供应商。"""
    test_client, _factory = client
    resp = _render(test_client)
    assert resp.status_code == 200
    body = resp.json()
    assert {"code", "message", "data"}.issubset(body.keys())  # ApiResponse 壳
    data = body["data"]
    assert data["task_id"]
    assert data["is_terminal"] is False
    assert data["status"] in {"pending", "running"}
    # 入队而非内联执行：任务尚未成功，且入队被调用一次
    assert test_client.enqueued == [data["task_id"]]
    assert data["provider_task_id"] is None


def test_task_link_uses_cas_shot_render_relation(client) -> None:
    """9：链接使用正确的 relation_type 与 production_shot_id。"""
    test_client, factory = client
    _render(test_client)

    import asyncio

    async def _check():
        async with factory() as db:
            link = (await db.execute(select(GenerationTaskLink))).scalars().one()
            task = (await db.execute(select(GenerationTask))).scalars().one()
            return link, task

    link, task = asyncio.run(_check())
    assert link.relation_type == "cas_shot_render"
    assert link.relation_entity_id == SHOT_ID
    assert task.task_kind == "cas_render_shot"


def test_missing_job_returns_404(client) -> None:
    """4：任务不存在 → 404。"""
    test_client, _ = client
    assert _render(test_client, job="nope").status_code == 404


def test_missing_shot_returns_404(client) -> None:
    """5：镜头不存在 → 404。"""
    test_client, _ = client
    assert _render(test_client, shot="nope").status_code == 404


def test_shot_from_another_job_is_rejected(client) -> None:
    """6：镜头属于另一个任务 → 拒绝（404），不得跨任务渲染。"""
    test_client, _ = client
    resp = _render(test_client, job=JOB_ID, shot="pshot-other")
    assert resp.status_code == 404


def test_active_attempt_is_returned_idempotently(client) -> None:
    """7：已有进行中的尝试 → 返回既有尝试且不重复入队。"""
    test_client, _ = client
    first = _render(test_client).json()["data"]
    second = _render(test_client).json()["data"]
    assert second["task_id"] == first["task_id"]
    # 只入队了一次
    assert test_client.enqueued == [first["task_id"]]


def test_error_responses_contain_no_secrets(client) -> None:
    """10：错误响应不含凭据、内网地址、工作流体或堆栈。"""
    test_client, _ = client
    body = json.dumps(_render(test_client, job="nope").json(), ensure_ascii=False).lower()
    for banned in ("api_key", "sk-", "traceback", "class_type", "workflow", "8188"):
        assert banned not in body


def test_job_listing_lets_workspace_discover_the_job(client) -> None:
    """工作台据此定位剧集的生产任务（否则前端拿不到 job_id）。"""
    test_client, _ = client
    resp = test_client.get(f"{BASE}/jobs", params={"project_id": "proj-1", "episode_id": "CAS-EP001"})
    assert resp.status_code == 200
    jobs = resp.json()["data"]
    assert [j["id"] for j in jobs] == [JOB_ID]
    assert jobs[0]["shots"][0]["id"] == SHOT_ID


def test_job_view_exposes_render_task_after_start(client) -> None:
    """3+刷新恢复：GET job 能读回 render_task 投影。"""
    test_client, _ = client
    started = _render(test_client).json()["data"]
    view = test_client.get(f"{BASE}/jobs/{JOB_ID}").json()["data"]
    assert view["render_task"]["task_id"] == started["task_id"]
    assert view["render_task"]["is_terminal"] is False


def test_artifacts_endpoint_returns_empty_list_before_success(client) -> None:
    """产物端点在成功前返回空列表，而不是报错。"""
    test_client, _ = client
    _render(test_client)
    resp = test_client.get(f"{BASE}/jobs/{JOB_ID}/artifacts")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


def test_multiple_jobs_are_returned_in_deterministic_total_order(client) -> None:
    """同项目同剧集有多个任务时，顺序是稳定全序（created_at DESC, id DESC）。"""
    test_client, factory = client
    import asyncio

    async def _seed_more():
        async with factory() as db:
            for suffix in ("aaa", "zzz", "mmm"):
                db.add(
                    CasProductionJob(
                        id=f"job-{suffix}",
                        project_id="proj-1",
                        episode_id="CAS-EP001",
                        status="running",
                    )
                )
            await db.commit()

    asyncio.run(_seed_more())

    params = {"project_id": "proj-1", "episode_id": "CAS-EP001"}
    first = [j["id"] for j in test_client.get(f"{BASE}/jobs", params=params).json()["data"]]
    second = [j["id"] for j in test_client.get(f"{BASE}/jobs", params=params).json()["data"]]

    assert first == second, "ordering must be reproducible across identical requests"
    # 同一剧集的任务全部返回；另一剧集的任务不得混入
    assert set(first) == {JOB_ID, "job-aaa", "job-zzz", "job-mmm"}
    assert OTHER_JOB not in first
    # created_at 并列时以 id 降序作次级键 → 全序可预测
    assert first[0] == max(first)


def test_episode_filter_excludes_unrelated_jobs(client) -> None:
    """按 episode_id 过滤后，其它剧集的任务不可能被选中。"""
    test_client, _ = client
    other = test_client.get(
        f"{BASE}/jobs", params={"project_id": "proj-1", "episode_id": "CAS-EP002"}
    ).json()["data"]
    assert [j["id"] for j in other] == [OTHER_JOB]


def test_artifacts_are_scoped_to_the_requested_job(client) -> None:
    """产物端点按 job 隔离：另一任务的产物不会出现在本任务下。"""
    test_client, factory = client
    import asyncio

    from app.crypto_animal_studio.production.models import CasProductionArtifact

    async def _seed_artifacts():
        async with factory() as db:
            db.add(
                CasProductionArtifact(
                    id="art-other",
                    job_id=OTHER_JOB,
                    production_shot_id="pshot-other",
                    artifact_type="video",
                    stage="video_generation",
                    provider="comfyui",
                    provider_model="",
                    file_path="x.mp4",
                    mime_type="video/mp4",
                    checksum="",
                    metadata_json={},
                )
            )
            await db.commit()

    asyncio.run(_seed_artifacts())

    mine = test_client.get(f"{BASE}/jobs/{JOB_ID}/artifacts").json()["data"]
    assert mine == []
    theirs = test_client.get(f"{BASE}/jobs/{OTHER_JOB}/artifacts").json()["data"]
    assert [a["id"] for a in theirs] == ["art-other"]


def test_chapter_id_resolves_episode_via_import_ledger(client) -> None:
    """章节→剧集由 cas_import_ledger 在服务端解析（ChapterRead 不含 episode_id）。"""
    test_client, factory = client
    import asyncio

    from app.crypto_animal_studio.domain.import_ledger import CasImportLedger

    async def _seed_ledger():
        async with factory() as db:
            db.add(
                CasImportLedger(
                    id="led-1",
                    project_id="proj-1",
                    episode_id="CAS-EP001",
                    idempotency_key="k1",
                    payload_hash="h",
                    chapter_id="ch-1",
                    status="imported",
                    schema_version="1.1",
                )
            )
            await db.commit()

    asyncio.run(_seed_ledger())

    resp = test_client.get(
        f"{BASE}/jobs", params={"project_id": "proj-1", "chapter_id": "ch-1"}
    )
    assert resp.status_code == 200
    assert [j["id"] for j in resp.json()["data"]] == [JOB_ID]


def test_unknown_chapter_returns_empty_not_all_jobs(client) -> None:
    """章节没有导入记录时返回空列表，绝不退化成「返回该项目全部任务」。"""
    test_client, _ = client
    resp = test_client.get(
        f"{BASE}/jobs", params={"project_id": "proj-1", "chapter_id": "ch-unknown"}
    )
    assert resp.status_code == 200
    assert resp.json()["data"] == []


def test_render_route_accepts_preview_profile(client) -> None:
    """profile=preview → 快照记录 432×768（精确 9:16）。"""
    test_client, factory = client
    import asyncio

    resp = test_client.post(f"{BASE}/jobs/{JOB_ID}/shots/{SHOT_ID}/render", params={"profile": "preview"})
    assert resp.status_code == 200

    async def _snap():
        async with factory() as db:
            task = (await db.execute(select(GenerationTask))).scalars().one()
            return ((task.payload or {}).get("run_args") or {})

    run_args = asyncio.run(_snap())
    assert run_args["input"]["width"] == 432
    assert run_args["input"]["height"] == 768
    assert run_args["request_snapshot"]["width"] == 432


def test_render_route_defaults_to_final_for_api_compatibility(client) -> None:
    """不传 profile → final：分辨率交给 ratio 推导，既有 API 兼容性不变。"""
    test_client, factory = client
    import asyncio

    assert _render(test_client).status_code == 200

    async def _snap():
        async with factory() as db:
            task = (await db.execute(select(GenerationTask))).scalars().one()
            return ((task.payload or {}).get("run_args") or {})

    run_args = asyncio.run(_snap())
    assert run_args["input"]["width"] is None
    assert run_args["input"]["height"] is None


def test_render_route_rejects_unknown_profile(client) -> None:
    """未知 profile 值 → 422，不静默退回某个档位。"""
    test_client, _ = client
    resp = test_client.post(f"{BASE}/jobs/{JOB_ID}/shots/{SHOT_ID}/render", params={"profile": "ultra"})
    assert resp.status_code == 422
