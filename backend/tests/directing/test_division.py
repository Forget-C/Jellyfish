"""整章最终方案校验、原子回滚与稳定身份的真实数据库测试。"""

from copy import deepcopy

import pytest
from pydantic import ValidationError
from sqlalchemy import event, select

from app.core.contracts.directing.division import DivisionDraft, DivisionSave
from app.core.contracts.directing.workspace import SequenceCreate, SourceSpan
from app.models.directing import DivisionCommit, Sequence
from app.services.directing.division import DivisionService
from app.services.directing.store import RevisionConflict
from tests.directing.samples import design_sample
from tests.directing.test_store import database


async def draft_for(service):
    chapter = await service.list_sequences('ch1')
    return DivisionDraft(source_version=chapter.source_version,
        baseline=[{'sequence_id': row.id, 'version': row.version} for row in chapter.sequences],
        members=[{'key': row.id, 'sequence_id': row.id, 'title': row.title, 'span': row.span} for row in chapter.sequences],
        exited_sequence_ids=[], lineage=[{'sequence_id': row.id, 'target_keys': [row.id]} for row in chapter.sequences])


async def setup_two(service):
    chapter = await service.list_sequences('ch1')
    for position, span in enumerate([(0, 3), (3, 7)]):
        await service.write_sequence('ch1', SequenceCreate(title=f'场次 {position}', position=position,
            source_version=chapter.source_version, span=SourceSpan(start=span[0], end=span[1])))
    return await draft_for(service)


async def save(service, draft, request_id='save-1', confirmed=False):
    preview = await service.preview_division('ch1', draft)
    body = DivisionSave(request_id=request_id, draft=draft, preview_token=preview.preview_token,
                        identity_changes_confirmed=confirmed)
    return await service.save_division('ch1', body), body


@pytest.mark.parametrize('mutate', [
    lambda value: value['members'].pop(),
    lambda value: value['members'].append(deepcopy(value['members'][0])),
    lambda value: value['baseline'].append(deepcopy(value['baseline'][0])),
    lambda value: value['exited_sequence_ids'].append('old'),
    lambda value: value['lineage'][0].update(target_keys=['missing']),
    lambda value: value['lineage'][0].update(target_keys=[]),
])
def test_identity_contract_requires_complete_explicit_mapping(mutate):
    value = {'source_version': 'v1', 'baseline': [{'sequence_id': 'old', 'version': 1}],
             'members': [{'key': 'a', 'sequence_id': 'old', 'title': '场次', 'span': {'start': 0, 'end': 3}}],
             'exited_sequence_ids': [], 'lineage': [{'sequence_id': 'old', 'target_keys': ['a']}]}
    mutate(value)
    with pytest.raises(ValidationError):
        DivisionDraft.model_validate(value)


@pytest.mark.asyncio
async def test_shared_boundary_and_noop_identity(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            original = await service.list_sequences('ch1')
            preview = await service.preview_division('ch1', draft)
            assert all(not item.changes for item in preview.impacts)
            with pytest.raises(ValueError, match='没有变化'):
                await save(service, draft)
            draft.members[0].span.end = 4
            draft.members[1].span.start = 4
            result, body = await save(service, draft)
            assert [row.source_text for row in result.chapter.sequences] == ['兄弟在店', '中交谈']
            assert [row.version for row in result.chapter.sequences] == [2, 2]
            assert [row.id for row in result.chapter.sequences] == [row.id for row in original.sequences]
            assert (await service.save_division('ch1', body)) == result
            assert await service.division_receipt('ch1', 'save-1') == result
            with pytest.raises(RevisionConflict, match='另一份划分'):
                await service.save_division('ch1', body.model_copy(update={'identity_changes_confirmed': True}))
            draft = await draft_for(service)
            draft.members[0].title = '新名称'
            result, _ = await save(service, draft, 'save-2')
            assert result.chapter.sequences[1] == (await service.division_receipt('ch1', 'save-1')).chapter.sequences[1]


@pytest.mark.asyncio
async def test_retirement_keeps_design_and_releases_position(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            old = draft.members.pop(0)
            design = await service.save_revision(old.sequence_id, kind='design', payload=design_sample())
            draft.exited_sequence_ids = [old.sequence_id]
            draft.lineage[0].target_keys = ['new']
            draft.members.insert(0, old.model_copy(update={'key': 'new', 'sequence_id': None}))
            with pytest.raises(ValueError, match='身份去向'):
                await save(service, draft)
            result, body = await save(service, draft, confirmed=True)
            assert len(result.chapter.sequences) == 2
            assert result.chapter.sequences[0].id == result.created_sequence_ids['new']
            assert result.chapter.sequences[1].version == 1
            assert not (await service.sequence(old.sequence_id)).is_current
            assert (await service.read_revision(design.id)).sequence_id == old.sequence_id
            assert (await service.read_sequence(old.sequence_id)).position == 0
            assert (await service.save_division('ch1', body)) == result
            assert len(list(await db.scalars(select(Sequence)))) == 3


@pytest.mark.asyncio
async def test_reorder_then_later_write_failure_rolls_back_everything(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            before = await service.list_sequences('ch1')
            draft.members.reverse()
            preview = await service.preview_division('ch1', draft)
            writes = 0

            def fail_second(connection, cursor, statement, parameters, context, executemany):
                nonlocal writes
                if statement.startswith('UPDATE directing_sequences'):
                    writes += 1
                    if writes == 4:
                        raise RuntimeError('later write failed')

            event.listen(db.bind.sync_engine, 'before_cursor_execute', fail_second)
            try:
                with pytest.raises(RuntimeError, match='later write'):
                    await service.save_division('ch1', DivisionSave(request_id='bad', draft=draft, preview_token=preview.preview_token))
            finally:
                event.remove(db.bind.sync_engine, 'before_cursor_execute', fail_second)
            assert writes == 4
            assert await service.list_sequences('ch1') == before
            assert list(await db.scalars(select(DivisionCommit))) == []
            result, _ = await save(service, draft)
            assert [row.id for row in result.chapter.sequences] == [row.id for row in reversed(before.sequences)]


@pytest.mark.asyncio
async def test_stale_baseline_source_and_preview_are_rejected(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            draft.members[0].title = '改名'
            preview = await service.preview_division('ch1', draft)
            await service.save_revision(draft.members[0].sequence_id, kind='design', payload=design_sample())
            with pytest.raises(RevisionConflict, match='重新预览'):
                await service.save_division('ch1', DivisionSave(request_id='stale', draft=draft, preview_token=preview.preview_token))
            result, _ = await save(service, draft)
            with pytest.raises(RevisionConflict, match='集合'):
                await service.preview_division('ch1', draft)
            fresh = await draft_for(service)
            chapter = await service.chapter('ch1')
            chapter.raw_text += '。'
            await db.flush()
            with pytest.raises(RevisionConflict, match='原文'):
                await service.preview_division('ch1', fresh)
            assert result.chapter.sequences[0].title == '改名'


@pytest.mark.asyncio
@pytest.mark.parametrize('span,message', [((2, 5), '重叠'), ((3, 99), '越界')])
async def test_final_range_validation(tmp_path, span, message):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            draft.members[1].span = SourceSpan(start=span[0], end=span[1])
            with pytest.raises(ValueError, match=message):
                await service.preview_division('ch1', draft)


@pytest.mark.asyncio
async def test_new_member_retry_and_final_task_state(tmp_path):
    """响应丢失重试不创建第二份；预览后任务结束仍要求重新预览。"""
    from app.models.task import Task
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await draft_for(service)
            draft = DivisionDraft.model_validate({**draft.model_dump(), 'members': [
                {'key': 'new-a', 'title': '新场次', 'span': {'start': 1, 'end': 6}}]})
            result, body = await save(service, draft)
            assert len(result.created_sequence_ids) == 1
            assert await service.save_division('ch1', body) == result
            assert len(list(await db.scalars(select(Sequence)))) == 1
            draft = await draft_for(service)
            old = draft.members.pop()
            draft.exited_sequence_ids = [old.sequence_id]
            draft.lineage[0].target_keys = []
            task = Task(id='running-division-test', kind='directing_design', status='running', project_id='p1',
                        target_type='directing_sequence', target_id=old.sequence_id, input_snapshot={})
            db.add(task)
            await db.flush()
            preview = await service.preview_division('ch1', draft)
            assert preview.blockers and task.id in preview.blockers[0]
            pending = DivisionSave(request_id='retire', draft=draft, preview_token=preview.preview_token,
                                   identity_changes_confirmed=True)
            with pytest.raises(RevisionConflict, match='尚未结束'):
                await service.save_division('ch1', pending)
            task.status = 'succeeded'
            await db.flush()
            with pytest.raises(RevisionConflict, match='重新预览'):
                await service.save_division('ch1', pending)
            await save(service, draft, 'retire', confirmed=True)
            assert task.status == 'succeeded'
            assert (await service.list_sequences('ch1')).sequences == []
            assert (await service.read_sequence(old.sequence_id)).source_text == '弟在店中交'


@pytest.mark.asyncio
async def test_preview_invalidated_when_existing_design_changes(tmp_path):
    """相同成果数量不能掩盖版本或确认状态变化。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            design = await service.save_revision(draft.members[0].sequence_id, kind='design', payload=design_sample())
            draft.members[0].title = '新名称'
            preview = await service.preview_division('ch1', draft)
            await service.save_revision(draft.members[0].sequence_id, kind='design', payload=design_sample(),
                                        revision_id=design.id, expected_version=1)
            with pytest.raises(RevisionConflict, match='重新预览'):
                await service.save_division('ch1', DivisionSave(request_id='stale-design', draft=draft, preview_token=preview.preview_token))


@pytest.mark.asyncio
async def test_historical_member_blocks_new_work_but_receives_existing_output(tmp_path):
    """退出只禁止新写入；已有任务结果仍登记到原身份，历史设计和采用可读。"""
    from app.core.contracts.directing.workspace import AIRequest
    from app.services.directing.production import ProductionService
    from tests.directing.test_store import setup_story, output
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, design_id, _, prompts = await setup_story(db)
            await output(db, prompts[0])
            service = DivisionService(db, 'p1')
            draft = await draft_for(service)
            draft.members = []
            draft.exited_sequence_ids = [sequence_id]
            draft.lineage[0].target_keys = []
            await save(service, draft, confirmed=True)
            production = ProductionService(db, 'p1')
            for action in [
                lambda: production.save_revision(sequence_id, kind='design', payload=design_sample()),
                lambda: production.confirm_revision(design_id, expected_version=2, actor_id='author'),
                lambda: production.submit_ai(kind='directing_design', sequence_id=sequence_id, body=AIRequest()),
                lambda: production.compile_unit(sequence_id, 'missing', 'u1'),
                lambda: production.shoot(sequence_id, prompt_id='missing', review_id='missing', request_id='new'),
            ]:
                with pytest.raises(RevisionConflict, match='退出'):
                    await action()
            take = await production.register_take(prompt_revision_id=prompts[0], task_id='task1', output_ordinal=0)
            assert take.sequence_id == sequence_id
            history = await service.historical_sequences('ch1')
            assert len(history) == 1 and not history[0].is_current
            assert (await service.workspace(sequence_id)).takes[0].id == take.id
            assert (await service.chapter_overview('ch1')).sequences == []


@pytest.mark.asyncio
async def test_ai_draft_requires_exact_analysis_member_baseline(tmp_path):
    """原文相同但分析期间新增、改名或调序不能用旧建议静默覆盖。"""
    from app.models.task import Task
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            task = Task(id='analysis', project_id='p1', kind='directing_divide', status='succeeded',
                target_type='directing_chapter', target_id='ch1', input_snapshot={'run_args': {
                    'source_version': draft.source_version, 'division_baseline': {}}}, result={})
            db.add(task)
            await db.flush()
            draft.source_task_id = task.id
            with pytest.raises(RevisionConflict, match='分析期间'):
                await service.preview_division('ch1', draft)
            task.input_snapshot = {'run_args': {'source_version': draft.source_version,
                'division_baseline': {row.sequence_id: row.version for row in draft.baseline}}}
            await db.flush()
            assert not (await service.preview_division('ch1', draft)).blockers


@pytest.mark.asyncio
async def test_existing_cross_scene_dependency_blocks_exit(tmp_path):
    """引用索引中的历史或导入跨场依赖也不能因隐藏原场次而失去约束。"""
    from app.models.directing import RevisionDependency
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            first, second = [row.sequence_id for row in draft.members]
            left = await service.save_revision(first, kind='design', payload=design_sample())
            right = await service.save_revision(second, kind='design', payload=design_sample())
            db.add(RevisionDependency(revision_id=right.id, dependency_id=left.id))
            await db.flush()
            draft.members.pop(0)
            draft.exited_sequence_ids = [first]
            draft.lineage[0].target_keys = []
            preview = await service.preview_division('ch1', draft)
            assert any(right.id in blocker for blocker in preview.blockers)
            with pytest.raises(RevisionConflict, match='仍引用'):
                await save(service, draft, confirmed=True)


@pytest.mark.asyncio
async def test_explicit_split_then_merge_keeps_original_production_identity(tmp_path):
    """拆分及合并只改当前成员，原设计不复制，退出的分段仍以原 ID 可读。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            original = draft.members[0].sequence_id
            design = await service.save_revision(original, kind='design', payload=design_sample())
            draft.members[0].span.end = 1
            draft.members.insert(1, draft.members[0].model_copy(update={
                'key': 'split', 'sequence_id': None, 'title': '拆分的新段', 'span': SourceSpan(start=1, end=3)}))
            draft.lineage[0].target_keys.append('split')
            with pytest.raises(ValueError, match='身份去向'):
                await save(service, draft)
            split, _ = await save(service, draft, 'split', confirmed=True)
            split_id = split.created_sequence_ids['split']
            assert split.chapter.sequences[0].id == original
            assert not (await service.workspace(split_id)).designs
            assert (await service.read_revision(design.id)).sequence_id == original
            merged = await draft_for(service)
            merged.members[0].span.end = 3
            merged.members = [row for row in merged.members if row.sequence_id != split_id]
            merged.exited_sequence_ids = [split_id]
            next(row for row in merged.lineage if row.sequence_id == split_id).target_keys = [original]
            result, _ = await save(service, merged, 'merge', confirmed=True)
            assert [row.id for row in result.chapter.sequences] == [original, split.chapter.sequences[-1].id]
            assert not (await service.read_sequence(split_id)).is_current
            assert (await service.read_revision(design.id)).sequence_id == original
