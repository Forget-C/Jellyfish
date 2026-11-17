"""场次原文、版本与素材的工作区读写编排，HTTP 层只负责收参与响应。"""

from hashlib import sha256

from sqlalchemy import func, or_, select, update

from app.core.contracts.directing.common import Source
from app.core.contracts.directing.workspace import (
    RevisionWrite, ChapterOverview, SequenceOverview, ChapterSequences, SequenceCreate, SequenceRead, SequenceUpdate, SourceSpan, WorkspaceRead,
)
from app.core.contracts.directing.production import SequenceCut, TakeAnnotation
from app.models.directing import ActiveCut, DirectingRevision, Sequence, Take
from app.models.studio import Chapter
from app.models.task import Task
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.directing.division_versions import current_version, record_version


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
        return self.sequence_read(row, chapter)

    def sequence_read(self, row: Sequence, chapter: Chapter) -> SequenceRead:
        """序列化已读取的对象；锁定写事务不得用旧快照重新查询覆盖当前读。"""
        return SequenceRead(id=row.id, project_id=self.project_id, chapter_id=row.chapter_id,
                            title=row.title, position=row.position, version=row.version, is_current=row.is_current,
                            source=Source.model_validate(row.source), source_text=row.source_text,
                            shooting_preparation=row.shooting_preparation or {},
                            span=SourceSpan(start=row.source_start, end=row.source_end) if row.source_end else None,
                            source_changed=row.source["version"] != sha256(chapter.raw_text.encode()).hexdigest())

    async def list_sequences(self, chapter_id: str) -> ChapterSequences:
        """读取章节原文及有序场次，供人工划场和 AI 建议确认。"""
        chapter = await self.chapter(chapter_id)
        rows = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True)).order_by(Sequence.position)))
        return ChapterSequences(chapter_id=chapter.id, title=chapter.title, raw_text=chapter.raw_text,
                                source_version=sha256(chapter.raw_text.encode()).hexdigest(),
                                current_version=await current_version(self.db, chapter_id),
                                sequences=[await self.read_sequence(row.id) for row in rows],
                                task_ids=list(await self.db.scalars(select(Task.id).where(
                                    Task.project_id == self.project_id, Task.target_type == "directing_chapter",
                                    Task.target_id == chapter_id).order_by(Task.created_at))))

    async def historical_sequences(self, chapter_id: str) -> list[SequenceRead]:
        """按需读取退出的场次；不混入当前数量、默认选择和章节组合。"""
        await self.chapter(chapter_id)
        identities = await self.db.scalars(select(Sequence.id).where(Sequence.chapter_id == chapter_id,
            Sequence.is_current.is_(False)).order_by(Sequence.position, Sequence.id))
        return [await self.read_sequence(identity) for identity in identities]

    async def chapter_overview(self, chapter_id: str) -> ChapterOverview:
        """批量读取整场计数；只解析采用指针正文，查询数不随场次数增加。"""
        chapter = await self.chapter(chapter_id)
        source_version = sha256(chapter.raw_text.encode()).hexdigest()
        rows = list(await self.db.execute(select(Sequence.id, Sequence.position, Sequence.title,
            Sequence.source, func.substr(Sequence.source_text, 1, 160).label("excerpt"))
            .where(Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True)).order_by(Sequence.position)))
        summaries = {row.id: SequenceOverview(id=row.id, position=row.position, title=row.title,
            source_excerpt=row.excerpt, source_changed=Source.model_validate(row.source).version != source_version,
            design_count=0, confirmed_design_count=0, plan_count=0, confirmed_plan_count=0,
            take_count=0, unreviewed_take_count=0, active_cut_revision_id=None) for row in rows}
        if summaries:
            revisions = await self.db.execute(select(DirectingRevision.sequence_id, DirectingRevision.kind,
                func.count(DirectingRevision.id), func.count(DirectingRevision.confirmed_at))
                .where(DirectingRevision.sequence_id.in_(summaries), DirectingRevision.kind.in_(["design", "plan"]))
                .group_by(DirectingRevision.sequence_id, DirectingRevision.kind))
            for sequence_id, kind, total, confirmed in revisions:
                setattr(summaries[sequence_id], kind + "_count", total)
                setattr(summaries[sequence_id], "confirmed_" + kind + "_count", confirmed)
            takes = await self.db.execute(select(Take.sequence_id, Take.annotation).where(Take.sequence_id.in_(summaries)))
            for sequence_id, payload in takes:
                annotation = TakeAnnotation.model_validate(payload)
                summaries[sequence_id].take_count += 1
                summaries[sequence_id].unreviewed_take_count += annotation.review_status == "unreviewed"
            cuts = await self.db.execute(select(ActiveCut.sequence_id, ActiveCut.revision_id,
                DirectingRevision.sequence_id, DirectingRevision.kind, DirectingRevision.confirmed_at,
                DirectingRevision.payload).outerjoin(DirectingRevision, DirectingRevision.id == ActiveCut.revision_id)
                .where(ActiveCut.sequence_id.in_(summaries)))
            for sequence_id, revision_id, owner_id, kind, confirmed_at, payload in cuts:
                if owner_id != sequence_id or kind != "cut" or confirmed_at is None:
                    raise ValueError("当前采用版本不属于场次或未经确认")
                SequenceCut.model_validate(payload)
                summaries[sequence_id].active_cut_revision_id = revision_id
        return ChapterOverview(chapter_id=chapter.id, title=chapter.title, source_version=source_version,
                               sequences=list(summaries.values()))

    async def write_sequence(self, chapter_id: str, body: SequenceCreate | SequenceUpdate,
                             sequence_id: str | None = None) -> SequenceRead:
        """章节锁内比较版本和范围冲突；仅改名称/顺序不重新确认原文依据。"""
        await self.chapter(chapter_id)
        chapter = await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id).with_for_update().execution_options(populate_existing=True))
        version = sha256(chapter.raw_text.encode()).hexdigest()
        if body.source_version != version:
            raise RevisionConflict("章节原文已变化，请刷新并重新确认范围")
        # 使用锁定读取得最新范围，避免 MySQL 可重复读快照遗漏刚提交的竞争写入。
        siblings = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True))
            .with_for_update().execution_options(populate_existing=True)))
        previous = next((item for item in siblings if item.id == sequence_id), None)
        if sequence_id is not None and previous is None:
            raise ValueError("场次不属于本章当前划分，不能修改")
        if previous:
            if not isinstance(body, SequenceUpdate):
                raise ValueError("场次章节或版本不匹配")
            if previous.version != body.expected_version:
                raise RevisionConflict("场次已被修改，请刷新后重试")
        if body.span is not None:
            if body.span.end > len(chapter.raw_text):
                raise ValueError("场次范围超出章节原文")
            if not chapter.raw_text[body.span.start:body.span.end].strip():
                raise ValueError("场次范围必须包含正文")
            unchanged = previous is not None and previous.source["version"] == version and (
                previous.source_start, previous.source_end) == (body.span.start, body.span.end)
            if not unchanged:
                for other in siblings:
                    if (other.id == sequence_id or other.source["version"] != version
                            or other.source_start is None or other.source_end is None):
                        continue
                    if body.span.start < other.source_end and other.source_start < body.span.end:
                        raise RevisionConflict(f"原文范围与场次「{other.title}」重叠，请调整范围")
        source_unchanged = body.span is None or unchanged
        if previous and previous.title == body.title and previous.position == body.position and source_unchanged:
            return self.sequence_read(previous, chapter)
        async with self.db.begin_nested():
            if siblings and not await current_version(self.db, chapter_id, locked=True):
                await record_version(self.db, self.division_snapshot(chapter, siblings), origin='baseline')
            if sequence_id is None:
                if await self.db.scalar(select(Sequence.id).where(Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True), Sequence.position == body.position)):
                    raise RevisionConflict("此场次顺序已被使用，请刷新后重试")
                row = await self.create_sequence(chapter_id=chapter_id, title=body.title, position=body.position)
            else:
                row = previous
                other = await self.db.scalar(select(Sequence).where(Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True),
                    Sequence.position == body.position, Sequence.id != sequence_id))
                if other is not None:
                    old_position = row.position
                    temporary = (await self.db.scalar(select(func.max(Sequence.position)).where(Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True)))) + 1
                    await self.db.execute(update(Sequence).where(Sequence.id == sequence_id).values(position=temporary))
                    await self.db.execute(update(Sequence).where(Sequence.id == other.id).values(position=old_position, version=other.version + 1))
                row = await self.update_sequence(sequence_id, expected_version=body.expected_version,
                                                 title=body.title, position=body.position)
            if body.span is not None:
                await self.db.execute(update(Sequence).where(Sequence.id == row.id).values(
                    source_start=body.span.start, source_end=body.span.end,
                    source_text=chapter.raw_text[body.span.start:body.span.end],
                    source=Source(kind="chapter", reference=chapter.id, version=version).model_dump(mode="json"),
                ))
            members = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id,
                Sequence.is_current.is_(True)).order_by(Sequence.position).with_for_update().execution_options(populate_existing=True)))
            await record_version(self.db, self.division_snapshot(chapter, members), origin='manual')
        return await self.read_sequence(row.id)

    def division_snapshot(self, chapter: Chapter, members: list[Sequence]) -> ChapterSequences:
        """冻结锁定后的有序成员和当前原文，绝不把异步任务列表混入保存版本。"""
        return ChapterSequences(chapter_id=chapter.id, title=chapter.title, raw_text=chapter.raw_text,
            source_version=sha256(chapter.raw_text.encode()).hexdigest(),
            sequences=[self.sequence_read(row, chapter) for row in sorted(members, key=lambda item: item.position)])

    async def save_workspace_revision(self, sequence_id: str, body: RevisionWrite):
        """比较用户编辑时看到的场次，避免旧页面内容被标成新来源。"""
        await self.current_sequence(sequence_id)
        await self.db.scalar(select(Sequence).where(Sequence.id == sequence_id).with_for_update())
        sequence = await self.read_sequence(sequence_id)
        if body.document.kind == "design":
            if body.sequence_version != sequence.version or sequence.source_changed:
                raise RevisionConflict("场次或原文已变化，请刷新、核对设计后再保存")
        return await self.save_revision(sequence_id, kind=body.document.kind,
            payload=body.document.content.model_dump(mode="json"), revision_id=body.revision_id,
            expected_version=body.expected_version, parent_id=body.parent_id)

    async def take_thumbnail(self, sequence_id: str, take_id: str) -> bytes:
        """真实视频首帧的派生缓存；文件锁避免重复解码，不创建素材或采用关系。"""
        import asyncio
        from botocore.exceptions import ClientError
        from app.core import storage
        from app.services.directing.media import extract_frame
        from app.services.studio.files import require_available_file

        take = await self.take(take_id, sequence_id=sequence_id)
        file = await require_available_file(self.db, file_id=take.file_id, expected_type="video")
        identity = sha256(file.storage_key.encode()).hexdigest()[:16]
        key = f"previews/directing/{file.id}/{identity}-480-v1.png"
        if file.thumbnail_key == key:
            try:
                return await storage.download_file(key=key)
            except ClientError as error:
                if error.response.get("Error", {}).get("Code") not in {"NoSuchKey", "404", "NotFound"}:
                    raise
        content = await storage.download_file(key=file.storage_key)
        frame = await asyncio.to_thread(extract_frame, content, 0, thumbnail=True)
        await storage.upload_file(key=key, data=frame, content_type="image/png")
        file.thumbnail_key = key
        await self.db.flush()
        return frame

    async def extract_take_frame(self, sequence_id: str, take_id: str, at_ms: int, *, adopted_range=None, edge="start"):
        """提帧归档到当前项目，持久保留 Take 和毫秒位置，不改原视频。"""
        await self.current_sequence(sequence_id)
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

    async def assets(self, *, main_only=False):
        """列出当前项目直接拥有的对象，供场次工作单显式选择。"""
        from app.core.contracts.directing.workspace import AssetSummary
        from app.models.studio import Character, Scene, Prop
        from app.services.directing.object_assets import reference_images

        result = []
        queries = [(kind, select(model).where(model.project_id == self.project_id))
                   for kind, model in [('character', Character), ('scene', Scene), ('prop', Prop)]]
        for kind, query in queries:
            rows = list(await self.db.scalars(query))
            grouped = await reference_images(self.db, kind, [row.id for row in rows], main_only=main_only)
            for row in rows:
                images, unavailable = grouped[row.id]
                result.append(AssetSummary(id=row.id, kind=kind, name=row.name, description=row.description or '',
                    main_image_file_id=next((image.file_id for image in images if image.is_primary), None),
                    reference_images=images, image_file_ids=list(dict.fromkeys(image.file_id for image in images)),
                    unavailable_image_count=unavailable))
        return result

    async def create_asset(self, sequence_id, body):
        """项目锁串行化同次请求；返回精确实体，不能凭列表顺序或同名资产猜测。"""
        await self.current_sequence(sequence_id)
        from uuid import uuid5, NAMESPACE_URL
        from app.models.studio import Project
        from app.services.studio.entities import StudioEntitiesService

        sequence = await self.sequence(sequence_id)
        project = await self.db.scalar(select(Project).where(Project.id == self.project_id).with_for_update())
        asset_id = uuid5(NAMESPACE_URL, f'directing-asset:{self.project_id}:{sequence_id}:{body.request_id}').hex
        previous = next((asset for asset in await self.assets() if asset.id == asset_id), None)
        if previous is not None:
            if previous.kind != body.kind or previous.name != body.name or previous.description.strip() != body.description.strip():
                raise RevisionConflict('此创建请求已产生资产，内容已不同，请查看原资产后再决定是否新建')
            return previous
        payload = {"id": asset_id, "project_id": self.project_id, "chapter_id": sequence.chapter_id,
            "name": body.name, "style": project.style, "visual_style": project.visual_style,
            "description" if body.kind == "character" else "supplementary_info": body.description}
        await StudioEntitiesService(self.db).create_entity(entity_type=body.kind, body=payload)
        return next(asset for asset in await self.assets() if asset.id == asset_id and asset.kind == body.kind)

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
