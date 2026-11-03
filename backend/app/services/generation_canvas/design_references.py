"""Six visual designs resolve field-owned references without collecting candidate ancestors."""
import re
from app.core.contracts.generation_canvas import DesignFieldReference, DesignMediaReference, DesignReferenceIssue
from app.services.generation_canvas.output_resolution import identity_key

VISUAL_DESIGN_TYPES = frozenset(('direction.style', 'direction.camera', 'direction.lighting', 'direction.focus', 'direction.composition', 'direction.movement'))


def design_fields(card):
    """Stable field paths include explicit movement phase identities."""
    if card.type not in VISUAL_DESIGN_TYPES:
        return
    for key, value in card.fields:
        yield key, value, ['fields', key]
    for phase in getattr(card, 'phases', []):
        yield 'phase:' + phase.id, phase.frame, ['phases', phase.id, 'frame']


def design_field_references(card, *, effective=False):
    """Retained references protect deletion; only active references affect execution."""
    for key, value, path in design_fields(card):
        if not value.document or effective and value.state in ('empty', 'not_applicable'):
            continue
        for segment in value.document.segments:
            if isinstance(segment, DesignFieldReference):
                yield segment, key, path + ['document', 'segments', segment.id]


def resolve_design_card(context, card, *, model_outputs, allow_reference_drafts=False, reference_tokens=None):
    """Render each active field once; missing sources remain attributable placeholders."""
    candidates = context.resolve_outputs(card.id, model_outputs=model_outputs, allow_reference_drafts=allow_reference_drafts)
    by_source = {identity_key(item.source): item for item in candidates}
    media, issues, fields, phases, seen_media = [], [], {}, {}, set()
    basis_current = True
    for key, value, _ in design_fields(card):
        if not value.document:
            continue
        effective = value.state not in ('empty', 'not_applicable')
        text = ''
        for segment in value.document.segments:
            if segment.kind == 'text':
                if effective and re.search(r'(?<!\\)@(?:文本|图片|视频|音频)\d*', segment.text):
                    issues.append(DesignReferenceIssue(field_id=key, reference_id=segment.id, code='UNCONFIRMED_REFERENCE', message='参数代号尚未确认或不存在，请选择实际候选'))
                text += re.sub(r'\\(?=[@/])', '', segment.text)
                continue
            item = by_source.get(identity_key(segment.source))
            if effective and item and not item.basis_current:
                basis_current = False
            source = context.cards.get(segment.source.card_id)
            code = 'REFERENCE_CANVAS_MISMATCH' if segment.source.canvas_id != context.document.id else 'DESIGN_BODY_REFERENCE_FORBIDDEN' if source and source.type.startswith('direction.') and segment.source.port_id == 'text' else 'REFERENCE_NOT_CONNECTED' if item is None else 'OUTPUT_MISSING' if not item.available else None
            if code:
                if effective:
                    issues.append(DesignReferenceIssue(source=segment.source, field_id=key, reference_id=segment.id, code=code, message='设计参数引用不可用，请查看对应字段和来源'))
                text += '[引用不可用]'
            elif item.modality == 'text':
                text += item.text or ''
            else:
                text += (reference_tokens or {}).get(identity_key(item.source), item.token)
            media_key = (key, identity_key(item.source)) if item else None
            if effective and item and item.modality != 'text' and media_key not in seen_media:
                seen_media.add(media_key)
                media.append(DesignMediaReference(source=item.source, field_id=key, modality=item.modality, token=item.token, file_id=item.file_id, result_set_id=item.result_set_id, available=item.available and not code, basis_current=item.basis_current, payload=item.payload))
        updated = value.model_copy(update={'text': text})
        if key.startswith('phase:'):
            phases[key[6:]] = updated
        else:
            fields[key] = updated
    updated = card.model_copy(update={'fields': card.fields.model_copy(update=fields)})
    if phases:
        updated = updated.model_copy(update={'phases': [phase.model_copy(update={'frame': phases.get(phase.id, phase.frame)}) for phase in card.phases]})
    return updated, media, issues, basis_current
