"""StorageOperationOutbox 的最小媒体物化 Worker。"""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Awaitable, Callable, Iterable
from typing import Protocol
import base64

import httpx
from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.provider_operation import ProviderOperationRemoteReceipt
from app.core.contracts.storage_operation import StorageOperationKind
from app.core.storage import StoredFileInfo
from app.models.provider_operations import ProviderOperation
from app.models.generation_artifacts import GenerationArtifact
from app.models.generation_runs import GenerationRun
from app.models.task import GenerationTask
from app.core.contracts.generation import ResolvedGenerationSnapshot
from app.services.studio.image_task_runner import execute_snapshot_image_generation
from app.services.film.generated_video import execute_snapshot_video_generation
from app.services.generation.storage.repository import StorageOperationOutboxRepository


@dataclass(frozen=True)
class MaterializeSource:
    """受控来源解析后得到的媒体字节，不携带可持久化的临时下载地址。"""

    data: bytes
    content_type: str | None = None


class MaterializeSourceResolver(Protocol):
    """按安全 payload 中的受控标识解析媒体字节。"""

    async def resolve(self, *, payload: dict[str, object], blob_id: str) -> MaterializeSource:
        """返回可上传的字节；实现方可在进程内使用短命 Provider 凭据。"""


@dataclass(frozen=True)
class ProviderReceiptSourceRequest:
    """交给 Provider 字节适配器的最小受控上下文。

    不公开 Provider 原始响应、路由 URL 或密钥；适配器只能利用自身运行期配置，按
    ``provider_key`` 和白名单 receipt 重新取得媒体字节。
    """

    provider_key: str
    receipt: ProviderOperationRemoteReceipt
    operation_kind: str
    task_id: str
    snapshot: ResolvedGenerationSnapshot
    ordinal: int
    db: AsyncSession


class ProviderReceiptBytesAdapter(Protocol):
    """为一个明确 Provider 实现 receipt 到媒体字节的运行期解析。"""

    @property
    def provider_key(self) -> str:
        """返回此适配器负责的稳定 Provider 身份。"""

    async def resolve_bytes(self, *, request: ProviderReceiptSourceRequest) -> MaterializeSource:
        """使用运行期凭据和远端 ID 获取媒体字节，绝不向持久层返回临时 URL。"""


class UnsupportedProviderReceiptSourceError(RuntimeError):
    """Provider 没有经过验证的 receipt-to-bytes 适配器，禁止猜测下载方式。"""


class ProviderReceiptSourceRegistry:
    """按稳定 Provider 身份选择受控字节适配器，不提供默认或回退实现。"""

    def __init__(self, *, adapters: Iterable[ProviderReceiptBytesAdapter] = ()) -> None:
        """登记显式适配器；重复 Provider 身份会在启动时失败，避免路由不确定性。"""
        self._adapters: dict[str, ProviderReceiptBytesAdapter] = {}
        for adapter in adapters:
            provider_key = adapter.provider_key.strip().casefold()
            if not provider_key:
                raise ValueError("provider receipt bytes adapter must declare provider_key")
            if provider_key in self._adapters:
                raise ValueError(f"duplicate provider receipt bytes adapter: {provider_key}")
            self._adapters[provider_key] = adapter

    async def resolve(self, *, request: ProviderReceiptSourceRequest) -> MaterializeSource:
        """委派给精确匹配的适配器；未知 Provider 明确失败而不是尝试临时 URL。"""
        provider_key = request.provider_key.strip().casefold()
        adapter = self._adapters.get(provider_key)
        if adapter is None:
            raise UnsupportedProviderReceiptSourceError(
                f"no receipt-backed bytes adapter is registered for provider: {provider_key or '<empty>'}"
            )
        return await adapter.resolve_bytes(request=request)


class ProviderReceiptMaterializeSourceResolver:
    """从 materialize payload 读取 ProviderOperation 白名单 receipt 并解析媒体字节。"""

    def __init__(self, *, db: AsyncSession, registry: ProviderReceiptSourceRegistry) -> None:
        """绑定短事务会话与显式 Provider 适配器注册表。"""
        self._db = db
        self._registry = registry

    async def resolve(self, *, payload: dict[str, object], blob_id: str) -> MaterializeSource:
        """校验 payload，读取受控 receipt，并拒绝未受理或未注册 Provider。"""
        provider_operation_id = _provider_operation_id_from_payload(payload)
        operation = await self._db.get(ProviderOperation, provider_operation_id)
        if operation is None:
            raise LookupError(f"provider operation does not exist: {provider_operation_id}")
        receipt = ProviderOperationRemoteReceipt.from_storage_value(operation.remote_receipt)
        if receipt is None:
            raise ValueError(f"provider operation has no controlled remote receipt: {provider_operation_id}")
        artifact = await self._db.scalar(select(GenerationArtifact).where(GenerationArtifact.blob_id == blob_id))
        if artifact is None or artifact.generation_run_id != operation.attempt_id:
            raise LookupError(f"materialize blob is not owned by provider operation: {blob_id}")
        run = await self._db.get(GenerationRun, operation.attempt_id)
        if run is None:
            raise LookupError(f"provider operation run does not exist: {operation.attempt_id}")
        task = await self._db.get(GenerationTask, run.task_id)
        snapshot_payload = (task.payload or {}).get("snapshot") if task is not None else None
        if not isinstance(snapshot_payload, dict):
            raise ValueError(f"provider operation task snapshot is unavailable: {operation.attempt_id}")
        return await self._registry.resolve(
            request=ProviderReceiptSourceRequest(
                provider_key=operation.provider_key,
                receipt=receipt,
                operation_kind=operation.operation_kind,
                task_id=run.task_id,
                snapshot=ResolvedGenerationSnapshot.model_validate(snapshot_payload),
                ordinal=artifact.ordinal,
                db=self._db,
            )
        )


def _provider_operation_id_from_payload(payload: dict[str, object]) -> str:
    """在执行边界重复校验持久化 payload，防止历史脏数据绕过 enqueue 护栏。"""
    if set(payload) != {"provider_operation_id"}:
        raise ValueError("materialize payload must contain only provider_operation_id")
    provider_operation_id = payload["provider_operation_id"]
    if not isinstance(provider_operation_id, str) or not provider_operation_id.strip():
        raise ValueError("materialize payload provider_operation_id must be a non-empty string")
    return provider_operation_id.strip()


class GenerationProviderReceiptBytesAdapter:
    """通过现有图片/视频生成基类按受控 receipt 重取并下载单个媒体结果。"""

    def __init__(self, *, provider_key: str) -> None:
        """绑定一个显式 Provider 身份，避免未知 Provider 获得默认下载路径。"""
        self._provider_key = provider_key

    @property
    def provider_key(self) -> str:
        """返回此适配器唯一负责的 Provider 身份。"""
        return self._provider_key

    async def resolve_bytes(self, *, request: ProviderReceiptSourceRequest) -> MaterializeSource:
        """按远端 ID 重取结果，并只在当前进程内将对应 ordinal 转为媒体字节。"""
        if request.operation_kind == "image_generation":
            result = await execute_snapshot_image_generation(
                request.db,
                task_id=request.task_id,
                snapshot=request.snapshot,
                provider_task_id=request.receipt.remote_id,
            )
            try:
                image = result.images[request.ordinal]
            except IndexError as error:
                raise RuntimeError("provider result does not contain expected image ordinal") from error
            if image.b64_json:
                return MaterializeSource(data=_decode_image_base64(image.b64_json), content_type="image/png")
            if image.url:
                return await _download_source(url=image.url)
            raise RuntimeError("provider image result has no retrievable content")
        if request.operation_kind == "video_generation":
            result, config = await execute_snapshot_video_generation(
                request.db,
                task_id=request.task_id,
                snapshot=request.snapshot,
                provider_task_id=request.receipt.remote_id,
            )
            if not result.url:
                raise RuntimeError("provider video result has no retrievable URL")
            headers = {"Authorization": f"Bearer {config.api_key}"} if config.provider == "openai" else None
            return await _download_source(url=result.url, headers=headers)
        raise RuntimeError(f"unsupported materialize operation: {request.operation_kind}")


def default_provider_receipt_source_registry() -> ProviderReceiptSourceRegistry:
    """返回项目已验证可按 receipt 重取结果的 Provider 适配器集合。"""
    return ProviderReceiptSourceRegistry(
        adapters=[GenerationProviderReceiptBytesAdapter(provider_key=key) for key in ("openai", "volcengine", "vidu", "kling")]
    )


def _decode_image_base64(value: str) -> bytes:
    """解码 Provider 返回的原始或 data-URL Base64，不把正文持久化到 outbox。"""
    encoded = value.split(";base64,", 1)[-1] if value.startswith("data:") else value
    return base64.b64decode(encoded)


async def _download_source(*, url: str, headers: dict[str, str] | None = None) -> MaterializeSource:
    """在 Worker 运行期下载临时来源，结果仅交给固定 key 上传步骤。"""
    async with httpx.AsyncClient(timeout=600.0) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
    return MaterializeSource(data=response.content, content_type=response.headers.get("Content-Type"))


class ObjectStorageGateway(Protocol):
    """物化 Worker 所需的固定 key 上传与 HEAD 最小存储接口。"""

    async def upload_file(self, *, key: str, data: bytes, content_type: str | None = None) -> StoredFileInfo:
        """将内容上传到稳定 key。"""

    async def get_file_info(self, *, key: str) -> StoredFileInfo:
        """对稳定 key 执行 HEAD，返回可绑定的对象元数据。"""

    async def delete_file(self, *, key: str) -> None:
        """删除固定 key 的对象；调用方负责在成功后更新数据库状态。"""


class MediaMaterializeWorker:
    """领取一个安全的 materialize 意图，上传固定 key 后用 HEAD 元数据完成绑定。"""

    def __init__(
        self,
        *,
        source_resolver: MaterializeSourceResolver,
        storage: ObjectStorageGateway,
        on_materialized: Callable[[AsyncSession, str], Awaitable[None]] | None = None,
    ) -> None:
        """注入受控来源解析器和对象存储网关，避免将 Provider URL 写入数据库。"""
        self._source_resolver = source_resolver
        self._storage = storage
        self._on_materialized = on_materialized

    async def execute_next(self, *, db: AsyncSession, owner: str, lease_ttl_seconds: int = 120) -> str | None:
        """执行一条可领取物化操作，返回已处理的 outbox ID；空闲时返回 None。"""
        repository = StorageOperationOutboxRepository(db)
        lease = await repository.claim_next_materialize(owner=owner, ttl_seconds=lease_ttl_seconds)
        if lease is None:
            return None
        try:
            source = await self._source_resolver.resolve(payload=lease.payload, blob_id=lease.blob_id)
            await self._storage.upload_file(
                key=lease.storage_key,
                data=source.data,
                content_type=source.content_type or lease.content_type,
            )
            info = await self._storage.get_file_info(key=lease.storage_key)
            await repository.complete_materialization(
                lease=lease,
                size_bytes=info.size,
                content_type=info.content_type or source.content_type,
                etag=info.etag,
            )
            if self._on_materialized is not None:
                await self._on_materialized(db, lease.blob_id)
            return lease.operation_id
        except Exception as exc:
            await repository.release_for_retry(
                lease=lease,
                error_code="materialize_failed",
                error=f"{type(exc).__name__}: {exc}",
            )
            raise


class MediaDeleteWorker:
    """领取 delete outbox，在对象删除成功后才将 Blob 标记为 deleted。"""

    def __init__(self, *, storage: ObjectStorageGateway) -> None:
        """注入对象存储网关，确保删除 I/O 不出现在业务数据库事务内。"""
        self._storage = storage

    async def execute_next(self, *, db: AsyncSession, owner: str, lease_ttl_seconds: int = 120) -> str | None:
        """执行一条可恢复的删除意图，空闲时返回 None。"""
        repository = StorageOperationOutboxRepository(db)
        lease = await repository.claim_next(
            operation_kind=StorageOperationKind.delete,
            owner=owner,
            ttl_seconds=lease_ttl_seconds,
        )
        if lease is None:
            return None
        try:
            await self._storage.delete_file(key=lease.storage_key)
            await repository.complete_deletion(lease=lease)
            return lease.operation_id
        except Exception as exc:
            await repository.release_for_retry(
                lease=lease,
                error_code="delete_failed",
                error=f"{type(exc).__name__}: {exc}",
            )
            raise


__all__ = [
    "MaterializeSource",
    "MaterializeSourceResolver",
    "ProviderReceiptBytesAdapter",
    "GenerationProviderReceiptBytesAdapter",
    "ProviderReceiptMaterializeSourceResolver",
    "ProviderReceiptSourceRegistry",
    "ProviderReceiptSourceRequest",
    "MediaMaterializeWorker",
    "MediaDeleteWorker",
    "ObjectStorageGateway",
    "UnsupportedProviderReceiptSourceError",
    "default_provider_receipt_source_registry",
]
