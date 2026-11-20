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
                assert sync.scalar(text("SELECT version_num FROM alembic_version")) == "c3e7f9a1b524"
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


@pytest.mark.asyncio
@pytest.mark.integration
@pytest.mark.parametrize('isolation', ['READ COMMITTED', 'REPEATABLE READ'])
async def test_mysql_concurrent_source_ranges(isolation):
    """两连接先建立读取快照，再竞争相交范围；章节锁和当前读只允许一方写入。"""
    from uuid import uuid4
    from app.core.contracts.directing.workspace import SequenceCreate, SourceSpan
    from app.services.directing.workspace import WorkspaceService

    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('only an isolated directing validation database is allowed')
    engine = create_async_engine(value, isolation_level=isolation)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    project_id, chapter_id = f'p{uuid4().hex}', f'ch{uuid4().hex}'
    barrier = asyncio.Barrier(2)
    try:
        async with sessions.begin() as db:
            db.add(Project(id=project_id, name='范围并发测试', style='真人都市'))
            await db.flush()
            db.add(Chapter(id=chapter_id, project_id=project_id, index=1, title='章节', raw_text='她😀推门。第二场结束。'))
        async def create(position):
            async with sessions.begin() as db:
                service = WorkspaceService(db, project_id)
                chapter = await service.list_sequences(chapter_id)
                await barrier.wait()
                try:
                    await service.write_sequence(chapter_id, SequenceCreate(title=f'竞争{position}', position=position,
                        source_version=chapter.source_version, span=SourceSpan(start=position, end=5 + position)))
                    return 'saved'
                except RevisionConflict:
                    return 'conflict'
        assert sorted(await asyncio.wait_for(asyncio.gather(create(0), create(1)), 15)) == ['conflict', 'saved']
        async with sessions.begin() as db:
            assert len((await WorkspaceService(db, project_id).list_sequences(chapter_id)).sequences) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.integration
@pytest.mark.parametrize('isolation', ['READ COMMITTED', 'REPEATABLE READ'])
async def test_mysql_atomic_division_competition(isolation):
    """独立连接的旧快照、整章竞争、同请求重放及单场竞争均不能覆盖已提交版本。"""
    from uuid import uuid4
    from app.core.contracts.directing.division import DivisionDraft, DivisionSave
    from app.core.contracts.directing.workspace import SequenceUpdate
    from app.services.directing.division import DivisionService
    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('only an isolated directing validation database is allowed')
    engine = create_async_engine(value, isolation_level=isolation)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    project_id, chapter_id = 'p-' + uuid4().hex, 'ch-' + uuid4().hex
    try:
        async with sessions.begin() as db:
            db.add(Project(id=project_id, name='整章并发', style='真人'))
            await db.flush()
            db.add(Chapter(id=chapter_id, project_id=project_id, index=1, title='章节', raw_text='前场😀后场。'))
        async with sessions.begin() as db:
            service = DivisionService(db, project_id)
            chapter = await service.list_sequences(chapter_id)
            draft = DivisionDraft(source_version=chapter.source_version, baseline=[], members=[
                {'key': 'a', 'title': '前场', 'span': {'start': 0, 'end': 3}},
                {'key': 'b', 'title': '后场', 'span': {'start': 3, 'end': 6}}], lineage=[], exited_sequence_ids=[])
            preview = await service.preview_division(chapter_id, draft)
            body = DivisionSave(request_id='first', draft=draft, preview_token=preview.preview_token)
        async def submit(body):
            async with sessions.begin() as db:
                try:
                    return await DivisionService(db, project_id).save_division(chapter_id, body)
                except RevisionConflict:
                    return 'conflict'
        results = await asyncio.gather(submit(body), submit(body))
        assert results[0] == results[1] and results[0] != 'conflict'
        rows = results[0].chapter.sequences
        def make_draft():
            return DivisionDraft(source_version=draft.source_version,
                baseline=[{'sequence_id': row.id, 'version': row.version} for row in rows],
                members=[{'key': row.id, 'sequence_id': row.id, 'title': row.title, 'span': row.span} for row in rows],
                lineage=[{'sequence_id': row.id, 'target_keys': [row.id]} for row in rows], exited_sequence_ids=[])
        left, right = make_draft(), make_draft()
        left.members[0].span.end = 4
        left.members[1].span.start = 4
        right.members.reverse()
        async with sessions.begin() as db:
            service = DivisionService(db, project_id)
            left_preview = await service.preview_division(chapter_id, left)
            right_preview = await service.preview_division(chapter_id, right)
        responses = await asyncio.gather(
            submit(DivisionSave(request_id='left', draft=left, preview_token=left_preview.preview_token)),
            submit(DivisionSave(request_id='right', draft=right, preview_token=right_preview.preview_token)))
        assert sum(response == 'conflict' for response in responses) == 1
        rows = next(response.chapter.sequences for response in responses if response != 'conflict')
        # 在独立事务中预先建立快照，然后提交另一连接的单场改名。
        async with sessions.begin() as stale_db:
            stale = DivisionService(stale_db, project_id)
            await stale.list_sequences(chapter_id)
            pending = make_draft()
            pending.members[0].title = '旧页面的名称'
            preview = await stale.preview_division(chapter_id, pending)
            await stale_db.commit()
        async with sessions.begin() as stale_db:
            stale = DivisionService(stale_db, project_id)
            await stale.list_sequences(chapter_id)
            async with sessions.begin() as db:
                await DivisionService(db, project_id).write_sequence(chapter_id,
                    SequenceUpdate(title='另一编辑者', position=rows[0].position, expected_version=rows[0].version,
                                   source_version=draft.source_version), rows[0].id)
            with pytest.raises(RevisionConflict, match='集合'):
                await stale.save_division(chapter_id, DivisionSave(request_id='stale', draft=pending, preview_token=preview.preview_token))
        async with sessions.begin() as db:
            latest = await DivisionService(db, project_id).list_sequences(chapter_id)
            assert latest.sequences[0].title == '另一编辑者'
            assert latest.sequences[1].id == rows[1].id
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_mysql_division_migration_preserves_populated_history():
    """在隔离库已有设计、素材、采用及引用上往返结构升级，逐字段核对旧数据。"""
    from alembic.operations import Operations
    from tests.directing.test_migration import revision_module
    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('only an isolated directing validation database is allowed')
    engine = create_async_engine(value)
    try:
        async with engine.begin() as connection:
            def verify(sync):
                migration = revision_module('b2d6e8f0a413_add_chapter_division_membership.py')
                migration.op = Operations(MigrationContext.configure(sync))
                migration.downgrade()
                tables = [table for table in Base.metadata.sorted_tables if table.name.startswith('directing_') and table.name != 'directing_division_commits']
                def snapshot():
                    result = {}
                    for table in tables:
                        columns = [column for column in table.c if column.name not in ('is_current', 'current_position')]
                        result[table.name] = sync.execute(select(*columns).order_by(*table.primary_key.columns)).mappings().all()
                    return result
                before = snapshot()
                # 本文件前置主流程生成真实业务成果，避免空表通过数据保留检查。
                for name in ('directing_sequences', 'directing_revisions', 'directing_takes', 'directing_active_cuts', 'directing_revision_dependencies'):
                    assert before[name], name
                migration.upgrade()
                assert snapshot() == before
                assert sync.scalar(text('SELECT COUNT(*) FROM directing_sequences WHERE is_current != 1 OR current_position != position')) == 0
                assert sync.scalar(text('SELECT COUNT(*) FROM directing_division_commits')) == 0
            await connection.run_sync(verify)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.integration
@pytest.mark.parametrize('isolation', ['READ COMMITTED', 'REPEATABLE READ'])
async def test_mysql_division_later_failure_rolls_back(isolation):
    """后续 SQL 失败后提交外层事务，仍不得留下改名、临时顺序、新身份或回执。"""
    from uuid import uuid4
    from sqlalchemy import event
    from app.core.contracts.directing.division import DivisionDraft, DivisionSave
    from app.models.directing import DivisionCommit, Sequence
    from app.services.directing.division import DivisionService
    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('only an isolated directing validation database is allowed')
    engine = create_async_engine(value, isolation_level=isolation)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    project_id, chapter_id = 'p-' + uuid4().hex, 'ch-' + uuid4().hex
    try:
        async with sessions.begin() as db:
            db.add(Project(id=project_id, name='失败回滚', style='真人'))
            await db.flush()
            db.add(Chapter(id=chapter_id, project_id=project_id, index=1, title='章节', raw_text='前场后场终场'))
            await db.flush()
            service = DivisionService(db, project_id)
            chapter = await service.list_sequences(chapter_id)
            draft = DivisionDraft(source_version=chapter.source_version, baseline=[], members=[
                {'key': 'a', 'title': '前场', 'span': {'start': 0, 'end': 2}},
                {'key': 'b', 'title': '后场', 'span': {'start': 2, 'end': 4}}], lineage=[], exited_sequence_ids=[])
            preview = await service.preview_division(chapter_id, draft)
            before = (await service.save_division(chapter_id, DivisionSave(request_id='initial', draft=draft, preview_token=preview.preview_token))).chapter
        async with sessions.begin() as db:
            service = DivisionService(db, project_id)
            rows = before.sequences
            draft = DivisionDraft(source_version=before.source_version,
                baseline=[{'sequence_id': row.id, 'version': row.version} for row in rows],
                members=[{'key': 'new', 'title': '终场', 'span': {'start': 4, 'end': 6}},
                         *[{'key': row.id, 'sequence_id': row.id, 'title': '调整' + row.title, 'span': row.span} for row in reversed(rows)]],
                lineage=[{'sequence_id': row.id, 'target_keys': [row.id]} for row in rows], exited_sequence_ids=[])
            preview = await service.preview_division(chapter_id, draft)
            writes = []
            def fail_receipt(connection, cursor, statement, parameters, context, executemany):
                if statement.startswith(('INSERT INTO directing_sequences', 'UPDATE directing_sequences')):
                    writes.append(statement)
                if statement.startswith('INSERT INTO directing_division_commits'):
                    raise RuntimeError('receipt storage failed')
            event.listen(engine.sync_engine, 'before_cursor_execute', fail_receipt)
            try:
                with pytest.raises(RuntimeError, match='receipt storage failed'):
                    await service.save_division(chapter_id, DivisionSave(request_id='failed', draft=draft, preview_token=preview.preview_token))
            finally:
                event.remove(engine.sync_engine, 'before_cursor_execute', fail_receipt)
            assert len(writes) >= 4
        # 新连接验证，外层事务已正常提交，不能靠测试清理事务掩盖半成功。
        async with sessions.begin() as db:
            service = DivisionService(db, project_id)
            assert await service.list_sequences(chapter_id) == before
            assert await db.scalar(select(func.count()).select_from(Sequence).where(Sequence.chapter_id == chapter_id)) == 2
            assert await db.get(DivisionCommit, (chapter_id, 'failed')) is None
            saved = await service.save_division(chapter_id, DivisionSave(request_id='failed', draft=draft, preview_token=preview.preview_token))
            assert len(saved.chapter.sequences) == 3
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_mysql_version_migration_with_existing_production_data():
    """有快照时拒绝降级；从前序结构升级不会改写已有成果和回执。"""
    from alembic.operations import Operations
    from tests.directing.test_migration import revision_module
    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('only an isolated directing validation database is allowed')
    engine = create_async_engine(value)
    try:
        async with engine.begin() as connection:
            def verify(sync):
                from app.models.directing import DivisionVersion
                migration = revision_module('c3e7f9a1b524_add_chapter_division_versions.py')
                migration.op = Operations(MigrationContext.configure(sync))
                with pytest.raises(RuntimeError):
                    migration.downgrade()
                # 仅重置隔离测试库的新版本夹具，模拟升级前仍有真实旧生产记录的状态。
                sync.execute(text('DELETE FROM directing_division_heads'))
                for identity in sync.scalars(select(DivisionVersion.id).order_by(DivisionVersion.number.desc())).all():
                    sync.execute(text('DELETE FROM directing_division_versions WHERE id=:id'), {'id': identity})
                migration.downgrade()
                tables = [table for table in Base.metadata.sorted_tables if table.name.startswith('directing_')
                    and table.name not in ('directing_division_versions', 'directing_division_heads')]
                def snapshot():
                    return {table.name: sync.execute(select(table).order_by(*table.primary_key.columns)).mappings().all() for table in tables}
                before = snapshot()
                assert before['directing_revisions'] and before['directing_takes'] and before['directing_division_commits']
                migration.upgrade()
                assert snapshot() == before
                assert sync.scalar(text('SELECT COUNT(*) FROM directing_division_versions')) == 0
            await connection.run_sync(verify)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.integration
@pytest.mark.parametrize('isolation', ['READ COMMITTED', 'REPEATABLE READ'])
async def test_mysql_restore_replay_and_competing_edit(isolation):
    """恢复重放同一版本；恢复与普通编辑争用章节锁，不倒退历史对象版本。"""
    from uuid import uuid4
    from app.core.contracts.directing.division import DivisionDraft, DivisionSave
    from app.models.directing import DivisionVersion, Sequence
    from app.services.directing.division import DivisionService
    value = os.environ.get('JELLYFISH_DIRECTING_MYSQL_URL')
    if not value:
        pytest.skip('JELLYFISH_DIRECTING_MYSQL_URL required')
    url = make_url(value)
    if url.get_backend_name() != 'mysql' or not (url.database or '').startswith('jellyfish_check_directing'):
        raise ValueError('only an isolated directing validation database is allowed')
    engine = create_async_engine(value, isolation_level=isolation)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    project_id, chapter_id = 'p-' + uuid4().hex, 'ch-' + uuid4().hex
    async def make_request(db, draft, request_id):
        preview = await DivisionService(db, project_id).preview_division(chapter_id, draft)
        return DivisionSave(request_id=request_id, draft=draft, preview_token=preview.preview_token, identity_changes_confirmed=True)
    try:
        async with sessions.begin() as db:
            db.add(Project(id=project_id, name='历史恢复竞争', style='真人'))
            await db.flush()
            db.add(Chapter(id=chapter_id, project_id=project_id, index=1, title='章节', raw_text='甲乙丙丁'))
            await db.flush()
            service = DivisionService(db, project_id)
            chapter = await service.list_sequences(chapter_id)
            draft = DivisionDraft(source_version=chapter.source_version, baseline=[], members=[
                {'key': 'a', 'title': '前场', 'span': {'start': 0, 'end': 2}},
                {'key': 'b', 'title': '后场', 'span': {'start': 2, 'end': 4}}], exited_sequence_ids=[], lineage=[])
            original = (await service.save_division(chapter_id, await make_request(db, draft, 'initial'))).chapter
        async def retire_and_restore_request(request_id):
            async with sessions.begin() as db:
                service = DivisionService(db, project_id)
                current = await service.list_sequences(chapter_id)
                first, second = current.sequences
                retired = DivisionDraft(source_version=current.source_version,
                    baseline=[{'sequence_id': row.id, 'version': row.version} for row in current.sequences],
                    members=[{'key': second.id, 'sequence_id': second.id, 'title': second.title, 'span': second.span}],
                    exited_sequence_ids=[first.id], lineage=[{'sequence_id': first.id, 'target_keys': []}, {'sequence_id': second.id, 'target_keys': [second.id]}])
                latest = (await service.save_division(chapter_id, await make_request(db, retired, request_id + '-retire'))).chapter
                old = await db.get(Sequence, first.id, populate_existing=True)
                restore = DivisionDraft(source_version=latest.source_version, source_revision_id=original.current_version.id,
                    baseline=[{'sequence_id': row.id, 'version': row.version} for row in latest.sequences],
                    members=[{'key': row.id, 'sequence_id': row.id, 'title': row.title, 'span': row.span} for row in original.sequences],
                    restored_baseline=[{'sequence_id': first.id, 'version': old.version}], exited_sequence_ids=[],
                    lineage=[{'sequence_id': second.id, 'target_keys': [second.id]}])
                return await make_request(db, restore, request_id), latest
        body, _ = await retire_and_restore_request('restore-1')
        async def submit(body, barrier):
            async with sessions.begin() as db:
                service = DivisionService(db, project_id)
                await service.list_sequences(chapter_id)
                await barrier.wait()
                try:
                    return await service.save_division(chapter_id, body)
                except RevisionConflict:
                    return 'conflict'
        barrier = asyncio.Barrier(2)
        replay = await asyncio.wait_for(asyncio.gather(submit(body, barrier), submit(body, barrier)), 15)
        assert replay[0] == replay[1] and replay[0] != 'conflict'
        assert replay[0].chapter.current_version.number == 3
        assert replay[0].chapter.sequences[0].version == 3
        restore, latest = await retire_and_restore_request('restore-2')
        async with sessions.begin() as db:
            row = latest.sequences[0]
            rename = DivisionDraft(source_version=latest.source_version,
                baseline=[{'sequence_id': row.id, 'version': row.version}],
                members=[{'key': row.id, 'sequence_id': row.id, 'title': '并发改名', 'span': row.span}],
                exited_sequence_ids=[], lineage=[{'sequence_id': row.id, 'target_keys': [row.id]}])
            competing = await make_request(db, rename, 'rename')
        barrier = asyncio.Barrier(2)
        results = await asyncio.wait_for(asyncio.gather(submit(restore, barrier), submit(competing, barrier)), 15)
        assert sum(row == 'conflict' for row in results) == 1
        async with sessions.begin() as db:
            numbers = list(await db.scalars(select(DivisionVersion.number).where(DivisionVersion.chapter_id == chapter_id).order_by(DivisionVersion.number)))
            assert numbers == [1, 2, 3, 4, 5]
            current = await DivisionService(db, project_id).list_sequences(chapter_id)
            assert current.current_version.number == 5
            assert (await db.get(Sequence, original.sequences[0].id)).version >= 4
    finally:
        await engine.dispose()
