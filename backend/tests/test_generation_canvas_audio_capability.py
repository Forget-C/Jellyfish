"""原生声音能力及提示通过生成画布公开接口验收。"""
import pytest
from app.models.llm import Model, Provider
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_native_audio_declaration_and_connected_path_are_distinct(canvas_client, canvas_file_store):
    async with canvas_file_store['sessions']() as db:
        db.add_all([
            Provider(id='ark', name='volcengine', base_url='https://ark.example.test'),
            Provider(id='vidu', name='vidu', base_url='https://vidu.example.test'),
        ])
        await db.flush()
        db.add_all([
            Model(id='seedance', name='doubao-seedance-2-0-260128', category='video', provider_id='ark'),
            Model(id='q3', name='viduq3-pro', category='video', provider_id='vidu'),
        ])
        await db.commit()
    canvas = (await canvas_client.post('/canvases/p', json={'name': '原生声音能力'})).json()['data']
    base = f"/canvases/p/{canvas['id']}/models"
    for model_id, declaration, connected in [
        ('canvas-image', 'unsupported', False),
        ('canvas-video', 'unknown', False),
        ('q3', 'supported', False),
        ('seedance', 'supported', True),
    ]:
        response = await canvas_client.get(f'{base}/{model_id}/capability')
        assert response.status_code == 200, response.text
        assert response.json()['data']['native_audio_output'] == {
            'declaration': declaration, 'connected': connected,
        }


@pytest.mark.asyncio
async def test_adopted_sound_with_unknown_capability_is_a_nonblocking_warning(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '声音提示'})).json()['data']
    url, document = f"/canvases/p/{canvas['id']}", canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'sound', 'port_id': 'text', 'position': 0}
    model = {
        'id': 'model', 'type': 'model.video', 'model_id': 'canvas-video',
        'config': {'ratio': '16:9', 'seconds': 5},
        'prompt': {'segments': [{'id': 'scene', 'kind': 'text', 'text': '雨夜站台'}]},
        'input_bindings': [{'id': 'sound-binding', 'input_port': 'text', 'source': source}],
    }
    document.update(
        cards=[{'id': 'sound', 'type': 'direction.sound', 'environment': {'state': 'fact', 'text': '细雨'}}, model],
        edges=[{'id': 'sound-edge', 'source_card': 'sound', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'model': {'text': ['sound-edge']}},
    )
    saved = await canvas_client.put(url, json={'request_id': 'adopted', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    compiled = (await canvas_client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['can_run'] and '细雨' in compiled['text']
    warning = next(item for item in compiled['diagnostics'] if item['code'] == 'NATIVE_AUDIO_OUTPUT_UNAVAILABLE')
    assert warning['severity'] == 'warning' and warning['blocks'] == []
    assert '未知' in warning['message']

    model['input_bindings'] = []
    document.update(edges=[], input_order={})
    saved = await canvas_client.put(url, json={'request_id': 'unrelated', 'expected_revision': 1, 'document': document})
    assert saved.status_code == 200, saved.text
    compiled = (await canvas_client.get(url + '/cards/model/compile')).json()['data']
    assert '细雨' not in compiled['text']
    assert all(item['code'] != 'NATIVE_AUDIO_OUTPUT_UNAVAILABLE' for item in compiled['diagnostics'])
