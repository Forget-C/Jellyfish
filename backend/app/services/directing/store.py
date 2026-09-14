"""场次契约的事务存储；调用方提交事务，任何失败回滚本次写入。"""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import uuid4

from pydantic import TypeAdapter
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing import SceneDesign, ProductionPlan, Prompt, ReviewPacket, SequenceCut, TakeAnnotation
from app.core.contracts.directing.common import Identity, Source, references
from app.core.contracts.directing.revisions import RevisionSnapshot, TakeSnapshot
from app.models.directing import Sequence, DirectingRevision, RevisionDependency, Take, CutTakeReference
from app.models.studio import Chapter, Character, FileUsage, ProjectSceneLink, ProjectPropLink
from app.models.task import Task, TaskOutput
from app.models.types import FileUsageKind
from app.services.studio.files import require_available_file
from app.services.studio.file_usages import upsert_file_usage

CONTRACTS = {"design": SceneDesign, "plan": ProductionPlan, "prompt": Prompt,
             "review": ReviewPacket, "cut": SequenceCut}
ID_ADAPTER = TypeAdapter(Identity)


class RevisionConflict(ValueError):
    """当前版本已变化或被冻结，调用方应重新读取并展示冲突。"""


class DirectingStore:
    """在明确项目范围内读写工作台基础记录，JSON 不是绕过校验的写入口。"""

    def __init__(self, db: AsyncSession, project_id: str):
        """绑定事务会话和上层已鉴权的项目，所有查询都重新核对归属。"""
        self.db = db
        self.project_id = ID_ADAPTER.validate_python(project_id)

    async def sequence(self, sequence_id: str) -> Sequence:
        """按章节项目查询场次，隐藏其他项目对象。"""
        result = await self.db.scalar(select(Sequence).join(Chapter, Chapter.id == Sequence.chapter_id).where(
            Sequence.id == sequence_id, Chapter.project_id == self.project_id,
        ).execution_options(populate_existing=True))
        if result is None:
            raise ValueError("sequence not found in project")
        return result

    async def create_sequence(self, *, chapter_id: str, title: str, position: int) -> Sequence:
        """建立叙事场次并保存原文摘要版本，不执行原文提取任务。"""
        ID_ADAPTER.validate_python(chapter_id)
        if not title.strip() or len(title) > 255 or (not isinstance(position, int) or isinstance(position, bool)) or position < 0:
            raise ValueError("invalid sequence title or position")
        chapter = await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == self.project_id))
        if chapter is None:
            raise ValueError("chapter not found in project")
        source = Source(kind="chapter", reference=chapter.id, version=sha256(chapter.raw_text.encode()).hexdigest())
        async with self.db.begin_nested():
            row = Sequence(id=uuid4().hex, chapter_id=chapter.id, title=title, position=position,
                           source=source.model_dump(mode="json"), version=1, source_start=0,
                           source_end=len(chapter.raw_text), source_text=chapter.raw_text)
            self.db.add(row)
            await self.db.flush()
        return row

    async def update_sequence(self, sequence_id: str, *, expected_version: int, title: str, position: int) -> Sequence:
        """通过版本比较更新场次标题和顺序，防止迟到保存覆盖人工修改。"""
        await self.sequence(sequence_id)
        if not title.strip() or len(title) > 255 or (not isinstance(position, int) or isinstance(position, bool)) or position < 0:
            raise ValueError("invalid sequence title or position")
        async with self.db.begin_nested():
            result = await self.db.execute(update(Sequence).where(
                Sequence.id == sequence_id, Sequence.version == expected_version,
            ).values(title=title, position=position, version=expected_version + 1))
            if result.rowcount != 1:
                raise RevisionConflict("sequence version changed")
        return await self.sequence(sequence_id)

    async def revision(self, revision_id: str, *, kind: str | None = None,
                       sequence_id: str | None = None, confirmed: bool = False) -> DirectingRevision:
        """读取并重验已存文档，依赖只接受同场次已确认版本。"""
        row = await self.db.get(DirectingRevision, revision_id, populate_existing=True)
        if row is None:
            raise ValueError("revision not found")
        await self.sequence(row.sequence_id)
        if kind is not None and row.kind != kind:
            raise ValueError("revision kind mismatch")
        if sequence_id is not None and row.sequence_id != sequence_id:
            raise ValueError("revision belongs to another sequence")
        if confirmed and row.confirmed_at is None:
            raise ValueError("dependency must be confirmed")
        CONTRACTS[row.kind].model_validate(row.payload)
        return row

    async def read_revision(self, revision_id: str) -> RevisionSnapshot:
        """返回有明确项目、章节和类型的快照，供未来 API/编译消费。"""
        row = await self.revision(revision_id)
        sequence = await self.sequence(row.sequence_id)
        return RevisionSnapshot[CONTRACTS[row.kind]](
            id=row.id, project_id=self.project_id, chapter_id=sequence.chapter_id,
            sequence_id=row.sequence_id, parent_id=row.parent_id, version=row.version,
            confirmed_by=row.confirmed_by, confirmed_at=row.confirmed_at,
            content=CONTRACTS[row.kind].model_validate(row.payload),
        )

    async def read_take(self, take_id: str) -> TakeSnapshot:
        """返回素材身份与实际审片，避免将 ORM 关系泄漏到跨层契约。"""
        row = await self.take(take_id)
        sequence = await self.sequence(row.sequence_id)
        return TakeSnapshot(
            id=row.id, project_id=self.project_id, chapter_id=sequence.chapter_id,
            sequence_id=row.sequence_id, prompt_revision_id=row.prompt_revision_id,
            plan_revision_id=row.plan_revision_id, unit_id=row.unit_id, task_id=row.task_id,
            output_ordinal=row.output_ordinal, file_id=row.file_id, version=row.version,
            annotation=TakeAnnotation.model_validate(row.annotation),
        )

    async def save_revision(self, sequence_id: str, *, kind: str, payload: dict,
                            revision_id: str | None = None, expected_version: int | None = None,
                            parent_id: str | None = None) -> DirectingRevision:
        """创建草稿或 CAS 更新草稿；冻结版本必须派生新 ID，引用索引与正文同事务。"""
        sequence = await self.sequence(sequence_id)
        if kind not in CONTRACTS:
            raise ValueError("unknown revision kind")
        content = CONTRACTS[kind].model_validate(payload)
        async with self.db.begin_nested():
            dependencies, files, takes = await self._validate(sequence, content)
            if revision_id is None:
                if expected_version is not None:
                    raise ValueError("new revision has no expected version")
                if parent_id is not None:
                    await self.revision(parent_id, kind=kind, sequence_id=sequence_id, confirmed=True)
                row = DirectingRevision(id=uuid4().hex, sequence_id=sequence_id, kind=kind,
                                        parent_id=parent_id, version=1, payload=content.model_dump(mode="json"))
                self.db.add(row)
                await self.db.flush()
            else:
                row = await self.revision(revision_id, kind=kind, sequence_id=sequence_id)
                if parent_id is not None or expected_version is None:
                    raise ValueError("update requires expected_version and cannot change parent")
                result = await self.db.execute(update(DirectingRevision).where(
                    DirectingRevision.id == row.id, DirectingRevision.version == expected_version,
                    DirectingRevision.confirmed_at.is_(None),
                ).values(payload=content.model_dump(mode="json"), version=expected_version + 1))
                if result.rowcount != 1:
                    raise RevisionConflict("revision changed or confirmed")
            await self._replace_links(row.id, sequence, dependencies, files, takes)
        return await self.revision(row.id)

    async def confirm_revision(self, revision_id: str, *, expected_version: int, actor_id: str) -> DirectingRevision:
        """由应用的人工作用域登记确认；模型工作单不能自行填写批准人。"""
        ID_ADAPTER.validate_python(actor_id)
        row = await self.revision(revision_id)
        async with self.db.begin_nested():
            await self._validate(await self.sequence(row.sequence_id), CONTRACTS[row.kind].model_validate(row.payload))
            result = await self.db.execute(update(DirectingRevision).where(
                DirectingRevision.id == row.id, DirectingRevision.version == expected_version,
                DirectingRevision.confirmed_at.is_(None),
            ).values(confirmed_by=actor_id, confirmed_at=datetime.now(UTC).replace(tzinfo=None), version=expected_version + 1))
            if result.rowcount != 1:
                raise RevisionConflict("revision changed or already confirmed")
        return await self.revision(row.id)

    async def _validate(self, sequence, content):
        """解析版本、局部 ID、媒体与实际区间，返回派生索引而不产生第二份真值。"""
        dependencies, files, takes = set(), set(), set()

        async def dependency(revision_id, kind):
            """读取同场次冻结依据并登记直接依赖。"""
            row = await self.revision(revision_id, kind=kind, sequence_id=sequence.id, confirmed=True)
            dependencies.add(row.id)
            return CONTRACTS[kind].model_validate(row.payload)

        if isinstance(content, SceneDesign):
            if content.style_revision_id is not None:
                raise ValueError("project style revisions are not implemented yet")
            for participant in content.participants:
                if participant.character_id and not await self.db.scalar(select(Character.id).where(
                    Character.id == participant.character_id, Character.project_id == self.project_id,
                )):
                    raise ValueError("character not linked to project")
                if participant.prop_id and not await self.db.scalar(select(ProjectPropLink.id).where(
                    ProjectPropLink.prop_id == participant.prop_id, ProjectPropLink.project_id == self.project_id,
                )):
                    raise ValueError("prop not linked to project")
            if content.direction.location_asset_id and not await self.db.scalar(select(ProjectSceneLink.id).where(
                ProjectSceneLink.scene_id == content.direction.location_asset_id, ProjectSceneLink.project_id == self.project_id,
            )):
                raise ValueError("location not linked to project")
        elif isinstance(content, ProductionPlan):
            design = await dependency(content.design_revision_id, "design")
            shots = {r.id: r for r in design.direction.shots}
            for unit in content.units:
                for item in unit.coverage:
                    references([item.shot_id], shots, "shot")
                    references(item.beat_ids, shots[item.shot_id].beat_ids, "shot beat")
                    references(item.event_ids, shots[item.shot_id].event_ids, "shot event")
                for binding in unit.references:
                    references(binding.participant_ids, [r.id for r in design.participants], "reference participant")
                    await require_available_file(self.db, file_id=binding.file_id, expected_type=binding.media_kind)
                    files.add(binding.file_id)
        elif isinstance(content, Prompt):
            plan = await dependency(content.plan_revision_id, "plan")
            unit = self._unit(plan, content.unit_id)
            for decision in content.decisions:
                if decision.reference_id:
                    references([decision.reference_id], [r.id for r in unit.references], "compiled reference")
                # section_path uses a JSON pointer into the exact design snapshot.
                design = await dependency(plan.design_revision_id, "design")
                self._section(design.model_dump(mode="json"), decision.section_path)
            files.update(binding.file_id for binding in unit.references)
        elif isinstance(content, ReviewPacket):
            expected = set()
            for occurrence in content.occurrences:
                prompt = await dependency(occurrence.prompt_revision_id, "prompt")
                if prompt.plan_revision_id != occurrence.plan_revision_id or prompt.unit_id != occurrence.unit_id:
                    raise ValueError("review prompt/unit version mismatch")
                plan = await dependency(prompt.plan_revision_id, "plan")
                unit = self._unit(plan, prompt.unit_id)
                expected.update((occurrence.prompt_revision_id, c.id) for c in unit.coverage)
                if occurrence.local_number > len(unit.coverage):
                    raise ValueError("review occurrence out of range")
                item = unit.coverage[occurrence.local_number - 1]
                if item.id != occurrence.coverage_item_id or item.shot_id != occurrence.shot_id:
                    raise ValueError("review coverage differs from frozen unit")
            if expected != {(o.prompt_revision_id, o.coverage_item_id) for o in content.occurrences}:
                raise ValueError("review omits prompt coverage")
        elif isinstance(content, SequenceCut):
            for item in content.items:
                if item.kind == "planned":
                    design = await dependency(item.design_revision_id, "design")
                    references([item.shot_id], [r.id for r in design.direction.shots], "planned shot")
                else:
                    take = await self.take(item.take_id, sequence_id=sequence.id)
                    await self._range(take.file_id, item.media_range)
                    files.add(take.file_id)
                    takes.add(take.id)
        # Every file source, including nested work-sheet evidence, protects the file.
        await self._sources(content.model_dump(mode="json"), sequence, files, dependencies)
        for file_id in sorted(files):
            await require_available_file(self.db, file_id=file_id)
        return dependencies, files, takes

    @staticmethod
    def _unit(plan, unit_id):
        """单元身份仅在指定生产版本里解析。"""
        for unit in plan.units:
            if unit.id == unit_id:
                return unit
        raise ValueError("unit not found in plan revision")

    @staticmethod
    def _section(document, pointer):
        """解析标准 JSON pointer，不允许未知工作单路径。"""
        if not pointer.startswith("/"):
            raise ValueError("section_path must be a JSON pointer")
        try:
            for token in pointer[1:].split("/"):
                token = token.replace("~1", "/").replace("~0", "~")
                document = document[int(token)] if isinstance(document, list) else document[token]
        except (KeyError, ValueError, IndexError, TypeError) as error:
            raise ValueError("unknown design section_path") from error
        return document

    async def _sources(self, value, sequence, files, dependencies):
        """遍历强类型来源节点，验证项目/场次和真实证据时间范围。"""
        if isinstance(value, dict):
            if {"kind", "reference", "version", "file_id", "media_range"} <= value.keys():
                source = Source.model_validate(value)
                if source.kind == "chapter" and (source.reference != sequence.chapter_id or source.version != sequence.source["version"]):
                    raise ValueError("chapter source does not match sequence source version")
                if source.kind == "revision":
                    row = await self.revision(source.reference, sequence_id=sequence.id, confirmed=True)
                    if source.version != str(row.version):
                        raise ValueError("source revision version mismatch")
                    dependencies.add(row.id)
                if source.file_id:
                    files.add(source.file_id)
                    if source.media_range:
                        await self._range(source.file_id, source.media_range)
            for child in value.values():
                await self._sources(child, sequence, files, dependencies)
        elif isinstance(value, list):
            for child in value:
                await self._sources(child, sequence, files, dependencies)

    async def _range(self, file_id, media_range):
        """实际视频/音频区间必须在已知文件时长内。"""
        file = await require_available_file(self.db, file_id=file_id)
        if file.type not in ("video", "audio") or file.duration_ms is None or media_range.source_out_ms > file.duration_ms:
            raise ValueError("media range exceeds known video/audio duration")

    async def _replace_links(self, revision_id, sequence, dependencies, files, takes):
        """正文和依赖/文件保护一起更新；旧冻结版本的引用保持不变。"""
        await self.db.execute(delete(RevisionDependency).where(RevisionDependency.revision_id == revision_id))
        await self.db.execute(delete(CutTakeReference).where(CutTakeReference.revision_id == revision_id))
        await self.db.execute(delete(FileUsage).where(FileUsage.project_id == self.project_id,
            FileUsage.usage_kind == FileUsageKind.directing_reference, FileUsage.source_ref == revision_id))
        self.db.add_all([RevisionDependency(revision_id=revision_id, dependency_id=key) for key in sorted(dependencies)])
        self.db.add_all([CutTakeReference(revision_id=revision_id, take_id=key) for key in sorted(takes)])
        for file_id in sorted(files):
            await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id, chapter_id=sequence.chapter_id,
                                    shot_id=None, usage_kind=FileUsageKind.directing_reference, source_ref=revision_id)
        await self.db.flush()

    async def take(self, take_id: str, *, sequence_id: str | None = None) -> Take:
        """读取当前项目的素材，剪辑只能使用本场次的 Take。"""
        row = await self.db.get(Take, take_id, populate_existing=True)
        if row is None:
            raise ValueError("take not found")
        await self.sequence(row.sequence_id)
        if sequence_id is not None and row.sequence_id != sequence_id:
            raise ValueError("take belongs to another sequence")
        TakeAnnotation.model_validate(row.annotation)
        return row

    async def register_take(self, *, prompt_revision_id: str, task_id: str, output_ordinal: int, delivery_task: Task | None = None) -> Take:
        """按 TaskOutput 幂等登记候选；不更改任何剪辑或镜头采用槽位。"""
        prompt_row = await self.revision(prompt_revision_id, kind="prompt", confirmed=True)
        sequence = await self.sequence(prompt_row.sequence_id)
        prompt = Prompt.model_validate(prompt_row.payload)
        async with self.db.begin_nested():
            # Serializes duplicate publisher calls on MySQL before querying the unique output key.
            output = await self.db.get(TaskOutput, (task_id, output_ordinal), with_for_update=True, populate_existing=True)
            task = await self.db.get(Task, task_id, populate_existing=True)
            completing = (delivery_task is task and task is not None and task.status == "running"
                          and task.target_type == "directing_unit" and task.target_id == prompt_revision_id)
            if output is None or task is None or task.project_id != self.project_id or (task.status != "succeeded" and not completing):
                raise ValueError("successful project task output required")
            if task.input_snapshot.get("prompt_revision_id") != prompt_revision_id:
                raise ValueError("task prompt revision mismatch")
            existing = await self.db.scalar(select(Take).where(Take.task_id == task_id, Take.output_ordinal == output_ordinal))
            if existing:
                if existing.prompt_revision_id != prompt_revision_id or existing.file_id != output.file_id:
                    raise ValueError("output identity conflicts with existing take")
                return existing
            await require_available_file(self.db, file_id=output.file_id, expected_type="video")
            row = Take(id=uuid4().hex, sequence_id=sequence.id, prompt_revision_id=prompt_revision_id,
                       plan_revision_id=prompt.plan_revision_id, unit_id=prompt.unit_id, task_id=task_id,
                       output_ordinal=output_ordinal, file_id=output.file_id, version=1,
                       annotation=TakeAnnotation(coverage=[], review_status="unreviewed", rationale={}, retained_ranges=[]).model_dump(mode="json"))
            self.db.add(row)
            await upsert_file_usage(self.db, file_id=output.file_id, project_id=self.project_id, chapter_id=sequence.chapter_id,
                                    shot_id=None, usage_kind=FileUsageKind.directing_take, source_ref=row.id)
            await self.db.flush()
        return row

    async def annotate_take(self, take_id: str, *, expected_version: int, annotation: dict) -> Take:
        """CAS 保存实际覆盖与四类审片结论，来源、归属和区间不能混用。"""
        row = await self.take(take_id)
        content = TakeAnnotation.model_validate(annotation)
        plan_row = await self.revision(row.plan_revision_id, kind="plan", confirmed=True)
        unit = self._unit(ProductionPlan.model_validate(plan_row.payload), row.unit_id)
        async with self.db.begin_nested():
            sequence = await self.sequence(row.sequence_id)
            files, dependencies = {row.file_id}, set()
            await self._sources(content.model_dump(mode="json"), sequence, files, dependencies)
            for file_id in sorted(files):
                await require_available_file(self.db, file_id=file_id)
            for coverage in content.coverage:
                references([coverage.coverage_item_id], [r.id for r in unit.coverage], "actual coverage")
                if coverage.source.kind != "file" or coverage.source.file_id != row.file_id or coverage.source.media_range != coverage.media_range:
                    raise ValueError("actual observation requires matching Take file and range")
                await self._range(row.file_id, coverage.media_range)
            for media_range in content.retained_ranges:
                await self._range(row.file_id, media_range)
            result = await self.db.execute(update(Take).where(Take.id == row.id, Take.version == expected_version).values(
                annotation=content.model_dump(mode="json"), version=expected_version + 1,
            ))
            if result.rowcount != 1:
                raise RevisionConflict("take annotation version changed")
            await self.db.execute(delete(FileUsage).where(
                FileUsage.project_id == self.project_id, FileUsage.usage_kind == FileUsageKind.directing_take,
                FileUsage.source_ref == row.id,
            ))
            for file_id in sorted(files):
                await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id,
                                        chapter_id=sequence.chapter_id, shot_id=None,
                                        usage_kind=FileUsageKind.directing_take, source_ref=row.id)
        return await self.take(row.id)
