from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from app.models.studio import (
    Actor,
    ActorImage,
    AssetViewAngle,
    Character,
    Costume,
    CostumeImage,
    PromptCategory,
    Prop,
    PropImage,
    Scene,
    SceneImage,
)
from app.services.common import entity_not_found
from app.services.studio.generation.shared.types import GenerationBaseDraft
from app.services.studio.image_task_references import (
    pick_front_ref_file_id,
    pick_ordered_ref_file_ids,
)
from app.services.studio.image_task_validation import (
    validate_actor_image,
    validate_asset_image_and_relation_type,
    validate_character_image,
)
from app.services.studio.image_tasks import (
    asset_prompt_category,
    build_prompt_with_template,
    is_front_view,
    map_view_angle_for_prompt,
)


class AssetImageBaseDraft(GenerationBaseDraft):
    """资产图片生成的基础真值。"""

    kind: str = "asset_image"
    entity_type: str
    entity_id: str
    image_id: int
    relation_type: str
    relation_entity_id: str
    prompt: str
    default_images: list[str]


PROMPT_VALUE_LABELS = {
    "现实": "realistic live-action",
    "动漫": "anime",
    "真人都市": "live-action urban drama",
    "真人科幻": "live-action science fiction",
    "真人古装": "live-action period drama",
    "动漫科幻": "anime science fiction",
    "动漫3D": "3D anime",
    "国漫": "Chinese animation",
    "水墨画": "ink wash painting",
}


def _enum_value(value: Any) -> str:
    raw = getattr(value, "value", value)
    text = str(raw or "")
    return PROMPT_VALUE_LABELS.get(text, text)


async def _build_asset_prompt(
    db,
    *,
    relation_type: str,
    name: str,
    description: str,
    tags: list[str] | None,
    visual_style: Any,
    style: Any,
    image_row: Any,
) -> str:
    category = asset_prompt_category(
        relation_type=relation_type,
        is_front_view=is_front_view(image_row.view_angle),
    )
    return await build_prompt_with_template(
        db,
        category=category,
        variables={
            "name": name,
            "description": description,
            "tags": ", ".join(tags or []),
            "visual_style": _enum_value(visual_style),
            "style": _enum_value(style),
            "view_angle": map_view_angle_for_prompt(image_row.view_angle),
            "quality_level": image_row.quality_level,
            "format": image_row.format,
        },
        fallback_prompt=description,
        not_found_msg=f"{relation_type}.description is empty",
    )


async def _resolve_front_ref(
    db,
    *,
    image_model,
    parent_field_name: str,
    parent_id: str,
    preferred_quality_level: str | None,
) -> list[str]:
    file_id = await pick_front_ref_file_id(
        db,
        image_model=image_model,
        parent_field_name=parent_field_name,
        parent_id=parent_id,
        preferred_quality_level=preferred_quality_level,
    )
    return [file_id] if file_id else []


async def build_actor_image_base_draft(
    db,
    *,
    actor_id: str,
    image_id: int | None,
) -> AssetImageBaseDraft:
    actor = await db.get(Actor, actor_id)
    if actor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Actor"))
    image_row = await validate_actor_image(db, actor_id=actor_id, image_id=image_id)
    prompt = await _build_asset_prompt(
        db,
        relation_type="actor_image",
        name=actor.name,
        description=actor.description,
        tags=actor.tags,
        visual_style=actor.visual_style,
        style=actor.style,
        image_row=image_row,
    )
    refs = []
    if not is_front_view(image_row.view_angle):
        refs = await _resolve_front_ref(
            db,
            image_model=ActorImage,
            parent_field_name="actor_id",
            parent_id=actor_id,
            preferred_quality_level=image_row.quality_level,
        )
    return AssetImageBaseDraft(
        entity_type="actor",
        entity_id=actor_id,
        image_id=image_row.id,
        relation_type="actor_image",
        relation_entity_id=str(image_row.id),
        prompt=prompt,
        default_images=refs,
    )


async def build_asset_image_base_draft(
    db,
    *,
    asset_type: str,
    asset_id: str,
    image_id: int | None,
) -> AssetImageBaseDraft:
    relation_entity_id, relation_type = await validate_asset_image_and_relation_type(
        db,
        asset_type=asset_type,
        asset_id=asset_id,
        image_id=image_id,
    )
    asset_type_norm = asset_type.strip().lower()
    refs: list[str] = []
    if asset_type_norm == "prop":
        asset = await db.get(Prop, asset_id)
        image_row = await db.get(PropImage, relation_entity_id)
        image_model = PropImage
        parent_field_name = "prop_id"
    elif asset_type_norm == "scene":
        asset = await db.get(Scene, asset_id)
        image_row = await db.get(SceneImage, relation_entity_id)
        image_model = SceneImage
        parent_field_name = "scene_id"
    else:
        asset = await db.get(Costume, asset_id)
        image_row = await db.get(CostumeImage, relation_entity_id)
        image_model = CostumeImage
        parent_field_name = "costume_id"
    if asset is None or image_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("AssetImage"))
    prompt = await _build_asset_prompt(
        db,
        relation_type=relation_type,
        name=asset.name,
        description=asset.description,
        tags=asset.tags,
        visual_style=asset.visual_style,
        style=asset.style,
        image_row=image_row,
    )
    if not is_front_view(image_row.view_angle):
        refs = await _resolve_front_ref(
            db,
            image_model=image_model,
            parent_field_name=parent_field_name,
            parent_id=asset_id,
            preferred_quality_level=image_row.quality_level,
        )
    return AssetImageBaseDraft(
        entity_type=asset_type.strip().lower(),
        entity_id=asset_id,
        image_id=relation_entity_id,
        relation_type=relation_type,
        relation_entity_id=str(relation_entity_id),
        prompt=prompt,
        default_images=refs,
    )


async def build_character_image_base_draft(
    db,
    *,
    character_id: str,
    image_id: int | None,
) -> AssetImageBaseDraft:
    character = await db.get(Character, character_id)
    if character is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Character"))
    image_row = await validate_character_image(db, character_id=character_id, image_id=image_id)
    prompt = await build_prompt_with_template(
        db,
        category=PromptCategory.combined,
        variables={
            "name": character.name,
            "description": character.description,
            "visual_style": _enum_value(character.visual_style),
            "style": _enum_value(character.style),
            "view_angle": map_view_angle_for_prompt(image_row.view_angle),
            "quality_level": image_row.quality_level,
            "format": image_row.format,
        },
        fallback_prompt=character.description,
        not_found_msg="Character.description is empty",
    )
    refs: list[str] = []
    default_view_angles: tuple[AssetViewAngle, ...] = (
        AssetViewAngle.front,
        AssetViewAngle.left,
        AssetViewAngle.right,
        AssetViewAngle.back,
    )
    if character.actor_id:
        refs.extend(
            await pick_ordered_ref_file_ids(
                db,
                image_model=ActorImage,
                parent_field_name="actor_id",
                parent_id=character.actor_id,
                view_angles=default_view_angles,
            )
        )
    if character.costume_id:
        refs.extend(
            await pick_ordered_ref_file_ids(
                db,
                image_model=CostumeImage,
                parent_field_name="costume_id",
                parent_id=character.costume_id,
                view_angles=default_view_angles,
            )
        )
    return AssetImageBaseDraft(
        entity_type="character",
        entity_id=character_id,
        image_id=image_row.id,
        relation_type="character_image",
        relation_entity_id=str(image_row.id),
        prompt=prompt,
        default_images=refs,
    )
