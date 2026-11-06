"""项目归属、结构校验与原子 CAS 保存集中在此边界。"""
import hashlib
import json
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.studio import Project
from app.schemas.generation_canvas import CanvasDocument, CanvasSave, ModelCard, CanvasDiagnostic, CanvasCompiledInput
from app.services.common import get_or_404
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.capabilities import model_capability
from app.models.studio import FileUsage




class CanvasStore:
    """使用项目作用域读取，文档写入及回执由调用方事务共同提交。"""
    def __init__(self, db: AsyncSession, project_id: str):
        self.db = db
        self.project_id = project_id

    async def list(self) -> list[GenerationCanvas]:
        """列出项目画布，沿用现有项目存在性边界。"""
        await get_or_404(self.db, Project, self.project_id, detail="Project not found")
        rows = list((await self.db.scalars(select(GenerationCanvas).where(
            GenerationCanvas.project_id == self.project_id).order_by(GenerationCanvas.created_at, GenerationCanvas.id))).all())
        return [await self.get(row.id) for row in rows]

    async def get(self, canvas_id: str, *, lock: bool = False) -> GenerationCanvas:
        """锁住文档行后再读回执，使同画布的竞争请求按数据库顺序核实。"""
        stmt = select(GenerationCanvas).where(GenerationCanvas.id == canvas_id,
                                             GenerationCanvas.project_id == self.project_id)
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        canvas = await self.db.scalar(stmt)
        if canvas is None:
            raise HTTPException(404, 'Canvas not found')
        from app.services.generation_canvas.acceptance_cleanup import clean_acceptance
        cleaned = clean_acceptance(canvas.document, candidates=True)
        if cleaned != canvas.document:
            await self.db.execute(update(GenerationCanvas).where(GenerationCanvas.id == canvas_id,
                GenerationCanvas.revision == canvas.revision).values(document=cleaned, revision=GenerationCanvas.revision + 1))
            await self.db.refresh(canvas)
        return canvas

    async def create(self, name: str) -> GenerationCanvas:
        """建立空文档，不创建场次或发布版本。"""
        await get_or_404(self.db, Project, self.project_id, detail="Project not found")
        canvas_id = uuid4().hex
        document = CanvasDocument(id=canvas_id, project_id=self.project_id, name=name)
        canvas = GenerationCanvas(id=canvas_id, project_id=self.project_id, document=document.model_dump(), revision=0)
        self.db.add(canvas)
        await self.db.flush()
        from app.models.generation_canvas import CanvasEventHead
        self.db.add(CanvasEventHead(canvas_id=canvas_id))
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
        from app.services.generation_canvas.document_save import prepare_document
        from app.services.generation_canvas.saved_media import replace_canvas_content_usages
        prepared = await prepare_document(self.db, self.project_id, canvas, command.document)
        await replace_canvas_content_usages(self.db, self.project_id, canvas_id, prepared.media_references)
        result = await self.db.execute(update(GenerationCanvas).where(
            GenerationCanvas.id == canvas_id, GenerationCanvas.revision == command.expected_revision).values(
                document=prepared.document.model_dump(), revision=command.expected_revision + 1, card_types=prepared.identities))
        if result.rowcount != 1:
            raise diagnostic('REVISION_CONFLICT', '服务端已有新修订，请重新读取', {'canvas_id': canvas_id}, status=409)
        response = {'request_id': command.request_id, 'canvas_id': canvas_id, 'revision': command.expected_revision + 1}
        self.db.add(CanvasSaveReceipt(canvas_id=canvas_id, request_id=command.request_id, request_hash=digest, response=response))
        await self.db.flush()
        return response

    async def card_outputs(self, canvas_id: str, card_id: str):
        """返回已保存修订的单卡出口和直接候选，不形成实际采用。"""
        from app.schemas.generation_canvas import CanvasCardOutputs
        from app.services.generation_canvas.output_resolution import CanvasOutputContext
        from app.services.generation_canvas.current_state import CanvasCurrentState
        canvas = await self.get(canvas_id)
        document = CanvasDocument.model_validate(canvas.document)
        card = next((item for item in document.cards if item.id == card_id), None)
        if card is None:
            raise HTTPException(404, 'Card not found')
        context = CanvasOutputContext(document)
        published = await CanvasCurrentState(self.db, self.project_id).current_outputs(canvas, context=context)
        return CanvasCardOutputs(revision=canvas.revision, card_id=card_id,
            outputs=context.published_outputs(card.id, model_outputs=published),
            candidates=context.resolve_outputs(card_id, model_outputs=published))

    async def compile_input(self, canvas_id: str, card_id: str) -> CanvasCompiledInput:
        """编译已保存内容；不受理任务，不发布尚未存在的模型输出。"""
        from app.services.generation_canvas.compiler import compile_card
        from app.services.generation_canvas.output_resolution import CanvasOutputContext
        canvas = await self.get(canvas_id)
        document = CanvasDocument.model_validate(canvas.document)
        card = next((card for card in document.cards if card.id == card_id), None)
        if not isinstance(card, ModelCard):
            raise HTTPException(404, 'Model card not found')
        capability = await model_capability(self.db, card.model_id) if card.model_id else None
        from app.services.generation_canvas.current_state import CanvasCurrentState
        context = CanvasOutputContext(document)
        outputs = await CanvasCurrentState(self.db, self.project_id).current_outputs(canvas, context=context)
        result = compile_card(document, card_id, model_outputs=outputs, capability=capability, context=context)
        result.revision = canvas.revision
        if not card.model_id:
            result.diagnostics = list(result.diagnostics) + [CanvasDiagnostic(code='MODEL_REQUIRED', message='请选择模型',
                target={'card_id': card_id, 'path': ['model_id']}, blocks=['run'])]
            result.can_run = False
        return result

    async def delete(self, canvas_id: str) -> None:
        """删除前核实真实占用；历史、引用与文档在调用方事务内一起释放。"""
        canvas = await self.get(canvas_id, lock=True)
        from app.models.generation_canvas import CanvasScopeOccupancy
        if await self.db.scalar(select(CanvasScopeOccupancy.node_id).where(CanvasScopeOccupancy.canvas_id == canvas_id).limit(1)):
            raise diagnostic("RUN_SCOPE_BUSY", "画布仍有活动运行", {"canvas_id": canvas_id}, status=409, blocks=["delete"])
        # Explicit child cleanup supports SQLite tests without relying on FK pragmas.
        from app.services.generation_canvas.runtime import delete_runtime
        await delete_runtime(self.db, canvas_id)
        await self.db.execute(delete(CanvasSaveReceipt).where(CanvasSaveReceipt.canvas_id == canvas_id))
        await self.db.execute(delete(FileUsage).where(
            FileUsage.project_id == self.project_id, FileUsage.usage_kind == 'canvas_content',
            FileUsage.source_ref.like(f'{canvas_id}:%')))
        await self.db.delete(canvas)
        await self.db.flush()
