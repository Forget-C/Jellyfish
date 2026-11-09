"""场次与共同画布的创建、归属及准备页读取。"""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from app.core.contracts.directing.scene_canvas import SceneCanvasCreate, SceneCanvasesRead, SceneCanvasSummary
from app.models.directing import Sequence
from app.models.generation_canvas import GenerationCanvas
from app.models.studio import Chapter
from app.schemas.generation_canvas import CanvasFixedSource, CanvasRead, CreativeBasisCard
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
        rows = await self.db.scalars(select(GenerationCanvas).where(
            GenerationCanvas.project_id == self.project_id, GenerationCanvas.sequence_id == sequence.id
        ).order_by(GenerationCanvas.created_at, GenerationCanvas.id))
        canvases = [SceneCanvasSummary(id=row.id, name=row.document['name'],
                    source_changed=row.document['fixed_source']['chapter_version'] != version) for row in rows]
        return SceneCanvasesRead(sequence=self.sequence_read(sequence, chapter), canvases=canvases)

    async def create_canvas(self, chapter_id: str, sequence_id: str, body: SceneCanvasCreate) -> CanvasRead:
        """从已确认摘录建立固定依据，不用旧坐标截取刚修改的章节正文。"""
        sequence, chapter = await self._scene(chapter_id, sequence_id, lock=True)
        if not sequence.is_current or not sequence.source_text.strip():
            raise ValueError('此场次没有可用的已确认原文')
        source = self.sequence_read(sequence, chapter).source
        if source.kind != 'chapter' or source.reference != chapter.id:
            raise ValueError('此场次的原文依据不属于当前章节')
        name = body.name.strip() or f"分镜画布-{datetime.now(UTC):%Y%m%d-%H%M%S}"
        basis = CreativeBasisCard(id=uuid4().hex, text=sequence.source_text,
                                  source_locator=f'章节 {chapter.title} · 场次 {sequence.title}',
                                  selection_start=sequence.source_start, selection_end=sequence.source_end)
        store = CanvasStore(self.db, self.project_id)
        canvas = await store.create(name, scene=SceneCanvasSeed(
            sequence_id=sequence.id, basis=basis, fixed_source=CanvasFixedSource(
                card_id=basis.id, chapter_id=chapter.id, chapter_version=source.version)))
        return await store.read(canvas.id)
