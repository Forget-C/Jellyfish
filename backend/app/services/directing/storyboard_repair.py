"""Bound a semantic repair to the reviewed proposal fields and keep all evidence."""

from dataclasses import dataclass

from app.core.contracts.directing.scene_storyboard import (
    SceneStoryboard, StoryboardField, StoryboardRepairResult, StoryboardRepairTarget, StoryboardReviewReport,
)
from app.services.directing.storyboard_review import invoke_storyboard_json
from app.services.directing.storyboard_scope import StoryboardDesignPlan

SHOT_FIELDS = frozenset(('narrative_role', 'visible_result', 'beat'))


@dataclass(frozen=True)
class RepairField:
    """A repair target resolved against one exact draft."""

    target: StoryboardRepairTarget
    note: StoryboardField
    shots: tuple[str, ...]


def repair_fields(draft: SceneStoryboard, report: StoryboardReviewReport, protected: set[str],
                  reasons: list[str] | None = None) -> dict[tuple, RepairField]:
    """Allow only explicitly identified proposals whose whole scope was reviewed."""
    plan = StoryboardDesignPlan(draft)
    shots = {shot.id: shot for shot in draft.shots}
    allowed = {}
    for issue in report.issues:
        if issue.kind != 'conflict':
            continue
        for target in issue.repair_targets:
            if target.design_id:
                key = plan.design_key(target.shot_id, target.design_id)
                piece = plan.fields.get((key, target.field_id))
                if not piece:
                    if reasons is not None:
                        reasons.append('目标设计字段不存在')
                    continue
                note, scope = piece.notes[target.field_id], piece.scope.shots
            elif target.shot_id in shots and target.field_id in SHOT_FIELDS:
                key = f'shot:{target.shot_id}' + (':beat' if target.field_id == 'beat' else '')
                note, scope = getattr(shots[target.shot_id], target.field_id), (target.shot_id,)
            else:
                if reasons is not None:
                    reasons.append('目标不是允许定向修正的字段')
                continue
            reason = ('目标不是可修改的设计建议' if not note or note.state != 'proposal' else
                      '审查未覆盖目标的全部适用镜头' if not set(scope) <= set(issue.shot_ids) else
                      '目标包含受保护的人工修改' if any(item == key or item.startswith(key + ':scope:') for item in protected) else '')
            if reason:
                if reasons is not None:
                    reasons.append(reason)
            else:
                allowed[target.key] = RepairField(target, note, scope)
    return allowed


def repair_storyboard(llm, inputs: dict) -> StoryboardRepairResult:
    """Request one proposal-text patch without structural repair retries."""
    instruction = (
        '只修正 repair_targets 中的提议正文，针对 review 的矛盾给出最少的 edits。'
        '使用相同 shot_id、design_id、field_id，text 仅含修正后的可执行描述。'
        '保留原文事实、因果、对象、镜头顺序、范围、关联和所有其他字段。'
        '优先保留原文事实、人工决定与共享空间安排，选择影响字段最少的方案；修正朝向后核对持物可见性。不同解会明显改变视觉意图且无法判断时不要擅自取舍。'
        '不能确定如何修正时省略该项；无安全修改时返回空 edits。只返回符合结构的 JSON：'
    )
    return invoke_storyboard_json(llm, inputs, StoryboardRepairResult, instruction, '分镜修正返回无效，原草案已保留')


def apply_repair(draft: SceneStoryboard, repair: StoryboardRepairResult, allowed: dict[tuple, RepairField]) -> list[str]:
    """Reject out-of-scope batches atomically; return affected shots and their neighbors."""
    keys = [edit.key for edit in repair.edits]
    if len(set(keys)) != len(keys) or not set(keys) <= allowed.keys():
        return []
    affected = set()
    for edit in repair.edits:
        field = allowed[edit.key]
        if field.note.text != edit.text:
            field.note.text = edit.text
            affected.update(field.shots)
    order = [shot.id for shot in draft.shots]
    return [shot for index, shot in enumerate(order)
            if affected.intersection(order[max(0, index - 1):index + 2])]


def merge_recheck(previous: StoryboardReviewReport, current: StoryboardReviewReport,
                  changed_scope: list[str]) -> StoryboardReviewReport:
    """Keep findings outside a verified repair and avoid duplicate findings."""
    issues = [issue for issue in previous.issues if not set(issue.shot_ids).intersection(changed_scope)]
    issues.extend(issue for issue in current.issues if issue not in issues)
    return StoryboardReviewReport(issues=issues)
