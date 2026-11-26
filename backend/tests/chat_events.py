"""Observe admitted chat turns through the public replay endpoint."""
import asyncio
import json
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

import httpx

CHAT_SESSIONS = '/api/v1/studio/chat/sessions'
CANVAS_TURN_OUTCOMES = ('turn.completed', 'turn.stopped', 'turn.interrupted', 'question.asked')


def canvas_chat_url(canvas_url):
    canvas_id = urlsplit(canvas_url).path.removesuffix('/assistant').rsplit('/', 1)[-1]
    return f'{CHAT_SESSIONS}/{canvas_id}'


async def read_chat_events(client, session_url, *, after=0):
    response = await client.get(session_url + '/events', params={'follow': False, 'after': after})
    assert response.is_success, response.text
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]


async def wait_for_chat_event(client, session_url, turn_id, *kinds, after=0):
    async with asyncio.timeout(8):
        while True:
            for event in await read_chat_events(client, session_url, after=after):
                after = event['cursor']
                if event['turn_id'] == turn_id and event['type'] in kinds:
                    return event
            await asyncio.sleep(.02)


@dataclass(frozen=True)
class CanvasTurnObservation:
    receipt: httpx.Response
    event: dict | None

    @property
    def detail(self):
        assert self.event is not None, self.receipt.text
        return self.event['detail']


async def observe_canvas_turn(client, canvas_url, *, json):
    """Submit to the shared endpoint and wait for its first outcome over SSE."""
    session_url = canvas_chat_url(canvas_url)
    response = await client.post(session_url + '/turns', json=json)
    if response.status_code != 202:
        return CanvasTurnObservation(response, None)
    receipt = response.json()['data']
    event = await wait_for_chat_event(client, session_url, receipt['turn_id'], *CANVAS_TURN_OUTCOMES,
                                      after=receipt['cursor'])
    return CanvasTurnObservation(response, event)


async def read_canvas_events(client, canvas_url, *, after=0):
    return await read_chat_events(client, canvas_chat_url(canvas_url), after=after)


async def read_canvas_chat_snapshot(client, canvas_url, *, params=None):
    url = urlsplit(canvas_url)
    canvas_id = canvas_chat_url(canvas_url).rsplit('/', 1)[-1]
    query = dict(parse_qsl(url.query)) if params is None else params
    return await client.get(f'{CHAT_SESSIONS}/canvas/{canvas_id}', params=query)


async def save_canvas_for_chat(client, draft_url, document):
    """Follow the editor's first-assistant save before posting the initial turn."""
    saved = await client.put(draft_url, json={
        'request_id': 'first-assistant-save', 'expected_revision': 0,
        'start_assistant': True, 'document': document,
    })
    assert saved.is_success, saved.text
    path = f"/canvases/{document['id']}"
    response = await client.get(path)
    assert response.is_success, response.text
    return path, response.json()['data']
