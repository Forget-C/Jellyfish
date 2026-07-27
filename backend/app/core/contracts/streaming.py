"""统一生成流式交付的版本化 SSE 事件契约。"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, model_validator


class StreamEventType(str, Enum):
    """固定 SSE 事件类型，供生成执行器和传输层共享。"""

    accepted = "accepted"
    delta = "delta"
    progress = "progress"
    completed = "completed"
    error = "error"
    cancelled = "cancelled"
    heartbeat = "heartbeat"


class StreamMessageData(BaseModel):
    """流式事件中使用的已持久化实验消息最小快照。"""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    role: Literal["user", "assistant"]
    content: str
    sequence: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime


class StreamGenerationResult(BaseModel):
    """完成事件携带的文本生成结果，避免以自由格式字典传递 Provider 输出。"""

    model_config = ConfigDict(extra="forbid")

    text: str
    model_id: str = Field(min_length=1)
    model_revision_id: str = Field(min_length=1)
    provider_request_id: str | None = None
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


class StreamErrorDetail(BaseModel):
    """流式运行失败时对调用方公开的稳定错误信息。"""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    retryable: bool = False


class StreamAcceptedData(BaseModel):
    """已创建隐藏流式运行和 canonical 用户消息后的首个业务事件数据。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    user_message: StreamMessageData


class StreamDeltaData(BaseModel):
    """模型增量文本事件数据。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    text_delta: str = Field(min_length=1)


class StreamProgressData(BaseModel):
    """执行进度事件数据。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    progress: int = Field(ge=0, le=100)


class StreamCompletedData(BaseModel):
    """成功发布 canonical 助手消息后的终态事件数据。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    assistant_message: StreamMessageData
    result: StreamGenerationResult

    @model_validator(mode="after")
    def require_assistant_message(self) -> "StreamCompletedData":
        """完成事件只能返回已发布的助手消息，防止错误消息被误展示为成功结果。"""
        if self.assistant_message.role != "assistant":
            raise ValueError("assistant_message.role must be assistant")
        return self


class StreamErrorData(BaseModel):
    """不可恢复或可重试失败的终态事件数据。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    error: StreamErrorDetail


class StreamCancelledData(BaseModel):
    """调用方或运行时取消后的终态事件数据。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    reason: str | None = None


class StreamHeartbeatData(BaseModel):
    """保持连接存活但不进入业务事件日志的心跳数据。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)


StreamEventData = (
    StreamAcceptedData
    | StreamDeltaData
    | StreamProgressData
    | StreamCompletedData
    | StreamErrorData
    | StreamCancelledData
    | StreamHeartbeatData
)


class GenerationStreamEvent(BaseModel):
    """单个版本化 SSE 事件，并强制 event 与 data 的一对一对应关系。"""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    event: StreamEventType
    sequence: int = Field(ge=1)
    created_at: datetime
    data: StreamEventData

    @model_validator(mode="before")
    @classmethod
    def parse_data_for_event(cls, value: object) -> object:
        """先由外层 event 选择 data 模型，消除仅含 task_id 的数据结构歧义。"""
        if not isinstance(value, dict):
            return value
        event = value.get("event")
        data = value.get("data")
        data_model_by_event: dict[str, type[BaseModel]] = {
            StreamEventType.accepted.value: StreamAcceptedData,
            StreamEventType.delta.value: StreamDeltaData,
            StreamEventType.progress.value: StreamProgressData,
            StreamEventType.completed.value: StreamCompletedData,
            StreamEventType.error.value: StreamErrorData,
            StreamEventType.cancelled.value: StreamCancelledData,
            StreamEventType.heartbeat.value: StreamHeartbeatData,
        }
        if isinstance(event, StreamEventType):
            event = event.value
        if isinstance(event, str) and event in data_model_by_event:
            try:
                parsed_data = data_model_by_event[event].model_validate(data)
            except ValueError as error:
                raise ValueError("event must match the corresponding data type") from error
            return {**value, "data": parsed_data}
        return value

    @model_validator(mode="after")
    def require_matching_event_data(self) -> "GenerationStreamEvent":
        """拒绝事件名与数据形状不一致的 payload，避免消费者猜测字段语义。"""
        expected_data_type: dict[StreamEventType, type[StreamEventData]] = {
            StreamEventType.accepted: StreamAcceptedData,
            StreamEventType.delta: StreamDeltaData,
            StreamEventType.progress: StreamProgressData,
            StreamEventType.completed: StreamCompletedData,
            StreamEventType.error: StreamErrorData,
            StreamEventType.cancelled: StreamCancelledData,
            StreamEventType.heartbeat: StreamHeartbeatData,
        }
        if not isinstance(self.data, expected_data_type[self.event]):
            raise ValueError("event must match the corresponding data type")
        return self


class GenerationStreamEventSequence(RootModel[list[GenerationStreamEvent]]):
    """校验一条业务流的固定 accepted、增量和单一终态事件顺序。"""

    @model_validator(mode="after")
    def require_valid_business_sequence(self) -> "GenerationStreamEventSequence":
        """保证业务事件单调递增，且只有 accepted 后的一个终态可以结束流。"""
        business_events = [event for event in self.root if event.event != StreamEventType.heartbeat]
        if not business_events:
            raise ValueError("a stream must contain business events")
        if business_events[0].event != StreamEventType.accepted:
            raise ValueError("the first business event must be accepted")

        terminal_events = {StreamEventType.completed, StreamEventType.error, StreamEventType.cancelled}
        previous_sequence = 0
        terminal_index: int | None = None
        for index, event in enumerate(business_events):
            if event.sequence <= previous_sequence:
                raise ValueError("business event sequences must be strictly increasing")
            previous_sequence = event.sequence
            if event.event in terminal_events:
                if terminal_index is not None:
                    raise ValueError("a stream can contain only one terminal event")
                terminal_index = index

        if terminal_index is None:
            raise ValueError("a stream must end with a terminal event")
        if terminal_index != len(business_events) - 1:
            raise ValueError("no business events are allowed after a terminal event")
        return self
