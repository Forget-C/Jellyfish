"""macOS/Linux 开发进程身份；仅开发入口设置环境变量后登记，不参与任务状态裁决。"""

from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zoneinfo import ZoneInfo

from app.config import BACKEND_ROOT


def runtime_directory() -> Path:
    """固定到后端目录，避免 API reload 子进程随工作目录改变记录位置。"""
    return Path(os.environ.get('JELLYFISH_DEV_RUNTIME_DIR', str(BACKEND_ROOT / '.dev-runtime'))).resolve()


def code_version() -> dict:
    """同时记录 Git 修订和 Python／依赖内容指纹，覆盖未提交改动。"""
    digest = hashlib.sha256()
    paths = sorted((BACKEND_ROOT / 'app').rglob('*.py'))
    paths += [BACKEND_ROOT / name for name in ('pyproject.toml', 'uv.lock') if (BACKEND_ROOT / name).is_file()]
    for path in paths:
        digest.update(path.relative_to(BACKEND_ROOT).as_posix().encode() + b'\0' + path.read_bytes() + b'\0')
    try:
        result = subprocess.run(['git', '-C', str(BACKEND_ROOT), 'rev-parse', 'HEAD'],
            capture_output=True, text=True, timeout=5, check=False)
        revision = result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        revision = None
    return {'code_root': str(BACKEND_ROOT.resolve()), 'revision': revision, 'fingerprint': digest.hexdigest()}


def _read(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def _alive(identity):
    pid = identity.get('pid')
    if not isinstance(pid, int) or pid <= 0 or identity.get('stopped_at'):
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _lock_held(path):
    """只读探测角色锁，排除强制退出后 PID 被无关进程复用的残留身份。"""
    import fcntl

    try:
        with path.open('r') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(lock, fcntl.LOCK_UN)
            return False
    except FileNotFoundError:
        return False
    except OSError:
        return None


def runtime_status() -> dict:
    """只读展示已登记身份；未登记不等于服务未启动，不推断旧进程加载的版本。"""
    current = code_version()
    processes, warnings = {}, []
    for role in ('api', 'worker'):
        path = runtime_directory() / f'{role}.json'
        identity = _read(path)
        if identity is None:
            processes[role] = {'state': 'unreadable' if path.exists() else 'unregistered'}
            warnings.append(f'{role} 没有可核实的开发身份，请确认其启动入口。')
            continue
        held = _lock_held(path.with_suffix('.lock')) if _alive(identity) else False
        state = 'unreadable' if held is None else 'current' if held else 'stopped'
        if held is None:
            warnings.append(f'{role} 的角色锁不可读取，无法核实进程身份。')
        if state == 'current' and any(identity.get(key) != current[key] for key in ('fingerprint', 'code_root')):
            state = 'stale'
            warnings.append(f'{role} 加载的代码已过期；确认活动任务后重启该进程。')
        processes[role] = {**identity, 'state': state}
    return {'current_code': current, 'processes': processes, 'warnings': warnings}


@contextmanager
def process_identity(role: str, *, worker_id: str | None = None):
    """登记实际服务子进程并持有同角色锁；API reload 时重写启动身份，退出保留停止记录。"""
    if not os.environ.get('JELLYFISH_DEV_RUNTIME_DIR'):
        yield
        return
    import fcntl
    directory = runtime_directory()
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / f'{role}.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError(f'{role} 已有开发进程运行，请先停止原进程。') from error
        path = directory / f'{role}.json'
        identity = {**code_version(), 'role': role, 'pid': os.getpid(), 'worker_id': worker_id,
                    'started_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()}

        def record(event):
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(identity, ensure_ascii=False))
            temporary.replace(path)
            line = json.dumps({'event': event, **identity}, ensure_ascii=False)
            with (directory / 'processes.jsonl').open('a') as log:
                log.write(line + '\n')
            print('JELLYFISH_DEV ' + line, file=sys.stderr, flush=True)

        try:
            record('started')
            yield
        finally:
            identity['stopped_at'] = datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()
            record('stopped')
            fcntl.flock(lock, fcntl.LOCK_UN)
