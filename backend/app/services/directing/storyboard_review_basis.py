"""Fingerprints of the design evidence, independently of canvas arrangement."""

from hashlib import sha256
import json

from app.schemas.generation_canvas import CanvasDocument, CanvasStoryboardShot


def evidence_digest(value: dict) -> str:
    """Hash an exact, canonical review input."""
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _shots(document: CanvasDocument) -> list[tuple[str, CanvasStoryboardShot]]:
    storyboard = document.storyboard
    return [(storyboard.origins[shot.card_id].semantic_key.removeprefix('shot:'), shot)
            for shot in storyboard.shots if shot.card_id in storyboard.origins] if storyboard else []


def affected_shots(document: CanvasDocument, shot_ids: list[str]) -> list[str]:
    """A transition depends on the reported shots and their immediate neighbors."""
    order = [key for key, _ in _shots(document)]
    return [key for index, key in enumerate(order)
            if any(other in shot_ids for other in order[max(0, index - 1):index + 2])]


def canvas_review_evidence(document: CanvasDocument, shot_ids: list[str] | None = None, *, full: bool = False) -> dict:
    """Include relevant design cards, dependencies, fixed evidence and story order, excluding layout."""
    storyboard = document.storyboard
    selected = [(key, shot) for key, shot in _shots(document) if shot_ids is None or key in shot_ids]
    physical_ids = {shot.shot_id for _, shot in selected}
    cards = {card.id: card for card in document.cards}
    relevant = {document.fixed_source.card_id} if document.fixed_source else set()
    for _, shot in selected:
        relevant.update([shot.card_id, *shot.model_card_ids])
    origins = storyboard.origins if storyboard else {}
    if full:
        relevant.update(cards)
    else:
        for card_id, origin in origins.items():
            key = origin.semantic_key
            scope = origin.applicability
            if not key.startswith(('scene:design:', 'shot:')):
                continue
            if scope and scope.shot_ids:
                if physical_ids.intersection(scope.shot_ids):
                    relevant.add(card_id)
            elif key.startswith('scene:design:') or any(key == f'shot:{shot}' or key.startswith(f'shot:{shot}:') for shot, _ in selected):
                relevant.add(card_id)
        if not storyboard:
            relevant.update(card.id for card in document.cards if card.type.startswith('direction.'))
    incoming = {}
    for edge in document.edges:
        incoming.setdefault(edge.target_card, []).append(edge)
    frontier = list(relevant)
    while frontier:
        for edge in incoming.get(frontier.pop(), ()):
            if edge.source_card not in relevant:
                relevant.add(edge.source_card)
                frontier.append(edge.source_card)
    return {
        'fixed_source': document.fixed_source.model_dump(mode='json') if document.fixed_source else None,
        'shots': [{**shot.model_dump(mode='json', exclude={'group_id'}), 'id': key} for key, shot in selected],
        'cards': [cards[key].model_dump(mode='json') for key in sorted(relevant & cards.keys())],
        'origins': {key: origins[key].model_dump(mode='json', exclude={'manually_edited'})
                    for key in sorted(relevant & origins.keys())},
        'edges': [edge.model_dump(mode='json') for edge in sorted(document.edges, key=lambda row: row.id)
                  if edge.target_card in relevant],
        'input_order': {key: value for key, value in document.input_order.items() if key in relevant},
    }


def canvas_review_fingerprint(document: CanvasDocument, shot_ids: list[str] | None = None, *, full: bool = False) -> str:
    """Identify the exact projection passed to review without embedding its contents."""
    evidence = canvas_review_evidence(document, shot_ids, full=full)
    # Keep existing extraction risk and application proofs compatible.
    for shot in evidence['shots']:
        shot.pop('id')
    return evidence_digest(evidence)


def capture_review_basis(document: CanvasDocument) -> dict:
    """Freeze both whole-scene and per-shot evidence before the model sees a draft."""
    return {
        'all': canvas_review_fingerprint(document),
        'shared': canvas_review_fingerprint(document, []),
        'shots': {key: canvas_review_fingerprint(document, affected_shots(document, [key])) for key, _ in _shots(document)},
    }


def risk_basis(document: CanvasDocument, shot_ids: list[str]) -> str:
    """Scope a risk decision to the reported shots and actual transition evidence."""
    return canvas_review_fingerprint(document, affected_shots(document, shot_ids))


def active_risks(document: CanvasDocument, risks: list[dict]) -> set[str]:
    """A decision only survives while its own evidence is unchanged."""
    return {risk['id'] for risk in risks if risk['basis'] == risk_basis(document, risk['shot_ids'])}
