"""Prepare explicitly declared design media without granting new direct-reference eligibility."""
from app.core.contracts.generation_canvas import DesignMediaOrigin, DesignTextPayload
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.design_references import VISUAL_DESIGN_TYPES
from app.services.generation_canvas.output_resolution import identity_key, prompt_references


def image_design_inputs(context, card, candidates, model_outputs):
    """Keep direct candidates separate; merge actual images by stable identity and re-render typed references."""
    if card.type != 'model.image':
        return candidates, []
    used_keys = {identity_key(ref.source) for ref, _ in prompt_references(card)}
    selected = [item for item in candidates if identity_key(item.source) in used_keys and item.available]
    order = list(dict.fromkeys(identity_key(binding.source) for binding in card.input_bindings))
    selected.sort(key=lambda item: order.index(identity_key(item.source)))
    direct_media = {identity_key(item.source) for item in selected if item.modality != 'text'}
    media = {identity_key(item.source): item for item in selected if item.modality != 'text'}
    known = {identity_key(item.source): item for item in candidates}
    counts = {modality: sum(item.modality == modality for item in candidates) for modality in ('image', 'video', 'audio')}
    for design in selected:
        if not isinstance(design.payload, DesignTextPayload) or design.payload.design_type not in VISUAL_DESIGN_TYPES:
            continue
        for ref in design.payload.material_references:
            key = identity_key(ref.source)
            if key not in media:
                if key not in known:
                    counts[ref.modality] += 1
                token = known[key].token if key in known else '@' + {'image': '图片', 'video': '视频', 'audio': '音频'}[ref.modality] + str(counts[ref.modality])
                media[key] = CanvasResolvedOutput(source=ref.source, modality=ref.modality, payload=ref.payload,
                    file_id=ref.file_id, result_set_id=ref.result_set_id, available=ref.available,
                    basis_current=ref.basis_current, token=token)
            item = media[key]
            origin = DesignMediaOrigin(source=design.source, field_id=ref.field_id)
            origins = item.design_sources if origin in item.design_sources else [*item.design_sources, origin]
            media[key] = item.model_copy(update={'design_sources': origins, 'basis_current': item.basis_current and ref.basis_current})
    tokens = {key: f'image {position}' for position, key in enumerate(media, 1)}
    rendered = []
    for candidate in candidates:
        key = identity_key(candidate.source)
        if key in used_keys and isinstance(candidate.payload, DesignTextPayload) and candidate.payload.material_references:
            outputs = context.published_outputs(candidate.source.card_id, model_outputs=model_outputs, reference_tokens=tokens)
            updated = next((item for item in outputs if identity_key(item.source) == key), candidate)
            candidate = updated.model_copy(update={'token': candidate.token})
        elif key in media:
            candidate = media[key].model_copy(update={'token': candidate.token})
        rendered.append(candidate)
    return rendered, [item for key, item in media.items() if key not in direct_media]
