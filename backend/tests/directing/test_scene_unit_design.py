"""单元 AI 设计经真实 HTTP 与任务生命周期返回只读方案。"""
import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.models.task import Task
from app.services.directing.ai import generate_directing_result
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_first_unit_design_freezes_unsaved_input_and_previews_without_save(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '单元设计'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {},
            'visible_result': {'state': 'proposal', 'text': '抬头', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}}]
        content['design']['events'] = [{'id': 'event-1', 'description': {'state': 'proposal', 'text': '放下信', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}}]
        content['design']['direction']['shots'][0]['event_ids'] = ['event-1']
        content['design']['participants'] = [{'id': 'reader', 'name': '读信者'}]
        content['design']['direction']['shots'][0]['participant_ids'] = ['reader']
        content['design']['direction']['beats'] = [{'id': 'beat-1', 'event_ids': [],
            'objective': {}, 'obstacle': {}, 'expected_change': {}, 'must_show': {}}]
        content['design']['direction']['shots'][0]['beat_ids'] = ['beat-1']
        action = {field: {} for field in ('objective', 'obstacle', 'subtext', 'attention',
            'internal_adjustment', 'physical_action', 'delivery', 'reaction_order', 'exit_state', 'avoid')}
        action.update(id='action-1', beat_id='beat-1', participant_id='reader',
            received_event_ids=[], dialogue_ids=[], criterion_ids=[],
            physical_action=deepcopy(content['design']['direction']['shots'][0]['visible_result']),
            gaze={'state': 'proposal', 'text': '视线保持稳定', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]})
        content['design']['performance']['beats'] = [action]
        content['design']['applicability'] = [{'subject': {'kind': 'performance_beat', 'id': 'action-1', 'field': field},
            'purpose': 'design', 'scope': 'shots', 'shot_ids': ['shot']} for field in ('physical_action', 'gaze')]
        body = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
                'shot_id': 'shot', 'target_model_id': 'video', 'model_id': 'text', 'instruction': '完整拍摄抬头'}
        url = detail + '/unit-design-suggestions'
        response = await client.post(url, json=body)
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        history = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        origin = next(row['source'] for row in history if row['task_id'] == task_id)
        assert origin['version_id'] == version['id'] and origin['shot_id'] == 'shot'
        assert (await client.post(url, json=body)).json()['data']['task_id'] == task_id
        assert (await client.post(url, json={**body, 'instruction': '另一要求'})).status_code == 409
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            assert task.input_snapshot['run_args']['task_identity']
            assert task.input_snapshot['run_args']['organization_inputs']['context']['participants'][0]['name'] == '读信者'
            proposed = {'shot_id': 'shot', 'target_model_id': 'video', 'organization': '动作完整，单段拍摄',
                'units': [{'id': 'unit-1', 'coverage': [{'id': 'coverage-1', 'shot_id': 'shot', 'action_scope': '抬头', 'performance_action_ids': ['action-1']}],
                    'duration_ms': None, 'ratio': '16:9', 'reason': '完整动作', 'entry_state': '', 'exit_state': '',
                    'reference_requirements': ['需要人物身份参考'], 'missing': ['尚未绑定真实参考']}],
                'missing': []}
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            await service.finish(task_id, result=result.model_dump(mode='json'))
        rows = (await client.get(url)).json()['data']
        assert rows[0]['result']['units'][0]['coverage'][0]['action_scope'] == '抬头'
        preview = await client.post(url + '/' + task_id + '/preview', json={'content': content})
        assert preview.status_code == 200, preview.text
        assert preview.json()['data']['result']['units'][0]['reference_requirements'] == ['需要人物身份参考']
        assert (await client.get(detail)).json()['data'] == version
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        organized = applied.json()['data']
        assert organized['units'][0]['organization']['reference_requirements'] == ['需要人物身份参考']
        assert organized['units'][0]['instruction_basis_id'] is None
        assert (await client.get(detail)).json()['data'] == version
        changed = deepcopy(content)
        changed['design']['direction']['shots'][0]['visible_result']['text'] = '低头'
        assert (await client.post(url + '/' + task_id + '/apply', json={'content': changed})).status_code == 409

        # 未安排的镜头动作必须成为缺项，不能把局部结果显示为完整准备。
        partial_content = deepcopy(content)
        partial_content['design']['direction']['shots'][0]['visible_result']['text'] = '抬头；放下信'
        partial = await client.post(url, json={**body, 'request_id': str(uuid4()), 'content': partial_content})
        assert partial.status_code == 200, partial.text
        partial_id = partial.json()['data']['task_id']
        async with sessions.begin() as db:
            task = await db.get(Task, partial_id)
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(partial_id, worker_id='fixture')
            await service.finish(partial_id, result=result.model_dump(mode='json'))
        partial_rows = (await client.get(url)).json()['data']
        candidate = next(row for row in partial_rows if row['task_id'] == partial_id)
        assert '镜头可见结果尚有未安排内容，请核对完整覆盖' in candidate['result']['missing']

        # 非法方案整份失败；真实任务记录可读，版本与媒体状态不变。
        for change in ('event', 'model', 'shot', 'new-action', 'unknown-duration', 'write-design', 'multiple-coverage', 'new-entry-state', 'selection-scope-mismatch'):
            accepted = await client.post(url, json={**body, 'request_id': str(uuid4())})
            assert accepted.status_code == 200, accepted.text
            invalid_id = accepted.json()['data']['task_id']
            bad = deepcopy(proposed)
            if change == 'event':
                bad['units'][0]['coverage'][0]['event_ids'] = ['invented-event']
            elif change == 'model':
                bad['target_model_id'] = 'another-video'
            elif change == 'shot':
                bad['units'][0]['coverage'][0]['shot_id'] = 'another-shot'
            elif change == 'new-action':
                bad['units'][0]['coverage'][0]['action_scope'] = '转身离开'
            elif change == 'unknown-duration':
                bad['units'][0]['duration_ms'] = 15000
            elif change == 'selection-scope-mismatch':
                bad['units'][0]['coverage'][0]['event_ids'] = ['event-1']
            elif change == 'new-entry-state':
                bad['units'][0]['entry_state'] = '人物突然掏枪'
            elif change == 'multiple-coverage':
                bad['units'][0]['coverage'].append({'id': 'coverage-2', 'shot_id': 'shot', 'action_scope': '抬头'})
            else:
                bad['design'] = content['design']
            async with sessions.begin() as db:
                task = await db.get(Task, invalid_id)
                service = TaskService(db)
                assert await service.claim(invalid_id, worker_id='fixture')
                with pytest.raises(ValueError) as invalid:
                    generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(bad))), task.input_snapshot['run_args'])
                await service.finish(invalid_id, error=str(invalid.value), error_code='directing_output_invalid')
            failed = next(row for row in (await client.get(url)).json()['data'] if row['task_id'] == invalid_id)
            assert failed['status'] == 'failed' and failed['result'] is None and failed['error']
            assert (await client.get(detail)).json()['data'] == version
        assert (await client.post(url, json={**body, 'request_id': str(uuid4()), 'shot_id': 'absent'})).status_code == 422
        missing_model = {key: value for key, value in body.items() if key != 'target_model_id'}
        assert (await client.post(url, json=missing_model)).status_code == 422
        assert (await client.post(url.replace('/p1/', '/p2/'), json={**body, 'request_id': str(uuid4())})).status_code == 422

        # 无效组织来源或身份整份拒绝，不能部分保存。
        for field, value in (('source', {'kind': 'model', 'reference': 'absent-task', 'version': '1'}), ('id', 'invented-unit')):
            invalid = deepcopy(organized)
            if field == 'source':
                invalid['units'][0]['organization']['source'] = value
            else:
                invalid['units'][0][field] = value
            rejected = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': invalid})
            assert rejected.status_code == 422, rejected.text
            assert (await client.get(detail)).json()['data'] == version

        # 确认后、手动保存前模型变化也必须拒绝。
        async with sessions.begin() as db:
            model = await db.get(Model, 'video')
            model.name = 'sora-2-pro'
        save = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': organized}
        rejected = await client.put(detail, json=save)
        assert rejected.status_code == 409, rejected.text
        assert (await client.get(detail)).json()['data'] == version
        async with sessions.begin() as db:
            model = await db.get(Model, 'video')
            model.name = 'sora-2'
        async with sessions.begin() as db:
            db.add(Provider(id='another-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            model = await db.get(Model, 'video')
            model.provider_id = 'another-provider'
        swapped = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert swapped.status_code == 409, swapped.text
        async with sessions.begin() as db:
            model = await db.get(Model, 'video')
            model.provider_id = 'provider'
        related_change = deepcopy(organized)
        related_change['design']['performance']['beats'][0]['physical_action']['state'] = 'fact'
        rejected = await client.put(detail, json={**save, 'request_id': str(uuid4()), 'content': related_change})
        assert rejected.status_code == 409, rejected.text
        unrelated = deepcopy(content['design']['direction']['shots'][0])
        unrelated.update(id='independent', beat_ids=[], event_ids=[], participant_ids=[])
        unrelated['visible_result']['text'] = '窗外雨滴'
        organized['design']['direction']['shots'].append(unrelated)
        async with sessions.begin() as db:
            db.add(Model(id='manual-video', name='sora-2', category='video', provider_id='provider', params={}))
        organized['units'][0]['model_id'] = 'manual-video'
        organized['units'][0]['organization']['entry_state'] = '人工核对进入状态'
        basis = await client.post(detail + '/units/unit-1/instruction-basis', json={'content': organized})
        assert basis.status_code == 200, basis.text
        scope = basis.json()['data']['current']['scope']
        assert any(row['field'] == 'entry_state' and row['text'] == '人工核对进入状态' for row in scope['constraints'])
        assert not any(row['field'] in {'entry_state', 'exit_state', 'reason'} for row in scope['execution'])
        saved = await client.put(detail, json=save)
        assert saved.status_code == 200, saved.text
        readback = (await client.get(detail)).json()['data']['content']
        assert readback == saved.json()['data']['content']
        assert readback['design']['direction']['shots'][-1]['visible_result']['text'] == '窗外雨滴'
        assert readback['units'][0]['organization'] == organized['units'][0]['organization']
        conflict = await client.put(detail, json={**save, 'request_id': str(uuid4())})
        assert conflict.status_code == 409

        # 保存后普通局部编辑无需重新使用旧任务依据。
        organized['units'][0]['organization']['exit_state'] = '人工修订结束要求'
        async with sessions.begin() as db:
            model = await db.get(Model, 'video')
            model.name = 'sora-2-pro'
        ordinary = await client.put(detail, json={**save, 'expected_revision': 2, 'request_id': str(uuid4())})
        assert ordinary.status_code == 200, ordinary.text


@pytest.mark.asyncio
async def test_first_application_preserves_independent_and_mixed_units_and_rejects_manual_target(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '保留独立编辑'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        note = {'state': 'proposal', 'text': '抬头', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}
        content['design']['direction']['shots'] = [{'id': identity, 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {},
            'visible_result': deepcopy(note)} for identity in ('shot', 'other')]
        content['units'] = [{'id': 'mixed', 'ratio': '16:9', 'coverage': [
            {'id': 'target-part', 'shot_id': 'shot', 'action_scope': '抬头'},
            {'id': 'other-part', 'shot_id': 'other', 'action_scope': '抬头'}]}]
        initial = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert initial.status_code == 200, initial.text
        content = initial.json()['data']['content']
        url = detail + '/unit-design-suggestions'
        accepted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 2,
            'content': content, 'shot_id': 'shot', 'target_model_id': 'video', 'model_id': 'text'})
        assert accepted.status_code == 200, accepted.text
        task_id = accepted.json()['data']['task_id']
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps({
                'shot_id': 'shot', 'target_model_id': 'video', 'organization': '首次完整动作',
                'units': [{'id': 'new', 'ratio': '16:9', 'reason': '抬头',
                           'coverage': [{'id': 'new-coverage', 'shot_id': 'shot', 'action_scope': '抬头'}]}]}))), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            await service.finish(task_id, result=result.model_dump(mode='json'))
        # 生成期间独立其他镜头已保存；应用基于最新编辑，不回写提交快照。
        content['design']['direction']['shots'][1]['visible_result']['text'] = '放下信'
        content['units'].append({'id': 'independent', 'ratio': '16:9', 'coverage': [
            {'id': 'other-coverage', 'shot_id': 'other', 'action_scope': '放下信'}]})
        independent = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert independent.status_code == 200, independent.text
        content = independent.json()['data']['content']
        preview = await client.post(url + '/' + task_id + '/preview', json={'content': content})
        assert preview.status_code == 200, preview.text
        manual = deepcopy(content)
        manual['units'].append({'id': 'manual', 'ratio': '16:9', 'coverage': [
            {'id': 'manual-coverage', 'shot_id': 'shot', 'action_scope': '抬头'}]})
        for boundary in ('preview', 'apply'):
            assert (await client.post(url + '/' + task_id + '/' + boundary, json={'content': manual})).status_code == 409
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        candidate = applied.json()['data']
        assert candidate['units'][:2] == content['units']
        save = {'request_id': str(uuid4()), 'expected_revision': 3, 'content': candidate}
        saved = await client.put(detail, json=save)
        assert saved.status_code == 200, saved.text
        assert (await client.get(detail)).json()['data']['content'] == candidate


@pytest.mark.asyncio
async def test_selected_nonfinal_unit_revision_preserves_identity_and_other_configuration(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={}),
                        Model(id='old-video', name='sora-2-pro', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '明确目标局部修改'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        note = {'state': 'proposal', 'text': '拆信；读信；抬头', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}
        content['design']['direction']['shots'] = [{'id': identity, 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {},
            'visible_result': deepcopy(note)} for identity in ('shot', 'other')]
        content['units'] = [{'id': identity, 'model_id': 'old-video', 'duration_ms': 8000, 'ratio': '16:9',
            'instruction': '保留真实指令', 'instruction_source': {'kind': 'human', 'reference': 'user', 'version': '1'},
            'coverage': [{'id': identity + '-coverage', 'shot_id': shot, 'action_scope': '拆信；读信；抬头'}]}
            for identity, shot in (('target', 'shot'), ('retained', 'shot'), ('independent', 'other'))]
        target = content['units'][0]
        target['references'] = [{'id': 'frame', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'space',
            'input_role': 'first_frame', 'participant_ids': [], 'ordinal': 0,
            'source': {'kind': 'file', 'reference': 'image1', 'file_id': 'image1', 'version': '1'}}]
        target['scene_dependencies'] = [{'version_id': version['id'], 'clip_id': 'removed-clip'}]
        target['parameters'] = {'seed': 17}
        basis_url = detail + '/units/target/instruction-basis'
        receipt = await client.post(basis_url + '/confirm', json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert receipt.status_code == 200, receipt.text
        target['instruction_basis_id'] = receipt.json()['data']['basis_id']
        initial = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert initial.status_code == 200, initial.text
        content = initial.json()['data']['content']
        original_basis = (await client.post(basis_url, json={'content': content})).json()['data']
        assert original_basis['status'] == 'current'
        url = detail + '/unit-design-suggestions'
        request = {'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
                   'shot_id': 'shot', 'source_unit_id': 'target', 'target_model_id': 'video', 'model_id': 'text'}
        for invalid_source in (None, 'missing-unit', 'independent'):
            rejected = await client.post(url, json={**request, 'source_unit_id': invalid_source})
            assert rejected.status_code == 422, rejected.text
        accepted = await client.post(url, json=request)
        assert accepted.status_code == 200, accepted.text
        task_id = accepted.json()['data']['task_id']
        proposed = {'shot_id': 'shot', 'target_model_id': 'video', 'organization': '仅调整明确目标', 'units': [
            {'id': 'target', 'coverage': [{'id': 'target-coverage', 'shot_id': 'shot', 'action_scope': '抬头'}],
             'duration_ms': None, 'ratio': '16:9', 'reason': '仅拍既有抬头动作'},
            {'id': 'retained', 'coverage': content['units'][1]['coverage'], 'duration_ms': 8000,
             'ratio': '16:9', 'reason': '保持原样'}]}
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            await service.finish(task_id, result=result.model_dump(mode='json'))
        for mutation in ('new-action', 'unknown-selection', 'unselected-unit', 'false-retain', 'false-create'):
            accepted = await client.post(url, json={**request, 'request_id': str(uuid4())})
            assert accepted.status_code == 200, accepted.text
            invalid_task_id = accepted.json()['data']['task_id']
            bad = deepcopy(proposed)
            if mutation == 'new-action':
                bad['units'][0]['coverage'][0]['action_scope'] = '掏枪冲向门外'
            elif mutation == 'unknown-selection':
                bad['units'][0]['coverage'][0]['event_ids'] = ['unplanned-event']
            elif mutation == 'unselected-unit':
                bad['units'][1]['coverage'][0]['action_scope'] = '读信'
            elif mutation == 'false-retain':
                bad['units'][0]['operation'] = 'retain'
            else:
                bad['units'][0]['operation'] = 'create'
            async with sessions.begin() as db:
                task = await db.get(Task, invalid_task_id)
                service = TaskService(db)
                assert await service.claim(invalid_task_id, worker_id='fixture')
                with pytest.raises(ValueError) as invalid:
                    generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(bad))), task.input_snapshot['run_args'])
                await service.finish(invalid_task_id, error=str(invalid.value), error_code='directing_output_invalid')
            failed = next(row for row in (await client.get(url)).json()['data'] if row['task_id'] == invalid_task_id)
            assert failed['status'] == 'failed' and failed['error']
            assert (await client.get(detail)).json()['data'] == initial.json()['data']
        for field in ('coverage', 'parameters', 'references', 'scene_dependencies'):
            changed = deepcopy(content)
            if field == 'coverage':
                changed['units'][0]['coverage'][0]['action_scope'] = '读信'
            elif field == 'parameters':
                changed['units'][0]['parameters']['seed'] = 18
            else:
                changed['units'][0][field] = []
            for boundary in ('preview', 'apply'):
                rejected = await client.post(url + '/' + task_id + '/' + boundary, json={'content': changed})
                assert rejected.status_code == 409, rejected.text
        independent = deepcopy(content)
        independent['units'][2]['instruction'] = '独立镜头的最新人工指令'
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': independent})
        assert applied.status_code == 200, applied.text
        candidate = applied.json()['data']
        assert [unit['id'] for unit in candidate['units']] == ['target', 'retained', 'independent']
        assert candidate['units'][1:] == independent['units'][1:]
        target = candidate['units'][0]
        assert target['coverage'][0]['id'] == 'target-coverage'
        assert target['coverage'][0]['action_scope'] == '抬头'
        assert target['model_id'] == 'video'
        assert target['instruction'] == content['units'][0]['instruction']
        assert target['instruction_source'] == content['units'][0]['instruction_source']
        for field in ('references', 'scene_dependencies', 'parameters', 'instruction_basis_id', 'instruction_check_task_id'):
            assert target[field] == content['units'][0][field]
        state = (await client.post(basis_url, json={'content': candidate})).json()['data']
        assert state['status'] == 'changed'
        assert state['previous'] == original_basis['previous']
        assert [row['text'] for row in state['current']['scope']['execution'] if row['field'] == 'action_scope'] == ['抬头']
        assert not any(row['text'] == '拆信；读信；抬头' for row in state['current']['scope']['execution'])
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': candidate})
        assert saved.status_code == 200, saved.text
        assert (await client.get(detail)).json()['data']['content'] == candidate
        candidate['units'][0]['organization'].update(entry_state='人工进入要求', exit_state='人工结束要求',
            reference_requirements=['人工参考要求'])
        human = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 3, 'content': candidate})
        assert human.status_code == 200, human.text
        candidate = human.json()['data']['content']
        accepted = await client.post(url, json={**request, 'request_id': str(uuid4()), 'expected_revision': 4, 'content': candidate})
        assert accepted.status_code == 200, accepted.text
        task_id = accepted.json()['data']['task_id']
        proposed['units'][0]['coverage'][0]['action_scope'] = '读信'
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            await service.finish(task_id, result=result.model_dump(mode='json'))
        updated = await client.post(url + '/' + task_id + '/apply', json={'content': candidate})
        assert updated.status_code == 200, updated.text
        for field in ('entry_state', 'exit_state', 'reference_requirements'):
            assert updated.json()['data']['units'][0]['organization'][field] == candidate['units'][0]['organization'][field]
        persisted = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 4, 'content': updated.json()['data']})
        assert persisted.status_code == 200, persisted.text


@pytest.mark.asyncio
async def test_explicit_modify_can_change_only_model_while_retained_unit_keeps_model(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={}),
                        Model(id='old-video', name='sora-2-pro', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '只改视频模型'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {},
            'visible_result': {'state': 'proposal', 'text': '抬头', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}}]
        content['units'] = [{'id': identity, 'model_id': 'old-video', 'ratio': '16:9',
            'coverage': [{'id': identity + '-coverage', 'shot_id': 'shot', 'action_scope': '抬头'}]}
            for identity in ('target', 'retained')]
        content['design']['applicability'] = [{'subject': {'kind': 'shot', 'id': 'shot', 'field': 'visible_result'},
            'purpose': 'design', 'scope': 'occurrences', 'occurrences': [{'unit_id': 'target', 'coverage_item_id': 'target-coverage'}]}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        content = saved.json()['data']['content']
        url = detail + '/unit-design-suggestions'
        accepted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
            'shot_id': 'shot', 'source_unit_id': 'target', 'target_model_id': 'video', 'model_id': 'text'})
        assert accepted.status_code == 200, accepted.text
        task_id = accepted.json()['data']['task_id']
        proposed = {'shot_id': 'shot', 'target_model_id': 'video', 'organization': '仅切换明确目标的模型', 'units': [
            {'id': unit['id'], 'operation': 'modify' if unit['id'] == 'target' else 'retain',
             'coverage': deepcopy(unit['coverage']), 'duration_ms': unit['duration_ms'], 'ratio': unit['ratio'], 'reason': '模型调整'}
            for unit in content['units']]}
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            await service.finish(task_id, result=result.model_dump(mode='json'))
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        candidate = applied.json()['data']
        assert candidate['units'][0]['model_id'] == 'video'
        assert candidate['units'][0]['coverage'] == content['units'][0]['coverage']
        assert candidate['units'][1] == content['units'][1]
        accepted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
            'shot_id': 'shot', 'source_unit_id': 'target', 'target_model_id': 'video', 'model_id': 'text'})
        assert accepted.status_code == 200, accepted.text
        protected_task_id = accepted.json()['data']['task_id']
        proposed['units'][0]['coverage'][0]['id'] = 'replacement-coverage'
        async with sessions.begin() as db:
            task = await db.get(Task, protected_task_id)
            service = TaskService(db)
            assert await service.claim(protected_task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            await service.finish(protected_task_id, result=result.model_dump(mode='json'))
        protected = await client.post(url + '/' + protected_task_id + '/preview', json={'content': content})
        assert protected.status_code == 200, protected.text
        assert protected.json()['data']['blockers'][0]['coverage_item_id'] == 'target-coverage'
        assert (await client.get(detail)).json()['data'] == saved.json()['data']


@pytest.mark.asyncio
@pytest.mark.parametrize('blocked', [None, 'design', 'coverage'])
async def test_regroup_removes_omitted_units_and_rechecks_removal_on_save(tmp_path, blocked):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '整份重组'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': identity, 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {'state': 'proposal', 'text': '抬头',
            'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}} for identity in ('shot', 'other')]
        content['units'] = [{'id': identity, 'model_id': 'video', 'ratio': '16:9',
            'coverage': [{'id': identity + '-coverage', 'shot_id': shot, 'action_scope': '抬头'}]}
            for identity, shot in (('first', 'shot'), ('independent', 'other'), ('second', 'shot'), ('third', 'shot'))]
        content['units'].append({'id': 'mixed', 'ratio': '16:9', 'coverage': [
            {'id': 'mixed-target', 'shot_id': 'shot', 'action_scope': '抬头'},
            {'id': 'mixed-other', 'shot_id': 'other', 'action_scope': '抬头'}]})
        if blocked == 'design':
            content['design']['applicability'] = [{'subject': {'kind': 'shot', 'id': 'shot', 'field': 'visible_result'},
                'purpose': 'design', 'scope': 'occurrences',
                'occurrences': [{'unit_id': 'second', 'coverage_item_id': 'second-coverage'}]}]
        if blocked == 'coverage':
            from app.services.directing.store import DirectingStore
            from tests.directing.samples import SOURCE, design_sample, plan_sample
            from tests.directing.test_store import frozen, output
            async with sessions.begin() as db:
                store = DirectingStore(db, 'p1')
                design = await frozen(store, path.rsplit('/', 1)[1], 'design', design_sample('dialogue'))
                plan = await frozen(store, path.rsplit('/', 1)[1], 'plan', plan_sample(design.id))
                prompt = await frozen(store, path.rsplit('/', 1)[1], 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                    'format_version': 'fixture', 'text': '原历史素材依据', 'sources': [SOURCE], 'decisions': []})
                await output(db, prompt.id)
                take = await store.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
                take_id = take.id
            media_range = {'source_in_ms': 0, 'source_out_ms': 1000}
            content['take_judgments'] = [{'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
                'annotation': {'review_status': 'reviewed', 'verdict': 'retain', 'rationale': {}, 'retained_ranges': [],
                    'coverage': [{'id': 'actual', 'unit_id': 'second', 'coverage_item_id': 'second-coverage',
                        'media_range': media_range, 'observation': '素材实际抬头', 'source': {'kind': 'file', 'reference': take_id,
                            'version': 'video1', 'file_id': 'video1', 'media_range': media_range}}]}}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        content = saved.json()['data']['content']
        url = detail + '/unit-design-suggestions'
        response = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
            'shot_id': 'shot', 'source_unit_id': 'first', 'target_model_id': 'video', 'model_id': 'text'})
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        proposed = {'shot_id': 'shot', 'target_model_id': 'video', 'organization': '三个保留两个', 'units': [
            {'id': row['id'], 'operation': 'retain', 'coverage': row['coverage'], 'duration_ms': row['duration_ms'],
             'ratio': row['ratio'], 'reason': '保留原单元'} for row in content['units'] if row['id'] in ('first', 'third')]}
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            await service.finish(task_id, result=result.model_dump(mode='json'))
        if blocked:
            preview = await client.post(url + '/' + task_id + '/preview', json={'content': content})
            assert preview.status_code == 200, preview.text
            blocker = preview.json()['data']['blockers'][0]
            assert blocker['unit_id'] == 'second' and blocker['coverage_item_id'] == 'second-coverage'
            if blocked == 'design':
                assert blocker['subject'] == {'kind': 'shot', 'id': 'shot', 'field': 'visible_result'}
                assert blocker['path'] == 'design.applicability[0].occurrences[0]'
            else:
                assert blocker['take_id'] == take_id and blocker['take_kind'] == 'production_plan'
                assert blocker['path'] == 'take_judgments[0].annotation.coverage[0]'
            assert (await client.post(url + '/' + task_id + '/apply', json={'content': content})).status_code == 422
            content['design']['applicability'] = []
            if blocked == 'coverage':
                content['take_judgments'][0]['annotation']['coverage'] = []
                content['units'][0]['instruction'] = '相关输入已改'
            stale = await client.post(url + '/' + task_id + '/preview', json={'content': content})
            assert stale.status_code == 409, stale.text
            assert (await client.get(detail)).json()['data'] == saved.json()['data']
            return
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        candidate = applied.json()['data']
        assert [row['id'] for row in candidate['units']] == ['first', 'independent', 'third', 'mixed']
        changed = deepcopy(candidate)
        changed['units'][0]['coverage'][0]['action_scope'] = '相关单元被人工修改'
        rejected = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': changed})
        assert rejected.status_code == 409, rejected.text
        assert (await client.get(detail)).json()['data'] == saved.json()['data']
        candidate['units'][1]['instruction'] = '独立镜头新编辑'
        persisted = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': candidate})
        assert persisted.status_code == 200, persisted.text
        assert persisted.json()['data']['content'] == candidate
