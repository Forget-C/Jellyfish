"""统一任务执行入口。

职责：
- Celery 统一只接收业务 task_id（``enqueue_task_execution``）；
- 通过 GenerationTask.task_kind + registry 找到具体 WorkerTaskExecutor；
- 回写 executor_type / executor_task_id，便于排障；
- **同进程内联执行**（``spawn_inline_task_execution``）：本机没有 broker / worker 时，
  队列路径只会留下一条永远 pending 的任务（真实踩过：「AI 首帧」点完一直排队中）。
  需要「点了就真的执行」的端点用这个入口，任务记录 / 状态 / 结果 / 取消接口全部照旧。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from celery.result import AsyncResult

from app.core.celery_app import celery_app
from app.core.db import async_session_maker
from app.core.db_sync import sync_session_maker
from app.core.task_manager import SqlAlchemyTaskStore, SyncSqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.models.task import GenerationTask
from app.services import paid_outlet_guard
from app.services.worker.task_registry import task_executor_registry

logger = logging.getLogger(__name__)

#: 内联执行器在 GenerationTask.executor_type 上的取值（队列路径是 "celery"）。
INLINE_EXECUTOR_TYPE = "inline"

#: 正在本进程执行的任务：**必须持强引用**，否则 asyncio 可能在任务跑完前回收它。
_INLINE_TASKS: dict[str, asyncio.Task[None]] = {}


def _record_executor_dispatch(task_id: str, *, executor_type: str, executor_task_id: str | None) -> None:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return
        row.executor_type = executor_type
        row.executor_task_id = executor_task_id
        db.commit()


def enqueue_task_execution(task_id: str) -> AsyncResult:
    async_result = run_task_celery.delay(task_id)
    _record_executor_dispatch(
        task_id,
        executor_type="celery",
        executor_task_id=async_result.id,
    )
    return async_result


# ---------------------------------------------------------------------------
# 同进程内联执行（不依赖 broker / worker）
# ---------------------------------------------------------------------------


async def _set_executor_async(task_id: str, *, executor_type: str) -> None:
    """记录执行器类型（独立 session：不与请求 session 的事务纠缠）。"""
    async with async_session_maker() as db:
        row = await db.get(GenerationTask, task_id)
        if row is None:
            return
        row.executor_type = executor_type
        row.executor_task_id = None
        await db.commit()


async def _mark_failed_async(task_id: str, error: str) -> None:
    """兜底：任务体自己没处理掉的异常，也必须把任务落成 failed（不留下假的"执行中"）。"""
    async with async_session_maker() as db:
        store = SqlAlchemyTaskStore(db)
        await store.set_error(task_id, error)
        await store.set_status(task_id, TaskStatus.failed)
        await db.commit()


async def _run_inline(
    task_id: str,
    *,
    runner: Callable[[str, dict[str, Any]], Awaitable[None]],
    run_args: dict[str, Any],
    detail: str,
) -> None:
    try:
        await _set_executor_async(task_id, executor_type=INLINE_EXECUTOR_TYPE)
        await runner(task_id, run_args)
    except Exception as exc:  # noqa: BLE001 - 后台任务不能把异常抛给调用方
        # 注意：``asyncio.CancelledError`` 继承自 BaseException，这里抓不到它 —— 取消会正常向上传播。
        logger.exception("内联任务执行失败：task_id=%s %s", task_id, detail)
        try:
            await _mark_failed_async(task_id, f"内联执行异常：{exc}")
        except Exception:  # noqa: BLE001 - 连兜底都失败时只记日志，绝不向上抛
            logger.exception("内联任务兜底落库失败：task_id=%s", task_id)


def spawn_inline_task_execution(
    task_id: str,
    *,
    runner: Callable[[str, dict[str, Any]], Awaitable[None]],
    run_args: dict[str, Any] | None = None,
    detail: str = "",
) -> bool:
    """把任务体挂到**当前进程的事件循环**上执行（不使用 Celery）。

    与队列路径的关系（同一套任务记录，不是另起一套）：

    - 任务行仍由调用方用 ``TaskManager`` / ``SqlAlchemyTaskStore`` 建好并提交；
    - 状态 / 进度 / 结果 / 错误仍由任务体写回 ``GenerationTask``，
      所以 ``/tasks/{id}/status``、``/tasks/{id}/result``、``/tasks/{id}/list`` 全部照旧可用；
    - 取消：``executor_type`` 记为 ``inline``，``revoke_task_execution`` 不会去 revoke 一个
      不存在的 celery 任务；任务体在阶段边界用 ``cancel_if_requested_async`` 协作式退出，
      所以「取消」接口依旧有效（只是不能在任意一行代码上强杀）。

    返回 ``False`` 表示当前线程**没有运行中的事件循环**（例如脚本里同步调用），
    由调用方决定是否退回 ``enqueue_task_execution``。
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False

    existing = _INLINE_TASKS.get(task_id)
    if existing is not None and not existing.done():
        logger.warning("任务已在本进程执行中，忽略重复调度：task_id=%s", task_id)
        return True

    task = loop.create_task(
        _run_inline(task_id, runner=runner, run_args=dict(run_args or {}), detail=detail),
        name=f"inline-task:{task_id}",
    )
    _INLINE_TASKS[task_id] = task
    task.add_done_callback(lambda _done, key=task_id: _INLINE_TASKS.pop(key, None))
    return True


def running_inline_task_ids() -> list[str]:
    """当前本进程正在执行的任务 ID（排查「任务为什么动了」时用）。"""
    return [task_id for task_id, task in _INLINE_TASKS.items() if not task.done()]


def revoke_task_execution(task_id: str, *, terminate: bool = True, signal: str = "SIGTERM") -> bool:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return False
        if (row.executor_type or "").strip() != "celery":
            return False
        executor_task_id = (row.executor_task_id or "").strip()
        if not executor_task_id:
            return False

    try:
        AsyncResult(executor_task_id, app=celery_app).revoke(terminate=terminate, signal=signal)
    except Exception:  # noqa: BLE001
        logger.exception("failed to revoke celery task: task_id=%s executor_task_id=%s", task_id, executor_task_id)
        return False
    return True


@celery_app.task(name="task.execute")
def run_task_celery(task_id: str) -> None:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return
        task_kind = (row.task_kind or "").strip() or str((row.payload or {}).get("task_kind") or "").strip()
        # 出图 / 出视频出口兜底：即使有人绕过接口层先建了任务，也不允许它真花钱。
        blocked_reason = paid_outlet_guard.task_kind_block_reason(
            task_kind,
            f"执行任务 task_kind={task_kind} task_id={task_id}",
        )
        if blocked_reason:
            store = SyncSqlAlchemyTaskStore(db)
            store.set_error(task_id, blocked_reason)
            store.set_status(task_id, TaskStatus.failed)
            db.commit()
            logger.warning("任务被 DRY_RUN 守卫拦截：task_id=%s %s", task_id, blocked_reason)
            return
    executor = task_executor_registry.resolve(task_kind)
    executor.run(task_id)
