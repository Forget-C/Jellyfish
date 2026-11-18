"""Studio 实体与实体图片的协调服务。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.studio.entity_crud import (
    create_entity as create_entity_service,
    delete_entity as delete_entity_service,
    get_entity as get_entity_service,
    list_entities_paginated,
    update_entity as update_entity_service,
)
from app.services.studio.entity_existence import check_names_existence as check_names_existence_service
from app.services.studio.entity_images import (
    create_entity_image as create_entity_image_service,
    delete_entity_image as delete_entity_image_service,
    list_entity_images_paginated,
    update_entity_image as update_entity_image_service,
)


class StudioEntitiesService:
    """封装 studio 通用实体与图片的协调调用。"""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def check_names_existence(
        self,
        *,
        project_id: str,

        character_names: list[str],
        prop_names: list[str],
        scene_names: list[str],
        costume_names: list[str],
    ) -> dict[str, list[dict[str, object]]]:
        return await check_names_existence_service(
            self._db,
            project_id=project_id,

            character_names=character_names,
            prop_names=prop_names,
            scene_names=scene_names,
            costume_names=costume_names,
        )

    async def list_entities(
        self,
        *,
        entity_type: str,
        q: str | None,
        style: str | None,
        visual_style: str | None,
        order: str | None,
        is_desc: bool,
        page: int,
        page_size: int,
        project_id: str | None = None,
        exact_name: str | None = None,
        source: list[str] | None = None,
        has_cover: bool | None = None,
    ) -> tuple[list[dict[str, object]], int]:
        return await list_entities_paginated(
            self._db,
            entity_type=entity_type,
            project_id=project_id,
            q=q,
            exact_name=exact_name,
            source=source,
            has_cover=has_cover,
            style=style,
            visual_style=visual_style,
            order=order,
            is_desc=is_desc,
            page=page,
            page_size=page_size,
        )

    async def create_entity(self, *, entity_type: str, body: dict[str, object]) -> dict[str, object]:
        return await create_entity_service(self._db, entity_type=entity_type, body=body)

    async def get_entity(self, *, entity_type: str, entity_id: str) -> dict[str, object]:
        return await get_entity_service(self._db, entity_type=entity_type, entity_id=entity_id)

    async def update_entity(
        self,
        *,
        entity_type: str,
        entity_id: str,
        body: dict[str, object],
    ) -> dict[str, object]:
        return await update_entity_service(
            self._db,
            entity_type=entity_type,
            entity_id=entity_id,
            body=body,
        )

    async def delete_entity(self, *, entity_type: str, entity_id: str) -> None:
        await delete_entity_service(self._db, entity_type=entity_type, entity_id=entity_id)

    async def list_entity_images(
        self,
        *,
        entity_type: str,
        entity_id: str,
        order: str | None,
        is_desc: bool,
        page: int,
        page_size: int,
    ) -> tuple[list[dict[str, object]], int]:
        return await list_entity_images_paginated(
            self._db,
            entity_type=entity_type,
            entity_id=entity_id,
            order=order,
            is_desc=is_desc,
            page=page,
            page_size=page_size,
        )

    async def create_entity_image(
        self,
        *,
        entity_type: str,
        entity_id: str,
        body: dict[str, object],
    ) -> dict[str, object]:
        return await create_entity_image_service(
            self._db,
            entity_type=entity_type,
            entity_id=entity_id,
            body=body,
        )

    async def update_entity_image(
        self,
        *,
        entity_type: str,
        entity_id: str,
        image_id: int,
        body: dict[str, object],
    ) -> dict[str, object]:
        return await update_entity_image_service(
            self._db,
            entity_type=entity_type,
            entity_id=entity_id,
            image_id=image_id,
            body=body,
        )

    async def delete_entity_image(self, *, entity_type: str, entity_id: str, image_id: int) -> None:
        await delete_entity_image_service(
            self._db,
            entity_type=entity_type,
            entity_id=entity_id,
            image_id=image_id,
        )
