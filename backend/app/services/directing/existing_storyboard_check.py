"""Inspect and edit only the reviewed proposal fields of a saved workbench canvas."""

from app.core.contracts.directing.scene_storyboard import StoryboardRepairResult, StoryboardReviewReport
from app.core.contracts.generation_canvas import DesignField
from app.schemas.generation_canvas import CanvasDocument
from app.services.directing.storyboard_review_basis import affected_shots, canvas_review_evidence

STORYBOARD_CHECK_KIND = 'directing_storyboard_check'


def saved_review_inputs(document: CanvasDocument) -> dict:
    """Review the actual saved design and adopted context, not the extraction prompt."""
    fixed = next(card for card in document.cards if card.id == document.fixed_source.card_id)
    return {'saved_canvas_check': True, 'script_text': fixed.text,
            'storyboard_draft': canvas_review_evidence(document)}


def saved_repair_fields(document: CanvasDocument, report: StoryboardReviewReport) -> dict:
    """Resolve exact saved card fields and protect user edits and rich references."""
    cards = {card.id: card for card in document.cards}
    storyboard = document.storyboard
    logical = {shot.shot_id: storyboard.origins[shot.card_id].semantic_key.removeprefix('shot:')
               for shot in storyboard.shots if shot.card_id in storyboard.origins}
    fields = {}
    for issue in report.issues:
        if issue.kind != 'conflict':
            continue
        for target in issue.repair_targets:
            card = cards.get(target.design_id)
            origin = storyboard.origins.get(target.design_id)
            if not card or not origin or origin.manually_edited or not card.type.startswith('direction.'):
                continue
            if origin.applicability and origin.applicability.shot_ids:
                scope = {logical[key] for key in origin.applicability.shot_ids if key in logical}
            elif origin.semantic_key.startswith('scene:design:'):
                scope = set(logical.values())
            else:
                scope = {key for key in logical.values() if origin.semantic_key == f'shot:{key}'
                         or origin.semantic_key.startswith(f'shot:{key}:')}
            if not scope or not scope <= set(issue.shot_ids) or (target.shot_id and target.shot_id not in scope):
                continue
            if target.field_id.startswith('phase:'):
                phase_id = target.field_id.removeprefix('phase:')
                phase = next((item for item in getattr(card, 'phases', ()) if item.id == phase_id), None)
                note = phase.frame if phase else None
            else:
                note = getattr(getattr(card, 'fields', card), target.field_id, None)
            if (isinstance(note, DesignField) and note.authorship == 'model' and note.state == 'proposal'
                    and not getattr(note, 'document', None)):
                fields[target.key] = (target, note, scope)
    return fields


def patch_saved_design(document: CanvasDocument, report: StoryboardReviewReport, repair: StoryboardRepairResult) -> tuple[list[str], set[str]]:
    """Apply a whole verified text patch to a copy, preserving all other saved fields."""
    fields = saved_repair_fields(document, report)
    keys = [edit.key for edit in repair.edits]
    if len(set(keys)) != len(keys) or not set(keys) <= fields.keys():
        return [], set()
    affected, changed = set(), set()
    for edit in repair.edits:
        target, note, scope = fields[edit.key]
        if note.text != edit.text:
            note.text = edit.text
            affected.update(scope)
            changed.add(target.design_id)
    return affected_shots(document, list(affected)), changed
