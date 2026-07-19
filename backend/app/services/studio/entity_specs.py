"""Studio 实体规格定义与类型归一化。"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException

from app.models.studio import (
    Actor,
    ActorImage,
    AssetViewAngle,
    Character,
    CharacterImage,
    Costume,
    CostumeImage,
    ProjectActorLink,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    PropImage,
    Scene,
    SceneImage,
)
from app.schemas.studio.assets import (
    AssetCreate,
    AssetImageCreate,
    AssetImageUpdate,
    AssetUpdate,
    CharacterImageRead,
    CostumeImageRead,
    PropImageRead,
    SceneImageRead,
)
from app.schemas.studio.cast import ActorCreate, ActorRead, ActorUpdate, CharacterCreate, CharacterRead, CharacterUpdate
from app.schemas.studio.cast_images import ActorImageCreate, ActorImageRead, ActorImageUpdate
from app.services.common import invalid_choice

DEFAULT_VIEW_ANGLES: tuple[AssetViewAngle, ...] = (
    AssetViewAngle.front,
    AssetViewAngle.left,
    AssetViewAngle.right,
    AssetViewAngle.back,
)

LINK_MODEL_BY_ENTITY: dict[str, tuple[type, str]] = {
    "actor": (ProjectActorLink, "actor_id"),
    "scene": (ProjectSceneLink, "scene_id"),
    "prop": (ProjectPropLink, "prop_id"),
    "costume": (ProjectCostumeLink, "costume_id"),
}


@dataclass(frozen=True)
class EntitySpec:
    model: type
    image_model: type
    id_field: str
    read_model: type | None
    create_model: type
    update_model: type
    image_read_model: type
    image_create_model: type
    image_update_model: type


def normalize_entity_type(entity_type: str) -> str:
    value = entity_type.strip().lower()
    if value not in {"actor", "character", "scene", "prop", "costume"}:
        raise HTTPException(
            status_code=400,
            detail=invalid_choice("entity_type", ["actor", "character", "scene", "prop", "costume"]),
        )
    return value


def entity_spec(entity_type: str) -> EntitySpec:
    entity_type_norm = normalize_entity_type(entity_type)
    if entity_type_norm == "actor":
        return EntitySpec(
            model=Actor,
            image_model=ActorImage,
            id_field="actor_id",
            read_model=ActorRead,
            create_model=ActorCreate,
            update_model=ActorUpdate,
            image_read_model=ActorImageRead,
            image_create_model=ActorImageCreate,
            image_update_model=ActorImageUpdate,
        )
    if entity_type_norm == "character":
        return EntitySpec(
            model=Character,
            image_model=CharacterImage,
            id_field="character_id",
            read_model=CharacterRead,
            create_model=CharacterCreate,
            update_model=CharacterUpdate,
            image_read_model=CharacterImageRead,
            image_create_model=AssetImageCreate,
            image_update_model=AssetImageUpdate,
        )
    if entity_type_norm == "scene":
        return EntitySpec(
            model=Scene,
            image_model=SceneImage,
            id_field="scene_id",
            read_model=None,
            create_model=AssetCreate,
            update_model=AssetUpdate,
            image_read_model=SceneImageRead,
            image_create_model=AssetImageCreate,
            image_update_model=AssetImageUpdate,
        )
    if entity_type_norm == "prop":
        return EntitySpec(
            model=Prop,
            image_model=PropImage,
            id_field="prop_id",
            read_model=None,
            create_model=AssetCreate,
            update_model=AssetUpdate,
            image_read_model=PropImageRead,
            image_create_model=AssetImageCreate,
            image_update_model=AssetImageUpdate,
        )
    return EntitySpec(
        model=Costume,
        image_model=CostumeImage,
        id_field="costume_id",
        read_model=None,
        create_model=AssetCreate,
        update_model=AssetUpdate,
        image_read_model=CostumeImageRead,
        image_create_model=AssetImageCreate,
        image_update_model=AssetImageUpdate,
    )
