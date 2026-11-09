"""场次与共同画布的创建、归属及准备页读取。"""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import NAMESPACE_URL, uuid4, uuid5
from fastapi import HTTPException
from sqlalchemy import case, func, literal, select
from app.core.contracts.directing.scene_canvas import SceneCanvasCreate, SceneCanvasesRead, SceneCanvasSummary
from app.core.contracts.directing.scene_storyboard import StoryboardTaskSummary
from app.core.contracts.task import TaskStatus
from app.models.directing import Sequence
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.studio import Chapter
from app.models.task import Task
from app.schemas.generation_canvas import CanvasFixedSource, CanvasRead, CreativeBasisCard
from app.services.directing.storyboard_assembly import STORYBOARD_KIND
from app.services.directing.workspace import WorkspaceService
from app.services.generation_canvas.store import CanvasStore, SceneCanvasSeed


class SceneCanvasService(WorkspaceService):
    """用章节项目、场次和画布的共同边界组织准备页。"""

    async def _scene(self, chapter_id: str, sequence_id: str, *, lock: bool = False) -> tuple[Sequence, Chapter]:
        """按同一快照核实场次与章节，创建时沿用章节再场次的锁顺序。"""
        chapter_query = select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == self.project_id)
        chapter = await self.db.scalar(chapter_query.with_for_update() if lock else chapter_query)
        if chapter is None:
            raise HTTPException(404, 'Chapter not found in project')
        sequence_query = select(Sequence).where(Sequence.id == sequence_id, Sequence.chapter_id == chapter.id)
        sequence = await self.db.scalar(sequence_query.with_for_update() if lock else sequence_query)
        if sequence is None:
            raise HTTPException(404, 'Scene not found in chapter')
        return sequence, chapter

    async def read_canvases(self, chapter_id: str, sequence_id: str) -> SceneCanvasesRead:
        """读取场次摘要与本场画布，不加载旧版本或写入新依据。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id)
        version = sha256(chapter.raw_text.encode()).hexdigest()
        rows = (await self.db.execute(select(
            GenerationCanvas.id, GenerationCanvas.created_at, GenerationCanvas.revision,
            GenerationCanvas.document['name'].as_string().label('name'),
            GenerationCanvas.document['fixed_source']['chapter_version'].as_string().label('source_version'),
            GenerationCanvas.document['storyboard']['task_id'].as_string().label('applied_task'),
        ).where(
            GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == sequence.id
        ).order_by(GenerationCanvas.created_at.desc(), GenerationCanvas.id.desc()))).all()
        latest, candidates = await self._canvas_storyboards(chapter_id, sequence_id) if rows else ({}, {})
        canvases = []
        for row in rows:
            task, candidate = latest.get(row.id), candidates.get(row.id)
            canvases.append(SceneCanvasSummary(
                id=row.id, name=row.name, created_at=row.created_at, source_changed=row.source_version != version,
                applied_storyboard_task_id=row.applied_task,
                latest_storyboard=StoryboardTaskSummary(
                    canvas_id=row.id, task_id=task.id, status=TaskStatus(task.status), stage=task.stage, error=task.error_message,
                    candidate_available=bool(candidate and candidate.id == task.id), retry_of_task_id=task.retry_of_task_id,
                ) if task else None,
                candidate_storyboard_task_id=candidate.id if candidate else None,
                storyboard_review_required=bool(candidate and (
                    candidate.reextract_target == row.id or candidate.base_revision != row.revision)),
            ))
        return SceneCanvasesRead(sequence=self.sequence_read(sequence, chapter), canvases=canvases)

    async def _canvas_storyboards(self, chapter_id: str, sequence_id: str):
        """每张画布最多读取一条成功任务与一条其他任务，不传输候选正文。"""
        canvas_id = Task.input_snapshot['canvas_id'].as_string()
        priority = case((Task.status.in_((TaskStatus.queued, TaskStatus.running)), 0), else_=1)
        ranked = select(
            Task.id, Task.created_at, Task.status, Task.stage, Task.error_message, Task.retry_of_task_id,
            canvas_id.label('canvas_id'), priority.label('priority'),
            Task.input_snapshot['reextract_canvas_id'].as_string().label('reextract_target'),
            Task.result['base_revision'].as_integer().label('base_revision'),
            func.row_number().over(
                partition_by=(canvas_id, Task.status == TaskStatus.succeeded),
                order_by=(priority, Task.created_at.desc(), Task.id.desc()),
            ).label('rank'),
        ).join(GenerationCanvas, GenerationCanvas.id == canvas_id).where(
            Task.project_id == self.project_id, Task.target_type == 'directing_sequence', Task.target_id == sequence_id,
            Task.kind == STORYBOARD_KIND, Task.input_snapshot['chapter_id'].as_string() == chapter_id,
            GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == sequence_id,
        ).subquery()
        rows = await self.db.execute(select(ranked, CanvasSaveReceipt.request_id.label('receipt')).outerjoin(
            CanvasSaveReceipt, (CanvasSaveReceipt.canvas_id == ranked.c.canvas_id)
            & (CanvasSaveReceipt.request_id == literal('storyboard:') + ranked.c.id),
        ).where(ranked.c.rank == 1).order_by(ranked.c.priority, ranked.c.created_at.desc(), ranked.c.id.desc()))
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
                card_id=basis.id, chapter_id=chapter.id, chapter_version=source.version)))
        result = await store.read(canvas.id)
        if digest:
            self.db.add(CanvasSaveReceipt(canvas_id=canvas.id, request_id='scene-blank-create', request_hash=digest,
                                          response={'scene_canvas': result.model_dump(mode='json')}))
        return result
