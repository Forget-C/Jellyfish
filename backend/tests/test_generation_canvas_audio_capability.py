"""模型声音能力与实际输入约束通过生成画布公开接口验收。"""
import pytest
from app.models.llm import Model, Provider
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_audio_declarations_do_not_open_unconnected_reference_input(canvas_client, canvas_file_store):
    async with canvas_file_store['sessions']() as db:
        db.add_all([
            Provider(id='ark', name='volcengine', base_url='https://ark.example.test', api_key='test-key'),
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
    for model_id, declaration, connected, audio_switch, reference in [
        ('canvas-image', 'unsupported', False, 'unsupported', 'unsupported'),
        ('canvas-video', 'unknown', False, 'unknown', 'unknown'),
        ('q3', 'supported', False, 'unknown', 'unknown'),
        ('seedance', 'supported', True, 'supported', 'supported'),
    ]:
        response = await canvas_client.get(f'{base}/{model_id}/capability')
        assert response.status_code == 200, response.text
        capability = response.json()['data']
        assert capability['native_audio_output'] == {
            'declaration': declaration, 'connected': connected,
        }
        assert capability['audio_switch'] == {'declaration': audio_switch, 'connected': False}
        assert capability['audio_reference_input'] == {'declaration': reference, 'connected': False}
        assert 'audio_reference' not in capability['input_ports']

    upload = await canvas_client.post(
        '/files/upload', files={'file': ('voice.mp3', b'local-audio', 'audio/mpeg')},
        data={'project_id': 'p', 'usage_kind': 'generation_upload'},
    )
    assert upload.status_code == 201, upload.text
    audio_file = upload.json()['data']['id']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    model = {'id': 'video', 'type': 'model.video', 'model_id': 'seedance',
             'config': {'ratio': '16:9', 'seconds': 5},
             'prompt': {'segments': [{'id': 'scene', 'kind': 'text', 'text': '远景'}]}}
    doc['cards'] = [{'id': 'audio', 'type': 'content.audio', 'file_id': audio_file}, model]
    saved = await canvas_client.put(url, json={'request_id': 'valid', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text

    source = {'canvas_id': canvas['id'], 'card_id': 'audio', 'port_id': 'audio', 'position': 0}
    model['input_bindings'] = [{'id': 'audio-ref', 'input_port': 'audio_reference', 'source': source}]
    doc.update(edges=[{'id': 'audio-edge', 'source_card': 'audio', 'source_port': 'audio',
                       'target_card': 'video', 'target_port': 'audio_reference'}],
               input_order={'video': {'audio_reference': ['audio-edge']}})
    invalid = await canvas_client.put(url, json={'request_id': 'bind', 'expected_revision': 1, 'document': doc})
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()['detail']['blocks'] == ['save']
    reopened = (await canvas_client.get(url)).json()['data']
    assert reopened['revision'] == 1 and not reopened['document']['edges']
    assert (await canvas_client.get(f'/files/{audio_file}/download')).headers['content-type'] == 'audio/mpeg'
    preview = await canvas_client.post(url + '/precheck', json={'card_id': 'video'})
    assert preview.status_code == 200, preview.text
    result = preview.json()['data']
    assert result['can_run'] and not result['input']['media'], result


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
        cards=[{'id': 'sound', 'type': 'direction.sound', 'environment': {'state': 'fact', 'text': '细雨'},
                'scope': {'phase': '后期制作'}}, model],
        edges=[{'id': 'sound-edge', 'source_card': 'sound', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'model': {'text': ['sound-edge']}},
    )
    saved = await canvas_client.put(url, json={'request_id': 'adopted', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    compiled = (await canvas_client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['can_run'] and '细雨' in compiled['text']
    assert '制作阶段：后期制作' in compiled['text']
    preview = await canvas_client.post(url + '/precheck', json={'card_id': 'model'})
    assert preview.status_code == 200, preview.text
    assert preview.json()['data']['model']['params'] == {'ratio': '16:9', 'seconds': 5, 'seed': None}

    model['config']['generate_audio'] = False
    illegal = await canvas_client.put(url, json={'request_id': 'illegal-audio', 'expected_revision': 1, 'document': document})
    assert illegal.status_code == 422, illegal.text
    assert (await canvas_client.get(url)).json()['data']['revision'] == 1
    del model['config']['generate_audio']

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
