"""补拍通过真实 HTTP 保留来源与准备输入。"""
import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.models.task import Task
from app.models.studio_prompts_files_timeline import FileItem
from app.services.generation.media_execution import deliver_media
from tests.directing.samples import complete_shot_scope_sample
from tests.directing.test_scene_video import reference_storage  # noqa: F401
from app.services.directing.ai import generate_directing_result
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_supplement_preserves_source_and_inherits_preparation(tmp_path, reference_storage):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id=identity, name=name, category=category, provider_id='provider', params={})
                        for identity, name, category in [('text', 'gpt-test', 'text'),
                            ('source-video', 'sora-2', 'video'), ('target-video', 'sora-2-pro', 'video')]])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '补拍'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        note = {'state': 'proposal', 'text': '拆信；读信；抬头',
                'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}
        content['design']['direction']['shots'] = [{'id': 'shot', 'visible_result': note, 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}}]
        content['units'] = [{'id': 'source', 'ratio': '16:9', 'model_id': 'source-video',
            'parameters': {'seed': 17}, 'instruction': '仅抬头', 'duration_ms': 5000,
            'references': [{'id': 'frame', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'space',
                'participant_ids': [], 'ordinal': 0, 'input_role': 'first_frame',
                'source': {'kind': 'file', 'reference': 'image1', 'file_id': 'image1', 'version': '1'}}],
            'instruction_source': {'kind': 'human', 'reference': 'user', 'version': '1'},
            'coverage': [{'id': 'source-coverage', 'shot_id': 'shot', 'action_scope': '拆信；读信；抬头'}]},
            {'id': 'second', 'ratio': '16:9', 'coverage': [{'id': 'second-coverage', 'shot_id': 'shot', 'action_scope': '读信'}]}]
        complete_shot_scope_sample(content, '拆信；读信；抬头')
        basis = await client.post(detail + '/units/source/instruction-basis/confirm', json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert basis.status_code == 200, basis.text
        content['units'][0]['instruction_basis_id'] = basis.json()['data']['basis_id']
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        content = saved.json()['data']['content']
        url = detail + '/unit-design-suggestions'
        submitted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 2,
            'content': content, 'shot_id': 'shot', 'source_unit_id': 'source', 'target_model_id': 'target-video',
            'model_id': 'text', 'instruction': '保留原单元，仅新增抬头补拍'})
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        proposed = {'shot_id': 'shot', 'target_model_id': 'target-video', 'organization': '保留原单元并补拍',
            'units': [{'id': unit['id'], 'ratio': unit['ratio'], 'reason': '保留', 'operation': 'retain', 'duration_ms': unit['duration_ms'], 'coverage': unit['coverage']}
                      for unit in content['units']] + [{'id': 'supplement', 'ratio': '16:9', 'reason': '补拍', 'operation': 'create',
                       'coverage': [{'id': 'supplement-coverage', 'shot_id': 'shot', 'action_scope': '抬头'}]}]}
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            result = generate_directing_result('directing_unit_design',
                SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            await service.finish(task_id, result=result.model_dump(mode='json'))
        for mutation in ('source', 'reference', 'other-target-unit'):
            changed = deepcopy(content)
            if mutation == 'source':
                changed['units'][0]['parameters']['seed'] = 19
            elif mutation == 'reference':
                changed['units'][0]['references'][0]['input_role'] = 'last_frame'
            else:
                changed['units'][1]['coverage'][0]['action_scope'] = '抬头'
            rejected = await client.post(url + '/' + task_id + '/preview', json={'content': changed})
            assert rejected.status_code == 409, rejected.text
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        candidate = applied.json()['data']
        assert candidate['units'][:2] == content['units']
        supplement = candidate['units'][2]
        assert supplement['model_id'] == 'target-video'
        assert supplement['parameters'] == {'seed': 17}
        assert supplement['duration_ms'] == 5000
        assert supplement['references'] == content['units'][0]['references']
        assert '继承来源预计时长；目标模型时长上限未核实' in supplement['organization']['missing']
        assert supplement['instruction'] == '仅抬头'
        assert supplement['instruction_source'] == content['units'][0]['instruction_source']
        assert supplement['instruction_basis_id'] is None and supplement['instruction_check_task_id'] is None
        assert supplement['coverage'][0]['action_scope'] == '抬头'
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': candidate})
        assert saved.status_code == 200, saved.text
        assert (await client.get(detail)).json()['data']['content'] == candidate

        # 真实编译、审查与拍摄继续限定新增身份和局部动作。
        unit_url = detail + '/units/supplement'
        submitted = await client.post(unit_url + '/instruction-suggestions', json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': candidate, 'model_id': 'text'})
        assert submitted.status_code == 200, submitted.text
        compile_id = submitted.json()['data']['task_id']
        async with sessions.begin() as db:
            task = await db.get(Task, compile_id)
            def compile_instruction(messages):
                scope = json.loads(messages[1].content)['scope']
                assert [(row['owner'], row['text']) for row in scope['execution']] == [('coverage:supplement-coverage', '抬头')]
                assert any(row['text'] == '拆信；读信；抬头' for row in scope['background'])
                return SimpleNamespace(content=json.dumps({'unit_id': 'supplement', 'text': '抬头。'}))
            result = generate_directing_result('directing_instruction', SimpleNamespace(invoke=compile_instruction), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(compile_id, worker_id='supplement-compile')
            await service.finish(compile_id, result=result.model_dump(mode='json'))
        compiled = await client.post(unit_url + '/instruction-suggestions/' + compile_id + '/apply', json={'content': candidate})
        assert compiled.status_code == 200, compiled.text
        receipt = compiled.json()['data']
        supplement.update(instruction=receipt['text'], instruction_source=receipt['source'], instruction_basis_id=receipt['basis_id'])
        check = await client.post(unit_url + '/instruction-checks', json={'request_id': str(uuid4()),
            'expected_revision': 3, 'content': candidate, 'model_id': 'text'})
        assert check.status_code == 200, check.text
        check_id = check.json()['data']['task_id']
        async with sessions.begin() as db:
            task = await db.get(Task, check_id)
            def check_instruction(messages):
                scope = json.loads(messages[1].content)['inputs']['scope']
                assert [row['text'] for row in scope['execution']] == ['抬头']
                return SimpleNamespace(content=json.dumps({'unit_id': 'supplement', 'rows': [
                    {'role': role, 'occurrence_id': 'supplement-coverage', 'verdict': 'pass', 'rationale': '本次仅抬头', 'findings': []}
                    for role in ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']],
                    'destinations': [{'owner': 'coverage:supplement-coverage', 'field': 'action_scope',
                        'coverage_item_ids': ['supplement-coverage'], 'destination': 'instruction',
                        'instruction_excerpt': '抬头', 'rationale': '正文表达'}]}))
            result = generate_directing_result('directing_instruction_check', SimpleNamespace(invoke=check_instruction), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(check_id, worker_id='supplement-check')
            await service.finish(check_id, result=result.model_dump(mode='json'))
        confirmed = await client.post(unit_url + '/instruction-checks/' + check_id + '/confirm', json={'content': candidate})
        assert confirmed.status_code == 200, confirmed.text
        supplement['instruction_check_task_id'] = check_id
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 3, 'content': candidate})
        assert saved.status_code == 200, saved.text
        video = await client.post(unit_url + '/video', json={'request_id': str(uuid4()), 'expected_revision': 4})
        assert video.status_code == 200, video.text
        video_id = video.json()['data']['task_id']
        async with sessions.begin() as db:
            db.add(FileItem(id='supplement-output', type='video', name='补拍.mp4', storage_key='fixtures/supplement.mp4', content_type='video/mp4', duration_ms=5000))
            await db.flush()
            service = TaskService(db)
            assert await service.claim(video_id, worker_id='supplement-video')
            await service.add_output(video_id, ordinal=0, file_id='supplement-output')
            await service.finish(video_id, deliver=deliver_media)
        videos = (await client.get(unit_url + '/video')).json()['data']
        assert len(videos[0]['takes']) == 1
        assert videos[0]['takes'][0]['annotation']['coverage'] == []
        assert videos[0]['takes'][0]['annotation']['review_status'] == 'unreviewed'
        readback = (await client.get(detail)).json()['data']['content']
        assert readback['units'][0] == content['units'][0]
        assert readback['timeline'] == content['timeline']
        assert (await client.get(detail + '/units/source/video')).json()['data'] == []

        # 仅原出现项适用的动作不能通过新身份继承，也不能改导演适用范围绕过。
        scoped = deepcopy(readback)
        scoped['design']['events'] = [{'id': 'source-only-event', 'description': {
            'state': 'proposal', 'text': '抬头', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}}]
        scoped['design']['applicability'] = [{'subject': {'kind': 'event', 'id': 'source-only-event', 'field': 'description'},
            'purpose': 'design', 'scope': 'occurrences',
            'occurrences': [{'unit_id': 'source', 'coverage_item_id': 'source-coverage'}]}]
        scoped['design']['direction']['shots'][0]['event_ids'] = ['source-only-event']
        scoped['units'][0]['coverage'][0]['event_ids'] = ['source-only-event']
        accepted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 4,
            'content': scoped, 'shot_id': 'shot', 'source_unit_id': 'source',
            'target_model_id': 'target-video', 'model_id': 'text'})
        assert accepted.status_code == 200, accepted.text
        invalid_id = accepted.json()['data']['task_id']
        invalid = {'shot_id': 'shot', 'target_model_id': 'target-video', 'organization': '不可继承局部适用动作',
            'units': [{'id': unit['id'], 'coverage': unit['coverage'], 'duration_ms': unit['duration_ms'],
                'ratio': unit['ratio'], 'reason': '保留'} for unit in scoped['units']] + [
                {'id': 'invalid-supplement', 'ratio': '16:9', 'reason': '错误继承', 'coverage': [
                    {'id': 'invalid-coverage', 'shot_id': 'shot', 'action_scope': '抬头', 'event_ids': ['source-only-event']}]}]}
        async with sessions.begin() as db:
            task = await db.get(Task, invalid_id)
            service = TaskService(db)
            assert await service.claim(invalid_id, worker_id='invalid-occurrence')
            with pytest.raises(ValueError, match='仅适用于原出现项') as error:
                generate_directing_result('directing_unit_design', SimpleNamespace(
                    invoke=lambda _: SimpleNamespace(content=json.dumps(invalid))), task.input_snapshot['run_args'])
            await service.finish(invalid_id, error=str(error.value), error_code='directing_output_invalid')
        assert (await client.get(detail)).json()['data']['content'] == readback

        # 继承前段绑定的历史来源，缺真实落幅时仍是待准备，不由AI状态建议替代。
        from app.services.directing.store import DirectingStore
        from tests.directing.samples import design_sample, plan_sample
        from tests.directing.test_store import frozen
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, version['sequence_id'], 'design', design_sample('dialogue'))
            plan = await frozen(store, version['sequence_id'], 'plan', plan_sample(design.id))
            plan_id = plan.id
        dependent = deepcopy(readback)
        dependent['units'][0]['parameters']['unsupported-option'] = 1
        dependent['units'][0]['references'][0]['input_role'] = 'last_frame'
        dependent['units'][0]['dependencies'] = [{'plan_revision_id': plan_id, 'unit_id': 'u1'}]
        accepted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 4,
            'content': dependent, 'shot_id': 'shot', 'source_unit_id': 'source',
            'target_model_id': 'target-video', 'model_id': 'text'})
        assert accepted.status_code == 200, accepted.text
        dependent_id = accepted.json()['data']['task_id']
        proposed = {'shot_id': 'shot', 'target_model_id': 'target-video', 'organization': '保留历史依赖',
            'units': [{'id': unit['id'], 'coverage': unit['coverage'], 'duration_ms': unit['duration_ms'],
                'ratio': unit['ratio'], 'reason': '保留', 'operation': 'retain'} for unit in dependent['units']] + [
                {'id': 'dependent-supplement', 'ratio': '16:9', 'reason': '依赖补拍', 'operation': 'create',
                 'coverage': [{'id': 'dependent-coverage', 'shot_id': 'shot', 'action_scope': '抬头'}]}]}
        async with sessions.begin() as db:
            task = await db.get(Task, dependent_id)
            result = generate_directing_result('directing_unit_design', SimpleNamespace(
                invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(dependent_id, worker_id='dependent-supplement')
            await service.finish(dependent_id, result=result.model_dump(mode='json'))
        preview = await client.post(url + '/' + dependent_id + '/preview', json={'content': dependent})
        assert preview.status_code == 200, preview.text
        missing = preview.json()['data']['result']['units'][-1]['missing']
        assert '前段依赖待绑定实际落幅与参考' in missing
        assert '补拍参数与执行器冲突：unsupported-option' in missing
        assert '补拍参考与目标模型冲突：不支持所选帧位置' in missing
        applied = await client.post(url + '/' + dependent_id + '/apply', json={'content': dependent})
        assert applied.status_code == 200, applied.text
        inherited = applied.json()['data']['units'][-1]
        assert inherited['parameters']['unsupported-option'] == 1
        assert inherited['references'][0]['input_role'] == 'last_frame'
        dependency = inherited['dependencies'][0]
        assert dependency['plan_revision_id'] == plan_id and dependency['unit_id'] == 'u1'
        assert dependency['frame_id'] is None and dependency['reference_id'] is None
