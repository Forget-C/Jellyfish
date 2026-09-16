"""以准确身份解析场次来源；缺失记录不回退到最新任务或同名对象。"""

from sqlalchemy import select

from app.core.contracts.directing.common import Source
from app.core.contracts.directing.provenance import SourceRead
from app.models.directing import Sequence
from app.models.studio import Chapter, FileItem, FileUsage
from app.models.task import Task
from app.services.directing.store import DirectingStore

LABELS = {"human": "人工填写", "model": "AI建议", "chapter": "章节原文", "file": "参考文件", "revision": "历史版本"}
REVISION_NAMES = {"design": "设计", "plan": "生产计划", "prompt": "拍摄指令", "cut": "粗剪"}


def task_args(task: Task) -> dict:
    """旧记录的缺失或非对象输入按无上下文处理。"""
    value = task.input_snapshot.get("run_args")
    return value if isinstance(value, dict) else {}


class ProvenanceService(DirectingStore):
    """限定项目和场次读取，只解释既有来源，不生成新的事实。"""

    async def resolve_sources(self, sequence_id: str, sources: list[Source]) -> list[SourceRead]:
        """一次加载有关任务，逐项返回不可用状态，不让单项失效中断整批。"""
        sequence = await self.sequence(sequence_id)
        tasks = list(await self.db.scalars(select(Task).where(
            Task.project_id == self.project_id, Task.target_type == "directing_sequence",
            Task.target_id == sequence_id,
        ))) if any(source.kind in ("model", "chapter") for source in sources) else []
        result = []
        for source in sources:
            row = await self._resolve_source(sequence, tasks, source)
            if source.file_id:
                row = await self._attach_file(row)
            result.append(row)
        return result

    async def _resolve_source(self, sequence: Sequence, tasks: list[Task], source: Source) -> SourceRead:
        """来源版本必须匹配已保存快照；当前名称仅在明确标注后提供。"""
        unavailable = SourceRead(source=source, status="unavailable", label=LABELS[source.kind],
                                 description="历史来源暂不可用；未找到可核对的记录。")
        if source.kind == "human":
            return SourceRead(source=source, status="ready", label="人工填写",
                              description="由本机用户填写。" if source.reference == "local-user" else "人工记录；未记录可核实的填写者和时间。")
        if source.kind == "model":
            return self._model_source(tasks, source, unavailable)
        if source.kind == "chapter":
            return await self._chapter_source(sequence, tasks, source, unavailable)
        if source.kind == "revision":
            return await self._revision_source(sequence, source, unavailable)
        return unavailable

    @staticmethod
    def _model_source(tasks: list[Task], source: Source, unavailable: SourceRead) -> SourceRead:
        """生成来源标识与任务主键不同；重复身份也不能任意取一个。"""
        matches = [task for task in tasks if task_args(task).get("task_identity") == source.reference]
        if len(matches) != 1 or source.version != "1":
            return unavailable
        task = matches[0]
        snapshot = task.input_snapshot
        args = task_args(task)
        return SourceRead(source=source, status="ready", label=f"AI建议 · {task.title or '导演设计'} · {task.created_at:%m-%d %H:%M:%S}",
                          description="生成时保存的输入上下文，并非该字段的逐句引用依据。",
                          model_name=snapshot.get("model_name") if isinstance(snapshot.get("model_name"), str) else None, task_id=task.id,
                          created_at=task.created_at, context_text=args.get("script_text") if isinstance(args.get("script_text"), str) else None)

    async def _chapter_source(self, sequence: Sequence, tasks: list[Task], source: Source, unavailable: SourceRead) -> SourceRead:
        """准确版本只读取已冻结摘录，缺少历史时不读取当前章节代替。"""
        if source.reference != sequence.chapter_id:
            return unavailable
        text = sequence.source_text if sequence.source.get("version") == source.version else None
        if text is None:
            contexts = {task_args(task).get("script_text") for task in tasks
                        if task_args(task).get("source") == source.model_dump(mode="json") and isinstance(task_args(task).get("script_text"), str)}
            contexts.discard(None)
            if len(contexts) == 1:
                text = contexts.pop()
        if text is None:
            return unavailable
        chapter = await self.db.get(Chapter, sequence.chapter_id)
        return SourceRead(source=source, status="ready", label="章节原文 · 场次摘录",
                          description="当时保存的场次原文范围；章节名称为当前名称。未记录字段级原文定位。",
                          chapter_name=chapter.title, context_text=text)

    async def _revision_source(self, sequence: Sequence, source: Source, unavailable: SourceRead) -> SourceRead:
        """版本身份、场次和修订同时匹配才提供历史入口。"""
        try:
            revision = await self.revision(source.reference, sequence_id=sequence.id)
        except ValueError:
            return unavailable
        if str(revision.version) != source.version:
            return unavailable
        return SourceRead(source=source, status="ready", label=f"继承自{REVISION_NAMES.get(revision.kind, '版本')} · {revision.created_at:%m-%d %H:%M:%S}",
                          description=f"对应修订 {revision.version}；可查看原版本内容。",
                          revision_id=revision.id, revision_kind=revision.kind)

    async def _attach_file(self, row: SourceRead) -> SourceRead:
        """先校验项目归属、删除状态和真实区间，再提供文件名与预览目标。"""
        source = row.source
        file = await self.db.get(FileItem, source.file_id)
        projects = set(await self.db.scalars(select(FileUsage.project_id).where(FileUsage.file_id == source.file_id)))
        if not file or file.delete_requested_at or file.deleted_at or (projects and self.project_id not in projects):
            return SourceRead(source=source, status="unavailable", label=LABELS[source.kind], description="参考文件不存在、已删除或不在当前项目中。")
        if source.media_range and (file.duration_ms is None or source.media_range.source_out_ms > file.duration_ms):
            return SourceRead(source=source, status="unavailable", label=LABELS[source.kind], description="记录的媒体区间无法在当前文件中核实。")
        update = {"file_id": file.id, "file_name": file.name, "media_kind": file.type}
        if source.kind == "file":
            update.update(status="ready", label=f"参考文件 · {file.name}", description="文件身份与记录区间已核对。")
        return row.model_copy(update=update)
