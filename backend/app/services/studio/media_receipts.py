"""Project persisted generation facts into replayable public media task receipts."""
from collections import defaultdict

from sqlalchemy import select

from app.core.contracts.task import TaskStatus
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import Task, TaskInput
from app.schemas.media_task import MediaArtifactRead, MediaReferenceRead, MediaTaskReceipt
from app.services.task_queries import TaskQueries


async def media_task_receipts(db, results):
    """Batch-load public inputs and routing identity for media task history."""
    if not results:
        return {}
    # Extract only the public fields in SQL. The full snapshot includes execution credentials.
    rows = (await db.execute(select(
        Task.id, Task.input_snapshot['model_id'].as_string(), Task.input_snapshot['model_name'].as_string(),
        Task.input_snapshot['operation_input'],
    ).where(
        Task.id.in_(results), Task.kind.in_(('image_generation', 'video_generation')),
    ))).all()
    if not rows:
        return {}
    references = defaultdict(list)
    inputs = await db.scalars(select(TaskInput).where(TaskInput.task_id.in_([row.id for row in rows]))
                              .order_by(TaskInput.role_path, TaskInput.ordinal))
    for item in inputs:
        references[item.task_id].append(MediaReferenceRead(role=item.role_path, ordinal=item.ordinal, file_id=item.file_id))
    receipts = {}
    for task_id, model_id, model_name, parameters in rows:
        result = results[task_id]
        receipts[task_id] = MediaTaskReceipt(
            task_id=task_id, model_id=model_id, model_name=model_name,
            parameters=parameters or {}, references=references[task_id],
            artifacts=[MediaArtifactRead(**item.model_dump()) for item in result.outputs
                       if item.media_type in ('image', 'video', 'audio')],
            status=result.status, progress=result.progress, stage=result.stage, error=result.error,
            cancel_requested=result.cancel_requested, remote_cancellation=result.remote_cancellation,
        )
    return receipts


async def publish_media_fact(db, task_id, session_id):
    """Persist a direct trial event in the same transaction as its task transition."""
    from app.services.studio.session_events import append_session_event

    message = await db.scalar(select(ExperimentMessage).join(
        ExperimentSession, ExperimentMessage.session_id == ExperimentSession.id,
    ).where(ExperimentMessage.task_id == task_id, ExperimentMessage.session_id == session_id,
            ExperimentSession.lab_type.in_(('image', 'video'))))
    if message is None:
        return
    results = await TaskQueries(db).results([task_id])
    receipt = (await media_task_receipts(db, results))[task_id]
    turn_id = (message.payload or {}).get('_interaction_request') or message.id
    kind = {
        TaskStatus.queued: 'task.accepted', TaskStatus.running: 'task.progress',
        TaskStatus.failed: 'task.failed', TaskStatus.cancelled: 'task.cancelled',
        TaskStatus.succeeded: 'task.completed',
    }[receipt.status]
    public = receipt.model_dump(mode='json')
    if receipt.artifacts and receipt.status == TaskStatus.succeeded:
        await append_session_event(db, session_id, turn_id, 'artifact.created', public)
    await append_session_event(db, session_id, turn_id, kind, public)
