"""Project stored scene records onto the product's shared SSE contract."""
from typing import Literal

from pydantic import BaseModel

from app.schemas.canvas_assistant import CanvasAssistantExchange


class ReplyUpdate(BaseModel):
    text: str
    mode: Literal['append', 'replace']


class ToolUpdate(BaseModel):
    tool_call_id: str
    tool: str
    state: Literal['started', 'completed', 'failed']
    parameters: dict
    model_id: str | None
    error: str | None


class TurnUpdate(BaseModel):
    text: str
    error: str | None
    reason: str | None


def public_event(event):
    """Use the same public payload for a fact, preserving scene receipts separately."""
    result = event.model_dump(mode='json')
    source = result['payload']
    canvas = isinstance(event.payload, CanvasAssistantExchange)
    progress = (source.get('progress') or {}) if canvas else {}
    if canvas:
        result['canvas'] = source
    if event.type == 'message.updated':
        delta = 'text_delta' in source
        result['payload'] = ReplyUpdate(
            mode='append' if delta else 'replace',
            text=source['text_delta'] if delta else (progress.get('reply') if canvas else source['text']) or '',
        ).model_dump()
    elif event.type in ('tool.started', 'tool.completed', 'tool.failed'):
        call = progress.get('tool_call') or {}
        error = source.get('error')
        result['payload'] = ToolUpdate(
            tool_call_id=call.get('id') or source['tool_call_id'],
            tool=call.get('name') or source['tool'], state=event.type.split('.')[1],
            model_id=source.get('model_id'), parameters=call.get('parameters') or source.get('parameters') or {},
            error=error if isinstance(error, str) else None,
        ).model_dump()
    elif event.type in ('turn.accepted', 'turn.completed', 'turn.failed', 'turn.stopped'):
        if not canvas:
            result['receipt'] = source
        error = source.get('error')
        result['payload'] = TurnUpdate(
            text=(source.get('reply') if canvas else source.get('text') or
                  (source.get('assistant_message') or {}).get('content')) or '',
            error=source.get('error_code') or (error.get('message') if isinstance(error, dict) else error),
            reason=source.get('reason'),
        ).model_dump()
    elif canvas:
        result.pop('canvas')
    return result
