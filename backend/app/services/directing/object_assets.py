"""场次对象的共享资产选用：保留项目角色身份与图片真实来源。"""
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select

from app.core.contracts.directing.workspace import AssetReferenceImage
from app.models.studio import Actor, Character, Project
from app.schemas.studio.project_assets import ProjectAssetLinkCreate
from app.services.studio.entity_specs import entity_spec
from app.services.studio.project_assets import create_project_asset_link


async def reference_images(db, kind, asset_ids):
    """批量读取真实视角；同角度最后一个槽位与资产详情展示一致。"""
    from app.models.studio import FileItem
    spec = entity_spec(kind)
    model = spec.image_model
    rows = await db.execute(select(model, FileItem).outerjoin(FileItem, FileItem.id == model.file_id)
        .where(getattr(model, spec.id_field).in_(asset_ids)).order_by(model.id.desc()))
    result = {id_: ([], 0) for id_ in asset_ids}
    for slot, file in rows:
        asset_id = getattr(slot, spec.id_field)
        images, unavailable = result[asset_id]
        if not slot.file_id:
            continue
        if file is None or file.type != 'image' or file.delete_requested_at or file.deleted_at:
            result[asset_id] = (images, unavailable + 1)
            continue
        images.append(AssetReferenceImage(file_id=file.id, view_angle=slot.view_angle,
            source_kind=kind, source_id=asset_id, slot_id=slot.id))
    return result


async def select_actor(db, project_id, sequence_id, candidate, actor_id):
    """同对象同演员使用稳定角色身份，不按同名或相同演员合并其他角色。"""
    actor = await db.get(Actor, actor_id)
    if actor is None:
        raise ValueError('演员不存在')
    project = await db.get(Project, project_id)
    role_id = uuid5(NAMESPACE_URL, f'object-role:{project_id}:{sequence_id}:{candidate.id}:{actor_id}').hex
    role = await db.get(Character, role_id)
    if role is None:
        from fastapi import HTTPException
        existing = await db.scalar(select(Character.id).where(Character.project_id == project_id, Character.name == candidate.name))
        if existing:
            raise HTTPException(409, '项目已有同名角色，请明确选择已有角色，或先调整角色名称')
        role = Character(id=role_id, project_id=project_id, name=candidate.name, description=candidate.description,
            actor_id=actor_id, style=project.style, visual_style=project.visual_style)
        db.add(role)
        await db.flush()
    if role.actor_id != actor_id:
        from app.services.directing.store import RevisionConflict
        raise RevisionConflict('原项目角色已更换演员，请明确选择角色或编辑其共享组合')
    await create_project_asset_link(db, entity_type='actor',
        body=ProjectAssetLinkCreate(project_id=project_id, asset_id=actor_id))
    return role.id


async def character_composition(db, project_id, character_id, body=None):
    """读取或原子保存共享组合；重复相同目标安全，旧依据不得覆盖新编辑。"""
    import hashlib
    import json
    from fastapi import HTTPException
    from sqlalchemy import delete
    from app.core.contracts.directing.scene_objects import CharacterComposition
    from app.models.studio import CharacterPropLink
    from app.services.directing.store import RevisionConflict

    if body is not None:
        if db.get_bind().dialect.name == 'sqlite':
            from sqlalchemy import update
            await db.execute(update(Project).where(Project.id == project_id).values(name=Project.name, updated_at=Project.updated_at))
        else:
            await db.scalar(select(Project).where(Project.id == project_id).with_for_update())
    role = await db.scalar(select(Character).where(Character.id == character_id,
        Character.project_id == project_id).with_for_update())
    if role is None:
        raise HTTPException(404, '项目角色不存在')
    props = list(await db.scalars(select(CharacterPropLink.prop_id).where(
        CharacterPropLink.character_id == character_id).order_by(CharacterPropLink.index)))
    values = {'actor_id': role.actor_id, 'costume_id': role.costume_id, 'prop_ids': props}
    revision = hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()
    if body is None:
        return CharacterComposition(revision=revision, **values)
    target = {'actor_id': body.actor_id, 'costume_id': body.costume_id, 'prop_ids': body.prop_ids}
    if len(set(body.prop_ids)) != len(body.prop_ids):
        raise ValueError('角色道具不能重复')
    if body.expected_revision != revision and target != values:
        raise RevisionConflict('角色组合已变化，请重新读取后保存')
    for kind, asset_id in [('actor', body.actor_id), ('costume', body.costume_id), *[('prop', id_) for id_ in body.prop_ids]]:
        if asset_id:
            await create_project_asset_link(db, entity_type=kind,
                body=ProjectAssetLinkCreate(project_id=project_id, asset_id=asset_id))
    if target != values:
        role.actor_id = body.actor_id
        role.costume_id = body.costume_id
        await db.execute(delete(CharacterPropLink).where(CharacterPropLink.character_id == character_id))
        await db.flush()
        db.add_all([CharacterPropLink(character_id=character_id, prop_id=id_, index=index)
                    for index, id_ in enumerate(body.prop_ids)])
        await db.flush()
    return await character_composition(db, project_id, character_id)
