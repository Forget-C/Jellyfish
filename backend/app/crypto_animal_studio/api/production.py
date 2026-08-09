"""CAS 生产 API（薄路由）。

注册于 ``/api/v1/crypto-animal-studio/production``（沿用仓库 api_v1 前缀与 CAS 挂载点，
不新建独立 FastAPI app）。本冲刺同步执行，不使用 Celery。
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.crypto_animal_studio.domain.import_ledger import CasImportLedger
from app.crypto_animal_studio.application.render_request import build_render_request
from app.crypto_animal_studio.application.render_tasks import (
    create_shot_render_task,
    find_active_render_task,
)
from app.crypto_animal_studio.application.render_views import (
    build_artifact_view,
    build_render_task_view,
    latest_render_task,
)
from app.crypto_animal_studio.production.enums import ArtifactType
from app.crypto_animal_studio.production.models import CasProductionArtifact, CasProductionJob, CasProductionShot
from app.crypto_animal_studio.production.orchestrator import (
    JobNotFoundError,
    PackageMismatchError,
    retry_production,
    start_production,
)
from app.crypto_animal_studio.production.providers.mock import build_mock_bundle
from app.crypto_animal_studio.schemas.production import (
    CreateProductionJobRequest,
    ProductionArtifactView,
    ProductionJobView,
    ProductionShotView,
    RenderTaskView,
    RetryProductionJobRequest,
)
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response

router = APIRouter()


async def _build_job_view(db: AsyncSession, job: CasProductionJob) -> ProductionJobView:
    """把 ORM 任务组装为 API 视图（含镜头、manifest 与成片路径）。"""
    shots = list(
        (await db.execute(select(CasProductionShot).where(CasProductionShot.job_id == job.id).order_by(CasProductionShot.sequence)))
        .scalars()
        .all()
    )
    artifacts = list((await db.execute(select(CasProductionArtifact).where(CasProductionArtifact.job_id == job.id))).scalars().all())
    manifest = next((a for a in artifacts if a.artifact_type == ArtifactType.manifest.value), None)
    final = next((a for a in artifacts if a.artifact_type == ArtifactType.final_video.value), None)
    # Step 7：最近一次单镜头渲染尝试（按镜头顺序取第一个有尝试的镜头，确定性）。
    render_task_view = None
    for shot_row in shots:
        task_row = await latest_render_task(db, production_shot_id=shot_row.id)
        if task_row is not None:
            render_task_view = build_render_task_view(task_row)
            break
    return ProductionJobView(
        render_task=render_task_view,
        id=job.id,
        project_id=job.project_id,
        episode_id=job.episode_id,
        status=job.status,
        current_stage=job.current_stage,
        provider_mode=job.provider_mode,
        episode_package_hash=job.episode_package_hash,
        output_path=job.output_path,
        error_message=job.error_message,
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        shots=[
            ProductionShotView(
                id=s.id,
                source_shot_id=s.source_shot_id,
                sequence=s.sequence,
                status=s.status,
                current_stage=s.current_stage,
                duration_seconds=s.duration_seconds,
                error_message=s.error_message,
            )
            for s in shots
        ],
        manifest_path=manifest.file_path if manifest else None,
        final_output=final.file_path if final else None,
    )


@router.post("/jobs", response_model=ApiResponse[ProductionJobView])
async def create_production_job(body: CreateProductionJobRequest, db: AsyncSession = Depends(get_db)) -> ApiResponse[ProductionJobView]:
    """创建并同步执行一次生产（每次调用创建新任务）。"""
    job = await start_production(
        db, project_id=body.project_id, package=body.episode_package, providers=build_mock_bundle(), provider_mode=body.mode
    )
    return success_response(data=await _build_job_view(db, job))


@router.get("/jobs", response_model=ApiResponse[list[ProductionJobView]])
async def list_production_jobs(
    project_id: str,
    episode_id: str | None = None,
    chapter_id: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[ProductionJobView]]:
    """按项目列出生产任务，可按剧集或章节过滤。

    ``chapter_id`` 存在的原因：Jellyfish 的 Chapter **不建模剧集**，``ChapterRead``
    没有 episode_id，因此前端只有路由里的 chapterId。权威的 章节→剧集 映射保存在
    ``cas_import_ledger(project_id, episode_id, chapter_id)``（导入时写入），
    这里在服务端解析它，避免前端猜测或把 chapter.id 当作 episode_id。

    章节没有导入记录时返回空列表（该章节不是由 CAS 导入的剧集）。
    """
    stmt = select(CasProductionJob).where(CasProductionJob.project_id == project_id)

    resolved_episode_id = episode_id
    if resolved_episode_id is None and chapter_id:
        ledger_stmt = select(CasImportLedger.episode_id).where(
            CasImportLedger.project_id == project_id,
            CasImportLedger.chapter_id == chapter_id,
        )
        resolved_episode_id = (await db.execute(ledger_stmt)).scalars().first()
        if resolved_episode_id is None:
            return success_response(data=[])

    if resolved_episode_id:
        stmt = stmt.where(CasProductionJob.episode_id == resolved_episode_id)
    # 全序排序：created_at 可能在同一秒内并列，单靠它不是确定性顺序。
    # cas_production_jobs 没有自增列（id 是随机 UUID），因此以 id 作次级键构成
    # **稳定的全序**；并列时的取舍是任意但可复现的。若日后需要「真正的最新」，
    # 需要一个单调列（需迁移，超出 Step 7 范围）。
    stmt = stmt.order_by(CasProductionJob.created_at.desc(), CasProductionJob.id.desc())
    rows = list((await db.execute(stmt)).scalars().all())
    return success_response(data=[await _build_job_view(db, row) for row in rows])


@router.get("/jobs/{job_id}", response_model=ApiResponse[ProductionJobView])
async def get_production_job(job_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[ProductionJobView]:
    """查询生产任务状态。"""
    job = await db.get(CasProductionJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"production job not found: {job_id}")
    return success_response(data=await _build_job_view(db, job))


@router.get("/jobs/{job_id}/artifacts", response_model=ApiResponse[list[ProductionArtifactView]])
async def list_production_artifacts(job_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[list[ProductionArtifactView]]:
    """列出任务的全部产物。"""
    job = await db.get(CasProductionJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"production job not found: {job_id}")
    rows = list(
        (
            await db.execute(
                select(CasProductionArtifact)
                .where(CasProductionArtifact.job_id == job_id)
                .order_by(CasProductionArtifact.artifact_type, CasProductionArtifact.file_path)
            )
        )
        .scalars()
        .all()
    )
    # Step 7：统一经 build_artifact_view 投影，补上 file_id / size / download_url 等可选字段。
    return success_response(data=[build_artifact_view(a) for a in rows])

@router.post(
    "/jobs/{job_id}/shots/{production_shot_id}/render",
    response_model=ApiResponse[RenderTaskView],
)
async def start_shot_render(
    job_id: str,
    production_shot_id: str,
    profile: Literal["preview", "final"] = "final",
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderTaskView]:
    """Start a render task for one production shot.

    ``profile``:
    - ``final`` (default): dimensions derived from ratio (1080x1920). Behaviour is
      identical to before this parameter existed.
    - ``preview``: uses the configured low-resolution profile (default 544x960) for
      low-power GPUs. The pixel values come from backend settings, never from the
      caller, so clients cannot dictate render specs.
    """
    job = await db.get(CasProductionJob, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"production job not found: {job_id}",
        )

    shot = await db.get(CasProductionShot, production_shot_id)
    if shot is None or shot.job_id != job_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"production shot not found in job: {production_shot_id}",
        )

    active = await find_active_render_task(
        db,
        production_shot_id=production_shot_id,
    )
    if active is not None:
        return success_response(data=build_render_task_view(active))

    render_request = build_render_request(
        shot,
        context={
            "scene": shot.image_prompt or "",
            "action": shot.video_prompt or "",
        },
        ratio="9:16",
        negative_prompt=shot.negative_prompt or None,
        # preview 档走配置的低分辨率；final 档传 None，由 ratio 推导（既有行为）。
        width=settings.cas_render_preview_width if profile == "preview" else None,
        height=settings.cas_render_preview_height if profile == "preview" else None,
    )

    task_row, _attempt = await create_shot_render_task(
        db,
        job=job,
        production_shot=shot,
        render_request=render_request,
        provider=settings.cas_render_provider,
        base_url=settings.cas_comfyui_base_url,
        poll_interval_s=settings.cas_render_poll_interval_s,
        timeout_s=settings.cas_render_timeout_s,
    )

    await db.commit()

    from app.tasks.execute_task import enqueue_task_execution

    enqueue_task_execution(task_row.id)
    return success_response(data=build_render_task_view(task_row))


@router.post("/jobs/{job_id}/retry", response_model=ApiResponse[ProductionJobView])
async def retry_production_job(
    job_id: str, body: RetryProductionJobRequest, db: AsyncSession = Depends(get_db)
) -> ApiResponse[ProductionJobView]:
    """从失败阶段重试（复用更早的有效产物）。"""
    try:
        job = await retry_production(db, job_id=job_id, package=body.episode_package, providers=build_mock_bundle())
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PackageMismatchError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return success_response(data=await _build_job_view(db, job))
