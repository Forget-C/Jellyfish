"""文本/Agent 生成的进程内流式事件运行时。

该组件只维护某次隐藏流式运行的短生命周期状态和可重放事件。持久化的
``GenerationTask``、实验消息和 HTTP/SSE 编码仍由调用方负责；这样运行时可被
文本实验室与 Agent 编排共同复用，也不会把传输协议耦合进业务服务。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum

from app.core.contracts.streaming import (
    GenerationStreamEvent,
    StreamAcceptedData,
    StreamCancelledData,
    StreamCompletedData,
    StreamDeltaData,
    StreamErrorData,
    StreamEventData,
    StreamEventType,
    StreamProgressData,
)


class TextStreamRunState(str, Enum):
    """隐藏文本流式运行的内部状态，终态与 SSE 终态一一对应。"""

    streaming = "streaming"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class TextStreamRunNotFoundError(KeyError):
    """请求了当前进程中不存在的流式运行。"""


class TextStreamRunStateError(RuntimeError):
    """尝试在终态后继续写入，或重复创建同一个运行。"""


@dataclass
class _TextStreamRun:
    """单个流式运行的事件日志和订阅协调原语。"""

    task_id: str
    events: list[GenerationStreamEvent] = field(default_factory=list)
    state: TextStreamRunState = TextStreamRunState.streaming
    cancel_requested: bool = False
    cancel_reason: str | None = None
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)

    @property
    def is_terminal(self) -> bool:
        """返回运行是否已发出唯一的业务终态事件。"""
        return self.state != TextStreamRunState.streaming


class TextStreamingRuntime:
    """协调隐藏文本运行、递增 SSE id 和断线后的事件重放。

    ``GenerationStreamEvent.sequence`` 就是 SSE ``id``：每次写入均由运行时按
    日志长度生成，调用方不能自行指定，因此重放和实时订阅共享同一单调序列。
    该对象是进程内运行时；多进程部署时应由上层将事件镜像到共享存储。
    """

    def __init__(self) -> None:
        """初始化空运行注册表，注册表锁只保护运行对象的创建与查询。"""
        self._runs: dict[str, _TextStreamRun] = {}
        self._runs_lock = asyncio.Lock()

    async def create_run(self, data: StreamAcceptedData) -> GenerationStreamEvent:
        """创建隐藏运行并原子写入 sequence=1 的 accepted 事件。"""
        async with self._runs_lock:
            if data.task_id in self._runs:
                raise TextStreamRunStateError(f"text stream run already exists: {data.task_id}")
            run = _TextStreamRun(task_id=data.task_id)
            self._runs[data.task_id] = run
        return await self._append(run, StreamEventType.accepted, data)

    async def emit_delta(self, task_id: str, data: StreamDeltaData) -> GenerationStreamEvent:
        """追加模型文本增量；数据所属 task 必须与运行一致。"""
        return await self._append_for_task(task_id, StreamEventType.delta, data)

    async def emit_progress(self, task_id: str, data: StreamProgressData) -> GenerationStreamEvent:
        """追加非终态进度事件，进度数值由契约层限制在 0 到 100。"""
        return await self._append_for_task(task_id, StreamEventType.progress, data)

    async def complete(self, task_id: str, data: StreamCompletedData) -> GenerationStreamEvent:
        """写入成功终态；成功前若已收到取消请求则拒绝错误终结。"""
        run = await self._get_run(task_id)
        async with run.condition:
            if run.cancel_requested:
                raise TextStreamRunStateError("a cancellation was requested; complete is not allowed")
        return await self._append_for_task(task_id, StreamEventType.completed, data)

    async def fail(self, task_id: str, data: StreamErrorData) -> GenerationStreamEvent:
        """写入错误终态；失败详情必须采用稳定的公开错误结构。"""
        return await self._append_for_task(task_id, StreamEventType.error, data)

    async def request_cancel(self, task_id: str, reason: str | None = None) -> bool:
        """标记取消请求并唤醒订阅者，实际终态由执行器调用 ``cancel`` 写入。

        返回 ``False`` 表示运行已经结束，不得再改变其结果。
        """
        run = await self._get_run(task_id)
        async with run.condition:
            if run.is_terminal:
                return False
            run.cancel_requested = True
            run.cancel_reason = reason
            run.condition.notify_all()
            return True

    async def is_cancel_requested(self, task_id: str) -> bool:
        """供长时间运行的 Provider/Agent 循环在安全边界检查取消标记。"""
        run = await self._get_run(task_id)
        async with run.condition:
            return run.cancel_requested

    async def cancel(self, task_id: str, reason: str | None = None) -> GenerationStreamEvent:
        """写入取消终态，并保留先前取消请求中记录的原因。"""
        run = await self._get_run(task_id)
        async with run.condition:
            if not run.cancel_requested:
                run.cancel_requested = True
                run.cancel_reason = reason
            resolved_reason = reason if reason is not None else run.cancel_reason
        return await self._append_for_task(
            task_id,
            StreamEventType.cancelled,
            StreamCancelledData(task_id=task_id, reason=resolved_reason),
        )

    async def replay(self, task_id: str, *, after_event_id: int = 0) -> tuple[GenerationStreamEvent, ...]:
        """返回指定 SSE id 之后的事件快照，供断线客户端可靠续传。"""
        if after_event_id < 0:
            raise ValueError("after_event_id must be greater than or equal to zero")
        run = await self._get_run(task_id)
        async with run.condition:
            return tuple(event for event in run.events if event.sequence > after_event_id)

    async def subscribe(self, task_id: str, *, after_event_id: int = 0) -> AsyncIterator[GenerationStreamEvent]:
        """持续订阅事件日志；先重放，再等待新事件，终态发送后自动结束。"""
        if after_event_id < 0:
            raise ValueError("after_event_id must be greater than or equal to zero")
        run = await self._get_run(task_id)
        next_event_id = after_event_id
        while True:
            async with run.condition:
                pending = [event for event in run.events if event.sequence > next_event_id]
                if not pending and not run.is_terminal:
                    await run.condition.wait()
                    continue
                terminal = run.is_terminal
            for event in pending:
                next_event_id = event.sequence
                yield event
            if terminal:
                return

    async def state_of(self, task_id: str) -> TextStreamRunState:
        """读取当前运行状态，供路由决定是否允许再次连接或取消。"""
        run = await self._get_run(task_id)
        async with run.condition:
            return run.state

    async def _append_for_task(
        self,
        task_id: str,
        event_type: StreamEventType,
        data: StreamEventData,
    ) -> GenerationStreamEvent:
        """查找运行并验证 data.task_id 后追加对应 SSE 事件。"""
        if data.task_id != task_id:
            raise ValueError("stream event task_id must match the stream run")
        return await self._append(await self._get_run(task_id), event_type, data)

    async def _append(
        self,
        run: _TextStreamRun,
        event_type: StreamEventType,
        data: StreamEventData,
    ) -> GenerationStreamEvent:
        """按唯一状态机写入事件，并通知所有等待中的订阅者。"""
        async with run.condition:
            if run.is_terminal:
                raise TextStreamRunStateError("cannot append an event after the stream has terminated")
            if event_type == StreamEventType.accepted and run.events:
                raise TextStreamRunStateError("accepted can only be emitted once")
            if event_type != StreamEventType.accepted and not run.events:
                raise TextStreamRunStateError("accepted must be emitted before other business events")

            event = GenerationStreamEvent(
                event=event_type,
                sequence=len(run.events) + 1,
                created_at=datetime.now(UTC),
                data=data,
            )
            run.events.append(event)
            run.state = _state_after(event_type)
            run.condition.notify_all()
            return event

    async def _get_run(self, task_id: str) -> _TextStreamRun:
        """安全读取运行对象，避免调用方将不存在的 task 误当成可订阅流。"""
        async with self._runs_lock:
            run = self._runs.get(task_id)
        if run is None:
            raise TextStreamRunNotFoundError(f"text stream run does not exist: {task_id}")
        return run


def _state_after(event_type: StreamEventType) -> TextStreamRunState:
    """将唯一 SSE 终态映射为内部运行状态，其他事件保持 streaming。"""
    if event_type == StreamEventType.completed:
        return TextStreamRunState.completed
    if event_type == StreamEventType.error:
        return TextStreamRunState.failed
    if event_type == StreamEventType.cancelled:
        return TextStreamRunState.cancelled
    return TextStreamRunState.streaming
