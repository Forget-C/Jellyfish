"""Forward only public prose from the root model while retaining the final graph state."""

import asyncio
import re
import time

from langchain_core.messages import AIMessageChunk

_active_streams = {}


def stop_reply_stream(canvas_id, request_id):
    """Cancel the local graph stream after the stop receipt commits."""
    if task := _active_streams.get((canvas_id, request_id)):
        task.cancel()


async def run_reply_stream(canvas_id, request_id, reply):
    """Track the live graph task so stopping also closes the model connection."""
    key = canvas_id, request_id
    task = asyncio.create_task(reply)
    _active_streams[key] = task
    try:
        return await task
    finally:
        if _active_streams.get(key) is task:
            del _active_streams[key]


# A structured response can begin after an introductory paragraph. Hold it back
# as soon as the line starts, before any keys or arguments arrive.
_STRUCTURED_BOUNDARY = re.compile(r'\{|(?m:^[ \t]*(?:[`]{1,3}|~{1,3}))')
_PRIVATE_KEYS = re.compile(r'["\'](?:groups|delegations|tool_calls)["\']\s*:')


def reply_envelope(reply):
    """Extract protocol JSON for validation or raise on mixed private data."""
    boundary = _STRUCTURED_BOUNDARY.search(reply)
    if not boundary:
        return reply
    prefix, body = reply[:boundary.start()].strip(), reply[boundary.start():].strip()
    fenced = re.match(r'^```(?:json)?[ \t]*\n(.+?)\n?[ \t]*```$', body, re.IGNORECASE | re.DOTALL)
    payload = fenced[1].strip() if fenced else body
    if payload.startswith('{') and (not prefix or _PRIVATE_KEYS.search(payload)):
        return payload
    if _PRIVATE_KEYS.search(payload) and payload.startswith(('`', '~', '[')):
        return payload if payload.startswith('{') else '{}'
    return reply


async def invoke_with_reply(agent, inputs, config, on_reply, **options):
    """Coalesce real model chunks. Internal tool arguments and JSON envelopes remain private."""
    if on_reply is None:
        return await agent.ainvoke(inputs, config, **options)
    state, interrupts, message_id, content, published = {}, (), None, '', ''
    last_update = 0.0
    async for mode, value in agent.astream(inputs, config, stream_mode=['messages', 'values', 'updates'], version='v1', **options):
        if mode == 'values':
            state = value
            continue
        if mode == 'updates':
            interrupts = value.get('__interrupt__', interrupts)
            continue
        chunk, metadata = value
        if (not isinstance(chunk, AIMessageChunk) or metadata.get('langgraph_node') != 'model'
                or '|' in metadata.get('langgraph_checkpoint_ns', '') or chunk.tool_call_chunks):
            continue
        if chunk.id != message_id:
            message_id, content = chunk.id, ''
        content += chunk.text
        boundary = _STRUCTURED_BOUNDARY.search(content)
        public = content[:boundary.start()] if boundary else content
        start = public.lstrip()
        if not start or start.startswith(('{', '`', '~')):
            continue
        now = time.monotonic()
        if public != published and (not published or now - last_update >= .12):
            await on_reply(public)
            published, last_update = public, now
    return {**state, '__interrupt__': interrupts} if interrupts else state
