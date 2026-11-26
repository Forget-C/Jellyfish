"""Project stored scene records onto the product's shared SSE contract."""
from app.schemas.canvas_assistant import CanvasAssistantExchange
from app.schemas.chat import ChatEvent


def public_event(event):
    record = event.model_dump(mode='json')
    source = record['payload']
    canvas = isinstance(event.payload, CanvasAssistantExchange)
    progress = (source.get('progress') or {}) if canvas else {}
    detail = source if canvas else None
    kind = event.type
    if kind == 'message.updated':
        category = 'message'
        delta = 'text_delta' in source
        payload = {'mode': 'append' if delta else 'replace',
                   'text': source['text_delta'] if delta else (progress.get('reply') if canvas else source['text']) or ''}
    elif kind in ('tool.started', 'tool.completed', 'tool.failed'):
        category = 'tool'
        call = progress.get('tool_call') or {}
        payload = {'tool_call_id': call.get('id') or source['tool_call_id'], 'tool': call.get('name') or source['tool'],
                   'state': kind.split('.')[1], 'model_id': source.get('model_id'),
                   'parameters': call.get('parameters') or source.get('parameters') or {},
                   'error': source.get('error') if isinstance(source.get('error'), str) else None}
        if source.get('message'):
            payload['message'] = source['message']
    elif kind in ('turn.accepted', 'turn.completed', 'turn.failed', 'turn.stopped'):
        category = 'turn'
        error = source.get('error')
        message = source.get('user_message') or source.get('assistant_message')
        text = source.get('reply') if canvas else source.get('text')
        if message and kind == 'turn.completed':
            text = text or message.get('content')
        payload = {'text': text or '',
                   'error': source.get('error_code') or (error.get('message') if isinstance(error, dict) else error),
                   'reason': source.get('reason')}
        if message:
            payload['message'] = message
        if isinstance(error, dict):
            payload['error_code'] = error.get('code')
    elif kind.startswith('task.') or kind == 'artifact.created':
        category, payload = 'task', source
    else:
        category, payload, detail = 'scene', None, source
    return ChatEvent.model_validate({**record, 'category': category, 'payload': payload, 'detail': detail})
