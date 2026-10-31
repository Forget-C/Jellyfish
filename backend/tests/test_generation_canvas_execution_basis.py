"""Historical admission JSON → real Task terminal → waiting execution and HTTP history."""
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4
import asyncio
import pytest
from sqlalchemy import select
from app.models.generation_canvas import CanvasRun, CanvasRunNode, CanvasScopeOccupancy, GenerationCanvas
from app.models.llm import Model, Provider
from app.models.task import Task
from app.services.task_service import TaskService
from app.task_worker import TaskWorker
from tests.test_generation_canvas_runs import runtime, accept  # noqa: F401


async def historical_waiter(runtime, *, position=0, cascade=False, image=False):
    """Load the persisted legacy shape independently of the implementation under test."""
    accepted, _ = await accept(runtime)
    document = deepcopy(runtime.document)
    model_id = 'image-' + runtime.model_id if image else runtime.model_id
    frozen = {'model_name': 'image-model' if image else 'frozen-model',
        'model_params': {} if image else {'temperature': .3, 'default_headers': {'Authorization': 'Bearer model-private-secret'}},
        'provider_id': runtime.provider_id, 'provider_key': 'openai',
        'api_key': 'private-secret', 'base_url': 'https://frozen.test/v1'}
    snapshots = {}
    for card_id, source in [('B', 'm')] + ([('C', 'B')] if cascade else []):
        source_identity = {'canvas_id': runtime.canvas_id, 'card_id': source, 'port_id': 'text', 'position': position if card_id == 'B' else 0}
        card = {'id': card_id, 'type': 'model.image' if image else 'model.text', 'model_id': model_id,
            'prompt': {'segments': [{'id': 'prefix', 'kind': 'text', 'text': 'Historical: '},
                {'id': 'ref', 'kind': 'reference', 'source': source_identity}]}}
        if image:
            card['config'] = {'count': 2}
        document['cards'].append(card)
        document.setdefault('edges', []).append({'id': source + card_id, 'source_card': source,
            'source_port': 'text', 'target_card': card_id, 'target_port': 'text'})
        document.setdefault('input_order', {})[card_id] = {'text': [source + card_id]}
        snapshots[card_id] = {'revision': 1, 'dependencies': [source],
            'outputs': {source: [{'source': {**source_identity, 'position': index}, 'modality': 'text',
                'text': 'Old position ' + str(index)} for index in range(2)]},
            'execution_config': deepcopy(frozen),
            'capability': {'model_id': model_id, 'modality': 'image' if image else 'text',
                'input_ports': ['text'], 'min_count': 1, 'max_count': 2}}
    async with runtime.sessions.begin() as db:
        from app.schemas.generation_canvas import CanvasDocument
        canvas = await db.get(GenerationCanvas, runtime.canvas_id)
        canvas.document = CanvasDocument.model_validate(document).model_dump()
        if image:
            db.add(Model(id=model_id, name='image-model', category='image', provider_id=runtime.provider_id, params={}))
        run = await db.get(CanvasRun, accepted['run_id'])
        run.scope = ['m', *snapshots]
        for card_id, snapshot in snapshots.items():
            snapshot['document'] = deepcopy(document)
            node = CanvasRunNode(id=uuid4().hex, canvas_id=runtime.canvas_id, run_id=run.id,
                card_id=card_id, status='waiting', stage='waiting', basis={}, basis_hash='historical-pending',
                execution_snapshot=deepcopy(snapshot))
            db.add(node)
            await db.flush()
            db.add(CanvasScopeOccupancy(canvas_id=runtime.canvas_id, card_id=card_id, node_id=node.id))
    runtime.document = document
    return accepted, snapshots


async def finish_source(runtime, accepted, **outcome):
    async with runtime.sessions.begin() as db:
        service = TaskService(db)
        await service.claim(accepted['task_ids'][0], worker_id='historical-test')
        await service.finish(accepted['task_ids'][0], **outcome)


async def history(runtime, accepted):
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    run = next(item for item in state['runs'] if item['id'] == accepted['run_id'])
    return run, {item['card_id']: item for item in run['nodes']}


@pytest.mark.asyncio
async def test_historical_waiter_uses_frozen_document_config_and_this_runs_output(runtime, monkeypatch):
    accepted, snapshots = await historical_waiter(runtime)
    runtime.document['cards'][0]['prompt']['segments'][0]['text'] = 'Later document'
    runtime.document['cards'][1]['prompt']['segments'][0]['text'] = 'Changed downstream: '
    response = await runtime.client.put(runtime.url, json={'request_id': 'later', 'expected_revision': 1, 'document': runtime.document})
    assert response.status_code == 200, response.text
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.name, model.params = 'changed-model', {'temperature': .9}
        provider = await db.get(Provider, runtime.provider_id)
        provider.api_key, provider.base_url = 'changed-secret', 'https://changed.test'
    await finish_source(runtime, accepted, result={'text': 'New source'})
    _, nodes = await history(runtime, accepted)
    assert nodes['B']['status'] == 'queued' and nodes['B']['task_id']
    calls = []
    class TextModel:
        def __init__(self, **params):
            self.params = params
        async def astream(self, messages):
            calls.append((messages[0].content, self.params))
            yield SimpleNamespace(content='Completed historical request')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', TextModel)
    worker = TaskWorker(runtime.sessions)
    try:
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
    finally:
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    prompt, config = calls[0]
    assert prompt == 'Historical: New source'
    assert config['model'] == 'frozen-model' and config['temperature'] == .3
    assert config['api_key'] == 'private-secret' and config['base_url'] == 'https://frozen.test/v1'
    assert config['default_headers']['Authorization'] == 'Bearer model-private-secret'
    run, nodes = await history(runtime, accepted)
    assert run['lifecycle'] == 'finished' and nodes['B']['status'] == 'succeeded'
    assert 'private-secret' not in str(run)
    async with runtime.sessions() as db:
        stored = await db.get(CanvasRunNode, nodes['B']['id'])
        assert stored.execution_snapshot == snapshots['B']
        assert not list(await db.scalars(select(CanvasScopeOccupancy).where(CanvasScopeOccupancy.canvas_id == runtime.canvas_id)))
    from app.services.generation_canvas.stream import stream_events
    stream = stream_events(runtime.sessions, runtime.project_id, runtime.canvas_id, 0)
    try:
        cursor = (await runtime.client.get(runtime.url + '/runtime')).json()['data']['cursor']
        for _ in range(cursor):
            event = await anext(stream)
            assert 'private-secret' not in event
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_historical_image_waiter_uses_admitted_capability(runtime):
    from app.core.integrations.image_capabilities import (
        ImageModelCapability, register_image_model_capability, clear_image_model_capability_overrides,
    )
    accepted, snapshots = await historical_waiter(runtime, image=True)
    register_image_model_capability(provider='openai', model_prefix='image-model', capability=ImageModelCapability(max_n=1))
    try:
        await finish_source(runtime, accepted, result={'text': 'New source'})
        _, nodes = await history(runtime, accepted)
        assert nodes['B']['status'] == 'queued', nodes['B']
        async with runtime.sessions() as db:
            task = await db.get(Task, nodes['B']['task_id'])
            assert task.input_snapshot['operation_input']['count'] == 2
            assert task.input_snapshot['execution_config'] == snapshots['B']['execution_config']
        # The same current card really is rejected under today's capability.
        preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'B'})).json()['data']
        assert not preview['can_run']
        assert any(issue['code'] == 'INVALID_PARAMETER' and issue['target']['path'] == ['config', 'count']
                   for issue in preview['diagnostics'])
    finally:
        clear_image_model_capability_overrides(provider='openai')


@pytest.mark.asyncio
async def test_missing_new_position_never_falls_back_and_blocks_followers(runtime):
    accepted, _ = await historical_waiter(runtime, position=1, cascade=True)
    await finish_source(runtime, accepted, result={'text': 'Only position zero'})
    run, nodes = await history(runtime, accepted)
    assert nodes['B']['status'] == 'failed' and nodes['B']['error_code'] == 'INPUT_VALIDATION_FAILED'
    assert nodes['B']['error_message'] == "422: {'code': 'INPUT_VALIDATION_FAILED', 'message': '固定上游结果不满足下游输入要求'}"
    assert nodes['C']['status'] == 'blocked' and nodes['C']['error_code'] == 'UPSTREAM_FAILED'
    assert nodes['B']['task_id'] is None and nodes['C']['task_id'] is None
    assert run['lifecycle'] == 'finished'
    async with runtime.sessions() as db:
        assert not list(await db.scalars(select(CanvasScopeOccupancy).where(CanvasScopeOccupancy.canvas_id == runtime.canvas_id)))
        assert len(list(await db.scalars(select(Task).where(Task.project_id == runtime.project_id)))) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome,code', [
    ({'error_code': 'provider_failed', 'error': 'Failed upstream'}, 'UPSTREAM_FAILED'),
    ({'cancelled': True}, 'UPSTREAM_FAILED'),
    ({'error_code': 'execution_interrupted', 'error': 'Interrupted'}, 'FLOW_INTERRUPTED'),
])
async def test_historical_waiter_stops_after_upstream_failure_cancel_or_interruption(runtime, outcome, code):
    accepted, _ = await historical_waiter(runtime)
    await finish_source(runtime, accepted, **outcome)
    run, nodes = await history(runtime, accepted)
    assert nodes['B']['status'] == 'blocked' and nodes['B']['error_code'] == code
    assert nodes['B']['task_id'] is None and run['lifecycle'] == 'finished'
    async with runtime.sessions() as db:
        assert not list(await db.scalars(select(CanvasScopeOccupancy).where(CanvasScopeOccupancy.canvas_id == runtime.canvas_id)))
        assert len(list(await db.scalars(select(Task).where(Task.project_id == runtime.project_id)))) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('unavailable', [False, True])
async def test_precheck_keeps_model_metadata_and_diagnostic_order_on_incomplete_configuration(runtime, unavailable):
    runtime.document['cards'][0]['prompt']['segments'] = []
    if unavailable:
        async with runtime.sessions.begin() as db:
            provider = await db.get(Provider, runtime.provider_id)
            provider.status = 'disabled'
    else:
        runtime.document['cards'][0]['model_id'] = None
    response = await runtime.client.put(runtime.url, json={'request_id': 'incomplete', 'expected_revision': 1, 'document': runtime.document})
    assert response.status_code == 200, response.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})).json()['data']
    assert not preview['can_run'] and preview['preview_token'] is None
    assert preview['model'] == ({'id': runtime.model_id, 'name': 'frozen-model',
        'params': {'temperature': .3, 'default_headers': {}}} if unavailable else {})
    assert preview['diagnostics'] == [
        {'code': 'MODEL_UNAVAILABLE' if unavailable else 'MODEL_REQUIRED', 'severity': 'error',
         'message': '所选模型或供应商不可用' if unavailable else '请选择模型',
         'target': {'card_id': 'm', 'path': ['model_id']}, 'blocks': ['run']},
        {'code': 'TEXT_REQUIRED', 'severity': 'error', 'message': '请提供非空文本输入',
         'target': {'card_id': 'm', 'path': ['prompt']}, 'blocks': ['run']},
    ]


@pytest.mark.asyncio
async def test_gate_keeps_current_config_fallback_for_node_without_execution_config(runtime):
    from app.core.contracts.generation import GenerationCommand, GenerationTarget, GenerationSubmitRequest
    from app.core.contracts.text_generation import TextChatInput, TextChatMessage
    from app.services.generation.gate import GenerationEntityGate
    accepted, _ = await accept(runtime)
    _, nodes = await history(runtime, accepted)
    async with runtime.sessions.begin() as db:
        node = await db.get(CanvasRunNode, nodes['m']['id'])
        node.execution_snapshot = {key: value for key, value in node.execution_snapshot.items() if key != 'execution_config'}
        model = await db.get(Model, runtime.model_id)
        model.params = {'temperature': .7}
        provider = await db.get(Provider, runtime.provider_id)
        provider.api_key = 'current-secret'
        command = GenerationCommand(modality='text', operation='text_chat', delivery='async_polling',
            target=GenerationTarget(kind='canvas_node', entity_id=node.id),
            request=GenerationSubmitRequest(model_id=runtime.model_id,
                operation_input=TextChatInput(messages=[TextChatMessage(role='user', content='Gate fallback', sequence=1)])))
        snapshot = await GenerationEntityGate().validate(db, command)
        assert snapshot.execution_config.model_params == {'temperature': .7}
        assert snapshot.execution_config.api_key == 'current-secret'
