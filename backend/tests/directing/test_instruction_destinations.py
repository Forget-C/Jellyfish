"""检查去向必须对应固定视频要求、真实正文和实际绑定参考。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.core.contracts.directing.unit_scope import UnitScopeProjection, UnitScopeUse
from app.core.contracts.directing.instruction_check import InstructionCheckResult
from app.core.contracts.directing.production import ReferenceBinding
from app.models.llm import Model, Provider
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database
from tests.directing.samples import complete_shot_scope_sample, note


def test_instruction_destinations_reject_missing_or_unbound_evidence():
    scope = UnitScopeProjection(execution=[UnitScopeUse(owner='coverage:c1', field='action_scope',
        text='递出信封', sources=[], reason='选中', coverage_item_ids=['c1'], phase='video')],
        constraints=[UnitScopeUse(owner='space', field='axis', text='保持左侧轴线', sources=[],
            reason='适用于本单元', coverage_item_ids=['c1'], phase='video')],
        background=[], unresolved=[])
    rows = [{'role': role, 'occurrence_id': 'c1', 'verdict': 'pass', 'rationale': '已核对', 'findings': []}
            for role in ('direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt')]
    action = {'owner': 'coverage:c1', 'field': 'action_scope', 'coverage_item_ids': ['c1'],
              'destination': 'instruction', 'instruction_excerpt': '递出信封', 'rationale': '正文'}
    axis = {'owner': 'space', 'field': 'axis', 'coverage_item_ids': ['c1'],
            'destination': 'instruction', 'instruction_excerpt': '保持左侧轴线', 'rationale': '正文'}

    def validate(destinations, *, instruction='递出信封，保持左侧轴线。', references=()):
        return InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
            'destinations': destinations}).validate_scope('u1', ['c1'], scope=scope,
                instruction=instruction, references=references, require_destinations=True)

    assert validate([action, axis]).destinations[0].owner == 'coverage:c1'
    assert InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows}).validate_scope(
        'u1', ['c1'], scope=scope).destinations is None
    with pytest.raises(ValueError, match='缺少视频要求'):
        validate(None)
    with pytest.raises(ValueError, match='遗漏'):
        validate([action])
    with pytest.raises(ValueError, match='正文去向'):
        validate([action, axis], instruction='保持左侧轴线。')
    reference_axis = {**axis, 'destination': 'reference', 'instruction_excerpt': None,
                      'reference_id': 'frame-1'}
    with pytest.raises(ValueError, match='实际绑定'):
        validate([action, reference_axis])
    binding = ReferenceBinding.model_validate({'id': 'frame-1', 'file_id': 'file-1',
        'media_kind': 'image', 'purpose': 'space', 'participant_ids': [], 'ordinal': 0,
        'source': {'kind': 'file', 'reference': 'file-1', 'version': '1', 'file_id': 'file-1'}})
    assert validate([action, reference_axis], instruction='递出信封。', references=[binding])
    action_reference = {**deepcopy(action), 'destination': 'reference', 'instruction_excerpt': None,
                        'reference_id': 'frame-1'}
    with pytest.raises(ValueError, match='动作须由正文'):
        validate([action_reference, reference_axis], references=[binding])
    prompt = UnitScopeUse(owner='prompt', field='prohibitions', text='不得出现文字',
                          sources=[], reason='全场', coverage_item_ids=['c1'], phase='video')
    prompt_scope = scope.model_copy(update={'constraints': [*scope.constraints, prompt]})
    claimed_reference = {**reference_axis, 'owner': 'prompt', 'field': 'prohibitions'}
    with pytest.raises(ValueError, match='用途匹配'):
        InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
            'destinations': [action, axis, claimed_reference]}).validate_scope(
                'u1', ['c1'], scope=prompt_scope, instruction='递出信封，保持左侧轴线。',
                references=[binding], require_destinations=True)
    identity = UnitScopeUse(owner='participant:reader', field='identity', text='读信者',
                            sources=[], reason='当前镜头参与对象', coverage_item_ids=['c1'], phase='video')
    identity_scope = scope.model_copy(update={'constraints': [*scope.constraints, identity]})
    identity_binding = ReferenceBinding.model_validate({**binding.model_dump(mode='json'),
        'id': 'portrait', 'purpose': 'identity', 'participant_ids': ['reader']})
    identity_destination = {'owner': 'participant:reader', 'field': 'identity',
        'coverage_item_ids': ['c1'], 'destination': 'reference', 'reference_id': 'portrait',
        'rationale': '实际绑定的人物参考'}
    assert InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
        'destinations': [action, axis, identity_destination]}).validate_scope(
            'u1', ['c1'], scope=identity_scope, instruction='递出信封，保持左侧轴线。',
            references=[identity_binding], require_destinations=True)
    with pytest.raises(ValueError, match='用途匹配'):
        InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
            'destinations': [action, axis, identity_destination]}).validate_scope(
                'u1', ['c1'], scope=identity_scope, instruction='递出信封，保持左侧轴线。',
                references=[binding], require_destinations=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('destination', [None, 'unresolved', 'missing_camera', 'camera'])
async def test_check_requires_complete_video_destinations(tmp_path, destination):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='video-test', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '去向检查'})).json()['data']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'model_id': 'video', 'duration_ms': 5000, 'ratio': '16:9',
            'instruction': '递出信封。', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '递出信封'}]}]
        complete_shot_scope_sample(content, '递出信封')
        if destination in {'missing_camera', 'camera'}:
            content['design']['cinematography'][0]['composition'] = note('信封始终在画内')
            content['design']['applicability'] = [{
                'subject': {'kind': 'camera', 'id': 'camera-shot', 'field': 'composition'},
                'purpose': 'design', 'scope': 'shots', 'shot_ids': ['shot']}]
            content['units'][0]['instruction'] += '信封始终在画内。'

        unit_url = path + '/versions/' + version['id'] + '/units/unit'
        confirmed = await client.post(unit_url + '/instruction-basis/confirm', json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert confirmed.status_code == 200, confirmed.text
        content['units'][0]['instruction_basis_id'] = confirmed.json()['data']['basis_id']
        checks_url = unit_url + '/instruction-checks'
        submitted = await client.post(checks_url, json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content, 'model_id': 'text'})
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        result = {'unit_id': 'unit', 'rows': [{'role': role, 'occurrence_id': 'coverage',
            'verdict': 'pass', 'rationale': '已核对', 'findings': []} for role in
            ('direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt')],
            'destinations': [] if destination is None else [{'owner': 'coverage:coverage',
                'field': 'action_scope', 'coverage_item_ids': ['coverage'],
                'destination': 'unresolved', 'rationale': '正文未表达'}]}
        if destination in {'missing_camera', 'camera'}:
            result['destinations'] = [
                {'owner': owner, 'field': field, 'coverage_item_ids': ['coverage'],
                 'destination': 'instruction', 'instruction_excerpt': '递出信封', 'rationale': '正文表达'}
                for owner, field in [('coverage:coverage', 'action_scope')]]
            if destination == 'camera':
                result['destinations'].append({'owner': 'camera:camera-shot', 'field': 'composition',
                    'coverage_item_ids': ['coverage'], 'destination': 'instruction',
                    'instruction_excerpt': '信封始终在画内', 'rationale': '正文表达构图'})
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='destination-test')
            await service.finish(task_id, result=result)
        response = await client.post(checks_url + '/' + task_id + '/confirm', json={'content': content})
        assert response.status_code == (200 if destination == 'camera' else 422), response.text
        if destination != 'camera':
            assert '去向' in response.json()['detail']
        if destination == 'missing_camera':
            assert 'camera:camera-shot.composition' in response.json()['detail']
