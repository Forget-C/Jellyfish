"""Result position scopes through document save, candidate reads and compilation."""
import asyncio
import base64
from copy import deepcopy
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


@pytest.mark.asyncio
async def test_fixing_middle_image_preserves_video_media_order_and_subject_aliases(runtime, image_storage):
    from app.task_worker import TaskWorker
    await image_card(runtime)

    def provider(_request):
        return httpx.Response(200, json={'data': [
            {'b64_json': base64.b64encode(value).decode()} for value in (b'first', b'middle', b'last')
        ]})

    async def read():
        return (await runtime.client.get(runtime.url)).json()['data']['document']

    async def save(revision, document):
        response = await runtime.client.put(runtime.url, json={
            'request_id': f'ordered-{revision}', 'expected_revision': revision, 'document': document,
        })
        assert response.status_code == 200, response.text

    async def compile_video():
        return (await runtime.client.get(runtime.url + '/cards/video/compile')).json()['data']

    def source(position, card_id='image'):
        return {'canvas_id': runtime.canvas_id, 'card_id': card_id, 'port_id': 'image', 'position': position}

    await accept(runtime, 'generate-ordered')
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
    document = await read()
    document['cards'].append({'id': 'video', 'type': 'model.video', 'prompt': {'segments': [
        {'id': f'ref-{index}', 'kind': 'reference', 'binding_id': f'bind-{index}'} for index in (2, 0, 1)
    ]}, 'input_bindings': [
        {'id': f'bind-{index}', 'input_port': 'subject_image', 'source': source(index)} for index in (2, 0, 1)
    ]})
    document['edges'].append({'id': 'ordered-images', 'source_card': 'image', 'source_port': 'image',
                              'target_card': 'video', 'target_port': 'subject_image'})
    document['input_order']['video'] = {'subject_image': ['ordered-images']}
    await save(2, document)
    original = await compile_video()
    assert original['text'] == '@media3@media1@media2'
    assert [item['source']['position'] for item in original['media']] == [0, 1, 2]

    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run = state['runs'][0]
    node = run['nodes'][0]
    response = await runtime.client.get(runtime.url + f"/runs/{run['id']}/nodes/{node['id']}/outputs/1/content")
    fixed = response.json()['data']
    document = await read()
    document['cards'][0]['detached_results'] = [{'position': 1, 'result_set_id': node['result_set_id'], 'content_card_id': fixed['id']}]
    document['cards'][-1]['input_bindings'][-1]['source'] = source(0, fixed['id'])
    document['cards'].append(fixed)
    for edge in [item for item in document['edges'] if item['target_card'] == 'video']:
        edge['result_scope'] = {'mode': 'except', 'positions': [1]}
        fixed_edge = dict(edge, id=f"fixed-{edge['target_port']}", source_card=fixed['id'],
                          order_anchor={'edge_id': edge['id'], 'position': 1})
        fixed_edge.pop('result_scope')
        document['edges'].append(fixed_edge)
        document['input_order']['video'][edge['target_port']].append(fixed_edge['id'])
    for wrong_model in (False, True):
        invalid = deepcopy(document)
        anchored = next(edge for edge in invalid['edges'] if edge.get('order_anchor'))
        if wrong_model:
            invalid['cards'].append({'id': 'unrelated-model', 'type': 'model.image'})
            original_edge = next(edge for edge in invalid['edges'] if edge['id'] == anchored['order_anchor']['edge_id'])
            original_edge.update(id='other-anchor', source_card='unrelated-model')
            original_edge.pop('result_scope')
            invalid['input_order']['video'][original_edge['target_port']][0] = 'other-anchor'
            anchored['order_anchor']['edge_id'] = 'other-anchor'
        else:
            anchored['order_anchor']['position'] = 9876
        rejected = await runtime.client.put(runtime.url, json={
            'request_id': f'wrong-anchor-{wrong_model}', 'expected_revision': 3, 'document': invalid,
        })
        assert rejected.status_code == 422, rejected.text
        assert rejected.json()['detail']['code'] == 'INVALID_RESULT_ORDER'
    await save(3, document)

    detached = await compile_video()
    assert detached['text'] == original['text']
    assert detached['video_media'] == original['video_media']
    assert [item['file_id'] for item in detached['media']] == [item['file_id'] for item in original['media']]
    assert [item['source']['card_id'] for item in detached['media']] == ['image', fixed['id'], 'image']
    outputs = (await runtime.client.get(runtime.url + '/cards/video/outputs')).json()['data']['candidates']
    assert [(item['source']['card_id'], item['token']) for item in outputs] == [
        ('image', '@图片1'), (fixed['id'], '@图片2'), ('image', '@图片3'),
    ]

    # A later deletion of the model clears the ordering anchor without removing the independent input.
    document = await read()
    document['cards'] = [card for card in document['cards'] if card['id'] != 'image']
    video = next(card for card in document['cards'] if card['id'] == 'video')
    video['prompt']['segments'] = [segment for segment in video['prompt']['segments'] if segment['id'] == 'ref-1']
    video['input_bindings'] = [binding for binding in video['input_bindings'] if binding['id'] == 'bind-1']
    removed = {edge['id'] for edge in document['edges'] if edge['source_card'] == 'image'}
    document['edges'] = [edge for edge in document['edges'] if edge['id'] not in removed]
    for order in document['input_order']['video'].values():
        order[:] = [edge_id for edge_id in order if edge_id not in removed]
    await save(4, document)
    assert [item['file_id'] for item in (await compile_video())['media']] == [fixed['file_id']]
    assert not any('order_anchor' in edge for edge in (await read())['edges'])


@pytest.mark.asyncio
@pytest.mark.parametrize('mode,initial,reduced,expanded', [
    ('only', [0, 1], [0], [0, 2]),
    ('except', [0], [0, 1], [0]),
])
async def test_expanding_retained_result_scope_rechecks_model_capability(runtime, image_storage, mode, initial, reduced, expanded):
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    await image_card(runtime)
    await accept(runtime, 'publish-for-capability-check')

    def provider(_request):
        return httpx.Response(200, json={'data': [
            {'b64_json': base64.b64encode(str(index).encode()).decode()} for index in range(3)
        ]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
    async with runtime.sessions.begin() as db:
        db.add(Provider(id='kling-provider', provider_key='kling', name='kling', api_key='test', base_url='https://test.invalid'))
        await db.flush()
        db.add(Model(id='text-only-video', name='kling-3.0-turbo', category='video', provider_id='kling-provider', params={}))

    async def save(request_id, revision, document):
        return await runtime.client.put(runtime.url, json={
            'request_id': request_id, 'expected_revision': revision, 'document': document,
        })

    async def read():
        return (await runtime.client.get(runtime.url)).json()['data']

    document = (await read())['document']
    document['cards'].append({'id': 'video', 'type': 'model.video'})
    document['edges'] = [{'id': 'images', 'source_card': 'image', 'source_port': 'image',
                          'target_card': 'video', 'target_port': 'first_frame',
                          'result_scope': {'mode': mode, 'positions': initial}}]
    document['input_order'] = {'video': {'first_frame': ['images']}}
    response = await save('connect-before-selecting-model', 2, document)
    assert response.status_code == 200, response.text

    document = (await read())['document']
    document['cards'][-1]['model_id'] = 'text-only-video'
    response = await save('retain-scoped-connection', 3, document)
    assert response.status_code == 200, response.text
    for edge in document['edges']:
        edge['result_scope']['positions'] = reduced
    response = await save('reduce-scoped-connection', 4, document)
    assert response.status_code == 200, response.text

    before = await read()
    for edge in document['edges']:
        edge['result_scope']['positions'] = expanded
    response = await save('expand-scoped-connection', 5, document)
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'UNSUPPORTED_INPUT'
    assert await read() == before

    # The existing candidate may move to its fixed content even after a capability change.
    position = 0 if mode == 'only' else 2
    run = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['runs'][0]
    node = run['nodes'][0]
    url = runtime.url + f"/runs/{run['id']}/nodes/{node['id']}/outputs/{position}/content"
    fixed = (await runtime.client.get(url)).json()['data']
    document = deepcopy(before['document'])
    document['cards'][0]['detached_results'] = [{
        'position': position, 'result_set_id': node['result_set_id'], 'content_card_id': fixed['id'],
    }]
    document['cards'].append(fixed)
    original_edges = list(document['edges'])
    if mode == 'only':
        document['edges'] = []
    for edge in original_edges:
        replacement = {**edge, 'id': 'fixed-' + edge['target_port'], 'source_card': fixed['id']}
        replacement.pop('result_scope')
        order = document['input_order']['video'][edge['target_port']]
        if mode == 'only':
            order.clear()
        else:
            edge['result_scope']['positions'].append(position)
            replacement['order_anchor'] = {'edge_id': edge['id'], 'position': position}
        order.append(replacement['id'])
        document['edges'].append(replacement)
    migrated = await save('preserve-existing-candidate', 5, document)
    assert migrated.status_code == 200, migrated.text
    candidates = (await runtime.client.get(runtime.url + '/cards/video/outputs')).json()['data']['candidates']
    assert [(item['source']['card_id'], item['file_id']) for item in candidates] == [(fixed['id'], fixed['file_id'])]

    # Prior eligibility of the migrated route grants no exception for another consumer.
    document = (await read())['document']
    document['cards'].append({'id': 'new-video', 'type': 'model.video', 'model_id': 'text-only-video'})
    document['edges'].append({'id': 'new-fixed-edge', 'source_card': fixed['id'], 'source_port': 'image',
                              'target_card': 'new-video', 'target_port': 'first_frame'})
    document['input_order']['new-video'] = {'first_frame': ['new-fixed-edge']}
    invalid = await save('cannot-extend-migrated-candidate', 6, document)
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()['detail']['code'] == 'UNSUPPORTED_INPUT'

    frozen = (await read())['document']
    expanded_undo = deepcopy(before['document'])
    for edge in expanded_undo['edges']:
        edge['result_scope']['positions'] = [0, 1] if mode == 'only' else [0]
    invalid = await save('undo-with-extra-slot', 6, expanded_undo)
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()['detail']['code'] == 'UNSUPPORTED_INPUT'
    undone = await save('undo-migrated-candidate', 6, before['document'])
    assert undone.status_code == 200, undone.text
    assert await read() == {**before, 'revision': 7}
    redone = await save('redo-migrated-candidate', 7, frozen)
    assert redone.status_code == 200, redone.text
    assert (await read())['document'] == frozen
