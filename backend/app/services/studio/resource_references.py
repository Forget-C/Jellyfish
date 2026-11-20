"""对象参考图片的归属、类别和项目关联规则。"""

from fastapi import HTTPException
from sqlalchemy import select

from app.services.studio.entity_specs import entity_spec
from app.services.studio.files import require_available_file


async def validate_resource_references(db, kind, project_id, references, *, saving=False):
    """校验明确图片来源；选择参考不创建资产或项目关联。"""
    subjects, costumes = set(), set()
    allowed_roles = {
        "actor": {"identity", "design", "style"},
        "character": {"identity", "design", "style", "costume", "prop"},
        "scene": {"layout", "design", "style"},
        "prop": {"prop", "design", "style"},
        "costume": {"costume", "design", "style"},
    }
    if saving:
        sources = sorted({(item["source_kind"], item["source_id"]) for item in references if item.get("source_kind")})
        for source_kind, source_id in sources:
            if await db.get(entity_spec(source_kind).model, source_id, with_for_update=True, populate_existing=True) is None:
                raise HTTPException(400, "参考来源对象不存在")
    for reference in sorted(references, key=lambda item: item["file_id"]):
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


async def require_no_saved_references(db, match, *, label):
    """Find current owners of the exact saved reference, once per asset even for multiple roles."""
    import json
    from sqlalchemy import exists, func
    from app.models.studio import Project

    owners = []
    for kind, title in (("actor", "演员"), ("character", "角色"), ("scene", "场所"), ("prop", "道具"), ("costume", "服装")):
        model = entity_spec(kind).model
        if db.get_bind().dialect.name == "sqlite":
            entries = func.json_each(model.references).table_valued("value")
            contains = exists(select(1).select_from(entries).where(*(
                func.json_extract(entries.c.value, "$." + key) == value for key, value in match.items()
            )).correlate(model))
        else:
            contains = func.json_contains(model.references, json.dumps(match))
        query = select(Project.name, model.name).select_from(model).outerjoin(
            Project, Project.id == model.project_id).where(contains).order_by(model.project_id, model.id)
        for project, name in (await db.execute(query)).all():
            scope = f"项目《{project}》" if project is not None else "共享库"
            owners.append(f"{scope} › {title}「{name}」")
    if owners:
        raise HTTPException(409, f"{label}仍被 {len(owners)} 个对象用作长期参考：{'、'.join(owners)}。请先在对象的参考区更换或移除图片。")
