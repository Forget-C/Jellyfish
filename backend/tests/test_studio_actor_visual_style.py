"""Actor visual_style schema regression tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.studio import ProjectVisualStyle
from app.schemas.studio.assets import AssetCreate, AssetUpdate
from app.schemas.studio.cast import ActorCreate, ActorRead, ActorUpdate
from app.schemas.studio.cast import CharacterCreate, CharacterRead, CharacterUpdate


def test_actor_create_default_visual_style() -> None:
    payload = ActorCreate(
        id="actor_1",
        name="Actor 1",
        supplementary_info="",
        tags=[],
        prompt_template_id=None,
        view_count=1,
        visual_style=ProjectVisualStyle.live_action,
    )
    assert payload.visual_style == ProjectVisualStyle.live_action


def test_actor_create_with_visual_style_anime() -> None:
    payload = ActorCreate(
        id="actor_2",
        name="Actor 2",
        supplementary_info="",
        tags=[],
        prompt_template_id=None,
        view_count=1,
        visual_style=ProjectVisualStyle.anime,
    )
    assert payload.visual_style == ProjectVisualStyle.anime


def test_actor_update_accepts_visual_style() -> None:
    payload = ActorUpdate(
        name=None,
        supplementary_info="",
        tags=None,
        prompt_template_id=None,
        view_count=None,
        visual_style=ProjectVisualStyle.anime,
    )
    assert payload.visual_style == ProjectVisualStyle.anime


def test_actor_read_keeps_visual_style() -> None:
    payload = ActorRead(
        id="actor_3",
        name="Actor 3",
        description="",
        tags=[],
        prompt_template_id=None,
        view_count=1,
        visual_style=ProjectVisualStyle.live_action,
        thumbnail="",
    )
    assert payload.visual_style == ProjectVisualStyle.live_action


def test_actor_create_rejects_invalid_visual_style() -> None:
    with pytest.raises(ValidationError):
        ActorCreate(
            id="actor_4",
            name="Actor 4",
            description="",
            tags=[],
            prompt_template_id=None,
            view_count=1,
            visual_style="invalid",  # type: ignore[arg-type]
        )


def test_asset_create_default_visual_style() -> None:
    payload = AssetCreate(
        id="scene_1",
        name="Scene 1",
        description="",
        tags=[],
        prompt_template_id=None,
        view_count=1,
        visual_style=ProjectVisualStyle.live_action,
    )
    assert payload.visual_style == ProjectVisualStyle.live_action


def test_asset_update_accepts_visual_style() -> None:
    payload = AssetUpdate(
        name=None,
        description=None,
        tags=None,
        prompt_template_id=None,
        view_count=None,
        visual_style=ProjectVisualStyle.anime,
    )
    assert payload.visual_style == ProjectVisualStyle.anime


def test_character_create_and_read_visual_style() -> None:
    created = CharacterCreate(
        id="character_1",
        project_id="project_1",
        name="Character 1",
        description="",
        visual_style=ProjectVisualStyle.anime,
        actor_id=None,
        costume_id=None,
    )
    assert created.visual_style == ProjectVisualStyle.anime

    read_payload = CharacterRead(
        id="character_1",
        project_id="project_1",
        name="Character 1",
        description="",
        visual_style=ProjectVisualStyle.anime,
        actor_id=None,
        costume_id=None,
        thumbnail="",
    )
    assert read_payload.visual_style == ProjectVisualStyle.anime


def test_character_update_accepts_visual_style() -> None:
    payload = CharacterUpdate(
        project_id=None,
        name=None,
        description=None,
        visual_style=ProjectVisualStyle.live_action,
        actor_id=None,
        costume_id=None,
    )
    assert payload.visual_style == ProjectVisualStyle.live_action


