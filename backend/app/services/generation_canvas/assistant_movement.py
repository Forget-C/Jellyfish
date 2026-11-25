"""Prepare shot-local edits using the design a video card actually adopts."""

from dataclasses import dataclass
import hashlib
import json
from uuid import uuid4

from langchain_core.tools import ToolException

from app.core.contracts.generation_canvas import InputBinding, ReferenceDesignField
from app.schemas.canvas_assistant_edit import CanvasAssistantChange
from app.schemas.canvas_assistant_structure import AdjustShotMovement, AdjustShotMovementTarget
from app.schemas.canvas_edit_intents import CanvasEditIntent
from app.schemas.generation_canvas import CanvasDocument, GenerationCanvasEdge, MovementCard, VideoModelCard
from app.services.generation_canvas.design_references import design_field_references


@dataclass(frozen=True, slots=True)
class MovementImpact:
    """The adopted source, its edit basis and protected downstream card identities."""

    card: MovementCard
    binding: InputBinding
    edge: GenerationCanvasEdge
    field: ReferenceDesignField
    other_consumers: list[str]
    basis: str


def _reads_movement(card, canvas_id: str, movement_id: str) -> bool:
    sources = [binding.source for binding in getattr(card, 'input_bindings', ())]
    sources.extend(reference.source for reference, _, _ in design_field_references(card, effective=True))
    frame_target = getattr(card, 'frame_target', None)
    return (bool(frame_target and frame_target.card_id == movement_id)
            or any(source.canvas_id == canvas_id and source.card_id == movement_id for source in sources))


def _movement_impact(document: CanvasDocument, video_id: str, field_name: str) -> MovementImpact | None:
    cards = {card.id: card for card in document.cards}
    video = cards.get(video_id)
    if not isinstance(video, VideoModelCard):
        return None
    bindings = [binding for binding in video.input_bindings
                if binding.input_port == 'text' and binding.source.canvas_id == document.id
                and binding.source.port_id == 'text' and isinstance(cards.get(binding.source.card_id), MovementCard)]
    if len(bindings) != 1:
        return None
    binding, = bindings
    card = cards[binding.source.card_id]
    field = getattr(card.fields, field_name)
    edges = [edge for edge in document.edges if edge.source_card == card.id and edge.source_port == 'text'
             and edge.target_card == video_id and edge.target_port == 'text']
    if len(edges) != 1 or field.document is not None:
        return None
    edge, = edges
    others = sorted(item.id for item in document.cards if item.id != video_id and
                    _reads_movement(item, document.id, card.id))
    snapshot = [binding.model_dump(mode='json'), edge.model_dump(mode='json'), others]
    if others:
        snapshot.extend([card.model_dump(mode='json'),
                         [_edge.model_dump(mode='json') for _edge in document.edges if _edge.target_card == card.id],
                         document.input_order.get(card.id)])
    else:
        snapshot.append(field.model_dump(mode='json'))
    basis = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return MovementImpact(card, binding, edge, field, others, basis)


def preview_shot_movement(draft, change: AdjustShotMovement) -> CanvasAssistantChange:
    """Find the unique saved movement source behind a locked video target."""
    impact = _movement_impact(draft.visible_document, change.card_id, change.field)
    if not isinstance(draft.saved_cards.get(change.card_id), VideoModelCard) or not impact:
        raise ToolException('选择实际只采用一张运镜卡的视频卡。没有已采用运镜时可以预览修改视频提示词。')
    if impact.field.text == change.text:
        raise ToolException('运镜字段已经是该值')
    return CanvasAssistantChange(
        card_id=change.card_id, card_name='视频模型卡', before=impact.field.text, after=change.text,
        target=AdjustShotMovementTarget(
            kind='adjust_shot_movement', movement_field=change.field, movement_card_id=impact.card.id,
            binding_id=impact.binding.id, connection_id=impact.edge.id, basis=impact.basis,
            other_consumer_ids=impact.other_consumers, copy_card_id=uuid4().hex if impact.other_consumers else None,
        ),
    )


def movement_basis_matches(document: CanvasDocument, card_id: str, target: AdjustShotMovementTarget) -> bool:
    """Check the approved source and dependent card identities without applying changes."""
    impact = _movement_impact(document, card_id, target.movement_field)
    return bool(impact and impact.basis == target.basis)


def apply_shot_movement(canvas, document: CanvasDocument, edit: CanvasEditIntent,
                        target: AdjustShotMovementTarget) -> bool:
    """Recheck the source and sharing before applying one indivisible change."""
    impact = _movement_impact(document, edit.card_id, target.movement_field)
    if not impact or impact.basis != target.basis or canvas.kind == 'free':
        return False
    card = impact.card
    if target.copy_card_id:
        if target.copy_card_id in canvas.card_types or any(item.id == target.copy_card_id for item in document.cards):
            return False
        card = _isolate_movement(document, impact, target.copy_card_id)
    field = getattr(card.fields, target.movement_field)
    field.text = edit.after
    field.authorship = 'user'
    field.extraction_context = None
    field.extraction_reason = None
    return True


def _isolate_movement(document: CanvasDocument, impact: MovementImpact, copy_id: str) -> MovementCard:
    """Duplicate adopted inputs and move only the selected video's connection."""
    original = impact.card
    clone = original.model_copy(deep=True, update={'id': copy_id})
    document.cards.append(clone)
    incoming = {edge.id: edge for edge in document.edges if edge.target_card == original.id}
    ids = {edge_id: hashlib.sha256(f'{copy_id}:{edge_id}'.encode()).hexdigest()[:48] for edge_id in incoming}
    for edge_id, edge in incoming.items():
        anchor = edge.order_anchor
        clone_anchor = anchor.model_copy(update={'edge_id': ids[anchor.edge_id]}) if anchor and anchor.edge_id in ids else None
        document.edges.append(edge.model_copy(update={'id': ids[edge_id], 'target_card': copy_id,
                                                       'order_anchor': clone_anchor}))
    if incoming:
        document.input_order[copy_id] = {port: [ids[edge_id] for edge_id in order]
                                         for port, order in document.input_order[original.id].items()}
    impact.binding.source = impact.binding.source.model_copy(update={'card_id': copy_id})
    impact.edge.source_card = copy_id
    return clone
