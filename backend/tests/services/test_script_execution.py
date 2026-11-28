"""剧本纯计算与新 Worker 的结果保存、缺失输入失败边界。"""

import pytest
from hashlib import sha256
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.llm import Model, Provider
from app.models.task import Task
from app.schemas.skills.script_processing import ScriptConsistencyCheckResult
from app.services import script_processing_worker
from app.services.task_service import TaskService
from app.task_worker import TaskWorker


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [False, True])
@pytest.mark.parametrize("kind,args,agent_name,expected", [
    ("script_consistency", {"script_text": "第一幕"}, "ConsistencyCheckerAgent",
     {"issues": [], "has_issues": True, "summary": "发现一处问题"}),
])
async def test_script_worker_preserves_inputs_and_result_or_fails_missing_data(monkeypatch, kind, args, agent_name, expected, missing):
    """实际 Worker 调用纯生成器：保留冻结输入和结果形状，缺失输入不调用 Agent。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    calls = []
    result_type = ScriptConsistencyCheckResult

    class Agent:
        """仅模拟模型计算，任务状态和事务仍由真实 Worker 维护。"""

        def __init__(self, llm):
            """接收执行器构建的模型。"""
            pass

        def extract(self, **kwargs):
            """捕获传给模型的冻结参数并返回结构化结果。"""
            calls.append(kwargs)
            return result_type.model_validate(expected)

    monkeypatch.setattr(script_processing_worker, agent_name, Agent)
    monkeypatch.setattr("app.task_worker.build_langchain_chat", lambda **kwargs: object())
    worker = TaskWorker(sessions)
    try:
        async with sessions() as db:
            db.add(Provider(id="provider", provider_key='openai', name="OpenAI", api_key="test", base_url="https://provider.invalid"))
            await db.flush()
            db.add(Model(id="model", provider_id="provider", category="text", name="text-model"))
            await db.flush()
            task = await TaskService(db).submit(kind=kind, provider_id="provider", snapshot={
                "model_id": "model", "model_name": "text-model", "provider_key": "openai",
                "run_args": {} if missing else args,
            })
            await TaskService(db).claim(task.id, worker_id=worker.worker_id)
            await db.commit()
        await worker._execute(task.id)
        async with sessions() as db:
            saved = await db.get(Task, task.id)
            if missing:
                assert saved.status == "failed" and saved.result is None
                assert not calls
            else:
                assert saved.status == "succeeded"
                assert saved.result == {**expected, "check_scope": "source_consistency", "policy_version": 2, "review_version": sha256(b"[]").hexdigest(),
                    "source_version": sha256(args["script_text"].encode()).hexdigest(),
                    "explanation_version": sha256(b"[]").hexdigest()}
                assert len(calls) == 1
                assert calls[0] == {**args, "explanations": "[]"}
    finally:
        worker.text_pool.shutdown(wait=True)
        await engine.dispose()
