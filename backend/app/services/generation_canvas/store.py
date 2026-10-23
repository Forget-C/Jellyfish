"""项目归属、结构校验与原子 CAS 保存集中在此边界。"""
import hashlib
import json
from uuid import uuid4
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.studio import Project
from app.schemas.generation_canvas import CanvasDocument, CanvasSave, ModelCard, CanvasDiagnostic, CanvasCompiledInput
from app.services.common import get_or_404
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.graph import validate_graph
from app.services.generation_canvas.capabilities import model_capability
from app.models.studio import FileUsage
from app.schemas.generation_canvas import MediaContentCard
from app.services.studio.file_usages import upsert_file_usage
from app.services.studio.files import require_available_file




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
        validate_graph(document)
        # 最终文档中的实际引用决定保护；同一次保存清理引用即可断线或删来源。
        from app.services.generation_canvas.compiler import prompt_references
        for receiver in document.cards:
            if not isinstance(receiver, ModelCard):
                continue
            for reference, path in prompt_references(receiver):
                source = reference.source
                was_connected = any(edge['source_card'] == source.card_id and edge['source_port'] == source.port_id
                                    and edge['target_card'] == receiver.id for edge in canvas.document.get('edges', []))
                connected = any(edge.source_card == source.card_id and edge.source_port == source.port_id
                                and edge.target_card == receiver.id for edge in document.edges)
                if source.canvas_id == canvas_id and was_connected and not connected:
                    raise diagnostic('REFERENCE_IN_USE', '请先清理实际引用再断开或删除来源',
                                     {'card_id': receiver.id, 'segment_id': reference.id, 'path': path})
        previous_edges = {(edge['source_card'], edge['source_port'], edge['target_card'], edge['target_port'])
                          for edge in canvas.document.get('edges', [])}
        by_id = {card.id: card for card in document.cards}
        previous_models = {card['id']: card.get('model_id') for card in canvas.document.get('cards', [])}
        for edge in document.edges:
            endpoint = (edge.source_card, edge.source_port, edge.target_card, edge.target_port)
            card = by_id[edge.target_card]
            # 完整文档不带操作日志；模型已切换时也保留尚未单独保存的候选。
            # 同模型新建连接校验动态能力，实际使用的能力由运行预检再次核实。
            model_changed = card.id in previous_models and isinstance(card, ModelCard) and previous_models[card.id] != card.model_id
            if endpoint not in previous_edges and isinstance(card, ModelCard) and card.model_id and not model_changed:
                cap = await model_capability(self.db, card.model_id)
                if edge.target_port not in cap.input_ports or card.type != 'model.' + cap.modality:
                    raise diagnostic('UNSUPPORTED_INPUT', '所选模型未接入该输入用途',
                                     {'edge_id': edge.id, 'card_id': card.id, 'port_id': edge.target_port})
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

    async def compile_input(self, canvas_id: str, card_id: str) -> CanvasCompiledInput:
        """编译已保存内容；不受理任务，不发布尚未存在的模型输出。"""
        from app.services.generation_canvas.compiler import compile_card
        canvas = await self.get(canvas_id)
        document = CanvasDocument.model_validate(canvas.document)
        card = next((card for card in document.cards if card.id == card_id), None)
        if not isinstance(card, ModelCard):
            raise HTTPException(404, 'Model card not found')
        capability = await model_capability(self.db, card.model_id) if card.model_id else None
        result = compile_card(document, card_id, capability=capability)
        result.revision = canvas.revision
        if not card.model_id:
            result.diagnostics = list(result.diagnostics) + [CanvasDiagnostic(code='MODEL_REQUIRED', message='请选择模型',
                target={'card_id': card_id, 'path': ['model_id']}, blocks=['run'])]
            result.can_run = False
        return result

    async def delete(self, canvas_id: str) -> None:
        """当前切片尚无运行；先删回执再删除文档，适配 SQLite 与 MySQL 外键。"""
        canvas = await self.get(canvas_id, lock=True)
        await self.db.execute(delete(CanvasSaveReceipt).where(CanvasSaveReceipt.canvas_id == canvas_id))
        await self.db.execute(delete(FileUsage).where(
            FileUsage.project_id == self.project_id, FileUsage.usage_kind == 'canvas_content',
            FileUsage.source_ref.like(f'{canvas_id}:%')))
        await self.db.delete(canvas)
        await self.db.flush()
