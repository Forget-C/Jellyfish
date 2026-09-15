"""任务历史翻页与消息投影使用数据库任务事实。"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.studio_prompts_files_timeline import FileItem
from app.services.studio.experiment_messages import read_experiment_messages
from app.services.task_service import TaskService
from app.services.task_queries import TaskQueries


@pytest.mark.asyncio
async def test_history_sources_are_batched_and_survive_deleted_targets():
    """槽位回跳到业务主体；共享资产不猜项目，来源删除也不丢失任务历史。"""
    from app.models.studio import Project, Chapter, Actor, Character
    from app.services.directing.store import DirectingStore

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            db.add(Project(id="p", name="项目", style="realistic"))
            db.add(Actor(id="a", name="演员", style="realistic"))
            db.add(ExperimentSession(id="e", lab_type="image", title="实验"))
            await db.flush()
            db.add(Chapter(id="c", project_id="p", index=1, title="章节"))
            db.add(Character(id="r", project_id="p", name="角色", style="realistic"))
            await db.flush()
            sequence = await DirectingStore(db, "p").create_sequence(chapter_id="c", title="场次", position=0)
            service = TaskService(db)
            targets = [
                ("directing_sequence", sequence.id, None), ("directing_sequence", sequence.id, None),
                ("actor_image_slot", "slot", "a"), ("character_image_slot", "slot", "r"),
                ("experiment_session", "e", None), ("consistency_check", "c", None),
                ("script_optimization", "p", None), ("prop_info_analysis", "actor_image:a", None),
            ]
            tasks = [await service.submit(kind="image_generation", target_type=kind, target_id=identity,
                                          snapshot={"target_parent_id": parent}) for kind, identity, parent in targets]
            await db.commit()
            statements = []

            def record_sql(connection, cursor, statement, parameters, context, executemany):
                """记录查询数，避免每条任务重复获取相同来源。"""
                statements.append(statement)

            event.listen(engine.sync_engine, "before_cursor_execute", record_sql)
            page = await TaskQueries(db).list(limit=20)
            event.remove(engine.sync_engine, "before_cursor_execute", record_sql)
            assert len(statements) == 7  # 主表一次；场次、演员、角色、会话各一次；章节及项目各一次。
            sources = {item.task_id: item.source for item in page.items}
            assert sources[tasks[0].id] == sources[tasks[1].id]
            assert sources[tasks[0].id].project_id == "p"
            assert sources[tasks[0].id].chapter_id == "c"
            assert sources[tasks[2].id].project_id is None
            assert sources[tasks[3].id].project_id == "p"
            assert sources[tasks[4].id].kind == "experiment_session"
            assert sources[tasks[5].id].kind == "chapter"
            assert sources[tasks[6].id].kind == "project"
            assert sources[tasks[7].id] == sources[tasks[2].id]
            await db.delete(sequence)
            await db.commit()
            page = await TaskQueries(db).list(limit=20)
            assert len(page.items) == len(tasks)
            assert all(item.source is None for item in page.items if item.task_id in {tasks[0].id, tasks[1].id})
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_history_cursor_does_not_skip_when_new_task_arrives():
    """相同时间戳按 ID 去重翻页，新任务插入不改变剩余页边界。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            service, queries = TaskService(db), TaskQueries(db)
            tasks = [await service.submit(kind="text_chat", snapshot={"large_input": "x" * 10000},
                                          target_type="experiment_session", target_id="a") for _ in range(5)]
            old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
            for task in tasks:
                task.created_at = old
                await service.request_cancel(task.id)
            await db.commit()
            first = await queries.list(limit=2)
            assert first.next_cursor
            newest = await service.submit(kind="text_chat", snapshot={})
            await db.commit()
            ids = [item.task_id for item in first.items]
            cursor = first.next_cursor
            while cursor:
                page = await queries.list(limit=2, cursor=cursor)
                ids.extend(item.task_id for item in page.items)
                cursor = page.next_cursor
            assert len(ids) == len(set(ids)) == 5
            assert set(ids) == {task.id for task in tasks}
            assert newest.id not in ids
            matching = await queries.list(statuses=["cancelled"], target_type="experiment_session", target_id="a",
                                          created_from=old, created_before=old + timedelta(days=1))
            assert len(matching.items) == 5
            assert not (await queries.list(statuses=["failed"])).items
            with pytest.raises(HTTPException) as error:
                await queries.list(cursor="garbage")
            assert error.value.status_code == 422
            statements = []

            def record_sql(connection, cursor, statement, parameters, context, executemany):
                """捕获真实 SELECT，验证状态轮询不会载入大输入和结果。"""
                statements.append(statement)

            event.listen(engine.sync_engine, "before_cursor_execute", record_sql)
            await queries.status(tasks[0].id)
            event.remove(engine.sync_engine, "before_cursor_execute", record_sql)
            assert len(statements) == 1
            assert "input_snapshot" not in statements[0] and "tasks.result" not in statements[0]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_failed_partial_output_and_message_status_are_derived():
    """错误消息的旧副本不能覆盖 Task，删除文件字节不抹除输出历史。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            service = TaskService(db)
            task = await service.submit(kind="image_generation", snapshot={"operation_input": {"count": 2}},
                                        target_type="experiment_session", target_id="session")
            await service.claim(task.id, worker_id="worker")
            file = FileItem(id="file", name="image", type="image", storage_key="file.png")
            db.add(file)
            db.add(ExperimentSession(id="session", lab_type="image"))
            await db.flush()
            await service.add_output(task.id, ordinal=0, file_id=file.id)
            await service.finish(task.id, error_code="download_failed", error="second output unavailable")
            message = ExperimentMessage(id="message", session_id="session", sequence=1, role="task",
                                        task_id=task.id, status="succeeded", payload={"modality": "image", "result": "stale"})
            db.add(message)
            file.deleted_at = datetime.now(UTC).replace(tzinfo=None)
            await db.commit()
            view = await TaskQueries(db).result(task.id)
            assert view.status == "failed" and len(view.outputs) == 1
            assert view.outputs[0].deleted
            assert view.generation_delivery.outcome == "failed"
            projected = (await read_experiment_messages(db, [message]))[0]
            assert projected.status == "failed"
            assert projected.payload["error"] == "second output unavailable"
            assert projected.payload["result"]["primary_file_id"] == "file"
            assert message.status == "succeeded"  # 读投影不写消息，也不信任消息中的旧状态。
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_task_api_reads_and_cancels_through_single_service():
    """真实路由使用隔离数据库，验证取消结果、历史查询和已移除的关联接口。"""
    import httpx
    from app.dependencies import get_db
    from app.main import app

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def test_db():
        """每个 API 请求使用独立事务，不接触开发数据库。"""
        async with sessions() as db:
            yield db
            await db.commit()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = test_db
    try:
        async with sessions() as db:
            task = await TaskService(db).submit(kind="text_chat", snapshot={})
            await db.commit()
            task_id = task.id
            running = await TaskService(db).submit(kind="text_chat", snapshot={})
            await TaskService(db).claim(running.id, worker_id="worker")
            media = await TaskService(db).submit(kind="image_generation", snapshot={})
            await TaskService(db).claim(media.id, worker_id="worker")
            db.add(FileItem(id="api-output", type="image", name="output", storage_key="api-output"))
            await db.flush()
            await TaskService(db).add_output(media.id, ordinal=0, file_id="api-output")
            await TaskService(db).finish(media.id)
            await db.commit()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            cancelled = await client.post(f"/api/v1/film/tasks/{task_id}/cancel", json={"reason": "test"})
            assert cancelled.status_code == 200
            assert cancelled.json()["data"]["effective_immediately"]
            response = await client.get("/api/v1/film/tasks", params={"statuses": "cancelled"})
            assert response.status_code == 200
            assert response.json()["data"]["items"][0]["task_id"] == task_id
            assert (await client.get("/api/v1/film/task-links")).status_code == 404
            for endpoint in ("status", "result"):
                missing = await client.get(f"/api/v1/film/tasks/missing/{endpoint}")
                assert missing.status_code == 404
                assert missing.json() == {"code": 404, "message": "Task not found", "data": None, "meta": None}
            status = (await client.get(f"/api/v1/film/tasks/{running.id}/status")).json()["data"]
            assert status["status"] == "running" and status["started_at_ts"] is not None
            assert status["finished_at_ts"] is None and status["elapsed_ms"] >= 0
            response = await client.post(f"/api/v1/film/tasks/{running.id}/cancel", json={"reason": "test"})
            assert response.status_code == 200
            cancellation = response.json()["data"]
            assert cancellation["status"] == "running" and cancellation["cancel_requested"]
            assert not cancellation["effective_immediately"]
            result = (await client.get(f"/api/v1/film/tasks/{media.id}/result")).json()["data"]
            assert result["status"] == "succeeded" and result["progress"] == 100
            assert result["finished_at_ts"] is not None
            assert result["generation_delivery"]["primary_file_id"] == "api-output"
            assert result["outputs"][0]["file_id"] == "api-output"
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
        await engine.dispose()
