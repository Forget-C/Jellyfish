"""Conversation and replay for the shared canvas assistant."""

import asyncio
from datetime import UTC, datetime, timedelta
import logging
from uuid import uuid4

from deepagents import create_deep_agent
from fastapi import HTTPException
from langchain.agents.middleware import wrap_model_call
from langchain_core.messages import AIMessage, HumanMessage
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.canvas_assistant import CanvasAssistantSession, CanvasAssistantTurn
from app.models.llm import ModelCategoryKey
from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantHistory, CanvasAssistantMessage
from app.services.generation_canvas.store import CanvasStore
from app.services.llm.resolver import build_text_chat_model, get_default_model_by_category

logger = logging.getLogger(__name__)
MODEL_DEADLINE_SECONDS = 90
TURN_LEASE_SECONDS = 120


@wrap_model_call
async def text_only_assistant(request, handler):
    """Accept plain text from the configured model without granting framework tools."""
    response = await handler(request.override(tools=[], tool_choice=None))
    if any(message.tool_calls for message in response.result):
        raise HTTPException(502, 'Canvas assistant model returned an unexpected tool call')
    return response


class CanvasAssistant:
    """Load or append exchanges in a verified free or scene canvas."""

    def __init__(self, db: AsyncSession, project_id: str):
        self.db = db
        self.store = CanvasStore(db, project_id)

    async def _turns(self, canvas_id: str) -> list[CanvasAssistantTurn]:
        return list(await self.db.scalars(select(CanvasAssistantTurn).where(
            CanvasAssistantTurn.canvas_id == canvas_id,
        ).order_by(CanvasAssistantTurn.sequence)))

    async def history(self, canvas_id: str) -> CanvasAssistantHistory:
        """Read the current conversation without initializing a model or session."""
        await self.store.get(canvas_id)
        return CanvasAssistantHistory(turns=[
            CanvasAssistantExchange.model_validate(turn) for turn in await self._turns(canvas_id)
        ])

    async def _ensure_session(self, canvas_id: str) -> None:
        await self.store.get(canvas_id)
        if await self.db.get(CanvasAssistantSession, canvas_id) is None:
            await self.store.get(canvas_id, lock=True)
            if await self.db.get(CanvasAssistantSession, canvas_id) is None:
                self.db.add(CanvasAssistantSession(canvas_id=canvas_id))
            await self.db.commit()

    async def _lock_session(self, canvas_id: str) -> CanvasAssistantSession:
        if self.db.get_bind().dialect.name == 'sqlite':
            await self.db.execute(update(CanvasAssistantSession).where(
                CanvasAssistantSession.canvas_id == canvas_id,
            ).values(sequence=CanvasAssistantSession.sequence))
        session = await self.db.get(CanvasAssistantSession, canvas_id, with_for_update=True, populate_existing=True)
        if session is None:
            raise HTTPException(404, 'Canvas not found')
        return session

    async def send(self, canvas_id: str, command: CanvasAssistantMessage) -> CanvasAssistantExchange:
        """Append one ordered exchange, or replay a previously completed request."""
        await self._ensure_session(canvas_id)
        session = await self._lock_session(canvas_id)
        previous = await self.db.get(CanvasAssistantTurn, (canvas_id, command.request_id))
        if previous is not None:
            if previous.text != command.text:
                raise HTTPException(409, 'Request already used for a different assistant message')
            return CanvasAssistantExchange.model_validate(previous)

        now = datetime.now(UTC).replace(tzinfo=None)
        if session.pending_until is not None and session.pending_until > now:
            raise HTTPException(409, 'Canvas assistant is already replying')
        model = await get_default_model_by_category(self.db, ModelCategoryKey.text)
        model_id = model.id
        client = await build_text_chat_model(self.db, model_id=model_id, thinking=False)
        messages = []
        for turn in await self._turns(canvas_id):
            messages.extend([HumanMessage(content=turn.text), AIMessage(content=turn.reply)])
        messages.append(HumanMessage(content=command.text))

        token = uuid4().hex
        session.pending_token = token
        session.pending_until = now + timedelta(seconds=TURN_LEASE_SECONDS)
        # Keep database locks away from provider I/O. The short lease serializes
        # turns for this conversation and can expire after an interrupted process.
        await self.db.commit()
        try:
            reply = await self._reply(client, messages)
        except HTTPException:
            await self.db.execute(update(CanvasAssistantSession).where(
                CanvasAssistantSession.canvas_id == canvas_id, CanvasAssistantSession.pending_token == token,
            ).values(pending_token=None, pending_until=None))
            await self.db.commit()
            raise

        session = await self._lock_session(canvas_id)
        if session.pending_token != token:
            raise HTTPException(409, 'Canvas assistant reply lease expired')
        session.pending_token = session.pending_until = None
        session.sequence += 1
        turn = CanvasAssistantTurn(
            canvas_id=canvas_id, sequence=session.sequence, request_id=command.request_id,
            model_id=model_id, text=command.text, reply=reply,
        )
        self.db.add(turn)
        await self.db.flush()
        return CanvasAssistantExchange.model_validate(turn)

    @staticmethod
    async def _reply(client, messages) -> str:
        agent = create_deep_agent(
            model=client, middleware=[text_only_assistant],
            system_prompt='你是 Jellyfish 的画布助手。使用用户的语言回答影视创作问题。',
        )
        try:
            async with asyncio.timeout(MODEL_DEADLINE_SECONDS):
                state = await agent.ainvoke({'messages': messages})
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning('Canvas assistant model failed: %s', type(exc).__name__)
            raise HTTPException(502, 'Canvas assistant model failed to respond') from exc
        reply = state['messages'][-1].text.strip()
        if not reply:
            raise HTTPException(502, 'Canvas assistant model returned an empty response')
        return reply
