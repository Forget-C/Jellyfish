"""The maintenance command reports expanded dependencies without mutating its input database."""
import json
import sqlite3
import subprocess
import sys
import pytest
from pathlib import Path


def test_preflight_exposes_json_dependencies_and_preserves_current_documents(tmp_path):
    database = tmp_path / 'maintenance.sqlite'
    with sqlite3.connect(database) as db:
        db.executescript('''
            CREATE TABLE retained_audit (id TEXT PRIMARY KEY, payload JSON);
            CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, status TEXT, input_snapshot JSON);
            CREATE TABLE generation_canvases (id TEXT PRIMARY KEY, project_id TEXT, document JSON);
            CREATE TABLE generation_canvas_run_nodes (id TEXT PRIMARY KEY, canvas_id TEXT REFERENCES generation_canvases(id), basis JSON);
            CREATE TABLE generation_canvas_events (canvas_id TEXT REFERENCES generation_canvases(id), cursor INTEGER, envelope JSON, PRIMARY KEY(canvas_id,cursor));
        ''')
        db.executemany('INSERT INTO tasks VALUES (?, ?, ?, ?)', [
            ('approved', 'project', 'succeeded', '{}'),
            ('dependent', 'project', 'succeeded', '{"parent_task_id":"approved"}'),
            ('unrelated', 'other-project', 'succeeded', '{"parent_task_id":"approved"}'),
        ])
        db.execute('INSERT INTO generation_canvases VALUES (?, ?, ?)', ('canvas', 'project', '{"storyboard":{"task_id":"approved"}}'))
        db.execute('INSERT INTO generation_canvas_run_nodes VALUES (?, ?, ?)', ('node', 'canvas', '{}'))
        db.execute('INSERT INTO generation_canvas_events VALUES (?, ?, ?)', ('canvas', 4, '{"node_id":"node"}'))
        db.execute('INSERT INTO retained_audit VALUES (?, ?)', ('audit', '{"task_id":"approved"}'))
        before = '\n'.join(db.iterdump())
    approval = tmp_path / 'approval.md'
    approval.write_text('''# Explicit scope
```json
{"kind":"scene","link_id":1,"project_id":"project","asset_id":"asset","images":[]}
```
### tasks
```json
[{"id":"approved"}]
```
### generation_canvas_run_nodes
```json
[{"id":"node"}]
```
''')
    output = tmp_path / 'result.json'
    result = subprocess.run([sys.executable, '-m', 'app.scripts.shared_asset_preflight',
                             '--database-url', f'sqlite+aiosqlite:///{database}',
                             '--approval', str(approval), '--output', str(output)],
                            cwd=Path(__file__).parents[1], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    report = json.loads(output.read_text())
    assert report['read_only'] is True and report['ready_to_apply'] is False
    assert report['additional_history']['tasks'] == [{'id': 'dependent'}]
    assert report['additional_history']['generation_canvas_events'] == [{'canvas_id': 'canvas', 'cursor': 4}]
    assert report['current_history_references'] == [{'table': 'generation_canvases', 'pk': {'id': 'canvas'},
                                                    'paths': {'document': ['.storyboard.task_id']}}]
    assert report['active_tasks'] == []
    assert report['unclassified_references'] == [{'table': 'retained_audit', 'pk': {'id': 'audit'}, 'paths': {'payload': ['.task_id']}}]
    with sqlite3.connect(database) as db:
        assert '\n'.join(db.iterdump()) == before


@pytest.mark.parametrize('name', ['', '   ', 'x' * 256, 123])
def test_preflight_rejects_invalid_approved_copy_name(tmp_path, name):
    database = tmp_path / 'name.sqlite'
    with sqlite3.connect(database) as db:
        db.executescript('''
            CREATE TABLE scenes (id TEXT PRIMARY KEY, name TEXT, project_id TEXT);
            CREATE TABLE project_scene_links (id INTEGER PRIMARY KEY, project_id TEXT, scene_id TEXT);
            INSERT INTO scenes VALUES ('library', '原件', NULL);
            INSERT INTO project_scene_links VALUES (1, 'project', 'library');
        ''')
    approval = tmp_path / 'approval.md'
    source = {'kind': 'scene', 'link_id': 1, 'project_id': 'project', 'asset_id': 'library', 'images': [], 'copy_name': name}
    approval.write_text('# Scope\n```json\n' + json.dumps(source) + '\n```\n')
    output = tmp_path / 'result.json'
    result = subprocess.run([sys.executable, '-m', 'app.scripts.shared_asset_preflight',
                             '--database-url', f'sqlite+aiosqlite:///{database}', '--approval', str(approval),
                             '--output', str(output)], cwd=Path(__file__).parents[1], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert json.loads(output.read_text())['source_drift'] == [
        {'kind': 'scene', 'asset_id': 'library', 'reason': 'invalid copy name'}]
