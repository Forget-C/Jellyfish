"""Professional skills through the public canvas assistant API."""
import json

import httpx
import pytest

from app.models.llm import Model, ModelSettings, Provider
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import
from tests.chat_events import observe_canvas_turn, read_canvas_chat_snapshot


@pytest.mark.asyncio
async def test_assistant_loads_requested_professional_skills_and_retains_their_versions(canvas_client, monkeypatch):
    calls = []
    real_send = httpx.AsyncClient.send
    cases = {
        '只从摄影角度看': ['shot-staging'],
        '先调整走位，再改写视频提示词': ['shot-staging', 'video-generation'],
        '按现有色调给一条关键帧生图提示词': ['image-generation'],
        '保留景别，只改运镜': ['video-generation'],
    }

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        messages = body['messages']
        question = next(message['content'] for message in reversed(messages) if message['role'] == 'user')
        tool_names = [tool['function']['name'] for tool in body['tools']]
        loaded = [message for message in messages if message['role'] == 'tool']
        answer = {'role': 'assistant', 'content': '保留已采用的景别，放慢推近，让观众先看到人物反应。'}
        reason = 'stop'
        if not loaded:
            assert 'load_canvas_skill' in tool_names
            assert not {'write_file', 'edit_file', 'execute', 'task'}.intersection(tool_names)
            system = next(message['content'] for message in messages if message['role'] == 'system')
            assert all(skill in system for skill in ('shot-staging', 'image-generation', 'video-generation'))
            assert '固定机位' not in system
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': f'skill-{index}', 'type': 'function', 'function': {
                    'name': 'load_canvas_skill', 'arguments': json.dumps({'skill_id': skill}),
                },
            } for index, skill in enumerate(cases[question])]}
            reason = 'tool_calls'
        elif question == '只从摄影角度看' and len(loaded) == 1:
            assert 'read_canvas_skill_example' in tool_names
            assert '固定机位' in json.loads(loaded[0]['content'])['instructions']
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'skill-example', 'type': 'function', 'function': {
                    'name': 'read_canvas_skill_example', 'arguments': '{"skill_id":"shot-staging"}',
                },
            }]}
            reason = 'tool_calls'
        else:
            if question == '只从摄影角度看':
                assert '钥匙' in loaded[-1]['content']
                loaded = loaded[:-1]
            calls.append([json.loads(item['content'])['id'] for item in loaded])
        return httpx.Response(200, request=request, json={
            'id': 'test-reply', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': reason, 'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        db.add(ModelSettings(id=1, default_text_model_id=model.id))
    canvas = (await canvas_client.post('/canvases', json={'name': '摄影讨论'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    for index, (question, selected) in enumerate(cases.items()):
        command = {'request_id': f'skill-{index}', 'text': question}
        response = await observe_canvas_turn(canvas_client, url, json=command)
        assert response.receipt.status_code == 202, response.receipt.text
        result = response.detail
        assert {entry['id'] for entry in result['skills']} == set(selected)
        assert all(entry['name'] and entry['version'] == ('1.2.0' if entry['id'] == 'video-generation' else '1.0.0') for entry in result['skills'])
        assert '景别' in result['reply']
        assert (await observe_canvas_turn(canvas_client, url, json=command)).detail == result
    turns = (await read_canvas_chat_snapshot(canvas_client, url)).json()['data']['history']['turns']
    assert [{entry['id'] for entry in turn['skills']} for turn in turns] == [set(items) for items in cases.values()]
    assert calls == list(cases.values())
    assert (await canvas_client.get(url)).json()['data']['document'] == canvas['document']
    assert (await canvas_client.get(url + '/runtime')).json()['data']['runs'] == []
