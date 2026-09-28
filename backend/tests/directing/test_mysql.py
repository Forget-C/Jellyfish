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
from app.models.directing import DirectingRevision, Take
from app.models.task import Task
from app.models.studio import Project, Chapter, FileItem
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.directing.production import ProductionService
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
                assert sync.scalar(text("SELECT version_num FROM alembic_version")) == "a1c4e7b9d205"
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
        async def confirm_cut():
            """同一个采用草稿并发确认只有一个胜者，当前采用指针与确认原子写入。"""
            async with sessions.begin() as db:
                try:
                    await DirectingStore(db, "p1").confirm_revision(cut.id, expected_version=1, actor_id="author")
                    return "confirmed"
                except RevisionConflict:
                    return "conflict"

        assert sorted(await asyncio.gather(confirm_cut(), confirm_cut())) == ["confirmed", "conflict"]
        from copy import deepcopy
        from app.core.contracts.directing.batch import BatchPrepare
        from app.core.contracts.directing.common import ROLES
        from app.models.llm import Model, Provider
        from app.services.directing.batch import BatchService
        from tests.directing.test_store import frozen
        async with sessions.begin() as db:
            service = BatchService(db, "p1")
            assert (await service.active_cut(sequence_id)).id == cut.id
            db.add(Provider(id="provider1", name="OpenAI", base_url="https://example.invalid/v1", api_key="test-only", status="active"))
            await db.flush()
            db.add(Model(id="model1", name="sora-test", category="video", provider_id="provider1", params={}))
            await db.flush()
            data = deepcopy((await service.revision(plan_id)).payload)
            for unit in data["units"]:
                unit["coverage"] = unit["coverage"][:1]
                unit["model_id"] = "model1"
                for reference in unit["references"]:
                    reference["input_role"] = "first_frame"
            production = await frozen(service, sequence_id, "plan", data)
            items = []
            for unit in data["units"]:
                prompt = await service.compile_unit(sequence_id, production.id, unit["id"])
                coverage = unit["coverage"][0]
                review = await frozen(service, sequence_id, "review", {"mode": "formal", "roles": list(ROLES), "context": {},
                    "occurrences": [{"id": "o1", "prompt_revision_id": prompt.id, "plan_revision_id": production.id,
                        "unit_id": unit["id"], "coverage_item_id": coverage["id"], "shot_id": coverage["shot_id"], "local_number": 1}],
                    "rows": [{"role": role, "occurrence_id": "o1", "verdict": "pass", "rationale": "离线审查", "findings": []} for role in ROLES]})
                items.append({"prompt_revision_id": prompt.id, "review_revision_id": review.id})
            batch = await service.prepare_batch(sequence_id, BatchPrepare(items=items))
            assert [item.status for item in batch.items] == ["ready", "ready"]

        async def accept_batch():
            """重复并发确认同批，等待原事务并返回完全相同的任务身份。"""
            async with sessions.begin() as db:
                result = await BatchService(db, "p1").submit_batch(sequence_id, batch.id, expected_version=1)
                return [item.task_id for item in result.items]

        accepted = await asyncio.gather(accept_batch(), accept_batch())
        assert accepted[0] == accepted[1] and len(set(accepted[0])) == 2 and all(accepted[0])
        async with sessions.begin() as db:
            packet = (await DirectingStore(db, "p1").revision(items[0]["review_revision_id"])).payload
            db.add(Task(id="review-concurrent", kind="directing_review", status="succeeded", project_id="p1",
                        target_type="directing_sequence", target_id=sequence_id,
                        input_snapshot={"run_args": {"packet": packet}}, result=packet))

        async def apply_review():
            """同一检查在两个独立连接并发保存，均返回唯一的原始版本。"""
            async with sessions.begin() as db:
                row = await ProductionService(db, "p1").apply_review(sequence_id, "review-concurrent")
                return row.id

        applied = await asyncio.gather(apply_review(), apply_review())
        assert applied[0] == applied[1]
        from app.core.contracts.directing.workspace import ReviewRequest
        async with sessions.begin() as db:
            db.add(Model(id="text-recovery", name="qwen-test", category="text", provider_id="provider1"))
        recovery_sessions = async_sessionmaker(engine.execution_options(isolation_level="REPEATABLE READ"), expire_on_commit=False)

        async def compile_same_request():
            """默认重复读隔离级别下，场次锁与当前读共同恢复同一编译结果。"""
            async with recovery_sessions.begin() as db:
                row = await ProductionService(db, "p1").compile_unit(sequence_id, production.id, data["units"][0]["id"], request_id="compile-concurrent")
                return row.id

        compiled = await asyncio.gather(compile_same_request(), compile_same_request())
        assert compiled[0] == compiled[1]

        async def submit_same_review():
            """检查受理使用冻结请求身份，两个连接仅创建一项模型任务。"""
            async with recovery_sessions.begin() as db:
                row = await ProductionService(db, "p1").submit_review(sequence_id, compiled[0],
                    ReviewRequest(model_id="text-recovery", request_id="check-concurrent"))
                return row.id

        checked = await asyncio.gather(submit_same_review(), submit_same_review())
        assert checked[0] == checked[1]
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(DirectingRevision).where(DirectingRevision.source_task_id == "review-concurrent")) == 1
            assert await db.scalar(select(func.count()).select_from(Task).where(
                Task.input_snapshot["review_request_id"].as_string() == "check-concurrent")) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_mysql_feedback_confirmation_race():
    """真实多连接下采用替换与验收竞争，不允许旧采用结论冒充当前结论。"""
    from app.models.directing import Sequence
    from app.services.directing.feedback import FeedbackService
    from tests.directing.test_feedback import review
    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('Only an isolated directing validation database is allowed')
    engine = create_async_engine(value, isolation_level='READ COMMITTED')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions.begin() as db:
            sid = await db.scalar(select(Sequence.id).where(Sequence.chapter_id == 'ch1').order_by(Sequence.position))
            service = FeedbackService(db, 'p1')
            cut = await service.active_cut(sid)
            older = await service.save_revision(sid, kind='cut_review', payload=review(cut.id))
            newer = await service.save_revision(sid, kind='cut_review', payload=review(cut.id))
            await service.confirm_revision(newer.id, expected_version=1, actor_id='author')
            await service.confirm_revision(older.id, expected_version=1, actor_id='author')
            assert (await service.feedback(sid)).current_review_id == older.id
            replacement = await service.save_revision(sid, kind='cut', payload=cut.payload, parent_id=cut.id)
            racing = await service.save_revision(sid, kind='cut_review', payload=review(cut.id))
        async def confirm(identity):
            """两项均从同一版本开始，各自独立事务并争用相同场次锁。"""
            async with sessions.begin() as db:
                try:
                    await FeedbackService(db, 'p1').confirm_revision(identity, expected_version=1, actor_id='author')
                    return 'confirmed'
                except RevisionConflict:
                    return 'conflict'
        results = await asyncio.gather(confirm(racing.id), confirm(replacement.id))
        assert results[1] == 'confirmed'
        async with sessions() as db:
            state = await FeedbackService(db, 'p1').feedback(sid)
            assert state.active_cut_revision_id == replacement.id and state.current_review_id is None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_mysql_compile_response_contains_recovered_prompt():
    """两个真实事务并发调用编译路由，恢复响应也必须携带精确版本正文。"""
    from app.api.v1.routes.studio.directing import compile_unit
    from app.core.contracts.directing.workspace import CompileRequest
    from app.models.directing import DirectingAction
    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('Only an isolated directing validation database is allowed')
    engine = create_async_engine(value, isolation_level='REPEATABLE READ')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            action = await db.scalar(select(DirectingAction).where(DirectingAction.request_id == 'compile-concurrent'))
            prompt = await ProductionService(db, 'p1').revision(action.revision_id)
            sequence_id, plan_id, unit_id = action.sequence_id, prompt.payload['plan_revision_id'], action.unit_id

        async def compile_response():
            """验证路由响应而不只验证服务返回的数据库行。"""
            async with sessions.begin() as db:
                response = await compile_unit('p1', sequence_id, CompileRequest(plan_revision_id=plan_id, unit_id=unit_id, request_id='compile-response'), db)
                result = response.data
                assert any(row.id == result.compiled_prompt_revision_id for row in result.prompts)
                return result.compiled_prompt_revision_id

        responses = await asyncio.gather(compile_response(), compile_response())
        assert responses[0] == responses[1]

        barrier = asyncio.Barrier(2)
        async def create_numbered_prompt():
            """先建立旧快照再并发追加，编号必须读取最新已提交的分配结果。"""
            async with sessions.begin() as db:
                service = ProductionService(db, 'p1')
                source = await service.read_revision(prompt.id)
                await barrier.wait()
                row = await service.save_revision(sequence_id, kind='prompt', payload=source.content.model_dump(mode='json'))
                return row.display_number

        numbers = await asyncio.gather(create_numbered_prompt(), create_numbered_prompt())
        assert len(set(numbers)) == 2 and max(numbers) - min(numbers) == 1

        async with sessions.begin() as db:
            await output(db, prompt.id, task_id='numbered-take-a')
            await output(db, prompt.id, task_id='numbered-take-b')
        barrier = asyncio.Barrier(2)
        async def create_numbered_take(task_id):
            """候选在旧事务快照下并发登记也不复用编号，重放仍返回原身份。"""
            async with sessions.begin() as db:
                await db.scalar(select(func.count()).select_from(Take))
                await barrier.wait()
                service = ProductionService(db, 'p1')
                row = await service.register_take(prompt_revision_id=prompt.id, task_id=task_id, output_ordinal=0)
                replay = await service.register_take(prompt_revision_id=prompt.id, task_id=task_id, output_ordinal=0)
                assert replay.id == row.id and replay.display_number == row.display_number
                return row.display_number

        numbers = await asyncio.gather(create_numbered_take('numbered-take-a'), create_numbered_take('numbered-take-b'))
        assert len(set(numbers)) == 2 and max(numbers) - min(numbers) == 1
    finally:
        await engine.dispose()
