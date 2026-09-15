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

    async def extract_take_frame(self, sequence_id: str, take_id: str, at_ms: int, *, adopted_range=None, edge="start"):
        """提帧归档到当前项目，持久保留 Take 和毫秒位置，不改原视频。"""
        import asyncio
        from io import BytesIO
        from fastapi import UploadFile
        from starlette.datastructures import Headers
        from app.core import storage
        from app.core.contracts.directing.workspace import ExtractedFrame
        from app.services.directing.media import extract_frame, extract_boundary_frame
        from app.services.studio.files import require_available_file, upload_file

        take = await self.take(take_id, sequence_id=sequence_id)
        file = await require_available_file(self.db, file_id=take.file_id)
        if at_ms < 0 or file.duration_ms is None or at_ms >= file.duration_ms:
            raise ValueError("提帧位置必须在真实视频时长内")
        content = await storage.download_file(key=file.storage_key)
        if adopted_range is not None:
            await self._range(file.id, adopted_range)
            frame, at_ms = await asyncio.to_thread(extract_boundary_frame, content,
                adopted_range.source_in_ms, adopted_range.source_out_ms, edge)
        else:
            frame = await asyncio.to_thread(extract_frame, content, at_ms)
        sequence = await self.sequence(sequence_id)
        result = await upload_file(self.db, file=UploadFile(file=BytesIO(frame), filename=f"frame-{at_ms}.png", size=len(frame),
            headers=Headers({"content-type": "image/png"})), project_id=self.project_id, chapter_id=sequence.chapter_id,
            usage_kind="directing_reference", source_ref=f"frame:{take.id}:{at_ms}")
        return ExtractedFrame(file_id=result.id, source=Source(kind="file", reference=take.id, version="1",
            file_id=file.id, media_range={"source_in_ms": at_ms, "source_out_ms": at_ms + 1}))

    async def assets(self):
        """列出当前项目已关联资产，供场次工作单显式选择。"""
        from app.core.contracts.directing.workspace import AssetSummary
        from app.models.studio import Character, Scene, Prop, ProjectSceneLink, ProjectPropLink

        result = []
        queries = [("character", select(Character).where(Character.project_id == self.project_id)),
            ("scene", select(Scene).join(ProjectSceneLink, ProjectSceneLink.scene_id == Scene.id).where(ProjectSceneLink.project_id == self.project_id).distinct()),
            ("prop", select(Prop).join(ProjectPropLink, ProjectPropLink.prop_id == Prop.id).where(ProjectPropLink.project_id == self.project_id).distinct())]
        for kind, query in queries:
            for row in await self.db.scalars(query):
                result.append(AssetSummary(id=row.id, kind=kind, name=row.name, description=row.description or ""))
        return result

    async def create_asset(self, sequence_id, body):
        """复用资产创建服务并关联项目，不自动替换场次内已有身份。"""
        from uuid import uuid4
        from app.models.studio import Project
        from app.services.studio.entities import StudioEntitiesService

        sequence = await self.sequence(sequence_id)
        project = await self.db.get(Project, self.project_id)
        payload = {"id": uuid4().hex, "project_id": self.project_id, "chapter_id": sequence.chapter_id,
            "name": body.name, "style": project.style, "visual_style": project.visual_style,
            "description" if body.kind == "character" else "supplementary_info": body.description}
        await StudioEntitiesService(self.db).create_entity(entity_type=body.kind, body=payload)
        return await self.assets()

    async def workspace(self, sequence_id: str) -> WorkspaceRead:
        """一次读取各类版本、候选和任务身份，不在任务中心复制业务上下文。"""
        sequence = await self.read_sequence(sequence_id)
        groups = {name: [] for name in ("designs", "plans", "prompts", "reviews", "cuts")}
        rows = await self.db.scalars(select(DirectingRevision).where(DirectingRevision.sequence_id == sequence_id,
                                     DirectingRevision.kind.in_(["design", "plan", "prompt", "review", "cut"]))
                                     .order_by(DirectingRevision.created_at, DirectingRevision.id))
        for row in rows:
            groups[row.kind + "s"].append(await self.read_revision(row.id))
        takes = await self.db.scalars(select(Take).where(Take.sequence_id == sequence_id).order_by(Take.created_at, Take.id))
        task_ids = list(await self.db.scalars(select(Task.id).where(Task.project_id == self.project_id,
            or_((Task.target_type == "directing_sequence") & (Task.target_id == sequence_id),
                Task.target_type.in_(["directing_unit", "directing_image"]) & Task.target_id.in_(select(DirectingRevision.id).where(DirectingRevision.sequence_id == sequence_id)))).order_by(Task.created_at)))
        return WorkspaceRead(sequence=sequence, **groups,
                             takes=[await self.read_take(row.id) for row in takes], task_ids=task_ids)
