"""Wire contracts shared by every chat session."""
from typing import Annotated, Literal

from pydantic import BaseModel, Field, RootModel

from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantQueueItem
from app.schemas.interaction import InteractionEvent
from app.schemas.media_task import MediaTaskReceipt
from app.schemas.studio.experiment_sessions import ExperimentMessageRead
from app.schemas.studio.lab_chat import ArtifactAnswer, ArtifactQuestion


class ChatTurnReceipt(BaseModel):
    session_id: str
    turn_id: str
    cursor: int = Field(ge=0, description="Subscribe after this cursor to replay the submitted turn.")


class ReplyUpdate(BaseModel):
    text: str
    mode: Literal['append', 'replace']


class ToolUpdate(BaseModel):
    tool_call_id: str
    tool: str
    state: Literal['started', 'completed', 'failed']
    parameters: dict
    model_id: str | None
    error: str | None


class TurnUpdate(BaseModel):
    text: str
    error: str | None
    reason: str | None
    error_code: str | None = None
    message: ExperimentMessageRead | None = None


class TaskUpdate(MediaTaskReceipt):
    tool_call_id: str | None = None
    messages: list[ExperimentMessageRead] | None = None


class ChatMessageEvent(InteractionEvent[ReplyUpdate]):
    category: Literal['message']
    type: Literal['message.updated']
    detail: CanvasAssistantExchange | None = None


class ChatToolEvent(InteractionEvent[ToolUpdate]):
    category: Literal['tool']
    type: Literal['tool.started', 'tool.completed', 'tool.failed']
    detail: CanvasAssistantExchange | None = None


class ChatTurnEvent(InteractionEvent[TurnUpdate]):
    category: Literal['turn']
    type: Literal['turn.accepted', 'turn.completed', 'turn.failed', 'turn.stopped']
    detail: CanvasAssistantExchange | None = None


class ChatTaskEvent(InteractionEvent[TaskUpdate]):
    category: Literal['task']
    type: Literal['task.accepted', 'task.progress', 'task.completed', 'task.cancelled', 'task.failed', 'artifact.created']
    detail: None = None


class ChatSceneEvent(InteractionEvent[None]):
    category: Literal['scene']
    detail: CanvasAssistantExchange | CanvasAssistantQueueItem | ArtifactQuestion | ArtifactAnswer


class ChatEvent(RootModel[Annotated[
    ChatMessageEvent | ChatToolEvent | ChatTurnEvent | ChatTaskEvent | ChatSceneEvent,
    Field(discriminator='category'),
]]):
    """One JSON event per SSE data frame; category determines the typed payload."""
