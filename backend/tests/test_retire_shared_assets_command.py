"""Validate the public maintenance command using an isolated database and public read APIs."""
import asyncio
import hashlib
import json
import subprocess
import sys
import pytest
from pathlib import Path

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Project, Scene, SceneImage, ProjectSceneLink, Chapter
from app.models.task import Task


@pytest.mark.parametrize("rename", [False, True])
def test_retirement_preserves_facts_empty_image_slots_and_is_idempotent(tmp_path, rename):
    url = f'sqlite+aiosqlite:///{tmp_path / "retirement.sqlite"}'

    async def seed():
        engine = create_async_engine(url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add(Project(id='project', name='项目', style='真人都市'))
            db.add(Scene(id='library', name='办公室', style='真人都市', supplementary_info='保留原有资料'))
            if rename:
                db.add(Scene(id='existing', name='办公室', project_id='project', style='真人都市', supplementary_info='不覆盖'))
            await db.flush()
            db.add_all([Chapter(id='a', project_id='project', index=1, title='第一章'), Chapter(id='b', project_id='project', index=2, title='第二章')])
            await db.flush()
            db.add(SceneImage(id=7, scene_id='library', view_angle='FRONT', is_view_default=True))
            db.add(ProjectSceneLink(id=1, project_id='project', chapter_id='a', scene_id='library'))
            db.add(ProjectSceneLink(id=2, project_id='project', chapter_id='b', scene_id='library'))
            db.add(Task(id='old-task', project_id='project', kind='image', status='succeeded', stage='done'))
            await db.commit()
        await engine.dispose()

    asyncio.run(seed())
    approval = tmp_path / 'approval.md'
    approval.write_text('''# Approved sources and history
```json
{"kind":"scene","link_id":1,"project_id":"project","asset_id":"library","images":[{"id":7,"file_id":null}]}
```
```json
{"kind":"scene","link_id":2,"project_id":"project","asset_id":"library","images":[{"id":7,"file_id":null}]}
```
### tasks
```json
[{"id":"old-task"}]
```
''')
    if rename:
        approval.write_text(approval.read_text().replace('\"asset_id\":\"library\"', '\"asset_id\":\"library\",\"copy_name\":\"办公室副本\"'))
    plan = tmp_path / 'plan.json'
    root = Path(__file__).parents[1]
    result = subprocess.run([sys.executable, '-m', 'app.scripts.shared_asset_preflight', '--database-url', url,
                             '--approval', str(approval), '--output', str(plan)], cwd=root,
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    command = [sys.executable, '-m', 'app.scripts.retire_shared_assets', '--database-url', url,
               '--approval', str(approval), '--plan', str(plan), '--plan-sha256', hashlib.sha256(plan.read_bytes()).hexdigest(),
               '--backup', str(tmp_path / 'backup.json'), '--output', str(tmp_path / 'result.json'), '--detach-adoption', '--maintenance-window']
    rejected = command.copy()
    rejected[rejected.index('--plan-sha256') + 1] = 'unapproved-digest'
    rejected_result = subprocess.run(rejected, cwd=root, capture_output=True, text=True, check=False)
    assert rejected_result.returncode != 0
    assert not (tmp_path / 'backup.json').exists()
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    copied = json.loads((tmp_path / 'result.json').read_text())['copies'][0]['copy_id']
    assert copied != 'library'

    async def verify_public_reads():
        engine = create_async_engine(url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async def database():
            async with sessions() as db:
                yield db
        previous = app.dependency_overrides.get(get_db)
        app.dependency_overrides[get_db] = database
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as http:
                items = (await http.get('/api/v1/studio/entities/scene', params={'project_id': 'project'})).json()['data']['items']
                assert [(item['id'], item['supplementary_info'], item['origin']) for item in items if item['id'] == copied] == [(copied, '保留原有资料', 'created')]
                assert next(item['name'] for item in items if item['id'] == copied) == ('办公室副本' if rename else '办公室')
                if rename:
                    assert next(item['supplementary_info'] for item in items if item['id'] == 'existing') == '不覆盖'
                original = (await http.get('/api/v1/studio/entities/scene/library')).json()['data']
                assert original['project_id'] is None and original['supplementary_info'] == '保留原有资料'
                images = (await http.get(f'/api/v1/studio/entities/scene/{copied}/images')).json()['data']['items']
                assert len(images) == 1 and images[0]['id'] != 7
                assert images[0]['file_id'] is None and images[0]['is_view_default'] is True
                assert (await http.get('/api/v1/film/tasks/old-task')).status_code == 404
                links = (await http.get('/api/v1/studio/project-assets/scene', params={'project_id': 'project'})).json()['data']['items']
                assert {item['chapter_id'] for item in links} == {'a', 'b'}
                assert {item['scene_id'] for item in links} == {copied}
        finally:
            if previous is None:
                app.dependency_overrides.pop(get_db, None)
            else:
                app.dependency_overrides[get_db] = previous
            await engine.dispose()
    asyncio.run(verify_public_reads())
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    replay = json.loads((tmp_path / 'result.json').read_text())
    assert replay['already_completed'] is True
    assert {item['copy_id'] for item in replay['copies']} == {copied}
    assert (tmp_path / 'backup.json').stat().st_mode & 0o777 == 0o600
