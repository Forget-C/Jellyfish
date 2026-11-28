"""Laboratory chat profile: persisted conversation, turn admission and model execution."""
import asyncio
import json
from contextlib import aclosing
from datetime import UTC, datetime

from fastapi import HTTPException
from langchain.agents.middleware import wrap_model_call
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.contracts.model_capabilities import ModelCapabilityProfile
from app.core.contracts.model_provider import UnsupportedModelInput
from app.models.experiment_sessions import ExperimentSessionEvent, ExperimentMessage, ExperimentSession
from app.models.llm import ModelCategoryKey, ModelSettings
from app.schemas.studio.lab_chat import LabChatCommand, LabChatSnapshot, LabModels
from app.services.chat import turn_recovery
from app.services.chat.artifact_revisions import ArtifactQuestionPending, historical_artifacts, revision_tool, user_turn, record_answer
from app.services.chat.media_tools import ChatTurnStopped, LaboratoryMediaTools, observe_rejected_tool
from app.services.chat.harness import build_chat_agent
from app.services.generation_canvas.assistant_media import resolve_assistant_media, describe_assistant_media
from app.services.llm.model_capabilities import effective_chat_capabilities
from app.services.llm.resolver import build_provider_agent_model, get_model_by_category, get_provider_by_model_or_id
from app.services.studio.session_events import append_session_event, session_event_page
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages, epoch_ms, read_experiment_messages, turn_timing


def laboratory_tools(tools, media, reference_only=False):
    """Offer only the profile tools and honor a stop before each model request."""
    allowed = {tool.name for tool in tools}
    checkpoint = turn_recovery.ModelSteps()

    @wrap_model_call
    async def select_tools(request, handler):
        async with media.sessions.begin() as db:
            await media.require_active(db)
        exposed = [entry for entry in request.tools if getattr(entry, 'name', '') in allowed]
        response = await checkpoint.invoke(media, request.override(tools=exposed, tool_choice=None), handler)
        if any(call['name'] not in allowed for message in response.result for call in message.tool_calls):
            raise HTTPException(422, 'CHAT_TOOL_MODEL_REQUIRED')
        if reference_only and isinstance(request.messages[-1], HumanMessage):
            if not any(message.tool_calls for message in response.result):
                raise HTTPException(422, 'ASSISTANT_MODEL_INPUT_UNSUPPORTED')
        return response

    return select_tools


async def session_for(db, session_id, *, lock=False):
    if lock and db.get_bind().dialect.name == 'sqlite':
        # SQLite ignores FOR UPDATE. Take the write lock before reading command identities.
        await db.execute(update(ExperimentSession).where(ExperimentSession.id == session_id)
                         .values(updated_at=ExperimentSession.updated_at))
    session = await db.get(ExperimentSession, session_id, with_for_update=lock, populate_existing=True)
    if session is None or session.lab_type != 'chat':
        raise HTTPException(404, 'Laboratory chat session not found')
    return session


async def model_choices(db, session):
    defaults = await db.get(ModelSettings, 1)
    selected = session.chat_models or {}
    return LabModels(**{kind: selected.get(kind) or getattr(defaults, f'default_{kind}_model_id', None)
                        for kind in ('text', 'image', 'video')})


async def messages_for(db, session_id):
    return list(await db.scalars(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id).order_by(ExperimentMessage.sequence)))


async def snapshot(db, session_id):
    session = await session_for(db, session_id, lock=True)
    latest = await db.scalar(select(ExperimentSessionEvent).where(
        ExperimentSessionEvent.session_id == session_id).order_by(ExperimentSessionEvent.cursor.desc()).limit(1))
    partial = ''
    if session.active_turn:
        update_event = await db.scalar(select(ExperimentSessionEvent).where(
            ExperimentSessionEvent.session_id == session_id, ExperimentSessionEvent.turn_id == session.active_turn,
            ExperimentSessionEvent.kind == 'message.updated').order_by(ExperimentSessionEvent.cursor.desc()).limit(1))
        if update_event:
            partial = update_event.payload['text']
    active = await user_turn(db, session_id, session.active_turn) if session.active_turn else None
    return LabChatSnapshot(question=active.payload.get('artifact_question') if active else None, session_id=session_id, cursor=latest.cursor if latest else 0,
                           capabilities=('snapshot', 'events', 'send', 'stop'), active_turn=session.active_turn,
                           partial_reply=partial, models=await model_choices(db, session),
                           messages=await read_experiment_messages(db, await messages_for(db, session_id),
                                                                   include_media_receipts=True))


async def events(db, session_id, after):
    await session_for(db, session_id)
    return await session_event_page(db, session_id, after)


async def prepare(db, model_id, body):
    model = await get_model_by_category(db, ModelCategoryKey.text, model_or_id=model_id)
    provider = await get_provider_by_model_or_id(db, model)
    profile = ModelCapabilityProfile.model_validate(model.capability_profile or {})
    caps = effective_chat_capabilities(model, provider, profile)
    if not (caps.text_inputs and caps.text_outputs and (caps.non_streaming or caps.native_streaming)):
        raise HTTPException(422, 'ASSISTANT_TEXT_CAPABILITY_REQUIRED')
    parts = body.text.split(maxsplit=1)
    if not parts:
        raise HTTPException(422, 'Empty message')
    shortcut = {'/imagegen': 'image', '/videogen': 'video'}.get(parts[0])
    if shortcut and not caps.tool_results:
        raise HTTPException(422, 'CHAT_TOOL_MODEL_REQUIRED')
    sources = await resolve_assistant_media(db, None, body.file_ids)
    if set(sources) != set(body.file_ids):
        raise HTTPException(422, 'Attachment unavailable')
    reference_only = any(not getattr(caps, source.file_type + '_inputs') for source in sources.values())
    if reference_only and not (caps.tool_results or shortcut):
        raise HTTPException(422, 'ASSISTANT_MODEL_INPUT_UNSUPPORTED')
    if shortcut or reference_only:
        content = body.text
    else:
        content, evidence = await describe_assistant_media(body.text, body.file_ids, sources, capability=caps)
        if evidence and any(item['observation'] == 'unavailable' for item in evidence):
            raise HTTPException(422, 'Attachment unavailable')
    streaming = caps.native_streaming
    client = build_provider_agent_model(provider=provider, model=model, thinking=False,
                                       configure=lambda params: params.update(streaming=streaming, disable_streaming=not streaming))
    return client, content, streaming, caps.tool_results, shortcut, reference_only


def inspection_tool(media, artifacts):
    """Let the selected model read a historical file only through its effective media capabilities."""
    from langchain.tools import tool

    @tool
    async def inspect_artifact(file_id: str, question: str):
        """Inspect visible content of a named historical output using the current chat model."""
        if file_id not in {artifact.file_id for artifact in artifacts}:
            raise HTTPException(422, 'CHAT_ARTIFACT_UNAVAILABLE')
        body = LabChatCommand(request_id=media.turn_id, text=question, file_ids=[file_id])
        async with media.sessions.begin() as reader:
            await media.require_active(reader)
            model, content, streaming, _, _, reference_only = await prepare(reader, media.models.text, body)
        if reference_only:
            raise HTTPException(422, 'ASSISTANT_MODEL_INPUT_UNSUPPORTED')
        messages = [HumanMessage(content=content)]
        if streaming:
            return ''.join([chunk.text async for chunk in model.astream(messages)])
        return (await model.ainvoke(messages)).text
    return inspect_artifact


async def finish(db, session_id, turn_id, status, text='', owner=None, error_code=None):
    """A late model response cannot overwrite a stopped or superseded turn."""
    matching = [ExperimentSession.id == session_id, ExperimentSession.active_turn == turn_id]
    if owner is not None:
        matching.append(ExperimentSession.chat_execution['owner'].as_string() == owner)
    released = await db.execute(update(ExperimentSession).where(*matching).values(
        active_turn=None, chat_execution=None, chat_lease_until=None))
    if released.rowcount:
        message_payload = {'turn_id': turn_id}
        if error_code:
            message_payload['error_code'] = error_code
        messages = await append_experiment_messages(db, session_id=session_id, drafts=[
            ExperimentMessageDraft(role='assistant', content=text, status=status, payload=message_payload)])
        await db.flush()
        origin = await db.scalar(select(ExperimentMessage).where(
            ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'user',
            ExperimentMessage.payload['turn_id'].as_string() == turn_id,
        ).order_by(ExperimentMessage.sequence).limit(1))
        messages[0].payload = {**message_payload, **turn_timing(origin)}
        reply, = await read_experiment_messages(db, messages)
        payload = {'text': text, 'assistant_message': reply.model_dump(mode='json')}
        if error_code:
            payload['error'] = {'code': error_code, 'message': error_code}
        await append_session_event(db, session_id, turn_id, 'turn.' + status, payload)
    await db.commit()


async def recover_turn(sessions, session_id, turn_id):
    async with sessions() as db:
        owner = await turn_recovery.claim(db, session_id, turn_id)
        if owner:
            try:
                original = await db.scalar(select(ExperimentMessage).where(
                    ExperimentMessage.session_id == session_id, ExperimentMessage.role == 'user',
                    ExperimentMessage.payload['turn_id'].as_string() == turn_id))
                command = LabChatCommand(request_id=turn_id, text=original.content, file_ids=original.payload['file_ids'])
                await send(db, session_id, command, recovering=owner)
            except Exception:
                await db.rollback()
                await finish(db, session_id, turn_id, 'failed', owner=owner)
                raise


async def send(db, session_id, body, *, recovering=None, on_accepted=None):
    session = await session_for(db, session_id, lock=True)
    history = await messages_for(db, session_id)
    prior = next((m for m in history if m.role == 'user' and m.payload.get('turn_id') == body.request_id), None)
    if prior and not recovering:
        if prior.content != body.text or prior.payload.get('file_ids', []) != body.file_ids:
            raise HTTPException(409, 'Conflicting retry')
        return
    choices = LabModels(**prior.payload['models']) if recovering else await model_choices(db, session)
    if session.active_turn and not recovering:
        raise HTTPException(409, 'Chat turn active')
    client, content, streaming, supports_tools, shortcut, reference_only = await prepare(db, choices.text, body)
    if shortcut and not getattr(choices, shortcut):
        raise HTTPException(422, f'CHAT_{shortcut.upper()}_MODEL_REQUIRED')
    if body.file_ids:
        references = 'Attachment file IDs: ' + ', '.join(body.file_ids)
        content = ([{'type': 'text', 'text': content}] if isinstance(content, str) else list(content)) + [
            {'type': 'text', 'text': references}]
    if recovering:
        history = [message for message in history if message.sequence < prior.sequence]
        owner = recovering
        await db.commit()
    else:
        execution = turn_recovery.new_execution()
        owner = execution['owner']
        acquired = await db.execute(update(ExperimentSession).where(
            ExperimentSession.id == session_id, ExperimentSession.active_turn.is_(None)
        ).values(active_turn=body.request_id, chat_execution=execution, chat_lease_until=turn_recovery.lease_end()))
        if not acquired.rowcount:
            raise HTTPException(409, 'Chat turn active')
        messages = await append_experiment_messages(db, session_id=session_id, drafts=[ExperimentMessageDraft(
            role='user', content=body.text, payload={'turn_id': body.request_id, 'file_ids': body.file_ids,
                                                    'models': choices.model_dump(),
                                                    'accepted_at_ms': epoch_ms(datetime.now(UTC))})])
        await db.flush()
        user, = await read_experiment_messages(db, messages)
        await append_session_event(db, session_id, body.request_id, 'turn.accepted',
                                   {'user_message': user.model_dump(mode='json')})
        await db.commit()
        if on_accepted:
            on_accepted()
    text = ''
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)
    try:
        conversation = [(HumanMessage if m.role == 'user' else AIMessage)(content=m.content)
                        for m in history if m.role in ('user', 'assistant') and m.content]
        async with sessions() as reader:
            artifacts = await historical_artifacts(reader, session_id, body.request_id)
        if artifacts:
            catalog = json.dumps([a.model_dump() for a in artifacts], ensure_ascii=False)
            conversation.append(HumanMessage(content='本会话此前归档的产物（仅元数据）：' + catalog))
        conversation.append(HumanMessage(content=content))
        async with turn_recovery.heartbeat(sessions, session_id, body.request_id, owner):
            media = LaboratoryMediaTools(sessions,
                                        session_id, body.request_id, choices, [*body.file_ids, *(a.file_id for a in artifacts)], owner)
            tools = [media.image(), media.video()] if supports_tools else []
            prompt = '你是综合聊天助手。'
            if supports_tools and artifacts:
                tools.extend([revision_tool(media), inspection_tool(media, artifacts)])
                prompt += ('用户要求修改此前产物时使用 revise_artifact，只传需改动的参数。指代有歧义时省略文件标识，由用户选择。'
                           '历史元数据仅说明生成依据，解读历史画面须通过 inspect_artifact 读取文件。')
            if shortcut:
                prompt += f'用户已指定使用 generate_{shortcut}。要求充分时执行，关键信息不清时向用户提问。'
            if reference_only:
                prompt += '附件仅提供文件引用。可以把引用传给生成工具。若请求需要理解文件内容，请说明当前模型无法查看素材。'
            agent = build_chat_agent(client, tools=tools, middleware=[laboratory_tools(tools, media, reference_only and not shortcut), observe_rejected_tool(media)],
                                     system_prompt=prompt)
            if streaming:
                async with aclosing(agent.astream({'messages': conversation}, stream_mode='messages')) as stream:
                    # Opaque file references can be forwarded to tools but cannot support
                    # visual claims. Publish prose only after the model has used a tool.
                    can_publish_text = not reference_only or bool(shortcut)
                    async for chunk, meta in stream:
                        if isinstance(chunk, ToolMessage):
                            can_publish_text = True
                        if can_publish_text and isinstance(chunk, AIMessageChunk) and meta.get('langgraph_node') == 'model' and chunk.text:
                            await media.require_active(db)
                            text += chunk.text
                            await append_session_event(db, session_id, body.request_id, 'message.updated', {'text': text})
                            await db.commit()
            else:
                state = await agent.ainvoke({'messages': conversation})
                text = state['messages'][-1].text
            await finish(db, session_id, body.request_id, 'completed', text, owner)
    except (ArtifactQuestionPending, ChatTurnStopped):
        await db.rollback()
    except UnsupportedModelInput as error:
        await db.rollback()
        await finish(db, session_id, body.request_id, 'failed', text, owner, error_code='ASSISTANT_MODEL_INPUT_UNSUPPORTED')
        raise HTTPException(422, 'ASSISTANT_MODEL_INPUT_UNSUPPORTED') from error
    except asyncio.CancelledError:
        await db.rollback()
        await db.execute(update(ExperimentSession).where(
            ExperimentSession.id == session_id, ExperimentSession.active_turn == body.request_id,
            ExperimentSession.chat_execution['owner'].as_string() == owner,
        ).values(chat_lease_until=turn_recovery.now()))
        await db.commit()
        raise
    except Exception as error:
        await db.rollback()
        detail = getattr(error, 'detail', None) if isinstance(error, HTTPException) else None
        await finish(db, session_id, body.request_id, 'failed', text, owner,
                     error_code=detail if isinstance(detail, str) else None)
        raise
    return await snapshot(db, session_id)


async def save_models(db, session_id, body):
    session = await session_for(db, session_id, lock=True)
    choices = body.model_dump(exclude_unset=True)
    for kind, model_id in choices.items():
        if model_id is not None:
            await get_model_by_category(db, ModelCategoryKey(kind), model_or_id=model_id)
    session.chat_models = {**(session.chat_models or {}), **choices}
    await db.flush()
    return await model_choices(db, session)


async def answer_turn(db, session_id, turn_id, body, *, on_accepted):
    """Record the answer and release HTTP before resuming the leased turn."""
    session = await session_for(db, session_id, lock=True)
    row, changed = await record_answer(db, session, turn_id, body)
    cursor = await db.scalar(select(ExperimentSessionEvent.cursor).where(
        ExperimentSessionEvent.session_id == session_id, ExperimentSessionEvent.turn_id == turn_id,
        ExperimentSessionEvent.kind == 'question.answered',
        ExperimentSessionEvent.payload['question_id'].as_string() == body.question_id,
    ))
    if not changed:
        await db.commit()
        on_accepted(cursor - 1)
        return
    command = LabChatCommand(request_id=turn_id, text=row.content, file_ids=row.payload.get('file_ids', []))
    owner = await turn_recovery.claim(db, session_id, turn_id, paused=True)
    if owner is None:
        raise HTTPException(409, 'Chat question is no longer active')
    on_accepted(cursor - 1)
    try:
        await send(db, session_id, command, recovering=owner)
    except Exception:
        await db.rollback()
        await finish(db, session_id, turn_id, 'failed', owner=owner)
        raise


async def stop_turn(db, session_id, turn_id):
    state = await snapshot(db, session_id)
    if state.active_turn == turn_id:
        await finish(db, session_id, turn_id, 'stopped', state.partial_reply)
    return await snapshot(db, session_id)
