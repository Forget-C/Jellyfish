"""场次原文、版本与素材的工作区读写编排，HTTP 层只负责收参与响应。"""

from hashlib import sha256

from sqlalchemy import func, or_, select, update

from app.core.contracts.directing.common import Source
from app.core.contracts.directing.workspace import (
    RevisionWrite, ChapterSequences, SequenceCreate, SequenceRead, SequenceUpdate, SourceSpan, WorkspaceRead,
)
from app.models.directing import DirectingRevision, Sequence, Take
from app.models.studio import Chapter
from app.models.task import Task
from app.services.directing.store import DirectingStore, RevisionConflict


class WorkspaceService(DirectingStore):
    """复用阶段一版本保护，为三视图组织同一场次上下文。"""

    async def chapter(self, chapter_id: str) -> Chapter:
        """所有场次入口先检查章节归属。"""
        chapter = await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == self.project_id))
        if chapter is None:
            raise ValueError("章节不属于当前项目")
        return chapter

    async def read_sequence(self, sequence_id: str) -> SequenceRead:
        """返回原文变化提示，旧场次摘录不自动更新。"""
        row = await self.sequence(sequence_id)
        chapter = await self.chapter(row.chapter_id)
        return SequenceRead(id=row.id, project_id=self.project_id, chapter_id=row.chapter_id,
                            title=row.title, position=row.position, version=row.version,
                            source=Source.model_validate(row.source), source_text=row.source_text,
                            span=SourceSpan(start=row.source_start, end=row.source_end) if row.source_end else None,
                            source_changed=row.source["version"] != sha256(chapter.raw_text.encode()).hexdigest())

    async def list_sequences(self, chapter_id: str) -> ChapterSequences:
        """读取章节原文及有序场次，供人工划场和 AI 建议确认。"""
        chapter = await self.chapter(chapter_id)
        rows = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id).order_by(Sequence.position)))
        return ChapterSequences(chapter_id=chapter.id, title=chapter.title, raw_text=chapter.raw_text,
                                source_version=sha256(chapter.raw_text.encode()).hexdigest(),
                                sequences=[await self.read_sequence(row.id) for row in rows],
                                task_ids=list(await self.db.scalars(select(Task.id).where(
                                    Task.project_id == self.project_id, Task.target_type == "directing_chapter",
                                    Task.target_id == chapter_id).order_by(Task.created_at))))

    async def write_sequence(self, chapter_id: str, body: SequenceCreate | SequenceUpdate,
                             sequence_id: str | None = None) -> SequenceRead:
        """范围变化和原文版本比较在同一事务，保存真实选定摘录。"""
        await self.chapter(chapter_id)
        chapter = await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id).with_for_update().execution_options(populate_existing=True))
        version = sha256(chapter.raw_text.encode()).hexdigest()
        if body.source_version != version:
            raise RevisionConflict("章节原文已变化，请刷新并重新确认范围")
        if body.span.end > len(chapter.raw_text):
            raise ValueError("场次范围超出章节原文")
        async with self.db.begin_nested():
            if sequence_id is None:
                if await self.db.scalar(select(Sequence.id).where(Sequence.chapter_id == chapter_id, Sequence.position == body.position)):
                    raise RevisionConflict("此场次顺序已被使用，请刷新后重试")
                row = await self.create_sequence(chapter_id=chapter_id, title=body.title, position=body.position)
            else:
                row = await self.sequence(sequence_id)
                if row.chapter_id != chapter_id or not isinstance(body, SequenceUpdate):
                    raise ValueError("场次章节或版本不匹配")
                if row.version != body.expected_version:
                    raise RevisionConflict("场次已被修改，请刷新后重试")
                other = await self.db.scalar(select(Sequence).where(Sequence.chapter_id == chapter_id,
                    Sequence.position == body.position, Sequence.id != sequence_id))
                if other is not None:
                    old_position = row.position
                    temporary = (await self.db.scalar(select(func.max(Sequence.position)).where(Sequence.chapter_id == chapter_id))) + 1
                    await self.db.execute(update(Sequence).where(Sequence.id == sequence_id).values(position=temporary))
                    await self.db.execute(update(Sequence).where(Sequence.id == other.id).values(position=old_position, version=other.version + 1))
                row = await self.update_sequence(sequence_id, expected_version=body.expected_version,
                                                 title=body.title, position=body.position)
            await self.db.execute(update(Sequence).where(Sequence.id == row.id).values(
                source_start=body.span.start, source_end=body.span.end,
                source_text=chapter.raw_text[body.span.start:body.span.end],
                source=Source(kind="chapter", reference=chapter.id, version=version).model_dump(mode="json"),
            ))
        return await self.read_sequence(row.id)

    async def save_workspace_revision(self, sequence_id: str, body: RevisionWrite):
        """比较用户编辑时看到的场次，避免旧页面内容被标成新来源。"""
        await self.db.scalar(select(Sequence).where(Sequence.id == sequence_id).with_for_update())
        sequence = await self.read_sequence(sequence_id)
        if body.document.kind == "design":
            if body.sequence_version != sequence.version or sequence.source_changed:
                raise RevisionConflict("场次或原文已变化，请刷新、核对设计后再保存")
        return await self.save_revision(sequence_id, kind=body.document.kind,
            payload=body.document.content.model_dump(mode="json"), revision_id=body.revision_id,
            expected_version=body.expected_version, parent_id=body.parent_id)

    async def workspace(self, sequence_id: str) -> WorkspaceRead:
        """一次读取各类版本、候选和任务身份，不在任务中心复制业务上下文。"""
        sequence = await self.read_sequence(sequence_id)
        groups = {name: [] for name in ("designs", "plans", "prompts", "reviews", "cuts")}
        rows = await self.db.scalars(select(DirectingRevision).where(DirectingRevision.sequence_id == sequence_id)
                                     .order_by(DirectingRevision.created_at, DirectingRevision.id))
        for row in rows:
            groups[row.kind + "s"].append(await self.read_revision(row.id))
        takes = await self.db.scalars(select(Take).where(Take.sequence_id == sequence_id).order_by(Take.created_at, Take.id))
        task_ids = list(await self.db.scalars(select(Task.id).where(Task.project_id == self.project_id,
            or_((Task.target_type == "directing_sequence") & (Task.target_id == sequence_id),
                (Task.target_type == "directing_unit") & Task.target_id.in_(select(DirectingRevision.id).where(DirectingRevision.sequence_id == sequence_id)))).order_by(Task.created_at)))
        return WorkspaceRead(sequence=sequence, **groups,
                             takes=[await self.read_take(row.id) for row in takes], task_ids=task_ids)
