"""One-off, explicitly scoped conversion of legacy library links into private project copies."""
from __future__ import annotations

from copy import deepcopy
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import MetaData, and_, delete, select, update

from app.schemas.generation_canvas import CanvasDocument
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.services.studio.entity_specs import entity_spec
from app.services.studio.resource_image_copies import copy_image_file


def references(value, ids, path=''):
    """Return exact JSON identity paths; never substring-match prose or rewrite content."""
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            found.extend(references(child, ids, f'{path}.{key}'))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(references(child, ids, f'{path}[{index}]'))
    elif isinstance(value, str) and value in ids:
        found.append(path)
    return found



def copy_id(source):
    """Stable identities make a committed maintenance run safe to replay."""
    return uuid5(NAMESPACE_URL, f"retire-shared:{source['project_id']}:{source['kind']}:{source['asset_id']}").hex



def copy_mapping(sources):
    """Retain a unique, deterministic restoration map on both first run and replay."""
    result = {}
    for source in sources:
        key = (source['project_id'], source['kind'], source['asset_id'])
        result[key] = {'project_id': source['project_id'], 'kind': source['kind'],
                       'source_id': source['asset_id'], 'copy_id': copy_id(source)}
    return list(result.values())

def key_condition(table, key):
    """All maintenance writes use exact, possibly composite primary keys."""
    if set(key) != {column.name for column in table.primary_key.columns}:
        raise ValueError(f'Invalid primary key for {table.name}')
    return and_(*(table.c[name] == value for name, value in key.items()))


def remap(value, assets, files, images, names):
    """Only typed asset/file fields change; prose, card identities and port bindings are preserved."""
    if isinstance(value, list):
        return [remap(item, assets, files, images, names) for item in value]
    if not isinstance(value, dict):
        return value
    result = deepcopy(value)
    source_id = value.get('source_id') or value.get('asset_id')
    for key, child in value.items():
        if key in {'asset_id', 'suggested_asset_id', 'source_id', 'location_asset_id',
                   'actor_id', 'scene_id', 'prop_id', 'costume_id'} and isinstance(child, str):
            result[key] = assets.get(child, child)
        elif key in {'file_id', 'image_file_id', 'cover_file_id'} and isinstance(child, str):
            result[key] = files.get(child, child)
        elif key == 'source_image_id' and (source_id, child) in images:
            result[key] = images[(source_id, child)]
        elif key == 'asset_origin' and isinstance(child, dict) and child.get('id') in assets:
            result[key] = {**child, 'id': assets[child['id']], 'name': names[child['id']]}
        else:
            result[key] = remap(child, assets, files, images, names)
    return result


def detach_history(document, removed, *, canvas):
    """Release explicitly approved current adoption/provenance, retaining editable content."""
    result = deepcopy(document)
    tasks = removed.get('tasks', set())
    takes = removed.get('directing_takes', set())
    revisions = removed.get('directing_revisions', set())
    nodes = removed.get('generation_canvas_run_nodes', set())
    sets = removed.get('generation_canvas_result_sets', set())
    if not canvas:
        if result.get('unit_design_task_id') in tasks:
            result['unit_design_task_id'] = None
        for unit in result.get('units', []):
            if unit.get('instruction_check_task_id') in tasks:
                unit['instruction_check_task_id'] = None
            unit['dependencies'] = [item for item in unit.get('dependencies', [])
                                    if item.get('plan_revision_id') not in revisions]
        result['take_judgments'] = [item for item in result.get('take_judgments', []) if item.get('take_id') not in takes]
        if result.get('timeline'):
            result['timeline']['items'] = [item for item in result['timeline'].get('items', [])
                                           if item.get('take_id') not in takes]
        return result
    storyboard = result.get('storyboard')
    if storyboard and storyboard.get('task_id') in tasks:
        result['storyboard'] = None
    elif storyboard and storyboard.get('continuity_check_task_id') in tasks:
        storyboard['continuity_check_task_id'] = None
    for card in result.get('cards', []):
        if (card.get('origin') or {}).get('node_id') in nodes:
            card['origin'] = None
        if 'detached_results' in card:
            card['detached_results'] = [item for item in card['detached_results'] if item.get('result_set_id') not in sets]
        binding = card.get('image_binding')
        if binding and binding.get('result_set_id') in sets:
            # The direct file remains the authoritative current image.
            binding['result_set_id'] = None
        frame = card.get('frame_origin')
        if frame:
            if (frame.get('result') or {}).get('node_id') in nodes:
                frame['result'] = None
            if frame.get('result_set_id') in sets:
                frame['result_set_id'] = None
    return result


async def clone_sources(db, sources):
    """Copy all structured facts and image slots, including empty historical slots."""
    maps, seen = {}, {}
    for source in sources:
        group = (source["project_id"], source["kind"], source["asset_id"])
        if group in seen:
            if seen[group] != (source["images"], source.get("copy_name")):
                raise ValueError("Inconsistent source images across chapters")
            continue
        seen[group] = (source["images"], source.get("copy_name"))
        spec = entity_spec(source['kind'])
        original = await db.get(spec.model, source['asset_id'], with_for_update=True)
        target_id = copy_id(source)
        if original is None or original.project_id is not None:
            raise ValueError('Library source changed')
        if await db.get(spec.model, target_id) is not None:
            raise ValueError('Unexpected pre-existing copy; inspect maintenance state')
        fields = {column.name: deepcopy(getattr(original, column.name)) for column in spec.model.__table__.c
                  if column.computed is None and column.name not in
                  {'id', 'project_id', 'created_at', 'updated_at', 'library_copy_id', 'source_request_hash'}}
        if source.get('copy_name') is not None:
            fields['name'] = source['copy_name']
        fields.update(project_id=source['project_id'], source_kind=source['kind'], source_id=source['asset_id'])
        db.add(spec.model(id=target_id, **fields))
        await db.flush()
        mapping = maps.setdefault(source['project_id'], {'assets': {}, 'files': {}, 'images': {}, 'names': {}})
        assets, files, images = mapping['assets'], mapping['files'], mapping['images']
        if source['asset_id'] in assets and assets[source['asset_id']] != target_id:
            raise ValueError('Source IDs collide across categories; typed remapping required')
        assets[source['asset_id']] = target_id
        mapping['names'][source['asset_id']] = fields['name']
        rows = list(await db.scalars(select(spec.image_model).where(
            getattr(spec.image_model, spec.id_field) == source['asset_id']).order_by(spec.image_model.id)))
        if [{'id': row.id, 'file_id': row.file_id} for row in rows] != source['images']:
            raise ValueError('Source image membership changed since approval')
        for row in rows:
            image_fields = {column.name: deepcopy(getattr(row, column.name)) for column in spec.image_model.__table__.c
                            if column.name not in {'id', spec.id_field, 'created_at', 'updated_at'}}
            if row.file_id:
                file = await copy_image_file(db, file_id=row.file_id,
                    copy_id=uuid5(NAMESPACE_URL, f'{target_id}:{row.file_id}').hex)
                if row.file_id in files and files[row.file_id] != file.id:
                    raise ValueError('Ambiguous shared file across source assets; typed mapping required')
                files[row.file_id] = file.id
                image_fields['file_id'] = file.id
            copied = spec.image_model(**{spec.id_field: target_id, **image_fields})
            db.add(copied)
            await db.flush()
            images[(source['asset_id'], row.id)] = copied.id
    return maps


async def delete_exact_history(db, tables, approved):
    """Check every live FK, then delete only approved rows in child-before-parent order."""
    pending = {}
    for name, keys in approved.items():
        table = tables[name]
        for key in keys:
            row = (await db.execute(select(table).where(key_condition(table, key)).with_for_update())).mappings().one_or_none()
            if row is None:
                raise ValueError(f'Approved history disappeared: {name}')
            pending[(name, tuple(key.items()))] = dict(row)
    children = {key: set() for key in pending}
    lookup = {(name, tuple(sorted(key))): node for node in pending for name, key in [node]}
    for parent_node, parent_row in pending.items():
        for table in tables.values():
            for constraint in table.foreign_key_constraints:
                if constraint.referred_table.name != parent_node[0]:
                    continue
                condition = and_(*(element.parent == parent_row[element.column.name] for element in constraint.elements))
                for row in (await db.execute(select(table).where(condition))).mappings():
                    key = tuple((column.name, row[column.name]) for column in table.primary_key.columns)
                    child = lookup.get((table.name, tuple(sorted(key))))
                    if child is None:
                        raise ValueError(f'Unapproved dependent row in {table.name}; refusing deletion')
                    if child != parent_node:
                        children[parent_node].add(child)
    while pending:
        leaves = [node for node in pending if not (children[node] & pending.keys())]
        if not leaves:
            raise ValueError('Cyclic historical dependencies; refusing deletion')
        for node in leaves:
            table = tables[node[0]]
            count = (await db.execute(delete(table).where(key_condition(table, dict(node[1]))))).rowcount
            if count != 1:
                raise ValueError('Historical scope changed during deletion')
            del pending[node]


async def convert_current(db, tables, sources, maps, removed):
    """Map project-owned current references and release only approved nullable history pointers."""
    changed_canvases = []
    chapters = {row.id: row.project_id for row in (await db.execute(select(tables['chapters']))).mappings()}
    sequences = {row.id: row.chapter_id for row in (await db.execute(select(tables['directing_sequences']))).mappings()}
    ids = set().union(*removed.values())
    for name, field in [('directing_sequences', 'object_preparation'), ('directing_scene_versions', 'content'),
                        ('generation_canvases', 'document')]:
        table = tables[name]
        for row in (await db.execute(select(table).with_for_update())).mappings():
            project = row.get('project_id') or chapters.get(row.get('chapter_id') or sequences.get(row.get('sequence_id')))
            if project not in maps or not row[field]:
                continue
            mapped = remap(row[field], **maps[project])
            if name != 'directing_sequences':
                mapped = detach_history(mapped, removed, canvas=name == 'generation_canvases')
            if mapped == row[field]:
                continue
            if references(mapped, ids | set(maps[project]['assets']) | set(maps[project]['files'])):
                raise ValueError(f'Unresolved current reference in {name}:{row["id"]}')
            if name == 'generation_canvases':
                CanvasDocument.model_validate(mapped)
                changed_canvases.append((project, row['id']))
            elif name == 'directing_scene_versions':
                SceneVersionContent.model_validate(mapped)
            elif 'revision' in mapped:
                mapped['revision'] += 1
            values = {field: mapped}
            if name != 'directing_sequences':
                values['revision'] = row['revision'] + 1
            if name == 'directing_scene_versions':
                values['last_save_request_id'] = None
            await db.execute(update(table).where(table.c.id == row['id']).values(**values))
    # Stored resource references are current configuration, not historical execution inputs.
    for kind in ('actor', 'character', 'scene', 'prop', 'costume'):
        spec = entity_spec(kind)
        for project, mapping in maps.items():
            for asset in await db.scalars(select(spec.model).where(spec.model.project_id == project).with_for_update()):
                asset.references = remap(asset.references, **mapping)
    # Preserve existing protection positions, changing only files referenced by live content.
    usage = tables['file_usages']
    current_versions = set((await db.execute(select(tables['directing_scene_versions'].c.id))).scalars())
    current_sequences = set(sequences)
    for project, mapping in maps.items():
        files = mapping['files']
        for row in (await db.execute(select(usage).where(usage.c.project_id == project).with_for_update())).mappings():
            ref = row['source_ref']
            current = (ref.startswith('scene-version:') and ref.removeprefix('scene-version:') in current_versions or
                       ref.startswith('scene-object:') and ref.split(':')[1] in current_sequences or
                       row['usage_kind'] == 'canvas_content' and any(ref.startswith(canvas + ':') for _, canvas in changed_canvases))
            if current and row['file_id'] in files:
                await db.execute(update(usage).where(usage.c.id == row['id']).values(file_id=files[row['file_id']]))
    for source in sources:
        table = tables[f"project_{source['kind']}_links"]
        count = (await db.execute(update(table).where(table.c.id == source['link_id'],
                table.c.project_id == source['project_id'], table.c[f"{source['kind']}_id"] == source['asset_id'])
                .values(**{f"{source['kind']}_id": copy_id(source)}))).rowcount
        if count != 1:
            raise ValueError('Approved project link changed')
    await db.flush()
    return changed_canvases


async def retire(db, sources, approved):
    """Caller owns the transaction and private backup; no physical file is deleted."""
    metadata = MetaData()
    connection = await db.connection()
    await connection.run_sync(metadata.reflect)
    tables = metadata.tables
    removed = {name: {key['id'] for key in keys if 'id' in key} for name, keys in approved.items()}
    maps = await clone_sources(db, sources)
    canvases = await convert_current(db, tables, sources, maps, removed)
    await delete_exact_history(db, tables, approved)
    # A fresh snapshot at a new monotonically increasing cursor repairs replay after pruning.
    from app.services.generation_canvas.events import append_event, event_head  # pylint: disable=import-outside-toplevel
    from app.services.generation_canvas.runtime import CanvasRuntime  # pylint: disable=import-outside-toplevel
    db.expire_all()
    for project, canvas in canvases:
        head = await event_head(db, canvas)
        snapshot = (await CanvasRuntime(db, project).snapshot(canvas)).model_dump(mode='json')
        snapshot['cursor'] = head.cursor + 1
        await append_event(db, head, 'snapshot', payload=snapshot)
    return {'copies': copy_mapping(sources)}
