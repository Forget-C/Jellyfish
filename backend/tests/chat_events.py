"""Observe admitted chat turns through the public replay endpoint."""
import asyncio
import json


async def wait_for_chat_event(client, session_url, turn_id, *kinds):
    async with asyncio.timeout(8):
        cursor = 0
        while True:
            response = await client.get(session_url + '/events', params={'follow': False, 'after': cursor})
            assert response.is_success, response.text
            for line in response.text.splitlines():
                if line.startswith('data: '):
                    event = json.loads(line[6:])
                    cursor = event['cursor']
                    if event['turn_id'] == turn_id and event['type'] in kinds:
                        return event
            await asyncio.sleep(.02)
