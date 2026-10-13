"""整场导出提交与查询，沿用统一任务的文件保护和取消语义。"""
import asyncio

from botocore.exceptions import ClientError
from sqlalchemy import select, delete

from app.core import storage

from app.core.contracts.directing.scene_export import SceneExportRead, SceneExportRequest, SceneExportRetry, SceneExportSnapshot, SceneExportInspection, SceneExportInspect
from app.models.studio import Chapter, FileItem, FileUsage
from app.models.task import Task, TaskOutput
from app.services.directing.scene_export_render import export_profile, inspect_scene_source
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.task_service import TaskService
from app.services.studio.files import require_available_file, delete_file


class SceneExportService(DirectingStore):
    """只导出真实采用；预演占位不转换为虚假媒体。"""

    def _query(self, version_id):
        return select(Task).where(Task.project_id == self.project_id, Task.target_id == version_id,
            Task.kind == 'scene_export', Task.input_snapshot['scene_export']['version_id'].as_string() == version_id)

    async def _read(self, task):
        data = task.input_snapshot['scene_export']
        file = None
        if task.status == 'succeeded':
            output = await self.db.get(TaskOutput, (task.id, 0))
            if output and output.delivery_status == 'published':
                file = await self.db.get(FileItem, output.file_id)
        file_status = 'none' if task.status != 'succeeded' else 'unavailable'
        if file and file.deleted_at is None and file.delete_requested_at is None:
            try:
                info = await storage.get_file_info(key=file.storage_key)
                file_status = 'available' if info.size and info.content_type == 'video/mp4' else 'unavailable'
            except ClientError as error:
                file_status = 'unavailable' if str(error.response.get('Error', {}).get('Code')) in {'404', 'NoSuchKey', 'NotFound'} else 'unknown'
            except Exception:
                file_status = 'unknown'
        return SceneExportRead(task_id=task.id, request_id=data['request']['request_id'], status=task.status, cancel_requested=bool(task.cancel_requested_at),
            error=task.error_message, retry_of_task_id=task.retry_of_task_id, snapshot=SceneExportSnapshot.model_validate(data['snapshot']),
            file_id=file.id if file else None, file_status=file_status,
            file_deleted=bool(file and (file.delete_requested_at is not None or file.deleted_at is not None)),
            download_url=f'/api/v1/studio/files/{file.id}/download' if file_status == 'available' else None)

    async def list_exports(self, sequence_id, version_id):
        """历史导出保留原快照，读取失败不能被解释为无记录。"""
        await self.read_scene_version(sequence_id, version_id)
        tasks = await self.db.scalars(self._query(version_id).order_by(Task.created_at.desc(), Task.id.desc()))
        return [await self._read(task) for task in tasks]

    async def submit_export(self, sequence_id, version_id, body):
        """章节锁串行化另存与提交；原请求优先于当前版本状态校验。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        version = await self.read_scene_version(sequence_id, version_id)
        query = self._query(version_id)
        existing = await self.db.scalar(query.where(
            Task.input_snapshot['scene_export']['request']['request_id'].as_string() == body.request_id))
        if existing is not None:
            if existing.retry_of_task_id or SceneExportRequest.model_validate(existing.input_snapshot['scene_export']['request']) != body:
                raise RevisionConflict('导出请求身份已用于另一份内容')
            return await self._read(existing)
        await self.current_sequence(sequence_id)
        if version.revision != body.expected_revision:
            raise RevisionConflict('方案已变化，请先保存，再导出当前修订')
        if await self.db.scalar(query.where(Task.status.not_in(['succeeded', 'failed', 'cancelled']))):
            raise RevisionConflict('本版本已有导出任务，请先查看或取消该任务')
        items = version.content.timeline.items
        if not items or any(item.kind != 'media' for item in items):
            raise ValueError('导出需要真实采用；请先补齐待拍占位')
        await self.inspect_export(sequence_id, version_id, SceneExportInspect(timeline=version.content.timeline,
            output_aspect_ratio=version.content.output_aspect_ratio, size=body.size))
        snapshot = SceneExportSnapshot(version_id=version_id, revision=version.revision, content=version.content,
            profile=export_profile(version.content.output_aspect_ratio, body.size))
        task = await TaskService(self.db).submit(kind='scene_export', title='导出整场视频',
            target_type='scene_export', target_id=version_id, project_id=self.project_id,
            inputs=[('timeline', index, item.file_id) for index, item in enumerate(items)],
            snapshot={'scene_export': {'version_id': version_id, 'request': body.model_dump(mode='json'),
                'snapshot': snapshot.model_dump(mode='json')}})
        return await self._read(task)


    async def retry_export(self, sequence_id, version_id, task_id, body: SceneExportRetry):
        """原记录重试与导出当前内容分开；新请求仍需属于当前场次。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        await self.read_scene_version(sequence_id, version_id)
        query = self._query(version_id)
        existing = await self.db.scalar(query.where(
            Task.input_snapshot['scene_export']['request']['request_id'].as_string() == body.request_id))
        if existing is not None:
            if existing.retry_of_task_id != task_id or existing.input_snapshot['scene_export']['request'] != body.model_dump(mode='json'):
                raise RevisionConflict('导出请求身份已用于另一份内容')
            return await self._read(existing)
        await self.current_sequence(sequence_id)
        original = await self.db.scalar(query.where(Task.id == task_id))
        if original is None or original.status not in ['failed', 'cancelled']:
            raise ValueError('请选择本版本明确失败或取消的导出记录')
        if await self.db.scalar(query.where(Task.status.not_in(['succeeded', 'failed', 'cancelled']))):
            raise RevisionConflict('本版本已有导出任务，请先查看或取消该任务')
        snapshot = SceneExportSnapshot.model_validate(original.input_snapshot['scene_export']['snapshot'])
        await self.inspect_export(sequence_id, version_id, SceneExportInspect(timeline=snapshot.content.timeline,
            output_aspect_ratio=snapshot.content.output_aspect_ratio, size=snapshot.profile.size), verify_decode=True)
        task = await TaskService(self.db).submit(kind='scene_export', title='重试整场导出',
            target_type='scene_export', target_id=version_id, project_id=self.project_id, retry_of_task_id=original.id,
            inputs=[('timeline', index, clip.file_id) for index, clip in enumerate(snapshot.content.timeline.items)],
            snapshot={'scene_export': {'version_id': version_id, 'request': body.model_dump(mode='json'),
                'snapshot': snapshot.model_dump(mode='json')}})
        return await self._read(task)


    async def inspect_export(self, sequence_id, version_id, body, *, verify_decode=False):
        """实测拟导出片段，只读返回缩放提示，不保存、不生成或自动替换素材。"""
        await self.read_scene_version(sequence_id, version_id)
        profile = export_profile(body.output_aspect_ratio, body.size)
        clips, sources = [], {}
        for clip in body.timeline.items:
            if clip.kind != 'media':
                raise ValueError(f'片段 {clip.id} 仍为待拍占位，请补齐真实媒体')
            try:
                await self.validate_scene_take(sequence_id, clip.take_kind, clip.take_id, clip.file_id)
                await self._range(clip.file_id, clip.media_range)
                if clip.file_id not in sources:
                    file = await require_available_file(self.db, file_id=clip.file_id, expected_type='video', lock=False)
                    sources[clip.file_id] = await storage.download_file(key=file.storage_key)
                clips.append(await asyncio.to_thread(inspect_scene_source, clip.id, sources[clip.file_id], clip.fit, profile,
                    clip.media_range.source_out_ms, clip.media_range.source_in_ms, verify_decode))
            except Exception as error:
                raise ValueError(f'片段 {clip.id} 原媒体读取或区间检查失败，请核实后重试') from error
        return SceneExportInspection(profile=profile, clips=clips)


    async def delete_export_file(self, sequence_id, version_id, task_id):
        """删除明确选中的成果字节；仅解除自身项目归属，其他业务引用继续阻止删除。"""
        await self.read_scene_version(sequence_id, version_id)
        task = await self.db.scalar(self._query(version_id).where(Task.id == task_id))
        if task is None or task.status != 'succeeded':
            raise ValueError('请选择本版本已成功的导出成果')
        output = await self.db.get(TaskOutput, (task.id, 0))
        if output is None or output.delivery_status != 'published':
            raise ValueError('该导出没有已登记成果')
        file = await self.db.get(FileItem, output.file_id, with_for_update=True, populate_existing=True)
        if file is None:
            raise ValueError('成果文件记录已不可用')
        if file.delete_requested_at is None and file.deleted_at is None:
            await self.db.execute(delete(FileUsage).where(FileUsage.file_id == file.id,
                FileUsage.project_id == self.project_id, FileUsage.usage_kind == 'generated_video',
                FileUsage.source_ref == 'scene-export:' + task.id))
            await delete_file(self.db, file_id=file.id)
        return await self._read(task)
