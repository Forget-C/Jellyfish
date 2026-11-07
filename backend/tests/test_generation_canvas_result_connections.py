"""Result position scopes through document save, candidate reads and compilation."""
import asyncio
import base64
import json
import httpx
import pytest
from tests.test_generation_canvas_images import accept, image_card, image_storage  # noqa: F401
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
async def test_generated_result_scopes_keep_other_paths_and_protect_actual_references(runtime, image_storage):
    from app.task_worker import TaskWorker
    await image_card(runtime)

    def provider(request):
        count = json.loads(request.content)['n']
        return httpx.Response(200, json={'data': [
            {'b64_json': base64.b64encode(str(position).encode()).decode()} for position in range(count)
        ]})

    async def save(request_id, revision, document):
        return await runtime.client.put(runtime.url, json={
            'request_id': request_id, 'expected_revision': revision, 'document': document,
        })

    async def read():
        return (await runtime.client.get(runtime.url)).json()['data']['document']

    async def read_candidates(target):
        return (await runtime.client.get(runtime.url + f'/cards/{target}/outputs')).json()['data']['candidates']

    async def candidates(target):
        return [(item['source']['position'], item['available']) for item in await read_candidates(target)
                if item['source']['card_id'] == 'image']

    def source(position, card_id='image'):
        return {'canvas_id': runtime.canvas_id, 'card_id': card_id, 'port_id': 'image', 'position': position}

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        async def generate(request_id):
            await accept(runtime, request_id)
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())

        try:
            await generate('initial-results')
            document = await read()
            for target in ('single', 'whole'):
                document['cards'].append({'id': target, 'type': 'model.image', 'model_id': runtime.model_id})
                document['edges'].append({'id': target, 'source_card': 'image', 'source_port': 'image',
                                          'target_card': target, 'target_port': 'image'})
                document['input_order'][target] = {'image': [target]}
            document['edges'][0]['result_scope'] = {'mode': 'only', 'positions': [2]}
            selected, whole = document['cards'][-2:]
            selected['input_bindings'] = [{'id': 'keep', 'input_port': 'image', 'source': source(2)}]
            state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
            run = state['runs'][0]
            fixed = (await runtime.client.get(runtime.url + f"/runs/{run['id']}/nodes/{run['nodes'][0]['id']}/outputs/1/content")).json()['data']
            document['cards'].append(fixed)
            document['edges'].append({'id': 'fixed', 'source_card': fixed['id'], 'source_port': 'image',
                                      'target_card': 'whole', 'target_port': 'image'})
            document['input_order']['whole']['image'].append('fixed')
            whole['input_bindings'] = [{'id': 'fixed', 'input_port': 'image', 'source': source(0, fixed['id'])}]
            document['cards'].append({'id': 'multi', 'type': 'model.video', 'input_bindings': [
                {'id': 'first', 'input_port': 'first_frame', 'source': source(1)},
                {'id': 'subject', 'input_port': 'subject_image', 'source': source(1), 'subject_name': '主角'},
            ]})
            document['edges'].append({'id': 'multi', 'source_card': 'image', 'source_port': 'image',
                                      'target_card': 'multi', 'target_port': 'first_frame',
                                      'result_scope': {'mode': 'only', 'positions': [1]}})
            document['input_order']['multi'] = {'first_frame': ['multi']}
            response = await save('connect-results', 2, document)
            assert response.status_code == 200, response.text
            assert await candidates('single') == [(2, True)]
            assert await candidates('whole') == [(0, True), (1, True), (2, True)]
            assert await candidates('multi') == [(1, True)]
            multi_edges = [edge for edge in (await read())['edges'] if edge['target_card'] == 'multi']
            assert {edge['target_port'] for edge in multi_edges} >= {'first_frame', 'subject_image'}
            assert all(edge['result_scope'] == {'mode': 'only', 'positions': [1]} for edge in multi_edges)
            compiled = (await runtime.client.get(runtime.url + '/cards/single/compile')).json()['data']
            assert [value['source']['position'] for value in compiled['media']] == [2]

            blocked = await read()
            blocked['edges'][0]['result_scope']['positions'] = [1]
            response = await save('break-used-result', 3, blocked)
            assert response.status_code == 422
            assert response.json()['detail']['code'] == 'REFERENCE_IN_USE'
            assert await candidates('single') == [(2, True)]

            invalid = await read()
            invalid['edges'][1]['result_scope'] = {'mode': 'except', 'positions': [99]}
            response = await save('invalid-position', 3, invalid)
            assert response.status_code == 422
            assert response.json()['detail']['code'] == 'INVALID_RESULT_SCOPE'

            invalid = await read()
            next(edge for edge in invalid['edges'] if edge['id'] == 'fixed')['result_scope'] = {'mode': 'only', 'positions': [0]}
            response = await save('invalid-source-modality', 3, invalid)
            assert response.status_code == 422
            assert response.json()['detail']['code'] == 'INVALID_RESULT_SCOPE'

            invalid = await read()
            next(edge for edge in invalid['edges'] if edge['target_card'] == 'multi' and edge['target_port'] == 'subject_image').pop('result_scope')
            response = await save('inconsistent-uses', 3, invalid)
            assert response.status_code == 422
            assert response.json()['detail']['code'] == 'INVALID_RESULT_SCOPE'

            document = await read()
            document['edges'][1]['result_scope'] = {'mode': 'except', 'positions': [1]}
            document['cards'][0]['config']['count'] = 2
            response = await save('shorten-results', 3, document)
            assert response.status_code == 200, response.text
            await generate('shorter-results')
            assert await candidates('single') == [(2, False)]
            assert await candidates('whole') == [(0, True), (2, False)]
            fixed_candidate = next(item for item in await read_candidates('whole') if item['source']['card_id'] == fixed['id'])
            compiled = (await runtime.client.get(runtime.url + '/cards/whole/compile')).json()['data']
            assert fixed_candidate['token'] == compiled['media'][0]['token'] == '@图片2'

            document = await read()
            document['cards'][0]['config']['count'] = 4
            response = await save('lengthen-results', 4, document)
            assert response.status_code == 200, response.text
            await generate('longer-results')
            assert await candidates('single') == [(2, True)]
            assert await candidates('whole') == [(0, True), (2, True), (3, True)]
        finally:
            worker.text_pool.shutdown(wait=False)
