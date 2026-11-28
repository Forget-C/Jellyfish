"""Guard real Worker subprocesses in integration and browser fixtures."""

import argparse
import asyncio
import os
import re
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

from tests.isolated_mysql import (
    BACKEND, TARGET_ENV, isolated_mysql_url, require_separate_mysql_database, validate_canonical_environment,
)


def sqlite_worker_environment(database: Path) -> dict[str, str]:
    """Pin a fixture database and disable all access through the real S3 adapter."""
    return {
        **os.environ,
        "DATABASE_URL": URL.create("sqlite+aiosqlite", database=str(database.resolve())).render_as_string(),
        "S3_BUCKET_NAME": "", "S3_ENDPOINT_URL": "", "S3_ORPHAN_CLEANUP_SCOPE": "",
    }


def validate_worker_environment(
    env: Mapping[str, str], *, sqlite_root: Path | None = None, browser_media: bool = False,
) -> None:
    """Reject an unsafe effective environment before running a real test Worker."""
    validate_canonical_environment(env)
    if env.get("S3_ORPHAN_CLEANUP_SCOPE") != "":
        raise ValueError("Test Worker must explicitly disable orphan cleanup")
    if sqlite_root is not None:
        _validate_sqlite(env, sqlite_root, browser_media)
        return
    target = isolated_mysql_url(os.environ.get(TARGET_ENV))
    if isolated_mysql_url(env.get("DATABASE_URL")) != target:
        raise ValueError("Test Worker must use the designated isolated MySQL database")
    require_separate_mysql_database(target, allow_dispatched=True)
    from app.config import settings

    parent = settings.s3_base_path.strip().strip("/")
    prefix = "/".join(filter(None, (parent, "validation")))
    if not re.fullmatch(re.escape(prefix) + r"/[0-9a-f]{32}", env.get("S3_BASE_PATH", "")):
        raise ValueError("Test Worker requires a dedicated random S3 validation prefix")


def _validate_sqlite(env: Mapping[str, str], root: Path, browser_media: bool) -> None:
    root = root.resolve()
    try:
        url = make_url(env.get("DATABASE_URL", ""))
    except (ArgumentError, ValueError) as exc:
        raise ValueError("Invalid test Worker SQLite URL") from exc
    database = Path(url.database or "")
    if (url.drivername != "sqlite+aiosqlite" or url.query or not database.is_absolute()
            or not database.resolve().is_relative_to(root) or not database.is_file()):
        raise ValueError("Test Worker requires an existing SQLite database inside the fixture directory")
    if env.get("S3_BUCKET_NAME") != "" or env.get("S3_ENDPOINT_URL") != "":
        raise ValueError("SQLite test Worker must explicitly disable real S3 access")
    if browser_media:
        media = Path(env.get("CANVAS_BROWSER_MEDIA_STORAGE", ""))
        if not media.is_absolute() or not media.resolve().is_relative_to(root) or media.resolve() == root:
            raise ValueError("Browser Worker media must stay inside a dedicated fixture directory")


def start_test_worker(
    env: dict[str, str], *, sqlite_root: Path | None = None, dev: bool = False, stdout=None, stderr=None,
) -> subprocess.Popen:
    """Validate the exact environment passed to a Python test Worker subprocess."""
    validate_worker_environment(env, sqlite_root=sqlite_root)
    command = ("app.dev", "worker") if dev else ("app.task_worker",)
    return subprocess.Popen([sys.executable, "-m", *command], cwd=BACKEND, env=env, stdout=stdout, stderr=stderr)


def main() -> None:
    """Guard the browser fixture before importing and running its Worker."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        validate_worker_environment(os.environ, sqlite_root=args.sqlite_root, browser_media=True)
    except ValueError as error:
        parser.error(str(error))

    from tests.generation_canvas_browser_server import configure_media_storage
    from app.task_worker import main as run_worker

    configure_media_storage()
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
