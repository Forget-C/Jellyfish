"""Merge a verified storyboard into the existing canvas by stable identity."""

from collections import defaultdict

from app.core.contracts.directing.scene_storyboard import StoryboardApplication, StoryboardDiff, StoryboardDiffCard
from app.schemas.generation_canvas import CanvasDocument, NamedImageReferenceCard, ObjectDescriptionCard
from app.services.directing.storyboard_reference_choices import carry_reference_choices, expired_reference_uses
from app.services.directing.storyboard_reference_cleanup import card_name, clean_lost_references
from app.services.generation_canvas.catalog import CARD_TITLES
from app.services.generation_canvas.errors import diagnostic


def _display(card, *, manual: bool = False, lost: list[str] | None = None):
    return StoryboardDiffCard(id=card.id, type=card.type, type_name=CARD_TITLES[card.type], name=card_name(card),
                             manually_edited=manual, lost_targets=lost or [])


def _connections(document: CanvasDocument | None) -> dict:
    """Compare connection purpose and order without relying on generated candidate edge IDs."""
    if not document:
        return {}
    edges = {edge.id: edge for edge in document.edges}
    return {card_id: {port: [(edge.source_card, edge.source_port, edge.result_scope)
                            for key in ordered if (edge := edges.get(key))]
                      for port, ordered in ports.items() if ordered}
            for card_id, ports in document.input_order.items() if any(ports.values())}


def _unique_description_names(cards, keep):
    """The newly extracted identity must not overwrite a same-named manual description."""
    occupied = {(card.type, card.name.strip()) for key, card in cards.items() if key in keep and isinstance(card, ObjectDescriptionCard)}
    for key, card in cards.items():
        if key in keep or not isinstance(card, ObjectDescriptionCard):
            continue
        name = card.name
        number = 2
        while (card.type, card.name.strip()) in occupied:
            card.name = f'{name[:240]}（{number}）'
            number += 1
        occupied.add((card.type, card.name.strip()))


def _invalidated_reference_outputs(cards):
    """A reference losing its name or image source no longer supplies those adopted outputs."""
    invalidated = set()
    for key, card in cards.items():
        if not isinstance(card, NamedImageReferenceCard):
            continue
        if card.name_binding and card.name_binding.card_id not in cards:
            invalidated.update((key, port) for port in card.output_ports)
        elif card.image_binding and card.image_binding.source and card.image_binding.source.card_id not in cards:
            invalidated.add((key, 'image'))
    return invalidated


def plan_application(current: CanvasDocument, candidate: CanvasDocument,
                     command: StoryboardApplication, *, prior: CanvasDocument | None = None,
                     production_ports: list[str] | None = None) -> tuple[CanvasDocument, StoryboardDiff]:
    """Resolve stable identities and preserve the actual document outside extraction ownership."""
    previous = {card.id: card for card in current.cards}
    incoming = {card.id: card for card in candidate.cards}
    previous_origins = current.storyboard.origins if current.storyboard else {}
    new_origins = candidate.storyboard.origins
    current_connections, prior_connections, proposed_connections = map(_connections, (current, prior, candidate))
    manual = {key for key, value in previous_origins.items() if key in previous and (
        value.manually_edited or prior is not None and current_connections.get(key) != prior_connections.get(key))}
    changed = {key for key in previous_origins if key in previous and (
        key not in new_origins or previous[key] != incoming[key] or
        previous_origins[key].model_dump(exclude={'manually_edited'}) != new_origins[key].model_dump(exclude={'manually_edited'}) or
        current_connections.get(key) != proposed_connections.get(key))}
    overwrite = set(command.overwrite_card_ids)
    if overwrite - (changed & manual):
        raise diagnostic('INVALID_OVERWRITE_CHOICE', '只可覆盖本次差异中的人工修改卡片', {'canvas_id': current.id})
    keep = (set(previous) - set(previous_origins)) | (manual - overwrite)
    final = {key: previous[key] if key in keep else incoming[key] for key in previous if key in keep or key in incoming}
    final.update((key, card) for key, card in incoming.items() if key not in previous)
    edges = [edge for edge in current.edges if edge.target_card in keep]
    edges += [edge for edge in candidate.edges if edge.target_card not in keep]
    origins = {**new_origins, **{key: origin for key, origin in previous_origins.items() if key in keep}}
    cited = {source.card_id for origin in origins.values() for source in origin.sources}
    cited.update(edge.source_card for edge in edges if edge.target_card in final)
    archives = [source for source in [current.fixed_source, *current.archived_sources] if source
                and source.card_id != candidate.fixed_source.card_id and source.card_id in cited]
    fixed_ids = {source.card_id for source in [current.fixed_source, *current.archived_sources] if source}
    archive_ids = {source.card_id for source in archives}
    final = {key: card for key, card in final.items() if key not in fixed_ids or key in archive_ids or key in incoming}
    lost = defaultdict(set)
    for edge in current.edges:
        if edge.target_card in keep and edge.target_card in final and edge.source_card not in final:
            lost[edge.target_card].add(edge.source_card)
        if edge.source_card in keep and edge.source_card in final and edge.target_card not in final:
            lost[edge.source_card].add(edge.target_card)
    final = {key: card.model_copy(deep=True) for key, card in final.items()}
    _unique_description_names(final, keep)
    expired = expired_reference_uses(current, candidate, keep, final)
    invalidated = _invalidated_reference_outputs(final)
    dropped_edges = {(binding.source.card_id, binding.source.port_id, model, binding.input_port)
                     for model, bindings in expired.items() for binding in bindings.values()}
    for key, card in final.items():
        if key in keep and key in origins:
            lost[key].update(source.card_id for source in origins[key].sources if source.card_id in previous and source.card_id not in final)
        lost[key].update(clean_lost_references(card, previous, final, current.id, expired.get(key), invalidated))
    for model in expired:
        dropped_edges.difference_update((binding.source.card_id, binding.source.port_id, model, binding.input_port)
                                        for binding in final[model].input_bindings)
    edges = [edge for edge in edges if edge.source_card in final and edge.target_card in final
             and (edge.source_card, edge.source_port, edge.target_card, edge.target_port) not in dropped_edges
             and (edge.source_card, edge.source_port) not in invalidated]
    live_edges = {edge.id for edge in edges}
    edges = [edge.model_copy(update={'order_anchor': None}) if edge.order_anchor and edge.order_anchor.edge_id not in live_edges
             else edge for edge in edges]
    order = {card_id: {port: [key for key in ids if key in live_edges] for port, ids in ports.items()}
             for card_id, ports in {**candidate.input_order,
                                   **{key: ports for key, ports in current.input_order.items() if key in keep}}.items()
             if card_id in final}
    generated_groups = {shot.group_id for shot in current.storyboard.shots} if current.storyboard else set()
    old_groups = {group.id: group for group in current.groups}
    groups = {key: group for key, group in old_groups.items() if key not in generated_groups}
    for group in candidate.groups:
        old = old_groups.get(group.id)
        extra = [key for key in old.card_ids if key in keep] if old else []
        groups[group.id] = (old or group).model_copy(update={'card_ids': list(dict.fromkeys([*group.card_ids, *extra]))})
    groups = [group.model_copy(update={'card_ids': [key for key in group.card_ids if key in final]})
              for group in groups.values()]
    shots = carry_reference_choices(current, candidate, final, keep, edges, order, production_ports or [], invalidated)
    document = current.model_copy(update={'cards': list(final.values()), 'edges': edges,
        'input_order': order, 'groups': [group for group in groups if group.card_ids],
        'storyboard': candidate.storyboard.model_copy(update={'origins': origins, 'shots': shots}),
        'fixed_source': candidate.fixed_source, 'archived_sources': archives})
    diff = StoryboardDiff(added=[_display(final[key]) for key in incoming if key not in previous],
        modified=[_display(card, manual=key in manual) for key, card in previous.items() if key in changed and key in incoming],
        removed=[_display(card, manual=key in manual) for key, card in previous.items() if key in changed and key not in incoming or key in fixed_ids and key not in final],
        orphaned=[_display(final[key], lost=[card_name(previous[target]) for target in sorted(targets) if target in previous])
                  for key, targets in lost.items() if targets],
        source_changed=current.fixed_source != candidate.fixed_source)
    return document, diff
