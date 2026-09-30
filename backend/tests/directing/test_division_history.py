"""历史分页和快照读取不能改变当前划分。"""

import pytest
from sqlalchemy import event

from app.models.studio import Chapter
from app.models.task import Task
from app.models.directing import DivisionVersion
from app.services.directing.division import DivisionService
from app.services.directing.division_history import DivisionHistoryService
from tests.directing.test_division import setup_two
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_history_pagination_and_frozen_detail(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            await setup_two(DivisionService(db, 'p1'))
            before = await DivisionService(db, 'p1').list_sequences('ch1')
            db.add(Task(id='pending', project_id='p1', target_type='directing_chapter', target_id='ch1',
                kind='directing_divide', status='running', progress=30, input_snapshot={'secret': 'hidden'}))
            await db.flush()
            history = DivisionHistoryService(db, 'p1')
            statements = []
            def observe(connection, cursor, statement, parameters, context, executemany):
                statements.append(statement)
            event.listen(db.bind.sync_engine, 'before_cursor_execute', observe)
            try:
                first = await history.history('ch1', page_size=2)
                second = await history.history('ch1', page=2, page_size=2)
            finally:
                event.remove(db.bind.sync_engine, 'before_cursor_execute', observe)
            assert first.total == second.total == 3
            entries = first.items + second.items
            assert len({row.id for row in entries}) == 3
            assert sum(row.is_current for row in entries) == 1
            task = next(row for row in entries if row.kind == 'analysis')
            assert task.id == 'pending' and task.number is None and task.progress == 30
            assert not any(' tasks.input_snapshot,' in sql or 'tasks.result' in sql or 'division_versions.snapshot' in sql for sql in statements)
            chapter = await db.get(Chapter, 'ch1')
            chapter.raw_text = '修改后的新原文'
            await db.flush()
            detail = await history.version_detail('ch1', before.current_version.id)
            assert detail.chapter.raw_text == before.raw_text
            assert detail.chapter.sequences == before.sequences
            assert (await history.history('ch1')).current_version == before.current_version
            with pytest.raises(ValueError, match='章节不属于'):
                await DivisionHistoryService(db, 'p2').history('ch1')
            with pytest.raises(ValueError, match='版本不属于'):
                await history.version_detail('ch1', 'missing')
            with pytest.raises(ValueError, match='分页'):
                await history.history('ch1', page_size=101)
            version = await db.get(DivisionVersion, before.current_version.id)
            version.source_task_id = 'pending'
            await db.flush()
            linked = await history.history('ch1')
            assert linked.total == 2
            assert all(row.kind == 'version' for row in linked.items)
            assert next(row for row in linked.items if row.is_current).source_task_id == 'pending'


@pytest.mark.asyncio
async def test_analysis_detail_redacts_and_reports_incomplete_history(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            await setup_two(service)
            chapter = await service.list_sequences('ch1')
            snapshot = {'division_versioning': 1, 'provider_key': 'PRIVATE', 'run_args': {
                'script_text': chapter.raw_text, 'source_version': chapter.source_version,
                'division_baseline': {row.id: row.version for row in chapter.sequences}}}
            db.add_all([Task(id='new', project_id='p1', target_type='directing_chapter', target_id='ch1',
                kind='directing_divide', status='succeeded', input_snapshot=snapshot,
                result={'scenes': [{'title': '完整方案', 'excerpt': chapter.raw_text, 'purpose': '交谈'}]}),
                Task(id='old', project_id='p1', target_type='directing_chapter', target_id='ch1',
                    kind='directing_divide', status='succeeded', input_snapshot={}, result={'invalid': 'PRIVATE'}),
                Task(id='failed', project_id='p1', target_type='directing_chapter', target_id='ch1',
                    kind='directing_divide', status='failed', error_message='PRIVATE')])
            await db.flush()
            history = DivisionHistoryService(db, 'p1')
            detail = await history.analysis_detail('ch1', 'new')
            assert detail.raw_text == chapter.raw_text and detail.result.scenes[0].title == '完整方案'
            assert not detail.source_changed and not detail.baseline_changed and not detail.issues
            assert detail.analysis.save_relation == 'unsaved'
            assert 'PRIVATE' not in detail.model_dump_json()
            old = await history.analysis_detail('ch1', 'old')
            assert old.analysis.save_relation == 'unknown'
            assert len(old.issues) == 3 and old.result is None and old.raw_text is None
            assert 'PRIVATE' not in old.model_dump_json()
            failed = await history.analysis_detail('ch1', 'failed')
            assert failed.analysis.save_relation == 'not_applicable' and 'PRIVATE' not in failed.model_dump_json()
            page = await history.history('ch1')
            assert {row.id: row.save_relation for row in page.items if row.kind == 'analysis'} == {
                'new': 'unsaved', 'old': 'unknown', 'failed': 'not_applicable'}
            with pytest.raises(ValueError, match='章节不属于'):
                await DivisionHistoryService(db, 'p2').analysis_detail('ch1', 'new')
            with pytest.raises(ValueError, match='分析记录不属于'):
                await history.analysis_detail('ch1', 'missing')


@pytest.mark.parametrize(('code', 'message', 'expected'), [
    ('execution_timeout', 'PRIVATE', '分析执行超时，可重新发起分析'),
    ('submission_failed', '模型请求失败，HTTP 401', '模型请求失败，HTTP 401；请核对模型配置或服务状态'),
    ('submission_failed', 'PRIVATE https://provider.example/key', '分析请求失败，请核对文本模型配置后重试'),
    ('result_failed', 'PRIVATE', '分析结果处理失败，可重新分析或手动划分'),
])
def test_failure_reason_is_actionable_without_provider_details(code, message, expected):
    from app.services.directing.division_history import analysis_failure
    assert analysis_failure(Task(error_code=code, error_message=message)) == expected
