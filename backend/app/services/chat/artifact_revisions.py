"""Resolve previous laboratory outputs to their original generation inputs within one conversation."""
from typing import Literal

from fastapi import HTTPException
from langchain.tools import ToolRuntime, tool
from sqlalchemy import select

from app.core.contracts.generation import GenerationModality, GenerationSubmitRequest
from app.models.experiment_sessions import ExperimentMessage
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import Task, TaskInput, TaskOutput
from app.schemas.studio.lab_chat import ArtifactOption, ArtifactQuestion
from app.services.generation.task_snapshot import restore_snapshot
from app.services.studio.session_events import append_session_event


class ArtifactQuestionPending(Exception):
    """The turn has a durable question and must wait for its answer."""


async def historical_artifacts(db, session_id, turn_id):
    """List only archived, live outputs of earlier tasks owned by this session."""
    rows = await db.execute(select(Task.id, FileItem.id, FileItem.type, FileItem.name,
                                   Task.input_snapshot['execution_prompt'].as_string(),
                                   ExperimentMessage.sequence, TaskOutput.ordinal)
        .select_from(ExperimentMessage).join(Task, Task.id == ExperimentMessage.task_id)
        .join(TaskOutput, TaskOutput.task_id == Task.id).join(FileItem, FileItem.id == TaskOutput.file_id)
        .where(ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'task',
               ExperimentMessage.payload['turn_id'].as_string() != turn_id,
               Task.target_type == 'experiment_session', Task.target_id == session_id, Task.status == 'succeeded',
               FileItem.type.in_(('image', 'video')), FileItem.deleted_at.is_(None),
               FileItem.delete_requested_at.is_(None))
        .order_by(ExperimentMessage.sequence, TaskOutput.ordinal))
    return [ArtifactOption(task_id=task_id, file_id=file_id, modality=kind, name=name,
                           prompt=prompt or '', sequence=sequence, ordinal=ordinal)
            for task_id, file_id, kind, name, prompt, sequence, ordinal in rows]


async def user_turn(db, session_id, turn_id):
    return await db.scalar(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'user',
        ExperimentMessage.payload['turn_id'].as_string() == turn_id).with_for_update())


def revision_tool(media):
    @tool
    async def revise_artifact(runtime: ToolRuntime, modality: Literal['image', 'video'], changes: dict,
                              source_file_id: str | None = None, prompt: str | None = None,
                              submit_only: bool = False):
        """Revise a previous output using its original model, prompt and references. Supply only changed generation parameters.
        Specify source_file_id only for an unambiguous reference; omit it for the user to choose among possible outputs."""
        async with media.sessions.begin() as db:
            session = await media.require_active(db)
            options = [o for o in await historical_artifacts(db, media.session_id, media.turn_id) if o.modality == modality]
            user = await user_turn(db, media.session_id, media.turn_id)
            selected = (user.payload.get('artifact_answers') or {}).get(runtime.tool_call_id) or source_file_id
            if selected:
                options = [o for o in options if o.file_id == selected]
            if not options:
                raise HTTPException(422, 'CHAT_ARTIFACT_UNAVAILABLE')
            if len(options) > 1:
                question = ArtifactQuestion(id=runtime.tool_call_id, options=options)
                # Persist the question and release the worker lease atomically. A late
                # heartbeat or tool result from the old owner must not reclaim this turn.
                session.chat_lease_until = None
                session.chat_execution = {**session.chat_execution, 'owner': None}
                if user.payload.get('artifact_question') != question.model_dump():
                    user.payload = {**user.payload, 'artifact_question': question.model_dump()}
                    await append_session_event(db, media.session_id, media.turn_id, 'question.asked', question.model_dump())
                await db.commit()
                raise ArtifactQuestionPending()
            source = options[0]
            task = await db.get(Task, source.task_id)
            refs = (await db.execute(select(TaskInput, FileItem).join(FileItem, FileItem.id == TaskInput.file_id)
                                    .where(TaskInput.task_id == task.id))).all()
            basis = restore_snapshot(task, refs)
            original = basis.operation_input
            if any(k not in type(original).model_fields or k == 'kind' for k in changes):
                raise HTTPException(422, 'Invalid revision parameters')
            request = GenerationSubmitRequest(model_id=basis.model_id,
                execution_prompt=basis.execution_prompt if prompt is None else prompt, media=basis.media,
                operation_input={**original.model_dump(), **changes})
        return await media.execute(runtime.tool_call_id, 'revise_artifact', GenerationModality(modality),
                                   request, submit_only, source_file_id=source.file_id)
    return revise_artifact


async def record_answer(db, session, turn_id, answer):
    """Commit one validated choice under the session lock before resuming the graph."""
    row = await user_turn(db, session.id, turn_id)
    if row is None:
        raise HTTPException(404, 'Chat turn not found')
    answers = row.payload.get('artifact_answers', {})
    prior = answers.get(answer.question_id)
    if prior is not None:
        if prior != answer.file_id:
            raise HTTPException(409, 'Conflicting answer')
        return row, False
    question = row.payload.get('artifact_question')
    if session.active_turn != turn_id or not question or question['id'] != answer.question_id:
        raise HTTPException(409, 'Chat question no longer active')
    if not any(o['file_id'] == answer.file_id for o in question['options']):
        raise HTTPException(422, 'CHAT_ARTIFACT_UNAVAILABLE')
    row.payload = {**row.payload, 'artifact_question': None,
                   'artifact_answers': {**answers, answer.question_id: answer.file_id}}
    await append_session_event(db, session.id, turn_id, 'question.answered', answer.model_dump())
    return row, True
