"""从已保存的单次真实采用提取原素材边界，不自动改变依赖或采用。"""
import asyncio
from datetime import UTC
from io import BytesIO
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select
from starlette.datastructures import Headers

from app.core import storage
from app.core.contracts.directing.scene_end_frame import SceneEndFrameCreate, SceneEndFrameRead
from app.core.contracts.directing.scene_timeline import SceneMediaCutItem
from app.models.directing import SceneEndFrameRecord
from app.models.studio import Chapter, FileItem
from app.services.directing.media import extract_boundary_frame
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.studio.files import require_available_file, upload_file
from app.services.directing.scene_cut_evidence import scene_frame_basis


class SceneEndFrameService(DirectingStore):
    """固定提取证据，并按原请求核实响应丢失后的结果。"""

    async def _read(self, row, content):
        request = SceneEndFrameCreate.model_validate(row.request)
        clip = SceneMediaCutItem.model_validate(row.clip)
        current = next((item for item in content.timeline.items if item.id == clip.id), None)
        file = await self.db.get(FileItem, row.file_id)
        available = bool(file and file.type == 'image' and file.deleted_at is None and file.delete_requested_at is None)
        return SceneEndFrameRead(id=row.id, version_id=row.version_id, request_id=row.request_id,
            revision=request.expected_revision, clip=clip, file_id=row.file_id, at_ms=row.at_ms,
            source=self.scene_frame_source(row),
            created_at=row.created_at.replace(tzinfo=UTC) if row.created_at.tzinfo is None else row.created_at,
            matches_current=scene_frame_basis(clip) == scene_frame_basis(current), available=available,
            image_url=f'/api/v1/studio/files/{row.file_id}/download' if available else None)

    async def list_end_frames(self, sequence_id, version_id):
        """旧采用变化后仍保留原图和来源，不重定向至最新采用。"""
        version = await self.read_scene_version(sequence_id, version_id)
        rows = await self.db.scalars(select(SceneEndFrameRecord).where(
            SceneEndFrameRecord.version_id == version_id).order_by(SceneEndFrameRecord.created_at, SceneEndFrameRecord.id))
        return [await self._read(row, version.content) for row in rows]

    async def create_end_frame(self, sequence_id, version_id, body):
        """先恢复原请求，再验证当前保存修订，提取区间内最后一个实际解码帧。"""
        sequence = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        version = await self.read_scene_version(sequence_id, version_id)
        existing = await self.db.scalar(select(SceneEndFrameRecord).where(
            SceneEndFrameRecord.version_id == version_id, SceneEndFrameRecord.request_id == body.request_id))
        if existing is not None:
            if SceneEndFrameCreate.model_validate(existing.request) != body:
                raise RevisionConflict('提帧请求身份已用于另一段采用')
            return await self._read(existing, version.content)
        await self.current_sequence(sequence_id)
        if version.revision != body.expected_revision:
            raise RevisionConflict('方案已变化，请重新保存并选择真实采用')
        clip = next((item for item in version.content.timeline.items if item.id == body.clip_id), None)
        if clip is None or clip.kind != 'media':
            raise ValueError('请选择已保存的真实采用；待拍占位不能提取落幅')
        await self.validate_scene_take(sequence_id, clip.take_kind, clip.take_id, clip.file_id)
        await self._range(clip.file_id, clip.media_range)
        file = await require_available_file(self.db, file_id=clip.file_id, expected_type='video')
        video = await storage.download_file(key=file.storage_key)
        frame, at_ms = await asyncio.to_thread(extract_boundary_frame, video,
            clip.media_range.source_in_ms, clip.media_range.source_out_ms, 'end')
        identity = uuid4().hex
        result = await upload_file(self.db,
            file=UploadFile(file=BytesIO(frame), filename=f'frame-{at_ms}.png', size=len(frame),
                headers=Headers({'content-type': 'image/png'})),
            project_id=self.project_id, chapter_id=sequence.chapter_id,
            usage_kind='directing_reference', source_ref='scene-end-frame:' + identity)
        row = SceneEndFrameRecord(id=identity, version_id=version_id, request_id=body.request_id,
            request=body.model_dump(mode='json'), clip=clip.model_dump(mode='json'), file_id=result.id, at_ms=at_ms)
        self.db.add(row)
        await self.protect_scene_review_files(sequence, row.clip, 'scene-end-frame:' + identity)
        await self.db.flush()
        return await self._read(row, version.content)
