"""Snapshot and apply the impact of narrowly typed assistant removals."""

from hashlib import sha256
import json

from app.schemas.canvas_assistant_edit import (
    CanvasAssistantRemovalTarget, DeleteCardEdit, DisconnectCardsEdit, ReleaseBindingEdit,
)
from app.schemas.generation_canvas import CanvasDocument, ModelCard, PromptInstruction, PromptReference


def removal_impact(document: CanvasDocument, card_id: str, target: CanvasAssistantRemovalTarget) -> tuple[str, str] | None:
    """Return the preview label and a digest of affected saved content."""
    card = next((item for item in document.cards if item.id == card_id), None)
    if card is None:
        return None
    if isinstance(target, DisconnectCardsEdit):
        edge = next((item for item in document.edges if item.id == target.edge_id and item.target_card == card_id), None)
        if edge is None or any(
            binding.source.card_id == edge.source_card and binding.source.port_id == edge.source_port
            and binding.input_port == edge.target_port and binding.source.canvas_id in (None, document.id)
            for binding in getattr(card, 'input_bindings', [])
        ):
            return None
        anchored = [item.model_dump(mode='json') for item in document.edges
                    if item.order_anchor and item.order_anchor.edge_id == edge.id]
        impact = [edge.model_dump(mode='json'), anchored, document.input_order.get(card_id, {}).get(edge.target_port)]
        label = f'{edge.source_card} · {edge.source_port} → {edge.target_port}'
    elif isinstance(target, ReleaseBindingEdit):
        binding = next((item for item in getattr(card, 'input_bindings', []) if item.id == target.binding_id), None)
        if binding is None:
            return None
        linked_edges = [edge.model_dump(mode='json') for edge in document.edges
                        if edge.target_card == card_id and edge.source_card == binding.source.card_id]
        impact = [card.model_dump(mode='json'), linked_edges]
        label = f'{binding.input_port} · {binding.source.card_id} · {binding.id}'
    else:
        if (document.fixed_source and document.fixed_source.card_id == card_id
                or any(source.card_id == card_id for source in document.archived_sources)):
            return None
        if any(binding.source.card_id == card_id for other in document.cards if other.id != card_id
               for binding in getattr(other, 'input_bindings', [])):
            return None
        edges = [edge.model_dump(mode='json') for edge in document.edges
                 if card_id in (edge.source_card, edge.target_card)]
        groups = [group.model_dump(mode='json') for group in document.groups if card_id in group.card_ids]
        impact = [card.model_dump(mode='json'), edges, groups]
        label = f'{len(edges)} 条相邻连接 · {len(groups)} 个编组'
    return label, sha256(json.dumps(impact, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def apply_removal(document: CanvasDocument, card_id: str, target: CanvasAssistantRemovalTarget) -> None:
    """Update references for the approved change and leave canonical save validation in charge."""
    if isinstance(target, DeleteCardEdit):
        affected = {edge.id for edge in document.edges if card_id in (edge.source_card, edge.target_card)}
        document.cards = [card for card in document.cards if card.id != card_id]
        _remove_edges(document, affected)
        document.input_order.pop(card_id, None)
        for group in document.groups:
            group.card_ids = [value for value in group.card_ids if value != card_id]
        document.groups = [group for group in document.groups if group.card_ids]
        return

    if isinstance(target, DisconnectCardsEdit):
        _remove_edges(document, {target.edge_id})
        return

    card = next(item for item in document.cards if item.id == card_id)
    if isinstance(card, ModelCard):
        for segment in card.prompt.segments:
            if isinstance(segment, PromptInstruction):
                segment.references = [ref for ref in segment.references if ref.binding_id != target.binding_id]
        card.prompt.segments = [segment for segment in card.prompt.segments
                                if not isinstance(segment, PromptReference) or segment.binding_id != target.binding_id]
    if hasattr(card, 'frame_targets'):
        card.frame_targets = [entry for entry in card.frame_targets if entry.binding_id != target.binding_id]
    card.input_bindings = [item for item in card.input_bindings if item.id != target.binding_id]



def _remove_edges(document: CanvasDocument, affected: set[str]) -> None:
    document.edges = [edge for edge in document.edges if edge.id not in affected]
    for edge in document.edges:
        if edge.order_anchor and edge.order_anchor.edge_id in affected:
            edge.order_anchor = None
    for ports in document.input_order.values():
        for port, entries in ports.items():
            ports[port] = [edge_id for edge_id in entries if edge_id not in affected]
