"""CAS 生产 API（薄路由）。

注册于 ``/api/v1/crypto-animal-studio/production``（沿用仓库 api_v1 前缀与 CAS 挂载点，
不新建独立 FastAPI app）。本冲刺同步执行，不使用 Celery。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    return ProductionJobView(
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
    return success_response(
        data=[
            ProductionArtifactView(
                id=a.id,
                production_shot_id=a.production_shot_id,
                artifact_type=a.artifact_type,
                stage=a.stage,
                provider=a.provider,
                provider_model=a.provider_model,
                file_path=a.file_path,
                mime_type=a.mime_type,
                checksum=a.checksum,
            )
            for a in rows
        ]
    )


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
