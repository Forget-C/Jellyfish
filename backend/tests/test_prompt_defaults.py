"""Template management and asset generation against the public API."""
import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from fastapi import Request

from app.dependencies import get_db
from app.main import app
from app.models.task import Task
from app.scripts.seed_system_data import _execute_seed
from app.task_worker import TaskWorker
from tests.test_database_baseline_business import LLM, STUDIO, baseline_client, data, finish_task, image_storage, provider_response


@pytest.mark.asyncio
async def test_template_switch_cancel_and_repeat(baseline_client):
    client, _ = baseline_client
    path = STUDIO + '/prompts'
    category = 'frame_head_prompt'

    async def create(name):
        return await data(client.post(path, json={'name': name, 'category': category,
                                                  'content': name, 'is_default': True}), 201)

    first = await create(uuid4().hex)
    second = await create(uuid4().hex)

    async def defaults():
        result = await data(client.get(path, params={'category': category, 'is_default': True}))
        return [item['id'] for item in result['items']]

    assert await defaults() == [second['id']]
    target = path + '/' + second['id']
    denied = await client.patch(target, json={'is_default': False})
    assert denied.status_code == 409
    assert '请先将同类别的其他模板设为默认' in denied.text
    repeated = await data(client.patch(target, json={'is_default': True}))
    assert repeated['version'] == second['version']
    for winner in (first, second):
        await data(client.patch(path + '/' + winner['id'], json={'is_default': True}))
        assert await defaults() == [winner['id']]
    both = await asyncio.gather(*(client.patch(path + '/' + row['id'], json={'is_default': True})
                                  for row in (first, second)))
    assert [response.status_code for response in both] == [200, 200]
    assert await defaults() in ([first['id']], [second['id']])


@pytest.mark.asyncio
async def test_seeded_template_reaches_image_provider(baseline_client, image_storage):
    """Render, submit and execute real asset tasks. Only storage and the provider are local doubles."""
    client, sessions = baseline_client
    engine = sessions.kw['bind']
    async def seed():
        async with engine.begin() as connection:
            await _execute_seed(connection, dry_run=False)

    await seed()
    project = uuid4().hex
    await data(client.post(STUDIO + '/projects', json={'id': project, 'name': '模板验收', 'style': '真人都市'}), 201)
    model = uuid4().hex
    await data(client.post(LLM + '/providers', json={'id': model, 'name': 'openai',
        'base_url': 'https://image.test/v1', 'api_key': 'stub', 'status': 'active'}), 201)
    await data(client.post(LLM + '/models', json={'id': model, 'name': 'image-' + model,
        'category': 'image', 'provider_id': model}), 201)
    received = []

    def record(request):
        received.append(json.loads(request.content)['prompt'])
        return provider_response(request)

    async def slot(kind, angle, **fields):
        asset = uuid4().hex
        await data(client.post(f'{STUDIO}/entities/{kind}', json={
            'id': asset, 'name': '主体' + asset, 'project_id': project, **fields,
        }), 201)
        image = await data(client.post(f'{STUDIO}/entities/{kind}/{asset}/images', json={'view_angle': angle}), 201)
        return kind, asset, image['id']

    async def new_view(target):
        kind, asset, _ = target
        row = await data(client.post(f'{STUDIO}/entities/{kind}/{asset}/images', json={'view_angle': 'FRONT'}), 201)
        return kind, asset, row['id']

    async def render(target):
        kind, asset, image = target
        return await data(client.post(f'{STUDIO}/generation-prompts/assets/{kind}/{asset}/slots/{image}/render', json={}))

    async def submit(target, snapshot):
        kind, asset, image = target
        prefix = f'{kind}s' if kind in ('actor', 'character') else f'assets/{kind}'
        audit = {k: snapshot[k] for k in ('render_id', 'execution_prompt', 'template_id', 'template_version')}
        audit.update(variables=snapshot['variables_snapshot'], reference_file_ids=[])
        result = await data(client.post(f'{STUDIO}/generation-tasks/{prefix}/{asset}/slots/{image}/tasks', json={
            'model_id': model, 'render_id': snapshot['render_id'], 'execution_prompt': snapshot['execution_prompt'],
            'operation_input': {'kind': 'image_generation'}, 'media': {'references': []}, 'asset_prompt_audit': audit,
        }), 201)
        async with sessions() as session:
            task = await session.get(Task, result['task_id'])
            assert task.input_snapshot['asset_prompt_audit'] == audit
        return result['task_id']

    jobs = []
    for kind, angle, fields, marker in (
        ('actor', 'FRONT', {'hair': '黑发'}, 'Identity portrait'),
        ('character', 'FRONT', {'description': '短发角色'}, 'Character identity'),
        ('prop', 'FRONT', {'shape': '圆形'}, 'Product design'),
        ('costume', 'FRONT', {'structure': '长裙'}, 'Costume design'),
        ('scene', 'FRONT', {'spatial_layout': '左侧靠窗'}, '左侧靠窗'),
        ('scene', 'BACK', {'spatial_layout': '右侧靠窗'}, '右侧靠窗'),
    ):
        target = await slot(kind, angle, **fields)
        snapshot = await render(target)
        assert marker in snapshot['execution_prompt']
        assert snapshot['template_id'] == (None if kind == 'scene' else f'system_{kind}_image')
        assert snapshot['template_version'] == (None if kind == 'scene' else 1)
        jobs.append((await submit(target, snapshot), snapshot['execution_prompt']))
        if kind == 'actor':
            actor, original = target, snapshot

    path = STUDIO + '/prompts'
    system_path = path + '/system_actor_image'
    system = await data(client.get(system_path))
    try:
        choices = []
        for marker in ('模板甲', '模板乙'):
            custom = await data(client.post(path, json={'name': marker, 'content': marker + system['content'],
                'category': 'actor_image', 'is_default': True}), 201)
            choices.append(custom)
            actor = await new_view(actor)
            shot = await render(actor)
            assert shot['template_id'] == custom['id'] and marker in shot['execution_prompt']
            assert shot['render_id'] != original['render_id']
            jobs.append((await submit(actor, shot), shot['execution_prompt']))
        await seed()
        await seed()
        denied = await client.patch(path + '/' + choices[-1]['id'], json={'is_default': False})
        assert denied.status_code == 409
        actor = await new_view(actor)
        after = await render(actor)
        assert after['template_id'] == choices[-1]['id']
        assert after['execution_prompt'] == shot['execution_prompt']
        jobs.append((await submit(actor, after), after['execution_prompt']))
        pinned = await slot('actor', 'FRONT', hair='白发', prompt_template_id=choices[0]['id'])
        fixed = await render(pinned)
        assert fixed['template_id'] == choices[0]['id'] and '模板甲' in fixed['execution_prompt']
        jobs.append((await submit(pinned, fixed), fixed['execution_prompt']))
        for first, last in (choices, reversed(choices)):
            await overlapping_switches(client, sessions, path, first, last)
            defaults = await data(client.get(path, params={'category': 'actor_image', 'is_default': True}))
            winner, = defaults['items']
            assert winner['id'] == last['id']
            actor = await new_view(actor)
            next_shot = await render(actor)
            assert next_shot['template_id'] == last['id'] and last['name'] in next_shot['execution_prompt']
            jobs.append((await submit(actor, next_shot), next_shot['execution_prompt']))
    finally:
        await data(client.patch(system_path, json={'is_default': True}))

    async with httpx.AsyncClient(transport=httpx.MockTransport(record)) as external:
        worker = TaskWorker(sessions, client=external)
        try:
            for task_id, _ in jobs:
                await finish_task(client, worker, task_id)
        finally:
            worker.text_pool.shutdown(wait=True)
    assert sorted(received) == sorted(prompt for _, prompt in jobs)

async def overlapping_switches(client, sessions, path, first, last):
    """Hold the first API transaction open until a second request has its own connection."""
    holding, competing = asyncio.Event(), asyncio.Event()

    async def separate_transactions(request: Request):
        async with sessions.begin() as session:
            await session.connection()
            if request.headers['switch-order'] == 'last':
                competing.set()
            yield session
            if request.headers['switch-order'] == 'first':
                holding.set()
                await asyncio.wait_for(competing.wait(), timeout=5)

    async def switch(row, order):
        if order == 'last':
            await asyncio.wait_for(holding.wait(), timeout=5)
        return await client.patch(path + '/' + row['id'], json={'is_default': True}, headers={'switch-order': order})

    app.dependency_overrides[get_db] = separate_transactions
    try:
        responses = await asyncio.gather(switch(first, 'first'), switch(last, 'last'))
        assert [r.status_code for r in responses] == [200, 200]
    finally:
        del app.dependency_overrides[get_db]
