"""Preview stack protection for a storyboard application without changing the shared guard."""
import re

from app.core.contracts.directing.scene_storyboard import StoryboardDiffStack
from app.schemas.generation_canvas import CanvasDocument
from app.services.directing.storyboard_assembly import storyboard_design_stack_id
from app.services.generation_canvas.document_save import _normalize_document
from app.services.generation_canvas.errors import CanvasDomainError
from app.services.generation_canvas.stacks import validate_stack_edit


def review_stack_changes(current: CanvasDocument, planned: CanvasDocument) -> tuple[list[StoryboardDiffStack], list[StoryboardDiffStack]]:
    """Identify protected changes on the normalized application, including entire stack deletion."""
    stacks = {group.id: group for group in current.groups if group.kind == 'stack'}
    if not stacks:
        return [], []
    automatic = {storyboard_design_stack_id(), *(storyboard_design_stack_id(shot.shot_id) for shot in current.storyboard.shots)} \
        if current.storyboard else set()
    # 显式整理重新收纳成员时使用同一分镜归属下的新堆叠身份。
    def is_automatic(group_id: str) -> bool:
        base, _, revision = group_id.rpartition('-')
        return group_id in automatic or base in automatic and re.fullmatch(r'[0-9a-f]{8}', revision) is not None

    # The comparison copy normalizes exactly as a save does before evaluating each stack.
    previous = current.model_copy(update={'groups': []}, deep=True)
    normalized = _normalize_document(planned.model_copy(deep=True), previous)
    previous_document = current.model_dump()
    planned_stacks = {group.id: group for group in normalized.groups if group.kind == 'stack'}
    # An absent group is not implicit permission to delete all its members during extraction.
    normalized.groups = [planned_stacks.get(group.id) or group.model_copy(update={'card_ids': []}) for group in stacks.values()]
    auto_changes: list[StoryboardDiffStack] = []
    manual_changes: list[StoryboardDiffStack] = []
    while normalized.groups:
        try:
            validate_stack_edit(previous_document, normalized)
            break
        except CanvasDomainError as issue:
            if issue.detail['code'] != 'STACK_READ_ONLY':
                raise
            group = stacks[issue.detail['target']['group_id']]
            changes = auto_changes if is_automatic(group.id) else manual_changes
            changes.append(StoryboardDiffStack(id=group.id, name=group.name))
            normalized.groups = [other for other in normalized.groups if other.id != group.id]
    return auto_changes, manual_changes
