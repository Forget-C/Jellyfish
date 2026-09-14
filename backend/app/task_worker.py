"""独立异步任务 Worker：数据库排队、单次提交、周期查询与有界结果收取。"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import logging
import signal
from threading import Event
from time import monotonic
from uuid import uuid4

import httpx
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import APIStatusError, APITimeoutError
from sqlalchemy import func, or_, select

from app.core.db import async_session_maker, close_db
from app.core.integrations.media_provider import MediaProvider, ProviderDataError
from app.core.contracts.task import TaskStatus
from app.models.llm import Model, ModelCategoryKey, Provider
from app.models.task import Task
from app.services.file_cleanup import FileCleaner
from app.services.directing.ai import DirectingOutputError
from app.services.generation.media_execution import build_media_input, deliver_media, load_media_context, store_media_output
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.script_processing_worker import apply_script_result, generate_script_result
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages
from app.services.task_service import MEDIA_KINDS, TASK_KINDS, TaskService, utcnow

logger = logging.getLogger(__name__)


class ScriptStopHandler(BaseCallbackHandler):
    """脚本停止或超期后拒绝下一次模型请求，已发出的请求依靠网络超时结束。"""

    raise_error = True

    def __init__(self, stopped: Event, deadline: float):
        """跨线程共享停止信号，截止时间使用单调时钟。"""
        self.stopped = stopped
        self.deadline = deadline

    def on_chat_model_start(self, serialized, messages, **kwargs):
        """在实际发送模型请求前检查，防止超时任务继续执行后续模型步骤。"""
        if self.stopped.is_set() or monotonic() >= self.deadline:
            raise TimeoutError("script execution stopped")


@dataclass(frozen=True)
class WorkerLimits:
    """本地请求并发与远端运行配额独立，避免长媒体任务耗尽文本容量。"""

    text: int = 4
    submit: int = 4
    poll: int = 8
    download: int = 4
    remote: int = 32
    request_seconds: int = 120
    execution_seconds: int = 1800
    tracking_seconds: int = 86400


class TaskWorker:
    """部署一个 Worker 调度进程；进程内部按资源类型并发执行，不恢复本地步骤。"""

    def __init__(self, sessions=async_session_maker, *, limits: WorkerLimits | None = None, client: httpx.AsyncClient | None = None):
        """注入数据库和 HTTP 客户端，便于使用真实事务与模拟供应商验证。"""
        self.sessions = sessions
        self.limits = limits or WorkerLimits()
        self.worker_id = uuid4().hex
        self.client = client
        self.jobs: dict[str, asyncio.Task] = {}
        self.phases: dict[str, str] = {}
        self.download_slots = asyncio.Semaphore(self.limits.download)
        self.text_pool = ThreadPoolExecutor(max_workers=self.limits.text, thread_name_prefix="task-text")
        self.text_threads: dict[str, asyncio.Future] = {}
        self.stopping = asyncio.Event()
        self.cleaner = FileCleaner(self.sessions)
        self.maintenance: asyncio.Task | None = None
        self.next_cleanup_at = 0.0

    async def run(self) -> None:
        """启动时中断旧本地执行，有远端 ID 的任务保留并继续查询。"""
        owns_client = self.client is None
        if owns_client:
            self.client = httpx.AsyncClient(timeout=self.limits.request_seconds,
                limits=httpx.Limits(max_connections=self.limits.submit + self.limits.poll + self.limits.download))
        try:
            async with self.sessions() as db:
                await TaskService(db).interrupt_previous_workers(worker_id=self.worker_id)
                await db.commit()
            while not self.stopping.is_set():
                try:
                    await self.tick()
                    self._schedule_cleanup()
                except Exception as error:
                    logger.error("task scheduler iteration failed: %s", type(error).__name__)
                try:
                    await asyncio.wait_for(self.stopping.wait(), timeout=1)
                except TimeoutError:
                    pass
        finally:
            for job in self.jobs.values():
                job.cancel()
            await asyncio.gather(*list(self.jobs.values()), return_exceptions=True)
            if self.maintenance is not None:
                self.maintenance.cancel()
                await asyncio.gather(self.maintenance, return_exceptions=True)
            self.text_pool.shutdown(wait=False, cancel_futures=True)
            if owns_client:
                await self.client.aclose()

    def _schedule_cleanup(self) -> None:
        """每三十秒最多启动一轮独立清理，不占用生成任务的并发名额。"""
        now = asyncio.get_running_loop().time()
        if now < self.next_cleanup_at or (self.maintenance is not None and not self.maintenance.done()):
            return
        self.next_cleanup_at = now + 30

        async def clean():
            """记录清理异常，下轮继续扫描，不影响任务调度。"""
            try:
                await self.cleaner.run_once()
            except Exception as error:
                logger.warning("file maintenance failed: %s", type(error).__name__)

        self.maintenance = asyncio.create_task(clean())

    async def tick(self) -> None:
        """只在资源有空位时领取任务；远端任务只读取状态，不重新入队。"""
        async with self.sessions() as db:
            await TaskService(db).expire_tasks()
            remote_count = await db.scalar(select(func.count()).select_from(Task).where(
                Task.status == "running", Task.execution_mode == "remote",
            )) or 0
            for phase, kinds, capacity in (("text", TASK_KINDS - MEDIA_KINDS, self.limits.text),
                                           ("submit", MEDIA_KINDS, self.limits.submit)):
                occupied = {task_id for task_id, current in self.phases.items() if current == phase}
                if phase == "text":
                    occupied.update(self.text_threads)
                available = capacity - len(occupied)
                for _ in range(max(0, available)):
                    stmt = select(Task).where(Task.status == "queued", Task.kind.in_(kinds),
                        or_(Task.deadline_at.is_(None), Task.deadline_at > utcnow()), Task.cancel_requested_at.is_(None))
                    if remote_count >= self.limits.remote:
                        stmt = stmt.where(Task.execution_mode == "direct")
                    task = await db.scalar(stmt.order_by(Task.created_at, Task.id).limit(1).with_for_update(skip_locked=True))
                    if task is None:
                        break
                    claimed = await TaskService(db).claim(task.id, worker_id=self.worker_id, timeout_seconds=self.limits.execution_seconds)
                    await db.commit()
                    if claimed:
                        if task.execution_mode == "remote":
                            remote_count += 1
                        self._start(task.id, phase, self._execute(task.id))
            available = self.limits.poll - list(self.phases.values()).count("poll")
            due = list(await db.scalars(select(Task.id).where(
                Task.status == "running", Task.execution_mode == "remote", Task.provider_task_id.is_not(None),
                Task.id.not_in(list(self.jobs)),
                or_(Task.next_poll_at <= utcnow(), Task.cancel_requested_at.is_not(None), Task.deadline_at <= utcnow()),
            ).order_by(Task.next_poll_at, Task.id).limit(max(0, available))))
            await db.commit()
        for task_id in due:
            self._start(task_id, "poll", self._poll(task_id))

    def _start(self, task_id: str, phase: str, operation) -> None:
        """同进程每个任务最多一个活动操作；结束时释放调度名额。"""
        self.phases[task_id] = phase
        job = asyncio.create_task(operation)
        self.jobs[task_id] = job

        def done(completed):
            """消费异常并释放任务引用，不把异常或取消伪装为成功。"""
            self.jobs.pop(task_id, None)
            self.phases.pop(task_id, None)
            if not completed.cancelled() and completed.exception() is not None:
                logger.error("task operation failed before persistence: task=%s error=%s", task_id, type(completed.exception()).__name__)

        job.add_done_callback(done)

    async def _load(self, task_id: str):
        """读取最新活动任务并裁决取消，返回脱离数据库会话的任务数据。"""
        async with self.sessions() as db:
            task = await db.get(Task, task_id)
            if task is None or task.status != TaskStatus.running:
                return None
            if task.cancel_requested_at:
                await TaskService(db).finish(task_id, cancelled=True)
                await db.commit()
                return None
            return task

    async def _execute(self, task_id: str) -> None:
        """本地执行一次；图片同步结果收取，远端 ID 持久化后释放提交名额。"""
        try:
            async with asyncio.timeout(self.limits.execution_seconds):
                task = await self._load(task_id)
                if task is None:
                    return
                if task.kind not in MEDIA_KINDS:
                    await self._text(task)
                    return
                async with self.sessions() as db:
                    cfg, snapshot, files = await load_media_context(db, task)
                inp = await build_media_input(task, snapshot, files)
                if await self._load(task_id) is None:
                    return
                result = await MediaProvider(self.client).submit(cfg, inp)
                if isinstance(result, str):
                    async with self.sessions() as db:
                        await TaskService(db).record_submission(task_id, provider_task_id=result, tracking_seconds=self.limits.tracking_seconds)
                        await db.commit()
                else:
                    await self._save(task, result)
        except asyncio.CancelledError:
            async with self.sessions() as db:
                current = await db.get(Task, task_id)
                if current is not None and not (current.execution_mode == "remote" and current.provider_task_id):
                    await TaskService(db).finish(task_id, error_code="execution_interrupted", error="执行进程已停止，请重新提交")
                    await db.commit()
            raise
        except TimeoutError:
            await self._fail(task_id, "execution_timeout", "任务执行超时")
        except Exception as error:
            await self._fail(task_id, "submission_failed", self._error_message(error))

    async def _poll(self, task_id: str) -> None:
        """单次查询失败可延后再查；跟踪截止后最终查询仍未完成则结束本地任务。"""
        try:
            async with asyncio.timeout(self.limits.execution_seconds):
                task = await self._load(task_id)
                if task is None:
                    return
                async with self.sessions() as db:
                    cfg, _, _ = await load_media_context(db, task)
                try:
                    observed = await MediaProvider(self.client).poll(cfg, kind=task.kind, task_id=task.provider_task_id)
                except (httpx.TransportError, httpx.HTTPStatusError) as error:
                    if task.deadline_at and task.deadline_at <= utcnow():
                        await self._fail(task_id, "tracking_timeout", "供应商状态跟踪超时")
                    else:
                        async with self.sessions() as db:
                            await TaskService(db).record_poll_result(task_id, error=self._error_message(error), next_poll_seconds=15)
                            await db.commit()
                    return
                async with self.sessions() as db:
                    await TaskService(db).record_poll_result(task_id, remote_status=observed.status)
                    await db.commit()
                if observed.status == "succeeded":
                    await self._save(task, observed.outputs)
                elif observed.status == "running" and task.deadline_at and task.deadline_at <= utcnow():
                    await self._fail(task_id, "tracking_timeout", "供应商状态跟踪超时")
        except asyncio.CancelledError:
            # 已有远端 ID 的任务不因本地退出而失败，下次启动继续查询同一 ID。
            raise
        except Exception as error:
            await self._fail(task_id, "result_failed", self._error_message(error))

    async def _save(self, task: Task, outputs) -> None:
        """独立限制下载并发，逐个保存部分结果，全部完成后原子交付终态。"""
        expected = int((task.input_snapshot.get("operation_input") or {}).get("count", 1))
        if len(outputs) != expected:
            raise ProviderDataError("provider_output_count_mismatch")
        async with self.download_slots:
            self.phases[task.id] = "download"
            for ordinal, output in enumerate(outputs):
                if await self._load(task.id) is None:
                    return
                await store_media_output(self.sessions, self.client, task_id=task.id, ordinal=ordinal, kind=task.kind, output=output)
        async with self.sessions() as db:
            await TaskService(db).finish(task.id, deliver=deliver_media)
            await db.commit()

    async def _text(self, task: Task) -> None:
        """先解析模型后释放事务；同步 Agent 在有界线程池执行，结果统一交付。"""
        stopped = Event()
        async with self.sessions() as db:
            model = await db.get(Model, task.input_snapshot.get("model_id"))
            provider = await db.get(Provider, task.provider_id) if task.provider_id else None
            if model is None or provider is None or model.category != ModelCategoryKey.text or model.provider_id != provider.id:
                raise ProviderDataError("text_model_unavailable")
            cfg = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
            if cfg.provider_key != task.input_snapshot.get("provider_key"):
                raise ProviderDataError("provider_route_changed")
            params = dict(model.params or {})
            params.update(model=task.input_snapshot["model_name"], api_key=cfg.api_key, base_url=cfg.base_url,
                          max_retries=0, timeout=self.limits.request_seconds, http_async_client=self.client)
            if task.kind != "text_chat":
                params["callbacks"] = [ScriptStopHandler(stopped, monotonic() + self.limits.execution_seconds)]
            directing = task.kind in {"directing_divide", "directing_design", "directing_review"}
            if directing:
                # 长工作单持续接收分片，避免非流式等待完整响应触发读取超时。
                params["streaming"] = True
            if directing or task.kind in {"text_chat", "script_divide", "script_extract"}:
                params["extra_body"] = {**params.get("extra_body", {}), "enable_thinking": False}
            llm = ChatOpenAI(**params)
        if task.kind == "text_chat":
            roles = {"system": SystemMessage, "user": HumanMessage, "assistant": AIMessage}
            messages = task.input_snapshot["operation_input"]["messages"]
            response = await llm.ainvoke([roles[item["role"]](content=item["content"]) for item in sorted(messages, key=lambda item: item["sequence"])])
            text = response.content
            if not isinstance(text, str) or not text.strip():
                raise ProviderDataError("text_result_empty")
            result = {"text": text, "model_id": task.input_snapshot["model_id"]}

            async def deliver(db, current):
                """任务成功事务中追加助手消息；重复终结不会再次调用。"""
                messages = await append_experiment_messages(db, session_id=current.target_id,
                    drafts=[ExperimentMessageDraft(role="assistant", content=text)])
                result["assistant_message_id"] = messages[0].id
        else:
            args = task.input_snapshot["run_args"]
            generated = await self._run_script(task, llm, args, stopped)
            result = {"draft": generated.model_dump(), "from_cache": False} if task.kind == "script_extract" else generated.model_dump()

            async def deliver(db, current):
                """脚本业务写回与任务成功共用一个短事务。"""
                if not current.kind.startswith("directing_"):
                    await apply_script_result(db, kind=current.kind, run_args=args, result=generated)
        async with self.sessions() as db:
            await TaskService(db).finish(task.id, result=result, deliver=deliver)
            await db.commit()

    async def _run_script(self, task: Task, llm, args: dict, stopped: Event):
        """等待超时不代表线程退出；线程实际结束前继续占用文本名额。"""
        future = asyncio.wrap_future(self.text_pool.submit(generate_script_result, task.kind, llm, args))
        self.text_threads[task.id] = future

        def done(completed):
            """在线程真正结束后释放名额，并消费停止后到达的异常。"""
            self.text_threads.pop(task.id, None)
            if not completed.cancelled():
                completed.exception()

        future.add_done_callback(done)
        try:
            return await asyncio.shield(future)
        finally:
            stopped.set()

    async def _fail(self, task_id: str, code: str, message: str) -> None:
        """所有错误均经统一终态裁决，不覆盖已经提交的成功或取消。"""
        async with self.sessions() as db:
            await TaskService(db).finish(task_id, error_code=code, error=message)
            await db.commit()

    @staticmethod
    def _error_message(error: Exception) -> str:
        """保存稳定且不含上游正文、URL 或凭据的错误摘要。"""
        if isinstance(error, ProviderDataError):
            return str(error)
        if isinstance(error, DirectingOutputError):
            return str(error)
        if isinstance(error, APIStatusError):
            if error.code == "AllocationQuota.FreeTierOnly":
                return "模型免费额度已耗尽，且供应商开启了仅使用免费额度；请恢复额度或选择其他模型"
            return f"模型请求失败，HTTP {error.status_code}"
        if isinstance(error, httpx.HTTPStatusError):
            return f"供应商请求失败，HTTP {error.response.status_code}"
        if isinstance(error, (TimeoutError, APITimeoutError)):
            return "请求或执行超时"
        return f"任务处理失败：{type(error).__name__}"


async def main() -> None:
    """命令行入口，停止信号只结束本地工作，不重新提交远端生成。"""
    worker = TaskWorker()
    for sig in (signal.SIGINT, signal.SIGTERM):
        asyncio.get_running_loop().add_signal_handler(sig, worker.stopping.set)
    try:
        await worker.run()
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
