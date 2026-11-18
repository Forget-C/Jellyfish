"""新 Worker 的提交、轮询、收取与本地终态集成。"""

import asyncio

import httpx
import pytest
from botocore.exceptions import ClientError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.experiment_sessions import ExperimentSession
from app.models.llm import Model, Provider
from app.core.contracts.generation import GenerationCommand
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter
from app.models.task import Task
from app.services.task_service import TaskService, utcnow
from app.task_worker import TaskWorker, WorkerLimits


@pytest.mark.asyncio
async def test_worker_stops_retired_scene_version_tasks_before_provider_requests():
    """退役任务保留原记录，已提交的旧视频不再查询供应商。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(500)

    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions.begin() as db:
            retired_submissions = [
                ('scene_export', None, {}),
                ('directing_unit_design', None, {}),
                ('directing_instruction', None, {}),
                ('directing_instruction_check', None, {}),
                ('directing_design', 'directing_sequence', {'scene_design': {'version_id': 'old-version'}}),
                ('video_generation', 'scene_video', {}),
            ]
            for kind, target_type, snapshot in retired_submissions:
                with pytest.raises(ValueError, match='场次版本任务已退役'):
                    await TaskService(db).submit(kind=kind, target_type=target_type, snapshot=snapshot)
            db.add_all([
                Task(id="old-export", kind="scene_export"),
                Task(id="old-unit", kind="directing_unit_design"),
                Task(id="old-instruction", kind="directing_instruction"),
                Task(id="old-check", kind="directing_instruction_check"),
                Task(id="old-design", kind="directing_design",
                     input_snapshot={"scene_design": {"version_id": "old-version"}}),
                Task(id="old-video", kind="video_generation", target_type="scene_video",
                     status="running", execution_mode="remote", provider_task_id="remote-id",
                     next_poll_at=utcnow()),
            ])
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            worker = TaskWorker(sessions, client=client, limits=WorkerLimits(text=5))
            try:
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
            finally:
                worker.text_pool.shutdown(wait=True)
        async with sessions() as db:
            for task_id in ("old-export", "old-unit", "old-instruction", "old-check", "old-design", "old-video"):
                task = await db.get(Task, task_id)
                assert (task.status, task.error_code) == ("failed", "scene_version_retired")
            assert (await db.get(Task, "old-video")).provider_task_id == "remote-id"
        assert requests == []
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_worker_restart_polls_original_id_without_new_submission(monkeypatch):
    """模拟重启后只 GET 原 ID，下载完成才将本地任务置为成功。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    requests, uploads = [], []

    def handle(request):
        """模拟供应商与下载，任何再次 POST 都使测试失败。"""
        requests.append(request)
        assert request.method == "GET"
        if request.url.host == "media.invalid":
            return httpx.Response(200, content=b"video", headers={"content-type": "video/mp4"})
        assert request.url.path == "/ent/v2/tasks/original-id/creations"
        return httpx.Response(200, json={"state": "success", "creations": [{"url": "https://media.invalid/video"}]})

    async def head(**kwargs):
        """输出尚未存储。"""
        raise ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")

    async def upload(**kwargs):
        """对象上传完成前，任务必须仍为运行中。"""
        async with sessions() as db:
            task = await db.get(Task, task_id)
            assert task.status == "running" and task.stage == "saving"
        uploads.append(kwargs["data"].read())

    monkeypatch.setattr("app.services.generation.media_execution.storage.get_file_info", head)
    monkeypatch.setattr("app.services.generation.media_execution.storage.upload_file", upload)
    try:
        async with sessions() as db:
            db.add(Provider(id="provider", name="Vidu", api_key="test", base_url="https://provider.invalid"))
            db.add(ExperimentSession(id="session", lab_type="video"))
            await db.flush()
            db.add(Model(id="model", provider_id="provider", category="video", name="viduq2"))
            await db.flush()
            accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, GenerationCommand.model_validate({
                "modality": "video", "operation": "video_generation", "delivery": "async_polling",
                "target": {"kind": "experiment_session", "entity_id": "session"},
                "request": {"model_id": "model", "execution_prompt": "test", "operation_input": {"kind": "video_generation", "ratio": "16:9"}},
            }))
            task_id = accepted.task_id
            service = TaskService(db)
            await service.claim(task_id, worker_id="previous-process")
            await service.record_submission(task_id, provider_task_id="original-id")
            await db.commit()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            worker = TaskWorker(sessions, client=client)
            try:
                async with sessions() as db:
                    await TaskService(db).interrupt_previous_workers(worker_id=worker.worker_id)
                    await db.commit()
                await worker.tick()
                await asyncio.gather(*list(worker.jobs.values()))
                async with sessions() as db:
                    task = await db.get(Task, task_id)
                    assert task.status == "succeeded"
                    assert task.provider_task_id == "original-id"
                assert len(requests) == 2 and uploads == [b"video"]
            finally:
                worker.text_pool.shutdown(wait=True)
    finally:
        await engine.dispose()


async def _seed_text_task(sessions):
    """创建有完整供应商配置的文本任务，测试不会发起真实生成。"""
    async with sessions() as db:
        db.add(Provider(id="text-provider", name="OpenAI", api_key="test", base_url="https://provider.invalid"))
        db.add(ExperimentSession(id="text-session", lab_type="text"))
        await db.flush()
        db.add(Model(id="text-model", provider_id="text-provider", category="text", name="text-model"))
        await db.flush()
        accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, GenerationCommand.model_validate({
            "modality": "text", "operation": "text_chat", "delivery": "async_polling",
            "target": {"kind": "experiment_session", "entity_id": "text-session"},
            "request": {"model_id": "text-model", "operation_input": {"kind": "text_chat",
                        "messages": [{"role": "user", "content": "test", "sequence": 1}]}},
        }))
        await TaskService(db).claim(accepted.task_id, worker_id="worker")
        await db.commit()
        return accepted.task_id


@pytest.mark.asyncio
async def test_text_worker_success_is_atomic_and_not_repeated(monkeypatch):
    """文本成功仅追加一次助手消息，重复执行不会调用模型或覆盖终态。"""
    from langchain_core.messages import AIMessage
    from sqlalchemy import select
    from app.models.experiment_sessions import ExperimentMessage

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    calls = []

    class FakeModel:
        """只返回本地固定文本，并检查显式关闭供应商重试。"""

        def __init__(self, **kwargs):
            """捕获执行时的冻结路由与客户端设置。"""
            assert kwargs["model"] == "text-model" and kwargs["max_retries"] == 0

        async def ainvoke(self, messages):
            """模拟一次模型执行。"""
            calls.append(messages)
            return AIMessage(content="generated text")

    monkeypatch.setattr("app.task_worker.ChatOpenAI", FakeModel)
    try:
        task_id = await _seed_text_task(sessions)
        async with httpx.AsyncClient() as client:
            worker = TaskWorker(sessions, client=client)
            try:
                await worker._execute(task_id)
                await worker._execute(task_id)
            finally:
                worker.text_pool.shutdown(wait=True)
        async with sessions() as db:
            task = await db.get(Task, task_id)
            messages = list(await db.scalars(select(ExperimentMessage)))
            assert task.status == "succeeded" and task.result["text"] == "generated text"
            assert len(messages) == len(calls) == 1
            assert task.result["assistant_message_id"] == messages[0].id
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_text_cancel_during_provider_call_prevents_assistant_delivery(monkeypatch):
    """模型响应到达前提交取消，迟到结果不能追加业务消息。"""
    from langchain_core.messages import AIMessage
    from sqlalchemy import select
    from app.models.experiment_sessions import ExperimentMessage

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    started, release = asyncio.Event(), asyncio.Event()

    class FakeModel:
        """模拟可以控制完成时间的供应商调用。"""

        def __init__(self, **kwargs):
            """接受 Worker 客户端参数。"""

        async def ainvoke(self, messages):
            """等到取消事务完成后才返回结果。"""
            started.set()
            await release.wait()
            return AIMessage(content="late text")

    monkeypatch.setattr("app.task_worker.ChatOpenAI", FakeModel)
    try:
        task_id = await _seed_text_task(sessions)
        async with httpx.AsyncClient() as client:
            worker = TaskWorker(sessions, client=client)
            try:
                job = asyncio.create_task(worker._execute(task_id))
                await asyncio.wait_for(started.wait(), 3)
                async with sessions() as db:
                    await TaskService(db).request_cancel(task_id)
                    await db.commit()
                release.set()
                await job
            finally:
                worker.text_pool.shutdown(wait=True)
        async with sessions() as db:
            task = await db.get(Task, task_id)
            assert task.status == "cancelled" and task.result is None
            assert not list(await db.scalars(select(ExperimentMessage)))
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_cancelled_script_retains_capacity_until_thread_finishes(monkeypatch):
    """取消等待不会释放仍在运行的同步线程名额，后续文本任务继续排队。"""
    from threading import Event
    from types import SimpleNamespace
    from app.task_worker import WorkerLimits

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    started, release, stopped = asyncio.Event(), Event(), Event()
    loop = asyncio.get_running_loop()
    executed = []

    def generate(*args):
        """保持真实线程占用，避免把取消 asyncio future 误当作线程结束。"""
        loop.call_soon_threadsafe(started.set)
        assert release.wait(3)
        return "generated"

    async def execute(task_id):
        """观察调度领取，不调用模型。"""
        executed.append(task_id)

    monkeypatch.setattr("app.task_worker.generate_script_result", generate)
    async with httpx.AsyncClient() as client:
        worker = TaskWorker(sessions, client=client, limits=WorkerLimits(text=1))
        monkeypatch.setattr(worker, "_execute", execute)
        try:
            async with sessions.begin() as db:
                queued_id = (await TaskService(db).submit(kind="text_chat", snapshot={})).id
            task = SimpleNamespace(id="blocked-script", kind="script_extract")
            job = asyncio.create_task(worker._run_script(task, None, {}, stopped))
            await asyncio.wait_for(started.wait(), 1)
            thread = worker.text_threads[task.id]
            job.cancel()
            with pytest.raises(asyncio.CancelledError):
                await job
            assert stopped.is_set() and not thread.done()
            await worker.tick()
            assert not worker.jobs and not executed
            async with sessions() as db:
                assert (await db.get(Task, queued_id)).status == "queued"
            release.set()
            await asyncio.wait_for(asyncio.shield(thread), 1)
            assert not worker.text_threads
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            assert executed == [queued_id]
        finally:
            release.set()
            worker.text_pool.shutdown(wait=True)
            await engine.dispose()


def test_stopped_script_blocks_next_actual_model_request():
    """通过真实 LangChain 回调链验证停止后不再发送第二次 HTTP 请求。"""
    from threading import Event
    from time import monotonic
    from langchain_openai import ChatOpenAI
    from app.task_worker import ScriptStopHandler

    stopped, calls = Event(), []

    def respond(request):
        """本地响应一次模型请求，没有真实生成费用。"""
        calls.append(request)
        return httpx.Response(200, json={"id": "test", "object": "chat.completion", "created": 0,
            "model": "test", "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        llm = ChatOpenAI(model="test", api_key="test", base_url="https://provider.invalid/v1", max_retries=0,
                         http_client=client, callbacks=[ScriptStopHandler(stopped, monotonic() + 10)])
        assert llm.invoke("first").content == "ok"
        stopped.set()
        with pytest.raises(TimeoutError):
            llm.invoke("must not send")
        assert len(calls) == 1


@pytest.mark.asyncio
async def test_poll_and_output_collection_have_total_time_limit(monkeypatch):
    """即使单次下载一直未返回，也会结束本地跟踪，不再无限占用下载名额。"""
    from app.task_worker import WorkerLimits

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    download_started = asyncio.Event()

    def poll(request):
        """供应商已完成，接下来收取结果。"""
        assert request.url.path == "/ent/v2/tasks/original/creations"
        return httpx.Response(200, json={"state": "success", "creations": [{"b64_json": "eA=="}]})

    async def head(**kwargs):
        """输出尚未存储，需要完整收取。"""
        raise ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")

    async def upload(**kwargs):
        """收取一直未完成，等待总超时取消。"""
        download_started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr("app.core.storage.get_file_info", head)
    monkeypatch.setattr("app.core.storage.upload_file", upload)
    try:
        async with sessions.begin() as db:
            service = TaskService(db)
            task_id = (await service.submit(kind="image_generation", execution_mode="remote", snapshot={
                "execution_config": {"model_name": "viduq2", "provider_id": "provider", "provider_key": "vidu",
                                     "api_key": "test", "base_url": "https://provider.invalid"},
            })).id
            await service.claim(task_id, worker_id="previous")
            await service.record_submission(task_id, provider_task_id="original")
        async with httpx.AsyncClient(transport=httpx.MockTransport(poll)) as client:
            worker = TaskWorker(sessions, client=client, limits=WorkerLimits(execution_seconds=0.1))
            try:
                await worker.tick()
                await asyncio.wait_for(asyncio.gather(*list(worker.jobs.values())), 2)
                assert download_started.is_set()
                async with sessions() as db:
                    task = await db.get(Task, task_id)
                    assert task.status == "failed" and task.error_message == "请求或执行超时"
                    assert task.provider_task_id == "original"
            finally:
                worker.text_pool.shutdown(wait=True)
    finally:
        await engine.dispose()


@pytest.mark.parametrize("code, expected", [
    ("AllocationQuota.FreeTierOnly", "模型免费额度已耗尽，且供应商开启了仅使用免费额度；请恢复额度或选择其他模型"),
    ("UnknownVendorError", "模型请求失败，HTTP 403"),
])
def test_model_permission_error_is_actionable_without_exposing_response(code, expected):
    """真实验收中的额度拒绝可识别，未知供应商正文和凭据不进入任务错误。"""
    from openai import PermissionDeniedError

    response = httpx.Response(403, request=httpx.Request("POST", "https://provider.invalid/v1"))
    error = PermissionDeniedError("private upstream message", response=response,
                                  body={"code": code, "message": "private upstream message"})
    assert TaskWorker._error_message(error) == expected


def test_model_timeout_has_readable_error():
    """模型 SDK 超时与普通执行超时使用相同可读摘要。"""
    from openai import APITimeoutError

    error = APITimeoutError(request=httpx.Request("POST", "https://provider.invalid/v1"))
    assert TaskWorker._error_message(error) == "请求或执行超时"


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['directing_divide', 'directing_design', 'directing_review'])
async def test_directing_worker_streams_without_thinking(monkeypatch, kind):
    """六岗长输出采用流式接收，旧模型配置不能重新启用思考或关闭流式。"""
    from types import SimpleNamespace

    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    captured = {}

    def capture_model(**kwargs):
        """捕获真实 Worker 组装的客户端参数，不访问供应商。"""
        captured.update(kwargs)
        return object()

    async def generate(*args):
        """隔离工作单生成，只检查任务客户端策略和正常交付。"""
        return SimpleNamespace(model_dump=lambda: {'checked': True})

    monkeypatch.setattr('app.task_worker.ChatOpenAI', capture_model)
    try:
        task_id = await _seed_text_task(sessions)
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            task.kind = kind
            task.input_snapshot = {**task.input_snapshot, 'run_args': {}}
            model = await db.get(Model, 'text-model')
            model.params = {'streaming': False, 'extra_body': {'enable_thinking': True, 'seed': 7}}
        async with httpx.AsyncClient() as client:
            worker = TaskWorker(sessions, client=client)
            monkeypatch.setattr(worker, '_run_script', generate)
            try:
                await worker._execute(task_id)
            finally:
                worker.text_pool.shutdown(wait=True)
        assert captured['streaming'] is True
        assert captured['extra_body'] == {'enable_thinking': False, 'seed': 7}
        assert captured['timeout'] == 120
        assert captured['max_retries'] == 0
        async with sessions() as db:
            assert (await db.get(Task, task_id)).status == 'succeeded'
    finally:
        await engine.dispose()
