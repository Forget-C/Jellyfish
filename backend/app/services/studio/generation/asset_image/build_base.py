from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from jinja2 import Environment, TemplateError, meta
from pydantic import Field
from sqlalchemy import select

from app.core.contracts.asset_prompts import AssetPromptOptions, AssetPromptReference, DISPLAY_FIELDS, validate_display_overrides
from app.services.studio.generation.asset_image.prompt_rules import ASSET_TEMPLATE, PURPOSES, DISPLAY_DEFAULTS, resolve_prompt_references
from app.services.studio.generation.shared.types import GenerationBaseDraft

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
        variables["purpose"] = "局部修改参考图。仅改变：" + options.edit_instruction + "。保持：" + (options.preserve_instruction or "其余主体身份、服装、物体结构、构图和背景") + "。结果新增到原视角文件夹，保留原图。"
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


async def resolve_source_options(db, entity_type, asset, options):
    """图片来源必须有主体参考，风格属于单次生成而非不可编辑的档案。"""
    if ((asset.origin or "created") == "created" and not getattr(asset, "source_character_id", None)) or getattr(asset, "details_editable", False):
        if options.style is not None or options.visual_style is not None:
            raise HTTPException(422, "设定创建对象的风格由档案维护")
        return options
    from app.services.studio.entity_specs import entity_spec  # pylint: disable=import-outside-toplevel
    from app.models.studio import Project, ProjectStyle, ProjectVisualStyle  # pylint: disable=import-outside-toplevel
    spec = entity_spec(entity_type)
    references = options.references
    if references is None:
        main = await db.scalar(select(spec.image_model).where(
            getattr(spec.image_model, spec.id_field) == asset.id,
            spec.image_model.is_primary.is_(True), spec.image_model.file_id.is_not(None)))
        references = [AssetPromptReference(file_id=main.file_id, role="design")] if main else []
    if not any(ref.role not in {"costume", "prop", "style"} for ref in references):
        raise HTTPException(422, "请选择有效主体参考图")
    project = await db.get(Project, asset.project_id) if asset.project_id else None
    style = project.style if project else asset.style
    visual_style = project.visual_style if project else asset.visual_style
    if project is None and getattr(asset, "source_character_id", None):
        style, visual_style = ProjectStyle.real_people_city, ProjectVisualStyle.live_action
    return options.model_copy(update={"references": references,
        "style": options.style or style, "visual_style": options.visual_style or visual_style})


async def build_resource_image_base_draft(db, *, entity_type, entity_id, image_id, options=None):
    """五类对象均使用自身设定与明确参考，不读取来源对象的文字或组合。"""
    from app.services.studio.entity_specs import entity_spec
    from app.services.studio.resource_references import validate_resource_references
    spec = entity_spec(entity_type)
    asset = await db.get(spec.model, entity_id)
    if asset is None:
        raise HTTPException(404, "对象不存在")
    if entity_type == "actor":
        image = await validate_actor_image(db, actor_id=entity_id, image_id=image_id)
    elif entity_type == "character":
        image = await validate_character_image(db, character_id=entity_id, image_id=image_id)
    else:
        slot, _ = await validate_asset_image_and_relation_type(db, asset_type=entity_type,
                                                             asset_id=entity_id, image_id=image_id)
        image = await db.get(spec.image_model, slot)
    options = await resolve_source_options(db, entity_type, asset, _resolve_edit_options(options or AssetPromptOptions(), image))
    references = options.references
    if options.mode == "edit" and not image.file_id:
        source = await db.scalar(select(spec.image_model.id).where(
            getattr(spec.image_model, spec.id_field) == entity_id,
            spec.image_model.file_id == references[0].file_id,
            spec.image_model.view_angle == image.view_angle,
        ).limit(1))
        if source is None:
            raise HTTPException(422, "局部修改必须继承当前对象源图片的视角")
    if references is None:
        references = [AssetPromptReference.model_validate(value) for value in asset.references]
    await validate_resource_references(db, entity_type, asset.project_id,
        [reference.model_dump(exclude_none=True) for reference in references])
    refs, instruction = await resolve_prompt_references(db, references)
    prompt, template_id, template_version, variables = await _build_asset_prompt(
        db, relation_type=f"{entity_type}_image", name=asset.name, description="" if getattr(asset, "source_character_id", None) and not asset.details_editable else asset.description,
        tags=getattr(asset, "tags", None), visual_style=options.visual_style or asset.visual_style, style=options.style or asset.style,
        image_row=image, template_id=getattr(asset, "prompt_template_id", None),
        reference_instruction=instruction, options=options,
    )
    return AssetImageBaseDraft(entity_type=entity_type, entity_id=entity_id, image_id=image.id,
        relation_type=f"{entity_type}_image", relation_entity_id=str(image.id), prompt=prompt,
        default_images=refs, template_id=template_id, template_version=template_version,
        merged_variables=variables)


async def build_actor_image_base_draft(db, *, actor_id, image_id, options=None):
    """构建演员图片输入。"""
    return await build_resource_image_base_draft(db, entity_type="actor", entity_id=actor_id,
                                                image_id=image_id, options=options)


async def build_asset_image_base_draft(db, *, asset_type, asset_id, image_id, options=None):
    """构建场所、道具或服装图片输入。"""
    return await build_resource_image_base_draft(db, entity_type=asset_type, entity_id=asset_id,
                                                image_id=image_id, options=options)


async def build_character_image_base_draft(db, *, character_id, image_id, options=None):
    """构建项目角色图片输入。"""
    return await build_resource_image_base_draft(db, entity_type="character", entity_id=character_id,
                                                image_id=image_id, options=options)
