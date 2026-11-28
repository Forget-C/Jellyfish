"""普通后端调用方使用的画布生命周期与能力查询协议。"""

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.canvas_catalog import CanvasCatalog
from app.core.contracts.directing.scene_canvas import SceneCanvasCreate, SceneCanvasesRead
from app.schemas.generation_canvas import CanvasCreate, CanvasModelCapability, CanvasRead, CanvasSummary
from app.services.generation_canvas.store import CanvasStore


class CanvasLifecycle(Protocol):
    """在已授权的项目或自由画布范围内操作，由调用方管理事务。"""

    async def ensure_access(self, canvas_id: str) -> None:
        """Check existence, kind and scope without loading the document for use."""
        ...

    async def read(self, canvas_id: str) -> CanvasRead:
        """读取对应文档及其修订。"""
        ...

    async def delete(self, canvas_id: str, *, expected_revision: int) -> None:
        """只删除指定修订，且画布当前没有活动任务。"""
        ...

    async def catalog(self, canvas_id: str) -> CanvasCatalog:
        """按真实画布归属读取可用卡片和连接策略。"""
        ...

    async def model_capability(self, canvas_id: str, model_id: str) -> CanvasModelCapability:
        """在画布范围中核实模型能力。"""
        ...


class FreeCanvasLifecycle(CanvasLifecycle, Protocol):
    """自由画布的摘要、创建、草稿读取和重命名。"""

    async def summaries(self, *, q: str, page: int, page_size: int) -> tuple[list[CanvasSummary], int]:
        ...

    async def create_free(self, command: CanvasCreate) -> CanvasRead:
        ...

    async def read_free_draft(self, canvas_id: str) -> CanvasRead:
        """修订 -1 表示草稿尚未创建。"""
        ...

    async def rename(self, canvas_id: str, name: str, expected_revision: int) -> CanvasRead:
        ...


class SceneCanvasLifecycle(Protocol):
    """从已确认的场次原文建立分镜画布，按所属场次列出画布。"""

    async def read_canvases(self, chapter_id: str, sequence_id: str) -> SceneCanvasesRead:
        ...

    async def create_canvas(self, chapter_id: str, sequence_id: str, body: SceneCanvasCreate) -> CanvasRead:
        ...


def canvas_lifecycle(db: AsyncSession, project_id: str | None) -> CanvasLifecycle:
    """用调用方已授权的项目绑定协议，缺省代表自由画布空间。"""
    return CanvasStore(db, project_id)


def free_canvas_lifecycle(db: AsyncSession) -> FreeCanvasLifecycle:
    """绑定自由画布空间，禁止从该入口操作分镜画布。"""
    return CanvasStore(db, None)


def scene_canvas_lifecycle(db: AsyncSession, project_id: str) -> SceneCanvasLifecycle:
    """绑定已授权项目的分镜画布准备入口。"""
    from app.services.directing.scene_canvas import SceneCanvasService

    return SceneCanvasService(db, project_id)
