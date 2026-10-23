"""项目归属、结构校验与原子 CAS 保存集中在此边界。"""
import hashlib
import json
from uuid import uuid4
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.studio import Project, FileUsage
from app.schemas.generation_canvas import CanvasDocument, CanvasSave, MediaContentCard
from app.services.common import get_or_404
from app.services.studio.file_usages import upsert_file_usage
from app.services.studio.files import require_available_file


def diagnostic(code: str, message: str, target: dict, *, status: int = 422) -> HTTPException:
    """所有画布领域错误提供稳定代号、结构定位与阻止动作。"""
    return HTTPException(status, detail={'code': code, 'severity': 'error', 'message': message,
                                        'target': target, 'blocks': ['save']})


class CanvasStore:
    """使用项目作用域读取，文档写入及回执由调用方事务共同提交。"""
    def __init__(self, db: AsyncSession, project_id: str):
        self.db = db
        self.project_id = project_id

    async def list(self) -> list[GenerationCanvas]:
        """列出项目画布，沿用现有项目存在性边界。"""
        await get_or_404(self.db, Project, self.project_id, detail="Project not found")
        return list((await self.db.scalars(select(GenerationCanvas).where(
            GenerationCanvas.project_id == self.project_id).order_by(GenerationCanvas.created_at, GenerationCanvas.id))).all())

    async def get(self, canvas_id: str, *, lock: bool = False) -> GenerationCanvas:
        """锁住文档行后再读回执，使同画布的竞争请求按数据库顺序核实。"""
        stmt = select(GenerationCanvas).where(GenerationCanvas.id == canvas_id,
                                             GenerationCanvas.project_id == self.project_id)
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        canvas = await self.db.scalar(stmt)
        if canvas is None:
            raise HTTPException(404, 'Canvas not found')
        return canvas

    async def create(self, name: str) -> GenerationCanvas:
        """建立空文档，不创建场次或发布版本。"""
        await get_or_404(self.db, Project, self.project_id, detail="Project not found")
        canvas_id = uuid4().hex
        document = CanvasDocument(id=canvas_id, project_id=self.project_id, name=name)
        canvas = GenerationCanvas(id=canvas_id, project_id=self.project_id, document=document.model_dump(), revision=0)
        self.db.add(canvas)
        await self.db.flush()
        return canvas

    async def save(self, canvas_id: str, command: CanvasSave) -> dict:
        """原回执优先于当前 revision；CAS 与回执在同一外层事务内落库。"""
        canvas = await self.get(canvas_id, lock=True)
        digest = hashlib.sha256(json.dumps(command.model_dump(exclude={'request_id'}), sort_keys=True,
                                           separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        receipt = await self.db.get(CanvasSaveReceipt, (canvas_id, command.request_id))
        if receipt:
            if receipt.request_hash != digest:
                raise diagnostic('IDEMPOTENCY_CONFLICT', '请求身份已用于其他正文', {'canvas_id': canvas_id}, status=409)
            return receipt.response
        if canvas.revision != command.expected_revision:
            raise diagnostic('REVISION_CONFLICT', '服务端已有新修订，请重新读取', {'canvas_id': canvas_id}, status=409)
        try:
            document = CanvasDocument.model_validate(command.document)
        except ValidationError as exc:
            error = exc.errors()[0]
            raise diagnostic('INVALID_DOCUMENT', error['msg'], {'canvas_id': canvas_id, 'path': list(error['loc'])}) from exc
        if document.id != canvas_id or document.project_id != self.project_id:
            raise diagnostic('INVALID_IDENTITY', '画布身份不可修改', {'canvas_id': canvas_id})
        identities = dict(canvas.card_types)
        seen = set()
        for card in document.cards:
            if card.id in seen or (card.id in identities and identities[card.id] != card.type):
                raise diagnostic('INVALID_CARD_IDENTITY', '卡片身份必须唯一且类型不可修改', {'card_id': card.id})
            seen.add(card.id)
            identities[card.id] = card.type
        # Validate all replacements before releasing existing protection in this transaction.
        for card in document.cards:
            if isinstance(card, MediaContentCard) and card.file_id:
                try:
                    await require_available_file(self.db, file_id=card.file_id, expected_type=card.type.split('.')[1])
                except HTTPException as exc:
                    raise diagnostic('INVALID_MEDIA_FILE', str(exc.detail), {'card_id': card.id, 'path': ['file_id']}) from exc
                if not await self.db.scalar(select(FileUsage.id).where(
                        FileUsage.file_id == card.file_id, FileUsage.project_id == self.project_id).limit(1)):
                    raise diagnostic('INVALID_MEDIA_FILE', '文件不属于当前项目', {'card_id': card.id, 'path': ['file_id']})
        await self.db.execute(delete(FileUsage).where(
            FileUsage.project_id == self.project_id, FileUsage.usage_kind == 'canvas_content',
            FileUsage.source_ref.like(f'{canvas_id}:%')))
        for card in document.cards:
            if isinstance(card, MediaContentCard) and card.file_id:
                await upsert_file_usage(self.db, file_id=card.file_id, project_id=self.project_id,
                                        chapter_id=None, usage_kind='canvas_content', source_ref=f'{canvas_id}:{card.id}')
        result = await self.db.execute(update(GenerationCanvas).where(
            GenerationCanvas.id == canvas_id, GenerationCanvas.revision == command.expected_revision).values(
                document=document.model_dump(), revision=command.expected_revision + 1, card_types=identities))
        if result.rowcount != 1:
            raise diagnostic('REVISION_CONFLICT', '服务端已有新修订，请重新读取', {'canvas_id': canvas_id}, status=409)
        response = {'request_id': command.request_id, 'canvas_id': canvas_id, 'revision': command.expected_revision + 1}
        self.db.add(CanvasSaveReceipt(canvas_id=canvas_id, request_id=command.request_id, request_hash=digest, response=response))
        await self.db.flush()
        return response

    async def delete(self, canvas_id: str) -> None:
        """当前切片尚无运行；先删回执再删除文档，适配 SQLite 与 MySQL 外键。"""
        canvas = await self.get(canvas_id, lock=True)
        await self.db.execute(delete(CanvasSaveReceipt).where(CanvasSaveReceipt.canvas_id == canvas_id))
        await self.db.execute(delete(FileUsage).where(
            FileUsage.project_id == self.project_id, FileUsage.usage_kind == 'canvas_content',
            FileUsage.source_ref.like(f'{canvas_id}:%')))
        await self.db.delete(canvas)
        await self.db.flush()
