"""显式连接隔离 MySQL 验证迁移与行锁；不调用供应商或访问对象存储。"""

import asyncio
import os
import re
from uuid import uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Boolean, CheckConstraint, Integer, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.task import Task
from app.services.task_service import TaskService

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def isolated_database_url():
    """只接受显式指定的测试库，防止误用应用配置指向开发或生产库。"""
    value = os.environ.get("JELLYFISH_TEST_MYSQL_URL")
    if not value:
        pytest.skip("JELLYFISH_TEST_MYSQL_URL is required for isolated MySQL checks")
    url = make_url(value)
    if url.get_backend_name() != "mysql" or not (url.database or "").startswith("jellyfish_check"):
        raise ValueError("MySQL checks require a database named jellyfish_check...")
    return value


async def test_migrated_mysql_schema_matches_application_models():
    """Check the deployed baseline's table set, types, defaults and relational constraints."""
    engine = create_async_engine(isolated_database_url())
    try:
        async with engine.connect() as db:
            def compare(connection):
                schema = inspect(connection)
                assert set(schema.get_table_names()) == {*Base.metadata.tables, "alembic_version"}

                def unwrap(value):
                    while value.startswith("(") and value.endswith(")"):
                        value = value[1:-1]
                    return value

                def normalized_default(value, column_type):
                    if value is None:
                        return None
                    value = unwrap(value)
                    if match := re.fullmatch(r"(?:current_timestamp|now)(?:\((\d*)\))?", value, re.IGNORECASE):
                        return f"current_timestamp({match[1] or '0'})"
                    value = value.removeprefix("_utf8mb4")
                    if isinstance(column_type, (Boolean, Integer)):
                        value = value.strip("'")
                        if value.casefold() == "false":
                            return "0"
                    return value

                compiler = connection.dialect.ddl_compiler(connection.dialect, None)
                context = MigrationContext.configure(connection, opts={"compare_type": True})
                assert not compare_metadata(context, Base.metadata)
                for table in Base.metadata.tables.values():
                    assert schema.get_pk_constraint(table.name)["constrained_columns"] == list(table.primary_key.columns.keys())
                    expected = {constraint.name for constraint in table.constraints if isinstance(constraint, CheckConstraint)}
                    assert {constraint["name"] for constraint in schema.get_check_constraints(table.name)} == expected
                    columns = {item["name"]: item for item in schema.get_columns(table.name)}
                    for column in table.columns:
                        reflected = columns[column.name]
                        label = (table.name, column.name)
                        if precision := getattr(column.type.dialect_impl(connection.dialect), "fsp", None):
                            assert reflected["type"].fsp == precision, label
                        if column.computed is None:
                            actual = normalized_default(reflected["default"], column.type)
                            expected = normalized_default(compiler.get_column_default_string(column), column.type)
                            assert actual == expected, label
                        else:
                            computed = reflected["computed"]
                            assert computed["persisted"] is column.computed.persisted, label
                            actual = re.sub(r"_utf8mb4|[\s`]", "", unwrap(computed["sqltext"]).casefold())
                            expected = re.sub(r"[\s`]", "", column.computed.sqltext.text.casefold())
                            assert actual == expected, label

            await db.run_sync(compare)
            scripts = ScriptDirectory.from_config(Config("alembic.ini"))
            assert (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one() == scripts.get_current_head()
    finally:
        await engine.dispose()


async def test_mysql_claim_and_finish_are_serialized():
    """多个真实连接竞争领取和终态时，只有一次领取及一次业务交付。"""
    engine = create_async_engine(isolated_database_url())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions.begin() as db:
            task_id = (await TaskService(db).submit(kind="text_chat", snapshot={})).id

        async def claim():
            """每个竞争者使用独立连接和事务。"""
            async with sessions.begin() as db:
                return await TaskService(db).claim(task_id, worker_id=uuid4().hex)

        assert sum(await asyncio.gather(*(claim() for _ in range(4)))) == 1
        deliveries = []

        async def finish(value):
            """行锁保护的回调只能执行一次，后到达的完成请求读取同一终态。"""
            async def deliver(db, task):
                """用回调次数观察业务交付是否被重复调用。"""
                deliveries.append(value)
            async with sessions.begin() as db:
                task = await TaskService(db).finish(task_id, result={"winner": value}, deliver=deliver)
                return task.result

        results = await asyncio.gather(*(finish(value) for value in range(4)))
        assert len(deliveries) == 1
        assert all(result == {"winner": deliveries[0]} for result in results)
        async with sessions.begin() as db:
            await TaskService(db).finish(task_id, error_code="late_failure", error="must not overwrite")
            await TaskService(db).request_cancel(task_id)
        async with sessions() as db:
            task = await db.get(Task, task_id)
            assert task.status == "succeeded" and task.cancel_requested_at is None
    finally:
        await engine.dispose()


async def test_file_delete_sees_reference_committed_after_earlier_read(monkeypatch):
    """删除事务先有普通查询时，也必须看到另一事务刚提交的活动任务引用。"""
    from fastapi import HTTPException
    from app.config import settings
    from app.core.db import _build_engine
    from app.models.studio_prompts_files_timeline import FileItem
    from app.models.task import TaskInput
    from app.services.studio.files import delete_file
    from sqlalchemy import select

    monkeypatch.setattr(settings, "database_url", isolated_database_url())
    engine = _build_engine()
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    file_id = uuid4().hex
    try:
        async with sessions.begin() as db:
            db.add(FileItem(id=file_id, name="reference", type="image", storage_key=f"files/{file_id}"))
        async with sessions() as deleting:
            # 提前建立事务读视图，覆盖业务请求已经查询过其他数据的真实路径。
            assert not list(await deleting.scalars(select(TaskInput).where(TaskInput.file_id == file_id)))
            async with sessions.begin() as writer:
                await TaskService(writer).submit(kind="text_chat", snapshot={}, inputs=[("reference", 0, file_id)])
            with pytest.raises(HTTPException) as error:
                await delete_file(deleting, file_id=file_id)
            assert error.value.status_code == 409
            await deleting.rollback()
        async with sessions() as db:
            assert (await db.get(FileItem, file_id)).delete_requested_at is None
    finally:
        await engine.dispose()
