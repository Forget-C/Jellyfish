"""Shared HTTP and event identities for interactive sessions."""

from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar

from fastapi import Header
from pydantic import BaseModel, Field

InteractionRequestHeader = Annotated[str | None, Header(
    alias='Idempotency-Key', min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$',
)]
Payload = TypeVar('Payload')


class InteractionSnapshot(BaseModel):
    """Session identity, available operations and the latest replay cursor."""

    session_id: str
    cursor: int
    capabilities: tuple[str, ...]


class InteractionEvent(BaseModel, Generic[Payload]):
    """A committed interaction update with resume and deduplication identities."""

    session_id: str
    turn_id: str | None
    cursor: int
    type: str
    payload: Payload
    occurred_at: datetime | None = None
    target_version: str | None = None
    group_ids: list[str] | None = None
    subject: str | None = None


class ChatToolCall(BaseModel):
    """Public identity and lifecycle of a tool chosen by the main chat model."""

    id: str
    name: str
    state: Literal['started', 'completed', 'failed']
    parameters: dict[str, int | str] = Field(default_factory=dict)
