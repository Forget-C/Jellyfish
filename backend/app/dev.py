"""本地开发入口与只读诊断：python -m app.dev --help。"""

import argparse
import asyncio
from datetime import UTC
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.dev_runtime import runtime_directory, runtime_status
from app.models.task import Task


def _local_time(value):
    """任务表的无时区时间按 UTC 存储；命令始终显示上海时区。"""
    return value.replace(tzinfo=UTC).astimezone(ZoneInfo('Asia/Shanghai')).isoformat() if value else None


async def task_report(task_id: str, sessions=None) -> dict | None:
    """只 SELECT 指定任务，白名单输出执行信息；不提交事务或输出模型正文与凭据。"""
    engine = None
    if sessions is None:
        url = make_url(settings.database_url)
        if url.get_backend_name() == 'sqlite' and url.database != ':memory:' and not Path(url.database or '').is_file():
            raise FileNotFoundError('SQLite database does not exist')
        engine = create_async_engine(url, echo=False)
        sessions = async_sessionmaker(engine, autoflush=False)
    try:
        async with sessions() as db:
            task = await db.get(Task, task_id)
            if task is None:
                return None
            snapshot = task.input_snapshot if isinstance(task.input_snapshot, dict) else {}
            args = snapshot.get('run_args', {})
            args = args if isinstance(args, dict) else {}
            result = task.result if isinstance(task.result, dict) else {}
            diagnostic = result.get('design_diagnostics')
            output = diagnostic.get('output') if isinstance(diagnostic, dict) else None
            url = db.get_bind().url
            return {
                'database': {'driver': url.drivername, 'host': url.host, 'port': url.port, 'database': url.database},
                'task': {**{key: getattr(task, key) for key in ('id', 'kind', 'title', 'status', 'stage',
                    'worker_instance_id', 'error_code', 'error_message')},
                    **{key: _local_time(getattr(task, key)) for key in ('created_at', 'started_at', 'finished_at')}},
                'design_flags': {key: args.get(key) for key in ('scene_version_design', 'design_scope_version', 'design_scope')},
                'diagnostics': {'available': isinstance(diagnostic, dict),
                    'issues': diagnostic.get('issues', []) if isinstance(diagnostic, dict) else [],
                    'output_chars': len(output) if isinstance(output, str) else 0},
            }
    finally:
        if engine is not None:
            await engine.dispose()


def main(argv=None, *, sessions=None) -> int:
    """返回稳定退出码；数据库错误仅打印类型和排查方向，不展开连接参数。"""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    task = commands.add_parser('task', help='只读查询任务摘要和诊断是否存在')
    task.add_argument('task_id')
    commands.add_parser('status', help='只读核对 API／Worker 的启动身份和代码指纹')
    api = commands.add_parser('api', help='启动 API，保留 uvicorn 自动重载')
    api.add_argument('--host', default='0.0.0.0')
    api.add_argument('--port', type=int, default=8000)
    commands.add_parser('worker', help='启动独立任务 Worker 并登记其代码身份')
    args = parser.parse_args(argv)
    if args.command == 'status':
        print(json.dumps(runtime_status(), ensure_ascii=False, indent=2))
        return 0
    if args.command in ('api', 'worker'):
        state = runtime_status()['processes'][args.command]['state']
        if state in ('current', 'stale'):
            parser.error(f'{args.command} 已登记运行，请先停止原进程。')
        command = ['-m', 'app.task_worker'] if args.command == 'worker' else [
            '-m', 'uvicorn', 'app.main:app', '--reload', '--host', args.host, '--port', str(args.port)]
        os.execvpe(sys.executable, [sys.executable, *command],
            {**os.environ, 'JELLYFISH_DEV_RUNTIME_DIR': str(runtime_directory())})
        return 0
    try:
        report = asyncio.run(task_report(args.task_id, sessions))
    except (SQLAlchemyError, OSError) as error:
        print(json.dumps({'error': 'database_query_failed', 'exception': type(error).__name__,
            'hint': '请核对 backend/.env、数据库迁移和当前执行环境的网络／文件权限；连接失败不能单独证明数据库已停止。'},
            ensure_ascii=False), file=sys.stderr)
        return 2
    if report is None:
        print(json.dumps({'error': 'task_not_found', 'task_id': args.task_id}), file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
