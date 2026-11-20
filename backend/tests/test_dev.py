"""开发诊断命令通过隔离数据库验证只读输出，不访问真实供应商。"""

from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.dev import main
from app.core.db import Base
from app.models.task import Task


def test_task_command_reads_json_columns_and_omits_private_snapshot(tmp_path, capsys):
    """查询已失败任务，显示上海时间、执行身份和诊断摘要，且不泄露冻结凭据。"""
    import asyncio

    async def run():
        engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "tasks.sqlite"}')
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions.begin() as db:
            db.add(Task(id='failed-task', kind='directing_design', title='整场设计', status='failed',
                worker_instance_id='worker-old', created_at=datetime(2026, 10, 20, 6, 18, 17),
                error_code='directing_output_invalid', error_message='普通设计不能声明规则阶段或条件',
                input_snapshot={'api_key': 'PRIVATE-KEY', 'run_args': {
                    'script_text': 'PRIVATE-SCRIPT'}},
                result={'design_diagnostics': {'output': 'PRIVATE-MODEL-OUTPUT', 'issues': ['applicability.3：阶段错误']}}))
        statements = []

        @event.listens_for(engine.sync_engine, 'before_cursor_execute')
        def observe(connection, cursor, statement, parameters, context, many):
            statements.append(statement.strip().split()[0].upper())

        return sessions, engine, statements

    sessions, engine, statements = asyncio.run(run())
    try:
        assert main(['task', 'failed-task'], sessions=sessions) == 0
        output = capsys.readouterr().out
        report = json.loads(output)
        assert report['database']['driver'] == 'sqlite+aiosqlite'
        assert report['database']['database'] == str(tmp_path / 'tasks.sqlite')
        assert report['task']['created_at'] == '2026-10-20T14:18:17+08:00'
        assert report['task']['worker_instance_id'] == 'worker-old'
        assert report['diagnostics']['available'] is True
        assert report['diagnostics']['issues'] == ['applicability.3：阶段错误']
        assert report['diagnostics']['output_chars'] == len('PRIVATE-MODEL-OUTPUT')
        assert 'PRIVATE-' not in output
        assert statements and set(statements) == {'SELECT'}
    finally:
        asyncio.run(engine.dispose())


def test_status_detects_code_edits_and_keeps_actual_process_start_identity(tmp_path, monkeypatch, capsys):
    """同一进程启动后代码变化应标为待重启，记录仍保留启动时身份。"""
    from app.core import dev_runtime

    code = tmp_path / 'app' / 'generation.py'
    code.parent.mkdir()
    code.write_text('VERSION = 1\n')
    monkeypatch.setattr(dev_runtime, 'BACKEND_ROOT', tmp_path)
    monkeypatch.setenv('JELLYFISH_DEV_RUNTIME_DIR', str(tmp_path / '.dev-runtime'))
    with dev_runtime.process_identity('worker', worker_id='worker-test'):
        assert main(['status']) == 0
        first = json.loads(capsys.readouterr().out)
        assert first['processes']['worker']['state'] == 'current'
        started = first['processes']['worker']['started_at']
        assert first['processes']['worker']['worker_id'] == 'worker-test'
        code.write_text('VERSION = 2\n')
        assert main(['status']) == 0
        after = json.loads(capsys.readouterr().out)
        assert after['processes']['worker']['state'] == 'stale'
        assert after['processes']['worker']['started_at'] == started
        assert after['warnings']
    assert main(['status']) == 0
    stopped = json.loads(capsys.readouterr().out)
    assert stopped['processes']['worker']['state'] == 'stopped'
    events = (tmp_path / '.dev-runtime' / 'processes.jsonl').read_text().splitlines()
    assert [json.loads(line)['event'] for line in events] == ['started', 'stopped']


def test_api_lifespan_registers_each_reload_with_current_code(tmp_path, monkeypatch, capsys):
    """身份由实际 API 生命周期登记，重载后的进程使用新指纹。"""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core import dev_runtime

    (tmp_path / 'app').mkdir()
    code = tmp_path / 'app' / 'route.py'
    code.write_text('VERSION = 1\n')
    monkeypatch.setattr(dev_runtime, 'BACKEND_ROOT', tmp_path)
    monkeypatch.setenv('JELLYFISH_DEV_RUNTIME_DIR', str(tmp_path / '.dev-runtime'))
    with TestClient(app):
        assert main(['status']) == 0
        first = json.loads(capsys.readouterr().out)['processes']['api']
        assert first['state'] == 'current'
    code.write_text('VERSION = 2\n')
    with TestClient(app):
        assert main(['status']) == 0
        reloaded = json.loads(capsys.readouterr().out)['processes']['api']
        assert reloaded['state'] == 'current'
        assert reloaded['fingerprint'] != first['fingerprint']
        assert reloaded['started_at'] != first['started_at']


def test_worker_command_records_actual_subprocess_identity_and_stops_cleanly(tmp_path):
    """开发入口执行隔离 Worker，启动身份与任务执行使用同一 worker_id。"""
    import asyncio

    database = tmp_path / 'worker.sqlite'

    async def prepare():
        engine = create_async_engine(f'sqlite+aiosqlite:///{database}')
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(prepare())
    runtime = tmp_path / '.dev-runtime'
    with (tmp_path / 'worker.log').open('w') as log:
        worker = subprocess.Popen([sys.executable, '-m', 'app.dev', 'worker'],
            cwd=Path(__file__).resolve().parents[1], stdout=log, stderr=subprocess.STDOUT,
            env={**os.environ, 'DATABASE_URL': f'sqlite+aiosqlite:///{database}',
                 'JELLYFISH_DEV_RUNTIME_DIR': str(runtime)})
        try:
            deadline = time.monotonic() + 10
            while not (runtime / 'worker.json').exists() and worker.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            assert (runtime / 'worker.json').exists(), (tmp_path / 'worker.log').read_text()
            identity = json.loads((runtime / 'worker.json').read_text())
            assert identity['pid'] == worker.pid
            assert identity['worker_id']
            assert identity['revision']
            assert identity['fingerprint']
        finally:
            if worker.poll() is None:
                worker.terminate()
            worker.wait(timeout=10)
    assert worker.returncode == 0, (tmp_path / 'worker.log').read_text()
    assert json.loads((runtime / 'worker.json').read_text())['stopped_at']


def test_database_failure_is_redacted_and_does_not_claim_server_is_down(capsys):
    from sqlalchemy.exc import OperationalError

    def unavailable():
        raise OperationalError('SELECT PRIVATE-QUERY', None, RuntimeError('mysql://user:PRIVATE-PASSWORD@host/db'))

    assert main(['task', 'task'], sessions=unavailable) == 2
    output = capsys.readouterr()
    assert not output.out
    report = json.loads(output.err)
    assert report['error'] == 'database_query_failed'
    assert report['exception'] == 'OperationalError'
    assert 'PRIVATE-' not in output.err
    assert '权限' in report['hint']


def test_missing_sqlite_database_is_not_created(tmp_path, monkeypatch, capsys):
    from app.config import settings

    missing = tmp_path / 'missing.sqlite'
    monkeypatch.setattr(settings, 'database_url', f'sqlite+aiosqlite:///{missing}')
    assert main(['task', 'task']) == 2
    assert not missing.exists()
    assert json.loads(capsys.readouterr().err)['exception'] == 'FileNotFoundError'


def test_status_does_not_create_runtime_directory_or_claim_legacy_processes_stopped(tmp_path, monkeypatch, capsys):
    runtime = tmp_path / 'not-created'
    monkeypatch.setenv('JELLYFISH_DEV_RUNTIME_DIR', str(runtime))
    assert main(['status']) == 0
    report = json.loads(capsys.readouterr().out)
    assert not runtime.exists()
    assert report['processes']['worker']['state'] == 'unregistered'
    assert report['processes']['api']['state'] == 'unregistered'


def test_duplicate_registered_worker_is_refused(tmp_path, monkeypatch, capsys):
    from app.core.dev_runtime import process_identity

    monkeypatch.setenv('JELLYFISH_DEV_RUNTIME_DIR', str(tmp_path / '.dev-runtime'))
    with process_identity('worker', worker_id='existing'):
        with pytest.raises(SystemExit) as caught:
            main(['worker'])
        assert caught.value.code == 2
        assert '请先停止原进程' in capsys.readouterr().err
        with pytest.raises(RuntimeError, match='已有开发进程运行'):
            with process_identity('worker', worker_id='duplicate'):
                pytest.fail('同角色文件锁应阻止重复登记')


def test_reused_pid_without_worker_lock_cannot_impersonate_a_registered_worker(tmp_path, monkeypatch, capsys):
    """模拟强制退出后 PID 被其他进程复用；残留记录不可阻止重新启动。"""
    from app.core.dev_runtime import code_version

    runtime = tmp_path / '.dev-runtime'
    runtime.mkdir()
    monkeypatch.setenv('JELLYFISH_DEV_RUNTIME_DIR', str(runtime))
    record = json.dumps({**code_version(), 'role': 'worker', 'pid': os.getpid(),
        'worker_id': 'crashed-worker', 'started_at': '2026-10-14T17:46:26+08:00'})
    (runtime / 'worker.json').write_text(record)
    (runtime / 'worker.lock').touch()
    assert main(['status']) == 0
    assert json.loads(capsys.readouterr().out)['processes']['worker']['state'] == 'stopped'
    assert (runtime / 'worker.json').read_text() == record
    launches = []
    monkeypatch.setattr(os, 'execvpe', lambda executable, command, env: launches.append(command))
    assert main(['worker']) == 0
    assert launches == [[sys.executable, '-m', 'app.task_worker']]


def test_api_reload_with_open_event_stream_becomes_responsive(tmp_path, monkeypatch):
    """Exercise the development command's actual Uvicorn flags with an open SSE client."""
    import signal
    import socket
    import httpx

    monkeypatch.setenv('JELLYFISH_DEV_RUNTIME_DIR', str(tmp_path / 'identities'))
    captured = []
    monkeypatch.setattr('app.dev.os.execvpe', lambda executable, argv, env: captured.extend(argv))
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    assert main(['api', '--host', '127.0.0.1', '--port', str(port)]) == 0
    fixture = tmp_path / 'reload_fixture.py'
    fixture.write_text('''import asyncio
import os
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
app = FastAPI()
@app.get('/health')
async def health():
    return {'pid': os.getpid()}
@app.get('/events')
async def events():
    async def stream():
        while True:
            yield 'data: heartbeat\\n\\n'
            await asyncio.sleep(.1)
    return StreamingResponse(stream(), media_type='text/event-stream')
''')
    # Substitute only the fixture application; keep the dev entrypoint's server options.
    argv = ['reload_fixture:app' if part == 'app.main:app' else part for part in captured]
    argv += ['--reload-dir', str(tmp_path)]
    address = f'http://127.0.0.1:{port}'
    with (tmp_path / 'server.log').open('w+') as log:
        process = subprocess.Popen(argv, cwd=tmp_path, stdout=log, stderr=log, start_new_session=True)
        try:
            with httpx.Client(timeout=.3, trust_env=False) as client:
                def ready(previous=None):
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        try:
                            response = client.get(address + '/health')
                            if response.status_code == 200 and response.json()['pid'] != previous:
                                return response.json()['pid']
                        except httpx.HTTPError:
                            pass
                        time.sleep(.1)
                    log.seek(0)
                    pytest.fail('API did not respond after reload with an open stream:\n' + log.read())
                previous = ready()
                with client.stream('GET', address + '/events') as stream:
                    lines = stream.iter_lines()
                    assert next(lines) == 'data: heartbeat'
                    # Ensure the watcher's first scan has completed before changing the fixture.
                    time.sleep(.5)
                    fixture.write_text(fixture.read_text() + '\n# trigger reload\n')
                    assert ready(previous) != previous
                    assert client.get(address + '/openapi.json').status_code == 200
        finally:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)
