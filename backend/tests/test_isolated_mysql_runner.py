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
