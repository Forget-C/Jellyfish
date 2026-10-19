"""单元固定依据经真实场次版本接口核对，执行选择不从同镜关系推定。"""

from copy import deepcopy
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_unit_basis_separates_selected_actions_constraints_and_consumed_background(tmp_path):
    """同镜两单元分别消费行动；局部、全场及声音规则保留各自作用范围。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '分别拍摄',
        })).json()['data']
        content = deepcopy(version['content'])
        design = content['design']
        note = lambda text: {'state': 'proposal', 'text': text,
            'sources': [{'kind': 'human', 'reference': 'scope-test', 'version': '1'}]}
        design['participants'] = [{'id': 'person', 'name': '读信者'}]
        design['direction']['viewpoint'] = note('从读信者视点看旧信')
        design['direction']['spatial_basis'] = note('桌旁保持读信者可见')
        design['direction']['axis'] = note('保持人物在桌左侧')
        design['direction']['shots'] = [{'id': 'shot', 'beat_ids': ['beat'], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': ['person'], 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': note('打开信封')}]
        design['direction']['beats'] = [{'id': 'beat', 'event_ids': [], 'objective': {},
            'obstacle': {}, 'expected_change': {}, 'must_show': {}}]
        design['performance']['situations'] = [{'id': 'situation', 'participant_id': 'person',
            'situation': note('等待回信多年'), 'relationship': {}}]
        design['performance']['beats'] = [{'id': 'action', 'beat_id': 'beat', 'participant_id': 'person',
            'received_event_ids': [], 'objective': {}, 'obstacle': {}, 'subtext': {}, 'attention': {},
            'internal_adjustment': {}, 'physical_action': note('手指迟疑后拆开信封'),
            'dialogue_ids': [], 'delivery': {}, 'reaction_order': {}, 'exit_state': {},
            'avoid': {}, 'criterion_ids': []}]
        design['staging']['activities'] = [{'id': 'activity', 'participant_id': 'person',
            'depth': {}, 'ongoing_task': note('窗外行人经过'), 'path': {}, 'attention': {},
            'reaction_delay': {}, 'intensity': {}, 'entrances_exits': {},
            'narrative_support': {}, 'end_state': {}}]
        design['prompt']['prohibitions'] = note('不可改变信件落款')
        design['sound']['music_constraints'] = note('音乐留待后期')
        content['units'] = [
            {'id': 'unit-person', 'ratio': '16:9', 'instruction': '拍人物拆信',
             'coverage': [{'id': 'cover-person', 'shot_id': 'shot', 'action_scope': '拍人物拆信',
                           'performance_action_ids': ['action']}]},
            {'id': 'unit-background', 'ratio': '16:9', 'instruction': '拍窗外行人',
             'coverage': [{'id': 'cover-background', 'shot_id': 'shot', 'action_scope': '拍窗外行人',
                           'staging_activity_ids': ['activity']}]},
        ]
        design['applicability'] = [
            {'subject': {'kind': 'staging_activity', 'id': 'activity', 'field': 'ongoing_task'},
             'purpose': 'design', 'scope': 'occurrences',
             'occurrences': [{'unit_id': 'unit-background', 'coverage_item_id': 'cover-background'}]},
            {'subject': {'kind': 'direction', 'field': 'axis'}, 'purpose': 'constraint',
             'scope': 'occurrences', 'phase': 'video',
             'occurrences': [{'unit_id': 'unit-person', 'coverage_item_id': 'cover-person'}]},
            {'subject': {'kind': 'direction', 'field': 'spatial_basis'}, 'purpose': 'constraint',
             'scope': 'occurrences', 'phase': 'video',
             'occurrences': [{'unit_id': 'unit-person', 'coverage_item_id': 'cover-person'}]},
            {'subject': {'kind': 'prompt', 'field': 'prohibitions'}, 'purpose': 'constraint',
             'scope': 'scene_rule', 'phase': 'video'},
            {'subject': {'kind': 'sound', 'field': 'music_constraints'}, 'purpose': 'constraint',
             'scope': 'scene_rule', 'phase': 'sound'},
        ]
        detail = path + '/versions/' + version['id']
        saved = await client.put(detail, json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        basis_ids = {}
        for unit_id, action, absent in [('unit-person', 'performance:action', 'activity:activity'),
                                        ('unit-background', 'activity:activity', 'performance:action')]:
            url = detail + f'/units/{unit_id}/instruction-basis'
            response = await client.post(url,
                json={'content': saved.json()['data']['content']})
            assert response.status_code == 200, response.text
            scope = response.json()['data']['current']['scope']
            assert any(row['owner'] == action for row in scope['execution'])
            assert not any(row['owner'] == absent for row in scope['execution'])
            assert next(row for row in scope['execution'] if row['owner'] == action)['coverage_item_ids'] == [
                'cover-person' if unit_id == 'unit-person' else 'cover-background']
            assert any(row['owner'] == 'prompt' and row['field'] == 'prohibitions'
                       and row['phase'] == 'video' for row in scope['constraints'])
            assert any(row['owner'] == 'sound' and row['field'] == 'music_constraints'
                       and row['phase'] == 'sound' for row in scope['constraints'])
            assert any(row['owner'] == 'space' and row['field'] == 'spatial_basis'
                       for row in scope['constraints']) == (unit_id == 'unit-person')
            assert any(row['owner'] == 'space' and row['field'] == 'spatial_basis'
                       and row['sources'] for row in scope['background']) == (unit_id == 'unit-background')
            assert any(row['owner'] == 'overview' and row['field'] == 'viewpoint'
                       for row in scope['background'])
            assert any(row['owner'] == 'situation:situation' and row['field'] == 'situation'
                       for row in scope['background'])
            local = [row for row in scope['constraints'] if row['owner'] == 'space' and row['field'] == 'axis']
            assert len(local) == (1 if unit_id == 'unit-person' else 0)
            if local:
                assert local[0]['coverage_item_ids'] == ['cover-person']
            receipt = await client.post(url + '/confirm', json={'request_id': str(uuid4()),
                'expected_revision': 2, 'content': saved.json()['data']['content']})
            assert receipt.status_code == 200, receipt.text
            basis_ids[unit_id] = receipt.json()['data']['basis_id']
        changed = deepcopy(saved.json()['data']['content'])
        for row in changed['units']:
            row['instruction_basis_id'] = basis_ids[row['id']]
        changed['design']['staging']['activities'][0]['ongoing_task']['text'] = '窗外行人改为停住'
        for unit_id, expected in [('unit-person', 'current'), ('unit-background', 'changed')]:
            response = await client.post(detail + f'/units/{unit_id}/instruction-basis',
                json={'content': changed})
            assert response.status_code == 200, response.text
            assert response.json()['data']['status'] == expected
        for field, results in [('axis', ('changed', 'current')),
                               ('prohibitions', ('changed', 'changed'))]:
            edited = deepcopy(saved.json()['data']['content'])
            for row in edited['units']:
                row['instruction_basis_id'] = basis_ids[row['id']]
            target = edited['design']['direction'] if field == 'axis' else edited['design']['prompt']
            target[field]['text'] += '，本次重新确认'
            for unit_id, expected in zip(('unit-person', 'unit-background'), results):
                response = await client.post(detail + f'/units/{unit_id}/instruction-basis',
                    json={'content': edited})
                assert response.status_code == 200, response.text
                assert response.json()['data']['status'] == expected


@pytest.mark.asyncio
async def test_unknown_participant_scope_can_save_but_blocks_instruction_check(tmp_path):
    """人物情境无法判定消费范围时保留草稿，检查不能把 null 当作全部或无人。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='scope-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='scope-text', name='scope-text', category='text', provider_id='scope-provider', params={}),
                        Model(id='scope-video', name='scope-video', category='video', provider_id='scope-provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '人物待核对',
        })).json()['data']
        content = deepcopy(version['content'])
        content['design']['participants'] = [{'id': 'person', 'name': '读信者'}]
        content['design']['performance']['situations'] = [{'id': 'situation', 'participant_id': 'person',
            'situation': {'state': 'proposal', 'text': '等待回信多年',
                'sources': [{'kind': 'human', 'reference': 'scope-test', 'version': '1'}]}, 'relationship': {}}]
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': None, 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'ratio': '16:9', 'model_id': 'scope-video',
            'duration_ms': 5000, 'instruction': '固定镜头拍旧信',
            'coverage': [{'id': 'cover', 'shot_id': 'shot', 'action_scope': '旧信特写'}]}]
        detail = path + '/versions/' + version['id']
        saved = await client.put(detail, json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        saved_content = saved.json()['data']['content']
        url = detail + '/units/unit/instruction-basis'
        state = await client.post(url, json={'content': saved_content})
        assert state.status_code == 200, state.text
        assert state.json()['data']['current']['scope']['unresolved'] == ['镜头 shot 的参与对象范围待核对']
        receipt = await client.post(url + '/confirm', json={'request_id': str(uuid4()),
            'expected_revision': 2, 'content': saved_content})
        assert receipt.status_code == 200, receipt.text
        saved_content['units'][0]['instruction_basis_id'] = receipt.json()['data']['basis_id']
        response = await client.post(detail + '/units/unit/instruction-checks', json={
            'request_id': str(uuid4()), 'expected_revision': 2,
            'content': saved_content, 'model_id': 'scope-text'})
        assert response.status_code == 422, response.text
        assert '参与对象范围待核对' in response.text
        preparation = await client.post(detail + '/units/unit/video/prepare',
            json={'expected_revision': 2})
        assert preparation.status_code == 422, preparation.text
        assert '参与对象范围待核对' in preparation.text
