"""媒体受理后固定供应商路由，Worker 只在首次执行时加载生成输入。"""

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import timedelta

import httpx
import pytest
from botocore.exceptions import ClientError
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.contracts.generation import GenerationCommand
from app.core.db import Base
from app.models.experiment_sessions import ExperimentSession
from app.models.llm import Model, Provider
from app.models.task import Task, TaskInput
from app.models.studio_prompts_files_timeline import FileItem
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter
from app.services.task_queries import TaskQueries
from app.services.task_service import TaskService, utcnow
from app.task_worker import TaskWorker


@asynccontextmanager
async def media_database():
    """使用隔离数据库，供应商请求与存储由各用例在外部接口模拟。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield engine, async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


async def submit_media(sessions, *, modality="image", provider_name="Vidu"):
    """通过真实提交器受理实验室媒体任务，使用类别专用地址。"""
    async with sessions.begin() as db:
        db.add(Provider(id="provider", provider_key=provider_name.lower(), name="Production", api_key="original-secret",
            base_url="https://common.invalid", image_base_url="https://images.invalid", video_base_url="https://videos.invalid"))
        db.add(ExperimentSession(id="session", lab_type=modality))
        await db.flush()
        db.add(Model(id="model", provider_id="provider", category=modality,
                     name="gpt-image-1" if provider_name == "OpenAI" else "viduq2"))
        await db.flush()
        return (await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, GenerationCommand.model_validate({
            "modality": modality, "operation": f"{modality}_generation", "delivery": "async_polling",
            "target": {"kind": "experiment_session", "entity_id": "session"},
            "request": {"model_id": "model", "execution_prompt": "fixed prompt",
                        "operation_input": {"kind": f"{modality}_generation", **({"ratio": "16:9"} if modality == "video" else {})}},
        }))).task_id


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_name,modality", [("OpenAI", "image"), ("Vidu", "image"), ("Vidu", "video")])
async def test_accepted_media_keeps_frozen_route_after_provider_edits(provider_name, modality, monkeypatch):
    """排队后编辑／停用不改投；重启及多轮查询仍使用原路由与认证。"""
    calls, uploads = [], []

    def handle(request):
        calls.append(request)
        assert request.url.host == ("images.invalid" if modality == "image" else "videos.invalid")
        assert request.headers["authorization"] == ("Bearer original-secret" if provider_name == "OpenAI" else "Token original-secret")
        if request.method == "POST":
            assert json.loads(request.content)["model"] == ("gpt-image-1" if provider_name == "OpenAI" else "viduq2")
            if provider_name == "OpenAI":
                return httpx.Response(200, json={"data": [{"b64_json": "eA=="}]})
            return httpx.Response(200, json={"task_id": "original-id"})
        assert request.url.path == "/ent/v2/tasks/original-id/creations"
        if len(calls) == 2:
            return httpx.Response(200, json={"state": "processing"})
        return httpx.Response(200, json={"state": "success", "creations": [{"b64_json": "eA=="}]})

    async def head(**kwargs):
        raise ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")

    async def upload(**kwargs):
        uploads.append(kwargs["data"].read())

    monkeypatch.setattr("app.core.storage.get_file_info", head)
    monkeypatch.setattr("app.core.storage.upload_file", upload)
    async with media_database() as (_, sessions):
        task_id = await submit_media(sessions, modality=modality, provider_name=provider_name)
        async with sessions.begin() as db:
            provider = await db.get(Provider, "provider")
            provider.name, provider.api_key, provider.status = "Kling", "changed-secret", "disabled"
            provider.base_url = provider.image_base_url = provider.video_base_url = "https://changed.invalid"
            (await db.get(Model, "model")).name = "changed-model"
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            worker = TaskWorker(sessions, client=client)
            try:
                await worker.tick()
                await asyncio.gather(*list(worker.jobs.values()))
                async with sessions() as db:
                    status = await TaskQueries(db).status(task_id)
                assert status.status == ("succeeded" if provider_name == "OpenAI" else "running")
                if provider_name == "Vidu":
                    worker.text_pool.shutdown(wait=True)
                    worker = TaskWorker(sessions, client=client)
                    async with sessions.begin() as db:
                        await TaskService(db).interrupt_previous_workers(worker_id=worker.worker_id)
                    await worker.tick()
                    await asyncio.gather(*list(worker.jobs.values()))
                    async with sessions() as db:
                        assert (await TaskQueries(db).status(task_id)).status == "running"
                    later = utcnow() + timedelta(seconds=10)
                    monkeypatch.setattr("app.task_worker.utcnow", lambda: later)
                    await worker.tick()
                    await asyncio.gather(*list(worker.jobs.values()))
                async with sessions() as db:
                    result = await TaskQueries(db).result(task_id)
                    assert result.status == "succeeded", result.error
                    assert len(result.outputs) == 1
                assert [request.method for request in calls] == (["POST"] if provider_name == "OpenAI" else ["POST", "GET", "GET"])
                assert uploads == [b"x"]
            finally:
                worker.text_pool.shutdown(wait=True)


@pytest.mark.asyncio
async def test_remote_poll_reads_only_task_facts():
    """查询远端进度无需模型、供应商、输入文件或完整输入快照。"""
    statements, calls = [], []

    def record_sql(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    def handle(request):
        calls.append(request)
        assert request.method == "GET"
        assert request.url == "https://images.invalid/ent/v2/tasks/original-id/creations"
        assert request.headers["authorization"] == "Token original-secret"
        return httpx.Response(200, json={"state": "processing"})

    async with media_database() as (engine, sessions):
        task_id = await submit_media(sessions)
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            # 保留查询必需的配置，故意移除无法重建完整输入的其他字段。
            task.input_snapshot = {"execution_config": task.input_snapshot["execution_config"]}
            db.add(FileItem(id="input", type="image", name="reference", storage_key="input.png"))
            await db.flush()
            db.add(TaskInput(task_id=task_id, role_path="references", ordinal=0, file_id="input"))
            service = TaskService(db)
            await service.claim(task_id, worker_id="previous")
            await service.record_submission(task_id, provider_task_id="original-id")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            worker = TaskWorker(sessions, client=client)
            try:
                event.listen(engine.sync_engine, "before_cursor_execute", record_sql)
                await worker.tick()
                await asyncio.gather(*list(worker.jobs.values()))
                event.remove(engine.sync_engine, "before_cursor_execute", record_sql)
                async with sessions() as db:
                    status = await TaskQueries(db).status(task_id)
                    assert status.status == "running" and status.stage == "polling"
                assert len(calls) == 1
                for table in ("providers", "models", "task_inputs", "files"):
                    assert not any(f"from {table}" in sql or f"join {table}" in sql for sql in statements)
            finally:
                worker.text_pool.shutdown(wait=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("running", [False, True], ids=["queued", "polling"])
@pytest.mark.parametrize("invalid", ["missing", "missing_base_url", None, "private-secret", {}, {"api_key": 123},
                                    {"api_key": ""}, {"provider_key": ""}, {"provider_key": "unknown"}, {"model_name": ""},
                                    {"base_url": None}, {"base_url": ""}])
async def test_invalid_execution_config_fails_without_provider_request(running, invalid):
    """旧任务及损坏快照明确提示重新提交，不读取当前配置或泄漏坏值。"""
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"state": "processing"})

    async with media_database() as (_, sessions):
        task_id = await submit_media(sessions)
        async with sessions.begin() as db:
            if running:
                service = TaskService(db)
                await service.claim(task_id, worker_id="previous")
                await service.record_submission(task_id, provider_task_id="original-id")
            task = await db.get(Task, task_id)
            snapshot = dict(task.input_snapshot)
            if invalid == "missing":
                snapshot.pop("execution_config")
            elif invalid == "missing_base_url":
                snapshot["execution_config"] = dict(snapshot["execution_config"])
                snapshot["execution_config"].pop("base_url")
            else:
                snapshot["execution_config"] = {**snapshot["execution_config"], **invalid} if isinstance(invalid, dict) and invalid else invalid
            task.input_snapshot = snapshot
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            worker = TaskWorker(sessions, client=client)
            try:
                await worker.tick()
                await asyncio.gather(*list(worker.jobs.values()))
                async with sessions() as db:
                    result = await TaskQueries(db).result(task_id)
                    assert result.status == "failed"
                    assert result.error == "媒体任务缺少有效的供应商配置快照，请重新提交"
                    assert "private-secret" not in result.model_dump_json()
                    assert "original-secret" not in result.model_dump_json()
                assert not calls
            finally:
                worker.text_pool.shutdown(wait=True)
