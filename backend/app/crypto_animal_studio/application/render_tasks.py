"""CAS 单镜头真实渲染：Task Center 任务的创建与执行（application 层）。

复用而非新建：
- 队列/入口：既有 Task Center + ``enqueue_task_execution`` + Celery ``task.execute``；
- 执行器基类：既有 ``AbstractAsyncDelegatingExecutor``（在 task_registry 注册）；
- 供应商分派：既有 ``VideoGenerationTask`` → ``resolve_task_adapter``；
- 存储：既有 ``create_file_from_url_or_b64``（对象存储 + FileItem）；
- 关联：既有 ``GenerationTaskLink``（承载 task↔生产镜头 的关系）。

本模块只补上 CAS 侧缺失的一段：把供应商产物登记为 ``CasProductionArtifact``，
并与 job / 生产镜头 / 剧集范围关联。**不修改** ``run_video_generation_task``，
因此既有影视线的行为完全不变。
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session_maker
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.task_manager.types import TaskStatus
from app.crypto_animal_studio.production.enums import ArtifactType, JobStatus, Stage
from app.crypto_animal_studio.production.models import (
    CasProductionArtifact,
    CasProductionJob,
    CasProductionShot,
)
from app.models.task import GenerationTask, GenerationTaskStatus
from app.models.task_links import GenerationTaskLink
from app.services.common import create_and_refresh

logger = logging.getLogger(__name__)

#: 任务种类：与既有 video_generation 共用注册表与队列，但走 CAS 的产物落库。
CAS_RENDER_SHOT_TASK_KIND = "cas_render_shot"

#: 业务关联类型（``relation_type`` 为 String(32)）。
CAS_SHOT_RENDER_RELATION_TYPE = "cas_shot_render"

#: 视为「仍在进行」的任务状态。
_ACTIVE_TASK_STATUSES = (
    GenerationTaskStatus.pending,
    GenerationTaskStatus.running,
    GenerationTaskStatus.streaming,
)

#: 面向用户的安全失败文案：绝不回显供应商响应体、地址或凭据。
_SAFE_FAILURE_MESSAGES: dict[str, str] = {
    "config": "Render provider is not configured correctly. Check the CAS render settings.",
    "timeout": "The render provider did not finish before the configured timeout.",
    "provider": "The render provider reported an execution failure.",
    "network": "The render provider could not be reached.",
    "output": "The render finished but produced no usable video output.",
    "unknown": "Rendering failed. See server logs for details.",
}


class RenderTaskError(Exception):
    """CAS 渲染任务的领域错误。"""


def _utcnow() -> datetime:
    """UTC 当前时间（naive，与既有模型一致）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def classify_failure(exc: BaseException) -> tuple[str, str]:
    """把异常映射为 ``(error_code, 安全的用户可见文案)``。

    只依据异常类型与少量关键词判断，**不把异常文本原样返回给用户**，
    以免泄露供应商响应体、base_url 或凭据。
    """
    name = type(exc).__name__
    text = str(exc).lower()
    if name == "WorkflowConfigError" or "not configured" in text:
        code = "config"
    elif "timed out" in text or name in {"TimeoutError", "ReadTimeout", "ConnectTimeout"}:
        code = "timeout"
    elif "no video output" in text or "no download url" in text:
        code = "output"
    elif name in {"ConnectError", "HTTPError", "RequestError"} or "could not be reached" in text:
        code = "network"
    elif name == "ComfyUIError" or "execution failed" in text or "rejected the workflow" in text:
        # worker 会把供应商错误包装成 RenderTaskError，因此必须同时按消息判别，
        # 否则真实执行路径上的供应商失败会被误判为 unknown（由 E2E 测试发现）。
        code = "provider"
    else:
        code = "unknown"
    return code, _SAFE_FAILURE_MESSAGES[code]


async def find_active_render_task(
    db: AsyncSession, *, production_shot_id: str
) -> GenerationTask | None:
    """该生产镜头是否已有进行中的渲染任务（用于禁用重复提交）。"""
    stmt = (
        select(GenerationTask)
        .join(GenerationTaskLink, GenerationTaskLink.task_id == GenerationTask.id)
        .where(
            GenerationTaskLink.relation_type == CAS_SHOT_RENDER_RELATION_TYPE,
            GenerationTaskLink.relation_entity_id == production_shot_id,
            GenerationTask.status.in_(_ACTIVE_TASK_STATUSES),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


async def count_render_attempts(db: AsyncSession, *, production_shot_id: str) -> int:
    """该生产镜头累计的渲染尝试次数（重试的可追溯性）。"""
    stmt = select(GenerationTaskLink).where(
        GenerationTaskLink.relation_type == CAS_SHOT_RENDER_RELATION_TYPE,
        GenerationTaskLink.relation_entity_id == production_shot_id,
    )
    return len((await db.execute(stmt)).scalars().all())


async def create_shot_render_task(
    db: AsyncSession,
    *,
    job: CasProductionJob,
    production_shot: CasProductionShot,
    render_request: Any,
    provider: str,
    base_url: str | None,
    api_key: str = "",
    poll_interval_s: float = 3.0,
    timeout_s: float = 1800.0,
) -> tuple[GenerationTask, int]:
    """登记一次渲染尝试（不入队；入队由 API 层在提交后触发）。

    返回 ``(task_row, attempt)``。调用方拥有事务：本函数只 flush。
    """
    attempt = await count_render_attempts(db, production_shot_id=production_shot.id) + 1

    store = SqlAlchemyTaskStore(db)
    manager = TaskManager(store=store, strategies={})
    record = await manager.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind=CAS_RENDER_SHOT_TASK_KIND,
        run_args={
            "job_id": job.id,
            "production_shot_id": production_shot.id,
            "project_id": job.project_id,
            "episode_id": job.episode_id,
            "attempt": attempt,
            "provider": provider,
            "base_url": base_url,
            "api_key": api_key,  # 自托管 ComfyUI 通常为空串
            "poll_interval_s": poll_interval_s,
            "timeout_s": timeout_s,
            # 供应商中立的输入 + 可复现快照（不含工作流负载与密钥）
            "input": render_request.to_video_input().model_dump(),
            "request_snapshot": render_request.snapshot,
        },
    )
    db.add(
        GenerationTaskLink(
            task_id=record.id,
            resource_type="video",
            relation_type=CAS_SHOT_RENDER_RELATION_TYPE,
            relation_entity_id=production_shot.id,
        )
    )
    await db.flush()
    task_row = await db.get(GenerationTask, record.id)
    if task_row is None:  # pragma: no cover - 刚创建必然存在
        raise RenderTaskError("failed to create render task record")
    return task_row, attempt


class _CreateOnlyTask:
    """仅用于 ``TaskManager.create``；实际执行由 worker 驱动。"""

    async def run(self, *args: object, **kwargs: object) -> None:
        """占位。"""
        return None

    async def status(self) -> dict[str, object]:
        """占位。"""
        return {}

    async def is_done(self) -> bool:
        """占位。"""
        return False

    async def get_result(self) -> object:
        """占位。"""
        return None


#: Step 6 mock 流水线使用的供应商名（``providers/mock.py``）。
#: mock 也会为每个镜头产出 ``ArtifactType.video`` 产物，因此**必须**把它排除在
#: 真实渲染的幂等判定之外，否则「先用 mock 建任务、再发起真实渲染」时，
#: 真实渲染会误判为「已有产物」而秒回 succeeded，根本不会调用 ComfyUI。
MOCK_VIDEO_PROVIDER = "mock-video"


async def _existing_video_artifact(
    db: AsyncSession, *, job_id: str, production_shot_id: str
) -> CasProductionArtifact | None:
    """查询该镜头是否已有**真实渲染**产生的视频产物。

    仅用于幂等与「保留既有成功产物」。mock 流水线的占位产物不算数：
    它由 Step 6 的模拟管线生成，并不代表任何供应商真的渲染过。
    """
    stmt = (
        select(CasProductionArtifact)
        .where(
            CasProductionArtifact.job_id == job_id,
            CasProductionArtifact.production_shot_id == production_shot_id,
            CasProductionArtifact.artifact_type == ArtifactType.video.value,
            CasProductionArtifact.provider != MOCK_VIDEO_PROVIDER,
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


async def persist_render_artifact(
    db: AsyncSession,
    *,
    job_id: str,
    production_shot_id: str,
    file_item: Any,
    provider: str,
    provider_job_id: str,
    attempt: int,
    request_snapshot: dict[str, Any],
    mime_type: str = "video/mp4",
    size_bytes: int | None = None,
) -> tuple[CasProductionArtifact, bool]:
    """登记 CasProductionArtifact，并保证幂等。

    返回 ``(artifact, created)``。已存在成功产物时**不覆盖**，直接返回既有记录，
    因此重复投递与重试都不会产生第二条成功产物。
    """
    existing = await _existing_video_artifact(
        db, job_id=job_id, production_shot_id=production_shot_id
    )
    if existing is not None:
        return existing, False

    artifact = CasProductionArtifact(
        id=str(uuid.uuid4()),
        job_id=job_id,
        production_shot_id=production_shot_id,
        artifact_type=ArtifactType.video.value,
        stage=Stage.video_generation.value,
        provider=provider,
        provider_model="",
        file_path=getattr(file_item, "storage_key", "") or "",
        mime_type=mime_type,
        checksum="",  # 对象存储产物：本地 checksum 不适用，改由 FileItem 承载
        metadata_json={
            "file_id": getattr(file_item, "id", ""),
            "provider_job_id": provider_job_id,
            "attempt": attempt,
            "size_bytes": size_bytes,
            "request_snapshot": request_snapshot,
            "completed_at": _utcnow().isoformat(),
        },
    )
    return await create_and_refresh(db, artifact), True


async def run_cas_shot_render_task(task_id: str, run_args: dict | None = None) -> None:
    """执行一次 CAS 单镜头渲染。

    签名与既有 worker runner 一致 ``(task_id, run_args)``，可直接注册到
    ``AbstractAsyncDelegatingExecutor``。任何异常都必须落到**终态 failed**，
    而不是让任务永远停在 running。
    """
    # 局部导入：避免 application 层在模块导入期拉起 film/服务层依赖。
    from app.core.contracts.provider import ProviderConfig
    from app.core.contracts.video_generation import VideoGenerationInput
    from app.core.tasks.video_generation_tasks import VideoGenerationTask
    from app.services.worker.async_task_support import cancel_if_requested_async
    from app.utils.files import create_file_from_url_or_b64

    async with async_session_maker() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.get(task_id)
        if task is None:
            # 不静默返回：任务行缺失属于真实故障，必须让 executor 记为 failed，
            # 否则会出现「秒回 succeeded 但什么都没做」的假成功。
            raise RenderTaskError(f"render task record not found: {task_id}")
        if not run_args:
            run_args = task.payload.get("run_args") or {}
        await store.set_status(task_id, TaskStatus.running)
        await store.set_progress(task_id, 5)
        await db.commit()

    provider = str(run_args.get("provider") or "")
    job_id = str(run_args.get("job_id") or "")
    production_shot_id = str(run_args.get("production_shot_id") or "")
    attempt = int(run_args.get("attempt") or 1)
    snapshot = dict(run_args.get("request_snapshot") or {})

    # run_args 缺字段同样不得静默通过：缺 input 会让供应商拿到空提示词，
    # 缺 base_url 会让 ComfyUI 适配器无从连接。这里提前失败并给出可读原因。
    missing = [
        key
        for key in ("job_id", "production_shot_id", "provider", "input")
        if not run_args.get(key)
    ]
    try:
        # 放在 try 内：这样缺字段失败也会走同一套「任务 + 生产镜头都标记 failed」的收尾。
        if missing:
            raise RenderTaskError(
                f"render run_args missing required fields: {sorted(missing)}"
            )

        async with async_session_maker() as db:
            store = SqlAlchemyTaskStore(db)

            # 幂等：已有成功产物则直接复用，不重复调用供应商。
            existing = await _existing_video_artifact(
                db, job_id=job_id, production_shot_id=production_shot_id
            )
            if existing is not None:
                await store.set_result(
                    task_id,
                    {"artifact_id": existing.id, "reused": True, "attempt": attempt},
                )
                await store.set_progress(task_id, 100)
                await store.set_status(task_id, TaskStatus.succeeded)
                await db.commit()
                return

            if await cancel_if_requested_async(store=store, task_id=task_id, session=db):
                return

            await store.set_progress(task_id, 20)  # submitting
            await db.commit()

            video_task = VideoGenerationTask(
                provider_config=ProviderConfig(
                    provider=provider,  # type: ignore[arg-type]
                    api_key=str(run_args.get("api_key") or ""),
                    base_url=run_args.get("base_url"),
                ),
                input_=VideoGenerationInput.model_validate(dict(run_args.get("input") or {})),
                poll_interval_s=float(run_args.get("poll_interval_s") or 3.0),
                timeout_s=float(run_args.get("timeout_s") or 1800.0),
            )
            await video_task.run()
            result = await video_task.get_result()
            if result is None:
                status = await video_task.status()
                raise RenderTaskError(str(status.get("error") or "provider returned no result"))

            if await cancel_if_requested_async(store=store, task_id=task_id, session=db):
                return

            await store.set_progress(task_id, 80)  # downloading
            await db.commit()

            file_item = await create_file_from_url_or_b64(
                db,
                url=result.url,
                name=f"cas-shot-{production_shot_id}-attempt{attempt}",
                prefix=f"cas/renders/{job_id}/{production_shot_id}",
                httpx_timeout=600.0,
            )

            artifact, _created = await persist_render_artifact(
                db,
                job_id=job_id,
                production_shot_id=production_shot_id,
                file_item=file_item,
                provider=provider,
                provider_job_id=str(result.provider_task_id or ""),
                attempt=attempt,
                request_snapshot=snapshot,
            )

            shot = await db.get(CasProductionShot, production_shot_id)
            if shot is not None:
                shot.status = JobStatus.completed.value
                shot.current_stage = Stage.video_generation.value
                shot.error_message = ""

            await store.set_result(
                task_id,
                {
                    "artifact_id": artifact.id,
                    "file_id": getattr(file_item, "id", ""),
                    "provider_job_id": str(result.provider_task_id or ""),
                    "attempt": attempt,
                    "reused": False,
                },
            )
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            await db.commit()
    except Exception as exc:  # noqa: BLE001  # 任何失败都必须落终态
        code, safe_message = classify_failure(exc)
        # 完整异常只进日志，不进 API 响应。
        logger.exception("cas render task failed: task=%s code=%s", task_id, code)
        async with async_session_maker() as db:
            store = SqlAlchemyTaskStore(db)
            await store.set_error(task_id, f"{code}: {safe_message}")
            await store.set_status(task_id, TaskStatus.failed)
            shot = await db.get(CasProductionShot, production_shot_id)
            if shot is not None:
                shot.status = JobStatus.failed.value
                shot.error_message = safe_message
            await db.commit()


__all__ = [
    "CAS_RENDER_SHOT_TASK_KIND",
    "CAS_SHOT_RENDER_RELATION_TYPE",
    "RenderTaskError",
    "classify_failure",
    "count_render_attempts",
    "create_shot_render_task",
    "find_active_render_task",
    "persist_render_artifact",
    "run_cas_shot_render_task",
]
