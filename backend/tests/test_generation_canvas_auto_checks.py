"""Automatic checks through real generation admission, settlement, and the Worker."""
import asyncio
import json

import httpx
import pytest

from app.api.v1.routes.film.task_status import router as tasks_router
from app.models.llm import Model, Provider
from app.services.task_service import AUTO_CHECK_DISPATCH, TaskService
from app.task_worker import TaskWorker
from tests.test_generation_canvas_check_reference_media import solid_png
from tests.test_generation_canvas_checks import connect_check, save_canvas
from tests.test_generation_canvas_images import image_storage  # noqa: F401
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
async def test_complete_result_sets_use_frozen_automatic_checks_and_durable_edge_identity(runtime, image_storage):
    async with runtime.sessions.begin() as db:
        generation = await db.get(Model, runtime.model_id)
        generation.category, generation.name, generation.params = 'image', 'image-model', {}
        db.add(Provider(id='vision-provider', name='aliyun_bailian', api_key='frozen-check-key', base_url='https://vision.test/v1'))
        await db.flush()
        db.add(Model(id='vision', name='qwen3-vl-plus', provider_id='vision-provider', category='text'))

    runtime.app.include_router(tasks_router)
    client, url = runtime.client, runtime.url
    checks = f'{url}/checks/check'
    document = runtime.document
    document['cards'][0].update(id='image', type='model.image', config={'count': 3})
    document['cards'].extend([
        {'id': 'shot', 'type': 'direction.shot', 'visible_result': {'text': '红色背景', 'state': 'fact'}},
        {'id': 'style', 'type': 'direction.style', 'fields': {'colors': {'text': '暖色风格', 'state': 'fact'}}},
        {'id': 'check', 'type': 'review.check', 'check_model_id': 'vision'},
    ])
    document['edges'] = [{'id': source, 'source_card': source, 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}
                         for source in ('shot', 'style')]
    document['input_order'] = {'image': {'text': ['shot', 'style']}}
    connect_check(document, source='image')
    await save_canvas(client, url, document, 1)

    calls = []
    partial = False

    def provider(request):
        if request.url.host == 'vision.test':
            body = json.loads(request.content)
            requirements = json.loads(body['messages'][1]['content'][0]['text'])['requirements']
            calls.append((request.headers.get('authorization'), requirements))
            if len(calls) == 2:
                return httpx.Response(503)
            return httpx.Response(200, json={'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
                'role': 'assistant', 'content': json.dumps({'results': [
                    {'item_id': item['item_id'], 'outcome': 'risk', 'message': '原要求只部分可见', 'visible_evidence': '可见红色背景'}
                    for item in requirements
                ]}),
            }}]})
        if request.url.host == 'media.test':
            if partial and request.url.path.endswith('/2'):
                return httpx.Response(503)
            index = int(request.url.path[-1])
            return httpx.Response(200, content=solid_png((index * 100, 0, 0)), headers={'Content-Type': 'image/png'})
        count = json.loads(request.content)['n']
        return httpx.Response(200, json={'data': [{'url': f'https://media.test/{index}'} for index in range(count)]})

    async def get(path):
        response = await client.get(path)
        assert response.status_code == 200, response.text
        return response.json()['data']

    async def save(change):
        saved = await get(url)
        change(saved['document'])
        await save_canvas(client, url, saved['document'], saved['revision'])

    async def preview():
        response = await client.post(url + '/precheck', json={'card_id': 'image'})
        assert response.status_code == 200, response.text
        data = response.json()['data']
        assert data['can_run'], data
        return data

    async def submit(request_id, data):
        response = await client.post(url + '/runs', json={'request_id': request_id, 'preview_token': data['preview_token']})
        assert response.status_code == 200, response.text
        return response.json()['data']

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as transport:
        worker = TaskWorker(runtime.sessions, client=transport)

        async def drain():
            for _ in range(8):
                await worker.tick()
                if not worker.jobs:
                    return
                await asyncio.gather(*worker.jobs.values())

        try:
            disabled = await preview()
            assert disabled['automatic_checks'] == []
            old = await submit('disabled', disabled)
            await drain()
            assert await get(f'{checks}/reports') == []

            def enable(doc):
                doc['cards'][-1].update(auto_post_check=True, post_check_categories=['R01', 'R03'])
            await save(enable)
            assert await get(f'{checks}/reports') == []
            accepted_preview = await preview()
            estimate, = accepted_preview['automatic_checks']
            assert estimate['check_card_id'] == 'check' and estimate['target_card_id'] == 'image'
            assert estimate['product_count'] == 3 and estimate['observation_method'] == 'image' and estimate['estimated_calls'] == 3
            accepted = await submit('enabled', accepted_preview)

            def change_after_accept(doc):
                doc['cards'][-1].update(auto_post_check=False, post_check_categories=['R03'], check_model_id=None)
                doc['cards'][1]['visible_result']['text'] = '蓝色背景'
            await save(change_after_accept)
            async with runtime.sessions.begin() as db:
                (await db.get(Provider, 'vision-provider')).api_key = 'new-key'
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            async with runtime.sessions.begin() as db:
                service = TaskService(db)
                interrupted = await service.claim_next(worker_id='interrupted-worker', kinds=(AUTO_CHECK_DISPATCH,))
                assert interrupted is not None
            assert await get(f'{checks}/reports') == []
            async with runtime.sessions.begin() as db:
                assert await TaskService(db).interrupt_previous_workers(worker_id=worker.worker_id) == 1
            await drain()
            reports = await get(f'{checks}/reports')
            assert len(reports) == 3 and {row['product']['position'] for row in reports} == {0, 1, 2}
            assert {row['product']['run_id'] for row in reports} == {accepted['run_id']}
            assert all(row['automatic'] and row['check_model_id'] == 'vision' for row in reports)
            assert all(row['configuration']['auto_post_check'] and row['configuration']['categories'] == ['R01', 'R03']
                       for row in reports)
            listed = await get(f'/tasks?project_id={runtime.project_id}')
            assert listed['items'] and not any(row['task_kind'] == AUTO_CHECK_DISPATCH for row in listed['items'])
            assert (await get(f'/tasks?project_id={runtime.project_id}&task_kind={AUTO_CHECK_DISPATCH}'))['items'] == []
            check_task = next(row for row in listed['items'] if row['task_kind'] == 'canvas_check')
            assert check_task['source']['project_id'] == runtime.project_id
            assert check_task['source']['canvas_id'] == runtime.canvas_id
            assert check_task['source']['check_card_id'] == 'check'
            assert check_task['source']['check_report_id'] in {row['id'] for row in reports}
            assert (await get(f'/tasks?project_id=wrong-project&target_id={check_task["target_id"]}'))['items'] == []
            assert {len(row['results']) for row in reports} == {0, 2}
            assert all({item['category'] for item in row['items']} == {'R01', 'R03'} for row in reports)
            assert len(calls) == 3 and {header for header, _ in calls} == {'Bearer frozen-check-key'}
            assert all('红色背景' in str(requirements) and '蓝色背景' not in str(requirements) for _, requirements in calls)
            state = await get(f'{url}/runtime')
            node = next(row['nodes'][0] for row in state['runs'] if row['id'] == accepted['run_id'])
            assert node['status'] == 'succeeded' and not node['current_output_updated']
            assert await submit('enabled', accepted_preview) == accepted
            async with runtime.sessions.begin() as db:
                # Deliver the same terminal notification again.
                await TaskService(db).finish(accepted['task_ids'][0])
            await drain()
            assert len(calls) == 3 and await get(f'{checks}/reports') == reports

            product = next(row for row in await get(f'{checks}/products') if row['run_id'] == old['run_id'])
            product_url = f"{checks}/products/{product['run_id']}/{product['node_id']}/{product['position']}"
            manual = await get(product_url)
            assert manual['estimated_calls'] == 0
            assert {item['category'] for item in manual['items'] if item['enabled']} == {'R03'}

            def reenable(doc):
                enable(doc)
                doc['cards'][-1]['check_model_id'] = 'vision'
            await save(reenable)
            detached = await submit('detach', await preview())
            def detach(doc):
                doc['edges'] = [edge for edge in doc['edges'] if edge['id'] != 'observe']
                del doc['input_order']['check']
            await save(detach)
            await save(lambda doc: connect_check(doc, source='image'))
            await drain()
            assert len(calls) == 3 and await get(f'{checks}/reports') == reports
            generations = (await get(f'{url}/runtime'))['runs']
            assert next(row for row in generations if row['id'] == detached['run_id'])['nodes'][0]['status'] == 'succeeded'

            cancel_run = await submit('cancel-report', await preview())
            for _ in range(2):
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
            pending = [row for row in await get(f'{checks}/reports') if row['product']['run_id'] == cancel_run['run_id']]
            assert len(pending) == 3 and all(row['executions'][0]['status'] == 'queued' for row in pending)
            cancelled = await client.post(f"{checks}/reports/{pending[0]['id']}/cancel")
            assert cancelled.status_code == 200, cancelled.text
            assert cancelled.json()['data']['executions'][0]['status'] == 'cancelled'
            await drain()
            final = await get(f'{checks}/reports')
            assert len(calls) == 5 and len(final) == 6
            assert next(row for row in final if row['id'] == pending[0]['id'])['results'] == []
            generations = (await get(f'{url}/runtime'))['runs']
            assert next(row for row in generations if row['id'] == cancel_run['run_id'])['nodes'][0]['status'] == 'succeeded'

            partial = True
            incomplete = await submit('partial', await preview())
            await drain()
            assert len(calls) == 5 and await get(f'{checks}/reports') == final
            assert any(row['run_id'] == incomplete['run_id'] and row['generation_status'] == 'failed'
                       for row in await get(f'{checks}/products'))

            async with runtime.sessions.begin() as db:
                await db.delete(await db.get(Model, 'vision'))
                await db.flush()
                await db.delete(await db.get(Provider, 'vision-provider'))
            original = next(row for row in reports if row['results'])
            item_id = original['results'][0]['item_id']
            response = await client.post(f"{checks}/reports/{original['id']}/recheck", json={
                'item_id': item_id, 'clarification': '请复核原画面',
            })
            assert response.status_code == 200, response.text
            await drain()
            reviewed = next(row for row in await get(f'{checks}/reports') if row['id'] == response.json()['data']['id'])
            assert reviewed['product'] == original['product'] and len(reviewed['results']) == 1
            assert 'frozen-check-key' not in str(reviewed) and calls[-1][0] == 'Bearer frozen-check-key'
        finally:
            worker.text_pool.shutdown(wait=False)
