"""专用 MySQL 测试入口在连接前拒绝不安全的数据库配置。"""

import subprocess
import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
REJECT_CONNECTIONS = """
import runpy
import sys

def assert_no_connection_or_dispatch(event, args):
    if event in {"socket.connect", "os.exec"}:
        raise AssertionError(f"unexpected {event} before rejecting the database target")

sys.addaudithook(assert_no_connection_or_dispatch)
runpy.run_module("tests.isolated_mysql", run_name="__main__")
"""


@pytest.mark.parametrize(
    ("target", "current", "message"),
    [
        (None, "mysql+aiomysql://app@localhost/jellyfish", "JELLYFISH_TEST_MYSQL_URL"),
        (
            "mysql+aiomysql://test@127.0.0.1:1/jellyfish_check_current",
            "mysql+aiomysql://app@localhost:1/jellyfish_check_current",
            "current database",
        ),
    ],
)
def test_isolated_mysql_runner_rejects_before_opening_connection(
    monkeypatch, target, current, message,
):
    """错误目标即使不可连接也报告配置错误，且不会替换应用的默认数据库。"""
    monkeypatch.setenv("DATABASE_URL", current)
    if target is None:
        monkeypatch.delenv("JELLYFISH_TEST_MYSQL_URL", raising=False)
    else:
        monkeypatch.setenv("JELLYFISH_TEST_MYSQL_URL", target)
    result = subprocess.run(
        [sys.executable, "-c", REJECT_CONNECTIONS, "migrate"],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert message in result.stderr


def test_isolated_mysql_uses_fresh_storage_prefix_and_clears_inherited_authorization(monkeypatch):
    from app.config import settings
    from tests.isolated_mysql import test_environment

    monkeypatch.setattr(settings, "database_url", "mysql+aiomysql://app@localhost/jellyfish")
    monkeypatch.setattr(settings, "s3_base_path", "/development/")
    monkeypatch.setenv("JELLYFISH_TEST_MYSQL_URL", "mysql+aiomysql://test@localhost/jellyfish_check_worker")
    monkeypatch.setenv("S3_ORPHAN_CLEANUP_SCOPE", "development-authorization")
    first, second = test_environment(), test_environment()
    assert first["S3_BASE_PATH"].startswith("development/validation/")
    assert first["S3_BASE_PATH"] != second["S3_BASE_PATH"]
    assert first["S3_ORPHAN_CLEANUP_SCOPE"] == ""


@pytest.mark.parametrize("override", [
    {"DATABASE_URL": "mysql+aiomysql://app@localhost/jellyfish"},
    {"S3_BASE_PATH": ""},
    {"S3_BASE_PATH": "development/files/validation/0123456789abcdef0123456789abcdef"},
    {"S3_ORPHAN_CLEANUP_SCOPE": "inherited-authorization"},
    {"database_url": "mysql+aiomysql://app@localhost/jellyfish"},
    {"s3_base_path": ""},
    {"s3_orphan_cleanup_scope": "inherited-authorization"},
])
def test_unsafe_worker_config_is_rejected_before_process_creation(monkeypatch, override):
    from app.config import settings
    from tests.isolated_mysql import test_environment
    from tests.worker_process import start_test_worker

    monkeypatch.setattr(settings, "database_url", "mysql+aiomysql://app@localhost/jellyfish")
    monkeypatch.setattr(settings, "s3_base_path", "development")
    monkeypatch.setenv("JELLYFISH_TEST_MYSQL_URL", "mysql+aiomysql://test@localhost/jellyfish_check_worker")
    env = test_environment()
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: pytest.fail("Worker process was created"))
    with pytest.raises(ValueError):
        start_test_worker({**env, **override})


@pytest.mark.parametrize(("unsafe", "message"), [
    ("database", "SQLite database inside the fixture directory"),
    ("bucket", "SQLite test Worker must explicitly disable real S3"),
    ("media", "Browser Worker media must stay inside"),
    ("bucket_alias", "Use uppercase names for test database and storage settings"),
])
def test_browser_worker_rejects_unsafe_environment_at_cli(tmp_path, monkeypatch, unsafe, message):
    database = tmp_path / "worker.sqlite"
    database.touch()
    root = tmp_path / "fixture"
    root.mkdir()
    inside = root / "worker.sqlite"
    inside.touch()
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{database if unsafe == 'database' else inside}")
    monkeypatch.setenv("S3_BUCKET_NAME", "shared" if unsafe == "bucket" else "")
    monkeypatch.setenv("S3_ENDPOINT_URL", "")
    monkeypatch.setenv("S3_ORPHAN_CLEANUP_SCOPE", "")
    monkeypatch.setenv("CANVAS_BROWSER_MEDIA_STORAGE", str(tmp_path if unsafe == "media" else root / "media"))
    if unsafe == "bucket_alias":
        monkeypatch.setenv("s3_bucket_name", "shared")
    result = subprocess.run(
        [sys.executable, "-m", "tests.worker_process", "--sqlite-root", str(root)],
        cwd=BACKEND, capture_output=True, text=True, check=False, timeout=5,
    )
    assert result.returncode == 2
    assert message in result.stderr
    assert not (root / "media").exists()


def test_isolated_mysql_runner_rejects_case_insensitive_alias_before_dispatch(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "mysql+aiomysql://app@localhost/jellyfish")
    monkeypatch.setenv("JELLYFISH_TEST_MYSQL_URL", "mysql+aiomysql://test@localhost/jellyfish_check_worker")
    monkeypatch.setenv("s3_base_path", "")
    result = subprocess.run(
        [sys.executable, "-c", REJECT_CONNECTIONS, "pytest"],
        cwd=BACKEND, capture_output=True, text=True, check=False, timeout=5,
    )
    assert result.returncode == 2
    assert "Use uppercase names for test database and storage settings" in result.stderr


def test_worker_rejects_reuse_of_active_mysql_database_without_isolated_dispatch(monkeypatch):
    from app.config import settings
    from tests.isolated_mysql import DISPATCHED_TARGET_ENV, isolated_storage_environment, test_environment
    from tests.services.test_task_mysql import isolated_database_url
    from tests.worker_process import start_test_worker

    target = "mysql+aiomysql://test@localhost/jellyfish_check_current"
    monkeypatch.setenv("JELLYFISH_TEST_MYSQL_URL", target)
    monkeypatch.delenv(DISPATCHED_TARGET_ENV, raising=False)
    monkeypatch.setattr(settings, "database_url", target)
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: pytest.fail("Worker process was created"))
    with pytest.raises(ValueError, match="current database"):
        isolated_database_url()
    with pytest.raises(ValueError, match="current database"):
        start_test_worker({"DATABASE_URL": target, **isolated_storage_environment()})

    monkeypatch.setattr(settings, "database_url", "mysql+aiomysql://app@localhost/jellyfish")
    dispatched = test_environment()
    monkeypatch.setenv(DISPATCHED_TARGET_ENV, dispatched[DISPATCHED_TARGET_ENV])
    monkeypatch.setattr(settings, "database_url", target)
    assert isolated_database_url() == target
