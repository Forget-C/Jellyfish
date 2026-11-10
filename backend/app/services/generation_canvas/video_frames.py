"""从画布内固定视频来源准备独立帧素材；不编辑画布文档。"""
import asyncio
import hashlib
import json
import subprocess
from io import BytesIO
from tempfile import TemporaryFile

from botocore.exceptions import ClientError

from app.core import storage
from app.models.studio import FileItem
from app.models.types import FileType
from app.schemas.generation_canvas import CanvasVideoFrameOrigin, CanvasVideoFrameRequest, ImageContentCard
from app.services.common.crud import create_and_refresh
from app.services.directing.media import extract_boundary_frame, probe_duration
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.historical_content import CanvasHistoricalContent
from app.services.generation_canvas.store import CanvasStore
from app.services.studio.file_usages import upsert_file_usage
from app.services.studio.files import require_available_file


def _identity(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:32]


def _frame_file_id(canvas_id: str, card_id: str, origin: CanvasVideoFrameOrigin) -> str:
    # 文件 ID 由服务端以固定来源及新卡身份派生，防止以任意项目图片伪造来源。
    return _identity('canvas-frame-file', canvas_id, card_id, origin.model_dump())


def _frame_at_position(content: bytes, at_ms: int) -> bytes:
    # The player displays the frame active at the cursor, including the final
    # frame when the requested position follows its presentation timestamp.
    with TemporaryFile() as video:
        video.write(content)
        duration = probe_duration(video, exclusive_end=True)
    if at_ms >= duration:
        raise ValueError('所选位置超出视频时长')
    frame, _ = extract_boundary_frame(content, 0, at_ms + 1, 'end')
    return frame


def validate_video_frame_origin(canvas_id: str, card, previous: dict | None) -> None:
    """选帧图片和来源一起固定；校验不依赖原视频的当前可用性。"""
    origin = getattr(card, 'frame_origin', None)
    previous_origin = previous.get('frame_origin') if previous else None
    if previous and previous_origin != (origin.model_dump() if origin else None):
        raise diagnostic('IMMUTABLE_ORIGIN', '已保存图片的选帧来源不可修改', {'card_id': card.id, 'path': ['frame_origin']})
    if origin and (card.origin or card.file_id != _frame_file_id(canvas_id, card.id, origin)):
        raise diagnostic('INVALID_ORIGIN', '选帧素材必须匹配保存的来源', {'card_id': card.id, 'path': ['frame_origin']})


class CanvasVideoFrames:
    """校验画布来源并提供可重试的独立图片卡准备操作。"""

    def __init__(self, db, project_id: str):
        self.db, self.project_id = db, project_id

    async def prepare(self, canvas_id: str, body: CanvasVideoFrameRequest) -> ImageContentCard:
        """在锁外处理媒体，提交时重新核实来源并复用并发发布的文件。"""
        store = CanvasStore(self.db, self.project_id)
        canvas = await store.get(canvas_id)
        origin = await self._source(canvas, body)
        target = {'card_id': body.source_card_id}
        card_id = _identity('canvas-frame-card', canvas_id, body.request_id, origin.model_dump())
        file_id = _frame_file_id(canvas_id, card_id, origin)
        card = ImageContentCard(id=card_id, file_id=file_id, frame_origin=origin)
        if await self.db.get(FileItem, file_id) is not None:
            await require_available_file(self.db, file_id=file_id, lock=False, expected_type='image')
            return card

        video = await require_available_file(self.db, file_id=body.source_file_id, lock=False, expected_type='video')
        source_key = video.storage_key
        # End the read transaction before I/O. The final transaction takes the current canvas lock.
        await self.db.rollback()
        frame_key = f'files/{file_id}.png'
        try:
            content = await storage.download_file(key=source_key)
            frame = await asyncio.to_thread(_frame_at_position, content, body.at_ms)
            # Matching requests target the same immutable source and decode the same PNG.
            await storage.upload_file(key=frame_key, data=BytesIO(frame), content_type='image/png')
        except ValueError as error:
            raise diagnostic('FRAME_EXTRACTION_FAILED', str(error), target) from error
        except (OSError, ClientError, subprocess.SubprocessError) as error:
            raise diagnostic('FRAME_EXTRACTION_FAILED', '无法读取视频或提取所选画面', target) from error

        canvas = await store.get(canvas_id, lock=True)
        if await self._source(canvas, body) != origin:
            raise diagnostic('INVALID_FRAME_SOURCE', '视频来源已变化，请重新选择', target)
        if await self.db.get(FileItem, file_id, populate_existing=True) is not None:
            await require_available_file(self.db, file_id=file_id, expected_type='image')
            return card
        video = await require_available_file(self.db, file_id=body.source_file_id, expected_type='video')
        if video.storage_key != source_key:
            raise diagnostic('INVALID_FRAME_SOURCE', '视频来源已变化，请重新选择', target)
        await create_and_refresh(self.db, FileItem(id=file_id, type=FileType.image, name=f'frame-{body.at_ms}',
            content_type='image/png', size_bytes=len(frame), tags=[], storage_key=frame_key))
        await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id, chapter_id=None,
                               usage_kind='generation_upload')
        return card

    async def _source(self, canvas, body: CanvasVideoFrameRequest) -> CanvasVideoFrameOrigin:
        """Resolve the selected saved video or exact completed result."""
        target = {'card_id': body.source_card_id}
        result_set_id = None
        if body.result:
            result = body.result
            node = await CanvasHistoricalContent(self.db, self.project_id).output_node(
                canvas.id, result.run_id, result.node_id, result.position)
            output = node.outputs[result.position]
            if (node.status != 'succeeded' or not node.result_set_id or node.card_id != body.source_card_id
                    or output['modality'] != 'video' or output.get('file_id') != body.source_file_id):
                raise diagnostic('INVALID_FRAME_SOURCE', '请选择完整视频结果中的原文件', target)
            result_set_id = node.result_set_id
        else:
            source = next((card for card in canvas.document.get('cards', []) if card['id'] == body.source_card_id), {})
            if source.get('type') != 'content.video' or source.get('file_id') != body.source_file_id or source.get('uploading'):
                raise diagnostic('INVALID_FRAME_SOURCE', '请选择当前画布已保存的视频素材', target)

        return CanvasVideoFrameOrigin(**body.model_dump(exclude={'request_id'}), result_set_id=result_set_id)
