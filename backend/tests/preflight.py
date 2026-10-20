"""测试启动前检查本地依赖与监听能力，不访问生产服务或安装软件。"""

import argparse
import importlib
import socket
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--media', action='store_true', help='同时检查浏览器媒体回归所需的 ffmpeg/ffprobe')
    args = parser.parse_args()
    try:
        for name in ('pytest', 'pytest_asyncio', 'fastapi', 'uvicorn', 'sqlalchemy', 'aiosqlite', 'httpx'):
            importlib.import_module(name)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
        if args.media:
            for command in ('ffmpeg', 'ffprobe'):
                subprocess.run([command, '-version'], check=True, capture_output=True, timeout=10)
    except (ImportError, OSError, subprocess.SubprocessError) as error:
        print(f'测试环境预检失败：{type(error).__name__}: {error}', file=sys.stderr)
        print('请核对 uv sync --group dev、本机监听权限及媒体工具；不要将环境错误当作业务回归。', file=sys.stderr)
        return 1
    print(f'PASS Python {sys.version.split()[0]} 测试依赖、本机监听' + ('、媒体工具' if args.media else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
