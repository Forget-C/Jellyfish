"""Structured video writing output uses only identifiers offered by the server."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class StoryboardPromptPart(BaseModel):
    """A literal instruction or a reference to an offered input binding."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['text', 'reference']
    text: str = ''
    binding_id: str | None = None


class StoryboardPromptDesign(BaseModel):
    """One adopted design is incorporated in prose, referenced, or attached."""
    model_config = ConfigDict(extra='forbid')
    card_id: str
    placement: Literal['body', 'reference', 'before', 'after']


class StoryboardPromptOutput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    segments: list[StoryboardPromptPart] = Field(min_length=1)
    designs: list[StoryboardPromptDesign]


class GeneratedVideoPrompt(BaseModel):
    """Prompt placements written by storyboard generation for a video model card."""
    version: Literal[1] = 1
    designs: list[StoryboardPromptDesign] = Field(default_factory=list)
    edit_confirmed: bool = False
