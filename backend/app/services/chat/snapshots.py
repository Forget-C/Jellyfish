"""Compose the public checkpoint from one profile's committed history."""
from app.schemas.chat import ChatSessionSnapshot, TrialChatHistory
from app.services.chat import laboratory
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.studio import text_trials
from app.services.studio.media_trials import media_snapshot


async def canvas_snapshot(db, session_id, project_id):
    """Read the canvas's committed view using the normal history projection."""
    return await CanvasAssistant(db, project_id).history(session_id)


async def stop_canvas_snapshot(db, session_id, project_id, turn_id):
    """Stop the turn before reporting its authoritative history and event position."""
    await CanvasAssistant(db, project_id).stop(session_id, turn_id)
    return await canvas_snapshot(db, session_id, project_id)


async def session_snapshot(db, owner, session_id, page, page_size):
    """Read history and its SSE cursor from the same session projection."""
    kind, project = owner
    if kind in ('text', 'image', 'video'):
        read_snapshot = text_trials.snapshot if kind == 'text' else media_snapshot
        messages, checkpoint = await read_snapshot(db, session_id, page, page_size)
        active = await text_trials.snapshot_active_turn_ids(db, session_id) if kind == 'text' else None
        return ChatSessionSnapshot(kind=kind, **checkpoint.model_dump(),
                                   history=TrialChatHistory(messages=messages, active_turn_ids=active))
    history = (await canvas_snapshot(db, session_id, project or '') if kind == 'canvas'
               else await laboratory.snapshot(db, session_id))
    return ChatSessionSnapshot(kind=kind, session_id=session_id, cursor=history.cursor,
                               capabilities=history.capabilities, history=history)
