"""后台整场渲染：下载与上传在事务外，成果发布由统一终态锁裁决。"""
import hashlib
from uuid import NAMESPACE_URL, uuid5

from app.core import storage
from app.core.contracts.directing.scene_export import SceneExportSnapshot
from app.models.studio import FileItem, FileUsage
from app.models.task import TaskOutput
from app.services.directing.ai import DirectingOutputError
from app.services.studio.files import require_available_file
from app.services.task_service import TaskService


async def execute_scene_export(sessions, task, render, is_active):
    """只消费冻结输入；取消后不登记成果，遗留上传由现有孤儿清理回收。"""
    snapshot = SceneExportSnapshot.model_validate(task.input_snapshot['scene_export']['snapshot'])
    sources = {}
    for clip in snapshot.content.timeline.items:
        if clip.file_id in sources:
            continue
        if not await is_active():
            return
        try:
            async with sessions() as db:
                file = await require_available_file(db, file_id=clip.file_id, expected_type='video', lock=False)
                key = file.storage_key
            sources[clip.file_id] = await storage.download_file(key=key)
        except Exception as error:
            raise DirectingOutputError(f'片段 {clip.id} 的原素材读取失败，请核实文件后重试原记录') from error
    try:
        content = await render(snapshot.content, sources, snapshot.profile)
    except ValueError as error:
        raise DirectingOutputError(str(error)) from error
    if not await is_active():
        return
    key = f'generated/{task.id}/export.mp4'
    digest = hashlib.sha256(content).hexdigest()
    await storage.upload_file(key=key, data=content, content_type='video/mp4', extra_args={'Metadata': {'sha256': digest}})
    file_id = uuid5(NAMESPACE_URL, f'jellyfish:scene-export:{task.id}').hex
    duration = max(clip.timeline_start_ms + clip.media_range.source_out_ms - clip.media_range.source_in_ms
        for clip in snapshot.content.timeline.items)

    async def deliver(db, current):
        """成功裁决内原子登记完整文件，不在事务内执行存储网络调用。"""
        db.add(FileItem(id=file_id, type='video', name=f'整场导出-{task.id}.mp4', storage_key=key,
            content_type='video/mp4', size_bytes=len(content), content_hash=digest,
            width=snapshot.profile.width, height=snapshot.profile.height, duration_ms=duration))
        await db.flush()
        db.add(TaskOutput(task_id=current.id, ordinal=0, file_id=file_id, delivery_status='published'))
        db.add(FileUsage(file_id=file_id, project_id=current.project_id, usage_kind='generated_video',
            source_ref='scene-export:' + current.id))

    async with sessions() as db:
        await TaskService(db).finish(task.id, result={'file_id': file_id}, deliver=deliver)
        await db.commit()
