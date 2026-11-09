"""为章节管理批量读取场次摘要，不加载画布文档或资产目录。"""

from hashlib import sha256

from sqlalchemy import case, func, select

from app.core.contracts.directing.workbench_management import (
    ChapterWorkbenchManagement, WorkbenchSceneSummary, WorkbenchTaskSummary,
)
from app.core.contracts.task import TERMINAL_TASK_STATUSES, TaskStatus
from app.models.directing import Sequence
from app.models.generation_canvas import GenerationCanvas
from app.models.task import Task
from app.services.directing.scene_canvas import SCENE_TASK_ORDER
from app.services.directing.scene_objects import OBJECT_EXTRACTION_KIND, _source_digest
from app.services.directing.storyboard_assembly import STORYBOARD_KIND
from app.services.directing.workspace import WorkspaceService


class WorkbenchManagementService(WorkspaceService):
    """在项目与章节归属校验后读取真实场次准备、画布及任务状态。"""

    async def chapter_management(self, chapter_id: str) -> ChapterWorkbenchManagement:
        """投影所需字段和计数，查询数不随场次数增加。"""
        chapter = await self.chapter(chapter_id)
        source_version = sha256(chapter.raw_text.encode()).hexdigest()
        prepared_digest = Sequence.object_preparation['source_digest'].as_string()
        prepared_objects = Sequence.object_preparation['objects']
        count_objects = (func.json_array_length(prepared_objects) if self.db.get_bind().dialect.name == 'sqlite'
                         else func.json_length(prepared_objects))
        canvas_counts = (select(GenerationCanvas.sequence_id, func.count(GenerationCanvas.id).label('total'))
                         .where(GenerationCanvas.project_id == self.project_id,
                                GenerationCanvas.sequence_id.in_(
                                    select(Sequence.id).where(Sequence.chapter_id == chapter_id)))
                         .group_by(GenerationCanvas.sequence_id).subquery())
        rows = (await self.db.execute(select(
            Sequence.id, Sequence.position, Sequence.title, Sequence.is_current, Sequence.source_start,
            Sequence.source['version'].as_string().label('source_version'),
            func.substr(Sequence.source_text, 1, 160).label('source_excerpt'),
            case((prepared_digest.is_not(None), Sequence.source_text), else_='').label('prepared_source'),
            prepared_digest.label('prepared_digest'), func.coalesce(count_objects, 0).label('object_count'),
            func.coalesce(canvas_counts.c.total, 0).label('canvas_count'),
        ).outerjoin(canvas_counts, canvas_counts.c.sequence_id == Sequence.id)
            .where(Sequence.chapter_id == chapter_id).order_by(Sequence.position, Sequence.id))).all()
        tasks = await self._management_tasks(chapter_id) if rows else {}
        current, historical = [], []
        for row in rows:
            prepared = row.prepared_digest is not None
            summary = WorkbenchSceneSummary(
                id=row.id, position=row.position, title=row.title, source_excerpt=row.source_excerpt,
                source_changed=row.source_version != source_version,
                object_count=row.object_count, canvas_count=row.canvas_count, has_object_preparation=prepared,
                preparation_stale=prepared and row.prepared_digest != _source_digest(
                    row.prepared_source, row.source_version, row.source_start),
                object_task=tasks.get((row.id, OBJECT_EXTRACTION_KIND)),
                storyboard_task=tasks.get((row.id, STORYBOARD_KIND)),
            )
            (current if row.is_current else historical).append(summary)
        return ChapterWorkbenchManagement(chapter_id=chapter.id, title=chapter.title,
            has_source=bool(chapter.raw_text.strip()), sequences=current, historical_sequences=historical)

    async def _management_tasks(self, chapter_id: str) -> dict[tuple[str, str], WorkbenchTaskSummary]:
        """每种任务优先选择仍在运行的项，再按创建时间选择最近记录。"""
        ranked = (select(Task.id, Task.target_id, Task.kind, Task.status, func.row_number().over(
            partition_by=(Task.target_id, Task.kind),
            order_by=(case((Task.status.in_(TERMINAL_TASK_STATUSES), 1), else_=0),
                      SCENE_TASK_ORDER.desc(), Task.created_at.desc(), Task.id.desc()),
        ).label('rank')).join(Sequence, Sequence.id == Task.target_id)
            .where(Sequence.chapter_id == chapter_id, Task.project_id == self.project_id,
                   Task.target_type == 'directing_sequence', Task.kind.in_((OBJECT_EXTRACTION_KIND, STORYBOARD_KIND)))
            .subquery())
        rows = await self.db.execute(select(ranked).where(ranked.c.rank == 1))
        return {(row.target_id, row.kind): WorkbenchTaskSummary(task_id=row.id, status=TaskStatus(row.status)) for row in rows}
