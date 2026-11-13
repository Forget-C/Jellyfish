"""不落库的对象草稿生成预览。"""

from types import SimpleNamespace

from fastapi import HTTPException
from uuid import uuid4

from app.core.contracts.asset_prompts import AssetPromptReference
from app.core.contracts.media import ImageMediaInput, MediaReference
from app.services.generation.prompts.types import PromptRendererName, RenderedPromptSnapshot
from app.services.studio.entity_specs import entity_spec
from app.services.studio.resource_references import validate_resource_references
from app.services.studio.generation.asset_image.build_base import _build_asset_prompt, _resolve_edit_options
from app.services.studio.generation.asset_image.prompt_rules import resolve_prompt_references


async def render_draft_preview(db, *, entity_type, resource, view_angle, options, image_id=None):
    """复用正式生成的模板及参考校验，仅使用内存中的对象与视角。"""
    spec = entity_spec(entity_type)
    values = spec.create_model.model_validate(resource).model_dump(exclude={"chapter_id", "adopt_reference"})
    asset = spec.model(**values)
    saved = await db.get(spec.model, asset.id)
    if saved is not None:
        # 草稿覆盖事实，模板依据仍与正式提交保持一致。
        if getattr(saved, "source_character_id", None):
            raise HTTPException(403, "从角色转化的演员只能被引用")
        asset.prompt_template_id = getattr(saved, "prompt_template_id", None)
        asset.project_id = saved.project_id
    image = SimpleNamespace(view_angle=view_angle, prompt_overrides={}, file_id=None)
    if image_id is not None:
        image = await db.get(spec.image_model, image_id)
        if image is None or getattr(image, spec.id_field) != asset.id or image.view_angle != view_angle:
            raise HTTPException(400, "预览图片不属于当前对象和角度")
    options = _resolve_edit_options(options, image)
    references = options.references
    if references is None:
        references = [AssetPromptReference.model_validate(value) for value in values.get("references", [])]
    await validate_resource_references(db, entity_type, asset.project_id,
        [reference.model_dump(exclude_none=True) for reference in references])
    files, instruction = await resolve_prompt_references(db, references)
    prompt, template_id, version, variables = await _build_asset_prompt(db,
        relation_type=f"{entity_type}_image", name=asset.name, description=asset.description,
        tags=getattr(asset, "tags", None), visual_style=asset.visual_style, style=asset.style,
        image_row=image,
        template_id=getattr(asset, "prompt_template_id", None),
        reference_instruction=instruction, options=options)
    return RenderedPromptSnapshot(render_id=str(uuid4()), renderer=PromptRendererName.asset_image,
        execution_prompt=prompt, variables_snapshot=variables, template_id=template_id, template_version=version,
        recommended_media=ImageMediaInput(references=[MediaReference(file_id=file_id, media_kind="image", ordinal=i)
                                                     for i, file_id in enumerate(files)]))
