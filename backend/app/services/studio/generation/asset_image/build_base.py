from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from jinja2 import Environment, TemplateError, meta
from pydantic import Field
from sqlalchemy import select

from app.core.contracts.asset_prompts import AssetPromptOptions, AssetPromptReference, DISPLAY_FIELDS, validate_display_overrides
from app.services.studio.generation.asset_image.prompt_rules import ASSET_TEMPLATE, PURPOSES, DISPLAY_DEFAULTS, resolve_prompt_references

from app.models.studio import (
    Actor,
    ActorImage,
    AssetViewAngle,
    Character,
    CharacterPropLink,
    Costume,
    CostumeImage,
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
    is_front_view,
    map_view_angle_for_prompt,
    resolve_prompt_template,
    render_prompt_template_content,
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
    template_id: str | None = None
    template_version: int | None = None
    merged_variables: dict[str, str] = Field(default_factory=dict)


def _enum_value(value: Any) -> str:
    """将枚举转换为模型可理解的已存中文设定。"""
    raw = getattr(value, "value", value)
    return str(raw or "")


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
    template_id: str | None = None,
    reference_instruction: str = "",
    options: AssetPromptOptions | None = None,
) -> tuple[str, str | None, int | None, dict[str, str]]:
    """按明确作用域合并展示参数，校验主体内容实际进入模板结果。"""
    del tags
    options = options or AssetPromptOptions()
    category = asset_prompt_category(
        relation_type=relation_type,
        is_front_view=is_front_view(image_row.view_angle),
    )
    kind = relation_type.removesuffix("_image")
    if not description.strip() and not reference_instruction:
        raise HTTPException(status_code=400, detail="请补充主体设定或选择有效参考图")
    template = await resolve_prompt_template(db, category=category, template_id=template_id)
    if template_id and template is None:
        raise HTTPException(status_code=400, detail="所选模板不属于当前资产类别")
    display = dict(DISPLAY_DEFAULTS)
    if kind == "scene":
        display.update(background_instruction="保留场景的建筑和环境，不替换为棚拍纯色背景。", framing_instruction="清晰展示空间关系与完整布局。")
    try:
        if template:
            display.update(validate_display_overrides(template.variable_defaults or {}) or {})
        display.update(validate_display_overrides(getattr(image_row, "prompt_overrides", None)) or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    display.update(options.model_dump(exclude_none=True, include=DISPLAY_FIELDS))
    variables = {
        **display,
        "purpose": PURPOSES[kind], "name": name, "description": description,
        "visual_style": _enum_value(visual_style), "style": _enum_value(style),
        "view_angle": map_view_angle_for_prompt(image_row.view_angle),
        "reference_instruction": reference_instruction,
        "additional_instruction": options.additional_instruction,
    }
    if options.mode == "edit":
        if not options.edit_instruction.strip():
            raise HTTPException(status_code=400, detail="请说明要修改的对象和目标效果")
        variables["purpose"] = "局部修改参考图。仅改变：" + options.edit_instruction + "。保持：" + (options.preserve_instruction or "其余主体身份、服装、物体结构、构图和背景") + "。结果作为候选，等待用户采用。"
    content = template.content if template else ASSET_TEMPLATE
    try:
        used = meta.find_undeclared_variables(Environment().parse(content))
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail="模板语法无效，请检查模板内容") from exc
    required = {"purpose", "description", "visual_style", "style", "view_angle", "reference_instruction", "additional_instruction"}
    missing = required - used
    if missing or used - variables.keys():
        raise HTTPException(status_code=400, detail="模板变量契约不完整：" + ", ".join(sorted(missing | (used - variables.keys()))))
    prompt = render_prompt_template_content(content, variables=variables)
    for key in required:
        if variables[key] and variables[key] not in prompt:
            raise HTTPException(status_code=400, detail=f"模板未完整保留必要内容：{key}")
    return prompt, template.id if template else None, template.version if template else None, variables



def _resolve_edit_options(options: AssetPromptOptions, image_row: Any) -> AssetPromptOptions:
    """局部修改默认使用当前图，并限定为一张明确的修改来源。"""
    if options.mode != "edit":
        return options
    references = options.references
    if references is None:
        references = [AssetPromptReference(file_id=image_row.file_id, role="design")] if image_row.file_id else []
    if len({ref.file_id for ref in references}) != 1:
        raise HTTPException(status_code=400, detail="局部修改必须选择一张待修改图片")
    return options.model_copy(update={"references": references})


async def _resolve_front_ref(
    db,
    *,
    image_model,
    parent_field_name: str,
    parent_id: str,
    preferred_quality_level: str | None,
) -> list[str]:
    """选择同资产正面图作为派生视角的默认参考。"""
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
    options: AssetPromptOptions | None = None,
) -> AssetImageBaseDraft:
    """读取资产与最终参考图，再生成可审计的完整提示词。"""
    options = options or AssetPromptOptions()
    actor = await db.get(Actor, actor_id)
    if actor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Actor"))
    image_row = await validate_actor_image(db, actor_id=actor_id, image_id=image_id)
    refs = []
    if not is_front_view(image_row.view_angle):
        refs = await _resolve_front_ref(
            db,
            image_model=ActorImage,
            parent_field_name="actor_id",
            parent_id=actor_id,
            preferred_quality_level=image_row.quality_level,
        )
    options = _resolve_edit_options(options, image_row)
    refs, reference_instruction = await resolve_prompt_references(
        db, options.references if options.references is not None else [AssetPromptReference(file_id=file_id, role="identity") for file_id in refs],
    )
    prompt, template_id, template_version, merged_variables = await _build_asset_prompt(
        db,
        relation_type="actor_image",
        name=actor.name,
        description=actor.description,
        tags=actor.tags,
        visual_style=actor.visual_style,
        style=actor.style,
        image_row=image_row,
        template_id=actor.prompt_template_id,
        reference_instruction=reference_instruction,
        options=options,
    )
    return AssetImageBaseDraft(
        entity_type="actor",
        entity_id=actor_id,
        image_id=image_row.id,
        relation_type="actor_image",
        relation_entity_id=str(image_row.id),
        prompt=prompt,
        default_images=refs,
        template_id=template_id,
        template_version=template_version,
        merged_variables=merged_variables,
    )


async def build_asset_image_base_draft(
    db,
    *,
    asset_type: str,
    asset_id: str,
    image_id: int | None,
    options: AssetPromptOptions | None = None,
) -> AssetImageBaseDraft:
    """读取资产与最终参考图，再生成可审计的完整提示词。"""
    options = options or AssetPromptOptions()
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
    if not is_front_view(image_row.view_angle):
        refs = await _resolve_front_ref(
            db,
            image_model=image_model,
            parent_field_name=parent_field_name,
            parent_id=asset_id,
            preferred_quality_level=image_row.quality_level,
        )
    role = {"scene": "layout", "costume": "costume", "prop": "prop"}[asset_type_norm]
    options = _resolve_edit_options(options, image_row)
    refs, reference_instruction = await resolve_prompt_references(
        db, options.references if options.references is not None else [AssetPromptReference(file_id=file_id, role=role) for file_id in refs],
    )
    prompt, template_id, template_version, merged_variables = await _build_asset_prompt(
        db,
        relation_type=relation_type,
        name=asset.name,
        description=asset.description,
        tags=asset.tags,
        visual_style=asset.visual_style,
        style=asset.style,
        image_row=image_row,
        template_id=asset.prompt_template_id,
        reference_instruction=reference_instruction,
        options=options,
    )
    return AssetImageBaseDraft(
        entity_type=asset_type.strip().lower(),
        entity_id=asset_id,
        image_id=relation_entity_id,
        relation_type=relation_type,
        relation_entity_id=str(relation_entity_id),
        prompt=prompt,
        default_images=refs,
        template_id=template_id,
        template_version=template_version,
        merged_variables=merged_variables,
    )


async def build_character_image_base_draft(
    db,
    *,
    character_id: str,
    image_id: int | None,
    options: AssetPromptOptions | None = None,
) -> AssetImageBaseDraft:
    """读取资产与最终参考图，再生成可审计的完整提示词。"""
    options = options or AssetPromptOptions()
    character = await db.get(Character, character_id)
    if character is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Character"))
    image_row = await validate_character_image(db, character_id=character_id, image_id=image_id)
    references: list[AssetPromptReference] = []
    descriptions = ["角色语境：" + character.description] if character.description else []
    sources = []
    if character.actor_id:
        sources.append((Actor, ActorImage, "actor_id", character.actor_id, "identity", "演员设定"))
    if character.costume_id:
        sources.append((Costume, CostumeImage, "costume_id", character.costume_id, "costume", "服装设定"))
    links = (await db.execute(select(CharacterPropLink).where(CharacterPropLink.character_id == character_id).order_by(CharacterPropLink.index))).scalars().all()
    sources.extend((Prop, PropImage, "prop_id", link.prop_id, "prop", "道具设定") for link in links)
    for model, image_model, parent_field, parent_id, role, label in sources:
        asset = await db.get(model, parent_id)
        if asset:
            descriptions.append(f"{label}（{asset.name}）：{asset.description}")
        file_ids = await pick_ordered_ref_file_ids(
            db, image_model=image_model, parent_field_name=parent_field,
            parent_id=parent_id, view_angles=(AssetViewAngle.front, AssetViewAngle.left, AssetViewAngle.right, AssetViewAngle.back),
        )
        references.extend(AssetPromptReference(file_id=file_id, role=role) for file_id in file_ids)
    options = _resolve_edit_options(options, image_row)
    refs, reference_instruction = await resolve_prompt_references(
        db, options.references if options.references is not None else references,
    )
    prompt, template_id, template_version, merged_variables = await _build_asset_prompt(
        db,
        relation_type="character_image",
        name=character.name,
        description="\n".join(descriptions),
        tags=None,
        visual_style=character.visual_style,
        style=character.style,
        image_row=image_row,
        # Character 组合资产当前没有独立模板绑定字段；使用该类别默认模板。
        template_id=None,
        reference_instruction=reference_instruction,
        options=options,
    )
    return AssetImageBaseDraft(
        entity_type="character",
        entity_id=character_id,
        image_id=image_row.id,
        relation_type="character_image",
        relation_entity_id=str(image_row.id),
        prompt=prompt,
        default_images=refs,
        template_id=template_id,
        template_version=template_version,
        merged_variables=merged_variables,
    )
