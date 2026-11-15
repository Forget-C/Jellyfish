"""Read-only retirement preflight; exact approved keys never imply permission to expand deletion."""
from __future__ import annotations

import argparse
import asyncio
import json
import hashlib
import re
from pathlib import Path

from sqlalchemy import JSON, MetaData, select, text
from sqlalchemy.ext.asyncio import create_async_engine
from app.services.studio.shared_asset_retirement import references

CURRENT = frozenset({'directing_sequences', 'directing_scene_versions', 'generation_canvases'})
HISTORY = frozenset({
    'tasks', 'task_inputs', 'task_outputs', 'directing_revisions', 'directing_takes',
    'directing_actions', 'directing_revision_dependencies', 'directing_cut_frames',
    'directing_cut_take_references', 'directing_repair_plans', 'directing_seam_reviews',
    'directing_active_cuts', 'directing_batches', 'directing_batch_items',
    'directing_chapter_transitions', 'generation_canvas_run_nodes',
    'generation_canvas_result_sets', 'generation_canvas_current_outputs',
    'generation_canvas_events', 'generation_canvas_save_receipts',
    'generation_canvas_run_receipts', 'generation_canvas_runs',
})


def read_approval(path: Path) -> tuple[dict, list]:
    """Read only explicitly enumerated primary keys, never narrative counts or SQL."""
    content = path.read_text(encoding='utf-8')
    approved = {}
    for name, section in re.findall(r'^### (\w+)\n(.*?)(?=^### |\Z)', content, re.M | re.S):
        blocks = re.findall(r'```json\n(.*?)\n```', section, re.S)
        if blocks:
            if name not in HISTORY:
                raise ValueError(f'Unsupported historical table: {name}')
            approved[name] = json.loads(blocks[0])
    sources = [json.loads(block) for block in re.findall(r'```json\n(\{.*?\})\n```', content, re.S)
               if '"link_id"' in block]
    if not sources:
        raise ValueError('Approval must enumerate source links')
    return approved, sources


def identity(table, row):
    """Stable, typed primary keys support composite keys without global ID matching."""
    return tuple((column.name, row[column.name]) for column in table.primary_key.columns)


async def inspect_retirement(connection, approval, sources):
    """Expand FK and historical JSON dependencies for review, returning no business contents."""
    metadata = MetaData()
    await connection.run_sync(metadata.reflect)
    tables = metadata.tables
    rows = {name: [dict(row) for row in (await connection.execute(select(table))).mappings()]
            for name, table in tables.items() if name in HISTORY | CURRENT | {'chapters'}}
    wanted = {}
    missing = []
    for name, keys in approval.items():
        if name not in tables:
            missing.append({'table': name, 'reason': 'table absent'})
            continue
        wanted[name] = {identity(tables[name], key) for key in keys}
        actual = {identity(tables[name], row) for row in rows[name]}
        missing.extend({'table': name, 'pk': dict(key)} for key in wanted[name] - actual)
    source_drift, name_conflicts = [], []
    for source in sources:
        name = source['kind']
        entity = tables.get({'actor': 'actors', 'scene': 'scenes', 'prop': 'props', 'costume': 'costumes'}[name])
        link = tables.get(f'project_{name}_links')
        if entity is None or link is None:
            source_drift.append({'kind': name, 'asset_id': source['asset_id'], 'reason': 'source schema absent'})
            continue
        original_row = (await connection.execute(select(entity.c.id, entity.c.name, entity.c.project_id)
                        .where(entity.c.id == source['asset_id']))).mappings().one_or_none()
        relationship = (await connection.execute(select(link).where(link.c.id == source['link_id']))).mappings().one_or_none()
        if original_row is None or original_row['project_id'] is not None or relationship is None or (
                relationship['project_id'] != source['project_id'] or relationship[f'{name}_id'] != source['asset_id']):
            source_drift.append({'kind': name, 'asset_id': source['asset_id'], 'reason': 'source identity changed'})
            continue
        copy_name = source.get('copy_name', original_row['name'])
        if not isinstance(copy_name, str) or not copy_name.strip() or len(copy_name) > 255:
            source_drift.append({'kind': name, 'asset_id': source['asset_id'], 'reason': 'invalid copy name'})
            continue
        conflict = (await connection.execute(select(entity.c.id).where(
            entity.c.project_id == source['project_id'], entity.c.name == copy_name))).scalar_one_or_none()
        if conflict:
            name_conflicts.append({'kind': name, 'project_id': source['project_id'], 'source_id': source['asset_id'],
                                   'existing_id': conflict, 'name': copy_name})
    original = {name: set(keys) for name, keys in wanted.items()}
    projects = {source['project_id'] for source in sources}
    by_id = {name: {row['id']: row for row in values if 'id' in row} for name, values in rows.items()}

    def project_of(name, row, visited=frozenset()):
        if name in visited:
            return None
        if row.get('project_id'):
            return row['project_id']
        for field, parent in (('chapter_id', 'chapters'), ('sequence_id', 'directing_sequences'),
                              ('canvas_id', 'generation_canvases'), ('task_id', 'tasks'),
                              ('revision_id', 'directing_revisions'), ('run_id', 'generation_canvas_runs')):
            if row.get(field) in by_id.get(parent, {}):
                return project_of(parent, by_id[parent][row[field]], visited | {name})
        return None

    changed = True
    while changed:
        changed = False
        ids = {dict(key)['id'] for keys in wanted.values() for key in keys if 'id' in dict(key)}
        for name in HISTORY & rows.keys():
            table = tables[name]
            for row in rows[name]:
                key = identity(table, row)
                if key in wanted.get(name, set()):
                    continue
                hit = any(references(row[column.name], ids) for column in table.c if isinstance(column.type, JSON))
                for constraint in table.foreign_key_constraints:
                    parent = constraint.referred_table.name
                    for parent_row in rows.get(parent, []):
                        if identity(tables[parent], parent_row) not in wanted.get(parent, set()):
                            continue
                        if all(row[element.parent.name] is not None and
                               row[element.parent.name] == parent_row[element.column.name]
                               for element in constraint.elements):
                            hit = True
                            break
                if hit and project_of(name, row) in projects:
                    wanted.setdefault(name, set()).add(key)
                    changed = True
    ids = {dict(key)['id'] for keys in wanted.values() for key in keys if 'id' in dict(key)}
    current = []
    for name in CURRENT:
        for row in rows.get(name, []):
            if project_of(name, row) not in projects:
                continue
            paths = {column.name: references(row[column.name], ids)
                     for column in tables[name].c if isinstance(column.type, JSON)}
            paths = {key: value for key, value in paths.items() if value}
            if paths:
                current.append({'table': name, 'pk': dict(identity(tables[name], row)), 'paths': paths})
    unclassified = []
    for name, table in tables.items():
        if name in HISTORY | CURRENT or 'backup' in name:
            continue
        columns = [column for column in table.c if isinstance(column.type, JSON)]
        primary = list(table.primary_key.columns)
        if columns and primary:
            for row in (await connection.execute(select(*primary, *columns))).mappings():
                paths = {column.name: references(row[column.name], ids) for column in columns}
                paths = {key: value for key, value in paths.items() if value}
                if paths:
                    unclassified.append({'table': name, 'pk': dict(identity(table, row)), 'paths': paths})
        for constraint in table.foreign_key_constraints:
            parent = constraint.referred_table.name
            for parent_row in rows.get(parent, []):
                if identity(tables[parent], parent_row) not in wanted.get(parent, set()):
                    continue
                condition = [element.parent == parent_row[element.column.name] for element in constraint.elements]
                for row in (await connection.execute(select(*primary).where(*condition))).mappings():
                    unclassified.append({'table': name, 'pk': dict(identity(table, row)), 'foreign_parent': parent})
    current.sort(key=lambda item: (item['table'], str(item['pk'])))
    additions = {name: [dict(key) for key in sorted(keys - original.get(name, set()), key=str)]
                 for name, keys in wanted.items() if keys - original.get(name, set())}
    release_usages = []
    revisions = {dict(key)['id'] for key in wanted.get('directing_revisions', set())}
    takes = {dict(key)['id'] for key in wanted.get('directing_takes', set())}
    nodes = {dict(key)['id'] for key in wanted.get('generation_canvas_run_nodes', set())}
    usage = tables.get('file_usages')
    if usage is not None:
        for row in (await connection.execute(select(usage))).mappings():
            parts = row['source_ref'].split(':')
            historical = (row['usage_kind'] == 'directing_reference' and row['source_ref'] in revisions or
                          row['usage_kind'] == 'directing_take' and row['source_ref'] in takes or
                          row['usage_kind'] in {'canvas_run', 'canvas_history'} and len(parts) >= 2 and parts[1] in nodes)
            if row['project_id'] in projects and historical:
                release_usages.append({'id': row['id']})
    release_usages.sort(key=lambda key: key['id'])
    active = [row['id'] for row in rows.get('tasks', []) if row.get('project_id') in projects and
              row.get('status') not in {'succeeded', 'failed', 'cancelled'}]
    return {'read_only': True, 'ready_to_apply': False, 'approved_counts': {k: len(v) for k, v in original.items()},
            'expanded_counts': {k: len(v) for k, v in wanted.items()}, 'additional_history': additions,
            'current_history_references': current, 'missing_approved_rows': missing, 'active_tasks': active,
            'source_drift': source_drift, 'name_conflicts': name_conflicts,
            'unclassified_references': unclassified, 'release_file_usages': release_usages,
            'reason': 'Read-only report; execution requires the separately reviewed exact-plan command and adoption policy.'}


async def run(args):
    """Use a READ ONLY transaction on MySQL; SQLite supports isolated command tests."""
    from app.config import settings  # pylint: disable=import-outside-toplevel
    engine = create_async_engine(args.database_url or settings.database_url)
    try:
        async with engine.connect() as connection:
            if connection.dialect.name == 'mysql':
                await connection.execute(text('SET TRANSACTION READ ONLY'))
                await connection.commit()
            result = await inspect_retirement(connection, *read_approval(Path(args.approval)))
            result['approval_sha256'] = hashlib.sha256(Path(args.approval).read_bytes()).hexdigest()
            await connection.rollback()
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'ready_to_apply': result['ready_to_apply'], 'expanded_counts': result['expanded_counts'],
                          'output': args.output}, ensure_ascii=False))
    finally:
        await engine.dispose()


def main():
    """Reporting never applies changes; execution uses the separate exact-plan maintenance command."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approval', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--database-url', help='Only for an isolated test database; defaults to application settings')
    asyncio.run(run(parser.parse_args()))


if __name__ == '__main__':
    main()
