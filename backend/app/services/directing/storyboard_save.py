"""分镜写入的可信证据：确认、普通保存准入和恢复共用回执规则。"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.scene_storyboard import StoryboardApplication, StoryboardContinuityDiff
from app.models.generation_canvas import CanvasSaveReceipt, GenerationCanvas
from app.models.task import Task
from app.schemas.generation_canvas import CanvasDocument
from app.services.directing.existing_storyboard_check import STORYBOARD_CHECK_KIND
from app.services.directing.storyboard_assembly import STORYBOARD_KIND
from app.services.directing.storyboard_continuity_choices import visual_continuity_state
from app.services.directing.storyboard_review import require_storyboard_review
from app.services.directing.storyboard_review_basis import canvas_review_fingerprint, evidence_digest
from app.services.generation_canvas.document_save import fixed_source_state
from app.services.generation_canvas.errors import diagnostic


def _history_state(document: CanvasDocument) -> dict:
    state = {'sources': fixed_source_state(document), 'task_id': document.storyboard.task_id if document.storyboard else None}
    if continuity := visual_continuity_state(document):
        state['visual_continuity'] = continuity
    if document.storyboard and document.storyboard.continuity_check_task_id:
        state['continuity_check_task_id'] = document.storyboard.continuity_check_task_id
    return state


def _confirmed_risks(task: Task, canvas_id: str, command: StoryboardApplication,
                     review: StoryboardContinuityDiff | None) -> list[dict]:
    if review and review.stale:
        raise diagnostic('STORYBOARD_REVIEW_STALE', '相关分镜内容已变化，请重新审查', {'canvas_id': canvas_id}, status=409)
    if not review or not review.conflicts:
        require_storyboard_review(task, canvas_id)
        return []
    ids = {choice.id for choice in review.conflicts}
    explicit = set(command.accepted_conflict_ids)
    carried = {choice.id for choice in review.conflicts if choice.previously_accepted}
    if (command.review_token != review.token or len(explicit) != len(command.accepted_conflict_ids)
            or explicit | carried != ids):
        raise diagnostic('STORYBOARD_REVIEW_REQUIRED', '请逐项确认本次分镜的设计冲突', {'canvas_id': canvas_id}, status=409)
    return [{'id': choice.id, 'shot_ids': choice.issue.shot_ids} for choice in review.conflicts]


@dataclass(frozen=True)
class StoryboardSaveEvidence:
    """服务端核验后的来源替换与回执依据；不提交事务，也不代替共同文档校验。"""

    scene_sources: dict
    _source_history: dict | None = None
    _accepted_risks: list[dict] | None = None
    restored_continuity: frozenset[str] = frozenset()

    @classmethod
    def confirm(cls, task: Task, current: CanvasDocument, document: CanvasDocument,
                command: StoryboardApplication, review: StoryboardContinuityDiff | None,
                *, has_changes: bool) -> 'StoryboardSaveEvidence':
        """核对精确冲突选择，登记已保存分镜的检查身份，保留本次来源前后状态。"""
        risks = _confirmed_risks(task, current.id, command, review)
        if task.kind == STORYBOARD_CHECK_KIND:
            if not review or command.review_token != review.token or (not has_changes and not risks):
                raise diagnostic('STORYBOARD_REVIEW_REQUIRED', '请核对本次检查的修正或风险后应用',
                                 {'canvas_id': current.id}, status=409)
            document.storyboard.continuity_check_task_id = task.id
        return cls(scene_sources=fixed_source_state(document),
                   _source_history={'before': _history_state(current), 'after': _history_state(document)},
                   _accepted_risks=risks if task.kind == STORYBOARD_CHECK_KIND else risks or None)

    @classmethod
    async def restore(cls, db: AsyncSession, canvas: GenerationCanvas, sequence_id: str, task_id: str,
                      current: CanvasDocument, document: CanvasDocument, direction: str) -> 'StoryboardSaveEvidence':
        """调用方已锁画布、核实幂等与修订；只接受真实回执两侧的原文和完整设计证据。"""
        receipt = await db.get(CanvasSaveReceipt, (canvas.id, 'storyboard:' + task_id))
        history = receipt.response.get('source_history') if receipt else None
        from_side, to_side = ('after', 'before') if direction == 'undo' else ('before', 'after')
        if canvas.sequence_id != sequence_id or not history or _history_state(current) != history[from_side] or (
                _history_state(document) != history[to_side]):
            raise diagnostic('INVALID_STORYBOARD_RESTORE', '无法核对整批操作的原文与提取依据', {'canvas_id': canvas.id})
        evidence = receipt.response.get('review_history')
        if evidence and (canvas_review_fingerprint(current, full=True) != evidence[from_side]
                         or canvas_review_fingerprint(document, full=True) != evidence[to_side]):
            raise diagnostic('INVALID_STORYBOARD_RESTORE', '无法核对原风险确认对应的设计内容', {'canvas_id': canvas.id})
        return cls(scene_sources=history[to_side]['sources'],
                   restored_continuity=frozenset(history[to_side].get('visual_continuity', {})))

    def receipt_fields(self, previous: CanvasDocument, document: CanvasDocument) -> dict:
        """按共同保存规范化后的文档生成风险指纹；由调用方与文档在同一事务写入。"""
        fields = {}
        if self._source_history is not None:
            fields['source_history'] = self._source_history
        if self._accepted_risks is not None:
            fields['review_history'] = {
                'before': canvas_review_fingerprint(previous, full=True),
                'after': canvas_review_fingerprint(document, full=True),
                'risks': self._accepted_risks,
            }
        return fields


async def require_ordinary_save(db: AsyncSession, canvas: GenerationCanvas,
                                previous: CanvasDocument, document: CanvasDocument) -> None:
    """普通保存也必须核验分镜任务与原应用回执，不能借文档写入绕过审查。"""
    if not canvas.sequence_id:
        return
    storyboard, before = document.storyboard, previous.storyboard
    if ((storyboard.continuity_check_task_id if storyboard else None) !=
            (before.continuity_check_task_id if before else None)):
        raise diagnostic('STORYBOARD_REVIEW_REQUIRED', '分镜检查只能通过确认应用或撤销恢复',
                         {'canvas_id': canvas.id}, status=409)
    if not storyboard or before and storyboard.task_id == before.task_id:
        return
    task = await db.get(Task, storyboard.task_id)
    if (not task or task.kind != STORYBOARD_KIND or task.project_id != canvas.project_id
            or task.target_id != canvas.sequence_id or task.input_snapshot.get('canvas_id') != canvas.id):
        raise diagnostic('INVALID_STORYBOARD_TASK', '分镜任务不属于此画布', {'canvas_id': canvas.id}, status=409)
    require_storyboard_review(task, canvas.id)
    result = task.result or {}
    if result.get('review_state'):
        baseline = {'expected_revision': result['base_revision'], 'document': result['document']}
        initial = (baseline['expected_revision'] == canvas.revision and not task.input_snapshot.get('reextract_canvas_id')
                   and not task.input_snapshot.get('review_retry_from')
                   and document.model_dump(mode='json') == baseline['document'])
        if not initial:
            applied = await db.get(CanvasSaveReceipt, (canvas.id, 'storyboard:' + task.id))
            history = applied.response.get('source_history', {}) if applied else {}
            restored = applied and (applied.request_hash == evidence_digest(baseline)
                                    or history.get('after', {}).get('task_id') == task.id)
            if not restored:
                raise diagnostic('STORYBOARD_APPLICATION_REVIEW_REQUIRED', '请核对分镜差异后应用',
                                 {'canvas_id': canvas.id}, status=409)
