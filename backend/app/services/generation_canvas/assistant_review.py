"""Follow the run receipts from an explicit assistant review request."""

from asyncio import CancelledError
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, tuple_, update

from app.models.canvas_assistant import CanvasAssistantGeneration, CanvasAssistantTurn
from app.models.generation_canvas import CanvasResultSet, CanvasRunNode, GenerationCanvas
from app.schemas.canvas_assistant_generation import CanvasAssistantReviewResult
from app.schemas.canvas_assistant_media import CanvasAssistantAttachment
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.generation_canvas.assistant_generation import read_generation
from app.services.generation_canvas.assistant_media import describe_assistant_media, resolve_assistant_media
from app.services.task_service import utcnow

_REVIEW_LEASE = timedelta(minutes=3)
_TERMINAL_VERSION_STATES = frozenset({'succeeded', 'failed', 'cancelled'})


@dataclass(frozen=True)
class ReviewInput:
    """The exact version and its immutable output file identities."""

    run_id: str
    version: int
    file_ids: list[str]
    reason: str | None


def _available(now):
    return or_(CanvasAssistantGeneration.review_state == 'waiting', and_(
        CanvasAssistantGeneration.review_state == 'reviewing',
        CanvasAssistantGeneration.review_lease_until <= now,
    ))


async def _choose_review(sessions):
    """Find a terminal generation, then claim it before any provider action."""
    now = utcnow()
    generation_key = (CanvasAssistantGeneration.created_at, CanvasAssistantGeneration.canvas_id,
                      CanvasAssistantGeneration.source_id)
    async with sessions() as db:
        query = select(
            CanvasAssistantGeneration.created_at,
            CanvasAssistantGeneration.canvas_id, CanvasAssistantGeneration.source_id,
            CanvasAssistantGeneration.review_request, CanvasAssistantGeneration.review_results,
            GenerationCanvas.project_id, CanvasAssistantTurn.model_id,
        ).join(GenerationCanvas, GenerationCanvas.id == CanvasAssistantGeneration.canvas_id).join(
            CanvasAssistantTurn, and_(CanvasAssistantTurn.canvas_id == CanvasAssistantGeneration.canvas_id,
                                      CanvasAssistantTurn.request_id == CanvasAssistantGeneration.source_id),
        ).where(_available(now), CanvasAssistantGeneration.state.in_(('submitted', 'failed', 'rejected'))
                ).order_by(*generation_key).limit(16)
        page = query
        while candidates := (await db.execute(page)).all():
            for _, canvas_id, source_id, question, results, project_id, model_id in candidates:
                generation = await read_generation(db, canvas_id, source_id)
                if generation is None or any(version.state not in _TERMINAL_VERSION_STATES
                                             for version in generation.versions):
                    continue
                token = uuid4().hex
                changed = await db.execute(update(CanvasAssistantGeneration).where(
                    CanvasAssistantGeneration.canvas_id == canvas_id, CanvasAssistantGeneration.source_id == source_id,
                    _available(now),
                ).values(review_state='reviewing', review_token=token, review_lease_until=now + _REVIEW_LEASE))
                if changed.rowcount:
                    await db.commit()
                    return canvas_id, source_id, question, project_id, model_id, token, generation.versions, results or []
            page = query.where(tuple_(*generation_key) > tuple_(*candidates[-1][:3]))
    return None


async def _run_output(db, canvas_id, version) -> ReviewInput:
    if version.state != 'succeeded':
        reason = '生成已取消，本次没有可审看的成片。' if version.state == 'cancelled' else '生成未完成，本次没有可审看的成片。'
        return ReviewInput(version.run_id, version.version, [], reason)
    outputs = await db.scalar(select(CanvasResultSet.outputs).join(
        CanvasRunNode, CanvasRunNode.result_set_id == CanvasResultSet.id,
    ).where(CanvasRunNode.canvas_id == canvas_id, CanvasRunNode.run_id == version.run_id,
            CanvasResultSet.canvas_id == canvas_id))
    ids = []
    for output in outputs or ():
        item = CanvasResolvedOutput.model_validate(output)
        if item.modality in ('image', 'video') and item.file_id and item.file_id not in ids:
            ids.append(item.file_id)
    return ReviewInput(version.run_id, version.version, ids[:4], None if ids else '该次运行没有可审看的图片或视频。')


async def _review_version(sessions, identity, item, question, project_id, model_id) -> CanvasAssistantReviewResult | None:
    canvas_id, source_id, token = identity
    result = CanvasAssistantReviewResult(run_id=item.run_id, version=item.version, reply=item.reason or '')
    if item.reason:
        return result
    async with sessions() as db:
        entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id))
        if entry is None or entry.review_token != token:
            return None
        try:
            model, capability = await CanvasAssistant(db, project_id).prepare_review_model(model_id)
        except HTTPException:
            result.reply = '本轮助手模型暂不可用，暂无法审看这次运行。'
            return result
        sources = await resolve_assistant_media(db, project_id, item.file_ids)
    content, evidence = await describe_assistant_media(
        '请用成片审看技能按这项要求审看本次生成结果：' + question,
        item.file_ids, sources, capability=capability,
    )
    result.evidence = [CanvasAssistantAttachment.model_validate(item) for item in evidence or []]
    if not any(item.observation != 'unavailable' for item in result.evidence):
        result.reply = '本次生成结果暂不可读取，或助手模型无法观察该素材。'
        return result
    async with sessions() as db:
        entry = await db.get(CanvasAssistantGeneration, (canvas_id, source_id))
        if entry is None or entry.review_token != token:
            return None
    try:
        result.reply, result.skills = await CanvasAssistant.review_evidence(
            model, content, supports_tools=capability.tool_calling, max_input_tokens=capability.max_input_tokens)
    except HTTPException:
        result.reply = '未收到本次生成结果的审看回复。'
    return result


async def _update_claim(sessions, canvas_id, source_id, token, **values) -> bool:
    async with sessions.begin() as db:
        changed = await db.execute(update(CanvasAssistantGeneration).where(
            CanvasAssistantGeneration.canvas_id == canvas_id, CanvasAssistantGeneration.source_id == source_id,
            CanvasAssistantGeneration.review_state == 'reviewing', CanvasAssistantGeneration.review_token == token,
        ).values(**values))
        return bool(changed.rowcount)


async def advance_assistant_reviews(sessions) -> None:
    """Recover a follow-up and resume at its next version without redoing saved feedback."""
    claimed = await _choose_review(sessions)
    if claimed is None:
        return
    canvas_id, source_id, question, project_id, model_id, token, versions, results = claimed
    reviewed = {result['run_id'] for result in results}
    try:
        async with sessions() as db:
            inputs = [await _run_output(db, canvas_id, version) for version in versions if version.run_id not in reviewed]
        for item in inputs:
            result = await _review_version(sessions, (canvas_id, source_id, token), item, question, project_id, model_id)
            if result is None:
                return
            results.append(result.model_dump(mode='json'))
            if not await _update_claim(sessions, canvas_id, source_id, token, review_results=results,
                                       review_lease_until=utcnow() + _REVIEW_LEASE):
                return
        await _update_claim(sessions, canvas_id, source_id, token, review_state='completed',
                            review_token=None, review_lease_until=None)
    except CancelledError:
        await _update_claim(sessions, canvas_id, source_id, token, review_state='waiting',
                            review_token=None, review_lease_until=None)
        raise
