"""Historical text inspection through public requests and the real Worker."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.task_worker import TaskWorker
from tests.test_generation_canvas_checks import connect_check, save_canvas
from tests.test_generation_canvas_runs import accept, runtime  # noqa: F401


@pytest.mark.asyncio
async def test_text_product_check_retains_original_basis_and_allows_partial(runtime, monkeypatch):
    client, url = runtime.client, runtime.url
    document = runtime.document
    document['cards'].extend([
        {'id': 'shot', 'type': 'direction.shot', 'visible_result': {'text': '红伞留在门边', 'state': 'fact'}},
        {'id': 'check', 'type': 'review.check', 'check_model_id': runtime.model_id},
    ])
    document['edges'] = [{'id': 'adopt', 'source_card': 'shot', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}]
    document['input_order'] = {'m': {'text': ['adopt']}}
    connect_check(document, source='m')
    await save_canvas(client, url, document, 1)
    checks = f'{url}/checks/check'
    products = checks + '/products'
    calls = []
    fail_check = False

    class Model:
        def __init__(self, **params):
            assert params['max_retries'] == 0

        async def astream(self, messages):
            if '红伞' in messages[0].content:
                yield SimpleNamespace(content='门边放着一把红伞。')
            else:
                yield SimpleNamespace(content='保留片段。')
                raise RuntimeError('controlled failure after a partial result')

        async def ainvoke(self, messages):
            data = json.loads(messages[1].content)
            calls.append(data)
            if fail_check:
                return SimpleNamespace(content='malformed R01 response')
            return SimpleNamespace(content=json.dumps({'results': [{
                'item_id': row['item_id'], 'outcome': 'conforming', 'message': '文字可见',
                'submitted_excerpt': '门边放着一把红伞。',
            } for row in data['requirements']]}))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', Model)
    worker = TaskWorker(runtime.sessions)

    async def advance():
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())

    async def get(target):
        response = await client.get(target)
        assert response.status_code == 200, response.text
        return response.json()['data']

    async def submit(target, preview, status=200, **override):
        response = await client.post(target + '/runs', json={
            'expected_revision': preview['revision'], 'basis_hash': preview['basis']['basis_hash'],
            'expected_calls': preview['estimated_calls'], **override,
        })
        assert response.status_code == status, response.text
        return response.json().get('data')

    try:
        old_run, _ = await accept(runtime, 'first')
        await advance()
        old, = await get(products)
        assert old['run_id'] == old_run['run_id'] and old['generation_status'] == 'succeeded'
        old_url = f"{products}/{old['run_id']}/{old['node_id']}/{old['position']}"
        prepared = await get(old_url)
        assert prepared['estimated_calls'] == 1 and prepared['product']['text'] == '门边放着一把红伞。'
        assert prepared['items'][0]['category'] == 'R01' and not calls

        document = (await get(url))['document']
        document['cards'][1]['visible_result']['text'] = '蓝伞留在门边'
        await save_canvas(client, url, document, 2)
        await submit(old_url, prepared, 409)
        partial_run, _ = await accept(runtime, 'second')
        await advance()
        partial, still_old = await get(products)
        assert still_old == old
        assert partial['run_id'] == partial_run['run_id'] and partial['generation_status'] == 'failed'
        assert partial['result_set_id'] is None
        partial_url = f"{products}/{partial['run_id']}/{partial['node_id']}/{partial['position']}"
        assert (await client.get(old_url.replace(old['node_id'], partial['node_id']))).status_code == 422
        assert (await client.get(old_url.replace(runtime.project_id, 'different-project'))).status_code == 404
        fixed = await get(old_url)
        assert fixed['revision'] == 3 and fixed['basis']['revision'] == 2
        assert '红伞' in fixed['basis']['input']['text'] and '蓝伞' not in fixed['basis']['input']['text']
        partial_preview = await get(partial_url)
        await submit(old_url, fixed, 409, basis_hash=partial_preview['basis']['basis_hash'])
        await submit(old_url, fixed, 409, expected_calls=0)
        assert await get(checks + '/reports') == []

        submitted = await submit(old_url, fixed)
        incomplete = await submit(partial_url, partial_preview)
        assert submitted['product']['result_set_id'] == old['result_set_id']
        assert incomplete['product']['generation_status'] == 'failed'
        await advance()
        latest, historical = await get(checks + '/reports')
        assert len(calls) == 2
        complete_call = next(call for call in calls if not call['incomplete'])
        assert complete_call['requirements'][0]['text'] == '红伞留在门边'
        assert complete_call['output_text'] == '门边放着一把红伞。'
        assert next(call for call in calls if call['incomplete'])['output_text'] == '保留片段。'
        assert historical['id'] == submitted['id'] and historical['basis'] == fixed['basis']
        assert historical['results'][0]['submitted_excerpt'] == '门边放着一把红伞。'
        assert latest['results'][0]['outcome'] == 'indeterminate'
        assert 'private-secret' not in str(historical)
        fail_check = True
        failed_check = await submit(old_url, fixed)
        await advance()
        failure, old_partial, old_complete = await get(checks + '/reports')
        assert old_partial == latest and old_complete == historical
        assert failure['id'] == failed_check['id'] and failure['results'] == []
        assert failure['executions'][0]['status'] == 'failed'
        assert failure['executions'][0]['reason'] == '检查模型返回无法解析'
        assert len(calls) == 3
        generations = {run['id']: run['nodes'][0]['status'] for run in (await get(url + '/runtime'))['runs']}
        assert generations == {old_run['run_id']: 'succeeded', partial_run['run_id']: 'failed'}

        document = (await get(url))['document']
        document['cards'][1]['visible_result'] = {'text': '仅供背景', 'state': 'fact', 'purpose': 'background'}
        await save_canvas(client, url, document, 3)
        no_requirement, _ = await accept(runtime, 'no-requirement')
        await advance()
        product = next(product for product in await get(products) if product['run_id'] == no_requirement['run_id'])
        empty_url = f"{products}/{product['run_id']}/{product['node_id']}/{product['position']}"
        empty = await get(empty_url)
        assert empty['items'] == [] and empty['estimated_calls'] == 0
        unavailable = await submit(empty_url, empty)
        assert unavailable['results'] == [] and unavailable['executions'] == []
        assert '依据缺失' in unavailable['omitted'][0]['reason']
        await advance()
        assert len(calls) == 3
    finally:
        worker.text_pool.shutdown(wait=False)
