"""普通后端调用方使用的画布生成输入协议。"""

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.scene_storyboard import StoryboardBasis, StoryboardRetryBasis
from app.schemas.canvas_checks import CanvasCheckPreview, CanvasCheckProduct, CanvasPostCheckPreview
from app.schemas.generation_canvas import (
    CanvasCompiledInput, CanvasDocument, CanvasPrecheck, CanvasPrecheckRequest, CanvasVideoFrameRequest, ImageContentCard,
)
from app.services.generation_canvas.checks import CanvasChecks
from app.services.generation_canvas.post_checks import CanvasPostChecks
from app.services.generation_canvas.runtime import CanvasRuntime
from app.services.generation_canvas.store import CanvasStore
from app.services.generation_canvas.video_frames import CanvasVideoFrames


class CanvasGenerationInputs(Protocol):
    """核对已保存卡片实际采用的输入。调用方提供已授权范围并管理事务。"""

    async def compile_input(self, canvas_id: str, card_id: str) -> CanvasCompiledInput:
        """返回实际正文、媒体和诊断，不创建生成任务。"""
        ...

    async def compile_document(self, document: CanvasDocument, card_id: str, *,
                               draft: bool = False, expected_revision: int | None = None) -> CanvasCompiledInput:
        """仅编译调用方核对过的已保存或预演工作文档。"""
        ...

    async def precheck(self, canvas_id: str, command: CanvasPrecheckRequest) -> CanvasPrecheck:
        """校验单卡运行依据，可生成预检凭据，不提交运行。"""
        ...

    async def prepare_video_frame(self, canvas_id: str, command: CanvasVideoFrameRequest) -> ImageContentCard:
        """为指定参考帧准备素材，是否采用由画布编辑决定。"""
        ...

    async def preview_check(self, canvas_id: str, card_id: str) -> CanvasCheckPreview:
        """读取生成前检查依据与可选项目。"""
        ...

    async def check_products(self, canvas_id: str, card_id: str) -> list[CanvasCheckProduct]:
        """查询适用于选定检查的已保留产出。"""
        ...

    async def preview_post_check(
        self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int,
    ) -> CanvasPostCheckPreview:
        """核对固定产出的生成后检查依据。"""
        ...


class StoryboardGenerationInputs(Protocol):
    """使用场次业务规则，检查分镜提取及重试输入。"""

    async def read_storyboard_basis(self, chapter_id: str, sequence_id: str) -> StoryboardBasis:
        """读取当前场次分镜提取依据。"""
        ...

    async def read_storyboard_retry_basis(self, chapter_id: str, sequence_id: str, task_id: str) -> StoryboardRetryBasis:
        """检查指定旧任务的重试依据。"""
        ...


class _ScopedGenerationInputs:
    def __init__(self, db: AsyncSession, project_id: str | None):
        self.db, self.project_id = db, project_id

    async def compile_input(self, canvas_id: str, card_id: str) -> CanvasCompiledInput:
        return await CanvasStore(self.db, self.project_id).compile_input(canvas_id, card_id)

    async def compile_document(self, document: CanvasDocument, card_id: str, *,
                               draft: bool = False, expected_revision: int | None = None) -> CanvasCompiledInput:
        return await CanvasStore(self.db, self.project_id).compile_document(
            document, card_id, draft=draft, expected_revision=expected_revision,
        )

    async def precheck(self, canvas_id: str, command: CanvasPrecheckRequest) -> CanvasPrecheck:
        return await CanvasRuntime(self.db, self.project_id).precheck(canvas_id, command)

    async def prepare_video_frame(self, canvas_id: str, command: CanvasVideoFrameRequest) -> ImageContentCard:
        return await CanvasVideoFrames(self.db, self.project_id).prepare(canvas_id, command)

    async def preview_check(self, canvas_id: str, card_id: str) -> CanvasCheckPreview:
        return await CanvasChecks(self.db, self.project_id).preview(canvas_id, card_id)

    async def check_products(self, canvas_id: str, card_id: str) -> list[CanvasCheckProduct]:
        return await CanvasPostChecks(self.db, self.project_id).products(canvas_id, card_id)

    async def preview_post_check(
        self, canvas_id: str, card_id: str, run_id: str, node_id: str, position: int,
    ) -> CanvasPostCheckPreview:
        return await CanvasPostChecks(self.db, self.project_id).preview(canvas_id, card_id, run_id, node_id, position)


def canvas_generation_inputs(db: AsyncSession, project_id: str | None) -> CanvasGenerationInputs:
    """绑定已授权的项目，项目为空时从自由画布范围查询。"""
    return _ScopedGenerationInputs(db, project_id or None)


def storyboard_generation_inputs(db: AsyncSession, project_id: str) -> StoryboardGenerationInputs:
    """绑定调用方已授权的项目，场次和来源准入由分镜领域核实。"""
    from app.services.directing.scene_storyboard import SceneStoryboardService

    return SceneStoryboardService(db, project_id)
