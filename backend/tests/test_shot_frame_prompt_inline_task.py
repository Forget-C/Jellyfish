"""「AI 首帧」提示词任务改为**同进程内联执行**（真实故障：队列任务永远 pending）。

用户实点反馈：页面上的「AI 首帧」按钮会 ``POST /api/v1/film/tasks/shot-frame-prompts``
建一条 Celery 任务；本机没有 broker/worker，任务永远停在「排队中」（验收时确实留下过
一条卡死的 pending 任务）。

这个文件锁住四件事：

1. 任务**真的被执行**（不再依赖不存在的 worker）；
2. 任务记录 / 状态查询 / 结果查询 / 取消这些既有接口**全部照旧可用**；
3. 任务体自己没处理掉的异常会被兜底落成 ``failed``（不留假的「执行中」）；
4. 取消仍然有效（``executor_type=inline`` → 协作式取消，不去 revoke 不存在的 celery 任务）。

全部不联网：任务体在构造默认文本大模型时会过 ``paid_outlet_guard``（llm 出口），
测试默认把 DRY_RUN 打开 → 守卫直接拦下，一个字节都不出站。
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.api.v1.routes.film import tasks_images as route
from app.core.db import async_session_maker
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.task_manager.types import TaskStatus
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV
from app.tasks.execute_task import (
    INLINE_EXECUTOR_TYPE,
    running_inline_task_ids,
    spawn_inline_task_execution,
)

PROMPT_URL = "/api/v1/film/tasks/shot-frame-prompts"


class _CreateOnlyTask:
    """与路由里用的一样的占位任务对象（真正的任务体由 runner 提供）。"""

    def run(self) -> None:  # pragma: no cover - 只用于建任务记录
        return None


@pytest.fixture(autouse=True)
def _dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认演练模式：任务体构造大模型时会被 llm 出口守卫拦下（一个字节都不出站）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)


async def _create_task_row(*, run_args: dict, task_kind: str = "shot_frame_prompt") -> str:
    async with async_session_maker() as db:
        store = SqlAlchemyTaskStore(db)
        tm = TaskManager(store=store, strategies={})
        record = await tm.create(
            task=_CreateOnlyTask(),
            mode=DeliveryMode.async_polling,
            task_kind=task_kind,
            run_args=run_args,
        )
        await db.commit()
        return record.id


async def _read_row(task_id: str):  # type: ignore[no-untyped-def]
    async with async_session_maker() as db:
        store = SqlAlchemyTaskStore(db)
        return await store.get(task_id)


async def _wait_for_row(task_id: str, status: TaskStatus, *, timeout: float = 10.0):  # type: ignore[no-untyped-def]
    """等到任务落到目标状态（或超时返回最后一次读到的行）。"""
    waited = 0.0
    row = None
    while waited < timeout:
        row = await _read_row(task_id)
        if row is not None and row.status == status:
            return row
        await asyncio.sleep(0.05)
        waited += 0.05
    return row


# ---------------------------------------------------------------------------
# 1) spawn_inline_task_execution 本身
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_spawn_inline_runs_runner_in_this_process() -> None:
    """任务体真的在本进程事件循环里跑完，并回写状态 / 进度 / 结果。"""
    task_id = await _create_task_row(run_args={"shot_id": "shot-x", "frame_type": "first"})
    seen: list[tuple[str, dict]] = []

    async def _runner(tid: str, run_args: dict) -> None:
        seen.append((tid, dict(run_args)))
        async with async_session_maker() as db:
            store = SqlAlchemyTaskStore(db)
            await store.set_status(tid, TaskStatus.running)
            await store.set_progress(tid, 100)
            await store.set_result(tid, {"prompt": "首帧提示词"})
            await store.set_status(tid, TaskStatus.succeeded)
            await db.commit()

    assert spawn_inline_task_execution(task_id, runner=_runner, run_args={"shot_id": "shot-x"}) is True
    row = await _wait_for_row(task_id, TaskStatus.succeeded)

    assert seen == [(task_id, {"shot_id": "shot-x"})]
    assert row is not None
    assert row.status == TaskStatus.succeeded
    assert row.progress == 100
    assert row.result == {"prompt": "首帧提示词"}
    assert row.executor_type == INLINE_EXECUTOR_TYPE
    assert row.executor_task_id is None  # 内联没有 celery task id
    assert task_id not in running_inline_task_ids()


@pytest.mark.asyncio
async def test_spawn_inline_marks_failed_when_runner_raises() -> None:
    """任务体自己没处理掉的异常必须落成 failed —— 绝不留下假的「执行中」。"""
    task_id = await _create_task_row(run_args={})

    async def _runner(_tid: str, _run_args: dict) -> None:
        raise RuntimeError("explode")

    assert spawn_inline_task_execution(task_id, runner=_runner, run_args={}) is True
    row = await _wait_for_row(task_id, TaskStatus.failed)

    assert row is not None
    assert row.status == TaskStatus.failed
    assert "explode" in row.error


@pytest.mark.asyncio
async def test_spawn_inline_ignores_duplicate_scheduling() -> None:
    task_id = await _create_task_row(run_args={})
    calls: list[str] = []
    started = asyncio.Event()

    async def _runner(tid: str, _run_args: dict) -> None:
        calls.append(tid)
        started.set()
        await asyncio.sleep(0.2)

    assert spawn_inline_task_execution(task_id, runner=_runner, run_args={}) is True
    assert spawn_inline_task_execution(task_id, runner=_runner, run_args={}) is True  # 重复调度被忽略
    await asyncio.wait_for(started.wait(), timeout=5)
    await asyncio.sleep(0.3)

    assert calls == [task_id]


def test_spawn_inline_returns_false_without_running_loop() -> None:
    """没有运行中的事件循环（同步脚本调用）→ 返回 False，由调用方退回队列入口。"""

    async def _runner(_task_id: str, _run_args: dict) -> None:  # pragma: no cover - 不会真的执行
        return None

    assert spawn_inline_task_execution("task-x", runner=_runner, run_args={}) is False


# ---------------------------------------------------------------------------
# 2) 端点：不再建"死任务"，任务记录 / 状态 / 结果 / 取消照旧可用
# ---------------------------------------------------------------------------
#
# 这里用 ``httpx.ASGITransport`` 在**测试自己的事件循环**里发请求：
# ``TestClient`` 的 portal 是「一次请求一个循环」，请求结束就关掉，
# 后台 asyncio 任务会被连带取消（uvicorn 是单进程单循环，不存在这个问题）。
# 用 ASGITransport 才能真实反映生产上的执行模型 —— 且不会触发 app 的 lifespan
# （lifespan 里的 ``init_storage()`` 会真的连对象存储，测试里绝不能跑）。


async def _fake_run_args(_db, *, shot_id: str, frame_type: str):  # type: ignore[no-untyped-def]
    """只组装 run_args，不碰真正的镜头表（本文件只关心执行模型）。"""
    return {"shot_id": shot_id, "frame_type": frame_type, "input": {}}


async def _noop(*_args, **_kwargs) -> None:
    return None


def _prepare_route(monkeypatch: pytest.MonkeyPatch) -> None:
    """把与「执行模型」无关的两步替换掉：真镜头表写入 + 真 run_args 组装。"""
    monkeypatch.setattr(route, "build_shot_frame_prompt_run_args", _fake_run_args)
    monkeypatch.setattr(route, "mark_shot_generating", _noop)


def _api_client():  # type: ignore[no-untyped-def]
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


async def _poll_status(client, task_id: str, *, attempts: int = 100) -> dict:  # type: ignore[no-untyped-def]
    """轮询状态接口直到终态（同一条事件循环里 sleep，后台任务才有机会推进）。"""
    payload: dict = {}
    for _ in range(attempts):
        response = await client.get(f"/api/v1/film/tasks/{task_id}/status")
        assert response.status_code == 200
        payload = response.json()["data"]
        if payload["status"] in {"succeeded", "failed", "cancelled"}:
            return payload
        await asyncio.sleep(0.05)
    return payload


@pytest.mark.asyncio
async def test_endpoint_dispatches_inline_and_never_enqueues_celery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """核心回归：端点不再往 Celery 丢任务，而是在本进程执行；状态/结果接口照常可读。"""
    _prepare_route(monkeypatch)
    calls: list[tuple[str, dict]] = []

    async def _stub_runner(task_id: str, run_args: dict) -> None:
        calls.append((task_id, dict(run_args)))
        async with async_session_maker() as db:
            store = SqlAlchemyTaskStore(db)
            await store.set_status(task_id, TaskStatus.running)
            await store.set_result(task_id, {"prompt": "首帧提示词由本进程生成"})
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            await db.commit()

    monkeypatch.setattr(route, "run_shot_frame_prompt_task", _stub_runner)

    def _no_celery(_task_id: str):  # pragma: no cover - 触发即失败
        raise AssertionError("这个端点不允许再往 Celery 队列里丢任务")

    monkeypatch.setattr(route, "enqueue_task_execution", _no_celery)

    async with _api_client() as client:
        response = await client.post(PROMPT_URL, json={"shot_id": "shot-1", "frame_type": "first"})
        assert response.status_code == 201
        task_id = response.json()["data"]["task_id"]
        assert task_id

        status = await _poll_status(client, task_id)
        assert status["status"] == "succeeded"  # 不再是永远 pending

        result = await client.get(f"/api/v1/film/tasks/{task_id}/result")
        assert result.status_code == 200
        data = result.json()["data"]
        assert data["status"] == "succeeded"
        assert data["result"] == {"prompt": "首帧提示词由本进程生成"}

        # 任务中心：这条任务存在，执行器标注为 inline（不是 celery）
        listed = await client.get("/api/v1/film/tasks", params={"task_kind": "shot_frame_prompt"})
        assert listed.status_code == 200
        items = listed.json()["data"]["items"]
        row = next(item for item in items if item["task_id"] == task_id)
        assert row["executor_type"] == "inline"
        assert row["relation_type"] == "shot_first_frame_prompt"
        assert row["relation_entity_id"] == "shot-1"

    assert calls and calls[0][0] == task_id
    assert calls[0][1]["shot_id"] == "shot-1"


@pytest.mark.asyncio
async def test_endpoint_runs_real_task_body_in_process(monkeypatch: pytest.MonkeyPatch) -> None:
    """不替换任务体：真的跑 ``run_shot_frame_prompt_task``。

    DRY_RUN 下任务体在构造默认文本大模型时会被守卫拦下 → 任务被如实标成 failed，
    **不会**留在「排队中」（也不会有任何真实大模型调用）。
    """
    _prepare_route(monkeypatch)

    async with _api_client() as client:
        response = await client.post(PROMPT_URL, json={"shot_id": "shot-1", "frame_type": "first"})
        assert response.status_code == 201
        task_id = response.json()["data"]["task_id"]

        status = await _poll_status(client, task_id)
        assert status["status"] in {"failed", "succeeded"}
        assert status["status"] != "pending"

        result = (await client.get(f"/api/v1/film/tasks/{task_id}/result")).json()["data"]
        assert result["error"], "失败必须带出原因，不能是空白消息"


@pytest.mark.asyncio
async def test_endpoint_cancel_interface_still_works(monkeypatch: pytest.MonkeyPatch) -> None:
    """取消接口照旧可用（内联执行走协作式取消，不去 revoke 不存在的 celery 任务）。"""
    _prepare_route(monkeypatch)

    async def _slow_runner(_task_id: str, _run_args: dict) -> None:
        await asyncio.sleep(5)

    monkeypatch.setattr(route, "run_shot_frame_prompt_task", _slow_runner)

    async with _api_client() as client:
        response = await client.post(PROMPT_URL, json={"shot_id": "shot-1", "frame_type": "first"})
        task_id = response.json()["data"]["task_id"]

        cancelled = await client.post(
            f"/api/v1/film/tasks/{task_id}/cancel", json={"reason": "用户点错了"}
        )
        assert cancelled.status_code == 200
        data = cancelled.json()["data"]
        assert data["task_id"] == task_id
        assert data["cancel_requested"] is True
        # 内联执行不能在任意一行代码上强杀：语义与既有 worker 路径一致 ——
        # 「取消请求已登记」，由任务体在阶段边界（cancel_if_requested_async）退出。


def test_endpoint_rejects_invalid_frame_type(client: TestClient) -> None:
    response = client.post(PROMPT_URL, json={"shot_id": "shot-1", "frame_type": "middle"})
    assert response.status_code == 400
