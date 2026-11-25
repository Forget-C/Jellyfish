"""Commands and snapshot served by the laboratory chat profile."""
from pydantic import BaseModel, Field

from app.schemas.interaction import InteractionSnapshot
from app.schemas.studio.experiment_sessions import ExperimentMessageRead


class LabModels(BaseModel):
    text: str | None = None
    image: str | None = None
    video: str | None = None


class LabChatCommand(BaseModel):
    request_id: str = Field(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    text: str = Field(min_length=1)
    file_ids: list[str] = Field(default_factory=list)


class LabChatSnapshot(InteractionSnapshot):
    active_turn: str | None
    models: LabModels
    messages: list[ExperimentMessageRead]
    partial_reply: str = ''
