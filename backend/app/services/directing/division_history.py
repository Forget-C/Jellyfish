"""章节划分历史的只读分页与按需快照，避免逐条读取任务正文。"""

from hashlib import sha256
import re

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import case, exists, func, literal, select, union_all

from app.core.contracts.directing.division_history import DivisionAnalysisDetail, DivisionHistoryEntry, DivisionHistoryPage, DivisionVersionDetail
from app.core.contracts.directing.division import DivisionBaseline
from app.core.contracts.directing.workspace import ChapterSequences, DivisionResult, DivisionVersionRef
from app.models.directing import DivisionVersion, Sequence
from app.models.task import Task
from app.services.directing.division_versions import current_version
from app.services.directing.workspace import WorkspaceService


def analysis_failure(task: Task) -> str:
    """仅展示已知安全摘要或错误类别，旧供应商原始错误不得直接回传。"""
    safe_messages = {
        '请求或执行超时': '分析请求或执行超时，可重试或检查模型服务可用性',
        '导演模型未返回文本 JSON': '模型未返回可用的结构化结果，请重新分析或手动划分',
        '模型免费额度已耗尽，且供应商开启了仅使用免费额度；请恢复额度或选择其他模型':
            '模型免费额度已耗尽，请恢复额度或选择其他模型',
    }
    message = task.error_message or ''
    if message in safe_messages:
        return safe_messages[message]
    if re.fullmatch(r'(模型|供应商)请求失败，HTTP [1-5][0-9]{2}', message):
        return message + '；请核对模型配置或服务状态'
    return {
        'execution_timeout': '分析执行超时，可重新发起分析',
        'queue_expired': '分析排队超时，请确认任务执行器可用后重试',
        'execution_interrupted': '分析进程已中断，可重新发起分析',
        'submission_interrupted': '分析提交被中断，请核对模型服务后重试',
        'submission_failed': '分析请求失败，请核对文本模型配置后重试',
        'result_failed': '分析结果处理失败，可重新分析或手动划分',
        'provider_failed': '模型服务返回失败，请核对服务状态后重试',
    }.get(task.error_code, '本次分析失败，未记录可安全展示的具体原因；可重新发起分析')


class DivisionHistoryService(WorkspaceService):
    """查询前验证章节归属，查看历史不会修改当前指向。"""

    async def history(self, chapter_id: str, *, page: int = 1, page_size: int = 20) -> DivisionHistoryPage:
        """仅投影轻量字段；已明确关联保存版本的分析不重复显示为待保存。"""
        await self.chapter(chapter_id)
        if page < 1 or not 1 <= page_size <= 100:
            raise ValueError('历史分页参数无效')
        versions = select(DivisionVersion.id, literal('version').label('kind'), DivisionVersion.number,
            DivisionVersion.origin, DivisionVersion.created_at, DivisionVersion.sequence_count,
            literal('saved').label('status'), literal(None).label('progress'), DivisionVersion.source_task_id,
            literal('saved').label('save_relation')
        ).where(DivisionVersion.chapter_id == chapter_id)
        tasks = select(Task.id, literal('analysis'), literal(None), literal('ai'), Task.created_at,
            literal(None), Task.status, Task.progress, Task.id,
            case((Task.status == 'succeeded', 'unsaved'), else_='not_applicable')).where(
                Task.project_id == self.project_id, Task.target_type == 'directing_chapter',
                Task.target_id == chapter_id, Task.kind == 'directing_divide',
                ~exists(select(DivisionVersion.id).where(DivisionVersion.chapter_id == chapter_id,
                    DivisionVersion.source_task_id == Task.id)))
        records = union_all(versions, tasks).subquery()
        total = await self.db.scalar(select(func.count()).select_from(records))
        rows = (await self.db.execute(select(records).order_by(records.c.created_at.desc(), records.c.id.desc(), records.c.kind)
            .offset((page - 1) * page_size).limit(page_size))).mappings()
        current = await current_version(self.db, chapter_id)
        active = list(await self.db.scalars(select(Task.id).where(Task.project_id == self.project_id,
            Task.target_type == 'directing_chapter', Task.target_id == chapter_id, Task.kind == 'directing_divide',
            Task.status.in_(['queued', 'running'])).order_by(Task.created_at, Task.id)))
        return DivisionHistoryPage(items=[DivisionHistoryEntry(**row,
            is_current=bool(current and row['kind'] == 'version' and row['id'] == current.id)) for row in rows],
            total=total, page=page, page_size=page_size, current_version=current, active_task_ids=active)

    async def version_detail(self, chapter_id: str, version_id: str) -> DivisionVersionDetail:
        """版本身份同时绑定章节和项目，详情不暴露原始任务输入。"""
        await self.chapter(chapter_id)
        row = await self.db.scalar(select(DivisionVersion).where(
            DivisionVersion.chapter_id == chapter_id, DivisionVersion.id == version_id))
        if row is None:
            raise ValueError('划分版本不属于当前章节')
        current = await current_version(self.db, chapter_id)
        snapshot = ChapterSequences.model_validate(row.snapshot)
        retired = await self.db.execute(select(Sequence.id, Sequence.version).where(
            Sequence.chapter_id == chapter_id, Sequence.is_current.is_(False),
            Sequence.id.in_([member.id for member in snapshot.sequences])))
        return DivisionVersionDetail(version=DivisionHistoryEntry(id=row.id, kind='version', number=row.number,
            origin=row.origin, created_at=row.created_at, sequence_count=row.sequence_count, status='saved',
            progress=None, is_current=bool(current and current.id == row.id), source_task_id=row.source_task_id, save_relation='saved'),
            chapter=snapshot, source_revision_id=row.source_revision_id,
            base_revision_id=row.base_revision_id, mapping=row.mapping,
            restored_baseline=[DivisionBaseline(sequence_id=member.id, version=member.version) for member in retired])

    async def analysis_detail(self, chapter_id: str, task_id: str) -> DivisionAnalysisDetail:
        """说明分析资料缺失的原因，过滤供应商输入、凭据与原始错误。"""
        chapter = await self.chapter(chapter_id)
        task = await self.db.scalar(select(Task).where(Task.id == task_id, Task.project_id == self.project_id,
            Task.target_type == 'directing_chapter', Task.target_id == chapter_id, Task.kind == 'directing_divide'))
        if task is None:
            raise ValueError('分析记录不属于当前章节')
        snapshot = task.input_snapshot if isinstance(task.input_snapshot, dict) else {}
        args = snapshot.get('run_args', {})
        args = args if isinstance(args, dict) else {}
        raw_text, source_version = args.get('script_text'), args.get('source_version')
        issues = []
        if not isinstance(raw_text, str) or not isinstance(source_version, str):
            raw_text, source_version = None, None
            issues.append('历史原文资料不完整')
        elif sha256(raw_text.encode()).hexdigest() != source_version:
            issues.append('历史原文与版本标识不一致')
        baseline = None
        try:
            baseline = TypeAdapter(list[DivisionBaseline]).validate_python([
                {'sequence_id': identity, 'version': version} for identity, version in args['division_baseline'].items()])
        except (KeyError, AttributeError, ValidationError):
            issues.append('分析时的场次基线资料不完整')
        result = None
        if task.status == 'succeeded':
            try:
                result = DivisionResult.model_validate(task.result)
            except ValidationError:
                issues.append('历史分析结果资料不完整')
        elif task.status == 'failed':
            issues.append(analysis_failure(task))
        elif task.status == 'cancelled':
            issues.append('本次分析已取消')
        saved = list(await self.db.execute(select(DivisionVersion.id, DivisionVersion.number).where(
            DivisionVersion.chapter_id == chapter_id, DivisionVersion.source_task_id == task_id).order_by(DivisionVersion.number)))
        current = dict((await self.db.execute(select(Sequence.id, Sequence.version).where(
            Sequence.chapter_id == chapter_id, Sequence.is_current.is_(True)))).all())
        relation = 'saved' if saved else 'unsaved'
        return DivisionAnalysisDetail(analysis=DivisionHistoryEntry(id=task.id, kind='analysis', number=None,
            origin='ai', created_at=task.created_at, sequence_count=len(result.scenes) if result else None,
            status=task.status, progress=task.progress, is_current=False, source_task_id=task.id,
            save_relation=relation if task.status == 'succeeded' else 'not_applicable'),
            raw_text=raw_text, source_version=source_version, baseline=baseline, result=result,
            source_changed=source_version != sha256(chapter.raw_text.encode()).hexdigest(),
            baseline_changed=baseline is None or {row.sequence_id: row.version for row in baseline} != current,
            issues=issues, saved_versions=[DivisionVersionRef(id=row.id, number=row.number) for row in saved])
