"""Apply an explicitly approved shared-asset retirement plan in one transaction."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import socket
from pathlib import Path

from sqlalchemy import MetaData, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.scripts.shared_asset_preflight import inspect_retirement, read_approval
from app.services.studio.shared_asset_retirement import copy_id, copy_mapping, key_condition, retire


def merged_scope(approval, plan):
    """The reviewed expansion is an allowlist, never an instruction to discover more deletions."""
    result = {name: list(keys) for name, keys in approval.items()}
    for name, keys in plan['additional_history'].items():
        result.setdefault(name, []).extend(key for key in keys if key not in result.get(name, []))
    return result


async def completed(db, tables, sources, approved):
    """A committed run can be retried without recopying files or deleting later history."""
    for source in sources:
        table = tables[f"project_{source['kind']}_links"]
        link = (await db.execute(select(table).where(table.c.id == source['link_id']))).mappings().one_or_none()
        if not link or link[f"{source['kind']}_id"] != copy_id(source) or link['project_id'] != source['project_id']:
            return False
        entity = tables[{'actor': 'actors', 'scene': 'scenes', 'prop': 'props', 'costume': 'costumes'}[source['kind']]]
        copy = (await db.execute(select(entity.c.id).where(entity.c.id == copy_id(source),
                entity.c.project_id == source['project_id'], entity.c.source_id == source['asset_id']))).scalar_one_or_none()
        if copy is None:
            return False
    for name, keys in approved.items():
        for key in keys:
            if (await db.execute(select(tables[name]).where(key_condition(tables[name], key)))).first():
                return False
    return True


async def backup_rows(db, metadata, path, plan_hash):
    """Keep a private recovery copy of affected table rows; never emit their contents."""
    names = set(metadata.tables) & {
        'actors', 'characters', 'scenes', 'props', 'costumes', 'actor_images', 'scene_images', 'prop_images',
        'costume_images', 'project_actor_links', 'project_scene_links', 'project_prop_links', 'project_costume_links',
        'directing_sequences', 'directing_scene_versions', 'file_usages', 'generation_canvases',
        'generation_canvas_event_heads', 'generation_canvas_events', 'files',
    }
    # Include every mutable history table explicitly; no provider/credential tables are backed up.
    from app.scripts.shared_asset_preflight import HISTORY  # pylint: disable=import-outside-toplevel
    names |= HISTORY & metadata.tables.keys()
    data = {name: [dict(row) for row in (await db.execute(select(metadata.tables[name]))).mappings()]
            for name in sorted(names)}
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump({'plan_sha256': plan_hash, 'tables': data}, stream, ensure_ascii=False, default=str)
        stream.flush()
        os.fsync(stream.fileno())


async def run(args):
    """Lock project writers, recheck exact scope, save recovery data, then commit atomically."""
    if not args.maintenance_window:
        raise ValueError('Explicit --maintenance-window is required; stop API and Worker first')
    if not args.detach_adoption:
        raise ValueError('Explicit --detach-adoption is required for the reviewed current-state change')
    raw = Path(args.plan).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != args.plan_sha256:
        raise ValueError('Approved plan hash mismatch')
    plan = json.loads(raw)
    if plan.get('approval_sha256') != hashlib.sha256(Path(args.approval).read_bytes()).hexdigest():
        raise ValueError('Original approval hash mismatch')
    approval, sources = read_approval(Path(args.approval))
    approved = merged_scope(approval, plan)
    from app.config import settings  # pylint: disable=import-outside-toplevel
    engine = create_async_engine(args.database_url or settings.database_url)
    if engine.dialect.name == 'mysql':
        with socket.socket() as probe:
            probe.settimeout(1)
            if probe.connect_ex(('127.0.0.1', 8000)) == 0:
                await engine.dispose()
                raise ValueError('Local API is still listening; stop writers before maintenance')
        if not args.worker_pid:
            await engine.dispose()
            raise ValueError('Provide the stopped local worker PID for the maintenance check')
        for pid in args.worker_pid:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                continue
            await engine.dispose()
            raise ValueError('Worker process is still present; stop it before maintenance')
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            async with db.begin():
                metadata = MetaData()
                connection = await db.connection()
                await connection.run_sync(metadata.reflect)
                projects = {source['project_id'] for source in sources}
                table = metadata.tables['projects']
                await db.execute(select(table).where(table.c.id.in_(projects)).order_by(table.c.id).with_for_update())
                if await completed(db, metadata.tables, sources, approved):
                    result = {'already_completed': True, 'copies': copy_mapping(sources)}
                else:
                    current = await inspect_retirement(connection, approval, sources)
                    for key in ('expanded_counts', 'additional_history', 'current_history_references',
                                'missing_approved_rows', 'source_drift', 'name_conflicts', 'unclassified_references', 'release_file_usages', 'active_tasks'):
                        if current.get(key) != plan.get(key):
                            raise ValueError(f'Preflight changed: {key}; no data will be modified')
                    if any(field not in {'content', 'document', 'object_preparation'} for item in current['current_history_references'] for field in item['paths']):
                        raise ValueError('Unsupported current metadata provenance; no changes applied')
                    if any(current[key] for key in ('missing_approved_rows', 'source_drift', 'name_conflicts',
                                                    'unclassified_references', 'active_tasks')):
                        raise ValueError('Preflight has unresolved blockers')
                    await backup_rows(db, metadata, args.backup, digest)
                    scope = {**approved, 'file_usages': plan.get('release_file_usages', [])}
                    result = await retire(db, sources, scope)
            Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print(json.dumps({'committed': True, 'already_completed': result.get('already_completed', False),
                              'output': args.output, 'backup': args.backup}, ensure_ascii=False))
    finally:
        await engine.dispose()


def main():
    """The explicit digest and adoption flag bind execution to the user's reviewed plan."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approval', required=True)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--detach-adoption', action='store_true')
    parser.add_argument('--maintenance-window', action='store_true')
    parser.add_argument('--worker-pid', action='append', type=int)
    parser.add_argument('--database-url', help='Isolated test database override; defaults to application settings')
    asyncio.run(run(parser.parse_args()))


if __name__ == '__main__':
    main()
