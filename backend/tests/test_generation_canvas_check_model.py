"""Model checks through the saved canvas API, task admission and real Worker."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.test_generation_canvas_checks import connect_check, duration_canvas, save_canvas
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
async def test_check_model_uses_frozen_item_inputs_and_preserves_partial_results(runtime, monkeypatch):
    client, url = runtime.client, runtime.url
    checks = f'{url}/checks/check'
    document = duration_canvas(runtime.document)
    document['cards'][0].update(
        visible_result={'text': '关门但不关灯', 'state': 'fact', 'purpose': 'constraint'},
        narrative_role={'text': '仅供背景', 'state': 'fact', 'purpose': 'background'},
    )
    document['cards'].append({
        'id': 'criterion', 'type': 'direction.criterion', 'name': '门外无人时',
        'criterion_id': 'lights', 'standard': {'text': '保持灯光', 'state': 'fact'},
        'scope': {'phase': '试拍', 'condition': '门外无人'},
    })
    document['edges'].append({'id': 'criterion-link', 'source_card': 'criterion', 'source_port': 'criterion',
                              'target_card': 'shot', 'target_port': 'acceptance_basis'})
    document['input_order']['shot'] = {'acceptance_basis': ['criterion-link']}
    document['cards'][2]['prompt'] = {'segments': [{'id': 'prompt', 'kind': 'text', 'text': '保留室内光线'}]}
    connect_check(document)
    await save_canvas(client, url, document, 1)
    calls = []

    async def preview():
        response = await client.get(checks)
        assert response.status_code == 200, response.text
        return response.json()['data']

    async def run(basis, item_id=None):
        response = await client.post(f'{checks}/runs', json={
            'expected_revision': basis['revision'], 'basis_hash': basis['basis_hash'], 'item_id': item_id,
        })
        assert response.status_code == 200, response.text
        return response.json()['data']

    async def history():
        response = await client.get(f'{checks}/reports')
        assert response.status_code == 200, response.text
        for secret in ('private-secret', 'changed-secret', 'frozen.test', 'changed.test', 'execution_config'):
            assert secret not in response.text
        return response.json()['data']

    before = await preview()
    semantic = [item for item in before['items'] if item['category'] == 'P01']
    assert {item['field_id'] for item in semantic} == {'estimated_duration', 'visible_result', 'standard'}
    assert all(item['availability'] == 'unavailable' and '检查模型' in item['reason'] for item in semantic)
    rules = await run(before['basis'])
    assert len(rules['results']) == 1
    assert len([item for item in rules['omitted'] if item['status'] == 'unavailable']) == 3

    document = (await client.get(url)).json()['data']['document']
    async with runtime.sessions.begin() as db:
        db.add(Model(id='image-check', name='image-check', provider_id=runtime.provider_id, category='image'))
    document['cards'][3]['check_model_id'] = 'image-check'
    await save_canvas(client, url, document, 2)
    unsupported = await preview()
    assert all('不支持文字检查' in item['reason'] for item in unsupported['items'] if item['category'] == 'P01')
    assert len((await run(unsupported['basis']))['results']) == 1

    document = (await client.get(url)).json()['data']['document']
    document['cards'][3]['check_model_id'] = runtime.model_id
    await save_canvas(client, url, document, 3)
    available = await preview()
    accepted = await run(available['basis'])
    assert accepted['check_model_id'] == runtime.model_id
    assert len(accepted['results']) == 1
    assert {item['status'] for item in accepted['executions']} == {'queued'}
    assert not calls

    document = (await client.get(url)).json()['data']['document']
    document['cards'][0]['visible_result']['text'] = '已修改的内容'
    await save_canvas(client, url, document, 4)
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.name, model.params = 'changed-model', {'temperature': 0.9}
        provider = await db.get(Provider, runtime.provider_id)
        provider.base_url, provider.api_key = 'https://changed.test/v1', 'changed-secret'

    class FakeModel:
        def __init__(self, **params):
            self.params = params

        async def ainvoke(self, messages):
            body = json.loads(messages[1].content)
            calls.append((self.params, body))
            await history()
            field = body['requirement']['field_id']
            if field == 'visible_result' and self.params['model'] == 'changed-model':
                raise TimeoutError('response private diagnostic')
            if field == 'estimated_duration' and self.params['model'] == 'frozen-model':
                return SimpleNamespace(content='invalid response')
            snippet = '保留室内光线' if self.params['model'] == 'frozen-model' else '未找到的片段'
            return SimpleNamespace(content=json.dumps({
                'outcome': 'risk', 'message': '灯光要求仅部分体现', 'submitted_excerpt': snippet,
            }))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', FakeModel)
    worker = TaskWorker(runtime.sessions)
    try:
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        finished = (await history())[0]
        assert finished['id'] == accepted['id']
        assert {item['status'] for item in finished['executions']} == {'failed', 'succeeded'}
        assert len(finished['results']) == 3
        assert len(calls) == 3
        for params, body in calls:
            assert params['model'] == 'frozen-model' and params['temperature'] == 0.3
            assert params['api_key'] == 'private-secret' and params['max_retries'] == 0
            assert '已修改的内容' not in body['submitted_text']
            if body['requirement']['field_id'] == 'standard':
                assert body['requirement']['scope']['condition'] == '门外无人'
            assert '30 秒' not in body['submitted_text']
        result = next(item for item in finished['results'] if item['outcome'] == 'risk' and item.get('submitted_excerpt'))
        assert result['submitted_excerpt'] == '保留室内光线'
        failed = next(item for item in finished['executions'] if item['status'] == 'failed')
        retry = await run((await preview())['basis'], failed['item_id'])
        assert retry['id'] != finished['id'] and retry['scope'] == 'item'
        assert [item['id'] for item in retry['items']] == [failed['item_id']]
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        newest, original, *_ = await history()
        assert original == finished
        assert newest['results'][0]['outcome'] == 'indeterminate'
        assert len(calls) == 4
        assert calls[-1][0]['model'] == 'changed-model'
        visible_result = next(item for item in available['items'] if item['field_id'] == 'visible_result')
        await run((await preview())['basis'], visible_result['id'])
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        timed_out = (await history())[0]
        assert timed_out['results'] == []
        assert timed_out['executions'][0]['reason'] == '任务执行超时'
        assert len(calls) == 5
    finally:
        worker.text_pool.shutdown(wait=False)
