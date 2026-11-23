"""Registered creative delegation requests and result receipts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.canvas_assistant_generation import CanvasAssistantSkillUse
from app.schemas.canvas_assistant_media import CanvasAssistantAttachment

Role = Literal['storyboard-design', 'footage-continuity-review']


class CanvasDelegatedTask(BaseModel):
    """One bounded task assigned to an allowed creative role."""

    model_config = ConfigDict(extra='forbid')
    id: Annotated[str, StringConstraints(min_length=1, max_length=40, pattern=r'^[A-Za-z0-9_-]+$')]
    role: Role
    task: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
    card_ids: list[str] = Field(default_factory=list, max_length=10)
    depends_on: list[str] = Field(default_factory=list, max_length=3)


CanvasDelegationBatch = Annotated[list[CanvasDelegatedTask], Field(min_length=1, max_length=4)]


class CanvasAssistantSubtask(BaseModel):
    """A read-only specialist result with its actual scope and evidence."""

    id: str
    role: Role
    task: str
    card_ids: list[str]
    model_id: str
    status: Literal['completed', 'failed', 'blocked']
    skills: list[CanvasAssistantSkillUse]
    evidence: list[CanvasAssistantAttachment]
    result: str


class TextDelegationResponse(BaseModel):
    """Tool-free models request delegation using the same typed task contract."""

    model_config = ConfigDict(extra='forbid')
    delegations: CanvasDelegationBatch
