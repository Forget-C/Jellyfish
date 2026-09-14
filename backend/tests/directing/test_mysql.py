"""在显式隔离 MySQL 库检查完整迁移和真实多连接竞争。"""

import asyncio
import os

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.directing import Take
from app.models.studio import Project, Chapter, FileItem
from app.services.directing.store import DirectingStore, RevisionConflict
from tests.directing.samples import design_sample
from tests.directing.test_store import setup_story, output


@pytest.mark.asyncio
@pytest.mark.integration
async def test_mysql_schema_roundtrip_and_concurrent_writes():
    """空库迁移结果与 ORM 一致；竞争保存只有一个胜者，重复产物只有一个 Take。"""
    value = os.environ.get("JELLYFISH_DIRECTING_MYSQL_URL")
    if not value:
        pytest.skip("JELLYFISH_DIRECTING_MYSQL_URL required")
    url = make_url(value)
    if url.get_backend_name() != "mysql" or not (url.database or "").startswith("jellyfish_check_directing"):
        raise ValueError("only an isolated directing validation database is allowed")
    engine = create_async_engine(value, isolation_level="READ COMMITTED")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.connect() as connection:
            def verify(sync):
                """仅比较本阶段表，MySQL now() 显示形式不作为语义差异。"""
                context = MigrationContext.configure(sync, opts={
                    "compare_type": True,
                    "include_object": lambda obj, name, type_, reflected, compare_to: (name if type_ == "table" else obj.table.name).startswith("directing_"),
                })
                assert not compare_metadata(context, Base.metadata)
                assert sync.scalar(text("SELECT version_num FROM alembic_version")) == "46e0a3c8db14"
            await connection.run_sync(verify)
        async with sessions.begin() as db:
            db.add(Project(id="p1", name="测试", style="真人都市"))
            await db.flush()
            db.add(Chapter(id="ch1", project_id="p1", index=1, title="借钱", raw_text="兄弟在店中交谈"))
            db.add_all([FileItem(id="image1", type="image", name="空间", storage_key="files/space.png"),
                        FileItem(id="video1", type="video", name="试拍", storage_key="files/take.mp4", duration_ms=9000)])
            await db.flush()
            store, sequence_id, design_id, plan_id, prompts = await setup_story(db)
            draft = await store.save_revision(sequence_id, kind="design", payload=design_sample(), parent_id=design_id)
            draft_id = draft.id
            await output(db, prompts[0])

        async def edit(story):
            """每个编辑者都有独立连接和相同起始版本。"""
            async with sessions.begin() as db:
                try:
                    await DirectingStore(db, "p1").save_revision(sequence_id, kind="design", payload=design_sample(story), revision_id=draft_id, expected_version=1)
                    return "saved"
                except RevisionConflict:
                    return "conflict"

        assert sorted(await asyncio.gather(edit("handover"), edit("crowd"))) == ["conflict", "saved"]

        async def publish():
            """并发发布同一个成功输出，只登记一次且可重放返回相同身份。"""
            async with sessions.begin() as db:
                row = await DirectingStore(db, "p1").register_take(prompt_revision_id=prompts[0], task_id="task1", output_ordinal=0)
                return row.id

        take_ids = await asyncio.gather(publish(), publish())
        assert take_ids[0] == take_ids[1]
        async with sessions.begin() as db:
            assert await db.scalar(select(func.count()).select_from(Take)) == 1
            store = DirectingStore(db, "p1")
            snapshot = await store.read_revision(design_id)
            assert snapshot.project_id == "p1" and snapshot.confirmed_by == "author"
            assert (await store.read_take(take_ids[0])).unit_id == "u1"
            cut = await store.save_revision(sequence_id, kind="cut", payload={"items": [{"kind": "media", "id": "clip", "take_id": take_ids[0],
                "media_range": {"source_in_ms": 2000, "source_out_ms": 5000}, "timeline_start_ms": 0}]})
            assert cut.payload["items"][0]["media_range"]["source_out_ms"] == 5000
    finally:
        await engine.dispose()
