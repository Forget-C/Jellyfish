"""Verify that credentials issued by the browser work in a separate MCP client."""
import asyncio
import json
import sys

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main():
    config = json.loads(sys.stdin.readline())
    statuses = []

    async def observe_response(response):
        statuses.append(response.status_code)

    async with httpx.AsyncClient(headers={'Authorization': f"Bearer {config['credential']}"}) as http:
        try:
            async with streamable_http_client(
                config['url'], http_client=http,
            ) as (reader, writer, _), ClientSession(reader, writer) as client:
                await client.initialize()
                tools = await client.list_tools()
                assert {'canvas_list_free', 'canvas_read'} <= {tool.name for tool in tools.tools}
                result = await client.call_tool('canvas_list_free', {'q': '测试画布'})
                assert not result.isError, result
                items = result.structuredContent['items']
                assert [item['name'] for item in items] == ['测试画布']
                canvas = await client.call_tool('canvas_read', {'canvas_ref': items[0]['canvas_ref']})
                assert not canvas.isError, canvas
                assert canvas.structuredContent['document']['name'] == '测试画布'
                print('ready', flush=True)
                assert (await asyncio.to_thread(sys.stdin.readline)).strip() == 'closed'
                http.event_hooks['response'].append(observe_response)
                await client.call_tool('canvas_read', {'canvas_ref': items[0]['canvas_ref']})
        except ExceptionGroup:
            assert statuses == [401], statuses
        else:
            raise AssertionError('The original MCP client could still read after the connection was closed')


if __name__ == '__main__':
    asyncio.run(main())
