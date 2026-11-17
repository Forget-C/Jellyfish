"""项目归属、结构校验与原子 CAS 保存集中在此边界。"""
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from typing import TYPE_CHECKING
from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.contracts.task import TERMINAL_TASK_STATUSES
from app.models.directing import Sequence
from app.models.generation_canvas import CanvasCheckReport, CanvasSaveReceipt, GenerationCanvas
from app.models.studio import Chapter, FileUsage, Project
from app.models.task import Task
from app.schemas.generation_canvas import (
    CanvasCompiledInput, CanvasDiagnostic, CanvasDocument, CanvasFixedSource, CanvasRead,
    CanvasSave, CanvasSummary, CanvasSceneAssociation, CreativeBasisCard, ModelCard,
)
from app.services.common import get_or_404
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.capabilities import model_capability

if TYPE_CHECKING:
    from app.services.directing.storyboard_save import StoryboardSaveEvidence



@dataclass(frozen=True)
class SceneCanvasSeed:
    """场次入口校验后的初始依据与归属，与画布在同一事务内保存。"""

    sequence_id: str
    basis: CreativeBasisCard
    fixed_source: CanvasFixedSource
    canvas_id: str | None = None


class CanvasStore:
    """按真实归属读取，文档写入及回执由调用方事务共同提交。"""
    def __init__(self, db: AsyncSession, project_id: str | None):
        self.db = db
        self.project_id = project_id or None

    async def summaries(self, *, q: str, page: int, page_size: int) -> tuple[list[CanvasSummary], int]:
        """按归属和名称筛选摘要，稳定分页且不读取或排序大文档。"""
        scope = [GenerationCanvas.project_id == self.project_id,
                 GenerationCanvas.kind == ('scene' if self.project_id else 'free')]
        if q.strip():
            # 名称检索也与排序隔离，避免 JSON 条件使 MySQL 携带文档排序。
            matches = list((await self.db.scalars(select(GenerationCanvas.id).where(*scope,
                GenerationCanvas.document['name'].as_string().contains(q.strip(), autoescape=True)))).all())
            scope.append(GenerationCanvas.id.in_(matches))
        total = await self.db.scalar(select(func.count()).select_from(GenerationCanvas).where(*scope))
        ids = list((await self.db.scalars(select(GenerationCanvas.id).where(*scope)
            .order_by(GenerationCanvas.updated_at.desc(), GenerationCanvas.id.desc())
            .offset((page - 1) * page_size).limit(page_size))).all())
        if not ids:
            return [], total
        # JSON 摘要单独读取，避免 MySQL 将大文档带入排序缓冲。
        rows = (await self.db.execute(select(GenerationCanvas.id, GenerationCanvas.revision, GenerationCanvas.updated_at,
            GenerationCanvas.document['name'].as_string().label('name'),
            GenerationCanvas.document['cover_file_id'].as_string().label('cover_file_id'))
            .where(GenerationCanvas.id.in_(ids)))).all()
        summaries = {row.id: CanvasSummary.model_validate(row._mapping) for row in rows}
        return [summaries[canvas_id] for canvas_id in ids if canvas_id in summaries], total

    async def rename(self, canvas_id: str, name: str, expected_revision: int) -> CanvasRead:
        """重命名复用完整保存与 CAS，避免覆盖其他编辑器的新修订。"""
        current = await self.read(canvas_id)
        document = current.document.model_copy(update={'name': name})
        await self.save(canvas_id, CanvasSave(request_id=uuid4().hex, expected_revision=expected_revision,
                                             document=document.model_dump()))
        return await self.read(canvas_id)

    async def list(self) -> list[GenerationCanvas]:
        """列出项目画布，沿用现有项目存在性边界。"""
        if self.project_id is not None:
            await get_or_404(self.db, Project, self.project_id, detail="Project not found")
        # 仅让轻量 ID 参与排序，避免大 JSON 文档耗尽 MySQL 排序缓冲。
        ids = list((await self.db.scalars(select(GenerationCanvas.id).where(
            GenerationCanvas.project_id == self.project_id).order_by(GenerationCanvas.created_at, GenerationCanvas.id))).all())
        return [await self.get(canvas_id) for canvas_id in ids]

    async def get(self, canvas_id: str, *, lock: bool = False) -> GenerationCanvas:
        """锁住文档行后再读回执，使同画布的竞争请求按数据库顺序核实。"""
        identity = (GenerationCanvas.id == canvas_id, GenerationCanvas.project_id == self.project_id)
        stmt = select(GenerationCanvas).where(*identity)
        if lock:
            if self.db.get_bind().dialect.name == 'sqlite':
                # SQLite ignores FOR UPDATE; acquire its writer lock before
                # reading the mutation basis, without changing the document.
                await self.db.execute(update(GenerationCanvas).where(*identity)
                                      .values(revision=GenerationCanvas.revision, updated_at=GenerationCanvas.updated_at)
                                      .execution_options(synchronize_session=False))
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        canvas = await self.db.scalar(stmt)
        if canvas is None or canvas.kind != ('scene' if self.project_id else 'free'):
            raise HTTPException(404, 'Canvas not found')
        return canvas

    async def read(self, canvas_id: str) -> CanvasRead:
        """附带固定依据的新鲜度，普通画布仍只读取自身文档。"""
        canvas = await self.get(canvas_id)
        document = CanvasDocument.model_validate(canvas.document)
        from app.services.generation_canvas.allowed_cards import validate_canvas_cards
        validate_canvas_cards(canvas, document)
        source = document.fixed_source
        source_changed = None
        if source:
            chapter_text = await self.db.scalar(select(Chapter.raw_text).where(
                Chapter.id == source.chapter_id, Chapter.project_id == self.project_id))
            source_changed = chapter_text is None or hashlib.sha256(chapter_text.encode()).hexdigest() != source.chapter_version
        return CanvasRead(id=canvas.id, project_id=canvas.project_id, revision=canvas.revision,
                          document=document, source_changed=source_changed, scene=await self._scene_association(canvas))

    async def _scene_association(self, canvas: GenerationCanvas) -> CanvasSceneAssociation | None:
        """只有画布、场次和章节确实同属当前项目时才返回关联。"""
        if not canvas.sequence_id:
            return None
        row = (await self.db.execute(select(Sequence.chapter_id, Sequence.is_current).join(
            Chapter, Chapter.id == Sequence.chapter_id).where(
            Sequence.id == canvas.sequence_id, Chapter.project_id == canvas.project_id))).one_or_none()
        if row is None:
            return None
        return CanvasSceneAssociation(chapter_id=row.chapter_id, sequence_id=canvas.sequence_id, is_current=row.is_current)

    async def create(self, name: str, *, scene: SceneCanvasSeed | None = None) -> GenerationCanvas:
        """建立共同文档和运行事件头，场次入口可提供已校验的固定依据。"""
        if self.project_id is not None:
            await get_or_404(self.db, Project, self.project_id, detail="Project not found")
        canvas_id = scene.canvas_id if scene and scene.canvas_id else uuid4().hex
        document = CanvasDocument(id=canvas_id, project_id=self.project_id, name=name,
                                  cards=[scene.basis] if scene else [],
                                  fixed_source=scene.fixed_source if scene else None)
        canvas = GenerationCanvas(id=canvas_id, project_id=self.project_id,
                                  sequence_id=scene.sequence_id if scene else None, kind='scene' if self.project_id else 'free',
                                  document=document.model_dump(), revision=0,
                                  card_types={scene.basis.id: scene.basis.type} if scene else {})
        if scene:
            # Scene admission is serialized by the caller. Keep even equal clock readings ordered.
            previous = await self.db.scalar(select(func.max(GenerationCanvas.created_at)).where(
                GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == scene.sequence_id))
            now = datetime.now(UTC).replace(tzinfo=None)
            canvas.created_at = max(now, previous.replace(tzinfo=None) + timedelta(microseconds=1)) if previous else now
        self.db.add(canvas)
        await self.db.flush()
        from app.models.generation_canvas import CanvasEventHead
        self.db.add(CanvasEventHead(canvas_id=canvas_id))
        await self.db.flush()
        return canvas

    async def save(self, canvas_id: str, command: CanvasSave) -> dict:
        """原回执优先于当前 revision；CAS 与回执在同一外层事务内落库。"""
        canvas = await self.get(canvas_id, lock=True)
        digest = self.command_digest(command.model_dump(exclude={'request_id'}))
        receipt = await self.save_receipt(canvas_id, command.request_id, digest)
        if receipt:
            return receipt
        return await self._write(canvas, command, digest)

    @staticmethod
    def command_digest(body: dict) -> str:
        """Hash a normalized command, independent of its receipt identity."""
        return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':'),
                                        ensure_ascii=False).encode()).hexdigest()

    async def save_receipt(self, canvas_id: str, request_id: str, digest: str) -> dict | None:
        """Under the canvas lock, replay only the same command."""
        receipt = await self.db.get(CanvasSaveReceipt, (canvas_id, request_id))
        if receipt and receipt.request_hash != digest:
            raise diagnostic('IDEMPOTENCY_CONFLICT', '请求身份已用于其他正文', {'canvas_id': canvas_id}, status=409)
        return receipt.response if receipt else None

    async def save_scene_application(self, canvas: GenerationCanvas, command: CanvasSave, digest: str,
                                     *, chapter_version: str, evidence: 'StoryboardSaveEvidence') -> CanvasRead:
        """Write the checked workbench plan using the ordinary save transaction."""
        result = await self._write(canvas, command, digest, chapter_version=chapter_version, evidence=evidence)
        return CanvasRead.model_validate(result['scene_canvas'])

    async def _write(self, canvas: GenerationCanvas, command: CanvasSave, digest: str,
                     *, chapter_version: str | None = None, evidence: 'StoryboardSaveEvidence | None' = None) -> dict:
        canvas_id = canvas.id
        if canvas.revision != command.expected_revision:
            raise diagnostic('REVISION_CONFLICT', '服务端已有新修订，请重新读取', {'canvas_id': canvas_id}, status=409)
        from app.services.generation_canvas.checks import CanvasChecks, changed_check_connections
        from app.services.generation_canvas.document_save import prepare_document
        from app.services.generation_canvas.saved_media import replace_canvas_content_usages
        prepared = await prepare_document(self.db, self.project_id, canvas, command.document,
                                          scene_sources=evidence.scene_sources if evidence else None,
                                          restored_continuity=evidence.restored_continuity if evidence else frozenset())
        if evidence is None:
            from app.services.directing.storyboard_save import require_ordinary_save
            await require_ordinary_save(self.db, canvas, prepared.previous_document, prepared.document)
        if canvas.sequence_id and prepared.document.name != prepared.previous_document.name and not prepared.document.name.strip():
            raise diagnostic('INVALID_CANVAS_NAME', '场次画布名称不能为空白', {'canvas_id': canvas_id, 'path': ['name']})
        previous = prepared.previous_document.storyboard
        if canvas.sequence_id and evidence is None and previous and previous.visual_continuity:
            from app.services.directing.storyboard_visual_continuity import retain_removed_visual_continuity
            await retain_removed_visual_continuity(self.db, prepared.previous_document, prepared.document, command.request_id)
        await replace_canvas_content_usages(self.db, self.project_id, canvas_id, prepared.media_references)
        changed = changed_check_connections(prepared.previous_document, prepared.document)
        check_edge_revisions = canvas.check_edge_revisions
        if changed:
            check_edge_revisions = {**(check_edge_revisions or {}), **dict.fromkeys(changed, command.expected_revision + 1)}
        result = await self.db.execute(update(GenerationCanvas).where(
            GenerationCanvas.id == canvas_id, GenerationCanvas.revision == command.expected_revision).values(
                document=prepared.document.model_dump(), revision=command.expected_revision + 1,
                card_types=prepared.identities, detached_proofs=prepared.detached_proofs, check_edge_revisions=check_edge_revisions))
        if result.rowcount != 1:
            raise diagnostic('REVISION_CONFLICT', '服务端已有新修订，请重新读取', {'canvas_id': canvas_id}, status=409)
        await CanvasChecks(self.db, self.project_id).cancel_changed_targets(canvas_id, changed)
        response = {'request_id': command.request_id, 'canvas_id': canvas_id, 'revision': command.expected_revision + 1}
        if chapter_version is not None:
            response['scene_canvas'] = CanvasRead(id=canvas_id, project_id=self.project_id,
                revision=response['revision'], document=prepared.document,
                source_changed=prepared.document.fixed_source.chapter_version != chapter_version,
                scene=await self._scene_association(canvas)).model_dump(mode='json')
        if evidence is not None:
            response.update(evidence.receipt_fields(prepared.previous_document, prepared.document))
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
        from app.services.generation_canvas.result_positions import known_result_positions
        sources = {edge.source_card for edge in context.incoming.get(card_id, ()) if isinstance(context.cards[edge.source_card], ModelCard)}
        known = await known_result_positions(self.db, canvas_id, sources)
        return CanvasCardOutputs(revision=canvas.revision, card_id=card_id,
            outputs=context.published_outputs(card.id, model_outputs=published),
            candidates=context.resolve_outputs(card_id, model_outputs=published, known_positions=known))

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

    async def delete(self, canvas_id: str, *, expected_revision: int) -> None:
        """删除前核实真实占用；历史、引用与文档在调用方事务内一起释放。"""
        canvas = await self.get(canvas_id, lock=True)
        await self.delete_record(canvas, expected_revision=expected_revision)

    async def delete_record(self, canvas: GenerationCanvas, *, expected_revision: int) -> None:
        """删除调用方已锁定且核实归属的记录；供普通删除与旧画布退出共用。"""
        canvas_id = canvas.id
        if canvas.revision != expected_revision:
            raise diagnostic('DELETE_REVISION_CHANGED', '画布已保存新修订，请重新核对并确认删除',
                             {'canvas_id': canvas_id}, status=409, blocks=['delete'])
        await self.require_idle(canvas)
        # Explicit child cleanup supports SQLite tests without relying on FK pragmas.
        from app.services.generation_canvas.runtime import delete_runtime
        await delete_runtime(self.db, canvas_id)
        await self.db.execute(delete(CanvasCheckReport).where(CanvasCheckReport.canvas_id == canvas_id))
        await self.db.execute(delete(CanvasSaveReceipt).where(CanvasSaveReceipt.canvas_id == canvas_id))
        await self.db.execute(delete(FileUsage).where(
            FileUsage.project_id == self.project_id, FileUsage.usage_kind.in_(('canvas_content', 'canvas_storyboard_source', 'generation_upload')),
            FileUsage.source_ref.like(f'{canvas_id}:%')))
        await self.db.delete(canvas)
        await self.db.flush()


    async def require_idle(self, canvas: GenerationCanvas) -> None:
        """画布删除、项目删除及维护清理共用活动任务门禁；调用方已锁定文档。"""
        canvas_id = canvas.id
        from app.models.generation_canvas import CanvasScopeOccupancy
        if await self.db.scalar(select(CanvasScopeOccupancy.node_id).where(CanvasScopeOccupancy.canvas_id == canvas_id).limit(1)):
            raise diagnostic('RUN_SCOPE_BUSY', '画布仍有活动运行，任务结束后可删除',
                             {'canvas_id': canvas_id}, status=409, blocks=['delete'])
        from app.services.generation_canvas.runtime import active_canvas_task
        if await active_canvas_task(self.db, [canvas_id]):
            raise diagnostic('CANVAS_TASK_BUSY', '画布仍有活动检查或派发任务，请等待任务结束',
                             {'canvas_id': canvas_id}, status=409, blocks=['delete'])
        if canvas.sequence_id:
            from app.services.directing.storyboard_assembly import STORYBOARD_KIND
            from app.services.directing.existing_storyboard_check import STORYBOARD_CHECK_KIND
            # New admissions hold this canvas lock. Never lock an existing Task
            # here: worker completion can acquire Task before the canvas.
            active_task = await self.db.scalar(select(Task.id).where(
                Task.project_id == self.project_id, Task.kind.in_((STORYBOARD_KIND, STORYBOARD_CHECK_KIND)),
                Task.target_type == 'directing_sequence', Task.target_id == canvas.sequence_id,
                Task.input_snapshot['canvas_id'].as_string() == canvas_id,
                Task.status.not_in(TERMINAL_TASK_STATUSES)).limit(1))
            if active_task:
                raise diagnostic('STORYBOARD_BUSY', '画布仍有活动分镜任务，任务结束后可删除',
                                 {'canvas_id': canvas_id, 'task_id': active_task}, status=409, blocks=['delete'])
