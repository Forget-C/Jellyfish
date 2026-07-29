"""CAS 生产编排器（同步执行、确定性、可重试）。

流水线：validate → prompt_build → image_generation → video_generation →
audio_generation → subtitle_generation → composition → finalize。

失败语义：
- 标记当前 ProductionShot 失败（若该阶段属于某镜头）；
- 标记 ProductionJob 失败，并记录**可执行的**错误信息与失败阶段；
- 保留所有已成功产物（不回滚文件，不删除已登记产物）。

重试语义：
- 从失败阶段重新开始，重跑该阶段及其之后的所有阶段；
- 更早阶段的产物在「DB 有记录 + 文件存在 + 校验和一致」时**复用**，不重新生成。

本模块不含任何供应商细节（通过 ProviderBundle 注入），不调用 LLM/Celery/Redis。
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto_animal_studio.application.hashing import canonical_payload_hash
from app.crypto_animal_studio.production.artifact_manager import ArtifactManager
from app.crypto_animal_studio.production.enums import ArtifactType, JobStatus, Stage, STAGE_ORDER, stage_index
from app.crypto_animal_studio.production.models import CasProductionArtifact, CasProductionJob, CasProductionShot
from app.crypto_animal_studio.production.prompt_builder import build_shot_prompts
from app.crypto_animal_studio.production.providers.base import ProviderBundle
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage
from app.services.common import create_and_refresh


class ProductionError(Exception):
    """生产流程的领域异常基类。"""


class JobNotFoundError(ProductionError):
    """任务不存在。"""


class PackageMismatchError(ProductionError):
    """重试时提供的 EpisodePackage 与原任务不一致。"""


def _utcnow() -> datetime:
    """返回带时区的当前时间（UTC）。"""
    return datetime.now(timezone.utc)


async def create_job(
    db: AsyncSession, *, project_id: str, package: EpisodePackage, provider_mode: str = "mock", storage_root: Path | None = None
) -> CasProductionJob:
    """创建一个 ProductionJob 及其 ProductionShots（状态 pending）。"""
    job = CasProductionJob(
        id=str(uuid.uuid4()),
        project_id=project_id,
        episode_id=package.episode_id,
        status=JobStatus.pending.value,
        current_stage=Stage.validate.value,
        episode_package_hash=canonical_payload_hash(package),
        provider_mode=provider_mode,
    )
    await create_and_refresh(db, job)

    manager = ArtifactManager(db, job, storage_root=storage_root)
    job.output_path = manager.job_relpath
    await db.flush()

    for shot in sorted(package.shots, key=lambda s: s.sequence):
        await create_and_refresh(
            db,
            CasProductionShot(
                id=str(uuid.uuid4()),
                job_id=job.id,
                source_shot_id=shot.shot_id,
                sequence=shot.sequence,
                status=JobStatus.pending.value,
                current_stage=Stage.validate.value,
                duration_seconds=float(shot.duration_seconds),
            ),
        )
    return job


async def _load_shots(db: AsyncSession, job: CasProductionJob) -> list[CasProductionShot]:
    """按 sequence 升序加载任务下的生产镜头。"""
    stmt = select(CasProductionShot).where(CasProductionShot.job_id == job.id).order_by(CasProductionShot.sequence)
    return list((await db.execute(stmt)).scalars().all())


async def _load_artifacts(db: AsyncSession, job: CasProductionJob) -> list[CasProductionArtifact]:
    """加载任务下全部产物记录。"""
    stmt = select(CasProductionArtifact).where(CasProductionArtifact.job_id == job.id)
    return list((await db.execute(stmt)).scalars().all())


async def run_job(
    db: AsyncSession,
    *,
    job: CasProductionJob,
    package: EpisodePackage,
    providers: ProviderBundle,
    storage_root: Path | None = None,
    start_stage: Stage | None = None,
) -> CasProductionJob:
    """执行（或从 ``start_stage`` 续跑）一个生产任务。

    返回最终的 job（成功为 completed，失败为 failed，且失败时保留已成功产物）。
    """
    manager = ArtifactManager(db, job, storage_root=storage_root)
    shots = await _load_shots(db, job)
    begin = stage_index(start_stage or Stage.validate)

    job.status = JobStatus.running.value
    if job.started_at is None:
        job.started_at = _utcnow()
    job.error_message = ""
    job.output_path = manager.job_relpath
    await db.flush()

    current_stage = STAGE_ORDER[begin]
    current_shot: CasProductionShot | None = None
    try:
        # 无论从哪个阶段续跑，都必须先校验 package 与原任务一致（防止重试时换了内容）。
        if canonical_payload_hash(package) != job.episode_package_hash:
            current_stage = Stage.validate
            raise PackageMismatchError("episode_package does not match the original job payload hash")

        for stage in STAGE_ORDER[begin:]:
            current_stage = stage
            job.current_stage = stage.value
            await db.flush()

            if stage is Stage.validate:
                pass  # 已在循环前完成哈希校验

            elif stage is Stage.prompt_build:
                for shot_row in shots:
                    current_shot = shot_row
                    spec = _find_shot(package, shot_row.source_shot_id)
                    prompts = build_shot_prompts(package, spec)
                    shot_row.image_prompt = prompts.image_prompt
                    shot_row.negative_prompt = prompts.negative_prompt
                    shot_row.video_prompt = prompts.video_prompt
                    shot_row.duration_seconds = float(spec.duration_seconds)
                    shot_row.current_stage = stage.value
                    await db.flush()
                    if await manager.find_valid(ArtifactType.prompt, production_shot_id=shot_row.id) is None:
                        await manager.write_text_artifact(
                            artifact_type=ArtifactType.prompt,
                            stage=stage,
                            content=json.dumps(prompts.to_dict(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                            shot=shot_row,
                            mime_type="application/json",
                        )
                current_shot = None

            elif stage in (Stage.image_generation, Stage.video_generation, Stage.audio_generation, Stage.subtitle_generation):
                for shot_row in shots:
                    current_shot = shot_row
                    shot_row.current_stage = stage.value
                    await db.flush()
                    await _run_shot_stage(manager, stage, shot_row, package, providers)
                current_shot = None

            elif stage is Stage.composition:
                if await manager.find_valid(ArtifactType.final_video) is None:
                    relpath = manager.artifact_relpath(ArtifactType.final_video)
                    target = manager.ensure_parent(relpath)
                    shot_inputs = [
                        {
                            "sequence": s.sequence,
                            "shot_id": s.source_shot_id,
                            "video": manager.artifact_relpath(ArtifactType.video, sequence=s.sequence, shot_id=s.source_shot_id),
                            "voice": manager.artifact_relpath(ArtifactType.voice, sequence=s.sequence, shot_id=s.source_shot_id),
                        }
                        for s in shots
                    ]
                    generated = providers.composer.compose(
                        target_path=target, shot_inputs=shot_inputs, context={"episode_id": job.episode_id, "job_id": job.id}
                    )
                    await manager.register(
                        artifact_type=ArtifactType.final_video,
                        stage=stage,
                        relpath=relpath,
                        mime_type=generated.mime_type,
                        provider=generated.provider,
                        provider_model=generated.provider_model,
                        metadata=generated.metadata,
                    )

            elif stage is Stage.finalize:
                for shot_row in shots:
                    shot_row.status = JobStatus.completed.value
                    shot_row.current_stage = Stage.finalize.value
                    shot_row.error_message = ""
                job.status = JobStatus.completed.value
                job.completed_at = _utcnow()
                await db.flush()
                await _write_manifest(db, manager, job, shots, providers)

        return job

    except Exception as exc:  # noqa: BLE001 - 转换为可持久化的失败状态
        message = f"{type(exc).__name__}: {exc}"
        if current_shot is not None:
            current_shot.status = JobStatus.failed.value
            current_shot.current_stage = current_stage.value
            current_shot.error_message = message
        job.status = JobStatus.failed.value
        job.current_stage = current_stage.value
        job.error_message = message
        await db.flush()
        # 失败时也写一份 manifest，保证可追溯（已成功产物全部保留）
        try:
            await _write_manifest(db, manager, job, shots, providers)
        except Exception:  # noqa: BLE001 - manifest 写入失败不得掩盖原始错误
            pass
        return job


def _find_shot(package: EpisodePackage, shot_id: str):
    """在 EpisodePackage 中按 shot_id 定位镜头规格。"""
    for shot in package.shots:
        if shot.shot_id == shot_id:
            return shot
    raise ProductionError(f"shot '{shot_id}' not found in episode_package")


async def _run_shot_stage(
    manager: ArtifactManager, stage: Stage, shot_row: CasProductionShot, package: EpisodePackage, providers: ProviderBundle
) -> None:
    """执行单镜头的某个生成阶段（存在有效产物时复用）。"""
    type_by_stage = {
        Stage.image_generation: ArtifactType.image,
        Stage.video_generation: ArtifactType.video,
        Stage.audio_generation: ArtifactType.voice,
        Stage.subtitle_generation: ArtifactType.subtitle,
    }
    artifact_type = type_by_stage[stage]
    if await manager.find_valid(artifact_type, production_shot_id=shot_row.id) is not None:
        return  # 复用既有有效产物

    spec = _find_shot(package, shot_row.source_shot_id)
    prompts = build_shot_prompts(package, spec)
    context = {"shot_id": shot_row.source_shot_id, "sequence": shot_row.sequence, "duration_seconds": shot_row.duration_seconds}
    relpath = manager.artifact_relpath(artifact_type, sequence=shot_row.sequence, shot_id=shot_row.source_shot_id)

    if stage is Stage.subtitle_generation:
        await manager.write_text_artifact(
            artifact_type=ArtifactType.subtitle, stage=stage, content=prompts.subtitle_text + "\n", shot=shot_row, mime_type="text/plain"
        )
        return

    target = manager.ensure_parent(relpath)
    if stage is Stage.image_generation:
        generated = providers.image.generate_image(
            target_path=target, prompt=prompts.image_prompt, negative_prompt=prompts.negative_prompt, context=context
        )
    elif stage is Stage.video_generation:
        generated = providers.video.generate_video(target_path=target, prompt=prompts.video_prompt, context=context)
    else:  # Stage.audio_generation
        generated = providers.voice.generate_voice(target_path=target, text=prompts.voice_text, context=context)

    await manager.register(
        artifact_type=artifact_type,
        stage=stage,
        relpath=relpath,
        mime_type=generated.mime_type,
        provider=generated.provider,
        provider_model=generated.provider_model,
        production_shot_id=shot_row.id,
        metadata=generated.metadata,
    )


async def _write_manifest(
    db: AsyncSession, manager: ArtifactManager, job: CasProductionJob, shots: list[CasProductionShot], providers: ProviderBundle
) -> CasProductionArtifact:
    """写出 manifest.json（全量可追溯信息）并登记为产物。"""
    artifacts = await _load_artifacts(db, job)
    final_artifact = next((a for a in artifacts if a.artifact_type == ArtifactType.final_video.value), None)
    errors = [{"scope": "job", "stage": job.current_stage, "message": job.error_message}] if job.error_message else []
    errors += [
        {"scope": "shot", "shot_id": s.source_shot_id, "sequence": s.sequence, "stage": s.current_stage, "message": s.error_message}
        for s in shots
        if s.error_message
    ]

    manifest = {
        "job_id": job.id,
        "project_id": job.project_id,
        "episode_id": job.episode_id,
        "status": job.status,
        "episode_package_hash": job.episode_package_hash,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "shots": [
            {
                "id": s.id,
                "source_shot_id": s.source_shot_id,
                "sequence": s.sequence,
                "status": s.status,
                "current_stage": s.current_stage,
                "duration_seconds": s.duration_seconds,
                "error_message": s.error_message,
            }
            for s in shots
        ],
        "artifacts": sorted(
            (
                {
                    "id": a.id,
                    "production_shot_id": a.production_shot_id,
                    "artifact_type": a.artifact_type,
                    "stage": a.stage,
                    "provider": a.provider,
                    "provider_model": a.provider_model,
                    "file_path": a.file_path,
                    "mime_type": a.mime_type,
                    "checksum": a.checksum,
                }
                for a in artifacts
                if a.artifact_type != ArtifactType.manifest.value
            ),
            key=lambda item: (item["artifact_type"], item["file_path"]),
        ),
        "providers": providers.describe(),
        "errors": errors,
        "final_output": final_artifact.file_path if final_artifact else None,
    }
    return await manager.write_text_artifact(
        artifact_type=ArtifactType.manifest,
        stage=Stage.finalize,
        content=json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        mime_type="application/json",
    )


async def start_production(
    db: AsyncSession,
    *,
    project_id: str,
    package: EpisodePackage,
    providers: ProviderBundle,
    provider_mode: str = "mock",
    storage_root: Path | None = None,
) -> CasProductionJob:
    """创建并同步执行一次完整生产（每次调用创建新任务）。"""
    job = await create_job(db, project_id=project_id, package=package, provider_mode=provider_mode, storage_root=storage_root)
    return await run_job(db, job=job, package=package, providers=providers, storage_root=storage_root)


async def retry_production(
    db: AsyncSession, *, job_id: str, package: EpisodePackage, providers: ProviderBundle, storage_root: Path | None = None
) -> CasProductionJob:
    """从失败阶段重试：重跑该阶段及其之后，复用更早的有效产物。"""
    job = await db.get(CasProductionJob, job_id)
    if job is None:
        raise JobNotFoundError(f"production job not found: {job_id}")
    start = Stage(job.current_stage) if job.status == JobStatus.failed.value else Stage.validate
    for shot_row in await _load_shots(db, job):
        if shot_row.status == JobStatus.failed.value:
            shot_row.status = JobStatus.pending.value
            shot_row.error_message = ""
    await db.flush()
    return await run_job(db, job=job, package=package, providers=providers, storage_root=storage_root, start_stage=start)


__all__ = [
    "create_job",
    "run_job",
    "start_production",
    "retry_production",
    "ProductionError",
    "JobNotFoundError",
    "PackageMismatchError",
]
