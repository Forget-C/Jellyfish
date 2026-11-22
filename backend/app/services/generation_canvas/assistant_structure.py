"""Build and apply typed grouped card and reference proposals."""

import hashlib
import json
from uuid import uuid4

from fastapi import HTTPException
from langchain_core.tools import ToolException, tool

from app.core.contracts.generation_canvas import InputBinding, MovementDesignFields, OutputIdentity, ReferenceDesignField
from app.schemas.canvas_assistant_edit import CanvasAssistantChange, CanvasAssistantEditGroup, CanvasAssistantProposal
from app.schemas.canvas_assistant_structure import (
    AddCanvasCardTarget, AddModelCard, AddMovementCard, AddTextCard, AdoptFirstFrame, AdoptFirstFrameTarget,
    AdjustShotMovement, AdjustShotMovementTarget,
    ProposedStructure, ReplaceFirstFrame,
)
from app.schemas.generation_canvas import (
    CanvasDocument, GenerationCanvasEdge, ImageContentCard, ImageModelCard, MovementCard, PromptDocument,
    PromptInstruction, PromptReference, PromptText, TextContentCard, TextModelCard, VideoModelCard,
)
from app.services.generation_canvas.assistant_media import resolve_assistant_media
from app.services.generation_canvas.assistant_movement import apply_shot_movement, preview_shot_movement
from app.services.generation_canvas.allowed_cards import FREE_CARD_TYPES
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.catalog import CARD_TITLES


def _card_configuration(operation, card_id):
    if isinstance(operation, AddTextCard):
        return TextContentCard(id=card_id, text=operation.text), operation.text
    if isinstance(operation, AddMovementCard):
        speed = ReferenceDesignField(text=operation.movement_speed, authorship='user' if operation.movement_speed else 'unknown')
        card = MovementCard(id=card_id, fields=MovementDesignFields(movement_speed=speed))
        return card, operation.movement_speed
    if isinstance(operation, AddModelCard):
        card_class = {'text': TextModelCard, 'image': ImageModelCard, 'video': VideoModelCard}[operation.modality]
        segments = [PromptText(id=card_id, kind='text', text=operation.prompt)] if operation.prompt else []
        return card_class(id=card_id, prompt=PromptDocument(segments=segments)), operation.prompt
    raise ValueError('Unsupported assistant card operation')


def _has_first_frame(card: VideoModelCard) -> bool:
    return any(_first_frame_parts(card))


def _first_frame_parts(card: VideoModelCard):
    bindings = [item for item in card.input_bindings if item.input_port == 'first_frame']
    commands = [part for part in card.prompt.segments
                if isinstance(part, PromptInstruction) and part.command == '首帧参考']
    design = [item for item in card.design_media_uses if item.input_port == 'first_frame']
    return bindings, commands, design


def _first_frame_basis(card: VideoModelCard) -> str:
    entries = [[item.model_dump(mode='json') for item in group] for group in _first_frame_parts(card)]
    return hashlib.sha256(json.dumps([card.model_id, entries], sort_keys=True).encode()).hexdigest()


def _replaceable_first_frame(card: VideoModelCard):
    bindings, commands, design = _first_frame_parts(card)
    if len(bindings) != 1 or len(commands) > 1 or design:
        return None
    binding, = bindings
    if commands and [item.binding_id for item in commands[0].references] != [binding.id]:
        return None
    for part in card.prompt.segments:
        if part in commands:
            continue
        refs = [part] if isinstance(part, PromptReference) else part.references if isinstance(part, PromptInstruction) else ()
        if any(item.binding_id == binding.id for item in refs):
            return None
    return binding


def structural_preview_tool(draft, kind: str, sources):
    """Expose one read-only preview over the catalog and attached reference files."""
    @tool
    def propose_canvas_structure(change: ProposedStructure) -> str:
        """Preview explicit card creation or first-frame use. Choose replace_first_frame only when explicitly requested."""
        if draft.proposal:
            raise ToolException('A preview has already been prepared for this turn')
        if isinstance(change, AdjustShotMovement):
            if kind == 'free':
                raise ToolException('当前画布不允许修改设计卡')
            preview = preview_shot_movement(draft, change)
            title = '只修改所选镜头的运镜'
        elif isinstance(change, AdoptFirstFrame):
            media = sources.get(change.file_id)
            if media is None or media.file_type != 'image':
                raise ToolException('Choose an image attached to this message')
            saved = draft.saved_cards.get(change.card_id)
            if not isinstance(saved, VideoModelCard) or draft.cards[saved.id]['type'] != saved.type:
                raise ToolException('Choose a video model card in the current scope')
            target = VideoModelCard.model_validate(draft.cards[saved.id])
            replaced = _replaceable_first_frame(target) if isinstance(change, ReplaceFirstFrame) else None
            if not target.model_id:
                raise ToolException('Choose a video model before adopting a first frame')
            if isinstance(change, ReplaceFirstFrame) and not replaced:
                raise ToolException('Select a video model with one independent first-frame use to replace')
            if not replaced and _has_first_frame(target):
                raise ToolException('Select a video model with a vacant first frame')
            preview = CanvasAssistantChange(
                card_id=target.id, card_name=CARD_TITLES[target.type], after=media.name,
                before=replaced.source.card_id if replaced else '',
                target=AdoptFirstFrameTarget(kind='adopt_first_frame', file_id=media.file_id, file_name=media.name,
                    reference_card_id=uuid4().hex, edge_id=uuid4().hex, basis=_first_frame_basis(target),
                    replaces_binding_id=replaced.id if replaced else None),
            )
            title = '建卡、连线并更换首帧' if replaced else '建卡、连线并采用首帧'
        else:
            card, text = _card_configuration(change, uuid4().hex)
            if kind == 'free' and card.type not in FREE_CARD_TYPES:
                raise ToolException(f'当前画布不允许创建 {CARD_TITLES[card.type]}')
            preview = CanvasAssistantChange(
                card_id=card.id, card_name=CARD_TITLES[card.type], before='', after=text,
                target=AddCanvasCardTarget(kind='add_canvas_card', card=change),
            )
            title = '新建' + preview.card_name
        draft.proposal = CanvasAssistantProposal(
            **preview.model_dump(), groups=[CanvasAssistantEditGroup(id='1', title=title, edits=[preview])],
        )
        return draft.proposal.model_dump_json()

    propose_canvas_structure.handle_tool_error = True
    propose_canvas_structure.handle_validation_error = True
    return propose_canvas_structure


async def apply_structural_change(store, canvas, document: CanvasDocument, edit: CanvasAssistantChange) -> bool:
    """Apply a structural edit to a tentative document after checking its current basis."""
    change = edit.target
    if isinstance(change, AdjustShotMovementTarget):
        return apply_shot_movement(canvas, document, edit, change)
    existing = {card.id: card for card in document.cards}
    if isinstance(change, AddCanvasCardTarget):
        card, _ = _card_configuration(change.card, edit.card_id)
        if card.id in existing or card.id in canvas.card_types:
            return False
        document.cards.append(card)
        return True
    video = existing.get(edit.card_id)
    if (not isinstance(change, AdoptFirstFrameTarget) or not isinstance(video, VideoModelCard)
            or change.reference_card_id in existing or change.reference_card_id in canvas.card_types
            or not await _first_frame_matches(store, video, change)):
        return False
    sources = await resolve_assistant_media(store.db, store.project_id, [change.file_id], lock=True)
    media = sources.get(change.file_id)
    if media is None or media.file_type != 'image':
        return False
    _bind_first_frame(document, video, change)
    return True


async def _first_frame_matches(store, video: VideoModelCard, change: AdoptFirstFrameTarget) -> bool:
    if not video.model_id or _first_frame_basis(video) != change.basis:
        return False
    if change.replaces_binding_id:
        replaced = _replaceable_first_frame(video)
        if not replaced or replaced.id != change.replaces_binding_id:
            return False
    elif _has_first_frame(video):
        return False
    try:
        capability = await model_capability(store.db, video.model_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        return False
    return capability.modality == 'video' and 'first_frame' in capability.input_ports


def _bind_first_frame(document: CanvasDocument, video: VideoModelCard, change: AdoptFirstFrameTarget) -> None:
    document.cards.append(ImageContentCard(id=change.reference_card_id, file_id=change.file_id))
    document.edges.append(GenerationCanvasEdge(id=change.edge_id, source_card=change.reference_card_id,
        source_port='image', target_card=video.id, target_port='first_frame'))
    document.input_order.setdefault(video.id, {}).setdefault('first_frame', []).append(change.edge_id)
    source = OutputIdentity(canvas_id=document.id, card_id=change.reference_card_id, port_id='image', position=0)
    if change.replaces_binding_id:
        video.input_bindings = [binding for binding in video.input_bindings if binding.id != change.replaces_binding_id]
        video.prompt.segments = [part for part in video.prompt.segments
                                 if not isinstance(part, PromptInstruction) or part.command != '首帧参考']
    video.input_bindings.append(InputBinding(id=change.edge_id, source=source, input_port='first_frame'))
    video.prompt.segments.append(PromptInstruction(id=f'{change.edge_id}:frame', kind='instruction', command='首帧参考',
        references=[PromptReference(id=f'{change.edge_id}:source', kind='reference', binding_id=change.edge_id)]))
