"""当前单元检查的固定正文、依据与任务隔离，经真实 HTTP 验证。"""
from copy import deepcopy
import json
from types import SimpleNamespace
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

import pytest

from app.models.studio_prompts_files_timeline import FileItem
from app.services.generation.media_execution import deliver_media
from app.models.llm import Model, Provider
from app.models.task import Task
from app.services.directing.ai import generate_directing_result
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database
from tests.directing.samples import complete_shot_scope_sample


@pytest.fixture
def reference_storage(monkeypatch):
    """真实 S3 HEAD 边界夹具，可独立移除对象，不伪造存储客户端返回。"""
    from app.config import settings
    objects = {'/scene-test/files/space.png': b'original-reference'}

    class Handler(BaseHTTPRequestHandler):
        def do_HEAD(self):
            value = objects.get(self.path)
            self.send_response(404 if value is None else 200)
            self.send_header('Content-Length', str(len(value) if value else 0))
            self.send_header('Content-Type', 'image/png')
            self.end_headers()

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    for name, value in {'s3_endpoint_url': f'http://127.0.0.1:{server.server_port}',
                        's3_bucket_name': 'scene-test', 's3_base_path': '', 's3_addressing_style': 'path',
                        's3_access_key_id': 'fixture', 's3_secret_access_key': 'fixture'}.items():
        monkeypatch.setattr(settings, name, value)
    try:
        yield objects
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.asyncio
@pytest.mark.parametrize('with_reference', [False, True, 'replacement'])
@pytest.mark.parametrize('remove_running', [False, True])
async def test_video_submission_freezes_original_unit_and_registers_only_candidate(tmp_path, with_reference, reference_storage, monkeypatch, remove_running):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='check-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='check-text', name='gpt-test', category='text', provider_id='check-provider', params={}),
                        Model(id='current-video', name='current-video-model', category='video', provider_id='check-provider', params={}),
                        Model(id='check-video', name='test-video-model', category='video', provider_id='check-provider', params={})])
            db.add(FileItem(id='current-image', type='image', name='当前新参考', storage_key='fixtures/current.png'))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '检查输入'})).json()['data']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'model_id': 'check-video', 'duration_ms': 5000, 'ratio': '16:9', 'instruction': '递出信封。', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '递出信封'}]}]
        content['units'][0]['parameters'] = {'seed': 17}
        if with_reference:
            content['units'][0]['references'] = [{'id': 'original-frame', 'file_id': 'image1',
                'media_kind': 'image', 'purpose': 'space', 'participant_ids': [], 'ordinal': 0,
                'input_role': 'first_frame',
                'source': {'kind': 'file', 'reference': 'image1', 'file_id': 'image1', 'version': '1'}}]
        complete_shot_scope_sample(content, '递出信封')
        detail = path + '/versions/' + version['id']
        unit_url = detail + '/units/unit'
        url = unit_url + '/instruction-checks'
        request = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': content, 'model_id': 'check-text'}
        assert (await client.post(url, json=request)).status_code == 409
        confirmation = await client.post(unit_url + '/instruction-basis/confirm', json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        content['units'][0]['instruction_basis_id'] = confirmation.json()['data']['basis_id']
        submitted = await client.post(url, json=request)
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        assert (await client.post(url, json=request)).json()['data']['task_id'] == task_id
        assert (await client.post(url, json={**request, 'request_id': str(uuid4())})).status_code == 409
        changed = deepcopy(request)
        changed['content']['units'][0]['instruction'] = '收下信封。'
        assert (await client.post(url, json=changed)).status_code == 409
        rows = (await client.get(url)).json()['data']
        assert len(rows) == 1 and rows[0]['instruction'] == '递出信封。'
        assert rows[0]['result'] is None and rows[0]['status'] == 'queued'
        result = {'unit_id': 'unit', 'rows': [{'role': role, 'occurrence_id': 'coverage', 'verdict': 'pass', 'rationale': '明确表达递信动作', 'findings': []} for role in ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']],
                  'destinations': [{'owner': 'coverage:coverage', 'field': 'action_scope', 'coverage_item_ids': ['coverage'],
                                    'destination': 'instruction', 'instruction_excerpt': '递出信封', 'reference_id': None,
                                    'rationale': '正文直接表达'}]}
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='check-fixture')
            await service.finish(task_id, result=result)
        rows = (await client.get(url)).json()['data']
        assert rows[0]['result'] == result
        assert rows[0]['inputs']['unit']['coverage'][0]['action_scope'] == '递出信封'
        assert (await client.get(detail)).json()['data'] == version
        changed['request_id'] = str(uuid4())
        changed['content']['units'][0]['coverage'][0]['action_scope'] = '收下信封'
        assert (await client.post(url, json=changed)).status_code == 409
        assert (await client.get(url)).json()['data'][0]['instruction'] == '递出信封。'

        compare_url = url + '/' + task_id + '/compare'
        compared = await client.post(compare_url, json={'content': content})
        assert compared.status_code == 200, compared.text
        assert compared.json()['data'] == {'task_id': task_id, 'matches_current': True, 'basis_current': True, 'confirmed': False}
        confirm_url = url + '/' + task_id + '/confirm'
        confirmed = await client.post(confirm_url, json={'content': content})
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()['data']['task_id'] == task_id
        assert (await client.get(detail)).json()['data'] == version
        text_changed = deepcopy(content)
        text_changed['units'][0]['instruction'] = '收下信封。'
        assert (await client.post(compare_url, json={'content': text_changed})).json()['data']['matches_current'] is False
        assert (await client.post(confirm_url, json={'content': text_changed})).status_code == 409
        unrelated = deepcopy(content)
        unrelated['units'].append({**deepcopy(content['units'][0]), 'id': 'other', 'instruction': '另一单元独立正文', 'instruction_basis_id': None})
        assert (await client.post(compare_url, json={'content': unrelated})).json()['data']['matches_current'] is True
        unconfirmed = deepcopy(content)
        unconfirmed['units'][0]['instruction_basis_id'] = None
        check = (await client.post(compare_url, json={'content': unconfirmed})).json()['data']
        assert check['matches_current'] is True and check['basis_current'] is False
        assert (await client.post(compare_url, json={'content': changed['content']})).json()['data']['matches_current'] is False
        assert (await client.post(compare_url.replace('/unit/', '/other/'), json={'content': unrelated})).status_code == 422

        bound = deepcopy(content)
        bound['units'][0]['instruction_check_task_id'] = task_id
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': bound})
        assert saved.status_code == 200, saved.text
        assert (await client.post(compare_url, json={'content': saved.json()['data']['content']})).json()['data']['confirmed'] is True
        prepare_url = unit_url + '/video/prepare'
        prepared = await client.post(prepare_url, json={'expected_revision': 2})
        assert prepared.status_code == 200, prepared.text
        execution = prepared.json()['data']
        assert execution['request']['execution_prompt'] == '递出信封。'
        assert execution['request']['model_id'] == 'check-video'
        assert execution['request']['operation_input']['seconds'] == 5
        assert execution['request']['operation_input']['seed'] == 17
        assert execution['check_task_id'] == task_id
        assert (await client.post(prepare_url, json={'expected_revision': 1})).status_code == 409
        video_url = unit_url + '/video'
        submit = {'request_id': str(uuid4()), 'expected_revision': 2}
        accepted = await client.post(video_url, json=submit)
        assert accepted.status_code == 200, accepted.text
        video_id = accepted.json()['data']['task_id']
        assert (await client.post(video_url, json=submit)).json()['data']['task_id'] == video_id
        assert (await client.post(video_url, json={**submit, 'request_id': str(uuid4())})).status_code == 409
        assert (await client.post(video_url, json={**submit, 'expected_revision': 1})).status_code == 409
        rows = (await client.get(video_url)).json()['data']
        assert len(rows) == 1 and rows[0]['task_id'] == video_id
        assert rows[0]['preparation']['request']['execution_prompt'] == '递出信封。'
        assert rows[0]['takes'] == []
        bound['units'][0]['instruction'] = '收下信封。'
        assert (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': bound})).status_code == 200
        assert (await client.post(video_url, json=submit)).json()['data']['task_id'] == video_id
        assert (await client.post(video_url, json={'request_id': str(uuid4()), 'expected_revision': 3})).status_code == 409
        if remove_running:
            async with sessions.begin() as db:
                assert await TaskService(db).claim(video_id, worker_id='running-before-removal')
            current = (await client.get(detail)).json()['data']
            suggestions = detail + '/unit-design-suggestions'
            submitted_plan = await client.post(suggestions, json={'request_id': str(uuid4()), 'expected_revision': 3,
                'content': current['content'], 'shot_id': 'shot', 'source_unit_id': 'unit',
                'target_model_id': 'check-video', 'model_id': 'check-text'})
            assert submitted_plan.status_code == 200, submitted_plan.text
            plan_task = submitted_plan.json()['data']['task_id']
            async with sessions.begin() as db:
                service = TaskService(db)
                task = await db.get(Task, plan_task)
                result = {'shot_id': 'shot', 'target_model_id': 'check-video', 'organization': '重组为新工作', 'units': [
                    {'id': 'replacement', 'operation': 'create', 'coverage': [{'id': 'replacement-coverage',
                        'shot_id': 'shot', 'action_scope': '递出信封'}], 'ratio': '16:9', 'reason': '新单元身份'}]}
                generated = generate_directing_result('directing_unit_design', SimpleNamespace(
                    invoke=lambda _: SimpleNamespace(content=json.dumps(result))), task.input_snapshot['run_args'])
                assert await service.claim(plan_task, worker_id='regroup-during-video')
                await service.finish(plan_task, result=generated.model_dump(mode='json'))
            candidate = await client.post(suggestions + '/' + plan_task + '/apply', json={'content': current['content']})
            assert candidate.status_code == 200, candidate.text
            removed = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 3, 'content': candidate.json()['data']})
            assert removed.status_code == 200, removed.text
            running = (await client.get(video_url)).json()['data'][0]
            assert running['status'] == 'running' and running['preparation'] == rows[0]['preparation']
        async with sessions.begin() as db:
            db.add(FileItem(id='video-output', type='video', name='model-output.mp4', storage_key='fixtures/video-output.mp4', content_type='video/mp4', duration_ms=5000))
            await db.flush()
            service = TaskService(db)
            if not remove_running:
                assert await service.claim(video_id, worker_id='video-result-fixture')
            await service.add_output(video_id, ordinal=0, file_id='video-output')
            await service.finish(video_id, deliver=deliver_media)
            await service.finish(video_id, deliver=deliver_media)
        rows = (await client.get(video_url)).json()['data']
        assert rows[0]['status'] == 'succeeded'
        assert rows[0]['preparation']['request']['execution_prompt'] == '递出信封。'
        assert len(rows[0]['takes']) == 1
        assert rows[0]['takes'][0]['file_id'] == 'video-output'
        assert rows[0]['takes'][0]['annotation']['review_status'] == 'unreviewed'
        assert rows[0]['takes'][0]['annotation']['coverage'] == []
        take_id = rows[0]['takes'][0]['id']
        graph_version = (await client.get(detail)).json()['data']
        candidate = next(node for node in graph_version['edit_graph']['nodes'] if node['kind'] == 'edit_take' and node['take_id'] == take_id)
        assert candidate['take_kind'] == 'scene_video'
        assert candidate['origin_id'] == version['id']
        assert candidate['unit_id'] == 'unit'
        assert candidate['annotation'] is None
        media_path = unit_url + f'/takes/{take_id}/media'
        media = await client.get(media_path)
        assert media.status_code == 200, media.text
        assert media.json()['data']['duration_ms'] == 5000
        assert media.json()['data']['url'] == '/api/v1/studio/files/video-output/download'
        assert (await client.get(media_path.replace('/units/unit/', '/units/other/'))).status_code == 422
        if remove_running:
            historical = (await client.get(detail)).json()['data']['content']
            assert [unit['id'] for unit in historical['units']] == ['replacement']
            assert historical['timeline'] == content['timeline']
            assert historical['take_judgments'] == content['take_judgments']
            library = (await client.get(detail + '/take-library')).json()['data']
            assert any(row['take_id'] == take_id for row in library)
            assert (await client.get(url)).json()['data'][0]['task_id'] == task_id
            return
        consumer = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '素材复用方案'})).json()['data']
        library = await client.get(path + '/versions/' + consumer['id'] + '/take-library')
        assert library.status_code == 200, library.text
        item = library.json()['data'][0]
        assert item['take_kind'] == 'scene_video' and item['take_id'] == take_id
        assert item['origin_id'] == version['id'] and item['task_id'] == video_id
        assert item['video_preparation'] == execution
        assert (await client.get(path + '/versions/' + consumer['id'])).json()['data'] == consumer

        assert (await client.get(detail)).json()['data']['content']['units'][0]['instruction'] == '收下信封。'

        workflow_url = unit_url + '/video/save-and-submit'
        workflow = {'request_id': str(uuid4()), 'save': {'request_id': str(uuid4()), 'expected_revision': 3, 'content': bound}}
        failed = await client.post(workflow_url, json=workflow)
        assert failed.status_code == 200, failed.text
        failure = failed.json()['data']
        assert failure['task_id'] is None and failure['error']
        assert failure['version']['revision'] == 4
        assert (await client.get(detail)).json()['data']['content']['units'][0]['instruction'] == '收下信封。'
        assert len((await client.get(video_url)).json()['data']) == 1
        assert (await client.post(workflow_url, json=workflow)).json()['data']['version']['revision'] == 4
        bound['units'][0]['instruction'] = '递出信封。'
        workflow = {'request_id': str(uuid4()), 'save': {'request_id': str(uuid4()), 'expected_revision': 4, 'content': bound}}
        accepted = await client.post(workflow_url, json=workflow)
        assert accepted.status_code == 200, accepted.text
        workflow_task = accepted.json()['data']['task_id']
        history = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        origin = next(row['source'] for row in history if row['task_id'] == workflow_task)
        assert origin['version_id'] == version['id']
        assert origin['unit_id'] == 'unit'
        assert origin['id'] == version['sequence_id']
        assert workflow_task and accepted.json()['data']['error'] is None
        assert accepted.json()['data']['version']['revision'] == 5
        newer = deepcopy(bound)
        newer['units'][0]['instruction'] = '递出信封。后来继续编辑。'
        newer['units'][0].update(model_id='current-video', parameters={'seed': 91}, ratio='9:16', duration_ms=8000)
        if with_reference:
            newer['units'][0]['references'] = []
            if with_reference == 'replacement':
                newer['units'][0]['references'] = [{**deepcopy(bound['units'][0]['references'][0]),
                    'id': 'current-frame', 'file_id': 'current-image',
                    'source': {'kind': 'file', 'reference': 'current-image', 'file_id': 'current-image', 'version': '1'}}]
        assert (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 5, 'content': newer})).status_code == 200
        assert (await client.post(workflow_url, json=workflow)).json()['data']['task_id'] == workflow_task
        assert (await client.get(detail)).json()['data']['content']['units'][0]['instruction'] == '递出信封。后来继续编辑。'
        altered = deepcopy(workflow)
        altered['save']['content'] = newer
        assert (await client.post(workflow_url, json=altered)).status_code == 409

        original_execution = next(row for row in (await client.get(video_url)).json()['data'] if row['task_id'] == workflow_task)
        retry_url = video_url + '/' + original_execution['execution_id'] + '/retry'
        retry_request = {'request_id': str(uuid4())}
        assert (await client.post(retry_url, json=retry_request)).status_code == 409
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(workflow_task, worker_id='failed-video-fixture')
        assert (await client.post(retry_url, json=retry_request)).status_code == 409
        if with_reference:
            cancelled = await client.post(f'/api/v1/film/tasks/{workflow_task}/cancel', json={'reason': '用户请求取消'})
            assert cancelled.status_code == 200, cancelled.text
            assert cancelled.json()['data']['status'] == 'running'
            assert cancelled.json()['data']['cancel_requested'] is True
            assert cancelled.json()['data']['effective_immediately'] is False
            cancelling_record = next(row for row in (await client.get(video_url)).json()['data'] if row['task_id'] == workflow_task)
            assert cancelling_record['cancel_requested'] is True
            assert cancelling_record['status'] == 'running'
            assert (await client.post(retry_url, json=retry_request)).status_code == 409
            assert len((await client.get(video_url)).json()['data']) == 2
        async with sessions.begin() as db:
            await TaskService(db).finish(workflow_task, error_code='provider_failed', error='外部生成失败')
        original_status = 'cancelled' if with_reference else 'failed'
        assert next(row for row in (await client.get(video_url)).json()['data'] if row['task_id'] == workflow_task)['status'] == original_status
        current_prepare = await client.post(prepare_url, json={'expected_revision': 6})
        assert current_prepare.status_code == 409, current_prepare.text
        assert '当前正文或依据与已确认检查不一致' in current_prepare.json()['detail']
        async with sessions.begin() as db:
            (await db.get(Model, 'check-video')).name = 'replacement-model'
        changed_model = await client.post(retry_url, json=retry_request)
        assert changed_model.status_code == 409, changed_model.text
        assert len((await client.get(video_url)).json()['data']) == 2
        assert (await client.get(detail)).json()['data']['revision'] == 6
        assert (await client.get(detail)).json()['data']['content']['units'][0]['instruction'] == '递出信封。后来继续编辑。'
        async with sessions.begin() as db:
            (await db.get(Model, 'check-video')).name = 'test-video-model'
        async with sessions.begin() as db:
            db.add(Provider(id='replacement-provider', name='openai', base_url='https://replacement.invalid/v1', api_key='fixture'))
            await db.flush()
            (await db.get(Model, 'check-video')).provider_id = 'replacement-provider'
        rerouted = await client.post(retry_url, json=retry_request)
        assert rerouted.status_code == 409, rerouted.text
        assert len((await client.get(video_url)).json()['data']) == 2
        assert (await client.get(detail)).json()['data']['revision'] == 6
        async with sessions.begin() as db:
            (await db.get(Model, 'check-video')).provider_id = 'check-provider'
        if with_reference:
            assert original_execution['preparation']['request']['media']['frames']['first']['file_id'] == 'image1'
            for unavailable_field in ('delete_requested_at', 'deleted_at'):
                async with sessions.begin() as db:
                    setattr(await db.get(FileItem, 'image1'), unavailable_field, datetime.now(timezone.utc))
                unavailable = await client.post(retry_url, json=retry_request)
                assert unavailable.status_code == 422, unavailable.text
                assert unavailable.json()['detail'] == '原参考 original-frame（文件 image1）不可用，请核对原执行的固定输入；不能自动改用当前参考'
                assert len((await client.get(video_url)).json()['data']) == 2
                current = (await client.get(detail)).json()['data']
                assert current['revision'] == 6
                assert current['content']['units'][0]['instruction'] == '递出信封。后来继续编辑。'
                assert [(item['id'], item['file_id']) for item in current['content']['units'][0]['references']] == ([('current-frame', 'current-image')] if with_reference == 'replacement' else [])
                async with sessions.begin() as db:
                    setattr(await db.get(FileItem, 'image1'), unavailable_field, None)
            for unavailable_object in (None, b''):
                if unavailable_object is None:
                    reference_storage.pop('/scene-test/files/space.png')
                else:
                    reference_storage['/scene-test/files/space.png'] = unavailable_object
                unavailable = await client.post(retry_url, json=retry_request)
                assert unavailable.status_code == 422, unavailable.text
                assert '原参考 original-frame（文件 image1）' in unavailable.json()['detail']
                assert len((await client.get(video_url)).json()['data']) == 2
                assert (await client.get(detail)).json()['data']['revision'] == 6
            reference_storage['/scene-test/files/space.png'] = b'original-reference'
        from app.services.directing.scene_video import SceneVideoService  # pylint: disable=import-outside-toplevel
        async def changed_projection(*_args):
            raise AssertionError('历史重试不应重新投影固定输入')
        with monkeypatch.context() as patch:
            patch.setattr(SceneVideoService, '_inputs', changed_projection)
            retry = await client.post(retry_url, json=retry_request)
        assert retry.status_code == 200, retry.text
        retry_task = retry.json()['data']['task_id']
        assert retry_task != workflow_task
        assert (await client.post(retry_url, json=retry_request)).json()['data']['task_id'] == retry_task
        assert (await client.post(retry_url, json={'request_id': str(uuid4())})).status_code == 409
        retried = next(row for row in (await client.get(video_url)).json()['data'] if row['task_id'] == retry_task)
        assert retried['preparation'] == original_execution['preparation']
        assert retried['retry_of_task_id'] == workflow_task
        assert next(row for row in (await client.get(video_url)).json()['data'] if row['task_id'] == workflow_task)['status'] == original_status
        unchanged = (await client.get(detail)).json()['data']
        assert unchanged['revision'] == 6
        assert unchanged['content']['units'][0]['instruction'] == '递出信封。后来继续编辑。'
        assert unchanged['content']['units'][0]['model_id'] == 'current-video'
        assert unchanged['content']['units'][0]['parameters'] == {'seed': 91}
        assert unchanged['content']['units'][0]['ratio'] == '9:16'
        assert unchanged['content']['units'][0]['duration_ms'] == 8000
        assert len(unchanged['content']['units']) == 1

        if with_reference:
            assert [(item['id'], item['file_id']) for item in unchanged['content']['units'][0]['references']] == ([('current-frame', 'current-image')] if with_reference == 'replacement' else [])

        # 当前生成必须重新确认新依据及新检查，不借用旧执行的通过结论。
        assert (await client.post(f'/api/v1/film/tasks/{retry_task}/cancel', json={})).status_code == 200
        current_content = deepcopy(unchanged['content'])
        basis = await client.post(unit_url + '/instruction-basis/confirm', json={
            'request_id': str(uuid4()), 'expected_revision': 6, 'content': current_content})
        assert basis.status_code == 200, basis.text
        current_content['units'][0]['instruction_basis_id'] = basis.json()['data']['basis_id']
        new_check = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 6,
            'content': current_content, 'model_id': 'check-text'})
        assert new_check.status_code == 200, new_check.text
        new_check_id = new_check.json()['data']['task_id']
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(new_check_id, worker_id='current-check-fixture')
            await service.finish(new_check_id, result=result)
        confirmed_current = await client.post(url + '/' + new_check_id + '/confirm', json={'content': current_content})
        assert confirmed_current.status_code == 200, confirmed_current.text
        current_content['units'][0]['instruction_check_task_id'] = new_check_id
        saved_current = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 6, 'content': current_content})
        assert saved_current.status_code == 200, saved_current.text
        current_request = {'request_id': str(uuid4()), 'expected_revision': 7}
        stale_preflight = await client.post(video_url, json={**current_request, 'expected_preparation': original_execution['preparation']})
        assert stale_preflight.status_code == 409, stale_preflight.text
        assert len((await client.get(video_url)).json()['data']) == 3
        current_preflight = await client.post(prepare_url, json={'expected_revision': 7})
        assert current_preflight.status_code == 200, current_preflight.text
        current_request['expected_preparation'] = current_preflight.json()['data']
        independently_edited = deepcopy(saved_current.json()['data']['content'])
        independently_edited['units'].append({'id': 'independent-unit', 'ratio': '16:9', 'instruction': '另一单元的新正文',
            'coverage': [{'id': 'independent-coverage', 'shot_id': 'shot', 'action_scope': '另一独立动作'}]})
        saved_independent = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 7,
            'content': independently_edited})
        assert saved_independent.status_code == 200, saved_independent.text
        # 保存修订仍要核实；独立单元的保存不使 A 的实际预检输入失效。
        assert (await client.post(video_url, json=current_request)).status_code == 409
        current_request['expected_revision'] = 8
        generated_current = await client.post(video_url, json=current_request)
        assert generated_current.status_code == 200, generated_current.text
        current_task = generated_current.json()['data']['task_id']
        executions = (await client.get(video_url)).json()['data']
        current_execution = next(row for row in executions if row['task_id'] == current_task)
        assert current_execution['retry_of_task_id'] is None
        assert current_execution['preparation']['check_task_id'] == new_check_id
        assert current_execution['preparation']['revision'] == 8
        assert current_request['expected_preparation']['revision'] == 7
        actual = current_execution['preparation']['request']
        assert actual['execution_prompt'] == '递出信封。后来继续编辑。'

        assert actual['model_id'] == 'current-video'
        assert actual['operation_input']['seed'] == 91
        assert actual['operation_input']['ratio'] == '9:16'
        assert actual['operation_input']['seconds'] == 8
        first_frame = actual['media']['frames']['first']
        assert (first_frame['file_id'] if first_frame else None) == ('current-image' if with_reference == 'replacement' else None)
        assert next(row for row in executions if row['task_id'] == retry_task)['preparation'] == original_execution['preparation']
        after_current = (await client.get(detail)).json()['data']['content']['units']
        assert len(after_current) == 2
        assert after_current[1]['instruction'] == '另一单元的新正文'

        # 已证明失败任务可重试；移除后新的重试授权必须拒绝，历史身份与素材不变。
        adopted_content = deepcopy((await client.get(detail)).json()['data']['content'])
        media_range = {'source_in_ms': 0, 'source_out_ms': 1000}
        adopted_content['timeline']['items'] = [{'kind': 'media', 'id': 'adopted-original', 'take_kind': 'scene_video',
            'take_id': take_id, 'file_id': 'video-output', 'media_range': media_range, 'timeline_start_ms': 0}]
        adopted_content['take_judgments'] = [{'take_kind': 'scene_video', 'take_id': take_id, 'file_id': 'video-output',
            'annotation': {'coverage': [], 'review_status': 'reviewed', 'verdict': 'retain', 'rationale': {},
                'retained_ranges': [media_range]}}]
        adopted = await client.put(detail, json={'request_id': str(uuid4()),
            'expected_revision': (await client.get(detail)).json()['data']['revision'], 'content': adopted_content})
        assert adopted.status_code == 200, adopted.text
        removed_content = deepcopy(adopted.json()['data']['content'])
        removed_content['units'] = []
        removed = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': (await client.get(detail)).json()['data']['revision'], 'content': removed_content})
        assert removed.status_code == 200, removed.text
        rejected = await client.post(retry_url, json={'request_id': str(uuid4())})
        assert rejected.status_code == 409 and '原单元已不可用' in rejected.text
        removed_state = (await client.get(detail)).json()['data']['content']
        assert removed_state['timeline'] == adopted.json()['data']['content']['timeline']
        assert removed_state['take_judgments'] == adopted.json()['data']['content']['take_judgments']
        assert (await client.get(media_path)).status_code == 200
        assert (await client.get(url)).json()['data'][0]['inputs']['unit']['coverage'][0]['action_scope'] == '递出信封'


        # 退出当前划分后只读核实旧授权，不得借核实创建新的执行。
        chapter_path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(chapter_path)).json()['data']
        sequence = chapter['sequences'][0]
        division = {'source_version': chapter['source_version'],
            'baseline': [{'sequence_id': sequence['id'], 'version': sequence['version']}],
            'members': [{'key': 'replacement', 'sequence_id': None, 'title': '新划分', 'span': {'start': 0, 'end': 4}}],
            'exited_sequence_ids': [sequence['id']], 'lineage': [{'sequence_id': sequence['id'], 'target_keys': ['replacement']}]}
        preview = await client.post(chapter_path + '/division/preview', json=division)
        assert preview.status_code == 200, preview.text
        divided = await client.put(chapter_path + '/division', json={'request_id': str(uuid4()), 'draft': division,
            'preview_token': preview.json()['data']['preview_token'], 'identity_changes_confirmed': True})
        assert divided.status_code == 200, divided.text
        original = await client.post(video_url, json=submit)
        assert original.status_code == 200, original.text
        assert original.json()['data']['task_id'] == video_id
        original_saved = await client.post(workflow_url, json=workflow)
        assert original_saved.status_code == 200, original_saved.text
        assert original_saved.json()['data']['task_id'] == workflow_task
        assert (await client.post(video_url, json={'request_id': str(uuid4()), 'expected_revision': 6})).status_code == 409
        assert (await client.post(workflow_url, json={**workflow, 'request_id': str(uuid4())})).status_code == 409
        assert len((await client.get(video_url)).json()['data']) == 4
        assert (await client.post(retry_url, json=retry_request)).json()['data']['task_id'] == retry_task
        assert (await client.post(retry_url, json={'request_id': str(uuid4())})).status_code == 409



@pytest.mark.asyncio
async def test_identity_requirement_can_use_bound_reference_for_video(tmp_path, reference_storage):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='identity-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='identity-text', name='identity-text', category='text', provider_id='identity-provider', params={}),
                        Model(id='identity-video', name='identity-video', category='video', provider_id='identity-provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '人物身份参考'})).json()['data']
        content = deepcopy(version['content'])
        content['design']['participants'] = [{'id': 'reader', 'name': '读信者'}]
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': ['reader'], 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'model_id': 'identity-video', 'duration_ms': 5000,
            'ratio': '16:9', 'instruction': '递出信封。', 'coverage': [{'id': 'coverage',
                'shot_id': 'shot', 'action_scope': '递出信封'}],
            'references': [{'id': 'portrait', 'file_id': 'image1', 'media_kind': 'image',
                'purpose': 'identity', 'participant_ids': ['reader'], 'ordinal': 0, 'input_role': 'first_frame',
                'source': {'kind': 'file', 'reference': 'image1', 'file_id': 'image1', 'version': '1'}}]}]
        complete_shot_scope_sample(content, '递出信封')
        detail = path + '/versions/' + version['id']
        unit_url = detail + '/units/unit'
        basis = await client.post(unit_url + '/instruction-basis/confirm', json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert basis.status_code == 200, basis.text
        content['units'][0]['instruction_basis_id'] = basis.json()['data']['basis_id']
        checks_url = unit_url + '/instruction-checks'
        submitted = await client.post(checks_url, json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content, 'model_id': 'identity-text'})
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        result = {'unit_id': 'unit', 'rows': [{'role': role, 'occurrence_id': 'coverage',
            'verdict': 'pass', 'rationale': '身份来自已绑定参考', 'findings': []} for role in
            ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']],
            'destinations': [
                {'owner': 'coverage:coverage', 'field': 'action_scope', 'coverage_item_ids': ['coverage'],
                 'destination': 'instruction', 'instruction_excerpt': '递出信封', 'rationale': '正文表达动作'},
                {'owner': 'participant:reader', 'field': 'identity', 'coverage_item_ids': ['coverage'],
                 'destination': 'reference', 'reference_id': 'portrait', 'rationale': '实际绑定读信者参考'},
            ]}
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='identity-check')
            await service.finish(task_id, result=result)
        confirmed = await client.post(checks_url + '/' + task_id + '/confirm', json={'content': content})
        assert confirmed.status_code == 200, confirmed.text
        content['units'][0]['instruction_check_task_id'] = task_id
        saved = await client.put(detail, json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        prepared = await client.post(unit_url + '/video/prepare', json={'expected_revision': 2})
        assert prepared.status_code == 200, prepared.text
        assert prepared.json()['data']['inputs']['unit']['references'][0]['id'] == 'portrait'
