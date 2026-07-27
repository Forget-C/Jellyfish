"""Worker 执行模板。

职责边界：
- 统一 Celery worker 内部的任务生命周期；
- 不负责 API 入参、任务创建、任务关联；
- 只负责：读取任务 → 执行 → 写 result / status / error → apply。
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Awaitable

from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from sqlalchemy.orm import Session, sessionmaker

from app.core.db import close_db, reset_db_runtime
from app.core.db_sync import sync_session_maker
from app.core.task_manager import SyncSqlAlchemyTaskStore
from app.core.task_manager.types import TaskRecord, TaskStatus
from app.models.task import GenerationTask
from app.services.llm.runtime import build_default_text_llm_sync
from app.services.worker.task_logging import log_task_event


logger = logging.getLogger(__name__)


@dataclass(slots=True)
class WorkerTaskContext:
    task_id: str
    db: Session
    store: SyncSqlAlchemyTaskStore
    task: TaskRecord


class AbstractLLMResultGenerator(ABC):
    thinking: bool = True

    def build_llm(self, db: Session) -> BaseChatModel:
        return build_default_text_llm_sync(db, thinking=self.thinking)

    def generate(self, db: Session, run_args: dict[str, Any]) -> Any:
        llm = self.build_llm(db)
        return self.generate_with_llm(llm, run_args)

    @abstractmethod
    def generate_with_llm(self, llm: BaseChatModel, run_args: dict[str, Any]) -> Any:
        raise NotImplementedError


class AbstractWorkerTaskExecutor(ABC):
    task_kind: str = "generic"
    running_progress: int = 5
    result_progress: int = 70
    succeeded_progress: int = 100
    timeout_seconds: float | None = None

    def __init__(self, *, session_maker: sessionmaker[Session] = sync_session_maker) -> None:
        self._session_maker = session_maker

    def run(self, task_id: str) -> None:
        started_at = time.monotonic()
        self._log_event("started", task_id)
        try:
            run_args = self._mark_running_and_load_run_args(task_id)
            if run_args is None:
                self._log_event("cancelled", task_id, elapsed_ms=self._elapsed_ms(started_at))
                return
            self._ensure_not_timed_out(task_id, started_at)
            result = self._execute_phase(task_id, run_args)
            if result is None:
                self._log_event("cancelled", task_id, elapsed_ms=self._elapsed_ms(started_at))
                return
            self._ensure_not_timed_out(task_id, started_at)
            self._apply_and_finish(task_id, run_args, result)
            self._ensure_not_timed_out(task_id, started_at)
            self._log_event("succeeded", task_id, elapsed_ms=self._elapsed_ms(started_at))
        except HTTPException as exc:
            error = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            self._mark_failed(task_id, error)
            self._log_event("failed", task_id, elapsed_ms=self._elapsed_ms(started_at), error=error)
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s task failed: %s", self.task_kind, task_id)
            self._mark_failed(task_id, str(exc))
            self._log_event("failed", task_id, elapsed_ms=self._elapsed_ms(started_at), error=str(exc))

    def _mark_running_and_load_run_args(self, task_id: str) -> dict[str, Any] | None:
        with self._session_maker() as db:
            ctx = self._load_context(db, task_id)
            if ctx is None:
                logger.warning("%s task not found: %s", self.task_kind, task_id)
                return None
            if self._cancel_if_requested(ctx):
                return None
            ctx.store.set_status(task_id, TaskStatus.running)
            ctx.store.set_progress(task_id, self.running_progress)
            db.commit()
            return self.load_run_args(ctx)

    def _execute_phase(self, task_id: str, run_args: dict[str, Any]) -> Any | None:
        with self._session_maker() as db:
            ctx = self._load_context(db, task_id)
            if ctx is None:
                return None
            if self._cancel_if_requested(ctx):
                return None
            result = self.execute(ctx, run_args)
            ctx.store.set_progress(task_id, self.result_progress)
            ctx.store.set_result(task_id, self.serialize_result(result))
            db.commit()
            return result

    def _apply_and_finish(self, task_id: str, run_args: dict[str, Any], result: Any) -> None:
        with self._session_maker() as db:
            ctx = self._load_context(db, task_id)
            if ctx is None:
                return
            if self._cancel_if_requested(ctx):
                return
            if self.should_apply(ctx, run_args, result):
                self.apply_result(ctx, run_args, result)
            if self._cancel_if_requested(ctx):
                return
            ctx.store.set_progress(task_id, self.succeeded_progress)
            ctx.store.set_status(task_id, TaskStatus.succeeded)
            db.commit()

    def _mark_failed(self, task_id: str, error: str) -> None:
        with self._session_maker() as db:
            ctx = self._load_context(db, task_id)
            if ctx is None:
                return
            ctx.store.set_error(task_id, error)
            ctx.store.set_status(task_id, TaskStatus.failed)
            db.commit()

    def _load_context(self, db: Session, task_id: str) -> WorkerTaskContext | None:
        store = SyncSqlAlchemyTaskStore(db)
        task = store.get(task_id)
        if task is None:
            return None
        return WorkerTaskContext(task_id=task_id, db=db, store=store, task=task)

    def _cancel_if_requested(self, ctx: WorkerTaskContext) -> bool:
        if not ctx.store.is_cancel_requested(ctx.task_id):
            return False
        ctx.store.mark_cancelled(ctx.task_id)
        ctx.db.commit()
        return True

    def load_run_args(self, ctx: WorkerTaskContext) -> dict[str, Any]:
        return dict((ctx.task.payload or {}).get("run_args") or {})

    @abstractmethod
    def execute(self, ctx: WorkerTaskContext, run_args: dict[str, Any]) -> Any:
        raise NotImplementedError

    def serialize_result(self, result: Any) -> dict[str, Any]:
        if hasattr(result, "model_dump"):
            return result.model_dump()
        if isinstance(result, dict):
            return result
        raise TypeError(f"Unsupported result type for task_kind={self.task_kind}: {type(result)!r}")

    def should_apply(self, ctx: WorkerTaskContext, run_args: dict[str, Any], result: Any) -> bool:  # noqa: ARG002
        return False

    def apply_result(self, ctx: WorkerTaskContext, run_args: dict[str, Any], result: Any) -> None:  # noqa: ARG002
        return None

    def _log_event(self, event: str, task_id: str, **fields: Any) -> None:
        log_task_event(self.task_kind, task_id, event, **fields)

    def _elapsed_ms(self, started_at: float) -> int:
        return int((time.monotonic() - started_at) * 1000)

    def _ensure_not_timed_out(self, task_id: str, started_at: float) -> None:
        if self.timeout_seconds is None:
            return
        elapsed_seconds = time.monotonic() - started_at
        if elapsed_seconds <= self.timeout_seconds:
            return
        raise TimeoutError(f"Task timed out after {self.timeout_seconds} seconds: {task_id}")


class AbstractAsyncDelegatingExecutor(AbstractWorkerTaskExecutor):
    """给 async 业务任务的 Celery 执行桥。

    适用于图片生成、视频生成、分镜帧提示词这类仍以内置 async service 为主的任务。
    它只负责：
    - 每个任务执行前重建 async DB runtime；
    - 从 GenerationTask.payload 读取 run_args；
    - 在独立 event loop 中执行 async runner；
    - 执行后主动释放 async engine。
    """

    def __init__(
        self,
        *,
        task_kind: str,
        runner: Callable[[str, dict[str, Any]], Awaitable[None]],
        timeout_seconds: float | None = 1800.0,
        require_generation_snapshot: bool = False,
        session_maker: sessionmaker[Session] = sync_session_maker,
    ) -> None:
        super().__init__(session_maker=session_maker)
        self.task_kind = task_kind
        self._runner = runner
        self.timeout_seconds = timeout_seconds
        self._require_generation_snapshot = require_generation_snapshot

    def run(self, task_id: str) -> None:
        started_at = time.monotonic()
        self._log_event("started", task_id)
        if self._mark_cancelled_if_requested(task_id):
            self._log_event("cancelled", task_id, elapsed_ms=self._elapsed_ms(started_at))
            return
        reset_db_runtime()
        try:
            execution_payload = self._load_execution_payload(task_id)
            timeout_seconds = self._resolve_timeout_seconds(execution_payload)
            asyncio.run(self._run_async_with_runtime(task_id, execution_payload, timeout_seconds))
            self._log_event("succeeded", task_id, elapsed_ms=self._elapsed_ms(started_at))
        except TimeoutError as exc:
            error = str(exc)
            self._mark_failed(task_id, error)
            self._log_event("failed", task_id, elapsed_ms=self._elapsed_ms(started_at), error=error)
        except Exception as exc:  # noqa: BLE001
            self._mark_failed(task_id, str(exc))
            self._log_event("failed", task_id, elapsed_ms=self._elapsed_ms(started_at), error=str(exc))
            raise

    def _load_execution_payload(self, task_id: str) -> dict[str, Any]:
        """加载 Worker 可消费的任务输入，并阻断已弃用的生成凭据 payload。

        图片和视频任务只能接收 Submitter 生成的 ``command`` + ``snapshot``。
        这里有意不回退到 ``run_args``，以确保历史 payload 内的 ``api_key``、
        ``base_url`` 等敏感字段不会再被执行器读取或转交给新的运行时。
        """
        with self._session_maker() as db:
            row = db.get(GenerationTask, task_id)
            if row is None:
                raise RuntimeError(f"Task not found: {task_id}")
            payload = dict(row.payload or {})
            if not self._require_generation_snapshot:
                return dict(payload.get("run_args") or {})

            command = payload.get("command")
            snapshot = payload.get("snapshot")
            if not isinstance(command, dict) or not isinstance(snapshot, dict):
                raise RuntimeError(
                    f"Generation snapshot is required for task_kind={self.task_kind}; "
                    "legacy run_args payload is unsupported"
                )
            return {"command": dict(command), "snapshot": dict(snapshot)}

    async def _run_async_with_runtime(
        self,
        task_id: str,
        run_args: dict[str, Any],
        timeout_seconds: float | None,
    ) -> None:
        try:
            await self._run_async(task_id, run_args, timeout_seconds)
        finally:
            try:
                await close_db()
            except Exception:  # noqa: BLE001
                logger.exception("Failed to close async DB runtime for %s task: %s", self.task_kind, task_id)

    async def _run_async(self, task_id: str, run_args: dict[str, Any], timeout_seconds: float | None) -> None:
        if timeout_seconds is None:
            await self._runner(task_id, run_args)
            return
        try:
            await asyncio.wait_for(self._runner(task_id, run_args), timeout=timeout_seconds)
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"Task timed out after {timeout_seconds} seconds") from exc

    def _resolve_timeout_seconds(self, run_args: dict[str, Any]) -> float | None:
        value = run_args.get("timeout_seconds")
        if value in (None, ""):
            return self.timeout_seconds
        try:
            timeout_seconds = float(value)
        except (TypeError, ValueError):
            return self.timeout_seconds
        return timeout_seconds if timeout_seconds > 0 else None

    def _mark_cancelled_if_requested(self, task_id: str) -> bool:
        with self._session_maker() as db:
            row = db.get(GenerationTask, task_id)
            if row is None or not row.cancel_requested:
                return False
            store = SyncSqlAlchemyTaskStore(db)
            store.mark_cancelled(task_id)
            db.commit()
            return True

    def execute(self, ctx: WorkerTaskContext, run_args: dict[str, Any]) -> Any:  # pragma: no cover - async 桥不会走这里
        raise NotImplementedError
