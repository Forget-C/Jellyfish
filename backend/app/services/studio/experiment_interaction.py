"""Recover a laboratory operation through its original interaction identity."""

from fastapi import HTTPException
from sqlalchemy import select

from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.schemas.media_task import MediaTaskReceipt
from app.schemas.studio.experiment_sessions import ExperimentMessageRead, ExperimentTaskCreated
from app.services.chat.admission import command_digest
from app.services.studio.experiment_messages import read_experiment_messages, task_message_display_payload

_REQUEST_KEY = '_interaction_request'
_DIGEST_KEY = '_interaction_digest'


def interaction_request_payload(request_id, body):
    """Bind a stable request identity to normalized accepted input."""
    return {_REQUEST_KEY: request_id, _DIGEST_KEY: command_digest(body)} if request_id else {}


async def find_text_request(db, session_id: str, request_id: str, body):
    """Find the text stream enrollment and validate its original request body."""
    user_message = await db.scalar(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'user',
        ExperimentMessage.payload[_REQUEST_KEY].as_string() == request_id,
    ))
    if user_message and user_message.payload[_DIGEST_KEY] != interaction_request_payload(request_id, body)[_DIGEST_KEY]:
        raise HTTPException(409, 'Laboratory request identity already belongs to different input')
    return user_message


async def text_stream_origin(db, session_id: str, task_id: str):
    """Confirm a persisted text interaction belongs to the requested session."""
    return await db.scalar(select(ExperimentMessage.id).where(
        ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'user',
        ExperimentMessage.payload['interaction_run_id'].as_string() == task_id,
    ))


async def text_stream_result(db, session_id: str, task_id: str):
    """Read the terminal message bound to a text run in its original session."""
    return await db.scalar(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'assistant',
        ExperimentMessage.payload['interaction_run_id'].as_string() == task_id,
    ))


async def find_media_request(db, session_id: str, request_id: str):
    """Read the task message bound to a committed media request identity."""
    return await db.scalar(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'task',
        ExperimentMessage.payload[_REQUEST_KEY].as_string() == request_id,
    ))


async def find_media_receipt(db, session_id: str, request_id: str, *, body=None) -> ExperimentTaskCreated | None:
    """Replay the paired messages and their current task read model without resubmitting."""
    task_message = await find_media_request(db, session_id, request_id)
    if task_message is None:
        return None
    if body is not None and task_message.payload[_DIGEST_KEY] != interaction_request_payload(request_id, body)[_DIGEST_KEY]:
        raise HTTPException(409, 'Laboratory request identity already belongs to different input')
    user_message = await _media_submission_user(db, task_message)
    return ExperimentTaskCreated(
        task_id=task_message.task_id,
        messages=await read_experiment_messages(db, [user_message, task_message], include_media_receipts=True),
    )


async def _media_submission_user(db, task_message):
    session_id = task_message.session_id
    user_message = await db.scalar(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'user',
        ExperimentMessage.sequence == task_message.sequence - 1,
    ))
    if user_message is None:
        raise HTTPException(409, 'The accepted laboratory request is incomplete')
    return user_message


async def read_media_admission(db, session_id, receipt: MediaTaskReceipt) -> list[ExperimentMessageRead] | None:
    """Rebuild old acceptance messages using the recorded task state."""
    task_message = await db.scalar(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'task',
        ExperimentMessage.task_id == receipt.task_id,
    ))
    if task_message is None:
        return None
    user_message = await _media_submission_user(db, task_message)
    stored = task_message.payload or {}
    payload = task_message_display_payload(modality=str(stored.get('modality') or 'generation'))
    if source_file_id := stored.get('source_file_id'):
        payload['source_file_id'] = source_file_id
    payload.update(progress=receipt.progress, outputs=[])
    return [
        ExperimentMessageRead.model_validate(user_message),
        ExperimentMessageRead.model_validate(task_message).model_copy(update={
            'status': receipt.status.value, 'payload': payload, 'media_receipt': receipt,
        }),
    ]


async def read_experiment_receipt(db, session_id, request_id):
    """Read only the receipt belonging to the requested laboratory session."""
    session = await db.get(ExperimentSession, session_id)
    if session:
        receipt = await find_media_receipt(db, session_id, request_id)
        if receipt:
            return receipt
    raise HTTPException(404, 'Laboratory interaction request not found')
