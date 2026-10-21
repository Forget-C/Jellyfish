"""通过 HTTP、真实任务与保存验证整镜组织和局部动作的范围边界。"""
import json
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.models.task import Task
from app.services.directing.ai import DirectingOutputError, generate_directing_result
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


def note(text):
    return {'state': 'proposal', 'text': text,
            'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]} if text else {}


@asynccontextmanager
async def scope_case(tmp_path, shot_text, *, existing=False):
    """只替换模型响应；提交、冻结输入、任务状态、预览与保存均走现有入口。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '范围回归'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': ['beat'], 'event_ids': ['event'],
            'blocking_state_ids': [], 'participant_ids': ['reader'], 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': note(shot_text)}]
        content['design']['participants'] = [{'id': 'reader', 'name': '读信者'}]
        content['design']['direction']['beats'] = [{'id': 'beat', 'event_ids': [],
            'objective': {}, 'obstacle': {}, 'expected_change': {}, 'must_show': note('拆信；读信；抬头')}]
        content['design']['events'] = [{'id': 'event', 'description': note('拆信；读信；抬头')}]
        if existing:
            content['units'] = [{'id': 'unit', 'ratio': '16:9',
                'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': ''}]}]
        body = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
                'shot_id': 'shot', 'target_model_id': 'video', 'model_id': 'text',
                'source_unit_id': 'unit' if existing else None}
        yield sessions, client, detail, version, body


def proposal(scope, **selection):
    return {'shot_id': 'shot', 'target_model_id': 'video', 'organization': '组织既有设计',
            'units': [{'id': 'unit', 'operation': 'create', 'ratio': '16:9', 'reason': '明确本次范围',
                       'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': scope, **selection}]}]}


@pytest.mark.asyncio
@pytest.mark.parametrize('existing', [False, True])
async def test_complete_shot_scope_accepts_related_design_without_verbatim_duplication(tmp_path, existing):
    # 来自实际失败任务的三份设计正文；同一环境以不同措辞表达。
    shot_text = '风雨交加的夜晚胡同中，一辆白色面包车停在路边，路灯照亮雨丝。'
    beat_text = '风雨、夜晚、胡同小路、白色面包车。'
    event_text = '风雨交加的夜晚，胡同小路环境确立。'
    async with scope_case(tmp_path, shot_text, existing=existing) as (sessions, client, detail, version, body):
        content = body['content']
        content['design']['direction']['beats'][0]['must_show'] = note(beat_text)
        content['design']['events'][0]['description'] = note(event_text)
        url = detail + '/unit-design-suggestions'
        submitted = await client.post(url, json=body)
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        proposed = proposal(shot_text, beat_ids=['beat'], event_ids=['event'])
        proposed['units'][0]['operation'] = 'modify' if existing else 'create'
        calls = []

        def invoke(messages):
            calls.append(deepcopy(messages))
            return SimpleNamespace(content=json.dumps(proposed))

        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=invoke), task.input_snapshot['run_args'])
            await service.finish(task_id, result=result.model_dump(mode='json'))
        assert len(calls) == 1
        preview = await client.post(f'{url}/{task_id}/preview', json={'content': content})
        assert preview.status_code == 200, preview.text
        coverage = preview.json()['data']['result']['units'][0]['coverage'][0]
        assert coverage['action_scope'] == shot_text
        assert coverage['beat_ids'] == ['beat'] and coverage['event_ids'] == ['event']
        applied = await client.post(f'{url}/{task_id}/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        assert (await client.get(detail)).json()['data'] == version
        organized = applied.json()['data']
        basis = await client.post(detail + '/units/unit/instruction-basis', json={'content': organized})
        assert basis.status_code == 200, basis.text
        execution = basis.json()['data']['current']['scope']['execution']
        assert {row['text'] for row in execution} == {shot_text, beat_text, event_text}
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': organized})
        assert saved.status_code == 200, saved.text
        assert (await client.get(detail)).json()['data']['content']['units'][0]['coverage'][0] == coverage


@pytest.mark.asyncio
@pytest.mark.parametrize('selection,owner,field', [
    ('beat_ids', 'beat', 'must_show'), ('event_ids', 'event', 'description'),
    ('performance_action_ids', 'performance', 'physical_action'),
    ('staging_activity_ids', 'activity', 'ongoing_task'), ('continuity_change_ids', 'continuity', 'change'),
])
@pytest.mark.parametrize('repair', [False, True])
async def test_partial_scope_repairs_once_without_expanding_execution(tmp_path, selection, owner, field, repair):
    async with scope_case(tmp_path, '拆信；读信；抬头', existing=True) as (sessions, client, detail, version, body):
        content = body['content']
        design = content['design']
        if owner == 'performance':
            row = {key: {} for key in ('objective', 'obstacle', 'subtext', 'attention', 'internal_adjustment',
                'physical_action', 'delivery', 'reaction_order', 'exit_state', 'avoid')}
            row.update(id=owner, beat_id='beat', participant_id='reader', received_event_ids=[], dialogue_ids=[], criterion_ids=[])
            design['performance']['beats'] = [row]
        elif owner == 'activity':
            row = {key: {} for key in ('depth', 'ongoing_task', 'path', 'attention', 'reaction_delay',
                'intensity', 'entrances_exits', 'narrative_support', 'end_state')}
            row.update(id=owner, participant_id='reader')
            design['staging']['activities'] = [row]
        elif owner == 'continuity':
            row = {'id': owner, 'domain': 'hands_props', 'before': {}, 'after': {}, 'following_constraint': {}}
            design['continuity'] = [row]
        if owner in {'performance', 'activity', 'continuity'}:
            row[field] = note('拆信；读信；抬头')
            kind = {'performance': 'performance_beat', 'activity': 'staging_activity', 'continuity': 'continuity'}[owner]
            design['applicability'] = [{'subject': {'kind': kind, 'id': owner, 'field': field},
                'purpose': 'design', 'scope': 'shots', 'shot_ids': ['shot']}]
        body['instruction'] = '只补拍抬头'
        url = detail + '/unit-design-suggestions'
        submitted = await client.post(url, json=body)
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        bad = proposal('抬头', **{selection: [owner]})
        bad['units'][0]['operation'] = 'modify'
        corrected = deepcopy(bad)
        corrected['units'][0]['coverage'][0][selection] = []
        calls = []

        def invoke(messages):
            calls.append(deepcopy(messages))
            return SimpleNamespace(content=json.dumps(corrected if repair and len(calls) == 2 else bad))

        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            if repair:
                result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=invoke), task.input_snapshot['run_args'])
                await service.finish(task_id, result=result.model_dump(mode='json'))
            else:
                with pytest.raises(DirectingOutputError, match='局部执行不能同时选择范围外的完整动作') as invalid:
                    generate_directing_result('directing_unit_design', SimpleNamespace(invoke=invoke), task.input_snapshot['run_args'])
                await service.finish(task_id, error=str(invalid.value), error_code='directing_output_invalid')
        assert len(calls) == 2
        feedback = calls[1][-1].content
        assert f'{owner}:{owner}.{field}' in feedback
        assert 'unit' in feedback and 'coverage' in feedback
        assert (await client.get(detail)).json()['data'] == version
        record = next(row for row in (await client.get(url)).json()['data'] if row['task_id'] == task_id)
        if not repair:
            assert record['status'] == 'failed' and record['result'] is None
            assert (await client.post(f'{url}/{task_id}/preview', json={'content': content})).status_code == 422
            assert (await client.post(f'{url}/{task_id}/apply', json={'content': content})).status_code == 422
            return
        assert record['status'] == 'succeeded'
        preview = await client.post(f'{url}/{task_id}/preview', json={'content': content})
        assert preview.status_code == 200, preview.text
        applied = await client.post(f'{url}/{task_id}/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        organized = applied.json()['data']
        assert organized['units'][0]['coverage'][0]['action_scope'] == '抬头'
        assert organized['units'][0]['coverage'][0][selection] == []
        basis = await client.post(detail + '/units/unit/instruction-basis', json={'content': organized})
        assert basis.status_code == 200, basis.text
        scope = basis.json()['data']['current']['scope']
        assert [row['text'] for row in scope['execution']] == ['抬头']
        assert any(row['text'] == '拆信；读信；抬头' for row in scope['background'])
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': organized})
        assert saved.status_code == 200, saved.text
        assert (await client.get(detail)).json()['data']['content']['units'][0]['coverage'][0]['action_scope'] == '抬头'


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario', ['structure-then-scope', 'scope-then-structure',
    'scope-then-expanded', 'scope-then-renamed', 'empty-shot'])
async def test_unit_scope_repair_budget_and_partial_target_are_preserved(tmp_path, scenario):
    async with scope_case(tmp_path, '' if scenario == 'empty-shot' else '拆信；读信；抬头') as (sessions, client, detail, version, body):
        url = detail + '/unit-design-suggestions'
        submitted = await client.post(url, json={**body, 'instruction': '只拍抬头'})
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        partial = proposal('抬头', event_ids=['event'])
        responses = [partial, deepcopy(partial)]
        expected = '局部执行不能同时选择范围外的完整动作'
        if scenario == 'structure-then-scope':
            responses[0] = {'units': []}
        elif scenario == 'scope-then-structure':
            responses[1] = {'units': []}
            expected = '结构校验失败'
        elif scenario.startswith('scope-then-'):
            if scenario == 'scope-then-expanded':
                responses[1]['units'][0]['coverage'][0]['action_scope'] = '拆信；读信；抬头'
            else:
                responses[1]['units'][0]['id'] = 'replacement'
                responses[1]['units'][0]['coverage'][0]['event_ids'] = []
            expected = '纠错不能改变局部执行目标'
        calls = []

        def invoke(messages):
            calls.append(deepcopy(messages))
            return SimpleNamespace(content=json.dumps(responses[len(calls) - 1]))

        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            with pytest.raises(DirectingOutputError, match=expected) as invalid:
                generate_directing_result('directing_unit_design', SimpleNamespace(invoke=invoke), task.input_snapshot['run_args'])
            await service.finish(task_id, error=str(invalid.value), error_code='directing_output_invalid')
        assert len(calls) == 2
        assert (await client.get(detail)).json()['data'] == version
        assert (await client.post(f'{url}/{task_id}/apply', json={'content': body['content']})).status_code == 422
