"""实体名称存在性检测服务。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import (
    Character,
    Costume,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    Scene,
)


async def check_names_existence(
    db: AsyncSession,
    *,
    project_id: str,

    character_names: list[str],
    prop_names: list[str],
    scene_names: list[str],
    costume_names: list[str],
) -> dict[str, list[dict[str, Any]]]:
    """批量检测名称是否存在，并返回项目关联状态。"""

    async def _find_character_id(q: str) -> str | None:
        stmt = (
            select(Character.id)
            .where(Character.project_id == project_id, Character.name.ilike(f"%{q}%"))
            .limit(1)
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        return str(row) if row is not None else None

    async def _find_asset_id(model: type, q: str) -> str | None:
        stmt = select(getattr(model, "id")).where(getattr(model, "name").ilike(f"%{q}%")).limit(1)
        row = (await db.execute(stmt)).scalar_one_or_none()
        return str(row) if row is not None else None

    async def _find_linked_prop(q: str) -> tuple[int, str] | None:
        stmt = (
            select(ProjectPropLink.id, Prop.id)
            .join(Prop, Prop.id == ProjectPropLink.prop_id)
            .where(ProjectPropLink.project_id == project_id, Prop.name.ilike(f"%{q}%"))
            .limit(1)
        )
        row = (await db.execute(stmt)).first()
        if not row:
            return None
        link_id, prop_id = row
        return int(link_id), str(prop_id)

    async def _find_linked_scene(q: str) -> tuple[int, str] | None:
        stmt = (
            select(ProjectSceneLink.id, Scene.id)
            .join(Scene, Scene.id == ProjectSceneLink.scene_id)
            .where(ProjectSceneLink.project_id == project_id, Scene.name.ilike(f"%{q}%"))
            .limit(1)
        )
        row = (await db.execute(stmt)).first()
        if not row:
            return None
        link_id, scene_id = row
        return int(link_id), str(scene_id)

    async def _find_linked_costume(q: str) -> tuple[int, str] | None:
        stmt = (
            select(ProjectCostumeLink.id, Costume.id)
            .join(Costume, Costume.id == ProjectCostumeLink.costume_id)
            .where(ProjectCostumeLink.project_id == project_id, Costume.name.ilike(f"%{q}%"))
            .limit(1)
        )
        row = (await db.execute(stmt)).first()
        if not row:
            return None
        link_id, costume_id = row
        return int(link_id), str(costume_id)

    def _empty_item(raw: str) -> dict[str, Any]:
        return {
            "name": raw,
            "exists": False,
            "linked_to_project": False,
            "asset_id": None,
            "link_id": None,
        }

    characters_out: list[dict[str, Any]] = []
    for name in character_names or []:
        raw = str(name)
        q = raw.strip()
        if not q:
            characters_out.append(_empty_item(raw))
            continue
        char_id = await _find_character_id(q)
        exists = char_id is not None
        characters_out.append(
            {
                "name": raw,
                "exists": exists,
                "linked_to_project": exists,
                "asset_id": char_id,
                "link_id": None,
            }
        )

    props_out: list[dict[str, Any]] = []
    for name in prop_names or []:
        raw = str(name)
        q = raw.strip()
        if not q:
            props_out.append(_empty_item(raw))
            continue
        linked_row = await _find_linked_prop(q)
        if linked_row is not None:
            link_id, prop_id = linked_row
            props_out.append(
                {
                    "name": raw,
                    "exists": True,
                    "linked_to_project": True,
                    "asset_id": prop_id,
                    "link_id": link_id,
                }
            )
            continue
        prop_id = await _find_asset_id(Prop, q)
        props_out.append(
            {
                "name": raw,
                "exists": prop_id is not None,
                "linked_to_project": False,
                "asset_id": prop_id,
                "link_id": None,
            }
        )

    scenes_out: list[dict[str, Any]] = []
    for name in scene_names or []:
        raw = str(name)
        q = raw.strip()
        if not q:
            scenes_out.append(_empty_item(raw))
            continue
        linked_row = await _find_linked_scene(q)
        if linked_row is not None:
            link_id, scene_id = linked_row
            scenes_out.append(
                {
                    "name": raw,
                    "exists": True,
                    "linked_to_project": True,
                    "asset_id": scene_id,
                    "link_id": link_id,
                }
            )
            continue
        scene_id = await _find_asset_id(Scene, q)
        scenes_out.append(
            {
                "name": raw,
                "exists": scene_id is not None,
                "linked_to_project": False,
                "asset_id": scene_id,
                "link_id": None,
            }
        )

    costumes_out: list[dict[str, Any]] = []
    for name in costume_names or []:
        raw = str(name)
        q = raw.strip()
        if not q:
            costumes_out.append(_empty_item(raw))
            continue
        linked_row = await _find_linked_costume(q)
        if linked_row is not None:
            link_id, costume_id = linked_row
            costumes_out.append(
                {
                    "name": raw,
                    "exists": True,
                    "linked_to_project": True,
                    "asset_id": costume_id,
                    "link_id": link_id,
                }
            )
            continue
        costume_id = await _find_asset_id(Costume, q)
        costumes_out.append(
            {
                "name": raw,
                "exists": costume_id is not None,
                "linked_to_project": False,
                "asset_id": costume_id,
                "link_id": None,
            }
        )

    return {
        "characters": characters_out,
        "props": props_out,
        "scenes": scenes_out,
        "costumes": costumes_out,
    }
