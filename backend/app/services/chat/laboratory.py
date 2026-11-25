"""Laboratory chat profile: persisted conversation, turn admission and model execution."""
from contextlib import aclosing

from fastapi import HTTPException
from langchain.agents.middleware import wrap_model_call
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from sqlalchemy import select, update

from app.core.contracts.model_capabilities import ModelCapabilityProfile
from app.models.experiment_sessions import ExperimentChatEvent, ExperimentMessage, ExperimentSession
from app.models.llm import ModelCategoryKey, ModelSettings
from app.schemas.interaction import InteractionEvent
from app.schemas.studio.lab_chat import LabChatSnapshot, LabModels
from app.services.chat.harness import build_chat_agent
from app.services.generation_canvas.assistant_media import resolve_assistant_media, describe_assistant_media
from app.services.llm.model_capabilities import effective_chat_capabilities
from app.services.llm.resolver import build_provider_agent_model, get_model_by_category, get_provider_by_model_or_id
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages, read_experiment_messages


@wrap_model_call
async def plain_conversation(request, handler):
    """Expose only tools registered by this profile (initially plain conversation)."""
    return await handler(request.override(tools=[]))


async def session_for(db, session_id, *, lock=False):
    session = await db.get(ExperimentSession, session_id, with_for_update=lock, populate_existing=True)
    if session is None or session.lab_type != 'chat':
        raise HTTPException(404, 'Laboratory chat session not found')
    return session


async def model_choices(db, session):
    defaults = await db.get(ModelSettings, 1)
    selected = session.chat_models or {}
    return LabModels(**{kind: selected.get(kind) or getattr(defaults, f'default_{kind}_model_id', None)
                        for kind in ('text', 'image', 'video')})


def publish(db, session_id, turn_id, kind, **payload):
    db.add(ExperimentChatEvent(session_id=session_id, turn_id=turn_id, type=kind, payload=payload))


async def messages_for(db, session_id):
    return list(await db.scalars(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id).order_by(ExperimentMessage.sequence)))


async def snapshot(db, session_id):
    session = await session_for(db, session_id, lock=True)
    latest = await db.scalar(select(ExperimentChatEvent).where(
        ExperimentChatEvent.session_id == session_id).order_by(ExperimentChatEvent.cursor.desc()).limit(1))
    partial = latest.payload.get('text', '') if latest and latest.turn_id == session.active_turn else ''
    return LabChatSnapshot(session_id=session_id, cursor=latest.cursor if latest else 0,
                           capabilities=('snapshot', 'events', 'send', 'stop'), active_turn=session.active_turn,
                           partial_reply=partial, models=await model_choices(db, session),
                           messages=await read_experiment_messages(db, await messages_for(db, session_id)))


async def events(db, session_id, after):
    await session_for(db, session_id)
    rows = await db.scalars(select(ExperimentChatEvent).where(
        ExperimentChatEvent.session_id == session_id, ExperimentChatEvent.cursor > after
    ).order_by(ExperimentChatEvent.cursor).limit(128))
    return [InteractionEvent.model_validate(row, from_attributes=True) for row in rows]


async def prepare(db, model_id, body):
    model = await get_model_by_category(db, ModelCategoryKey.text, model_or_id=model_id)
    provider = await get_provider_by_model_or_id(db, model)
    profile = ModelCapabilityProfile.model_validate(model.capability_profile or {})
    caps = effective_chat_capabilities(model, provider, profile)
    if not (caps.text_inputs and caps.text_outputs):
        raise HTTPException(422, 'ASSISTANT_TEXT_CAPABILITY_REQUIRED')
    sources = await resolve_assistant_media(db, None, body.file_ids)
    for file_id in body.file_ids:
        source = sources.get(file_id)
        if not source:
            raise HTTPException(422, 'Attachment unavailable')
        if not getattr(caps, source.file_type + '_inputs'):
            raise HTTPException(422, 'ASSISTANT_MODEL_INPUT_UNSUPPORTED')
    content, evidence = await describe_assistant_media(body.text, body.file_ids, sources, capability=caps)
    if evidence and any(item['observation'] == 'unavailable' for item in evidence):
        raise HTTPException(422, 'Attachment unavailable')
    streaming = caps.native_streaming and profile.native_streaming.declaration != 'unsupported'
    client = build_provider_agent_model(provider=provider, model=model, thinking=False,
                                       configure=lambda params: params.update(streaming=streaming, disable_streaming=not streaming))
    return client, content, streaming


async def finish(db, session_id, turn_id, status, text=''):
    """A late model response cannot overwrite a stopped or superseded turn."""
    released = await db.execute(update(ExperimentSession).where(
        ExperimentSession.id == session_id, ExperimentSession.active_turn == turn_id).values(active_turn=None))
    if released.rowcount:
        await append_experiment_messages(db, session_id=session_id, drafts=[
            ExperimentMessageDraft(role='assistant', content=text, status=status, payload={'turn_id': turn_id})])
        publish(db, session_id, turn_id, 'turn.' + status, text=text)
    await db.commit()


async def send(db, session_id, body):
    session = await session_for(db, session_id, lock=True)
    history = await messages_for(db, session_id)
    prior = next((m for m in history if m.role == 'user' and m.payload.get('turn_id') == body.request_id), None)
    if prior:
        if prior.content != body.text or prior.payload.get('file_ids', []) != body.file_ids:
            raise HTTPException(409, 'Conflicting retry')
        return await snapshot(db, session_id)
    choices = await model_choices(db, session)
    if session.active_turn:
        raise HTTPException(409, 'Chat turn active')
    client, content, streaming = await prepare(db, choices.text, body)
    acquired = await db.execute(update(ExperimentSession).where(
        ExperimentSession.id == session_id, ExperimentSession.active_turn.is_(None)
    ).values(active_turn=body.request_id))
    if not acquired.rowcount:
        raise HTTPException(409, 'Chat turn active')
    conversation = [(HumanMessage if m.role == 'user' else AIMessage)(content=m.content)
                    for m in history if m.role in ('user', 'assistant') and m.content]
    conversation.append(HumanMessage(content=content))
    await append_experiment_messages(db, session_id=session_id, drafts=[ExperimentMessageDraft(
        role='user', content=body.text, payload={'turn_id': body.request_id, 'file_ids': body.file_ids,
                                                'models': choices.model_dump()})])
    publish(db, session_id, body.request_id, 'turn.accepted')
    await db.commit()
    text = ''
    try:
        agent = build_chat_agent(client, tools=[], middleware=[plain_conversation], system_prompt='你是综合聊天助手。')
        if streaming:
            async with aclosing(agent.astream({'messages': conversation}, stream_mode='messages')) as stream:
                async for chunk, meta in stream:
                    if isinstance(chunk, AIMessageChunk) and meta.get('langgraph_node') == 'model' and chunk.text:
                        if (await session_for(db, session_id, lock=True)).active_turn != body.request_id:
                            break
                        text += chunk.text
                        publish(db, session_id, body.request_id, 'message.updated', text=text)
                        await db.commit()
        else:
            state = await agent.ainvoke({'messages': conversation})
            text = state['messages'][-1].text
        await finish(db, session_id, body.request_id, 'completed', text)
    except Exception:
        await db.rollback()
        await finish(db, session_id, body.request_id, 'failed', text)
        raise
    return await snapshot(db, session_id)
