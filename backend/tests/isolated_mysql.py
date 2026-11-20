"""使用显式隔离 MySQL 库运行后端迁移、种子与测试。"""

import argparse
import os
import re
import sys
from pathlib import Path

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


TARGET_ENV = "JELLYFISH_TEST_MYSQL_URL"
ENTRYPOINTS = {
    "migrate": "app.scripts.migrate_database",
    "seed": "app.scripts.seed_system_data",
    "pytest": "pytest",
}
BACKEND = Path(__file__).resolve().parents[1]


def test_environment() -> dict[str, str]:
    """在导入应用的数据库模块前检查目标，并统一子进程的连接配置。"""
    target = os.environ.get(TARGET_ENV, "").strip()
    if not target:
        raise ValueError(f"{TARGET_ENV} is required for isolated MySQL checks")

    from app.config import settings  # pylint: disable=import-outside-toplevel

    try:
        url = make_url(target)
        current = make_url(settings.database_url)
    except (ArgumentError, ValueError) as exc:
        raise ValueError("Invalid database URL in the test or application configuration") from exc

    if (
        url.drivername != "mysql+aiomysql"
        or not url.host
        or not re.fullmatch(r"jellyfish_check_[A-Za-z0-9_]+", url.database or "")
        or url.query
    ):
        raise ValueError("Use a mysql+aiomysql URL for a dedicated jellyfish_check_ database without query options")
    if current.get_backend_name() == "mysql" and url.database.casefold() == (current.database or "").casefold():
        raise ValueError("The isolated MySQL test target cannot be the current database")

    env = os.environ.copy()
    env.update(DATABASE_URL=target, JELLYFISH_TEST_MYSQL_URL=target, JELLYFISH_DIRECTING_MYSQL_URL=target)
    return env


def main() -> None:
    """将已校验的库传给正式入口或测试进程。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entrypoint", choices=ENTRYPOINTS)
    parser.add_argument("args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        env = test_environment()
    except ValueError as exc:
        parser.error(str(exc))

    os.chdir(BACKEND)
    os.execve(sys.executable, [sys.executable, "-m", ENTRYPOINTS[args.entrypoint], *args.args], env)


if __name__ == "__main__":
    main()
