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
_PRIVATE_KEYS = re.compile(
    r'["\'](?:groups|delegations|tool_calls|proposal|proposal_issues|approval|approval_query|'
    r'submit_for_approval|preview_id|snapshot_ref|cards|target_card_ids|diagnostics|reused_cards|request_id|'
    r'canvas_read|input_check)["\']\s*:',
)
_PREVIEW_TOOLS = {'preview_canvas_changes', 'preview_canvas_structure', 'submit_canvas_approval'}


def public_proposal_prefix(reply):
    """Preserve prose the stream already exposed before the private envelope."""
    boundary = _STRUCTURED_BOUNDARY.search(reply)
    return reply[:boundary.start()].strip() if boundary else ''


def reply_envelope(reply):
    """Extract protocol JSON for validation or raise on mixed private data."""
    boundary = _STRUCTURED_BOUNDARY.search(reply)
    if not boundary:
        return reply
    prefix, body = reply[:boundary.start()].strip(), reply[boundary.start():].strip()
    fenced = re.match(r'^(?P<fence>```|~~~)(?P<language>json)?[ \t]*\n(?P<value>.+?)\n?[ \t]*(?P=fence)$',
                      body, re.IGNORECASE | re.DOTALL)
    payload = fenced['value'].strip() if fenced else body
    if payload.startswith('{') and (not prefix or _PRIVATE_KEYS.search(payload)):
        return payload
    line_prefix = reply[:boundary.start()].rsplit('\n', 1)[-1]
    if (fenced and fenced['language']) or (payload.startswith('{') and not line_prefix.strip()):
        return payload if payload.startswith('{') else '{}'
    if _PRIVATE_KEYS.search(payload) and payload.startswith(('`', '~', '[')):
        return payload if payload.startswith('{') else '{}'
    return reply


async def invoke_with_reply(agent, inputs, config, on_reply, *, on_phase=None, **options):
    """Coalesce real model chunks. Internal tool arguments and JSON envelopes remain private."""
    if on_reply is None:
        return await agent.ainvoke(inputs, config, **options)
    state, interrupts, message_id, content, published = {}, (), None, '', ''
    last_update = 0.0
    phase = None
    async for mode, value in agent.astream(inputs, config, stream_mode=['messages', 'values', 'updates'], version='v1', **options):
        if mode == 'values':
            state = value
            continue
        if mode == 'updates':
            interrupts = value.get('__interrupt__', interrupts)
            continue
        chunk, metadata = value
        if (not isinstance(chunk, AIMessageChunk) or metadata.get('langgraph_node') != 'model'
                or '|' in metadata.get('langgraph_checkpoint_ns', '')):
            continue
        if chunk.tool_call_chunks:
            if on_phase and phase != 'generating_proposal' and any(
                call.get('name') in _PREVIEW_TOOLS for call in chunk.tool_call_chunks
            ):
                phase = 'generating_proposal'
                await on_phase(phase)
            continue
        if chunk.id != message_id:
            message_id, content = chunk.id, ''
        content += chunk.text
        if on_phase:
            if phase != 'generating_proposal' and (
                content.lstrip().startswith('{') or _PRIVATE_KEYS.search(content)
            ):
                phase = 'generating_proposal'
                await on_phase(phase)
            elif phase is None and not content and (
                chunk.additional_kwargs.get('reasoning_content')
                or any(block.get('type') == 'reasoning' for block in chunk.content_blocks)
            ):
                phase = 'reasoning'
                await on_phase(phase)
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
