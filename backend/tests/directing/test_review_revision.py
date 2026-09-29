"""受约束修订不得增加身份、伪造差异或采用过期输入。"""

from copy import deepcopy

import pytest

from tests.directing.samples import design_sample, plan_sample


def test_revision_rejects_unknown_fields_and_sound_values():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    unit = plan_sample('design1')['units'][0]
    context = {'design': design, 'unit': unit, 'input_identity': 'frozen', 'directions': [], 'problem_keys': ['problem']}
    for path, value in [('/sound/execution', 'proposal'), ('/direction/shots/0/applicable_shot_ids', ['s1']), ('/participants/0/id', 'other')]:
        with pytest.raises(ValueError):
            validate_candidate(context, {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': path, 'before': None, 'after': value, 'reason': '修改', 'problem_keys': ['problem']}], 'outcomes': []})


def test_revision_real_diff_preserves_other_shots_and_rejects_fake_before():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    design['sound']['execution'] = 'unknown'
    original = deepcopy(design)
    direction = {'occurrence_id': 'o1', 'role': 'direction', 'finding_index': -1, 'text': '后期', 'sound_execution': 'postproduction'}
    from app.services.directing.review_revision import problem_key
    key = problem_key(direction)
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen', 'directions': [direction], 'problem_keys': [key]}
    result = {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': '/sound/execution', 'before': design['sound']['execution'], 'after': 'postproduction', 'reason': '后期处理', 'problem_keys': [key]}], 'outcomes': [{'problem_key': key, 'status': 'planned', 'reason': '后期处理', 'choices': []}]}
    candidate, updated, _ = validate_candidate(context, result)
    assert updated.sound.execution == 'postproduction'
    assert candidate.changes[0].before == original['sound']['execution']
    assert design == original
    result['changes'][0]['before'] = 'forged'
    with pytest.raises(ValueError, match='修改前'):
        validate_candidate(context, result)


@pytest.mark.asyncio
@pytest.mark.parametrize('failed_step', ['compile_unit', 'submit_review'])
async def test_candidate_and_adoption_resume_without_duplicate_outputs(tmp_path, monkeypatch, failed_step):
    from sqlalchemy import func, select
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest
    from app.models.directing import DirectingRevision
    from app.models.llm import Model
    from app.models.task import Task
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database, frozen

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, plan_id, prompt_id, review_id = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            await db.flush()
            service = ReviewRevisionService(db, 'p1')
            packet = deepcopy((await service.revision(review_id)).payload)
            packet['rows'][0]['verdict'] = 'revise'
            review_id = (await frozen(service, sequence_id, 'review', packet)).id
            body = ReviewRevisionRequest(prompt_revision_id=prompt_id, review_source={'kind': 'review', 'id': review_id}, request_id='generate1', model_id='text-review')
            before = await db.scalar(select(func.count()).select_from(DirectingRevision))
            task = await service.generate_revision(sequence_id, body)
            assert (await service.generate_revision(sequence_id, body)).id == task.id
            context = task.input_snapshot['run_args']['revision_context']
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == before
            task.status = 'succeeded'
            task.result = {'input_identity': context['input_identity'], 'changes': [{'target': 'design', 'path': '/sound/execution', 'before': 'postproduction', 'after': 'unknown', 'reason': '暂不确定', 'problem_keys': [context['problem_keys'][0]]}], 'outcomes': [{'problem_key': context['problem_keys'][0], 'status': 'planned', 'reason': '说明待确定', 'choices': []}]}
            await db.flush()
            apply = ApplyReviewRevisionRequest(task_id=task.id, input_identity=context['input_identity'], candidate_identity=(await service.read_task(task.id)).revision.candidate_identity, request_id='adopt1')
            original_step = getattr(service, failed_step)
            async def fail_step(*args, **kwargs):
                raise RuntimeError('模拟暂时中断')
            monkeypatch.setattr(service, failed_step, fail_step)
            failed = await service.apply_revision(sequence_id, apply)
            assert failed.stage == 'blocked' and failed.design_revision_id and failed.plan_revision_id
            assert (failed.prompt_revision_id is None) == (failed_step == 'compile_unit')
            new_design, new_plan = failed.design_revision_id, failed.plan_revision_id
            from app.models.studio import Chapter
            chapter = await db.get(Chapter, 'ch1')
            original_text = chapter.raw_text
            chapter.raw_text += '，未完成采用期间原文变化'
            await db.flush()
            with pytest.raises(ValueError, match='原文已变化'):
                await service.apply_revision(sequence_id, apply)
            chapter.raw_text = original_text
            await db.flush()
            monkeypatch.setattr(service, failed_step, original_step)
        async with sessions.begin() as db:
            service = ReviewRevisionService(db, 'p1')
            resumed = await service.apply_revision(sequence_id, apply)
            assert resumed.stage == 'reviewing', resumed.error
            assert resumed.design_revision_id == new_design and resumed.plan_revision_id == new_plan
            repeated = await service.apply_revision(sequence_id, apply)
            assert repeated == resumed
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == before + 3
            assert await db.scalar(select(func.count()).select_from(Task).where(Task.kind == 'directing_review')) == 1
            assert await db.scalar(select(func.count()).select_from(Task).where(Task.kind == 'video_generation')) == 0
            assert (await service.revision(prompt_id)).payload['plan_revision_id'] == plan_id
            assert (await service.revision(review_id)).payload['rows'][0]['verdict'] == 'revise'
            assert len((await service.revision(new_plan)).payload['units']) == 1
            assert (await service.read_task(apply.task_id)).revision_application == resumed
        async with sessions.begin() as db:
            from app.models.studio import Chapter
            (await db.get(Chapter, 'ch1')).raw_text += '，响应丢失后修改原文'
        async with sessions.begin() as db:
            service = ReviewRevisionService(db, 'p1')
            assert await service.apply_revision(sequence_id, apply) == resumed
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == before + 3
            assert await db.scalar(select(func.count()).select_from(Task).where(Task.kind == 'directing_review')) == 1
            with pytest.raises(ValueError, match='原请求'):
                await service.apply_revision(sequence_id, apply.model_copy(update={'request_id': 'different'}))


@pytest.mark.asyncio
async def test_revision_rejects_changed_directions_source_and_wrong_project(tmp_path):
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest
    from app.models.llm import Model
    from app.models.studio import Chapter
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database, frozen

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, review_id = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            await db.flush()
            service = ReviewRevisionService(db, 'p1')
            packet = deepcopy((await service.revision(review_id)).payload)
            packet['rows'][0]['verdict'] = 'revise'
            review_id = (await frozen(service, sequence_id, 'review', packet)).id
            body = ReviewRevisionRequest(prompt_revision_id=prompt_id, review_source={'kind': 'review', 'id': review_id}, request_id='generate1', model_id='text-review')
            task = await service.generate_revision(sequence_id, body)
            context = task.input_snapshot['run_args']['revision_context']
            task.status = 'succeeded'
            task.result = {'input_identity': context['input_identity'], 'changes': [], 'outcomes': []}
            apply = ApplyReviewRevisionRequest(task_id=task.id, input_identity=context['input_identity'], request_id='adopt1', directions=[{'occurrence_id': 'o1', 'role': 'direction', 'finding_index': -1, 'text': '新方向'}])
            with pytest.raises(ValueError, match='方向或输入'):
                await service.apply_revision(sequence_id, apply)
            with pytest.raises(ValueError):
                await ReviewRevisionService(db, 'p2').apply_revision(sequence_id, apply)
            apply.directions = []
            (await db.get(Chapter, 'ch1')).raw_text += '，原文变化'
            with pytest.raises(ValueError, match='原文已变化'):
                await service.apply_revision(sequence_id, apply)


def test_revision_direction_outcomes_and_current_shot_scope():
    from app.services.directing.review_revision import validate_candidate, problem_key
    design = design_sample()
    unit = plan_sample('design1')['units'][0]
    unit['coverage'] = unit['coverage'][:1]
    direction = {'occurrence_id': 'o1', 'role': 'direction', 'finding_index': -1, 'text': '保留空镜，不改后面的表演'}
    key = problem_key(direction)
    context = {'design': design, 'unit': unit, 'input_identity': 'frozen', 'directions': [direction], 'problem_keys': [key]}
    raw = {'input_identity': 'frozen', 'changes': [], 'outcomes': []}
    with pytest.raises(ValueError, match='未解决原因'):
        validate_candidate(context, raw)
    raw['outcomes'] = [{'problem_key': key, 'status': 'unresolved', 'reason': '当前为编译器背景解释问题，不能删改正确设计', 'choices': []}]
    validate_candidate(context, raw)
    raw['outcomes'][0].update(status='needs_choice', choices=['后期添加'])
    with pytest.raises(ValueError, match='明确选项'):
        validate_candidate(context, raw)
    raw['outcomes'][0]['choices'].append('同期生成')
    validate_candidate(context, raw)
    raw['changes'] = [{'target': 'design', 'path': '/direction/shots/1/visible_result', 'before': design['direction']['shots'][1]['visible_result'], 'after': {'state': 'none', 'reason': '删除'}, 'reason': '越界修改', 'problem_keys': [key]}]
    with pytest.raises(ValueError, match='允许修改范围'):
        validate_candidate(context, raw)


def test_actual_invalid_sound_enum_and_forged_note_source_rejected():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen', 'directions': [], 'problem_keys': ['problem'], 'task_identity': 'revision-task'}
    raw = {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': '/sound/execution', 'before': design['sound']['execution'], 'after': 'proposal', 'reason': '错误检查建议', 'problem_keys': ['problem']}], 'outcomes': [{'problem_key': 'problem', 'status': 'planned', 'reason': '错误建议', 'choices': []}]}
    with pytest.raises(ValueError, match='generated'):
        validate_candidate(context, raw)
    before = design['prompt']['prohibitions']
    raw['changes'][0].update(path='/prompt/prohibitions', before=before, after={'state': 'proposal', 'text': '新要求', 'sources': [{'kind': 'revision', 'reference': 'foreign', 'version': '1'}]})
    with pytest.raises(ValueError, match='未经验证的来源'):
        validate_candidate(context, raw)


def test_shared_beats_and_normalized_noop_are_not_editable():
    from app.services.directing.review_revision import allowed_fields, validate_candidate
    from app.core.contracts.directing.design import SceneDesign
    design = SceneDesign.model_validate(design_sample()).model_dump(mode='json')
    unit = plan_sample('design1')['units'][0]
    unit['coverage'] = unit['coverage'][:1]
    design['direction']['shots'][1]['beat_ids'] = design['direction']['shots'][0]['beat_ids']
    fields = allowed_fields(design, unit)
    assert not any(path.startswith('/direction/beats/0/') for path in fields)
    assert not any(path.startswith('/performance/beats/0/') for path in fields)
    design['prompt']['prohibitions'] = {'state': 'unknown', 'text': None, 'reason': None, 'sources': []}
    unit['coverage'] = plan_sample('design1')['units'][0]['coverage']
    context = {'design': design, 'unit': unit, 'input_identity': 'frozen', 'directions': [], 'problem_keys': ['problem']}
    raw = {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': '/prompt/prohibitions', 'before': design['prompt']['prohibitions'], 'after': {'state': 'unknown'}, 'reason': '假差异', 'problem_keys': ['problem']}], 'outcomes': []}
    with pytest.raises(ValueError, match='无实际差异'):
        validate_candidate(context, raw)


@pytest.mark.asyncio
async def test_concurrent_sqlite_requests_have_one_task_and_one_adoption(tmp_path):
    import asyncio
    from sqlalchemy import func, select
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest
    from app.models.directing import DirectingRevision
    from app.models.llm import Model
    from app.models.task import Task
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database, frozen

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, review_id = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            service = ReviewRevisionService(db, 'p1')
            packet = deepcopy((await service.revision(review_id)).payload)
            packet['rows'][0]['verdict'] = 'revise'
            review_id = (await frozen(service, sequence_id, 'review', packet)).id
            body = ReviewRevisionRequest(prompt_revision_id=prompt_id, review_source={'kind': 'review', 'id': review_id}, request_id='parallel-generate', model_id='text-review')
            count_before = await db.scalar(select(func.count()).select_from(DirectingRevision))
        async def generate():
            async with sessions.begin() as db:
                return (await ReviewRevisionService(db, 'p1').generate_revision(sequence_id, body)).id
        first, second = await asyncio.gather(generate(), generate())
        assert first == second
        async with sessions.begin() as db:
            task = await db.get(Task, first)
            context = task.input_snapshot['run_args']['revision_context']
            task.status = 'succeeded'
            task.result = {'input_identity': context['input_identity'], 'changes': [{'target': 'unit', 'path': '/duration_ms', 'before': context['unit']['duration_ms'], 'after': 8000, 'reason': '延长本次镜头', 'problem_keys': context['problem_keys']}], 'outcomes': [{'problem_key': key, 'status': 'planned', 'reason': '延长镜头', 'choices': []} for key in context['problem_keys']]}
            apply = ApplyReviewRevisionRequest(task_id=first, input_identity=context['input_identity'], candidate_identity=(await ReviewRevisionService(db, 'p1').read_task(task.id)).revision.candidate_identity, request_id='parallel-adopt')
        async def adopt():
            async with sessions.begin() as db:
                return await ReviewRevisionService(db, 'p1').apply_revision(sequence_id, apply)
        first_result, second_result = await asyncio.gather(adopt(), adopt())
        assert first_result == second_result
        assert first_result.stage == 'reviewing', first_result.error
        assert first_result.design_revision_id == context['design_revision_id']
        async with sessions.begin() as db:
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == count_before + 2
            assert await db.scalar(select(func.count()).select_from(Task).where(Task.kind == 'directing_review')) == 1


@pytest.mark.asyncio
async def test_task_source_api_restores_request_and_blocks_unresolved_adoption(tmp_path):
    from app.models.llm import Model
    from app.models.task import Task
    from tests.directing.test_api import client_for
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, _, prompt_id, review_id = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            packet = deepcopy((await service.revision(review_id)).payload)
            packet['rows'][0]['verdict'] = 'revise'
            db.add(Task(id='source-review', kind='directing_review', status='succeeded', project_id='p1', target_type='directing_sequence', target_id=sequence_id, input_snapshot={'run_args': {'packet': packet}}, result=packet))
        async with client_for(sessions) as client:
            base = f'/api/v1/studio/projects/p1/directing/sequences/{sequence_id}/review-revisions'
            body = {'prompt_revision_id': prompt_id, 'review_source': {'kind': 'task', 'id': 'source-review'}, 'directions': [], 'model_id': 'text-review', 'request_id': 'api-generate'}
            response = await client.post(base, json=body)
            assert response.status_code == 200, response.text
            task_id = response.json()['data']['task_id']
            assert (await client.post(base, json=body)).json()['data']['task_id'] == task_id
            changed = {**body, 'directions': [{'occurrence_id': 'o1', 'role': 'direction', 'finding_index': -1, 'text': 'changed'}]}
            assert (await client.post(base, json=changed)).status_code == 409
            assert (await client.post(base.replace('/p1/', '/p2/'), json=body)).status_code == 422
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            context = task.input_snapshot['run_args']['revision_context']
            task.status = 'succeeded'
            task.result = {'input_identity': context['input_identity'], 'changes': [{'target': 'design', 'path': '/sound/execution', 'before': 'postproduction', 'after': 'unknown', 'reason': '拟改动', 'problem_keys': context['problem_keys']}], 'outcomes': [{'problem_key': key, 'status': 'unresolved', 'reason': '必须先修复编译器，不能删除正确设计', 'choices': []} for key in context['problem_keys']]}
        async with client_for(sessions) as client:
            detail = (await client.get(f'/api/v1/studio/projects/p1/directing/tasks/{task_id}')).json()['data']
            assert detail['revision_request'] == {**body, 'instruction': '', 'edits': []}
            assert detail['revision']['outcomes'][0]['status'] == 'unresolved'
            response = await client.post(base + '/apply', json={'task_id': task_id, 'input_identity': context['input_identity'], 'request_id': 'api-adopt', 'directions': [], 'candidate_identity': detail['revision']['candidate_identity']})
            assert response.status_code == 422 and '未解决' in response.text


def test_sound_execution_requires_explicit_choice_even_when_text_mentions_it():
    from app.services.directing.review_revision import validate_candidate, problem_key
    design = design_sample()
    design['sound']['execution'] = 'unknown'
    direction = {'occurrence_id': 'o1', 'role': 'prompt', 'finding_index': -1, 'text': '检查提到后期制作，但我没有决定'}
    key = problem_key(direction)
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen', 'directions': [direction], 'problem_keys': [key]}
    raw = {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': '/sound/execution', 'before': 'unknown', 'after': 'postproduction', 'reason': '模型猜测', 'problem_keys': [key]}], 'outcomes': [{'problem_key': key, 'status': 'planned', 'reason': '模型自述已满足'}]}
    for directions in ([], [direction]):
        context['directions'] = directions
        result, updated, _ = validate_candidate(context, raw)
        assert result.changes == [] and updated.sound.execution == 'unknown'
        assert result.outcomes[0].status == 'needs_choice'
        assert result.outcomes[0].choices == ['声音由后期添加', '使用支持声音的模型同期生成']
    context['directions'] = [{**direction, 'sound_execution': 'postproduction'}]
    result, updated, _ = validate_candidate(context, raw)
    assert len(result.changes) == 1 and updated.sound.execution == 'postproduction'


def test_conflicting_explicit_sound_choices_cannot_both_be_planned():
    from app.services.directing.review_revision import validate_candidate, problem_key
    design = design_sample()
    design['sound']['execution'] = 'unknown'
    directions = [{'occurrence_id': 'o1', 'role': role, 'finding_index': -1, 'text': '', 'sound_execution': value}
                  for role, value in [('prompt', 'generated'), ('direction', 'postproduction')]]
    keys = [problem_key(direction) for direction in directions]
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen', 'directions': directions, 'problem_keys': keys}
    raw = {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': '/sound/execution', 'before': 'unknown', 'after': 'generated', 'reason': '声称同时满足', 'problem_keys': keys}], 'outcomes': [{'problem_key': key, 'status': 'planned', 'reason': '声称拟落实'} for key in keys]}
    result, updated, _ = validate_candidate(context, raw)
    assert result.changes == [] and updated.sound.execution == 'unknown'
    assert all(outcome.status == 'needs_choice' and '冲突' in outcome.reason for outcome in result.outcomes)


def test_candidate_cannot_erase_required_compile_content():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen', 'directions': [], 'problem_keys': ['problem']}
    raw = {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': '/direction/shots/0/visible_result', 'before': design['direction']['shots'][0]['visible_result'], 'after': {'state': 'unknown'}, 'reason': '不能删除必要内容', 'problem_keys': ['problem']}], 'outcomes': [{'problem_key': 'problem', 'status': 'planned', 'reason': '错误方案'}]}
    with pytest.raises(ValueError, match='编译必需'):
        validate_candidate(context, raw)


@pytest.mark.asyncio
async def test_unsupported_unit_change_does_not_persist_versions(tmp_path):
    from sqlalchemy import func, select
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest
    from app.models.directing import DirectingRevision
    from app.models.llm import Model
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database, frozen

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, review_id = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            service = ReviewRevisionService(db, 'p1')
            packet = deepcopy((await service.revision(review_id)).payload)
            packet['rows'][0]['verdict'] = 'revise'
            review_id = (await frozen(service, sequence_id, 'review', packet)).id
            task = await service.generate_revision(sequence_id, ReviewRevisionRequest(prompt_revision_id=prompt_id, review_source={'kind': 'review', 'id': review_id}, request_id='unsupported', model_id='text-review'))
            context = task.input_snapshot['run_args']['revision_context']
            task.status = 'succeeded'
            task.result = {'input_identity': context['input_identity'], 'changes': [{'target': 'unit', 'path': '/duration_ms', 'before': context['unit']['duration_ms'], 'after': 8500, 'reason': '不受支持的时长', 'problem_keys': context['problem_keys']}], 'outcomes': [{'problem_key': key, 'status': 'planned', 'reason': '拟延长'} for key in context['problem_keys']]}
            apply = ApplyReviewRevisionRequest(task_id=task.id, input_identity=context['input_identity'], candidate_identity=(await service.read_task(task.id)).revision.candidate_identity, request_id='adopt-unsupported')
            before = await db.scalar(select(func.count()).select_from(DirectingRevision))
            result = await service.apply_revision(sequence_id, apply)
            assert result.stage == 'blocked' and result.error
            assert result.design_revision_id is None and result.plan_revision_id is None
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == before


def test_revision_ai_pipeline_validates_output_retries_schema_and_propagates_failure():
    import json
    from types import SimpleNamespace
    from unittest.mock import Mock
    from app.services.directing.ai import DirectingOutputError, generate_directing_result

    design = design_sample()
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen', 'directions': [], 'problem_keys': ['problem']}
    raw = {'input_identity': 'frozen', 'changes': [{'target': 'design', 'path': '/sound/execution', 'before': design['sound']['execution'], 'after': 'unknown', 'reason': '保留未确定状态', 'problem_keys': ['problem']}], 'outcomes': [{'problem_key': 'problem', 'status': 'planned', 'reason': '说明未确定'}]}
    llm = Mock()
    llm.invoke.return_value = SimpleNamespace(content=json.dumps(raw))
    result = generate_directing_result('directing_review_revision', llm, {'revision_context': context})
    assert result.changes[0].after == 'unknown' and llm.invoke.call_count == 1
    llm.reset_mock()
    llm.invoke.return_value = SimpleNamespace(content='{}')
    with pytest.raises(DirectingOutputError, match='结构校验失败'):
        generate_directing_result('directing_review_revision', llm, {'revision_context': context})
    assert llm.invoke.call_count == 2
    raw['changes'][0]['path'] = '/direction/shots/0/applicable_shot_ids'
    llm.invoke.return_value = SimpleNamespace(content=json.dumps(raw))
    with pytest.raises(ValueError, match='允许修改范围'):
        generate_directing_result('directing_review_revision', llm, {'revision_context': context})
    llm.invoke.side_effect = RuntimeError('离线模拟模型故障')
    with pytest.raises(RuntimeError, match='模型故障'):
        generate_directing_result('directing_review_revision', llm, {'revision_context': context})


@pytest.mark.asyncio
async def test_direct_preview_is_immutable_and_matches_adopted_prompt(tmp_path):
    from sqlalchemy import func, select
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest
    from app.models.directing import DirectingRevision
    from app.models.llm import Model
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, _ = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            service = ReviewRevisionService(db, 'p1')
            fields = await service.editable_fields(sequence_id, prompt_id)
            duration = next(field for field in fields.fields if field.path == '/duration_ms')
            body = ReviewRevisionRequest(prompt_revision_id=prompt_id, request_id='manual', model_id='text-review',
                edits=[{'target': 'unit', 'path': duration.path, 'before': duration.value, 'after': 8000}])
            count = await db.scalar(select(func.count()).select_from(DirectingRevision))
            task = await service.preview_revision(sequence_id, body)
            assert task.status == 'succeeded'
            assert (await service.preview_revision(sequence_id, body)).id == task.id
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == count
            candidate = (await service.read_task(task.id)).revision
            assert candidate.preview_text and candidate.candidate_identity
            applied = await service.apply_revision(sequence_id, ApplyReviewRevisionRequest(task_id=task.id,
                input_identity=candidate.input_identity, candidate_identity=candidate.candidate_identity,
                edits=body.edits, request_id='manual-apply'))
            assert applied.stage == 'reviewing', applied.error
            assert (await service.revision(applied.prompt_revision_id)).payload['text'] == candidate.preview_text


def test_manual_edits_reject_duplicates_conflicts_forged_sources_and_noop():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    edit = {'target': 'unit', 'path': '/duration_ms', 'before': 6000, 'after': 8000}
    unit = plan_sample('design1')['units'][0]
    edit['before'] = unit['duration_ms']
    context = {'design': design, 'unit': unit, 'input_identity': 'frozen', 'directions': [], 'problem_keys': [], 'request': {'edits': [edit]}}
    raw = {'input_identity': 'frozen'}
    context['request']['edits'] = [edit, edit]
    with pytest.raises(ValueError, match='重复'):
        validate_candidate(context, raw)
    context['request']['edits'] = [edit]
    with pytest.raises(ValueError, match='冲突'):
        validate_candidate(context, {**raw, 'changes': [{**edit, 'after': 4000, 'reason': 'AI覆盖'}]})
    context['request']['edits'] = [{**edit, 'after': edit['before']}]
    with pytest.raises(ValueError, match='无实际差异'):
        validate_candidate(context, raw)


@pytest.mark.asyncio
async def test_proactive_input_has_no_fabricated_review_and_requires_identity(tmp_path):
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest
    from app.models.llm import Model
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, _ = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            service = ReviewRevisionService(db, 'p1')
            body = ReviewRevisionRequest(prompt_revision_id=prompt_id, instruction='延长至八秒', request_id='proactive', model_id='text-review')
            task = await service.generate_revision(sequence_id, body)
            context = task.input_snapshot['run_args']['revision_context']
            assert context['review'] is None and context['problem_keys'] == []
            assert task.input_snapshot['run_args']['instruction'] == body.instruction
            task.status = 'succeeded'
            task.result = {'input_identity': context['input_identity'], 'changes': [{'target': 'unit', 'path': '/duration_ms', 'before': context['unit']['duration_ms'], 'after': 8000, 'reason': '整体要求'}]}
            candidate = (await service.read_task(task.id)).revision
            apply = ApplyReviewRevisionRequest(task_id=task.id, input_identity=candidate.input_identity,
                instruction=body.instruction, request_id='proactive-apply')
            with pytest.raises(ValueError, match='候选'):
                await service.apply_revision(sequence_id, apply)
            apply.candidate_identity = candidate.candidate_identity
            assert (await service.apply_revision(sequence_id, apply)).stage == 'reviewing'


def test_manual_unknown_note_gets_server_owned_human_source():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    design['prompt']['prohibitions'] = {'state': 'unknown', 'text': None, 'reason': None, 'sources': []}
    edit = {'target': 'design', 'path': '/prompt/prohibitions', 'before': design['prompt']['prohibitions'],
            'after': {'state': 'proposal', 'text': '固定镜头', 'sources': []}}
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen',
               'directions': [], 'problem_keys': [], 'request': {'request_id': 'manual-note', 'edits': [edit]}}
    candidate, updated, _ = validate_candidate(context, {'input_identity': 'frozen'})
    assert updated.prompt.prohibitions.sources[0].kind == 'human'
    assert updated.prompt.prohibitions.sources[0].reference == 'manual-note'
    assert validate_candidate(context, candidate)[0] == candidate


def test_partial_unit_excludes_shared_notes_but_keeps_explicit_sound_execution():
    from app.services.directing.review_revision import allowed_fields
    design = design_sample()
    unit = plan_sample('design1')['units'][0]
    unit['coverage'] = unit['coverage'][:1]
    fields = allowed_fields(design, unit)
    assert not any(path.startswith('/prompt/') for path in fields)
    assert not any(path.startswith('/sound/') and path != '/sound/execution' for path in fields)
    assert '/sound/execution' in fields


def test_ai_source_only_note_change_is_not_a_real_revision():
    from app.services.directing.review_revision import validate_candidate
    from app.core.contracts.directing.design import SceneDesign
    design = SceneDesign.model_validate(design_sample()).model_dump(mode='json')
    before = design['cinematography'][0]['adjacent_requirements']
    after = {**before, 'sources': [{'kind': 'model', 'reference': 'ai-task', 'version': '1'}]}
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen',
               'directions': [], 'problem_keys': [], 'task_identity': 'ai-task'}
    with pytest.raises(ValueError, match='无实际差异'):
        validate_candidate(context, {'input_identity': 'frozen', 'changes': [{'target': 'design',
            'path': '/cinematography/0/adjacent_requirements', 'before': before, 'after': after, 'reason': '只换来源'}]})


@pytest.mark.asyncio
async def test_saved_preview_survives_video_model_removal(tmp_path):
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest
    from app.models.llm import Model
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, _ = await prepare(db)
            service = ReviewRevisionService(db, 'p1')
            fields = await service.editable_fields(sequence_id, prompt_id)
            duration = next(field for field in fields.fields if field.path == '/duration_ms')
            task = await service.preview_revision(sequence_id, ReviewRevisionRequest(prompt_revision_id=prompt_id,
                request_id='history', edits=[{'target': 'unit', 'path': duration.path, 'before': duration.value, 'after': 8000}]))
            before = (await service.read_task(task.id)).revision
            await db.delete(await db.get(Model, 'model1'))
            await db.flush()
            assert (await service.read_task(task.id)).revision == before


@pytest.mark.asyncio
async def test_ai_worker_freezes_preview_before_first_read(tmp_path, monkeypatch):
    import httpx
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ReviewRevisionCandidate
    from app.models.llm import Model
    from app.models.task import Task
    from app.services.directing.review_revision import ReviewRevisionService
    from app.task_worker import TaskWorker
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, _ = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            task = await ReviewRevisionService(db, 'p1').generate_revision(sequence_id, ReviewRevisionRequest(
                prompt_revision_id=prompt_id, request_id='worker-preview', instruction='延长到八秒', model_id='text-review'))
            task_id = task.id
            from app.services.task_service import TaskService
            await TaskService(db).claim(task_id, worker_id='test-worker')
            context = task.input_snapshot['run_args']['revision_context']
        async def generate(*args):
            return ReviewRevisionCandidate(input_identity=context['input_identity'], changes=[{'target': 'unit',
                'path': '/duration_ms', 'before': context['unit']['duration_ms'], 'after': 8000, 'reason': '延长'}])
        monkeypatch.setattr('app.task_worker.ChatOpenAI', lambda **kwargs: object())
        async with httpx.AsyncClient() as client:
            worker = TaskWorker(sessions, client=client)
            monkeypatch.setattr(worker, '_run_script', generate)
            try:
                await worker._execute(task_id)
            finally:
                worker.text_pool.shutdown(wait=True)
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            assert task.status == 'succeeded', task.error_message
            assert task.input_snapshot['revision_preview']['candidate_identity']
            await db.delete(await db.get(Model, 'model1'))
            await db.flush()
            candidate = (await ReviewRevisionService(db, 'p1').read_task(task_id)).revision
            assert candidate.preview_text == task.result['preview_text']



def test_manual_note_rejects_null_sources_as_invalid_input():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    before = design['cinematography'][0]['adjacent_requirements']
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen',
        'directions': [], 'problem_keys': [], 'request': {'edits': [{'target': 'design',
            'path': '/cinematography/0/adjacent_requirements', 'before': before,
            'after': {'state': 'proposal', 'text': '新的要求', 'sources': None}}]}}
    with pytest.raises(ValueError):
        validate_candidate(context, {'input_identity': 'frozen'})


@pytest.mark.parametrize('status', ['unchanged', 'unresolved', 'needs_choice'])
def test_proactive_summary_explains_no_change_without_fabricated_problem(status):
    from app.services.directing.review_revision import validate_candidate
    context = {'design': design_sample(), 'unit': plan_sample('design1')['units'][0],
               'input_identity': 'frozen', 'directions': [], 'problem_keys': []}
    raw = {'input_identity': 'frozen', 'summary': {'status': status, 'reason': '整体修改需要说明',
            'choices': ['后期制作', '同期生成'] if status == 'needs_choice' else []}}
    candidate, _, _ = validate_candidate(context, raw)
    assert candidate.summary.status == status
    assert candidate.changes == [] and candidate.outcomes == []


def test_proactive_sound_change_requires_global_choice_without_fake_problem():
    from app.services.directing.review_revision import validate_candidate
    design = design_sample()
    design['sound']['execution'] = 'unknown'
    context = {'design': design, 'unit': plan_sample('design1')['units'][0],
               'input_identity': 'frozen', 'directions': [], 'problem_keys': []}
    candidate, updated, _ = validate_candidate(context, {'input_identity': 'frozen', 'changes': [
        {'target': 'design', 'path': '/sound/execution', 'before': 'unknown', 'after': 'generated', 'reason': '模型猜测'}]})
    assert candidate.changes == [] and candidate.outcomes == []
    assert candidate.summary.status == 'needs_choice' and len(candidate.summary.choices) == 2
    assert updated.sound.execution == 'unknown'


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['unchanged', 'unresolved', 'needs_choice'])
async def test_global_summary_cannot_adopt_or_create_empty_versions(tmp_path, status):
    from sqlalchemy import func, select
    from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest
    from app.models.directing import DirectingRevision
    from app.models.llm import Model
    from app.services.directing.review_revision import ReviewRevisionService
    from tests.directing.test_production import prepare
    from tests.directing.test_store import database
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            _, sequence_id, _, prompt_id, _ = await prepare(db)
            db.add(Model(id='text-review', name='qwen-test', category='text', provider_id='provider1'))
            service = ReviewRevisionService(db, 'p1')
            body = ReviewRevisionRequest(prompt_revision_id=prompt_id, request_id='global-summary',
                instruction='整体修改', model_id='text-review')
            task = await service.generate_revision(sequence_id, body)
            context = task.input_snapshot['run_args']['revision_context']
            task.status = 'succeeded'
            changes = [] if status == 'unchanged' else [{'target': 'unit', 'path': '/duration_ms',
                'before': context['unit']['duration_ms'], 'after': 8000, 'reason': '部分修改'}]
            task.result = {'input_identity': context['input_identity'], 'changes': changes,
                'summary': {'status': status, 'reason': '整体仍待处理', 'choices': ['选择甲', '选择乙'] if status == 'needs_choice' else []}}
            before = await db.scalar(select(func.count()).select_from(DirectingRevision))
            candidate = (await service.read_task(task.id)).revision
            assert candidate.summary.status == status and candidate.preview_text
            with pytest.raises(ValueError, match='未解决'):
                await service.apply_revision(sequence_id, ApplyReviewRevisionRequest(task_id=task.id,
                    input_identity=candidate.input_identity, candidate_identity=candidate.candidate_identity,
                    instruction=body.instruction, request_id='blocked-summary'))
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == before


@pytest.mark.parametrize('summary', [
    {'status': 'planned', 'reason': '没有差异'},
    {'status': 'needs_choice', 'reason': '没有足够选项', 'choices': ['唯一选项']},
])
def test_global_summary_rejects_contradictory_status(summary):
    from app.services.directing.review_revision import validate_candidate
    context = {'design': design_sample(), 'unit': plan_sample('design1')['units'][0],
        'input_identity': 'frozen', 'directions': [], 'problem_keys': []}
    with pytest.raises(ValueError):
        validate_candidate(context, {'input_identity': 'frozen', 'summary': summary})


def test_deferred_review_sound_also_updates_planned_global_summary():
    from app.services.directing.review_revision import validate_candidate, problem_key
    design = design_sample()
    design['sound']['execution'] = 'unknown'
    direction = {'occurrence_id': 'o1', 'role': 'prompt', 'finding_index': -1, 'text': ''}
    key = problem_key(direction)
    context = {'design': design, 'unit': plan_sample('design1')['units'][0], 'input_identity': 'frozen',
               'directions': [direction], 'problem_keys': [key]}
    candidate, updated, _ = validate_candidate(context, {'input_identity': 'frozen',
        'summary': {'status': 'planned', 'reason': '采用声音方案'},
        'changes': [{'target': 'design', 'path': '/sound/execution', 'before': 'unknown',
                     'after': 'generated', 'reason': 'AI猜测', 'problem_keys': [key]}],
        'outcomes': [{'problem_key': key, 'status': 'planned', 'reason': '已规划'}]})
    assert candidate.changes == [] and updated.sound.execution == 'unknown'
    assert candidate.outcomes[0].status == 'needs_choice'
    assert candidate.summary.status == 'needs_choice'
    assert candidate.summary.choices == candidate.outcomes[0].choices
