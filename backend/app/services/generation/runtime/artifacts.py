"""将图片、视频 Provider 结果归档为可重复消费的生成产物。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.image_generation import ImageGenerationResult
from app.core.contracts.video_generation import VideoGenerationResult
from app.models.generation_artifacts import GenerationArtifact, GenerationArtifactPublishStatus
from app.models.studio import FileItem
from app.models.types import FileType
from app.utils.files import create_file_from_url_or_b64

ArtifactModality = Literal["image", "video"]


class ArtifactStore:
    """统一归档 Provider 媒体结果，避免业务 TaskLink 承担单一产物存储职责。

    Publisher 尚未介入时，调用方必须传入该结果应有的最终发布状态；纯归档
    结果使用默认的 ``skipped/no_target_slot``。这样 ArtifactStore 既不会写入
    ``GenerationTaskLink.file_id``，也不会创建不满足数据库发布状态约束的中间行。
    """

    async def store_images(
        self,
        db: AsyncSession,
        *,
        task_id: str,
        result: ImageGenerationResult,
        name_prefix: str = "generated-image",
        storage_prefix: str = "generated-images",
        publish_statuses: Sequence[GenerationArtifactPublishStatus] | None = None,
        publish_errors: Sequence[str | None] | None = None,
    ) -> list[GenerationArtifact]:
        """归档图片列表并保留 Provider 返回顺序作为稳定 ordinal。

        重复处理同一 ``task_id`` 时，会先返回已存在的 ``ordinal``，从而不会
        再次下载或创建 FileItem。发布状态由上层在最终事务中确定；未提供时按
        没有自动目标槽位的纯归档规则保存。
        """
        artifacts: list[GenerationArtifact] = []
        for ordinal, image in enumerate(result.images):
            existing = await self._find_existing(db, task_id=task_id, ordinal=ordinal)
            if existing is not None:
                artifacts.append(existing)
                continue

            file_item = await create_file_from_url_or_b64(
                db,
                url=image.url,
                b64_data=image.b64_json,
                name=f"{name_prefix}-{ordinal}",
                prefix=storage_prefix,
            )
            artifacts.append(
                await self._add_file_artifact(
                    db,
                    task_id=task_id,
                    ordinal=ordinal,
                    modality="image",
                    file_item=file_item,
                    provider_result=_image_provider_result(result),
                    publish_status=_status_for(ordinal, publish_statuses),
                    publish_error=_error_for(ordinal, publish_errors, publish_statuses),
                )
            )
        return artifacts

    async def store_video(
        self,
        db: AsyncSession,
        *,
        task_id: str,
        result: VideoGenerationResult,
        name: str = "generated-video",
        storage_prefix: str = "generated-videos",
        url_request_headers: dict[str, str] | None = None,
        httpx_timeout: float | None = None,
        publish_status: GenerationArtifactPublishStatus = GenerationArtifactPublishStatus.skipped,
        publish_error: str | None = "no_target_slot",
    ) -> GenerationArtifact:
        """归档单个视频结果为 ordinal 0，并复用已落库的 ``file_id``。

        Provider 返回 URL 时才下载并创建 FileItem；返回 ``file_id`` 时仅验证其
        是视频素材。无论哪种来源，重复 task 都不会创建第二个 Artifact 或文件。
        """
        existing = await self._find_existing(db, task_id=task_id, ordinal=0)
        if existing is not None:
            return existing

        file_item = await self._resolve_video_file(
            db,
            result=result,
            name=name,
            storage_prefix=storage_prefix,
            url_request_headers=url_request_headers,
            httpx_timeout=httpx_timeout,
        )
        return await self._add_file_artifact(
            db,
            task_id=task_id,
            ordinal=0,
            modality="video",
            file_item=file_item,
            provider_result=_video_provider_result(result),
            publish_status=publish_status,
            publish_error=publish_error,
        )

    async def _find_existing(self, db: AsyncSession, *, task_id: str, ordinal: int) -> GenerationArtifact | None:
        """按数据库幂等键读取已有产物，必须发生在任何外部文件创建前。"""
        statement = select(GenerationArtifact).where(
            GenerationArtifact.task_id == task_id,
            GenerationArtifact.ordinal == ordinal,
        )
        return (await db.execute(statement)).scalar_one_or_none()

    async def _resolve_video_file(
        self,
        db: AsyncSession,
        *,
        result: VideoGenerationResult,
        name: str,
        storage_prefix: str,
        url_request_headers: dict[str, str] | None,
        httpx_timeout: float | None,
    ) -> FileItem:
        """解析视频的既有 FileItem 或一次性下载 URL，拒绝非视频引用。"""
        if result.file_id:
            file_item = await db.get(FileItem, result.file_id)
            if file_item is None:
                raise ValueError(f"video result file_id does not exist: {result.file_id}")
            if file_item.type != FileType.video:
                raise ValueError(f"video result file_id is not a video: {result.file_id}")
            return file_item
        return await create_file_from_url_or_b64(
            db,
            url=result.url,
            name=name,
            prefix=storage_prefix,
            url_request_headers=url_request_headers,
            httpx_timeout=httpx_timeout,
        )

    async def _add_file_artifact(
        self,
        db: AsyncSession,
        *,
        task_id: str,
        ordinal: int,
        modality: ArtifactModality,
        file_item: FileItem,
        provider_result: dict[str, str | None],
        publish_status: GenerationArtifactPublishStatus,
        publish_error: str | None,
    ) -> GenerationArtifact:
        """创建满足 Artifact CHECK 约束的文件产物，且绝不触碰 TaskLink。"""
        _validate_publish_state(publish_status, publish_error)
        artifact = GenerationArtifact(
            id=uuid4().hex,
            task_id=task_id,
            modality=modality,
            ordinal=ordinal,
            file_id=file_item.id,
            provider_result=provider_result,
            publish_status=publish_status,
            publish_error=publish_error,
        )
        db.add(artifact)
        await db.flush()
        return artifact


def _image_provider_result(result: ImageGenerationResult) -> dict[str, str | None]:
    """提取可审计且不包含临时 URL/Base64 的图片 Provider 元数据。"""
    return {
        "provider": str(result.provider),
        "provider_task_id": result.provider_task_id,
        "status": result.status,
    }


def _video_provider_result(result: VideoGenerationResult) -> dict[str, str | None]:
    """提取可审计且不包含临时下载 URL 的视频 Provider 元数据。"""
    return {
        "provider": str(result.provider) if result.provider else None,
        "provider_task_id": result.provider_task_id,
        "status": result.status,
    }


def _status_for(
    ordinal: int,
    statuses: Sequence[GenerationArtifactPublishStatus] | None,
) -> GenerationArtifactPublishStatus:
    """取得指定 ordinal 的发布状态，默认按无目标槽位归档。"""
    if statuses is None:
        return GenerationArtifactPublishStatus.skipped
    try:
        return statuses[ordinal]
    except IndexError as error:
        raise ValueError("publish_statuses must cover every image artifact") from error


def _error_for(
    ordinal: int,
    errors: Sequence[str | None] | None,
    statuses: Sequence[GenerationArtifactPublishStatus] | None,
) -> str | None:
    """取得发布错误码；未传时为纯归档或非主产物提供计划规定的默认值。"""
    status = _status_for(ordinal, statuses)
    if errors is not None:
        try:
            return errors[ordinal]
        except IndexError as error:
            raise ValueError("publish_errors must cover every image artifact") from error
    if status is GenerationArtifactPublishStatus.published:
        return None
    if status is GenerationArtifactPublishStatus.conflicted:
        return "target_version_conflict"
    return "no_target_slot" if ordinal == 0 else "non_primary_artifact"


def _validate_publish_state(status: GenerationArtifactPublishStatus, error: str | None) -> None:
    """在 flush 前复现数据库约束，给调用方提供清晰错误信息。"""
    if status is GenerationArtifactPublishStatus.published and error is None:
        return
    if status is GenerationArtifactPublishStatus.conflicted and error == "target_version_conflict":
        return
    if status is GenerationArtifactPublishStatus.skipped and error:
        return
    raise ValueError("invalid artifact publish status and error combination")
