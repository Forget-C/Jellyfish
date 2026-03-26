from __future__ import annotations

"""资产与镜头相关的图片生成任务 API。

通过 TaskManager 调用 `ImageGenerationTask`，并使用 `GenerationTaskLink`
将任务与上层业务实体（演员形象/道具/场景/服装/角色/镜头分镜帧）建立关联。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.db import async_session_maker
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.task_manager.types import TaskStatus
from app.core.tasks import ImageGenerationInput, ImageGenerationResult, ImageGenerationTask, ProviderConfig
from app.dependencies import get_db
from app.models.studio import (
    Actor,
    ActorImage,
    AssetViewAngle,
    AssetQualityLevel,
    Character,
    CharacterImage,
    Costume,
    CostumeImage,
    PromptCategory,
    Prop,
    PropImage,
    Scene,
    SceneImage,
    ShotDetail,
    ShotCharacterLink,
    ShotFrameType,
    ShotFrameImage,
)
from app.models.task_links import GenerationTaskLink
from app.schemas.common import ApiResponse, success_response
from app.api.v1.routes.film.common import TaskCreated, _CreateOnlyTask
from app.services.studio.image_tasks import (
    asset_prompt_category as _asset_prompt_category,
    build_prompt_with_template as _build_prompt_with_template,
    is_front_view as _is_front_view,
    load_provider_config as _load_provider_config,
    map_view_angle_for_prompt as _map_view_angle_for_prompt,
    resolve_front_image_ref as _resolve_front_image_ref,
    resolve_image_model as _resolve_image_model,
    resolve_ordered_image_refs as _resolve_ordered_image_refs,
    shot_frame_prompt_category as _shot_frame_prompt_category,
)
from app.utils.files import create_file_from_url_or_b64


router = APIRouter()


class StudioImageTaskRequest(BaseModel):
    """Studio 专用图片任务请求体：可选模型 ID，不传则用默认图片模型；供应商由模型反查。

    image_id 表示具体的图片模型 ID，例如：
    - 演员图片：ActorImage.id
    - 场景图片：SceneImage.id
    - 道具图片：PropImage.id
    - 服装图片：CostumeImage.id
    - 角色图片：CharacterImage.id
    - 分镜帧图片：ShotFrameImage.id
    """

    model_id: str | None = Field(
        None,
        description="可选模型 ID（models.id）；不传则使用 ModelSettings.default_image_model_id；Provider 由模型关联反查",
    )
    image_id: int | None = Field(
        None,
        description="图片模型 ID，如 ActorImage.id / SceneImage.id / PropImage.id 等；必须与路径主体 ID 匹配",
    )


class ShotFrameImageTaskRequest(BaseModel):
    """镜头分镜帧图片生成请求体：只根据 `shot_id + frame_type` 定位 ShotFrameImage。

    用于替代旧接口中通过 `image_id` 直接传入 ShotFrameImage.id 的方式。
    """

    model_id: str | None = Field(
        None,
        description="可选模型 ID（models.id）；不传则使用 ModelSettings.default_image_model_id；Provider 由模型关联反查",
    )
    frame_type: ShotFrameType = Field(..., description="first | last | key")


class RenderedPromptResponse(BaseModel):
    prompt: str = Field(..., description="渲染后的提示词（已套用模板与变量替换）")


async def _build_actor_prompt_and_refs(
    db: AsyncSession,
    *,
    actor_id: str,
    image_id: int | None,
) -> tuple[str, list[dict[str, str]] | None, ActorImage]:
    actor = await db.get(Actor, actor_id)
    if actor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Actor not found")
    if image_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_id is required for actor generation",
        )
    image_row = await db.get(ActorImage, image_id)
    if image_row is None or image_row.actor_id != actor_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_id does not belong to given actor_id",
        )
    is_front_view = _is_front_view(image_row.view_angle)
    category = _asset_prompt_category(
        relation_type="actor_image",
        is_front_view=is_front_view,
    )
    prompt = await _build_prompt_with_template(
        db,
        category=category,
        variables={
            "name": actor.name,
            "description": actor.description,
            "tags": ", ".join(actor.tags or []),
            "view_angle": _map_view_angle_for_prompt(image_row.view_angle),
            "quality_level": image_row.quality_level,
            "format": image_row.format,
        },
        fallback_prompt=actor.description,
        not_found_msg="Actor.description is empty",
    )
    images = (
        []
        if is_front_view
        else [ref]
        if (ref := await _resolve_front_image_ref(
            db,
            image_model=ActorImage,
            parent_field_name="actor_id",
            parent_id=actor_id,
            preferred_quality_level=image_row.quality_level,
        ))
        else []
    )
    return prompt, (images if images else None), image_row


async def _build_asset_prompt_and_refs(
    db: AsyncSession,
    *,
    asset_type: str,
    asset_id: str,
    image_id: int | None,
) -> tuple[str, list[dict[str, str]] | None, str]:
    if image_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_id is required for asset image generation",
        )

    asset_type_norm = asset_type.strip().lower()
    if asset_type_norm == "prop":
        asset = await db.get(Prop, asset_id)
        if asset is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prop not found")
        image_row = await db.get(PropImage, image_id)
        if image_row is None or image_row.prop_id != asset_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="image_id does not belong to given prop_id",
            )
        relation_type = "prop_image"
        is_front_view = _is_front_view(image_row.view_angle)
        category = _asset_prompt_category(
            relation_type=relation_type,
            is_front_view=is_front_view,
        )
        prompt = await _build_prompt_with_template(
            db,
            category=category,
            variables={
                "name": asset.name,
                "description": asset.description,
                "tags": ", ".join(asset.tags or []),
                "view_angle": _map_view_angle_for_prompt(image_row.view_angle),
                "quality_level": image_row.quality_level,
                "format": image_row.format,
            },
            fallback_prompt=asset.description,
            not_found_msg="Prop.description is empty",
        )
        images = (
            []
            if is_front_view
            else [ref]
            if (ref := await _resolve_front_image_ref(
                db,
                image_model=PropImage,
                parent_field_name="prop_id",
                parent_id=asset_id,
                preferred_quality_level=image_row.quality_level,
            ))
            else []
        )
        return prompt, (images if images else None), relation_type
    if asset_type_norm == "scene":
        asset = await db.get(Scene, asset_id)
        if asset is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found")
        image_row = await db.get(SceneImage, image_id)
        if image_row is None or image_row.scene_id != asset_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="image_id does not belong to given scene_id",
            )
        relation_type = "scene_image"
        is_front_view = _is_front_view(image_row.view_angle)
        category = _asset_prompt_category(
            relation_type=relation_type,
            is_front_view=is_front_view,
        )
        prompt = await _build_prompt_with_template(
            db,
            category=category,
            variables={
                "name": asset.name,
                "description": asset.description,
                "tags": ", ".join(asset.tags or []),
                "view_angle": _map_view_angle_for_prompt(image_row.view_angle),
                "quality_level": image_row.quality_level,
                "format": image_row.format,
            },
            fallback_prompt=asset.description,
            not_found_msg="Scene.description is empty",
        )
        images = (
            []
            if is_front_view
            else [ref]
            if (ref := await _resolve_front_image_ref(
                db,
                image_model=SceneImage,
                parent_field_name="scene_id",
                parent_id=asset_id,
                preferred_quality_level=image_row.quality_level,
            ))
            else []
        )
        return prompt, (images if images else None), relation_type
    if asset_type_norm == "costume":
        asset = await db.get(Costume, asset_id)
        if asset is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Costume not found")
        image_row = await db.get(CostumeImage, image_id)
        if image_row is None or image_row.costume_id != asset_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="image_id does not belong to given costume_id",
            )
        relation_type = "costume_image"
        is_front_view = _is_front_view(image_row.view_angle)
        category = _asset_prompt_category(
            relation_type=relation_type,
            is_front_view=is_front_view,
        )
        prompt = await _build_prompt_with_template(
            db,
            category=category,
            variables={
                "name": asset.name,
                "description": asset.description,
                "tags": ", ".join(asset.tags or []),
                "view_angle": _map_view_angle_for_prompt(image_row.view_angle),
                "quality_level": image_row.quality_level,
                "format": image_row.format,
            },
            fallback_prompt=asset.description,
            not_found_msg="Costume.description is empty",
        )
        images = (
            []
            if is_front_view
            else [ref]
            if (ref := await _resolve_front_image_ref(
                db,
                image_model=CostumeImage,
                parent_field_name="costume_id",
                parent_id=asset_id,
                preferred_quality_level=image_row.quality_level,
            ))
            else []
        )
        return prompt, (images if images else None), relation_type
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="asset_type must be one of: prop/scene/costume",
    )


async def _build_character_prompt_and_refs(
    db: AsyncSession,
    *,
    character_id: str,
    image_id: int | None,
) -> tuple[str, list[dict[str, str]] | None, CharacterImage]:
    character = await db.get(Character, character_id)
    if character is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")
    if image_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_id is required for character image generation",
        )
    image_row = await db.get(CharacterImage, image_id)
    if image_row is None or image_row.character_id != character_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_id does not belong to given character_id",
        )
    prompt = await _build_prompt_with_template(
        db,
        category=PromptCategory.combined,
        variables={
            "name": character.name,
            "description": character.description,
            "view_angle": _map_view_angle_for_prompt(image_row.view_angle),
            "quality_level": image_row.quality_level,
            "format": image_row.format,
        },
        fallback_prompt=character.description,
        not_found_msg="Character.description is empty",
    )
    actor: Actor | None = await db.get(Actor, character.actor_id) if character.actor_id else None
    costume: Costume | None = await db.get(Costume, character.costume_id) if character.costume_id else None

    DEFAULT_VIEW_ANGLES: tuple[AssetViewAngle, ...] = (
        AssetViewAngle.front,
        AssetViewAngle.left,
        AssetViewAngle.right,
        AssetViewAngle.back,
    )
    actor_refs: list[dict[str, str]] = []
    if actor is not None:
        actor_refs = await _resolve_ordered_image_refs(
            db,
            image_model=ActorImage,
            parent_field_name="actor_id",
            parent_id=actor.id,
            view_angles=DEFAULT_VIEW_ANGLES,
        )
    costume_refs: list[dict[str, str]] = []
    if costume is not None:
        costume_refs = await _resolve_ordered_image_refs(
            db,
            image_model=CostumeImage,
            parent_field_name="costume_id",
            parent_id=costume.id,
            view_angles=DEFAULT_VIEW_ANGLES,
        )
    ref_images = [*actor_refs, *costume_refs]
    return prompt, (ref_images if ref_images else None), image_row


def _cn_num(n: int) -> str:
    ones = {0: "零", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九"}
    if n <= 9:
        return ones[n]
    if n == 10:
        return "十"
    if n < 20:
        return f"十{ones[n - 10]}"
    tens = n // 10
    rem = n % 10
    if rem == 0:
        return f"{ones[tens]}十"
    return f"{ones[tens]}十{ones[rem]}"


async def _build_shot_frame_prompt_and_refs(
    db: AsyncSession,
    *,
    shot_id: str,
    frame_type: ShotFrameType,
) -> tuple[str, list[dict[str, str]] | None, ShotDetail]:
    shot_detail = await db.get(ShotDetail, shot_id)
    if shot_detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ShotDetail not found")

    if frame_type == ShotFrameType.first:
        raw_prompt = (shot_detail.first_frame_prompt or "").strip()
    elif frame_type == ShotFrameType.last:
        raw_prompt = (shot_detail.last_frame_prompt or "").strip()
    else:
        raw_prompt = (shot_detail.key_frame_prompt or "").strip()

    if not raw_prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"ShotDetail has no prompt for frame_type={frame_type}",
        )

    role_links_stmt = (
        select(ShotCharacterLink)
        .options(selectinload(ShotCharacterLink.character))
        .where(ShotCharacterLink.shot_id == shot_id)
        .order_by(ShotCharacterLink.index.asc())
    )
    role_links = (await db.execute(role_links_stmt)).scalars().all()

    role_names: list[str] = []
    role_image_refs: list[dict[str, str]] = []

    for link in role_links:
        character = link.character
        if character is None:
            continue

        ref = await _resolve_front_image_ref(
            db,
            image_model=CharacterImage,
            parent_field_name="character_id",
            parent_id=character.id,
            preferred_quality_level=None,
        )
        if ref is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CharacterImage front ref not found for character_id={character.id}, name={character.name}",
            )

        role_names.append(character.name)
        role_image_refs.append(ref)

    if role_links and not role_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid shot character image refs found",
        )
    if len(set(role_names)) != len(role_names):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Duplicate character names in shot character links; cannot map names to image order",
        )

    name_to_token: dict[str, str] = {name: f"图{_cn_num(i + 1)}" for i, name in enumerate(role_names)}
    sorted_pairs = sorted(name_to_token.items(), key=lambda kv: len(kv[0]), reverse=True)

    def _replace_names(text: str) -> str:
        out = text or ""
        for name, token in sorted_pairs:
            if name:
                out = out.replace(name, token)
        return out

    replaced_first = _replace_names(shot_detail.first_frame_prompt or "")
    replaced_last = _replace_names(shot_detail.last_frame_prompt or "")
    replaced_key = _replace_names(shot_detail.key_frame_prompt or "")

    base_prompt = _replace_names(raw_prompt)
    prompt = await _build_prompt_with_template(
        db,
        category=_shot_frame_prompt_category(frame_type),
        variables={
            "description": shot_detail.description,
            "atmosphere": shot_detail.atmosphere,
            "mood_tags": ", ".join(shot_detail.mood_tags or []),
            "camera_shot": shot_detail.camera_shot,
            "angle": shot_detail.angle,
            "movement": shot_detail.movement,
            "frame_type": frame_type,
            "first_frame_prompt": replaced_first,
            "last_frame_prompt": replaced_last,
            "key_frame_prompt": replaced_key,
            "base_prompt": base_prompt,
        },
        fallback_prompt=base_prompt,
        not_found_msg=f"ShotDetail has no prompt for frame_type={frame_type}",
    )
    return prompt, (role_image_refs if role_image_refs else None), shot_detail




async def _create_image_task_and_link(
    *,
    db: AsyncSession,
    model_id: str | None,
    relation_type: str,
    relation_entity_id: str,
    prompt: str,
    images: list[dict[str, str]] | None = None,
) -> TaskCreated:
    """创建图片生成任务，并在 `GenerationTaskLink` 中建立关联；Provider 由解析出的 Model 反查。"""
    store = SqlAlchemyTaskStore(db)
    tm = TaskManager(store=store, strategies={})

    model = await _resolve_image_model(db, model_id)
    provider_cfg = await _load_provider_config(db, model.provider_id)

    run_args: dict = {
        "provider": provider_cfg.provider,
        "api_key": provider_cfg.api_key,
        "base_url": provider_cfg.base_url,
        "input": {
            "prompt": prompt,
            # 生成参数与参考图统一从 DB 侧控制；此接口不接收覆盖参数。
            "model": model.name,
        },
    }
    if images:
        run_args["input"]["images"] = images

    task_record = await tm.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        run_args=run_args,
    )

    link = GenerationTaskLink(
        task_id=task_record.id,
        resource_type="image",
        relation_type=relation_type,
        relation_entity_id=relation_entity_id,
    )
    db.add(link)
    await db.commit()

    async def _persist_images_to_assets(
        session: AsyncSession,
        *,
        task_id: str,
        relation_type: str,
        relation_entity_id: str,
        result: ImageGenerationResult,
    ) -> None:
        """根据 relation_type 将生成的图片落库为 FileItem + 具体资产图片表。

        - 先将图片内容上传到 S3，创建 FileItem 记录；
        - 再根据 relation_type 写入 ActorImage / SceneImage 等业务图片表；
        - 当前实现先支持 actor_image / scene_image / prop_image / costume_image，其他类型可按需扩展。
        """
        from sqlalchemy import select

        from app.models.studio import (
            ActorImage,
            CharacterImage,
            CostumeImage,
            PropImage,
            SceneImage,
            ShotFrameImage,
        )

        # 目前 ImageGenerationResult.images 优先使用 url；若仅有 b64，可在此扩展为下载/解码再上传。
        images = result.images or []
        if not images:
            return

        # 简化起见：仅处理第一张图片
        item = images[0]
        if not item.url:
            # 暂不支持纯 base64 输出的自动落库
            return

        # 使用通用工具方法：从 URL 创建 FileItem 并上传到对象存储
        file_obj = await create_file_from_url_or_b64(
            session,
            url=item.url,
            name=f"{relation_type}-{relation_entity_id}",
            prefix=f"generated-images/{relation_type}/{relation_entity_id}",
        )
        file_id = file_obj.id

        link_stmt = (
            select(GenerationTaskLink)
            .where(
                GenerationTaskLink.task_id == task_id,
                GenerationTaskLink.relation_type == relation_type,
                GenerationTaskLink.relation_entity_id == relation_entity_id,
            )
            .limit(1)
        )
        link_result = await session.execute(link_stmt)
        link_row = link_result.scalars().first()
        if link_row is not None and not link_row.file_id:
            link_row.file_id = file_id

        # 根据 relation_type 将生成文件填充到已有 image 槽位的 file_id（仅首张生效）
        if relation_type == "actor_image":
            image_row = await session.get(ActorImage, int(relation_entity_id))
            if image_row is not None and not image_row.file_id:
                image_row.file_id = file_id
        elif relation_type == "scene_image":
            image_row = await session.get(SceneImage, int(relation_entity_id))
            if image_row is not None and not image_row.file_id:
                image_row.file_id = file_id
        elif relation_type == "prop_image":
            image_row = await session.get(PropImage, int(relation_entity_id))
            if image_row is not None and not image_row.file_id:
                image_row.file_id = file_id
        elif relation_type == "costume_image":
            image_row = await session.get(CostumeImage, int(relation_entity_id))
            if image_row is not None and not image_row.file_id:
                image_row.file_id = file_id
        elif relation_type == "character_image":
            image_row = await session.get(CharacterImage, int(relation_entity_id))
            if image_row is not None and not image_row.file_id:
                image_row.file_id = file_id
        elif relation_type == "character":
            # 角色生成（任务版）：落库为 CharacterImage（优先填充 front+low 槽位；没有则创建）
            character_id = relation_entity_id
            stmt_ci = (
                select(CharacterImage)
                .where(
                    CharacterImage.character_id == character_id,
                    CharacterImage.quality_level == AssetQualityLevel.low,
                    CharacterImage.view_angle == AssetViewAngle.front,
                )
                .order_by(CharacterImage.id.asc())
                .limit(1)
            )
            ci_res = await session.execute(stmt_ci)
            ci = ci_res.scalars().first()
            if ci is not None:
                if not ci.file_id:
                    ci.file_id = file_id
                    ci.format = getattr(ci, "format", "") or "png"
            else:
                # 创建一个 front+low 的槽位，并设为主图（同一角色只允许一张主图，下面会清理其他主图）
                ci = CharacterImage(
                    character_id=character_id,
                    file_id=file_id,
                    quality_level=AssetQualityLevel.low,
                    view_angle=AssetViewAngle.front,
                    width=None,
                    height=None,
                    format="png",
                    is_primary=True,
                )
                session.add(ci)

            # 如果本次落库的行是主图，确保同一角色只有一个主图
            if ci is not None and getattr(ci, "is_primary", False) is True and getattr(ci, "id", None) is not None:
                stmt_clear = (
                    CharacterImage.__table__.update()  # type: ignore[attr-defined]
                    .where(CharacterImage.character_id == character_id, CharacterImage.id != ci.id)
                    .values(is_primary=False)
                )
                await session.execute(stmt_clear)
        elif relation_type == "shot_frame_image":
            image_row = await session.get(ShotFrameImage, int(relation_entity_id))
            if image_row is not None:
                # 无条件覆盖：如果该 ShotFrameImage 是占位记录，也需要在生成完成后写入新图片。
                image_row.file_id = file_id

    async def _runner(task_id: str, args: dict) -> None:
        async with async_session_maker() as session:
            try:
                store2 = SqlAlchemyTaskStore(session)
                await store2.set_status(task_id, TaskStatus.running)
                await store2.set_progress(task_id, 10)

                provider = str(args.get("provider") or "")
                api_key = str(args.get("api_key") or "")
                base_url = args.get("base_url")
                input_dict = dict(args.get("input") or {})

                task = ImageGenerationTask(
                    provider_config=ProviderConfig(
                        provider=provider,  # type: ignore[arg-type]
                        api_key=api_key,
                        base_url=base_url,
                    ),
                    input_=ImageGenerationInput.model_validate(input_dict),
                )
                await task.run()
                result = await task.get_result()
                if result is None:
                    raise RuntimeError("Image generation task returned no result")

                await store2.set_result(task_id, result.model_dump())
                # 任务成功后，自动将生成图片上传到 S3 并落库到资产图片表
                await _persist_images_to_assets(
                    session,
                    task_id=task_id,
                    relation_type=relation_type,
                    relation_entity_id=relation_entity_id,
                    result=result,
                )
                await store2.set_progress(task_id, 100)
                await store2.set_status(task_id, TaskStatus.succeeded)
                await session.commit()
            except Exception as exc:  # noqa: BLE001
                await session.rollback()
                async with async_session_maker() as s2:
                    store3 = SqlAlchemyTaskStore(s2)
                    await store3.set_error(task_id, str(exc))
                    await store3.set_status(task_id, TaskStatus.failed)
                    await s2.commit()

    import asyncio

    asyncio.create_task(_runner(task_record.id, run_args))
    return TaskCreated(task_id=task_record.id)


@router.post(
    "/actors/{actor_id}/image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="演员图片生成（任务版）",
)
async def create_actor_image_generation_task(
    actor_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为指定演员创建图片生成任务，并通过 `GenerationTaskLink` 关联。"""
    prompt, images, image_row = await _build_actor_prompt_and_refs(
        db,
        actor_id=actor_id,
        image_id=body.image_id,
    )
    created = await _create_image_task_and_link(
        db=db,
        model_id=body.model_id,
        relation_type="actor_image",
        relation_entity_id=str(image_row.id),
        prompt=prompt,
        images=images,
    )
    return success_response(created, code=201)


@router.post(
    "/actors/{actor_id}/render-prompt",
    response_model=ApiResponse[RenderedPromptResponse],
    status_code=status.HTTP_200_OK,
    summary="演员图片提示词渲染",
)
async def render_actor_image_prompt(
    actor_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptResponse]:
    prompt, _images, _image_row = await _build_actor_prompt_and_refs(
        db,
        actor_id=actor_id,
        image_id=body.image_id,
    )
    return success_response(RenderedPromptResponse(prompt=prompt))


@router.post(
    "/assets/{asset_type}/{asset_id}/image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="道具/场景/服装图片生成（任务版）",
)
async def create_asset_image_generation_task(
    asset_type: str,
    asset_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为道具/场景/服装创建图片生成任务。

    - asset_type: prop / scene / costume
    - path 参数 asset_id 为对应资产 ID
    - body.image_id 必须为该资产下对应图片表记录的 ID（PropImage/SceneImage/CostumeImage）
    """
    prompt, images, relation_type = await _build_asset_prompt_and_refs(
        db,
        asset_type=asset_type,
        asset_id=asset_id,
        image_id=body.image_id,
    )

    created = await _create_image_task_and_link(
        db=db,
        model_id=body.model_id,
        relation_type=relation_type,
        relation_entity_id=str(body.image_id),
        prompt=prompt,
        images=images,
    )
    return success_response(created, code=201)


@router.post(
    "/assets/{asset_type}/{asset_id}/render-prompt",
    response_model=ApiResponse[RenderedPromptResponse],
    status_code=status.HTTP_200_OK,
    summary="道具/场景/服装图片提示词渲染",
)
async def render_asset_image_prompt(
    asset_type: str,
    asset_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptResponse]:
    prompt, _images, _relation_type = await _build_asset_prompt_and_refs(
        db,
        asset_type=asset_type,
        asset_id=asset_id,
        image_id=body.image_id,
    )
    return success_response(RenderedPromptResponse(prompt=prompt))


@router.post(
    "/characters/{character_id}/image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="角色图片生成（任务版）",
)
async def create_character_image_generation_task(
    character_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为角色创建图片生成任务（对应 CharacterImage 业务）。

    - path 参数 character_id 为 Character.id
    - body.image_id 必须为该角色下的 CharacterImage.id
    """
    prompt, ref_images, image_row = await _build_character_prompt_and_refs(
        db,
        character_id=character_id,
        image_id=body.image_id,
    )
    created = await _create_image_task_and_link(
        db=db,
        model_id=body.model_id,
        relation_type="character_image",
        relation_entity_id=str(image_row.id),
        prompt=prompt,
        images=ref_images,
    )
    return success_response(created, code=201)


@router.post(
    "/characters/{character_id}/render-prompt",
    response_model=ApiResponse[RenderedPromptResponse],
    status_code=status.HTTP_200_OK,
    summary="角色图片提示词渲染",
)
async def render_character_image_prompt(
    character_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptResponse]:
    prompt, _ref_images, _image_row = await _build_character_prompt_and_refs(
        db,
        character_id=character_id,
        image_id=body.image_id,
    )
    return success_response(RenderedPromptResponse(prompt=prompt))


@router.post(
    "/shot/{shot_id}/frame-image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="镜头分镜帧图片生成（任务版）",
)
async def create_shot_frame_image_generation_task(
    shot_id: str,
    body: ShotFrameImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为镜头分镜帧图片生成任务（基于 `shot_id + frame_type` 自动定位数据）。"""
    prompt, role_image_refs, _shot_detail = await _build_shot_frame_prompt_and_refs(
        db,
        shot_id=shot_id,
        frame_type=body.frame_type,
    )

    # 通过 shot_id 与 frame_type 定位 ShotFrameImage，作为落库目标；若不存在则创建占位记录。
    shot_frame_image_stmt = (
        select(ShotFrameImage)
        .where(ShotFrameImage.shot_detail_id == shot_id, ShotFrameImage.frame_type == body.frame_type)
        .limit(1)
    )
    shot_frame_image = (await db.execute(shot_frame_image_stmt)).scalars().first()
    if shot_frame_image is None:
        # 缺少对应 frame_type 的 ShotFrameImage slot：创建占位记录（file_id 允许为空）。
        # 后续图片生成完成后会覆盖写回 file_id。
        shot_frame_image = ShotFrameImage(
            shot_detail_id=shot_id,
            frame_type=body.frame_type,
            file_id=None,
            width=None,
            height=None,
            format="png",
        )
        db.add(shot_frame_image)
        await db.flush()
        await db.refresh(shot_frame_image)
    else:
        # 已存在则补齐默认字段（不改写 file_id）。
        if not shot_frame_image.format:
            shot_frame_image.format = "png"

    created = await _create_image_task_and_link(
        db=db,
        model_id=body.model_id,
        relation_type="shot_frame_image",
        relation_entity_id=str(shot_frame_image.id),
        prompt=prompt,
        images=role_image_refs,
    )
    return success_response(created, code=201)


@router.post(
    "/shot/{shot_id}/frame-render-prompt",
    response_model=ApiResponse[RenderedPromptResponse],
    status_code=status.HTTP_200_OK,
    summary="镜头分镜帧提示词渲染",
)
async def render_shot_frame_prompt(
    shot_id: str,
    body: ShotFrameImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptResponse]:
    prompt, _role_image_refs, _shot_detail = await _build_shot_frame_prompt_and_refs(
        db,
        shot_id=shot_id,
        frame_type=body.frame_type,
    )
    return success_response(RenderedPromptResponse(prompt=prompt))

