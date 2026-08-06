from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import (
    GenerationOperation,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult, InputImageRef
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.provider_operation import ProviderCreateUncertainError
from app.core.tasks import ImageGenerationTask
from app.models.llm import Model, ModelCategoryKey, Provider
from app.services.generation.files import FileResolver
from app.services.generation.runtime.delivery import validate_workflow_execution
from app.services.llm.provider_resolver import resolve_provider_config_from_provider


class _CreateOnlyTask:
    """仅用于 TaskManager.create：提供 __class__.__name__，避免传入 lambda。"""

    async def run(self, *args: object, **kwargs: object):  # noqa: ANN001, ANN003
        return None

    async def status(self) -> dict[str, object]:
        return {}

    async def is_done(self) -> bool:
        return False

    async def get_result(self) -> object:
        return None


async def _resolve_snapshot_provider_config(
    session: AsyncSession,
    *,
    snapshot: ResolvedGenerationSnapshot,
) -> ProviderConfig:
    """在执行期读取当前图片模型与 Provider，保证使用最新配置和密钥。"""
    model = await _resolve_current_image_model(session, snapshot=snapshot)
    provider = await session.get(Provider, model.provider_id)
    if provider is None:
        raise RuntimeError("image generation provider is unavailable")
    resolved = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.image)
    return ProviderConfig(
        provider=resolved.provider_key,  # type: ignore[arg-type]
        api_key=resolved.api_key,
        base_url=resolved.base_url,
    )


async def _resolve_current_image_model(session: AsyncSession, *, snapshot: ResolvedGenerationSnapshot) -> Model:
    """解析任务指定的当前图片模型，拒绝删除或跨模态配置。"""
    model = await session.get(Model, snapshot.model_id)
    if model is None or model.category != ModelCategoryKey.image:
        raise RuntimeError("image generation model is unavailable")
    return model


async def _resolve_snapshot_image_input(
    session: AsyncSession,
    *,
    task_id: str,
    snapshot: ResolvedGenerationSnapshot,
) -> ImageGenerationInput:
    """将安全的 ``file_id`` 参考图投影为旧 Provider adapter 的内存 Data URL。

    ``InputImageRef`` 的公共契约只允许 ``file_id``。旧 adapter 仍需要 URL 形式
    的参考图，因此这里有意使用 ``model_construct`` 创建仅在当前进程存活的兼容
    对象；媒体正文不会回写到任务 payload、Artifact 元数据或日志。
    """
    operation_input = snapshot.operation_input
    if not isinstance(operation_input, ImageGenerationOperationInput):
        raise RuntimeError("image generation snapshot operation is unavailable")
    if not snapshot.execution_prompt:
        raise RuntimeError("image generation snapshot prompt is unavailable")
    model = await _resolve_current_image_model(session, snapshot=snapshot)

    references: list[InputImageRef] = []
    in_memory_image_urls: list[str] = []
    media = snapshot.media
    if media is not None:
        if not hasattr(media, "references"):
            raise RuntimeError("image generation snapshot media is invalid")
        resolver = FileResolver(session)
        for reference in media.references:
            resolved = await resolver.resolve_task_reference(task_id=task_id, reference=reference)
            content_type = resolved.content_type or "image/png"
            if not content_type.startswith("image/"):
                raise RuntimeError(f"resolved media type mismatch for file_id={reference.file_id}")
            data_url = f"data:{content_type};base64,{base64.b64encode(resolved.content).decode('ascii')}"
            # 先保留合法 file_id 通过外层 Pydantic 嵌套校验，再在返回前清空它，
            # 避免 OpenAI adapter 同时把项目 FileItem ID 当作供应商 file_id 发送。
            references.append(InputImageRef.model_construct(file_id=reference.file_id))
            in_memory_image_urls.append(data_url)

    purpose = "asset_image" if snapshot.canonical_target.kind is GenerationTargetKind.asset_image_slot else "video_reference"
    input_ = ImageGenerationInput(
        prompt=snapshot.execution_prompt,
        model=model.name,
        images=references,
        target_ratio=operation_input.target_ratio,
        resolution_profile=operation_input.resolution_profile,
        purpose=purpose,
        n=operation_input.count,
    )
    for reference, data_url in zip(input_.images, in_memory_image_urls):
        reference.file_id = None  # type: ignore[assignment]
        object.__setattr__(reference, "image_url", data_url)
    return input_


async def execute_snapshot_image_generation(
    session: AsyncSession,
    *,
    task_id: str,
    snapshot: ResolvedGenerationSnapshot,
    provider_task_id: str | None = None,
    on_provider_accepted: Callable[[str], Awaitable[bool]] | None = None,
) -> ImageGenerationResult:
    """执行或恢复图片 Provider；异步任务在轮询前持久化其供应商 ID。"""
    await validate_workflow_execution(
        session,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=snapshot,
    )
    provider_config = await _resolve_snapshot_provider_config(session, snapshot=snapshot)
    input_ = await _resolve_snapshot_image_input(session, task_id=task_id, snapshot=snapshot)
    provider_task = ImageGenerationTask(provider_config=provider_config, input_=input_)
    if provider_task_id is None:
        try:
            accepted_id = await provider_task.create_provider_task()
        except Exception as error:  # noqa: BLE001 - 无 receipt 的 create 不能被当作普通可重试失败。
            raise ProviderCreateUncertainError(f"image provider create outcome is uncertain: {error}") from error
    else:
        accepted_id = provider_task_id
    if accepted_id and provider_task_id is None and on_provider_accepted and not await on_provider_accepted(accepted_id):
        raise RuntimeError("generation run lost provider acceptance lease")
    result = await provider_task.poll_provider_task(provider_task_id=accepted_id)
    return result
