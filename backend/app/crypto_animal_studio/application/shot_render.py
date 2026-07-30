"""单镜头视频渲染的编排（application 层）。

把一个 ``CasProductionShot`` 接到 Jellyfish **既有**的视频生成通道上：

    CasProductionShot → 确定性渲染请求 → TaskManager(task_kind="video_generation")
    → enqueue_task_execution → Celery task.execute → run_video_generation_task
    → resolve_task_adapter("video_generation", provider) → FileItem
    → CasProductionArtifact

刻意不新增队列、执行器、Celery 入口或 CAS 本地供应商注册表。

事务纪律：本模块只 ``flush``（经 ``create_and_refresh``），从不自行 commit；
调用方（请求会话或 worker 会话）拥有事务。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto_animal_studio.application.render_request import (
    RenderRequest,
    build_render_request,
    snapshot_fingerprint,
)
from app.crypto_animal_studio.domain.import_ledger import CasImportLedger
from app.crypto_animal_studio.production.enums import ArtifactType, Stage
from app.crypto_animal_studio.production.models import (
    CasProductionArtifact,
    CasProductionJob,
    CasProductionShot,
)
from app.models.studio import Shot
from app.models.task_links import GenerationTaskLink
from app.services.common import create_and_refresh

#: 与既有影片任务一致的 task_kind —— 复用同一个执行器。
VIDEO_TASK_KIND = "video_generation"

#: CAS 渲染的业务关联类型（``relation_type`` 为 String(32)）。
CAS_RENDER_RELATION_TYPE = "cas_shot_render"


class ShotRenderError(Exception):
    """单镜头渲染编排失败（供 API 层翻译为 HTTP）。"""


class JellyfishShotNotFoundError(ShotRenderError):
    """找不到与 CAS 生产镜头对应的 Jellyfish Shot。"""


@dataclass(slots=True)
class RenderStartResult:
    """一次渲染启动的结果。"""

    task_id: str
    job_id: str
    production_shot_id: str
    jellyfish_shot_id: str
    provider: str
    snapshot_fingerprint: str
    attempt: int


async def resolve_jellyfish_shot(
    db: AsyncSession, *, job: CasProductionJob, production_shot: CasProductionShot
) -> Shot:
    """按「导入台账 → 章节 → 镜头序号」解析出 Jellyfish Shot。

    CAS 的 ``source_shot_id``（如 ``SC01``）与 Jellyfish 的 Shot UUID 属于不同键空间，
    且 ``CasProductionShot`` 未持久化二者的关联，因此在渲染时按章节 + 序号解析。
    未导入过该剧集时明确失败，而不是静默跳过持久化。
    """
    ledger = (
        await db.execute(
            select(CasImportLedger).where(
                CasImportLedger.project_id == job.project_id,
                CasImportLedger.episode_id == job.episode_id,
            )
        )
    ).scalars().first()
    if ledger is None or not ledger.chapter_id:
        raise JellyfishShotNotFoundError(
            f"episode {job.episode_id!r} has not been imported into project "
            f"{job.project_id!r}; import it before rendering"
        )

    shot = (
        await db.execute(
            select(Shot)
            .where(Shot.chapter_id == ledger.chapter_id, Shot.index == production_shot.sequence)
            .limit(1)
        )
    ).scalars().first()
    if shot is None:
        raise JellyfishShotNotFoundError(
            f"no Jellyfish shot at index {production_shot.sequence} in chapter "
            f"{ledger.chapter_id!r} for episode {job.episode_id!r}"
        )
    return shot


def build_shot_context(production_shot: CasProductionShot) -> dict[str, Any]:
    """从生产镜头收集可用于提示词的字段（缺失字段自然被跳过）。"""
    return {
        "action": production_shot.video_prompt or production_shot.image_prompt,
        "duration_seconds": production_shot.duration_seconds,
    }


async def count_attempts(db: AsyncSession, *, job_id: str, production_shot_id: str) -> int:
    """已存在的渲染产物数（用于给重试编号，保证可追溯）。"""
    rows = (
        await db.execute(
            select(CasProductionArtifact).where(
                CasProductionArtifact.job_id == job_id,
                CasProductionArtifact.production_shot_id == production_shot_id,
                CasProductionArtifact.artifact_type == ArtifactType.video.value,
            )
        )
    ).scalars().all()
    return len(rows)


def resolve_provider_config(settings: Any) -> tuple[str, str, str | None]:
    """按配置解析 ``(provider, api_key, base_url)``。

    ComfyUI 为自托管、无 API key；未配置地址时明确失败，绝不猜测机器地址，
    也绝不退化到假供应商。
    """
    provider = (getattr(settings, "cas_render_provider", "") or "").strip().lower()
    if not provider:
        raise ShotRenderError("CAS_RENDER_PROVIDER is not configured")
    if provider == "comfyui":
        base_url = (getattr(settings, "cas_comfyui_base_url", None) or "").strip()
        if not base_url:
            raise ShotRenderError(
                "CAS_COMFYUI_BASE_URL is not configured; set it before starting a render"
            )
        return provider, "", base_url
    # 其他供应商沿用 Jellyfish 既有的 Provider/Model 配置通道。
    raise ShotRenderError(
        f"provider {provider!r} must be configured through the existing Jellyfish "
        "provider/model settings; CAS only self-configures 'comfyui'"
    )


def build_run_args(
    *,
    request: RenderRequest,
    jellyfish_shot_id: str,
    provider: str,
    api_key: str,
    base_url: str | None,
    job_id: str,
    attempt: int,
) -> dict[str, Any]:
    """构造既有执行器所需的 run_args。

    只放入可复现所需的最小信息：不含整个 ComfyUI 工作流，不含任何密钥以外的凭据字段
    （api_key 由既有执行器契约要求，ComfyUI 下为空串）。
    """
    return {
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
        "input": request.to_video_input().model_dump(exclude_none=True),
        "shot_id": jellyfish_shot_id,
        # --- CAS 侧关联信息：供执行器完成后登记生产产物 ---
        "cas_job_id": job_id,
        "cas_production_shot_id": request.production_shot_id,
        "cas_source_shot_id": request.shot_id,
        "cas_attempt": attempt,
        "cas_snapshot": request.snapshot,
        "cas_snapshot_fingerprint": snapshot_fingerprint(request.snapshot),
    }


async def attach_render_artifact(
    db: AsyncSession,
    *,
    job_id: str,
    production_shot_id: str,
    file_id: str,
    storage_key: str,
    mime_type: str,
    provider: str,
    provider_task_id: str,
    snapshot: dict[str, Any] | None = None,
    attempt: int = 1,
    size_bytes: int | None = None,
) -> CasProductionArtifact:
    """幂等登记一条视频产物。

    幂等键为 ``(job_id, production_shot_id, artifact_type=video, metadata.file_id)``：
    同一个 FileItem 重复投递只更新既有行，不会新增；不同 FileItem（即新的重试尝试）
    会新增一行，从而**保留**此前成功的产物。

    说明：这里不使用 ``ArtifactManager.register``——它按本地文件计算校验和，而渲染
    产物存放在对象存储中，本地并无该文件。
    """
    existing_rows = (
        await db.execute(
            select(CasProductionArtifact).where(
                CasProductionArtifact.job_id == job_id,
                CasProductionArtifact.production_shot_id == production_shot_id,
                CasProductionArtifact.artifact_type == ArtifactType.video.value,
            )
        )
    ).scalars().all()

    metadata: dict[str, Any] = {
        "file_id": file_id,
        "provider_task_id": provider_task_id,
        "attempt": attempt,
    }
    if size_bytes is not None:
        metadata["size_bytes"] = size_bytes
    if snapshot:
        metadata["request_snapshot"] = snapshot

    for row in existing_rows:
        if (row.metadata_json or {}).get("file_id") == file_id:
            # 重复投递：就地更新，不新增，也不破坏其它尝试的产物。
            row.stage = Stage.video_generation.value
            row.provider = provider
            row.file_path = storage_key
            row.mime_type = mime_type
            row.metadata_json = metadata
            await db.flush()
            return row

    artifact = CasProductionArtifact(
        id=str(uuid.uuid4()),
        job_id=job_id,
        production_shot_id=production_shot_id,
        artifact_type=ArtifactType.video.value,
        stage=Stage.video_generation.value,
        provider=provider,
        provider_model="",
        file_path=storage_key,
        mime_type=mime_type,
        checksum="",  # 对象存储产物：本地无文件可计算校验和
        metadata_json=metadata,
    )
    return await create_and_refresh(db, artifact)


async def link_task_to_shot(db: AsyncSession, *, task_id: str, production_shot_id: str) -> None:
    """用既有的 GenerationTaskLink 记录任务与生产镜头的关联。"""
    db.add(
        GenerationTaskLink(
            task_id=task_id,
            resource_type="video",
            relation_type=CAS_RENDER_RELATION_TYPE,
            relation_entity_id=production_shot_id,
        )
    )
    await db.flush()


def build_request_for_shot(production_shot: CasProductionShot, *, ratio: str = "9:16", seed: int | None = None) -> RenderRequest:
    """由生产镜头构造确定性渲染请求（提示词只在 render_request 层拼装）。"""
    return build_render_request(
        production_shot, context=build_shot_context(production_shot), ratio=ratio, seed=seed
    )


__all__ = [
    "CAS_RENDER_RELATION_TYPE",
    "JellyfishShotNotFoundError",
    "RenderStartResult",
    "ShotRenderError",
    "VIDEO_TASK_KIND",
    "attach_render_artifact",
    "build_request_for_shot",
    "build_run_args",
    "build_shot_context",
    "count_attempts",
    "link_task_to_shot",
    "resolve_jellyfish_shot",
    "resolve_provider_config",
]
