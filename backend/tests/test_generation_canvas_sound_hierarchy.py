"""声音层次随卡片保存并进入实际采用该安排的生成输入。"""
import pytest

from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_sound_hierarchy_roundtrips_compiles_and_can_be_cleared(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '声音层次'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    sound = {
        'id': 'sound',
        'type': 'direction.sound',
        'environment': {'text': '窗外有雨声', 'state': 'fact'},
        'scope': {'condition': '两人在窗边交谈时'},
    }
    document.update(cards=[sound, {
        'id': 'target',
        'type': 'model.text',
        'input_bindings': [{
            'id': 'sound',
            'source': {'canvas_id': canvas['id'], 'card_id': 'sound', 'port_id': 'text', 'position': 0},
            'input_port': 'text',
        }],
    }], edges=[{
        'id': 'sound', 'source_card': 'sound', 'source_port': 'text',
        'target_card': 'target', 'target_port': 'text',
    }], input_order={'target': {'text': ['sound']}})

    async def save(revision):
        response = await client.put(url, json={
            'request_id': f'save-{revision}', 'expected_revision': revision, 'document': document,
        })
        assert response.status_code == 200, response.text

    async def compile_text():
        response = await client.get(f'{url}/cards/target/compile')
        assert response.status_code == 200, response.text
        return response.json()['data']['text']

    await save(0)
    assert '声音层次／主次关系' not in await compile_text()

    hierarchy = {'state': 'proposal', 'text': '对白优先，雨声退后'}
    sound['hierarchy'] = hierarchy
    await save(1)
    reopened = (await client.get(url)).json()['data']['document']
    saved = reopened['cards'][0]['hierarchy']
    assert saved['text'] == hierarchy['text'] and saved['state'] == hierarchy['state']
    text = await compile_text()
    assert '声音层次／主次关系' in text and hierarchy['text'] in text
    assert '适用条件：两人在窗边交谈时' in text
    assert '窗外有雨声' in text

    document = reopened
    document['cards'][0]['hierarchy'] = {'state': 'empty', 'text': ''}
    await save(2)
    assert '声音层次／主次关系' not in await compile_text()


@pytest.mark.asyncio
async def test_shared_sound_hierarchy_keeps_its_condition_in_each_adopting_target(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '跨目标声音层次'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    condition = '只在两人于窗边交谈时'
    hierarchy = '对白优先，雨声退后'
    prompts = {
        'window': '两人在窗边交谈。',
        'outside': '两人已离开窗边，在室外静默行走。',
        'other': '镜头对准街边的积水。',
    }
    document = canvas['document']
    document.update(cards=[{
        'id': 'sound', 'type': 'direction.sound',
        'scope': {'condition': condition},
        'hierarchy': {'text': hierarchy, 'authorship': 'user'},
    }, *[
        {'id': target, 'type': 'model.video',
         'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': prompt}]}}
        for target, prompt in prompts.items()
    ]], edges=[
        {'id': f'sound-{target}', 'source_card': 'sound', 'source_port': 'text',
         'target_card': target, 'target_port': 'text'}
        for target in ('window', 'outside')
    ], input_order={target: {'text': [f'sound-{target}']} for target in ('window', 'outside')})

    saved = await canvas_client.put(url, json={
        'request_id': 'scope', 'expected_revision': 0, 'document': document,
    })
    assert saved.status_code == 200, saved.text
    reopened = await canvas_client.get(url)
    assert reopened.status_code == 200, reopened.text
    stored = reopened.json()['data']['document']
    assert stored['cards'][0]['scope']['condition'] == condition
    assert {edge['target_card'] for edge in stored['edges'] if edge['source_card'] == 'sound'} == {'window', 'outside'}

    for target, prompt in prompts.items():
        response = await canvas_client.get(f'{url}/cards/{target}/compile')
        assert response.status_code == 200, response.text
        compiled = response.json()['data']
        assert prompt in compiled['text']
        adopted = [item for item in compiled['used'] if item['source']['card_id'] == 'sound']
        if target == 'other':
            assert not adopted
            assert hierarchy not in compiled['text']
            continue
        assert len(adopted) == 1
        assert adopted[0]['payload']['scope']['condition'] == condition
        # Both requests retain the authored condition even if their prompt describes different circumstances.
        assert f'声音层次／主次关系：{hierarchy}\n适用条件：{condition}' in compiled['text']
