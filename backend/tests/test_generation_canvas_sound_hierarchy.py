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
