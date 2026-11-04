"""Design parameters resolve field-owned references without collecting candidate ancestors."""
import re
from app.core.contracts.generation_canvas import ReferenceDesignField, DesignFieldReference, DesignMediaReference, DesignReferenceIssue
from app.services.generation_canvas.output_resolution import identity_key

VISUAL_DESIGN_TYPES = frozenset(('direction.style', 'direction.camera', 'direction.lighting', 'direction.focus', 'direction.composition', 'direction.movement'))

PERFORMANCE_DESIGN_TYPES = frozenset(('direction.situation', 'direction.performance', 'direction.performance_rule', 'direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment'))
REFERENCE_DESIGN_TYPES = VISUAL_DESIGN_TYPES | PERFORMANCE_DESIGN_TYPES


def design_fields(card):
    """Stable field paths include explicit movement phase identities."""
    if card.type in PERFORMANCE_DESIGN_TYPES:
        for key in type(card).model_fields:
            value = getattr(card, key)
            if isinstance(value, ReferenceDesignField):
                yield key, value, [key]
        return
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


def resolve_design_card(context, card, *, model_outputs, allow_reference_drafts=False, reference_tokens=None, field_ids=None):
    """Render each active field once; missing sources remain attributable placeholders."""
    candidates = context.resolve_outputs(card.id, model_outputs=model_outputs, allow_reference_drafts=allow_reference_drafts)
    by_source = {identity_key(item.source): item for item in candidates}
    media, issues, fields, phases, seen_media = [], [], {}, {}, set()
    basis_current = True
    for key, value, _ in design_fields(card):
        if field_ids is not None and key not in field_ids:
            continue
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
            if not code and segment.source.port_id == 'anchor':
                if card.type not in PERFORMANCE_DESIGN_TYPES or not source or source.type != 'direction.anchor':
                    code = 'DESIGN_BODY_REFERENCE_FORBIDDEN'
                else:
                    values = list(design_fields(source))
                    active = [(name, field) for name, field, _ in values if field.state not in ('empty', 'not_applicable')]
                    if any(field.document and any(part.kind == 'reference' for part in field.document.segments) for _, field in active):
                        code = 'ANCHOR_NESTED_REFERENCE'
                    else:
                        from app.services.generation_canvas.spatial import FIELD_LABELS
                        location = [FIELD_LABELS[name] + '：' + (''.join(part.text for part in field.document.segments) if field.document else field.text) for name, field in active]
                        item = item.model_copy(update={'text': source.name + '（' + '；'.join(location) + '）'})
            if not code and card.type in PERFORMANCE_DESIGN_TYPES and item and item.modality == 'audio':
                code = 'UNSUPPORTED_DESIGN_MEDIA'
            if not code and item and item.modality == 'text' and not item.text:
                code = 'REFERENCE_TEXT_UNAVAILABLE'
            if code:
                if effective:
                    issues.append(DesignReferenceIssue(source=segment.source, field_id=key, reference_id=segment.id, code=code, message='锚点定位包含未展开的引用，请改为纯文本定位或在当前卡直接表达位置与素材' if code == 'ANCHOR_NESTED_REFERENCE' else '设计参数引用不可用，请查看对应字段和来源'))
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
    updated = card.model_copy(update=fields) if card.type in PERFORMANCE_DESIGN_TYPES else card.model_copy(update={'fields': card.fields.model_copy(update=fields)})
    if phases:
        updated = updated.model_copy(update={'phases': [phase.model_copy(update={'frame': phases.get(phase.id, phase.frame)}) for phase in card.phases]})
    return updated, media, issues, basis_current


def effective_design_references(card, cards):
    """本卡有效字段及显式定位的单个画面来源；不继承其余运镜正文。"""
    yield from design_field_references(card, effective=True)
    if card.type == 'direction.composition' and card.frame_target:
        from app.services.generation_canvas.composition import frame_target_field
        movement, _, _, key = frame_target_field(card.frame_target, cards)
        if movement:
            yield from (entry for entry in design_field_references(movement, effective=True) if entry[1] == key)
