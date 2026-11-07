"""P08 matches adopted audio requirements without widening generation input."""
import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_checks import connect_check, save_canvas
from tests.test_generation_canvas_check_selection import run_request
from tests.test_generation_canvas_runs import runtime  # noqa: F401


def sound_canvas(document, cards, *, model='seedance', check_model=None):
    """Adopt only the provided designs into the video target."""
    edges = [{'id': f"use-{card['id']}", 'source_card': card['id'], 'source_port': 'text',
              'target_card': 'model', 'target_port': 'text'} for card in cards]
    document.update(cards=[
        *cards, {'id': 'unused', 'type': 'direction.guidance', 'sound_strategy': {'text': '不应读取的声音设计', 'state': 'fact'}},
        {'id': 'model', 'type': 'model.video', 'model_id': model,
         'config': {'ratio': '16:9', 'seconds': 5}},
        {'id': 'check', 'type': 'review.check', 'enabled_categories': ['P08'], 'check_model_id': check_model},
    ], edges=edges, input_order={'model': {'text': [edge['id'] for edge in edges]}})
    connect_check(document)
    return document


def guidance(card_id, text):
    return {'id': card_id, 'type': 'direction.guidance', 'sound_strategy': {'text': text, 'state': 'fact'}}


@pytest.mark.asyncio
async def test_sound_matches_actual_model_and_keeps_technical_constraints(canvas_client, canvas_file_store):
    client = canvas_client
    async with canvas_file_store['sessions'].begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'fixture-key'
        db.add_all([
            Provider(id='p08-ark', name='volcengine', base_url='https://ark.fixture.test', api_key='fixture-key'),
            Provider(id='p08-vidu', name='vidu', base_url='https://vidu.fixture.test', api_key='fixture-key'),
        ])
        await db.flush()
        db.add_all([
            Model(id='seedance', name='doubao-seedance-2-0-260128', category='video', provider_id='p08-ark'),
            Model(id='q3', name='viduq3-pro', category='video', provider_id='p08-vidu'),
        ])
    canvas = (await client.post('/canvases/p', json={'name': '核对声音能力'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    checks = f'{url}/checks/check'
    document = sound_canvas(canvas['document'], [
        guidance('native', '随视频同步生成声音'),
        guidance('switch', '关闭声音输出'),
        guidance('reference', '使用音频参考'),
        {'id': 'line', 'type': 'direction.dialogue', 'dialogue_id': 'line-1',
         'content': {'text': '关闭声音输出', 'state': 'fact'}},
        {'id': 'post', 'type': 'direction.sound', 'scope': {'phase': '后期制作'},
         'environment': {'text': '雨声', 'state': 'fact'}},
    ])
    await save_canvas(client, url, document, 0)

    async def run():
        preview = (await client.get(checks)).json()['data']
        response = await client.post(f'{checks}/runs', json=run_request(preview))
        assert response.status_code == 200, response.text
        data = response.json()['data']
        assert not data['executions']
        return data, {item['source']['card_id']: next(row for row in data['results'] if row['item_id'] == item['id'])
                      for item in data['items']}

    first, results = await run()
    assert set(results) == {'native', 'switch', 'reference', 'post', 'line'}
    assert results['native']['outcome'] == 'conforming' and '已接入' in results['native']['message']
    assert results['switch']['outcome'] == results['reference']['outcome'] == 'risk'
    assert '声明支持，当前适配器未接入' in results['switch']['message']
    assert '音频参考输入' in results['reference']['message']
    assert results['line']['outcome'] == 'indeterminate' and '对白正文' in results['line']['message']
    assert results['post']['outcome'] == 'indeterminate' and '后期' in results['post']['message']
    assert all('音轨' in result['boundary'] and '未核验' in result['boundary'] for result in results.values())
    assert results['native']['text_evidence'][0]['source']['card_id'] == 'native'

    document = (await client.get(url)).json()['data']['document']
    target = next(card for card in document['cards'] if card['id'] == 'model')
    target['model_id'] = 'q3'
    await save_canvas(client, url, document, 1)
    newer, results = await run()
    assert results['native']['outcome'] == 'risk'
    assert results['switch']['outcome'] == 'indeterminate' and '未知' in results['switch']['message']
    assert newer['basis']['model_id'] == 'q3'
    assert (await client.get(f'{checks}/reports')).json()['data'][-1] == first
    old_switch = next(item for item in first['items'] if item['source']['card_id'] == 'switch')
    reviewed = await client.post(f"{checks}/reports/{first['id']}/recheck", json={
        'item_id': old_switch['id'], 'clarification': '当前模型可能已经支持，按已接入算。',
    })
    assert reviewed.status_code == 200, reviewed.text
    recheck = reviewed.json()['data']
    assert recheck['basis']['model_id'] == 'seedance'
    assert '当前适配器未接入' in recheck['results'][0]['message']
    assert recheck['results'][0]['outcome'] == 'risk' and recheck['executions'] == []

    document = (await client.get(url)).json()['data']['document']
    document['cards'].append({'id': 'image', 'type': 'model.image', 'model_id': 'canvas-image'})
    original = next(edge for edge in document['edges'] if edge['id'] == 'use-native')
    original['target_card'] = 'image'
    document['input_order']['model']['text'].remove(original['id'])
    document['input_order']['image'] = {'text': [original['id']]}
    next(edge for edge in document['edges'] if edge['id'] == 'observe')['source_card'] = 'image'
    await save_canvas(client, url, document, 2)
    _, results = await run()
    assert set(results) == {'native'}
    assert results['native']['outcome'] == 'risk' and '明确不支持' in results['native']['message']

    document = (await client.get(url)).json()['data']['document']
    next(card for card in document['cards'] if card['id'] == 'check')['enabled_categories'] = []
    await save_canvas(client, url, document, 3)
    invalid = deepcopy(document)
    next(card for card in invalid['cards'] if card['id'] == 'model')['config']['generate_audio'] = False
    await save_canvas(client, url, invalid, 4, expected_status=422)
    upload = await client.post('/files/upload', files={'file': ('voice.mp3', b'audio', 'audio/mpeg')},
                               data={'project_id': 'p', 'usage_kind': 'generation_upload'})
    assert upload.status_code == 201, upload.text
    invalid = deepcopy(document)
    invalid['cards'].append({'id': 'audio', 'type': 'content.audio', 'file_id': upload.json()['data']['id']})
    invalid['edges'].append({'id': 'audio-use', 'source_card': 'audio', 'source_port': 'audio',
                             'target_card': 'model', 'target_port': 'audio_reference'})
    invalid['input_order']['model']['audio_reference'] = ['audio-use']
    await save_canvas(client, url, invalid, 4, expected_status=422)


@pytest.mark.asyncio
async def test_sound_text_classifier_needs_real_source_evidence_and_uses_frozen_capability(runtime, monkeypatch):
    async with runtime.sessions.begin() as db:
        db.add(Provider(id='p08-ark', name='volcengine', base_url='https://ark.fixture.test', api_key='fixture-key'))
        await db.flush()
        db.add_all([
            Model(id='seedance', name='doubao-seedance-2-0-260128', category='video', provider_id='p08-ark'),
            Model(id='unknown-video', name='unknown-video', category='video', provider_id=runtime.provider_id),
        ])
    requirement = '请在本次生成时把输出声轨关掉，声音后面再铺。'
    document = sound_canvas(runtime.document, [guidance('strategy', requirement)], check_model=runtime.model_id)
    await save_canvas(runtime.client, runtime.url, document, 1)
    checks = f'{runtime.url}/checks/check'
    calls = []

    class Classifier:
        def __init__(self, **_params):
            pass

        async def ainvoke(self, messages):
            body = json.loads(messages[1].content)
            calls.append(body)
            assert body['requirement']['text'] == requirement
            return SimpleNamespace(content=json.dumps({
                'needs': ['audio_switch'], 'excerpt': requirement if len(calls) == 1 or body.get('recheck') else '凭空引用',
            }))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', Classifier)
    worker = TaskWorker(runtime.sessions)
    try:
        for expected in ('risk', 'indeterminate'):
            preview = (await runtime.client.get(checks)).json()['data']
            response = await runtime.client.post(f'{checks}/runs', json=run_request(preview))
            assert response.status_code == 200, response.text
            data = response.json()['data']
            assert data['results'] == [] and data['executions'][0]['status'] == 'queued'
            if not calls:
                current = (await runtime.client.get(runtime.url)).json()['data']
                target = next(card for card in current['document']['cards'] if card['id'] == 'model')
                target['model_id'] = 'unknown-video'
                await save_canvas(runtime.client, runtime.url, current['document'], current['revision'])
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            report = (await runtime.client.get(f'{checks}/reports')).json()['data'][0]
            assert report['executions'][0]['status'] == 'succeeded'
            assert report['results'][0]['outcome'] == expected
            if expected == 'risk':
                assert '当前适配器未接入' in report['results'][0]['message']
                assert report['results'][0]['text_evidence'][0]['excerpt'] == requirement
        assert len(calls) == 2
        assert calls[0]['target_model_id'] == 'seedance'
        assert calls[0]['capabilities']['audio_switch'] == {'declaration': 'supported', 'connected': False}
        assert calls[1]['target_model_id'] == 'unknown-video'
        assert calls[1]['capabilities']['audio_switch'] == {'declaration': 'unknown', 'connected': False}
        original = (await runtime.client.get(f'{checks}/reports')).json()['data'][-1]
        response = await runtime.client.post(f"{checks}/reports/{original['id']}/recheck", json={
            'item_id': original['items'][0]['id'], 'clarification': '根据原文字核对输出声轨开关',
        })
        assert response.status_code == 200, response.text
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        latest = (await runtime.client.get(f'{checks}/reports')).json()['data'][0]
        assert latest['results'][0]['outcome'] == 'risk'
        assert latest['basis']['model_id'] == 'seedance' and len(calls) == 3
        assert calls[-1]['recheck']['original_result'] == original['results'][0]
    finally:
        worker.text_pool.shutdown(wait=False)
