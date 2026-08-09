"""把渲染尝试与产物投影为 API 视图（只读，不写库）。

设计要点：
- **不新增数据库列**：任务状态/进度/错误全部来自任务中心的 ``generation_tasks``，
  通过 ``GenerationTaskLink(relation_type="cas_shot_render")`` 关联到生产镜头；
- **确定性选取**：同一镜头可能有多次重试链接，按 ``created_at DESC, id DESC``
  取最近一次，保证刷新页面得到稳定结果；
- **安全**：只回传已在写入阶段脱敏过的错误文案，绝不回传堆栈、凭据或供应商响应体。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto_animal_studio.application.render_tasks import CAS_SHOT_RENDER_RELATION_TYPE
from app.crypto_animal_studio.schemas.production import ProductionArtifactView, RenderTaskView
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink

#: 终态集合：前端据此停止轮询。
TERMINAL_TASK_STATUSES: frozenset[str] = frozenset({"succeeded", "failed", "cancelled"})

#: 进度 → 阶段文案。与 run_cas_shot_render_task 的进度阶梯一致。
_STAGE_MESSAGES: tuple[tuple[int, str], ...] = (
    (100, "Completed"),
    (80, "Downloading generated video"),
    (20, "Submitted to render provider"),
    (5, "Worker started"),
    (0, "Queued"),
)


def _status_value(row: Any) -> str:
    """把 ORM 枚举/字符串统一为字符串。"""
    status = getattr(row, "status", "")
    return status.value if hasattr(status, "value") else str(status or "")


def stage_message_for(status: str, progress: int | None) -> str:
    """由状态与进度推导安全的阶段文案。"""
    if status == "failed":
        return "Failed"
    if status == "cancelled":
        return "Cancelled"
    if status in {"pending", ""}:
        return "Queued"
    for threshold, message in _STAGE_MESSAGES:
        if (progress or 0) >= threshold:
            return message
    return "Queued"


async def latest_render_task(
    db: AsyncSession, *, production_shot_id: str
) -> GenerationTask | None:
    """取该生产镜头最近一次渲染尝试。

    排序依据是 ``GenerationTaskLink.id``（自增整数）而**不是**
    ``GenerationTask.created_at`` + UUID：同一秒内创建的两次尝试时间戳会相同，
    而 ``GenerationTask.id`` 是随机 UUID，用它做次级排序会稳定但**错误**地选中
    较早的尝试（由端到端重试测试发现）。自增链接 ID 单调反映插入顺序，
    因此既确定又正确。
    """
    stmt = (
        select(GenerationTask)
        .join(GenerationTaskLink, GenerationTaskLink.task_id == GenerationTask.id)
        .where(
            GenerationTaskLink.relation_type == CAS_SHOT_RENDER_RELATION_TYPE,
            GenerationTaskLink.relation_entity_id == production_shot_id,
        )
        .order_by(GenerationTaskLink.id.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


def build_render_task_view(task: GenerationTask | None) -> RenderTaskView | None:
    """把任务行投影为视图；无尝试时返回 None。"""
    if task is None:
        return None
    status = _status_value(task)
    progress = getattr(task, "progress", None)
    result = getattr(task, "result", None) or {}
    error = (getattr(task, "error", "") or "").strip()
    return RenderTaskView(
        task_id=task.id,
        status=status,
        progress=progress if isinstance(progress, int) else None,
        stage_message=stage_message_for(status, progress if isinstance(progress, int) else None),
        provider_task_id=str(result.get("provider_job_id") or "") or None,
        error_reason=error or None,
        attempt=result.get("attempt") if isinstance(result.get("attempt"), int) else None,
        is_terminal=status in TERMINAL_TASK_STATUSES,
    )


def build_artifact_view(artifact: Any) -> ProductionArtifactView:
    """把产物行投影为视图，并补上前端播放所需的安全字段。

    ``download_url`` 复用既有受控端点 ``/api/v1/studio/files/{file_id}/download``，
    不新开公开静态路由，也不回传对象存储的私有绝对路径。
    """
    metadata = getattr(artifact, "metadata_json", None) or {}
    file_id = str(metadata.get("file_id") or "") or None
    size = metadata.get("size_bytes")
    return ProductionArtifactView(
        id=artifact.id,
        production_shot_id=artifact.production_shot_id,
        artifact_type=artifact.artifact_type,
        stage=artifact.stage,
        provider=artifact.provider,
        provider_model=artifact.provider_model,
        file_path=artifact.file_path,
        mime_type=artifact.mime_type,
        checksum=artifact.checksum,
        file_id=file_id,
        size_bytes=size if isinstance(size, int) else None,
        download_url=f"/api/v1/studio/files/{file_id}/download" if file_id else None,
        provider_job_id=str(metadata.get("provider_job_id") or "") or None,
        attempt=metadata.get("attempt") if isinstance(metadata.get("attempt"), int) else None,
    )


__all__ = [
    "TERMINAL_TASK_STATUSES",
    "build_artifact_view",
    "build_render_task_view",
    "latest_render_task",
    "stage_message_for",
]
