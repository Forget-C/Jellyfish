"""显式退出场次单图准备；计划只包含身份和摘要，不保存业务正文。"""
from copy import deepcopy
import hashlib
import json

from sqlalchemy import delete, select
from pydantic import ValidationError

from app.core.contracts.directing.scene_objects import SceneObjectCandidate
from app.models.directing import Sequence
from app.models.studio import Chapter, FileItem, FileUsage
from app.services.studio.entity_specs import entity_spec


def digest(value):
    """固定计划针对完整 JSON 的摘要，防止审批后静默扩大操作范围。"""
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def converted(preparation, actions):
    """只改变计划中的对象字段，保留提取信息和其他准备元数据。"""
    result = deepcopy(preparation)
    objects = []
    for item, action in zip(result['objects'], actions, strict=True):
        if action['action'] == 'remove_conflict':
            continue
        item.pop('image_file_id', None)
        item.pop('reference_source', None)
        if action['action'] == 'clear_conflict':
            item['asset_id'] = None
        objects.append(item)
    result['objects'] = objects
    result['revision'] += 1
    return result


async def preflight(db, *, lock=False):
    """枚举精确的单图字段转换、成员补入和本场保护释放，不删除文件。"""
    statement = select(Sequence, Chapter.project_id).join(Chapter, Chapter.id == Sequence.chapter_id).order_by(Sequence.id)
    if lock:
        statement = statement.with_for_update()
    plan = {'sequences': [], 'release_usages': [], 'retained_usages': []}
    relevant_files = set()
    for sequence, project_id in (await db.execute(statement)).all():
        prep = sequence.object_preparation
        if not isinstance(prep, dict) or not isinstance(prep.get('objects'), list):
            continue
        if not any(isinstance(item, dict) and ('image_file_id' in item or 'reference_source' in item) for item in prep['objects']):
            continue
        actions = []
        for item in prep['objects']:
            action = {'object_id': item.get('id') if isinstance(item, dict) else None, 'action': 'convert'}
            actions.append(action)
            candidate = {key: value for key, value in item.items() if key not in {'image_file_id', 'reference_source'}} if isinstance(item, dict) else {}
            try:
                SceneObjectCandidate.model_validate(candidate)
            except ValidationError:
                action['action'] = 'remove_conflict'
                continue
            resource = file = None
            spec = entity_spec(item['kind'])
            if item.get('asset_id'):
                resource = await db.get(spec.model, item['asset_id'], with_for_update=lock)
                if not resource or resource.project_id != project_id:
                    action['action'] = 'clear_conflict'
                    resource = None
            file_id = item.get('image_file_id')
            if file_id:
                relevant_files.add(file_id)
                file = await db.get(FileItem, file_id, with_for_update=lock)
            source_ref = f"scene-object:{sequence.id}:{item['id']}"
            usages = list(await db.scalars(select(FileUsage).where(FileUsage.project_id == project_id,
                FileUsage.chapter_id == sequence.chapter_id, FileUsage.source_ref == source_ref)))
            relevant_files.update(usage.file_id for usage in usages)
            plan['release_usages'].extend(usage.id for usage in usages if usage.usage_kind == 'directing_reference')
            if file_id and resource:
                member = await db.scalar(select(spec.image_model).where(
                    getattr(spec.image_model, spec.id_field) == resource.id, spec.image_model.file_id == file_id))
                if member is None:
                    owned = any(usage.file_id == file_id and usage.usage_kind in {'generation_upload', 'directing_reference'} for usage in usages)
                    valid = file and file.type == 'image' and not file.deleted_at and not file.delete_requested_at
                    if owned and valid:
                        action.update(action='add_member', kind=item['kind'], asset_id=resource.id, file_id=file_id)
                    else:
                        action.update(action='clear_conflict', reason='unverified_image_ownership')
        after = converted(prep, actions)
        plan['sequences'].append({'sequence_id': sequence.id, 'project_id': project_id,
            'revision': prep['revision'], 'before_sha256': digest(prep), 'after_sha256': digest(after), 'objects': actions})
    plan['release_usages'].sort()
    if relevant_files:
        plan['retained_usages'] = sorted(usage.id for usage in await db.scalars(select(FileUsage)
            .where(FileUsage.file_id.in_(relevant_files))) if usage.id not in plan['release_usages'])
    return plan


async def apply_plan(db, plan):
    """仅执行重新核验一致的完整计划；由调用方事务提交，失败整体回滚。"""
    if not plan['sequences']:
        return {'already_applied': True}
    current = await preflight(db, lock=True)
    if not current['sequences']:
        rows = [await db.get(Sequence, item['sequence_id']) for item in plan['sequences']]
        if all(row and digest(row.object_preparation) == item['after_sha256'] for row, item in zip(rows, plan['sequences'], strict=True)):
            return {'already_applied': True}
    if current != plan:
        raise ValueError('对象准备或文件保护已变化，请重新预检并确认计划')
    added = set()
    for item in plan['sequences']:
        sequence = await db.get(Sequence, item['sequence_id'])
        for action in item['objects']:
            if action['action'] != 'add_member':
                continue
            identity = (action['kind'], action['asset_id'], action['file_id'])
            if identity in added:
                continue
            added.add(identity)
            spec = entity_spec(action['kind'])
            # 加入成员不篡改当前主图／视角默认，待详情明确维护。
            db.add(spec.image_model(**{spec.id_field: action['asset_id'], 'file_id': action['file_id'],
                'is_primary': False, 'is_view_default': False}))
        sequence.object_preparation = converted(sequence.object_preparation, item['objects'])
    if plan['release_usages']:
        await db.execute(delete(FileUsage).where(FileUsage.id.in_(plan['release_usages'])))
    await db.flush()
    return {'already_applied': False, 'sequences': len(plan['sequences']), 'released_usages': len(plan['release_usages'])}
