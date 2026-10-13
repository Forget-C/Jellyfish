"""场次契约的事务存储；调用方提交事务，任何失败回滚本次写入。"""

import json
from datetime import UTC, datetime
from hashlib import sha256
from types import SimpleNamespace
from uuid import uuid4

from pydantic import TypeAdapter
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing import SceneDesign, ProductionPlan, Prompt, ReviewPacket, SequenceCut, TakeAnnotation
from app.core.contracts.directing.common import Identity, Source, references
from app.core.contracts.directing.instruction_check import InstructionCheckResult
from app.core.contracts.directing.workspace import MediaRead
from app.core.contracts.directing.scene_video import SceneVideoPreparation, SceneVideoRead, SceneTakeRead
from app.core.contracts.directing.feedback import CutReview, RepairItem, KnowledgeCandidate
from app.core.contracts.directing.revisions import ReviewPacketRevision, RevisionSnapshot, TakeSnapshot
from app.core.contracts.directing.style import ProjectStyleProfile, ProjectStyleRevision, StyleWrite
from app.core.contracts.directing.scene_version import (
    EditableSceneDesign, SceneVersionContent, SceneVersionCreate, SceneVersionRead,
    SceneVersionSave, SceneVersionSource,
)
from app.models.directing import SceneVersionRecord, InstructionBasisRecord, SceneVideoExecution, SceneTakeRecord, SceneTakeReviewRecord, SceneEndFrameRecord, SceneCopyOrigin
from app.models.directing import ActiveCut, CutFrame, ProjectStyleRecord, Sequence, DirectingRevision, RevisionDependency, Take, CutTakeReference
from app.models.studio import Project, Chapter, Character, FileUsage, ProjectSceneLink, ProjectPropLink
from app.models.task import Task, TaskOutput
from app.models.llm import Model
from app.models.types import FileUsageKind
from app.services.studio.files import require_available_file
from app.services.studio.file_usages import upsert_file_usage

CONTRACTS = {"design": SceneDesign, "plan": ProductionPlan, "prompt": Prompt,
             "review": ReviewPacket, "cut": SequenceCut, "cut_review": CutReview,
             "repair": RepairItem, "knowledge": KnowledgeCandidate}
ID_ADAPTER = TypeAdapter(Identity)


class RevisionConflict(ValueError):
    """当前版本已变化或被冻结，调用方应重新读取并展示冲突。"""


class ContinuityNotReady(ValueError):
    """实际采用证据失效；可安全向用户显示恢复操作。"""


class DirectingStore:
    """在明确项目范围内读写工作台基础记录，JSON 不是绕过校验的写入口。"""

    def __init__(self, db: AsyncSession, project_id: str):
        """绑定事务会话和上层已鉴权的项目，所有查询都重新核对归属。"""
        self.db = db
        self.project_id = ID_ADAPTER.validate_python(project_id)
        self._writing_sequences: set[str] = set()

    async def style_revision(self, revision_id: str, *, confirmed: bool = False) -> ProjectStyleRecord:
        """只读取本项目风格，设计只能引用已确认快照。"""
        row = await self.db.scalar(select(ProjectStyleRecord).where(ProjectStyleRecord.id == revision_id,
            ProjectStyleRecord.project_id == self.project_id).execution_options(populate_existing=True))
        if row is None:
            raise ValueError("style revision not found in project")
        if confirmed and row.confirmed_at is None:
            raise ValueError("style revision must be confirmed")
        ProjectStyleProfile.model_validate(row.payload)
        return row

    async def list_styles(self) -> list[ProjectStyleRevision]:
        """按创建顺序返回风格候选和已确认版本，不自动选择最新版。"""
        rows = await self.db.scalars(select(ProjectStyleRecord).where(ProjectStyleRecord.project_id == self.project_id)
            .order_by(ProjectStyleRecord.created_at, ProjectStyleRecord.id))
        return [ProjectStyleRevision(id=row.id, project_id=row.project_id, parent_id=row.parent_id,
            version=row.version, confirmed_by=row.confirmed_by, confirmed_at=row.confirmed_at,
            content=ProjectStyleProfile.model_validate(row.payload)) for row in rows]

    async def save_style(self, body: StyleWrite) -> ProjectStyleRecord:
        """校验范围与证据后 CAS 保存；已确认版本只能派生，不修改全局资产。"""
        if not await self.db.get(Project, self.project_id):
            raise ValueError("project not found")
        if body.revision_id and body.parent_id:
            raise ValueError("cannot update and derive a style at once")
        if body.parent_id:
            await self.style_revision(body.parent_id, confirmed=True)
        files = await self._validate_style(body.content)
        async with self.db.begin_nested():
            if body.revision_id:
                row = await self.style_revision(body.revision_id)
                result = await self.db.execute(update(ProjectStyleRecord).where(ProjectStyleRecord.id == row.id,
                    ProjectStyleRecord.version == body.expected_version, ProjectStyleRecord.confirmed_at.is_(None))
                    .values(payload=body.content.model_dump(mode="json"), version=ProjectStyleRecord.version + 1))
                if result.rowcount != 1:
                    raise RevisionConflict("style changed or confirmed")
            else:
                if body.expected_version is not None:
                    raise ValueError("new style cannot have expected_version")
                row = ProjectStyleRecord(id=uuid4().hex, project_id=self.project_id, parent_id=body.parent_id,
                    payload=body.content.model_dump(mode="json"), version=1)
                self.db.add(row)
                await self.db.flush()
            await self.db.execute(delete(FileUsage).where(FileUsage.project_id == self.project_id,
                FileUsage.source_ref == "style:" + row.id))
            for file_id in files:
                await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id, chapter_id=None,
                    usage_kind="directing_reference", source_ref="style:" + row.id)
        return await self.style_revision(row.id)

    async def _validate_style(self, content: ProjectStyleProfile) -> set[str]:
        """保存与确认时复核适用范围和来源，避免草稿期间证据失效后仍被确认。"""
        files = set()
        for rule in content.rules:
            for sequence_id in rule.sequence_ids:
                await self.sequence(sequence_id)
        sources = content.sources + [source for rule in content.rules for source in [*rule.sources, *rule.exceptions.sources]]
        for source in sources:
            if source.kind == "chapter":
                chapter = await self.db.scalar(select(Chapter).where(Chapter.id == source.reference, Chapter.project_id == self.project_id))
                if not chapter or sha256(chapter.raw_text.encode()).hexdigest() != source.version:
                    raise ValueError("style chapter source does not match project or version")
            if source.kind == "revision":
                revision = await self.revision(source.reference, confirmed=True)
                if str(revision.version) != source.version:
                    raise ValueError("style source revision version mismatch")
            if source.file_id:
                await require_available_file(self.db, file_id=source.file_id)
                if not await self.db.scalar(select(FileUsage.file_id).where(FileUsage.file_id == source.file_id, FileUsage.project_id == self.project_id)):
                    raise ValueError("style evidence file not linked to project")
                if source.media_range:
                    await self._range(source.file_id, source.media_range)
                files.add(source.file_id)
        return files

    async def confirm_style(self, revision_id: str, *, expected_version: int, actor_id: str) -> ProjectStyleRecord:
        """记录用户对风格版本的确认；候选规则即使在确认版本内也不启用。"""
        ID_ADAPTER.validate_python(actor_id)
        row = await self.style_revision(revision_id)
        await self._validate_style(ProjectStyleProfile.model_validate(row.payload))
        result = await self.db.execute(update(ProjectStyleRecord).where(ProjectStyleRecord.id == row.id,
            ProjectStyleRecord.version == expected_version, ProjectStyleRecord.confirmed_at.is_(None))
            .values(version=ProjectStyleRecord.version + 1, confirmed_by=actor_id,
                confirmed_at=datetime.now(UTC).replace(tzinfo=None)))
        if result.rowcount != 1:
            raise RevisionConflict("style changed or confirmed")
        return await self.style_revision(row.id)

    async def applicable_style(self, revision_id: str | None, sequence_id: str, model_name: str):
        """只返回固定风格版本内已确认且满足场次和模型范围的规则。"""
        if not revision_id:
            return []
        row = await self.style_revision(revision_id, confirmed=True)
        return [rule for rule in ProjectStyleProfile.model_validate(row.payload).rules if rule.status == "confirmed"
            and (not rule.sequence_ids or sequence_id in rule.sequence_ids)
            and (not rule.model_names or model_name in rule.model_names)]

    async def sequence(self, sequence_id: str) -> Sequence:
        """按章节项目查询场次，隐藏其他项目对象。"""
        if sequence_id in self._writing_sequences:
            return await self.db.get(Sequence, sequence_id, with_for_update=True, populate_existing=True)
        result = await self.db.scalar(select(Sequence).join(Chapter, Chapter.id == Sequence.chapter_id).where(
            Sequence.id == sequence_id, Chapter.project_id == self.project_id,
        ).execution_options(populate_existing=True))
        if result is None:
            raise ValueError("sequence not found in project")
        return result

    async def current_sequence(self, sequence_id: str) -> Sequence:
        """生产写入先锁定场次并核对成员状态，后续场次读取保持当前读；历史读取和任务交付除外。"""
        await self.sequence(sequence_id)
        row = await self.db.get(Sequence, sequence_id, with_for_update=True, populate_existing=True)
        self._writing_sequences.add(sequence_id)
        if not row.is_current:
            raise RevisionConflict("场次已退出当前划分，仅可查看历史成果")
        return row

    async def create_sequence(self, *, chapter_id: str, title: str, position: int) -> Sequence:
        """建立叙事场次并保存原文摘要版本，不执行原文提取任务。"""
        ID_ADAPTER.validate_python(chapter_id)
        if not title.strip() or len(title) > 255 or (not isinstance(position, int) or isinstance(position, bool)) or position < 0:
            raise ValueError("invalid sequence title or position")
        chapter = await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == self.project_id).with_for_update().execution_options(populate_existing=True))
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
        row = await self.sequence(sequence_id)
        await self.db.scalar(select(Chapter).where(Chapter.id == row.chapter_id).with_for_update())
        await self.current_sequence(sequence_id)
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
                       sequence_id: str | None = None, confirmed: bool = False, for_update: bool = False) -> DirectingRevision:
        """读取并重验已存文档；幂等恢复使用当前读，避免等待锁后仍读取旧事务快照。"""
        row = await self.db.get(DirectingRevision, revision_id, populate_existing=True, with_for_update=True if for_update else None)
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

    async def list_scene_versions(self, sequence_id: str) -> list[SceneVersionRead]:
        """只读列出显式创建的方案；浏览不产生默认版本。"""
        await self.sequence(sequence_id)
        ids = await self.db.scalars(select(SceneVersionRecord.id).where(
            SceneVersionRecord.sequence_id == sequence_id).order_by(
                SceneVersionRecord.created_at, SceneVersionRecord.id))
        return [await self.read_scene_version(sequence_id, key) for key in ids]

    async def read_scene_version(self, sequence_id: str, version_id: str) -> SceneVersionRead:
        """读取重新校验强类型内容，并核对场次及项目归属。"""
        sequence = await self.sequence(sequence_id)
        row = await self.db.get(SceneVersionRecord, version_id, populate_existing=True)
        if row is None or row.sequence_id != sequence.id:
            raise ValueError('scene version not found in sequence')
        content = SceneVersionContent.model_validate(row.content)
        origin = await self.db.get(SceneCopyOrigin, row.id)
        return SceneVersionRead(copied_from_version_id=origin.source_version_id if origin else None, id=row.id, project_id=self.project_id, chapter_id=sequence.chapter_id,
            sequence_id=sequence.id, title=row.title, revision=row.revision,
            source=content.basis, content=content,
            last_save_request_id=row.last_save_request_id,
            created_at=row.created_at, updated_at=row.updated_at)

    async def create_scene_version(self, sequence_id: str, body: SceneVersionCreate) -> SceneVersionRead:
        """明确创建空方案，原文依据来自已核实的当前场次，不复制历史方案。"""
        sequence = await self.current_sequence(sequence_id)
        existing = await self.db.scalar(select(SceneVersionRecord).where(
            SceneVersionRecord.sequence_id == sequence.id,
            SceneVersionRecord.create_request_id == body.request_id))
        if existing is not None:
            if existing.title != body.title or await self.db.get(SceneCopyOrigin, existing.id) is not None:
                raise RevisionConflict('创建请求身份已用于另一份内容')
            return await self.read_scene_version(sequence_id, existing.id)
        source = SceneVersionSource(source=Source.model_validate(sequence.source),
            start=sequence.source_start, end=sequence.source_end, text=sequence.source_text)
        content = SceneVersionContent(basis=source, design=EditableSceneDesign(sources=[source.source]))
        row = SceneVersionRecord(id=uuid4().hex, sequence_id=sequence.id, title=body.title,
            source_bases=[source.model_dump(mode='json')], content=content.model_dump(mode='json'),
            create_request_id=body.request_id, revision=1)
        self.db.add(row)
        await self.db.flush()
        return await self.read_scene_version(sequence_id, row.id)

    async def save_scene_version(self, sequence_id: str, version_id: str,
                                 body: SceneVersionSave) -> SceneVersionRead:
        """按 CAS 保存同一方案；校验引用并在同一事务内保护其媒体文件。"""
        sequence = await self.sequence(sequence_id)
        # 与原文及划分写入保持章节 → 场次的锁顺序。
        await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id).with_for_update())
        sequence = await self.current_sequence(sequence_id)
        current = await self.read_scene_version(sequence_id, version_id)
        if current.last_save_request_id == body.request_id:
            if (current.revision != body.expected_revision + 1
                    or current.content != body.content):
                raise RevisionConflict('保存请求身份已用于另一份内容')
            return current
        if current.revision != body.expected_revision:
            raise RevisionConflict('场次版本已变化，未保存的输入已保留')
        row = await self.db.get(SceneVersionRecord, version_id, populate_existing=True)
        source_bases = await self._scene_source_bases(sequence, row, body.content.basis)
        # 旧字段的真实引用仍指向旧原文；仅当前执行依据切换，不伪造来源重绑。
        basis = SimpleNamespace(id=sequence.id, chapter_id=sequence.chapter_id,
            source=body.content.basis.source.model_dump(mode='json'),
            source_versions={source.source.version for source in source_bases})
        files = await self.validate_scene_content(basis, body.content, previous=current.content)
        for unit in body.content.units:
            if unit.instruction_basis_id:
                await self.instruction_basis(version_id, unit.id, unit.instruction_basis_id)
            if unit.instruction_check_task_id:
                await self.confirmable_instruction_check(sequence_id, version_id, unit.id, unit.instruction_check_task_id)
        for file_id in sorted(files):
            projects = set(await self.db.scalars(select(FileUsage.project_id).where(
                FileUsage.file_id == file_id)))
            if projects and self.project_id not in projects:
                raise ValueError('来源文件仅属于其他项目，请先关联到当前项目')
        async with self.db.begin_nested():
            result = await self.db.execute(update(SceneVersionRecord).where(
                SceneVersionRecord.id == version_id,
                SceneVersionRecord.revision == body.expected_revision,
            ).values(content=body.content.model_dump(mode='json'),
                source_bases=[source.model_dump(mode='json') for source in source_bases],
                revision=SceneVersionRecord.revision + 1, last_save_request_id=body.request_id))
            if result.rowcount != 1:
                raise RevisionConflict('场次版本已变化，未保存的输入已保留')
            await self._record_scene_take_reviews(sequence, current, body.content)
            source_ref = 'scene-version:' + version_id
            await self.db.execute(delete(FileUsage).where(FileUsage.project_id == self.project_id,
                FileUsage.usage_kind == FileUsageKind.directing_reference,
                FileUsage.source_ref == source_ref))
            for file_id in sorted(files):
                await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id,
                    chapter_id=sequence.chapter_id, usage_kind=FileUsageKind.directing_reference,
                    source_ref=source_ref)
        return await self.read_scene_version(sequence_id, version_id)

    async def _record_scene_take_reviews(self, sequence, previous, content):
        """判断变更与方案保存同事务固定；幂等重放在保存入口直接返回。"""
        prior = {(item.take_kind, item.take_id): item for item in previous.content.take_judgments}
        for judgment in content.take_judgments:
            if judgment.annotation.review_status == 'reviewed' and prior.get((judgment.take_kind, judgment.take_id)) != judgment:
                await self.create_scene_take_review(sequence, previous.id, previous.revision + 1, content, judgment)

    async def create_scene_take_review(self, sequence, version_id, revision, content, judgment):
        """固定审片依据并独立保护文件；调用方核实当前修订与重复请求。"""
        snapshot = content.model_copy(update={'take_judgments': [judgment]}).model_dump(mode='json')
        row = SceneTakeReviewRecord(id=uuid4().hex, version_id=version_id,
            revision=revision, take_kind=judgment.take_kind, take_id=judgment.take_id, content=snapshot)
        self.db.add(row)
        await self.protect_scene_review_files(sequence, snapshot, 'scene-take-review:' + row.id)
        await self.db.flush()
        return row

    async def protect_scene_review_files(self, sequence, snapshot, source_ref):
        """固定证据独立保护文件，当前内容撤销或删除后仍可追溯。"""
        def referenced_files(value):
            if isinstance(value, dict):
                if value.get('file_id'):
                    yield value['file_id']
                for child in value.values():
                    yield from referenced_files(child)
            elif isinstance(value, list):
                for child in value:
                    yield from referenced_files(child)
        for file_id in sorted(set(referenced_files(snapshot))):
            await require_available_file(self.db, file_id=file_id)
            await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id,
                chapter_id=sequence.chapter_id, usage_kind=FileUsageKind.directing_reference, source_ref=source_ref)

    async def inherited_scene_review_ids(self, version_id, kind):
        """只引用另存事务固定的记录身份，不动态吸收原版本后续审查。"""
        origin = await self.db.get(SceneCopyOrigin, version_id)
        return origin.review_ids.get(kind, []) if origin else []

    async def scene_instruction_check_task(self, sequence_id, version_id, unit_id, task_id):
        """当前任务或明确另存带来的原检查可读，保留真正执行版本，不借用其他证据。"""
        task = await self.db.get(Task, task_id)
        context = task.input_snapshot.get('instruction_check', {}) if task else {}
        if (task is None or task.project_id != self.project_id or task.target_id != sequence_id
                or task.kind != 'directing_instruction_check' or context.get('unit_id') != unit_id):
            raise ValueError('检查记录不属于当前版本和单元或明确复制的来源')
        if not await self.scene_evidence_allowed(version_id, context.get('version_id'), unit_id, 'instruction_check_task_id', task_id):
            raise ValueError('检查记录不属于当前版本和单元或明确复制的来源')
        return task

    async def confirmable_instruction_check(self, sequence_id, version_id, unit_id, task_id):
        """检查绑定须六岗完整通过；沿用原检查不伪造当前版本执行记录。"""
        task = await self.scene_instruction_check_task(sequence_id, version_id, unit_id, task_id)
        if task.status != 'succeeded':
            raise ValueError('检查记录尚未成功完成')
        unit = task.input_snapshot['run_args']['inputs']['unit']
        result = InstructionCheckResult.model_validate(task.result).validate_scope(unit_id, [item['id'] for item in unit['coverage']])
        if any(row.verdict != 'pass' for row in result.rows):
            raise ValueError('检查仍有待处理问题，不能确认为通过')
        return task

    async def scene_video_execution(self, execution_id):
        """通过原版本核对项目归属，执行输入不随当前内容改写。"""
        row = await self.db.get(SceneVideoExecution, execution_id)
        if row is None:
            raise ValueError('视频执行记录不存在')
        version = await self.db.get(SceneVersionRecord, row.version_id)
        await self.sequence(version.sequence_id)
        return row, version

    async def find_scene_video_request(self, version_id, unit_id, request_id):
        return await self.db.scalar(select(SceneVideoExecution).where(SceneVideoExecution.version_id == version_id,
            SceneVideoExecution.unit_id == unit_id, SceneVideoExecution.request_id == request_id))

    async def active_scene_video(self, version_id, unit_id):
        """同单元活动任务按原执行归属判断，取消请求尚未终态时仍占用。"""
        return await self.db.scalar(select(Task.id).join(SceneVideoExecution, SceneVideoExecution.task_id == Task.id).where(
            SceneVideoExecution.version_id == version_id, SceneVideoExecution.unit_id == unit_id,
            Task.status.not_in(['succeeded', 'failed', 'cancelled'])).limit(1))

    async def create_scene_video_execution(self, sequence_id, preparation, request_id, request_hash):
        """固定执行全部输入及历史文件保护，与任务提交共享事务。"""
        sequence = await self.sequence(sequence_id)
        row = SceneVideoExecution(id=uuid4().hex, version_id=preparation.version_id, unit_id=preparation.unit_id,
            request_id=request_id, request_hash=request_hash, preparation=preparation.model_dump(mode='json'))
        self.db.add(row)
        await self.db.flush()
        files = set()
        version = await self.db.get(SceneVersionRecord, preparation.version_id)
        basis = SimpleNamespace(id=sequence.id, chapter_id=sequence.chapter_id, source=preparation.inputs.basis.source.model_dump(mode='json'),
            source_versions={source['source']['version'] for source in version.source_bases})
        await self._sources(preparation.inputs.model_dump(mode='json'), basis, files, set())
        files.update(reference.file_id for reference in preparation.inputs.unit.references)
        for file_id in files:
            await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id, chapter_id=sequence.chapter_id,
                usage_kind=FileUsageKind.directing_reference, source_ref='scene-video:' + row.id)
        return row

    async def bind_scene_video_task(self, execution_id, task_id):
        """只允许创建事务绑定一次真实任务，拒绝更换历史任务。"""
        row, _ = await self.scene_video_execution(execution_id)
        task = await self.db.get(Task, task_id)
        if task is None or task.project_id != self.project_id or task.target_type != 'scene_video' or task.target_id != row.id:
            raise ValueError('任务不属于本次视频执行')
        if row.task_id and row.task_id != task_id:
            raise ValueError('视频执行已绑定另一任务')
        row.task_id = task_id
        await self.db.flush()

    async def read_scene_videos(self, sequence_id, version_id, unit_id):
        """读取固定执行与候选；不要求当前单元仍然存在，不替用户采用。"""
        await self.read_scene_version(sequence_id, version_id)
        records = await self.db.scalars(select(SceneVideoExecution).where(SceneVideoExecution.version_id == version_id,
            SceneVideoExecution.unit_id == unit_id).order_by(SceneVideoExecution.created_at.desc(), SceneVideoExecution.id.desc()))
        result = []
        for record in records:
            task = await self.db.get(Task, record.task_id)
            takes = await self.db.scalars(select(SceneTakeRecord).where(SceneTakeRecord.execution_id == record.id).order_by(SceneTakeRecord.output_ordinal))
            result.append(SceneVideoRead(execution_id=record.id, task_id=task.id, request_id=record.request_id, status=task.status,
                cancel_requested=task.cancel_requested_at is not None,
                error=task.error_message, retry_of_task_id=task.retry_of_task_id, preparation=SceneVideoPreparation.model_validate(record.preparation),
                takes=[SceneTakeRead(id=take.id, file_id=take.file_id, output_ordinal=take.output_ordinal,
                    annotation=TakeAnnotation.model_validate(take.annotation)) for take in takes]))
        return result

    async def scene_take_media(self, sequence_id, version_id, unit_id, take_id):
        """核对候选的原执行归属后返回真实媒体，不依赖当前单元仍存在。"""
        await self.read_scene_version(sequence_id, version_id)
        take = await self.db.get(SceneTakeRecord, take_id)
        if take is None:
            raise ValueError('候选素材不存在')
        execution, _ = await self.scene_video_execution(take.execution_id)
        if execution.version_id != version_id or execution.unit_id != unit_id:
            raise ValueError('候选素材不属于原版本和单元')
        file = await require_available_file(self.db, file_id=take.file_id, expected_type='video', lock=False)
        return MediaRead(take_id=take.id, file_id=file.id, duration_ms=file.duration_ms,
                         url=f'/api/v1/studio/files/{file.id}/download')

    async def register_scene_take(self, task, output):
        """仅完成事务登记真实 TaskOutput；同一输出幂等，不更新任何剪辑或采用。"""
        execution, version = await self.scene_video_execution(task.target_id)
        sequence = await self.sequence(version.sequence_id)
        if task.project_id != self.project_id or task.id != execution.task_id or output.task_id != task.id or task.status != 'running':
            raise ValueError('候选素材必须来自本次正在完成的视频任务')
        existing = await self.db.scalar(select(SceneTakeRecord).where(SceneTakeRecord.task_id == task.id, SceneTakeRecord.output_ordinal == output.ordinal))
        if existing:
            if existing.file_id != output.file_id or existing.execution_id != execution.id:
                raise ValueError('视频输出与已有候选冲突')
            return existing
        await require_available_file(self.db, file_id=output.file_id, expected_type='video')
        row = SceneTakeRecord(id=uuid4().hex, execution_id=execution.id, task_id=task.id, output_ordinal=output.ordinal,
            file_id=output.file_id, annotation=TakeAnnotation(coverage=[], review_status='unreviewed', rationale={}, retained_ranges=[]).model_dump(mode='json'))
        self.db.add(row)
        await upsert_file_usage(self.db, file_id=output.file_id, project_id=self.project_id, chapter_id=sequence.chapter_id,
            usage_kind=FileUsageKind.directing_take, source_ref=row.id)
        await self.db.flush()
        return row

    async def scene_evidence_allowed(self, version_id, origin_version_id, unit_id, field, identity):
        """只沿明确另存时实际包含的证据追溯，不允许任意跨版本借用记录。"""
        visited = set()
        while version_id != origin_version_id:
            if version_id in visited:
                return False
            visited.add(version_id)
            origin = await self.db.get(SceneCopyOrigin, version_id)
            if origin is None:
                return False
            unit = next((row for row in origin.request['content']['units'] if row['id'] == unit_id), None)
            if unit is None or unit.get(field) != identity:
                return False
            version_id = origin.source_version_id
        return True

    async def instruction_basis(self, version_id, unit_id, basis_id):
        """确认记录只能属于同一项目、场次版本与单元，不能跨对象借用。"""
        version = await self.db.get(SceneVersionRecord, version_id)
        if version is None:
            raise ValueError('场次版本不可用')
        await self.sequence(version.sequence_id)
        row = await self.db.get(InstructionBasisRecord, basis_id)
        if row is None or row.unit_id != unit_id or not await self.scene_evidence_allowed(version_id, row.version_id, unit_id, 'instruction_basis_id', basis_id):
            raise ValueError('指令依据记录不属于当前版本和单元')
        return row

    async def find_instruction_basis_request(self, version_id, unit_id, body):
        """在重新确认前核实原请求；原身份不能用于另一份输入。"""
        row = await self.db.scalar(select(InstructionBasisRecord).where(
            InstructionBasisRecord.version_id == version_id, InstructionBasisRecord.unit_id == unit_id,
            InstructionBasisRecord.request_id == body.request_id))
        digest = sha256(json.dumps(body.model_dump(mode='json'), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if row is not None and row.request_hash != digest:
            raise RevisionConflict('依据确认请求身份已用于另一份输入')
        return row

    async def create_instruction_basis(self, sequence, version_id, unit_id, body, inputs, files):
        """服务完成归属、CAS 和引用核对后追加回执，并保护其历史输入文件。"""
        row = InstructionBasisRecord(id=uuid4().hex, version_id=version_id, unit_id=unit_id,
            request_id=body.request_id, request_hash=sha256(json.dumps(body.model_dump(mode='json'), sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            inputs=inputs.model_dump(mode='json'), instruction=next(unit.instruction for unit in body.content.units if unit.id == unit_id))
        self.db.add(row)
        await self.db.flush()
        for file_id in sorted(files):
            await upsert_file_usage(self.db, file_id=file_id, project_id=self.project_id,
                chapter_id=sequence.chapter_id, usage_kind=FileUsageKind.directing_reference,
                source_ref='instruction-basis:' + row.id)
        return row

    async def validate_scene_content(self, sequence, content: SceneVersionContent, *, previous: SceneVersionContent | None = None):
        """统一核对设计和单元的真实输入；保存和 AI 应用使用同一引用边界。"""
        # model_copy 不触发 Pydantic 校验，候选设计替换后须重新核对单元关联。
        content = SceneVersionContent.model_validate(content.model_dump(mode='json'))
        _, files, _ = await self._validate(sequence, content.design)
        await self._validate_asset_origins(content, previous, design=content.design)
        for unit in content.units:
            if unit.model_id:
                model = await self.db.get(Model, unit.model_id)
                if model is None or model.category != 'video':
                    raise ValueError(f'单元 {unit.id} 的视频模型不存在，请重新选择')
            for binding in unit.references:
                await require_available_file(self.db, file_id=binding.file_id, expected_type=binding.media_kind)
                files.add(binding.file_id)
            for link in unit.scene_dependencies:
                await self.validate_scene_frame_binding(sequence.id, unit, link)
            for link in unit.dependencies:
                plan = ProductionPlan.model_validate((await self.revision(
                    link.plan_revision_id, kind='plan', sequence_id=sequence.id, confirmed=True)).payload)
                self._unit(plan, link.unit_id)
                if link.frame_id:
                    await self.validate_frame_binding(sequence.id, unit, link)
        for judgment in content.take_judgments:
            await self.validate_scene_take(sequence.id, judgment.take_kind, judgment.take_id, judgment.file_id)
            files.add(judgment.file_id)
            for coverage in judgment.annotation.coverage:
                unit = next((item for item in content.units if item.id == coverage.unit_id), None)
                if unit is None or not any(item.id == coverage.coverage_item_id for item in unit.coverage):
                    raise ValueError('实际覆盖引用的当前单元或动作不存在')
                if coverage.source.kind != 'file' or coverage.source.file_id != judgment.file_id or coverage.source.media_range != coverage.media_range:
                    raise ValueError('实际观察必须使用原素材文件与一致区间')
                await self._range(judgment.file_id, coverage.media_range)
            for media_range in judgment.annotation.retained_ranges:
                await self._range(judgment.file_id, media_range)
        for item in content.timeline.items:
            if item.kind == 'planned':
                if not any(shot.id == item.shot_id for shot in content.design.direction.shots):
                    raise ValueError(f'待拍片段 {item.id} 引用的当前镜头不存在')
            else:
                await self.validate_scene_take(sequence.id, item.take_kind, item.take_id, item.file_id)
                await self._range(item.file_id, item.media_range)
                files.add(item.file_id)
        await self._sources(content.model_dump(mode='json'), sequence, files, set())
        for file_id in files:
            await require_available_file(self.db, file_id=file_id)
        return files

    async def validate_scene_frame_binding(self, sequence_id, unit, link):
        """固定证据须属于明确来源版本和采用；保存不要求旧依据仍适用。"""
        await self.read_scene_version(sequence_id, link.version_id)
        if link.frame_id is None:
            return None
        frame = await self.db.get(SceneEndFrameRecord, link.frame_id)
        if frame is None or frame.version_id != link.version_id or frame.clip['id'] != link.clip_id:
            raise ValueError(f'单元 {unit.id} 的实际落幅不属于原版本与采用')
        reference = next((item for item in unit.references if item.id == link.reference_id), None)
        source = Source(kind='file', reference=frame.clip['take_id'], version='1', file_id=frame.clip['file_id'],
            media_range={'source_in_ms': frame.at_ms, 'source_out_ms': frame.at_ms + 1})
        if (reference is None or reference.file_id != frame.file_id or reference.media_kind != 'image'
                or reference.purpose != 'continuity' or reference.source != source):
            raise ValueError(f'单元 {unit.id} 的实际落幅参考与固定来源不一致，请明确重新绑定')
        await require_available_file(self.db, file_id=frame.file_id, expected_type='image')
        return frame

    async def require_scene_dependencies(self, sequence_id, version_id, unit, content):
        """仅检查目标单元；失效依赖阻止新执行，历史固定输入重试另行核验。"""
        for link in unit.scene_dependencies:
            frame = await self.validate_scene_frame_binding(sequence_id, unit, link)
            if frame is None:
                raise RevisionConflict(f'单元 {unit.id} 的采用 {link.clip_id} 尚未绑定实际落幅，请到编辑画布提取，再在单元画布明确绑定')
            source = content if link.version_id == version_id else (await self.read_scene_version(sequence_id, link.version_id)).content
            clip = next((item for item in source.timeline.items if item.id == link.clip_id), None)
            if (clip is None or clip.kind != 'media'
                    or clip.model_dump(mode='json', exclude={'timeline_start_ms', 'fit'})
                    != {key: value for key, value in frame.clip.items() if key not in {'timeline_start_ms', 'fit'}}):
                raise RevisionConflict(f'单元 {unit.id} 的采用 {link.clip_id} 实际落幅依据已变，请提取新落幅、明确换绑并更新指令和检查')

    async def validate_scene_take(self, sequence_id, take_kind, take_id, file_id):
        """判断与采用共用原素材归属校验，不能仅凭文件身份跨场次引用。"""
        if take_kind == 'production_plan':
            take = await self.take(take_id, sequence_id=sequence_id)
        else:
            take = await self.db.get(SceneTakeRecord, take_id)
            if take is None:
                raise ValueError('原素材不存在')
            _, origin = await self.scene_video_execution(take.execution_id)
            if origin.sequence_id != sequence_id:
                raise ValueError('原素材不属于当前场次')
        if take.file_id != file_id:
            raise ValueError('引用文件身份与原 Take 不一致')
        await require_available_file(self.db, file_id=file_id, expected_type='video')

    async def _scene_source_bases(self, sequence: Sequence, row: SceneVersionRecord,
                                  chosen: SceneVersionSource) -> list[SceneVersionSource]:
        """只接受当前真实原文或本方案已核实的摘录；保留依据证据供撤销与旧字段引用。"""
        known = [SceneVersionSource.model_validate(source) for source in row.source_bases]
        if chosen.source.reference != sequence.chapter_id:
            raise ValueError('原文依据不属于当前章节')
        if chosen in known:
            return known
        chapter = await self.db.scalar(select(Chapter).where(Chapter.id == sequence.chapter_id,
            Chapter.project_id == self.project_id).with_for_update().execution_options(populate_existing=True))
        if chosen.source.version != sha256(chapter.raw_text.encode()).hexdigest():
            raise RevisionConflict('章节原文已变化，请重新读取并明确选择范围')
        if (chosen.start is None or chosen.end is None or chosen.end > len(chapter.raw_text)
                or not chosen.text.strip() or chapter.raw_text[chosen.start:chosen.end] != chosen.text):
            raise ValueError('原文范围与当前章节不一致')
        return [*known, chosen]

    @staticmethod
    def source_key(sequence: Sequence) -> str:
        """只摘要实质来源，不因场次改名或排序使设计失效。"""
        return sha256(json.dumps([sequence.source, sequence.source_start, sequence.source_end,
                                 sequence.source_text], ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    async def read_revision(self, revision_id: str, *, for_update: bool = False) -> RevisionSnapshot:
        """返回有明确项目、章节和类型的快照，供未来 API/编译消费。"""
        row = await self.revision(revision_id, for_update=for_update)
        sequence = await self.sequence(row.sequence_id)
        snapshot = ReviewPacketRevision if row.kind == "review" else RevisionSnapshot[CONTRACTS[row.kind]]
        return snapshot(
            id=row.id, project_id=self.project_id, chapter_id=sequence.chapter_id,
            sequence_id=row.sequence_id, parent_id=row.parent_id, version=row.version, display_number=row.display_number,
            created_at=row.created_at, confirmed_by=row.confirmed_by, confirmed_at=row.confirmed_at,
            source_current=row.kind != "design" or row.source_key == self.source_key(sequence),
            content=CONTRACTS[row.kind].model_validate(row.payload),
            **({"source_task_id": row.source_task_id} if row.kind == "review" else {}),
        )

    async def read_take(self, take_id: str) -> TakeSnapshot:
        """返回素材身份与实际审片，避免将 ORM 关系泄漏到跨层契约。"""
        row = await self.take(take_id)
        sequence = await self.sequence(row.sequence_id)
        return TakeSnapshot(
            id=row.id, project_id=self.project_id, chapter_id=sequence.chapter_id,
            sequence_id=row.sequence_id, prompt_revision_id=row.prompt_revision_id,
            plan_revision_id=row.plan_revision_id, unit_id=row.unit_id, task_id=row.task_id,
            output_ordinal=row.output_ordinal, file_id=row.file_id, version=row.version, display_number=row.display_number,
            annotation=TakeAnnotation.model_validate(row.annotation),
        )

    async def save_revision(self, sequence_id: str, *, kind: str, payload: dict,
                            revision_id: str | None = None, expected_version: int | None = None,
                            parent_id: str | None = None, source_task_id: str | None = None) -> DirectingRevision:
        """创建草稿或 CAS 更新草稿；冻结版本必须派生新 ID，引用索引与正文同事务。"""
        sequence = await self.current_sequence(sequence_id)
        if kind not in CONTRACTS:
            raise ValueError("unknown revision kind")
        content = CONTRACTS[kind].model_validate(payload)
        if source_task_id is not None:
            if kind != "review" or revision_id is not None or parent_id is not None:
                raise ValueError("只有新的模型审稿版本可以绑定来源任务")
            task = await self.db.get(Task, source_task_id)
            if (task is None or task.project_id != self.project_id or task.target_id != sequence_id
                    or task.kind != "directing_review" or task.status != "succeeded"):
                raise ValueError("审稿来源任务与版本不匹配")
        async with self.db.begin_nested():
            dependencies, files, takes = await self._validate(sequence, content)
            if isinstance(content, ProductionPlan):
                previous = None
                if revision_id or parent_id:
                    previous_row = await self.revision(revision_id or parent_id, kind="plan", sequence_id=sequence_id,
                                                       confirmed=bool(parent_id))
                    previous = ProductionPlan.model_validate(previous_row.payload)
                await self._validate_asset_origins(content, previous)
            if revision_id is None:
                if expected_version is not None:
                    raise ValueError("new revision has no expected version")
                if parent_id is not None:
                    await self.revision(parent_id, kind=kind, sequence_id=sequence_id, confirmed=True)
                number = await self._next_display_number(sequence_id, content.plan_revision_id, content.unit_id, prompt=True) if isinstance(content, Prompt) else None
                row = DirectingRevision(id=uuid4().hex, sequence_id=sequence_id, kind=kind, display_number=number,
                                        parent_id=parent_id, version=1, payload=content.model_dump(mode="json"), source_task_id=source_task_id,
                                        source_key=self.source_key(sequence) if kind == "design" else None)
                self.db.add(row)
                await self.db.flush()
            else:
                row = await self.revision(revision_id, kind=kind, sequence_id=sequence_id)
                if isinstance(content, Prompt) and (row.payload['plan_revision_id'], row.payload['unit_id']) != (content.plan_revision_id, content.unit_id):
                    raise ValueError("指令所属计划与单元不可原地变更")
                if parent_id is not None or expected_version is None:
                    raise ValueError("update requires expected_version and cannot change parent")
                result = await self.db.execute(update(DirectingRevision).where(
                    DirectingRevision.id == row.id, DirectingRevision.version == expected_version,
                    DirectingRevision.confirmed_at.is_(None),
                ).values(payload=content.model_dump(mode="json"), version=expected_version + 1,
                         source_key=self.source_key(sequence) if kind == "design" else None))
                if result.rowcount != 1:
                    raise RevisionConflict("revision changed or confirmed")
            await self._replace_links(row.id, sequence, dependencies, files, takes)
        return await self.revision(row.id)

    async def confirm_revision(self, revision_id: str, *, expected_version: int, actor_id: str) -> DirectingRevision:
        """由应用的人工作用域登记确认；模型工作单不能自行填写批准人。"""
        ID_ADAPTER.validate_python(actor_id)
        row = await self.revision(revision_id)
        await self.current_sequence(row.sequence_id)
        row = await self.revision(revision_id)
        if row.kind in ('cut_review', 'repair'):
            await self.db.scalar(select(Sequence).where(Sequence.id == row.sequence_id).with_for_update())
            active = await self.active_cut(row.sequence_id)
            if row.kind == 'cut_review' and (active is None or active.id != row.payload['cut_revision_id']):
                raise RevisionConflict('当前采用版本已变化，请重新审片')
        if row.kind == "design" and row.source_key != self.source_key(await self.sequence(row.sequence_id)):
            raise RevisionConflict("场次原文范围已变化，请核对并重新保存设计")
        async with self.db.begin_nested():
            # 确认采用与执行受理共用场次锁，草稿不会改变实际连续性依据。
            if row.kind == "cut":
                await self.db.scalar(select(Sequence).where(Sequence.id == row.sequence_id).with_for_update())
            # 旧已确认设计仍可读取；本次设计确认必须明确镜头对象范围。
            content = CONTRACTS[row.kind].model_validate(row.payload,
                context={"require_shot_participants": row.kind == "design" and row.confirmed_at is None})
            await self._validate(await self.sequence(row.sequence_id), content)
            result = await self.db.execute(update(DirectingRevision).where(
                DirectingRevision.id == row.id, DirectingRevision.version == expected_version,
                DirectingRevision.confirmed_at.is_(None),
            ).values(confirmed_by=actor_id, confirmed_at=datetime.now(UTC).replace(tzinfo=None), version=expected_version + 1))
            if result.rowcount != 1:
                raise RevisionConflict("revision changed or already confirmed")
            if row.kind == "cut":
                active = await self.db.get(ActiveCut, row.sequence_id, populate_existing=True)
                if active is None:
                    self.db.add(ActiveCut(sequence_id=row.sequence_id, revision_id=row.id))
                else:
                    active.revision_id = row.id
                await self.db.flush()
        return await self.revision(row.id)

    async def _validate_asset_origins(self, plan, previous, *, design=None):
        """只在保存选择时核对资产来源；已确认输入不随资产改名或换图变化。"""
        from app.models.studio import Scene, Prop, CharacterImage, SceneImage, PropImage

        if design is None:
            design = SceneDesign.model_validate((await self.revision(plan.design_revision_id, kind="design", confirmed=True)).payload)
        same_design = (isinstance(plan, SceneVersionContent) and isinstance(previous, SceneVersionContent)) or (
            previous is not None and getattr(previous, "design_revision_id", None) == getattr(plan, "design_revision_id", None))
        inherited = {(binding.file_id, binding.media_kind, binding.asset_origin.model_dump_json())
                     for unit in previous.units for binding in unit.references if binding.asset_origin} if previous and same_design else set()
        models = {"character": (Character, CharacterImage, CharacterImage.character_id),
                  "scene": (Scene, SceneImage, SceneImage.scene_id), "prop": (Prop, PropImage, PropImage.prop_id)}
        for unit in plan.units:
            for binding in unit.references:
                origin = binding.asset_origin
                if origin is None:
                    continue
                if origin.kind != "scene" and any(getattr(person, origin.kind + "_id") != origin.id
                        for person in design.participants if person.id in binding.participant_ids):
                    raise ValueError("资产来源与参考绑定的参与者不符")
                inherited_origin = (binding.file_id, binding.media_kind, origin.model_dump_json()) in inherited
                model, image_model, owner = models[origin.kind]
                asset = await self.db.get(model, origin.id)
                linked = ({design.direction.location_asset_id} if origin.kind == "scene" else
                          {getattr(person, origin.kind + "_id") for person in design.participants})
                if origin.kind == "character":
                    in_project = asset and asset.project_id == self.project_id
                else:
                    link = ProjectSceneLink if origin.kind == "scene" else ProjectPropLink
                    in_project = await self.db.scalar(select(link.id).where(link.project_id == self.project_id,
                        getattr(link, origin.kind + "_id") == origin.id))
                if not asset or not in_project or origin.id not in linked or (not inherited_origin and asset.name != origin.name):
                    raise ValueError("资产来源与当前项目、固定设计或名称不符")
                if inherited_origin:
                    continue
                if binding.media_kind != "image" or not await self.db.scalar(select(image_model.id).where(
                        owner == origin.id, image_model.file_id == binding.file_id)):
                    raise ValueError("资产来源中不存在所选图片")

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
                await self.style_revision(content.style_revision_id, confirmed=True)
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
                for link in unit.dependencies:
                    source = await dependency(link.plan_revision_id, "plan")
                    self._unit(source, link.unit_id)
                    if link.frame_id:
                        await self.validate_frame_binding(sequence.id, unit, link)
                for item in unit.coverage:
                    references([item.shot_id], shots, "shot")
                    references(item.beat_ids, shots[item.shot_id].beat_ids, "shot beat")
                    references(item.event_ids, shots[item.shot_id].event_ids, "shot event")
                for binding in unit.references:
                    references(binding.participant_ids, [r.id for r in design.participants], "reference participant")
                    await require_available_file(self.db, file_id=binding.file_id, expected_type=binding.media_kind)
                    projects = set(await self.db.scalars(select(FileUsage.project_id).where(FileUsage.file_id == binding.file_id)))
                    if projects and self.project_id not in projects:
                        raise ValueError("参考文件仅属于其他项目，请先关联到当前项目或上传本次素材")
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
                    shot = next(row for row in design.direction.shots if row.id == item.shot_id)
                    dialogue_ids = {dialogue_id for row in design.performance.beats if row.beat_id in shot.beat_ids for dialogue_id in row.dialogue_ids}
                    references([cue.dialogue_id for cue in item.dialogue_cues], dialogue_ids, "planned dialogue")
                    if item.preview_file_id:
                        await require_available_file(self.db, file_id=item.preview_file_id, expected_type="image")
                        if not await self.db.scalar(select(FileUsage.file_id).where(
                            FileUsage.file_id == item.preview_file_id, FileUsage.project_id == self.project_id,
                        )):
                            raise ValueError("preview image not linked to project")
                        files.add(item.preview_file_id)
                else:
                    take = await self.take(item.take_id, sequence_id=sequence.id)
                    await self._range(take.file_id, item.media_range)
                    files.add(take.file_id)
                    takes.add(take.id)
        elif isinstance(content, (CutReview, RepairItem, KnowledgeCandidate)):
            from app.services.directing.feedback_rules import validate_feedback
            dependencies, files, takes = await validate_feedback(self, sequence, content)
        # Every file source, including nested work-sheet evidence, protects the file.
        await self._sources(content.model_dump(mode="json"), sequence, files, dependencies)
        for file_id in sorted(files):
            await require_available_file(self.db, file_id=file_id)
        return dependencies, files, takes

    async def active_cut(self, sequence_id: str):
        """解析当前已确认采用；不以最新草稿或创建时间代替用户确认动作。"""
        await self.sequence(sequence_id)
        active = await self.db.get(ActiveCut, sequence_id, populate_existing=True)
        return await self.revision(active.revision_id, kind="cut", sequence_id=sequence_id, confirmed=True) if active else None

    @staticmethod
    def frame_matches(frame, item):
        """只有同一采用项、Take 和实际源区间才可复用旧边界证据。"""
        return (item.kind == "media" and item.id == frame.item_id and item.take_id == frame.take_id
                and item.media_range.source_in_ms == frame.source_in_ms
                and item.media_range.source_out_ms == frame.source_out_ms)

    async def cut_frame(self, sequence_id: str, frame_id: str):
        """验证真实提帧归属与原采用依据，拒绝伪造或跨场证据。"""
        await self.sequence(sequence_id)
        frame = await self.db.get(CutFrame, frame_id)
        if frame is None or frame.sequence_id != sequence_id:
            raise ValueError("落幅证据不属于当前场次")
        original = await self.revision(frame.cut_revision_id, kind="cut", sequence_id=sequence_id, confirmed=True)
        cut = SequenceCut.model_validate(original.payload)
        item = next((item for item in cut.items if self.frame_matches(frame, item)), None)
        if item is None or not frame.source_in_ms <= frame.at_ms < frame.source_out_ms:
            raise ValueError("提帧与实际采用区间不一致")
        take = await self.take(frame.take_id, sequence_id=sequence_id)
        await self._range(take.file_id, item.media_range)
        await require_available_file(self.db, file_id=frame.file_id, expected_type="image")
        return frame

    async def validate_frame_binding(self, sequence_id, unit, link):
        """实际前段落幅必须来自指定计划单元，并作为本次图片参考真实发送。"""
        frame = await self.cut_frame(sequence_id, link.frame_id)
        take = await self.take(frame.take_id, sequence_id=sequence_id)
        if frame.edge != "end" or (take.plan_revision_id, take.unit_id) != (link.plan_revision_id, link.unit_id):
            raise ValueError("前段落幅与依赖的计划单元不一致")
        binding = next((binding for binding in unit.references if binding.id == link.reference_id), None)
        if binding is None or binding.file_id != frame.file_id or binding.media_kind != "image" or binding.purpose != "continuity":
            raise ValueError("落幅证据必须明确绑定为连续性图片参考")
        return frame

    async def continuity_errors(self, sequence_id: str, unit) -> list[str]:
        """逐单元检查当前采用依据；失效只阻止相关单元，不修改任何冻结版本。"""
        if not unit.dependencies:
            return []
        active = await self.active_cut(sequence_id)
        items = SequenceCut.model_validate(active.payload).items if active else []
        errors = []
        for link in unit.dependencies:
            label = f"{link.plan_revision_id}/{link.unit_id}"
            if not link.frame_id:
                errors.append(f"依赖 {label} 尚未选择实际落幅")
                continue
            try:
                frame = await self.validate_frame_binding(sequence_id, unit, link)
                if not any(self.frame_matches(frame, item) for item in items):
                    errors.append(f"依赖 {label} 的采用片段或区间已变化，请重新提帧并派生计划")
            except ValueError as cause:
                errors.append(f"依赖 {label}：{cause}")
        return errors

    async def validate_task_continuity(self, task: Task):
        """Worker 发出请求前重查固定计划的实际依赖；已发出的请求保留原输入。"""
        if task.target_type == 'scene_video':
            execution, version = await self.scene_video_execution(task.target_id)
            preparation = SceneVideoPreparation.model_validate(execution.preparation)
            errors = await self.continuity_errors(version.sequence_id, preparation.inputs.unit)
            if errors:
                raise ContinuityNotReady('；'.join(errors))
            return
        if task.target_type != "directing_unit":
            return
        prompt = await self.revision(task.input_snapshot.get("prompt_revision_id"), kind="prompt", confirmed=True)
        content = Prompt.model_validate(prompt.payload)
        plan = ProductionPlan.model_validate((await self.revision(content.plan_revision_id, kind="plan", confirmed=True)).payload)
        errors = await self.continuity_errors(prompt.sequence_id, self._unit(plan, content.unit_id))
        if errors:
            raise ContinuityNotReady("；".join(errors))

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
                if source.kind == "chapter":
                    allowed_versions = getattr(sequence, 'source_versions', {sequence.source['version']})
                    if source.reference != sequence.chapter_id or source.version not in allowed_versions:
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
                                    usage_kind=FileUsageKind.directing_reference, source_ref=revision_id)
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
            number = await self._next_display_number(sequence.id, prompt.plan_revision_id, prompt.unit_id, prompt=False)
            row = Take(id=uuid4().hex, sequence_id=sequence.id, prompt_revision_id=prompt_revision_id, display_number=number,
                       plan_revision_id=prompt.plan_revision_id, unit_id=prompt.unit_id, task_id=task_id,
                       output_ordinal=output_ordinal, file_id=output.file_id, version=1,
                       annotation=TakeAnnotation(coverage=[], review_status="unreviewed", rationale={}, retained_ranges=[]).model_dump(mode="json"))
            self.db.add(row)
            await upsert_file_usage(self.db, file_id=output.file_id, project_id=self.project_id, chapter_id=sequence.chapter_id,
                                    usage_kind=FileUsageKind.directing_take, source_ref=row.id)
            await self.db.flush()
        return row

    async def _next_display_number(self, sequence_id: str, plan_id: str, unit_id: str, *, prompt: bool) -> int:
        """场次锁内分配不可变编号；锁定读取避免MySQL重复读使用较早快照。"""
        await self.db.get(Sequence, sequence_id, with_for_update=True, populate_existing=True)
        if prompt:
            query = select(DirectingRevision.display_number).where(
                DirectingRevision.sequence_id == sequence_id, DirectingRevision.kind == 'prompt',
                DirectingRevision.payload['plan_revision_id'].as_string() == plan_id,
                DirectingRevision.payload['unit_id'].as_string() == unit_id,
                DirectingRevision.display_number.is_not(None))
            column = DirectingRevision.display_number
        else:
            query = select(Take.display_number).where(Take.sequence_id == sequence_id,
                Take.plan_revision_id == plan_id, Take.unit_id == unit_id, Take.display_number.is_not(None))
            column = Take.display_number
        number = await self.db.scalar(query.order_by(column.desc()).limit(1).with_for_update())
        return (number or 0) + 1

    async def annotate_take(self, take_id: str, *, expected_version: int, annotation: dict) -> Take:
        """CAS 保存实际覆盖与四类审片结论，来源、归属和区间不能混用。"""
        row = await self.take(take_id)
        await self.current_sequence(row.sequence_id)
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
                                        chapter_id=sequence.chapter_id,
                                        usage_kind=FileUsageKind.directing_take, source_ref=row.id)
        return await self.take(row.id)
