"""Public task receipt shared by media trials and chat tools."""
from typing import Literal

from pydantic import BaseModel, Field

from app.core.contracts.task import TaskStatus
from app.schemas.task import RemoteCancellationStatus


class MediaReferenceRead(BaseModel):
    """Stable file reference bound to an input position."""
    role: str
    ordinal: int
    file_id: str


class MediaArtifactRead(BaseModel):
    """An archived output can be identified after reconnecting."""
    file_id: str
    ordinal: int
    media_type: Literal['image', 'video', 'audio']
    deleted: bool


class MediaTaskReceipt(BaseModel):
    """Allowlisted execution evidence; private provider configuration stays server-side."""
    task_id: str
    model_id: str | None
    model_name: str | None
    parameters: dict = Field(default_factory=dict)
    references: list[MediaReferenceRead] = Field(default_factory=list)
    artifacts: list[MediaArtifactRead] = Field(default_factory=list)
    status: TaskStatus
    progress: int | None
    stage: str
    error: str
    cancel_requested: bool
    remote_cancellation: RemoteCancellationStatus | None
    accepted_at_ms: int | None = None
    finished_at_ms: int | None = None
    execution_prompt: str | None = None
