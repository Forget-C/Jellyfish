"""Inspect an exact storyboard draft without granting permission to apply it."""

import json

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import ValidationError

from app.core.contracts.directing.scene_storyboard import StoryboardReviewReport
from app.core.contracts.task import TaskStatus
from app.services.generation_canvas.errors import diagnostic


def review_storyboard(llm, inputs: dict) -> StoryboardReviewReport:
    """Make one semantic review request and reject unresolvable shot identities."""
    from app.services.directing.ai import DirectingOutputError
    instruction = (
        '审查固定分镜草案，不重写分镜，不批准应用。逐镜核对可执行性，并对比相邻镜头前态和后态。'
        '实际矛盾标为 conflict，例如同时要求入场和静止，头手双脚必须同框却规定不可能容纳的景别，'
        '或没有剧情动作却换持物手、换位。只有依据不足而无法判断时标 insufficient_basis。'
        '正常切换景别或机位、对象出画不等于状态变化，不因此报冲突。'
        '每项列出涉及的现有 shot_ids、互相矛盾或缺失的具体要求 requirements，以及可执行 suggestion。'
        '没有问题返回空 issues。只返回符合以下结构的 JSON：\n'
    )
    response = llm.invoke([
        SystemMessage(content=instruction + json.dumps(StoryboardReviewReport.model_json_schema(), ensure_ascii=False)),
        HumanMessage(content=json.dumps(inputs, ensure_ascii=False)),
    ])
    content = response.content
    if isinstance(content, str):
        content = content.strip()
        if content.startswith('```') and '\n' in content:
            content = content.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    try:
        report = StoryboardReviewReport.model_validate_json(content)
    except (ValidationError, TypeError) as error:
        raise DirectingOutputError('分镜审查返回无效，请重试审查') from error
    known = {shot['id'] for shot in inputs['storyboard_draft']['shots']}
    if any(len(set(issue.shot_ids)) != len(issue.shot_ids) or not set(issue.shot_ids) <= known for issue in report.issues):
        raise DirectingOutputError('分镜审查引用了无效镜头，请重试审查')
    return report


def review_state(status: str, stored_state: str | None) -> str | None:
    """A durable pending checkpoint becomes incomplete if execution stops."""
    if stored_state == 'pending' and status in (TaskStatus.failed, TaskStatus.cancelled):
        return 'incomplete'
    return stored_state


def require_storyboard_review(task, canvas_id: str) -> None:
    """Grandfather finished pre-review tasks and reject incomplete or conflicting candidates."""
    if task.status != TaskStatus.succeeded or (task.result or {}).get('review_state') in ('pending', 'conflict'):
        raise diagnostic('STORYBOARD_REVIEW_REQUIRED', '分镜审查未完成或仍有冲突，请先处理审查问题',
                         {'canvas_id': canvas_id}, status=409)
