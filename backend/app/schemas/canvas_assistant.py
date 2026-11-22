"""Public request and history contracts for the canvas assistant."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints


class CanvasAssistantMessage(BaseModel):
    """Send a turn with a stable request identity for retries."""

    request_id: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]


class CanvasAssistantExchange(CanvasAssistantMessage):
    """A completed turn in the order visible to the user."""

    model_config = ConfigDict(from_attributes=True)

    sequence: int
    model_id: str
    reply: str


class CanvasAssistantHistory(BaseModel):
    """Persisted exchanges for the selected canvas."""

    turns: list[CanvasAssistantExchange]
