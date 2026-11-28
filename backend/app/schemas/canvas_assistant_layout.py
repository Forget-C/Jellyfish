"""Browser-local layout proposals and their editor receipts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

CardId = Annotated[str, StringConstraints(min_length=1, max_length=64)]
Coordinate = Annotated[float, Field(ge=-1000000, le=1000000)]


class CanvasAssistantPoint(BaseModel):
    model_config = ConfigDict(extra='forbid')

    x: Coordinate
    y: Coordinate


class MoveCanvasCards(BaseModel):
    model_config = ConfigDict(extra='forbid')

    kind: Literal['move']
    positions: dict[CardId, CanvasAssistantPoint] = Field(min_length=1, max_length=100)


class ArrangeCanvasCards(BaseModel):
    model_config = ConfigDict(extra='forbid')

    kind: Literal['arrange']


CanvasAssistantPlacement = Annotated[MoveCanvasCards | ArrangeCanvasCards, Field(discriminator='kind')]


class CanvasAssistantGrouping(BaseModel):
    id: str
    name: str
    card_ids: list[str]


class CanvasAssistantLayout(BaseModel):
    """A proposal reserves no document edit or layout until the editor applies it."""

    state: Literal['proposed', 'waiting', 'executing', 'applied', 'stale', 'rejected'] = 'proposed'
    before: dict[str, CanvasAssistantPoint]
    group_membership: dict[str, str | None]
    placement: CanvasAssistantPlacement | None = None
    group: CanvasAssistantGrouping | None = None


class CanvasAssistantLayoutDecision(BaseModel):
    """Approve or decline a proposal, or return an editor execution result."""

    action: Literal['approve', 'reject', 'claim', 'applied', 'stale']
