"""供普通后端调用方使用的运行、检查与成果协议。"""

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.scene_storyboard import (
    StoryboardCheckRequest, StoryboardReextractRequest, StoryboardRequest, StoryboardRetry,
    StoryboardTaskRead, StoryboardTaskSummary,
)
from app.schemas.canvas_checks import CanvasCheckRecheckRequest, CanvasCheckReportRead, CanvasCheckRequest, CanvasPostCheckRequest
from app.schemas.generation_canvas import (
    CanvasCardOutputs, CanvasRunAccepted, CanvasRunRead, CanvasRunSubmit, CanvasRuntimeEvent, CanvasSnapshot,
    ImageContentCard, TextContentCard, VideoContentCard,
)
from app.services.generation_canvas.check_rechecks import CanvasCheckRechecks
from app.services.generation_canvas.checks import CanvasChecks
from app.services.generation_canvas.historical_content import CanvasHistoricalContent
from app.services.generation_canvas.post_checks import CanvasPostChecks
from app.services.generation_canvas.runtime import CanvasRuntime
from app.services.generation_canvas.store import CanvasStore


class CanvasRuns(Protocol):
    """单卡受理与已提交结果。调用方管理事务和已授权资源作用域。"""

    async def submit(self, canvas_id: str, command: CanvasRunSubmit) -> CanvasRunAccepted:
        """使用已核对的预检凭据受理单卡并记录回执。"""
        ...

    async def read_receipt(self, canvas_id: str, request_id: str) -> CanvasRunAccepted | None:
        """由原请求标识查询回执，即使预检凭据已过期。"""
        ...

    async def read_task_run(self, canvas_id: str, task_id: str) -> CanvasRunRead | None:
        """由任务标识读取所属运行与节点状态。"""
        ...

    async def snapshot(self, canvas_id: str) -> CanvasSnapshot:
        """读取包含结果和恢复游标的一致切点。"""
        ...

    async def read_events(self, canvas_id: str, cursor: int | None = None) -> list[CanvasRuntimeEvent]:
        """读取事件或新的快照切点。调用方应立即结束读事务。"""
        ...

    async def cancel(self, canvas_id: str, run_id: str, node_id: str | None = None) -> CanvasRunRead:
        """显式请求取消指定运行或节点。"""
        ...

    async def card_outputs(self, canvas_id: str, card_id: str) -> CanvasCardOutputs:
        """查询当前成果及直接候选。"""
        ...

    async def prepare_output_content(
        self, canvas_id: str, run_id: str, node_id: str, position: int,
    ) -> TextContentCard | ImageContentCard | VideoContentCard:
        """以固定运行的成果准备独立内容卡，由编辑方决定保存。"""
        ...


class CanvasCheckRuns(Protocol):
    """在画布当前生成依据或历史成果上明确执行检查。"""

    async def run_check(self, canvas_id: str, card_id: str, body: CanvasCheckRequest) -> CanvasCheckReportRead:
        ...

    async def run_post_check(
        self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int, body: CanvasPostCheckRequest,
    ) -> CanvasCheckReportRead:
        ...

    async def reports(self, canvas_id: str, card_id: str) -> list[CanvasCheckReportRead]:
        ...

    async def archived_reports(self, canvas_id: str) -> list[CanvasCheckReportRead]:
        ...

    async def cancel_check(self, canvas_id: str, card_id: str, report_id: str) -> CanvasCheckReportRead:
        ...

    async def recheck(
        self, canvas_id: str, card_id: str, report_id: str, body: CanvasCheckRecheckRequest,
    ) -> CanvasCheckReportRead:
        ...


class StoryboardRuns(Protocol):
    """场次业务对分镜提取、候选和连续性检查的运行入口。"""

    async def submit_storyboard(self, chapter_id: str, sequence_id: str, body: StoryboardRequest) -> StoryboardTaskRead:
        ...

    async def reextract_storyboard(
        self, chapter_id: str, sequence_id: str, canvas_id: str, body: StoryboardReextractRequest,
    ) -> StoryboardTaskRead:
        ...

    async def retry_storyboard(
        self, chapter_id: str, sequence_id: str, task_id: str, body: StoryboardRetry,
    ) -> StoryboardTaskRead:
        ...

    async def list_storyboards(
        self, chapter_id: str, sequence_id: str, canvas_id: str | None = None,
    ) -> list[StoryboardTaskSummary]:
        ...

    async def read_storyboard(self, chapter_id: str, sequence_id: str, task_id: str) -> StoryboardTaskRead:
        ...

    async def read_canvas_candidate(
        self, chapter_id: str, sequence_id: str, canvas_id: str, task_id: str | None = None,
    ) -> StoryboardTaskRead | None:
        ...

    async def saved_check(
        self, chapter_id: str, sequence_id: str, canvas_id: str, body: StoryboardCheckRequest | None = None,
    ) -> StoryboardTaskRead | None:
        ...


class _ScopedCanvasRuns:
    def __init__(self, db: AsyncSession, project_id: str | None):
        self.runtime = CanvasRuntime(db, project_id)
        self.store = CanvasStore(db, project_id)
        self.history = CanvasHistoricalContent(db, project_id)

    async def submit(self, canvas_id: str, command: CanvasRunSubmit) -> CanvasRunAccepted:
        return CanvasRunAccepted.model_validate(await self.runtime.submit(canvas_id, command))

    async def read_receipt(self, canvas_id: str, request_id: str) -> CanvasRunAccepted | None:
        return await self.runtime.read_receipt(canvas_id, request_id)

    async def read_task_run(self, canvas_id: str, task_id: str) -> CanvasRunRead | None:
        return await self.runtime.read_task_run(canvas_id, task_id)

    async def snapshot(self, canvas_id: str) -> CanvasSnapshot:
        return await self.runtime.snapshot(canvas_id)

    async def read_events(self, canvas_id: str, cursor: int | None = None) -> list[CanvasRuntimeEvent]:
        return await self.runtime.read_events(canvas_id, cursor)

    async def cancel(self, canvas_id: str, run_id: str, node_id: str | None = None) -> CanvasRunRead:
        return await self.runtime.cancel(canvas_id, run_id, node_id)

    async def card_outputs(self, canvas_id: str, card_id: str) -> CanvasCardOutputs:
        return await self.store.card_outputs(canvas_id, card_id)

    async def prepare_output_content(
        self, canvas_id: str, run_id: str, node_id: str, position: int,
    ) -> TextContentCard | ImageContentCard | VideoContentCard:
        return await self.history.prepare_content(canvas_id, run_id, node_id, position)


class _ScopedCanvasCheckRuns:
    def __init__(self, db: AsyncSession, project_id: str | None):
        self.checks = CanvasChecks(db, project_id)
        self.post_checks = CanvasPostChecks(db, project_id)
        self.rechecks = CanvasCheckRechecks(db, project_id)

    async def run_check(self, canvas_id: str, card_id: str, body: CanvasCheckRequest) -> CanvasCheckReportRead:
        return await self.checks.run(canvas_id, card_id, body)

    async def run_post_check(
        self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int, body: CanvasPostCheckRequest,
    ) -> CanvasCheckReportRead:
        return await self.post_checks.run(canvas_id, card_id, run_id, node_id, position, body)

    async def reports(self, canvas_id: str, card_id: str) -> list[CanvasCheckReportRead]:
        return await self.checks.reports(canvas_id, card_id)

    async def archived_reports(self, canvas_id: str) -> list[CanvasCheckReportRead]:
        return await self.checks.archived_reports(canvas_id)

    async def cancel_check(self, canvas_id: str, card_id: str, report_id: str) -> CanvasCheckReportRead:
        return await self.checks.cancel(canvas_id, card_id, report_id)

    async def recheck(
        self, canvas_id: str, card_id: str, report_id: str, body: CanvasCheckRecheckRequest,
    ) -> CanvasCheckReportRead:
        return await self.rechecks.run(canvas_id, card_id, report_id, body)


def canvas_runs(db: AsyncSession, project_id: str | None) -> CanvasRuns:
    """使用调用方已授权的项目，空项目表示自由画布。"""
    return _ScopedCanvasRuns(db, project_id or None)


def canvas_check_runs(db: AsyncSession, project_id: str | None) -> CanvasCheckRuns:
    """使用当前范围与检查卡的既有准入规则。"""
    return _ScopedCanvasCheckRuns(db, project_id or None)


def storyboard_runs(db: AsyncSession, project_id: str) -> StoryboardRuns:
    """沿用场次服务核对项目、场次与候选归属。"""
    from app.services.directing.scene_storyboard import SceneStoryboardService

    return SceneStoryboardService(db, project_id)
