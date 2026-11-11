"""Merge a verified storyboard into the existing canvas by stable identity."""

from collections import defaultdict, deque

from app.core.contracts.directing.scene_storyboard import StoryboardApplication, StoryboardDiff, StoryboardDiffCard
from app.schemas.generation_canvas import CanvasDocument, NamedImageReferenceCard, ObjectDescriptionCard
from app.services.directing.storyboard_assembly import storyboard_design_stack_id
from app.services.directing.storyboard_continuity_choices import adopted_frames, carry_visual_continuity, non_continuity_edits
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


def _retain_edge_ids(current: CanvasDocument, candidate: CanvasDocument) -> CanvasDocument:
    """沿用完全相同连线的身份，避免兼容连线重建误触堆叠保护。"""
    incoming_ids = {edge.id for edge in candidate.edges}
    previous_ids = {edge.id for edge in current.edges}
    available = defaultdict(deque)
    for edge in current.edges:
        if edge.id not in incoming_ids:
            available[edge.model_dump_json(exclude={'id'})].append(edge.id)
    renamed = {}
    for edge in candidate.edges:
        matches = available.get(edge.model_dump_json(exclude={'id'}))
        if edge.id not in previous_ids and matches:
            renamed[edge.id] = matches.popleft()
    if not renamed:
        return candidate
    edges = []
    for edge in candidate.edges:
        anchor = edge.order_anchor
        if anchor and anchor.edge_id in renamed:
            anchor = anchor.model_copy(update={'edge_id': renamed[anchor.edge_id]})
        edges.append(edge.model_copy(update={'id': renamed.get(edge.id, edge.id), 'order_anchor': anchor}))
    order = {key: {port: [renamed.get(edge_id, edge_id) for edge_id in ids] for port, ids in ports.items()}
             for key, ports in candidate.input_order.items()}
    return candidate.model_copy(update={'edges': edges, 'input_order': order})


def plan_application(current: CanvasDocument, candidate: CanvasDocument,
                     command: StoryboardApplication, *, prior: CanvasDocument | None = None,
                     production_capability: dict | None = None) -> tuple[CanvasDocument, StoryboardDiff]:
    """Resolve stable identities and preserve the actual document outside extraction ownership."""
    candidate = _retain_edge_ids(current, candidate)
    previous = {card.id: card for card in current.cards}
    incoming = {card.id: card for card in candidate.cards}
    previous_origins = current.storyboard.origins if current.storyboard else {}
    new_origins = candidate.storyboard.origins
    current_connections, prior_connections, proposed_connections = map(_connections, (current, prior, candidate))
    manual = {key for key, value in previous_origins.items() if key in previous and (
        value.manually_edited or prior is not None and current_connections.get(key) != prior_connections.get(key))}
    adoption = adopted_frames(current, previous)
    manual.difference_update(set(adoption) - non_continuity_edits(current, prior, adoption))
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
    # Existing cards keep their current groups or their deliberate absence from one.
    groups = {group.id: group.model_copy(update={'card_ids': [key for key in group.card_ids if key in final]})
              for group in current.groups}
    existing_design_stacks = ({storyboard_design_stack_id(),
                               *(storyboard_design_stack_id(shot.shot_id) for shot in current.storyboard.shots)}
                              if current.storyboard else set())
    # 首次占位原文没有人工分组决定，沿用候选的公共组；既有组织保持原样。
    initial_source = (current.fixed_source.card_id if current.fixed_source and not current.storyboard
                      and not current.groups and len(current.cards) == 1 else None)
    for group in candidate.groups:
        # 既有镜头的新设计作为独立卡保留，即使原设计堆叠已经被解除。
        if group.kind == 'stack' and group.id in existing_design_stacks:
            continue
        new_members = [key for key in group.card_ids if key in final and (key not in previous or key == initial_source)]
        existing = groups.get(group.id)
        if new_members and (not existing or existing.kind != 'stack'):
            groups[group.id] = (existing or group).model_copy(update={
                'card_ids': [*(existing.card_ids if existing else []), *new_members],
            })
    capability = production_capability or {}
    shots = carry_reference_choices(current, candidate, final, keep, edges, order, capability.get('input_ports', []), invalidated)
    continuity, impacts = carry_visual_continuity(current, shots, previous, final, edges, order, adoption, capability)
    document = current.model_copy(update={'cards': list(final.values()), 'edges': edges,
        'input_order': order, 'groups': [group for group in groups.values() if group.card_ids],
        'storyboard': candidate.storyboard.model_copy(update={'origins': origins, 'shots': shots, 'visual_continuity': continuity}),
        'fixed_source': candidate.fixed_source, 'archived_sources': archives})
    diff = StoryboardDiff(added=[_display(final[key]) for key in incoming if key not in previous],
        modified=[_display(card, manual=key in manual) for key, card in previous.items() if key in changed and key in incoming],
        removed=[_display(card, manual=key in manual) for key, card in previous.items() if key in changed and key not in incoming or key in fixed_ids and key not in final],
        orphaned=[_display(final[key], lost=[card_name(previous[target]) for target in sorted(targets) if target in previous])
                  for key, targets in lost.items() if targets],
        source_changed=current.fixed_source != candidate.fixed_source, visual_continuity_impacts=impacts)
    return document, diff
