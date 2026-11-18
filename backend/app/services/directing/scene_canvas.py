"""场次与共同画布的创建、归属及准备页读取。"""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import NAMESPACE_URL, uuid4, uuid5
from fastapi import HTTPException
from sqlalchemy import Integer, case, cast, func, literal, select, update
from app.core.contracts.directing.scene_canvas import SceneCanvasCreate, SceneCanvasesRead, SceneCanvasSummary
from app.core.contracts.directing.scene_storyboard import StoryboardTaskSummary
from app.core.contracts.task import TaskStatus
from app.models.directing import Sequence
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.studio import Chapter
from app.models.task import Task
from app.services.chapters.explanations import explanation_basis
from app.schemas.generation_canvas import CanvasFixedSource, CanvasRead, CreativeBasisCard
from app.services.directing.storyboard_assembly import STORYBOARD_KIND
from app.services.directing.storyboard_review import review_state
from app.services.directing.shooting_explanations import scene_shooting_notes
from app.services.directing.workspace import WorkspaceService
from app.services.generation_canvas.store import CanvasStore, SceneCanvasSeed


SCENE_TASK_ORDER = Task.input_snapshot['scene_admission_order'].as_integer()


class SceneCanvasService(WorkspaceService):
    """用章节项目、场次和画布的共同边界组织准备页。"""

    async def _lock_sqlite_scene(self, chapter_id: str, sequence_id: str) -> None:
        """Acquire SQLite's writer lock before reading a preparation or submission basis."""
        if self.db.get_bind().dialect.name == 'sqlite':
            chapter = select(Chapter.id).where(Chapter.id == chapter_id, Chapter.project_id == self.project_id)
            await self.db.execute(update(Sequence).where(Sequence.id == sequence_id, Sequence.chapter_id == chapter.scalar_subquery())
                .values(updated_at=Sequence.updated_at).execution_options(synchronize_session=False))

    async def _scene(self, chapter_id: str, sequence_id: str, *, lock: bool = False) -> tuple[Sequence, Chapter]:
        """按同一快照核实场次与章节，创建时沿用章节再场次的锁顺序。"""
        if lock:
            await self._lock_sqlite_scene(chapter_id, sequence_id)
        chapter_query = select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == self.project_id)
        chapter = await self.db.scalar(chapter_query.with_for_update().execution_options(populate_existing=True) if lock else chapter_query)
        if chapter is None:
            raise HTTPException(404, 'Chapter not found in project')
        sequence_query = select(Sequence).where(Sequence.id == sequence_id, Sequence.chapter_id == chapter.id)
        sequence = await self.db.scalar(sequence_query.with_for_update().execution_options(populate_existing=True) if lock else sequence_query)
        if sequence is None:
            raise HTTPException(404, 'Scene not found in chapter')
        return sequence, chapter

    async def _next_scene_task_order(self, sequence_id: str) -> int:
        """Allocate an order in the locked scene, independent of database timestamp precision."""
        previous = await self.db.scalar(select(func.max(SCENE_TASK_ORDER)).where(
            Task.project_id == self.project_id, Task.target_type == 'directing_sequence', Task.target_id == sequence_id))
        return (previous or 0) + 1

    async def read_canvases(self, chapter_id: str, sequence_id: str) -> SceneCanvasesRead:
        """读取场次摘要与本场画布，不加载旧版本或写入新依据。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id)
        version = sha256(chapter.raw_text.encode()).hexdigest()
        ids = (await self.db.scalars(select(GenerationCanvas.id).where(
            GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == sequence.id)
            .order_by(GenerationCanvas.created_at.desc(), GenerationCanvas.id.desc()))).all()
        fixed = self._fixed_basis()
        rows = (await self.db.execute(select(
            GenerationCanvas.id, GenerationCanvas.created_at, GenerationCanvas.revision,
            GenerationCanvas.document['name'].as_string().label('name'),
            GenerationCanvas.document['fixed_source']['chapter_version'].as_string().label('source_version'),
            GenerationCanvas.document['fixed_source']['source_explanations'].label('source_explanations'),
            cast(func.json_extract(fixed, '$.selection_start'), Integer).label('source_start'),
            cast(func.json_extract(fixed, '$.selection_end'), Integer).label('source_end'),
            GenerationCanvas.document['storyboard']['task_id'].as_string().label('applied_task'),
        ).where(
            GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == sequence.id, GenerationCanvas.id.in_(ids)
        ))).all() if ids else []
        by_id = {row.id: row for row in rows}
        rows = [by_id[identity] for identity in ids if identity in by_id]
        latest, candidates = await self._canvas_storyboards(chapter_id, sequence_id) if rows else ({}, {})
        canvases = []
        for row in rows:
            task, candidate = latest.get(row.id), candidates.get(row.id)
            source_changed = (row.source_explanations or []) != explanation_basis(chapter)['items'] or row.source_version != version or (
                (row.source_start, row.source_end) != (sequence.source_start, sequence.source_end))
            canvases.append(SceneCanvasSummary(
                id=row.id, name=row.name, created_at=row.created_at, source_changed=source_changed,
                applied_storyboard_task_id=row.applied_task,
                can_open=bool(row.applied_task or not task or task.original_target == row.id),
                latest_storyboard=StoryboardTaskSummary(
                    canvas_id=row.id, task_id=task.id, status=TaskStatus(task.status), stage=task.stage, error=task.error_message,
                    candidate_available=bool(candidate and candidate.id == task.id), retry_of_task_id=task.retry_of_task_id,
                    review_state=review_state(task.status, task.review_state or ('pending' if task.review_retry_from else None)),
                ) if task else None,
                candidate_storyboard_task_id=candidate.id if candidate else None,
                storyboard_review_required=bool(candidate and (
                    candidate.reextract_target == row.id or candidate.base_revision != row.revision
                    or candidate.review_retry_from or candidate.review_state == 'conflict')),
            ))
        return SceneCanvasesRead(sequence=self.sequence_read(sequence, chapter), canvases=canvases)

    def _fixed_basis(self):
        """Locate the fixed card without transferring the canvas card list."""
        document = GenerationCanvas.document
        card_id = document['fixed_source']['card_id'].as_string()
        if self.db.get_bind().dialect.name == 'sqlite':
            cards = func.json_each(document, '$.cards').table_valued('value')
            return (select(cards.c.value).where(func.json_extract(cards.c.value, '$.id') == card_id)
                    .correlate(GenerationCanvas).limit(1).scalar_subquery())
        id_path = func.json_unquote(func.json_search(document, 'one', card_id, None, '$.cards[*].id'))
        return func.json_extract(document, func.substring_index(id_path, '.', 2))

    async def _canvas_storyboards(self, chapter_id: str, sequence_id: str):
        """每张画布最多读取一条成功任务与一条其他任务，不传输候选正文。"""
        canvas_id = Task.input_snapshot['canvas_id'].as_string()
        priority = case((Task.status.in_((TaskStatus.queued, TaskStatus.running)), 0), else_=1)
        ranked = select(
            Task.id, Task.created_at, Task.status, Task.stage, Task.error_message, Task.retry_of_task_id,
            canvas_id.label('canvas_id'), priority.label('priority'), SCENE_TASK_ORDER.label('admission_order'),
            Task.input_snapshot['reextract_canvas_id'].as_string().label('reextract_target'),
            func.first_value(Task.input_snapshot['reextract_canvas_id'].as_string()).over(
                partition_by=canvas_id, order_by=(SCENE_TASK_ORDER, Task.created_at, Task.id),
            ).label('original_target'),
            Task.result['base_revision'].as_integer().label('base_revision'),
            Task.result['review_state'].as_string().label('review_state'),
            Task.input_snapshot['review_retry_from'].as_string().label('review_retry_from'),
            func.row_number().over(
                partition_by=(canvas_id, Task.status == TaskStatus.succeeded),
                order_by=(priority, SCENE_TASK_ORDER.desc(), Task.created_at.desc(), Task.id.desc()),
            ).label('rank'),
        ).join(GenerationCanvas, GenerationCanvas.id == canvas_id).where(
            Task.project_id == self.project_id, Task.target_type == 'directing_sequence', Task.target_id == sequence_id,
            Task.kind == STORYBOARD_KIND, Task.input_snapshot['chapter_id'].as_string() == chapter_id,
            GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == sequence_id,
        ).subquery()
        rows = await self.db.execute(select(ranked, CanvasSaveReceipt.request_id.label('receipt')).outerjoin(
            CanvasSaveReceipt, (CanvasSaveReceipt.canvas_id == ranked.c.canvas_id)
            & (CanvasSaveReceipt.request_id == literal('storyboard:') + ranked.c.id),
        ).where(ranked.c.rank == 1).order_by(
            ranked.c.priority, ranked.c.admission_order.desc(), ranked.c.created_at.desc(), ranked.c.id.desc()))
        latest, candidates = {}, {}
        for row in rows:
            latest.setdefault(row.canvas_id, row)
            if row.status == TaskStatus.succeeded and row.receipt is None and row.base_revision is not None:
                candidates[row.canvas_id] = row
        return latest, candidates

    async def create_canvas(self, chapter_id: str, sequence_id: str, body: SceneCanvasCreate) -> CanvasRead:
        """从已确认摘录建立固定依据，不用旧坐标截取刚修改的章节正文。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id, lock=True)
        store = CanvasStore(self.db, self.project_id)
        canvas_id = None
        digest = None
        if body.request_id:
            identity = store.command_digest({'project': self.project_id, 'scene': sequence.id, 'request': body.request_id})
            canvas_id = uuid5(NAMESPACE_URL, f'scene-blank-canvas:{identity}').hex
            digest = store.command_digest({'name': body.name})
            receipt = await store.save_receipt(canvas_id, 'scene-blank-create', digest)
            if receipt:
                return CanvasRead.model_validate(receipt['scene_canvas'])
        if not sequence.is_current or not sequence.source_text.strip():
            raise ValueError('此场次没有可用的已确认原文')
        source = self.sequence_read(sequence, chapter).source
        if source.kind != 'chapter' or source.reference != chapter.id:
            raise ValueError('此场次的原文依据不属于当前章节')
        name = body.name.strip() or f"分镜画布-{datetime.now(UTC):%Y%m%d-%H%M%S}"
        basis = CreativeBasisCard(id=uuid4().hex, text=sequence.source_text,
                                  source_locator=f'章节 {chapter.title} · 场次 {sequence.title}',
                                  selection_start=sequence.source_start, selection_end=sequence.source_end)
        canvas = await store.create(name, scene=SceneCanvasSeed(
            sequence_id=sequence.id, basis=basis, canvas_id=canvas_id, fixed_source=CanvasFixedSource(
                card_id=basis.id, chapter_id=chapter.id, chapter_version=source.version,
                source_explanations=explanation_basis(chapter)["items"] if source.version == sha256(chapter.raw_text.encode()).hexdigest() else [],
                shooting_notes=await scene_shooting_notes(self.db, sequence))))
        result = await store.read(canvas.id)
        if digest:
            self.db.add(CanvasSaveReceipt(canvas_id=canvas.id, request_id='scene-blank-create', request_hash=digest,
                                          response={'scene_canvas': result.model_dump(mode='json')}))
        return result
