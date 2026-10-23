"""媒体执行准备、文件收取和业务交付；网络等待始终位于数据库事务之外。"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import mimetypes
from tempfile import SpooledTemporaryFile
from uuid import NAMESPACE_URL, uuid5

import httpx
from botocore.exceptions import ClientError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.contracts.generation import FrozenGenerationConfig, GenerationTargetKind, ResolvedGenerationSnapshot
from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.provider_media import ProviderImageInput, ProviderImageReference, ProviderVideoFrames, ProviderVideoInput, ProviderVideoSubject
from app.core.integrations.media_provider import MediaResult, ProviderDataError
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task, TaskInput, TaskOutput
from app.models.studio_prompts_files_timeline import FileItem
from app.services.generation.task_snapshot import restore_snapshot
from app.services.generation.publishers import AssetImagePublisher
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.task_service import TaskService, utcnow


async def load_media_context(db: AsyncSession, task: Task) -> tuple[ProviderConfig, ResolvedGenerationSnapshot, dict[str, FileItem]]:
    """在短事务内读取路由与文件元信息，不在会话内发起下载或供应商请求。"""
    if task.target_type == 'canvas_node':
        frozen = FrozenGenerationConfig.model_validate(task.input_snapshot.get('execution_config'))
        provider_config = ProviderConfig(provider=frozen.provider_key, api_key=frozen.api_key, base_url=frozen.base_url)
    else:
        provider = await db.get(Provider, task.provider_id) if task.provider_id else None
        if provider is None:
            raise ProviderDataError("provider_missing")
        category = ModelCategoryKey.image if task.kind == "image_generation" else ModelCategoryKey.video
        config = resolve_provider_config_from_provider(provider=provider, category=category)
        if config.provider_key != task.input_snapshot.get("provider_key"):
            raise ProviderDataError("provider_route_changed")
        provider_config = ProviderConfig(provider=config.provider_key, api_key=config.api_key, base_url=config.base_url)
    relations = list(await db.scalars(select(TaskInput).where(TaskInput.task_id == task.id)))
    files = list(await db.scalars(select(FileItem).where(FileItem.id.in_({item.file_id for item in relations})))) if relations else []
    by_id = {file.id: file for file in files}
    if any(item.file_id not in by_id for item in relations):
        raise ProviderDataError("input_file_missing")
    if any(file.deleted_at is not None or file.delete_requested_at is not None for file in files):
        raise ProviderDataError("input_file_deleted")
    snapshot = restore_snapshot(task, [(item, by_id[item.file_id]) for item in relations])
    return provider_config, snapshot, by_id


async def build_media_input(task: Task, snapshot: ResolvedGenerationSnapshot, files: dict[str, FileItem]) -> ProviderImageInput | ProviderVideoInput:
    """下载输入文件并构造执行期契约，调用方必须已退出数据库会话。"""
    urls = {}
    for file in files.values():
        content = await storage.download_file(key=file.storage_key)
        if not content:
            raise ProviderDataError("input_file_empty")
        content_type = file.content_type
        if not content_type or content_type == "application/octet-stream":
            content_type = mimetypes.guess_type(file.storage_key)[0]
            if not content_type:
                content_type = (await storage.get_file_info(key=file.storage_key)).content_type
        if not content_type or not content_type.startswith(f"{file.type}/"):
            raise ProviderDataError("input_file_type_mismatch")
        urls[file.id] = f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}"
    model_name = task.input_snapshot.get("model_name")
    if not model_name:
        raise ProviderDataError("model_name_missing")
    operation = snapshot.operation_input
    if task.kind == "image_generation":
        media = snapshot.media
        if media is not None and not isinstance(media, ImageMediaInput):
            raise ProviderDataError("image_references_invalid")
        return ProviderImageInput(
            prompt=snapshot.execution_prompt, model=model_name, n=operation.count,
            target_ratio=operation.target_ratio, resolution_profile=operation.resolution_profile,
            purpose="asset_image" if snapshot.canonical_target.kind == GenerationTargetKind.asset_image_slot else "video_reference",
            images=[ProviderImageReference(image_url=urls[ref.file_id]) for ref in sorted(media.references, key=lambda ref: ref.ordinal)] if media else [],
        )
    media = snapshot.media
    if media is not None and not isinstance(media, VideoMediaInput):
        raise ProviderDataError("video_references_invalid")
    frames = ProviderVideoFrames()
    subjects = []
    if media:
        frames = ProviderVideoFrames(
            first_frame=urls[media.frames.first.file_id] if media.frames.first else None,
            last_frame=urls[media.frames.last.file_id] if media.frames.last else None,
            key_frames=[urls[ref.file_id] for ref in sorted(media.frames.keys, key=lambda ref: ref.ordinal)],
        )
        for subject in media.subjects:
            refs = sorted(subject.media, key=lambda ref: ref.ordinal)
            subjects.append(ProviderVideoSubject(name=subject.name,
                images=[urls[ref.file_id] for ref in refs if ref.media_kind == "image"],
                videos=[urls[ref.file_id] for ref in refs if ref.media_kind == "video"],
            ))
    return ProviderVideoInput(prompt=snapshot.execution_prompt, model=model_name, ratio=operation.ratio,
                              seconds=operation.seconds, seed=operation.seed, frame_references=frames, subject_references=subjects)


async def store_media_output(sessions, client: httpx.AsyncClient, *, task_id: str, ordinal: int, kind: str, output: MediaResult) -> None:
    """以稳定对象 key 收取文件；完成上传后才在短事务登记文件与输出关系。"""
    file_id = uuid5(NAMESPACE_URL, f"jellyfish:{task_id}:{ordinal}").hex
    key = f"generated/{task_id}/{ordinal}"
    async with sessions() as db:
        if await db.get(TaskOutput, (task_id, ordinal)) is not None:
            return
        task = await db.get(Task, task_id)
        measure_duration = task is not None and task.target_type in {"directing_unit", "scene_video"}
    try:
        info = await storage.get_file_info(key=key)
    except ClientError as error:
        if str(error.response.get("Error", {}).get("Code")) not in {"404", "NoSuchKey", "NotFound"}:
            raise
        info = None
    content_type = "image/png" if kind == "image_generation" else "video/mp4"
    content_hash = None
    duration_ms = None
    if info is not None:
        if not info.size or not info.content_type:
            raise ProviderDataError("stored_output_incomplete")
        size, content_type = info.size, info.content_type
        expected_type = "image" if kind == "image_generation" else "video"
        if not content_type.startswith(f"{expected_type}/"):
            raise ProviderDataError("stored_output_type_mismatch")
        content_hash = (info.extra or {}).get("Metadata", {}).get("sha256")
        if measure_duration:
            from app.services.directing.media import probe_duration
            with SpooledTemporaryFile(max_size=8 * 1024 * 1024) as measured:
                measured.write(await storage.download_file(key=key))
                duration_ms = await asyncio.to_thread(probe_duration, measured)
    else:
        with SpooledTemporaryFile(max_size=8 * 1024 * 1024) as target:
            digest = hashlib.sha256()
            size = 0
            if output.b64_json:
                content = base64.b64decode(output.b64_json, validate=True)
                target.write(content)
                digest.update(content)
                size = len(content)
            elif output.url:
                async with client.stream("GET", output.url, headers=output.headers, follow_redirects=True) as response:
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", content_type).split(";", 1)[0]
                    async for chunk in response.aiter_bytes():
                        target.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
            else:
                raise ProviderDataError("provider_output_data_missing")
            if not size:
                raise ProviderDataError("provider_output_empty")
            expected_type = "image" if kind == "image_generation" else "video"
            if not content_type.startswith(f"{expected_type}/"):
                raise ProviderDataError("provider_output_type_mismatch")
            content_hash = digest.hexdigest()
            target.seek(0)
            if measure_duration:
                from app.services.directing.media import probe_duration
                duration_ms = await asyncio.to_thread(probe_duration, target)
            await storage.upload_file(key=key, data=target, content_type=content_type,
                                      extra_args={"Metadata": {"sha256": content_hash}})
    async with sessions() as db:
        file = await db.get(FileItem, file_id)
        if file is None:
            file = FileItem(id=file_id, type="image" if kind == "image_generation" else "video",
                            name=f"{task_id}-{ordinal}", storage_key=key, content_type=content_type,
                            size_bytes=size, content_hash=content_hash, duration_ms=duration_ms)
            db.add(file)
            await db.flush()
        relation = await TaskService(db).add_output(task_id, ordinal=ordinal, file_id=file.id)
        if relation is None:
            file.delete_requested_at = utcnow()
        await db.commit()


async def deliver_media(db: AsyncSession, task: Task) -> None:
    """仅在 TaskService.finish 持有任务锁的事务中进行业务 CAS 发布。"""
    relations = (await db.execute(select(TaskInput, FileItem).join(FileItem, FileItem.id == TaskInput.file_id)
                                 .where(TaskInput.task_id == task.id))).all()
    snapshot = restore_snapshot(task, relations)
    outputs = list(await db.scalars(select(TaskOutput).where(TaskOutput.task_id == task.id)))
    if snapshot.canonical_target.kind == GenerationTargetKind.canvas_node:
        # Formal ResultSet/current publication is part of TaskService's terminal canvas fact hook.
        for output in outputs:
            output.delivery_status = 'published'
            output.delivery_reason = 'canvas_history'
        return
    if snapshot.canonical_target.kind == GenerationTargetKind.scene_video:
        from app.services.directing.store import DirectingStore
        store = DirectingStore(db, task.project_id)
        for output in outputs:
            await store.register_scene_take(task, output)
            output.delivery_status = 'published'
            output.delivery_reason = 'candidate_take'
        return
    if snapshot.canonical_target.kind == GenerationTargetKind.directing_unit:
        from app.services.directing.store import DirectingStore

        store = DirectingStore(db, task.project_id)
        for output in outputs:
            await store.register_take(prompt_revision_id=snapshot.prompt_revision_id, task_id=task.id,
                                      output_ordinal=output.ordinal, delivery_task=task)
            output.delivery_status = "published"
            output.delivery_reason = "candidate_take"
        return
    if snapshot.canonical_target.kind == GenerationTargetKind.directing_image:
        from app.services.directing.store import DirectingStore
        from app.services.studio.file_usages import upsert_file_usage

        store = DirectingStore(db, task.project_id)
        design = await store.revision(task.target_id, kind="design", confirmed=True)
        sequence = await store.sequence(design.sequence_id)
        for output in outputs:
            await upsert_file_usage(db, file_id=output.file_id, project_id=task.project_id, chapter_id=sequence.chapter_id,
                usage_kind="directing_reference", source_ref="image-task:" + task.id)
            output.delivery_status = "published"
            output.delivery_reason = "candidate_reference"
        return
    publishers = {
        GenerationTargetKind.asset_image_slot: AssetImagePublisher,
    }
    publisher = publishers.get(snapshot.canonical_target.kind)
    if publisher is None:
        for output in outputs:
            output.delivery_status = "skipped"
            output.delivery_reason = "experiment_result"
        return
    await publisher().publish_terminal(db, snapshot=snapshot, artifacts=outputs)
