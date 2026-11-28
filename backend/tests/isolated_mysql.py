"""使用显式隔离 MySQL 库运行后端迁移、种子与测试。"""

import argparse
import os
import re
import sys
from collections.abc import Mapping
from pathlib import Path
from uuid import uuid4

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


TARGET_ENV = "JELLYFISH_TEST_MYSQL_URL"
DISPATCHED_TARGET_ENV = "JELLYFISH_TEST_MYSQL_DISPATCHED_TARGET"
ENTRYPOINTS = {
    "migrate": "app.scripts.migrate_database",
    "seed": "app.scripts.seed_system_data",
    "pytest": "pytest",
}
BACKEND = Path(__file__).resolve().parents[1]


def validate_canonical_environment(env: Mapping[str, str]) -> None:
    """Prevent case-insensitive settings aliases from overriding checked values."""
    guarded = {
        "DATABASE_URL", TARGET_ENV, DISPATCHED_TARGET_ENV, "S3_BASE_PATH", "S3_BUCKET_NAME",
        "S3_ENDPOINT_URL", "S3_ORPHAN_CLEANUP_SCOPE",
    }
    if any(key.upper() in guarded and key not in guarded for key in env):
        raise ValueError("Use uppercase names for test database and storage settings")


def isolated_mysql_url(value: str | None) -> URL:
    """Parse an explicitly named test database without connection overrides."""
    if not value or not value.strip():
        raise ValueError(f"{TARGET_ENV} is required for isolated MySQL checks")
    try:
        url = make_url(value.strip())
    except (ArgumentError, ValueError) as exc:
        raise ValueError("Invalid isolated MySQL URL") from exc
    if (
        url.drivername != "mysql+aiomysql"
        or not url.host
        or not re.fullmatch(r"jellyfish_check_[A-Za-z0-9_]+", url.database or "")
        or url.query
    ):
        raise ValueError("Use a mysql+aiomysql URL for a dedicated jellyfish_check_ database without query options")
    return url


def require_separate_mysql_database(url: URL, *, allow_dispatched: bool = False) -> None:
    """Reject the application database unless the isolated runner already replaced it."""
    from app.config import settings

    try:
        current = make_url(settings.database_url)
    except (ArgumentError, ValueError) as exc:
        raise ValueError("Invalid application database URL") from exc
    same_database = current.get_backend_name() == "mysql" and (
        (url.database or "").casefold() == (current.database or "").casefold()
    )
    dispatched = (allow_dispatched and current == url
                  and os.environ.get(DISPATCHED_TARGET_ENV) == url.render_as_string())
    if same_database and not dispatched:
        raise ValueError("The isolated MySQL test target cannot be the current database")


def test_environment() -> dict[str, str]:
    """在导入应用的数据库模块前检查目标，并统一子进程的连接配置。"""
    validate_canonical_environment(os.environ)
    url = isolated_mysql_url(os.environ.get(TARGET_ENV))
    require_separate_mysql_database(url)
    target = os.environ[TARGET_ENV].strip()
    env = {**os.environ, **isolated_storage_environment()}
    env.update(DATABASE_URL=target, JELLYFISH_TEST_MYSQL_URL=target, JELLYFISH_DIRECTING_MYSQL_URL=target)
    env[DISPATCHED_TARGET_ENV] = url.render_as_string()
    return env


def isolated_storage_environment() -> dict[str, str]:
    """Keep test media outside the configured worker's files/ and generated/ scans."""
    from app.config import settings

    base = settings.s3_base_path.strip().strip("/")
    prefix = "/".join(filter(None, (base, "validation", uuid4().hex)))
    return {"S3_BASE_PATH": prefix, "S3_ORPHAN_CLEANUP_SCOPE": ""}


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
