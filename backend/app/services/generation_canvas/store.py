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
from app.schemas.generation_canvas import CanvasDocument, CanvasSave, ModelCard, SoundDirectionCard, PerformanceDirectionCard, CanvasDiagnostic, CanvasCompiledInput
from app.services.common import get_or_404
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.graph import validate_graph
from app.services.generation_canvas.capabilities import model_capability
from app.models.studio import FileUsage
from app.schemas.generation_canvas import MediaContentCard




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
        try:
            document = CanvasDocument.model_validate(command.document)
        except ValidationError as exc:
            error = exc.errors()[0]
            raise diagnostic('INVALID_DOCUMENT', error['msg'], {'canvas_id': canvas_id, 'path': list(error['loc'])}) from exc
        if document.id != canvas_id or document.project_id != self.project_id:
            raise diagnostic('INVALID_IDENTITY', '画布身份不可修改', {'canvas_id': canvas_id})
        from app.services.generation_canvas.stacks import validate_stack_edit
        previous_document = CanvasDocument.model_validate(canvas.document)
        from app.services.generation_canvas.reference_rules import clean_reference_image_sources
        document = clean_reference_image_sources(document, previous_document)
        previous_document = clean_reference_image_sources(previous_document)
        validate_stack_edit(previous_document.model_dump(), document)
        previous_types = {card.id: card.type for card in previous_document.cards}
        identities = {key: previous_types.get(key, value) if value == 'content.object' else value for key, value in canvas.card_types.items()}
        seen = set()
        for card in document.cards:
            if card.id in seen or (card.id in identities and identities[card.id] != card.type):
                raise diagnostic('INVALID_CARD_IDENTITY', '卡片身份必须唯一且类型不可修改', {'card_id': card.id})
            seen.add(card.id)
            identities[card.id] = card.type
        from app.models.generation_canvas import CanvasScopeOccupancy
        occupied = list(await self.db.scalars(select(CanvasScopeOccupancy.card_id).where(CanvasScopeOccupancy.canvas_id == canvas_id)))
        if any(card_id not in seen for card_id in occupied):
            raise diagnostic("RUN_SCOPE_BUSY", "活动模型卡不可删除", {"canvas_id": canvas_id}, status=409)
        # Provenance cannot be removed or rewritten by edits to independent content.
        previous_cards = {card['id']: card for card in canvas.document.get('cards', [])}
        object_names = {}
        object_ids = set()
        from app.schemas.generation_canvas import ObjectDescriptionCard, NamedImageReferenceCard
        for card in document.cards:
            if not isinstance(card, ObjectDescriptionCard):
                continue
            previous = previous_cards.get(card.id)
            if previous and previous.get('object_id') and previous['object_id'] != card.object_id:
                raise diagnostic('IMMUTABLE_OBJECT_IDENTITY', '已建立对象的身份不可修改', {'card_id': card.id, 'path': ['object_id']})
            if card.object_id:
                if card.object_id in object_ids:
                    raise diagnostic('DUPLICATE_OBJECT_IDENTITY', '独立描述卡不可复用同一对象身份', {'card_id': card.id, 'path': ['object_id']})
                object_ids.add(card.object_id)
            name = card.name.strip()
            if name:
                if (card.type, name) in object_names:
                    raise diagnostic('DUPLICATE_OBJECT_NAME', '同一画布内同类型描述名称必须唯一', {'card_id': card.id, 'path': ['name']})
                object_names[(card.type, name)] = card.id
        for card in document.cards:
            origin = getattr(card, 'origin', None)
            previous = previous_cards.get(card.id)
            if previous and previous.get('origin') != (origin.model_dump() if origin else None):
                raise diagnostic('IMMUTABLE_ORIGIN', '已保存内容的历史来源不可修改', {'card_id': card.id, 'path': ['origin']})
            if origin and not previous:
                from app.services.generation_canvas.runtime import CanvasRuntime
                if origin.canvas_id != canvas_id:
                    raise diagnostic('INVALID_ORIGIN', '历史来源必须属于当前画布', {'card_id': card.id})
                node = await CanvasRuntime(self.db, self.project_id).output_node(canvas_id, origin.run_id, origin.node_id, origin.position)
                output = node.outputs[origin.position]
                if origin.incomplete != (node.status != 'succeeded') or card.type != 'content.' + output['modality'] or (
                    output['modality'] == 'text' and card.text != output.get('text')) or (
                    output['modality'] != 'text' and card.file_id != output.get('file_id')):
                    raise diagnostic('INVALID_ORIGIN', '另存内容须与固定成果及完成状态一致', {'card_id': card.id})
        validate_graph(document, previous_document)
        # 最终文档中的实际引用决定保护；同一次保存清理引用即可断线或删来源。
        from app.services.generation_canvas.compiler import prompt_references
        for receiver in document.cards:
            if not isinstance(receiver, (ModelCard, NamedImageReferenceCard, PerformanceDirectionCard, SoundDirectionCard)):
                continue
            references = [(reference.source, reference.id, path) for reference, path in prompt_references(receiver)] if isinstance(receiver, ModelCard) else [
                (binding.source, binding.id, ['input_bindings', binding.id]) for binding in getattr(receiver, 'input_bindings', [])]
            if isinstance(receiver, NamedImageReferenceCard) and receiver.name_binding:
                references.append((receiver.name_binding, 'name', ['name_binding']))
            if isinstance(receiver, NamedImageReferenceCard) and receiver.image_binding and receiver.image_binding.source:
                references.append((receiver.image_binding.source, 'image', ['image_binding']))
            if isinstance(receiver, (PerformanceDirectionCard, SoundDirectionCard)):
                references.extend((example.source, example.id, ['examples', example.id]) for example in receiver.examples)
            for source, reference_id, path in references:
                was_connected = any(edge['source_card'] == source.card_id and edge['source_port'] == source.port_id
                                    and edge['target_card'] == receiver.id for edge in canvas.document.get('edges', []))
                connected = any(edge.source_card == source.card_id and edge.source_port == source.port_id
                                and edge.target_card == receiver.id for edge in document.edges)
                if source.canvas_id == canvas_id and was_connected and not connected:
                    raise diagnostic('REFERENCE_IN_USE', '请先清理实际引用再断开或删除来源',
                                     {'card_id': receiver.id, 'segment_id': reference_id, 'path': path})
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
        from app.services.generation_canvas.saved_media import collect_media_references, validate_media_file, replace_canvas_content_usages
        media_references = collect_media_references(document)
        from app.services.generation_canvas.references import validate_references
        await validate_references(self.db, document, previous_document.model_dump(), self.project_id, media_references)
        if any(isinstance(card, (PerformanceDirectionCard, SoundDirectionCard)) for card in document.cards):
            from app.services.generation_canvas.runtime import CanvasRuntime
            from app.services.generation_canvas.performance import validate_design_relations, validate_design_examples
            published = await CanvasRuntime(self.db, self.project_id).current_outputs(canvas)
            models = {card.id for card in document.cards if isinstance(card, ModelCard)}
            published = {card_id: values for card_id, values in published.items() if card_id in models}
            from app.services.generation_canvas.spatial import validate_spatial_relations
            from app.services.generation_canvas.narrative import validate_narrative_relations
            from app.services.generation_canvas.guidance import validate_guidance_relations
            validate_guidance_relations(document, published, canvas.document)
            from app.services.generation_canvas.continuity import validate_constraint_relations
            validate_constraint_relations(document, published)
            validate_narrative_relations(document, published, canvas.document)
            validate_spatial_relations(document, published, canvas.document)
            from app.services.generation_canvas.sound import validate_sound_relations
            validate_sound_relations(document, published, canvas.document)
            validate_design_relations(document, published)
            await validate_design_examples(self.db, document, published, self.project_id, canvas.document, media_references)
        # Validate all replacements before releasing existing protection in this transaction.
        for card in document.cards:
            if isinstance(card, MediaContentCard) and card.file_id:
                await validate_media_file(self.db, self.project_id, media_references[card.id][0])
        await replace_canvas_content_usages(self.db, self.project_id, canvas_id, media_references)
        result = await self.db.execute(update(GenerationCanvas).where(
            GenerationCanvas.id == canvas_id, GenerationCanvas.revision == command.expected_revision).values(
                document=document.model_dump(), revision=command.expected_revision + 1, card_types=identities))
        if result.rowcount != 1:
            raise diagnostic('REVISION_CONFLICT', '服务端已有新修订，请重新读取', {'canvas_id': canvas_id}, status=409)
        response = {'request_id': command.request_id, 'canvas_id': canvas_id, 'revision': command.expected_revision + 1}
        self.db.add(CanvasSaveReceipt(canvas_id=canvas_id, request_id=command.request_id, request_hash=digest, response=response))
        await self.db.flush()
        return response

    async def card_outputs(self, canvas_id: str, card_id: str):
        """返回已保存修订的单卡出口和直接候选，不形成实际采用。"""
        from app.schemas.generation_canvas import CanvasCardOutputs
        from app.services.generation_canvas.compiler import resolve_outputs, published_card_outputs
        from app.services.generation_canvas.runtime import CanvasRuntime
        canvas = await self.get(canvas_id)
        document = CanvasDocument.model_validate(canvas.document)
        card = next((item for item in document.cards if item.id == card_id), None)
        if card is None:
            raise HTTPException(404, 'Card not found')
        published = await CanvasRuntime(self.db, self.project_id).current_outputs(canvas)
        return CanvasCardOutputs(revision=canvas.revision, card_id=card_id,
            outputs=published_card_outputs(document, card.id, published),
            candidates=resolve_outputs(document, card_id, published))

    async def compile_input(self, canvas_id: str, card_id: str) -> CanvasCompiledInput:
        """编译已保存内容；不受理任务，不发布尚未存在的模型输出。"""
        from app.services.generation_canvas.compiler import compile_card
        canvas = await self.get(canvas_id)
        document = CanvasDocument.model_validate(canvas.document)
        card = next((card for card in document.cards if card.id == card_id), None)
        if not isinstance(card, ModelCard):
            raise HTTPException(404, 'Model card not found')
        capability = await model_capability(self.db, card.model_id) if card.model_id else None
        from app.services.generation_canvas.runtime import CanvasRuntime
        outputs = await CanvasRuntime(self.db, self.project_id).current_outputs(canvas)
        result = compile_card(document, card_id, model_outputs=outputs, capability=capability)
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
