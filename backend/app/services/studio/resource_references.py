"""对象参考图片的归属、类别和项目关联规则。"""

from fastapi import HTTPException
from sqlalchemy import select

from app.services.studio.entity_specs import entity_spec
from app.services.studio.files import require_available_file


async def validate_resource_references(db, kind, project_id, references):
    """校验明确图片来源；选择参考不创建资产或项目关联。"""
    subjects, costumes = set(), set()
    allowed_roles = {
        "actor": {"identity", "design", "style"},
        "character": {"identity", "design", "style", "costume", "prop"},
        "scene": {"layout", "design", "style"},
        "prop": {"prop", "design", "style"},
        "costume": {"costume", "design", "style"},
    }
    for reference in references:
        if reference["role"] not in allowed_roles[kind]:
            raise HTTPException(400, "参考用途不适用于当前对象类别")
        await require_available_file(db, file_id=reference["file_id"], expected_type="image")
        source_kind, source_id = reference.get("source_kind"), reference.get("source_id")
        if bool(source_kind) != bool(source_id):
            raise HTTPException(400, "参考来源类别和对象必须同时提供")
        if not source_kind:
            if reference.get("source_image_id") is not None:
                raise HTTPException(400, "选择对象图片时必须明确来源对象")
            continue
        spec = entity_spec(source_kind)
        source = await db.get(spec.model, source_id)
        if source is None:
            raise HTTPException(400, "参考来源对象不存在")
        if source.project_id is not None and source.project_id != project_id:
            raise HTTPException(400, "不能使用其他项目的专属参考")
        role = reference["role"]
        if kind == "character" and role in {"costume", "prop"}:
            if source_kind != role:
                raise HTTPException(400, "参考服装和道具必须选择相应类别")
            if role == "costume":
                costumes.add(source_id)
        else:
            allowed = {"actor", "character"} if kind in {"actor", "character"} else {kind}
            if source_kind not in allowed:
                raise HTTPException(400, "参考主体类别不匹配")
            subjects.add((source_kind, source_id))
        query = select(spec.image_model).where(
            getattr(spec.image_model, spec.id_field) == source_id,
            spec.image_model.file_id == reference["file_id"],
        )
        if reference.get("source_image_id") is not None:
            query = query.where(spec.image_model.id == reference["source_image_id"])
        if reference.get("view_angle") is not None:
            query = query.where(spec.image_model.view_angle == reference["view_angle"])
        image = await db.scalar(query.limit(1))
        if image is None:
            raise HTTPException(400, "参考图片不属于所选对象")
    if len(subjects) > 1 or len(costumes) > 1:
        raise HTTPException(400, "最多选择一个参考主体和一项参考服装")
