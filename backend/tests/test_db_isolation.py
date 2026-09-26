"""数据库隔离与「正式库防回归」的回归测试。

覆盖四件事（对应任务要求）：

1. **隔离真的生效**：本会话的 ``DATABASE_URL`` 指向系统临时目录里的临时库，
   文件存在、表已建好、种子已写入，并且应用自己的 engine 确实连的是它；
2. **硬拒绝**：正式库路径 / ``jellyfish.db`` 文件名 / 仓库内路径 / 非临时路径 /
   非 SQLite URL 一律抛 :class:`NonTestDatabaseError`（中文说明原因）；
3. **逃生口**只有显式设置 ``JELLYFISH_ALLOW_NON_TEST_DB=1`` 时才放行；
4. **快照判定**：两个不同的快照判为「变化」、相同判为「未变化」（纯函数单测，
   不碰正式库），并且真的写一行到临时库后，正式库的会话级快照仍然不变。

本文件只对正式库做**只读**查询（只读快照 + 只读 SELECT），不写、不迁移、不删。
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest

import tests._db_isolation as isolation
from tests._db_isolation import (
    ALLOW_NON_TEST_ENV,
    BACKEND_ROOT,
    DB_URL_ENV,
    SESSION_DB_FILENAME,
    NonTestDatabaseError,
    assert_session_database_target,
    assert_test_database,
    current_session_database,
    dotenv_database_url,
    effective_database_url,
    escape_hatch_enabled,
    guarded_db_paths,
    parse_database_url,
    session_start_snapshots,
    system_temp_roots,
)
from tests._prod_db_snapshot import (
    DatabaseSnapshot,
    FileFingerprint,
    snapshot_changes,
    table_names,
    take_snapshot,
)

#: 逃生口打开时（隔离被显式关闭）「隔离生效」类断言无意义 → 直接跳过而不是失败。
#: 逃生口本身的行为由 test_escape_hatch_* 用例覆盖（它们用 monkeypatch，不依赖会话隔离）。
requires_isolation = pytest.mark.skipif(
    escape_hatch_enabled(),
    reason="JELLYFISH_ALLOW_NON_TEST_DB=1 已关闭数据库隔离，本次不做隔离断言",
)

#: 探针行 ID：真的会写进库，因此必须带一个一眼可辨的前缀。
PROBE_TASK_ID = "db-isolation-probe-task"
PROBE_KIND = "db_isolation_probe"


def _real(path: Path) -> Path:
    return Path(os.path.realpath(str(path)))


def _sqlite_path_of(url: str) -> Path:
    parsed = parse_database_url(url)
    assert parsed.kind == "sqlite_file" and parsed.path is not None, url
    return parsed.path


def _read_only_count(db_path: Path, task_id: str) -> int:
    """只读查询某个任务 ID 是否在库里。"""
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return int(
            connection.execute(
                "SELECT COUNT(*) FROM generation_tasks WHERE id = ?", (task_id,)
            ).fetchone()[0]
        )
    finally:
        connection.close()


# --------------------------------------------------------------------- 1. 隔离生效


@requires_isolation
def test_session_database_is_a_fresh_temp_db(session_database) -> None:
    """会话级夹具给出的库：**本会话新建**、在系统临时目录里、且被环境变量显式指定。"""
    session = session_database
    assert session is current_session_database()
    assert session.isolation_active is True
    assert session.escape_hatch is False

    assert session.db_path is not None and session.tmpdir is not None
    assert session.db_path.name == SESSION_DB_FILENAME
    assert session.db_path.name != isolation.PRODUCTION_DB_NAME
    assert session.db_path.is_file(), "临时库文件必须真实存在"

    # 临时目录是本会话新建的，且落在系统临时目录下（macOS 的 /var → /private/var 也算）
    assert _real(session.tmpdir).parent in system_temp_roots()
    assert session.tmpdir.name.startswith(isolation.SESSION_TMP_PREFIX)
    # 绝不在仓库工作树里
    assert _real(BACKEND_ROOT) not in _real(session.db_path).parents

    # 进程环境变量已被隔离层**显式覆盖**成临时库
    assert os.environ[DB_URL_ENV] == session.url
    assert _real(_sqlite_path_of(os.environ[DB_URL_ENV])) == _real(session.db_path)
    # 于是应用读到的配置也是临时库
    from app.config import settings

    assert _real(_sqlite_path_of(str(settings.database_url))) == _real(session.db_path)


@requires_isolation
def test_session_database_has_schema_and_seed(session_database) -> None:
    """临时库已建表 + 已写入假供应商/模型种子（复用 scripts/init_test_db.py 的逻辑）。"""
    db_path = session_database.db_path
    assert db_path is not None
    tables = set(table_names(db_path))
    required = {
        "projects",
        "chapters",
        "shots",
        "generation_tasks",
        "files",
        "characters",
        "scenes",
        "props",
        "costumes",
        "providers",
        "models",
        "model_settings",
    }
    assert required <= tables, f"临时库缺表：{sorted(required - tables)}"

    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        providers = connection.execute("SELECT COUNT(*) FROM providers").fetchone()[0]
        models = connection.execute("SELECT COUNT(*) FROM models").fetchone()[0]
    finally:
        connection.close()
    assert providers >= 2 and models >= 3, "临时库必须有假供应商/假模型种子"


@requires_isolation
def test_app_engine_points_at_session_database(session_database) -> None:
    """应用**实际**用的 engine（模块导入时创建）指向本会话临时库，而不是 .env 里的正式库。"""
    from app.core.db import engine

    parsed = parse_database_url(str(engine.url))
    assert parsed.kind == "sqlite_file" and parsed.path is not None
    assert _real(parsed.path) == _real(session_database.db_path)
    assert str(engine.url) == session_database.url

    # 隔离层的复核函数（conftest 在 pytest_configure 里调用的那个）此刻必须通过
    isolation.assert_engine_is_isolated()


@requires_isolation
def test_engine_mismatch_is_refused(session_database, monkeypatch: pytest.MonkeyPatch) -> None:
    """「实际运行库路径」被换掉时，复核函数必须拒绝启动（对应 pytest_configure 里的 pytest.exit）。"""
    from app.core import db as db_module

    class _FakeEngine:
        def __init__(self, url: str) -> None:
            self.url = url

    other = _real(session_database.tmpdir) / "somewhere_else.db"
    monkeypatch.setattr(db_module, "engine", _FakeEngine(f"sqlite+aiosqlite:///{other}"))
    with pytest.raises(NonTestDatabaseError) as excinfo:
        isolation.assert_engine_is_isolated()
    assert "不是本会话的临时测试库" in str(excinfo.value)

    monkeypatch.setattr(
        db_module, "engine", _FakeEngine("sqlite+aiosqlite:////Users/apple/nowhere/prod.db")
    )
    with pytest.raises(NonTestDatabaseError):
        isolation.assert_engine_is_isolated()


@requires_isolation
def test_tampered_env_url_is_refused(
    session_database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """进程环境变量里的 DATABASE_URL 被改动（不再等于会话临时库）→ 拒绝。"""
    monkeypatch.setenv(DB_URL_ENV, "sqlite+aiosqlite:////tmp/other/probe.db")
    with pytest.raises(NonTestDatabaseError) as excinfo:
        isolation.assert_engine_is_isolated()
    assert "被改动过" in str(excinfo.value)


@requires_isolation
def test_dotenv_production_url_is_detected_and_never_used() -> None:
    """``.env`` 里的正式库 URL 被识别为「禁区」，且**没有**被进程继承。"""
    env_url = dotenv_database_url()
    if not env_url:
        pytest.skip("backend/.env 里没有 DATABASE_URL，无需检查正式库继承")
    assert os.environ[DB_URL_ENV] != env_url, "进程环境变量必须显式覆盖 .env，否则会继承正式库"

    parsed = parse_database_url(env_url)
    if parsed.kind == "sqlite_file" and parsed.path is not None:
        if parsed.path.name == isolation.PRODUCTION_DB_NAME:
            assert _real(parsed.path) in guarded_db_paths()
            with pytest.raises(NonTestDatabaseError):
                assert_test_database(env_url, role=".env 里的 DATABASE_URL")


# ---------------------------------------------------------------------- 2. 硬拒绝


def _prod_url() -> str:
    return f"sqlite+aiosqlite:///{guarded_db_paths()[0]}"


@pytest.mark.parametrize(
    ("role", "candidate", "expected"),
    [
        ("正式库绝对路径（.env 指向的那份）", _prod_url(), "就是正式库"),
        ("正式库路径 Path 对象", str(guarded_db_paths()[0]), "就是正式库"),
        ("仓库工作区里的 jellyfish.db", str(BACKEND_ROOT / "jellyfish.db"), "就是正式库"),
        ("任何位置的 jellyfish.db 文件名", "/tmp/jf_isolation_probe/jellyfish.db", "文件名是"),
        ("相对路径 ./jellyfish.db", "sqlite+aiosqlite:///./jellyfish.db", "就是正式库"),
        ("仓库工作树内的普通文件名", str(BACKEND_ROOT / "storage" / "probe.db"), "仓库工作树内"),
        ("家目录下的非临时路径", str(Path.home() / "jf_isolation_probe" / "probe.db"), "临时目录"),
        ("非 SQLite URL", "postgresql+asyncpg://u:p@localhost:5432/jellyfish", "不是 SQLite 测试库"),
        ("空值", "", "空值"),
    ],
)
@requires_isolation
def test_non_test_databases_are_refused(role: str, candidate: str, expected: str) -> None:
    """这些「最终生效路径」必须被直接拒绝，报错信息要写清为什么。"""
    with pytest.raises(NonTestDatabaseError) as excinfo:
        assert_test_database(candidate, role=role)

    message = str(excinfo.value)
    assert "拒绝启动后端测试" in message
    assert expected in message, f"报错没说清原因：{message}"
    assert "怎么跑才对" in message, "报错必须告诉人怎么跑"


@requires_isolation
def test_effective_url_from_process_env_is_validated(monkeypatch: pytest.MonkeyPatch) -> None:
    """把「生效路径」构造成正式库 → 拒绝（这正是「不允许继承正式 DATABASE_URL」那条）。"""
    monkeypatch.setenv(DB_URL_ENV, _prod_url())
    assert effective_database_url() == _prod_url()
    with pytest.raises(NonTestDatabaseError):
        assert_test_database(effective_database_url())


@requires_isolation
def test_memory_and_temp_targets_are_allowed(tmp_path: Path) -> None:
    """``:memory:`` 与系统临时目录里的库不算「非测试库」，不拒绝。"""
    assert_test_database("sqlite+aiosqlite:///:memory:")
    assert_test_database(str(tmp_path / "probe.db"))


@requires_isolation
def test_session_target_must_be_inside_session_tmpdir(
    session_database, tmp_path: Path
) -> None:
    """最严的一条：库必须就在**本会话新建的临时目录**里（``/tmp`` 里的旧库也不行）。"""
    session = session_database
    # 自己的临时库 → 通过
    assert_session_database_target(session.db_path, session.tmpdir)

    stranger = Path("/tmp") / "jf_isolation_probe" / "test_jellyfish.db"
    with pytest.raises(NonTestDatabaseError) as excinfo:
        assert_session_database_target(stranger, session.tmpdir)
    assert "不在隔离层刚创建的临时目录里" in str(excinfo.value)

    with pytest.raises(NonTestDatabaseError):
        assert_session_database_target(tmp_path / "test_jellyfish.db", session.tmpdir)


# ---------------------------------------------------------------------- 3. 逃生口


def test_escape_hatch_is_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ALLOW_NON_TEST_ENV, raising=False)
    assert escape_hatch_enabled() is False
    with pytest.raises(NonTestDatabaseError):
        assert_test_database(_prod_url())


@pytest.mark.parametrize("raw", ["0", "", "no", "off", "maybe"])
def test_escape_hatch_needs_a_truthy_value(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    """只有显式的真值才算打开；``0``/空串/读不懂的值一律按「没开」处理（fail-closed）。"""
    monkeypatch.setenv(ALLOW_NON_TEST_ENV, raw)
    assert escape_hatch_enabled() is False
    with pytest.raises(NonTestDatabaseError):
        assert_test_database(_prod_url())


@pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on"])
def test_escape_hatch_explicitly_enabled_lets_it_through(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    """显式打开才放行（危险档：只用于特殊排查，任何脚本/文档的推荐跑法里都不许出现）。"""
    monkeypatch.setenv(ALLOW_NON_TEST_ENV, raw)
    assert escape_hatch_enabled() is True
    assert_test_database(_prod_url())  # 不再抛错
    assert_session_database_target(Path("/tmp/jf_isolation_probe/x.db"), Path("/tmp/other"))


# ------------------------------------------------------------- 4. 快照对比（纯函数）


def _fingerprint(
    size: int, mtime_ns: int, sha256: str, path: str = "/x/jellyfish.db"
) -> FileFingerprint:
    return FileFingerprint(path=path, exists=True, size=size, mtime_ns=mtime_ns, sha256=sha256)


def _snapshot(
    *,
    main: FileFingerprint | None = None,
    wal: FileFingerprint | None = None,
    shm: FileFingerprint | None = None,
    rows: dict[str, int] | None = None,
) -> DatabaseSnapshot:
    return DatabaseSnapshot(
        path="/x/jellyfish.db",
        taken_at="2026-01-01T00:00:00",
        main=main or _fingerprint(100, 111, "aaa"),
        wal=wal or _fingerprint(0, 111, "eee"),
        shm=shm,
        row_counts=rows if rows is not None else {"projects": 3, "generation_tasks": 7},
    )


def test_snapshot_changes_is_empty_for_identical_snapshots() -> None:
    assert snapshot_changes(_snapshot(), _snapshot()) == []


def test_snapshot_changes_detects_row_count_change() -> None:
    after = _snapshot(rows={"projects": 3, "generation_tasks": 8})
    changes = snapshot_changes(_snapshot(), after)
    assert changes, "行数变了必须判为变化"
    assert any("generation_tasks" in item and "7 → 8" in item for item in changes), changes


def test_snapshot_changes_detects_hash_size_and_mtime_change() -> None:
    hash_changed = _snapshot(main=_fingerprint(100, 111, "bbb"))
    size_changed = _snapshot(main=_fingerprint(101, 111, "aaa"))
    mtime_changed = _snapshot(main=_fingerprint(100, 222, "aaa"))
    assert any("内容哈希" in item for item in snapshot_changes(_snapshot(), hash_changed))
    assert any("大小" in item for item in snapshot_changes(_snapshot(), size_changed))
    assert any("mtime" in item for item in snapshot_changes(_snapshot(), mtime_changed))


def test_snapshot_changes_detects_wal_change_and_ignores_shm() -> None:
    """``-wal`` 参与判定（WAL 模式的写入先落这里）；``-shm`` 只记录，不参与。"""
    wal_changed = _snapshot(wal=_fingerprint(10, 111, "fff"))
    assert any("wal" in item for item in snapshot_changes(_snapshot(), wal_changed))
    shm_only = _snapshot(shm=_fingerprint(32768, 999, "shm-changed"))
    assert snapshot_changes(_snapshot(), shm_only) == []


def test_snapshot_changes_detects_disappeared_file() -> None:
    gone = _snapshot(main=FileFingerprint(path="/x/jellyfish.db", exists=False))
    changes = snapshot_changes(_snapshot(), gone)
    assert changes and any("存在性" in item for item in changes), changes


def test_take_snapshot_reads_row_counts_of_a_temp_db(tmp_path: Path) -> None:
    """快照函数本身对普通文件可用：行数、哈希都读得到，且前后一致判为「未变化」。"""
    db_path = tmp_path / "probe.db"
    connection = sqlite3.connect(db_path)
    connection.executescript("CREATE TABLE marker (id TEXT); INSERT INTO marker VALUES ('a');")
    connection.commit()
    connection.close()

    before = take_snapshot(db_path)
    assert before.row_counts.get("marker") == 1
    assert before.main.sha256 is not None
    assert snapshot_changes(before, take_snapshot(db_path)) == []

    connection = sqlite3.connect(db_path)
    connection.execute("INSERT INTO marker VALUES ('b')")
    connection.commit()
    connection.close()
    changes = snapshot_changes(before, take_snapshot(db_path))
    assert any("marker" in item and "1 → 2" in item for item in changes), changes


def test_compare_guarded_databases_reports_real_change(tmp_path: Path) -> None:
    """真的改一个库的文件后，比对函数必须报出「哪个库变了」。"""
    db_path = tmp_path / "guarded_probe.db"
    connection = sqlite3.connect(db_path)
    connection.executescript("CREATE TABLE t (id TEXT); INSERT INTO t VALUES ('a');")
    connection.commit()
    connection.close()

    before = take_snapshot(db_path)
    assert isolation.compare_guarded_databases({str(db_path): before}) == []

    connection = sqlite3.connect(db_path)
    connection.execute("INSERT INTO t VALUES ('b')")
    connection.commit()
    connection.close()

    changed = isolation.compare_guarded_databases({str(db_path): before})
    assert changed == [str(db_path)], changed


def test_finish_session_fails_the_run_when_snapshot_changed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """快照不一致 → 整次测试被置为非零退出码（这里用替身 session 断言，不动真实会话）。"""
    db_path = tmp_path / "guarded_probe.db"
    connection = sqlite3.connect(db_path)
    connection.executescript("CREATE TABLE t (id TEXT);")
    connection.commit()
    connection.close()
    before = take_snapshot(db_path)

    connection = sqlite3.connect(db_path)
    connection.execute("INSERT INTO t VALUES ('changed')")
    connection.commit()
    connection.close()

    class _StubSession:
        exitstatus = 0

    stub = _StubSession()
    monkeypatch.setattr(isolation, "_FINISHED", False)
    try:
        changed = isolation.finish_session_database(
            stub, start_snapshots={str(db_path): before}, cleanup=False
        )
    finally:
        monkeypatch.setattr(isolation, "_FINISHED", False)

    assert changed is True
    assert stub.exitstatus == pytest.ExitCode.TESTS_FAILED


def test_finish_session_keeps_run_ok_when_nothing_changed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "guarded_probe.db"
    sqlite3.connect(db_path).close()
    before = take_snapshot(db_path)

    class _StubSession:
        exitstatus = 0

    stub = _StubSession()
    monkeypatch.setattr(isolation, "_FINISHED", False)
    try:
        changed = isolation.finish_session_database(
            stub, start_snapshots={str(db_path): before}, cleanup=False
        )
    finally:
        monkeypatch.setattr(isolation, "_FINISHED", False)

    assert changed is False
    assert stub.exitstatus == 0


# ------------------------------------------------- 5. 真的写库：只写临时库，不写正式库


@requires_isolation
def test_app_session_writes_land_in_temp_db_not_production(session_database) -> None:
    """用**应用自己的** async session 写一行 generation_tasks，然后逐项验证：

    1. 这一行能在本会话临时库里读回来（说明写的是临时库）；
    2. 正式库/工作区库里**没有**这一行（只读查询）；
    3. 会话级快照（``session_start_snapshots()``）显示这些库哈希与行数都没变。
    """
    session = session_database
    assert session.db_path is not None

    async def _write_probe_row() -> None:
        from app.core.db import async_session_maker
        from app.models.task import GenerationTask

        async with async_session_maker() as db:
            db.add(
                GenerationTask(
                    id=PROBE_TASK_ID,
                    mode="async_polling",
                    task_kind=PROBE_KIND,
                    status="pending",
                )
            )
            await db.commit()

    asyncio.run(_write_probe_row())

    # 1) 临时库里真的有这一行
    connection = sqlite3.connect(f"file:{session.db_path}?mode=ro", uri=True)
    try:
        row = connection.execute(
            "SELECT id, task_kind FROM generation_tasks WHERE id = ?", (PROBE_TASK_ID,)
        ).fetchone()
    finally:
        connection.close()
    assert row == (PROBE_TASK_ID, PROBE_KIND), f"临时库里没写进去：{row}"

    # 2) 被保护的正式库/工作区库里没有这一行（只读）
    guarded = [path for path in guarded_db_paths() if path.exists()]
    assert guarded, "至少要有一个被保护的正式库/工作区库"
    for path in guarded:
        assert _read_only_count(path, PROBE_TASK_ID) == 0, f"{path} 里出现了测试写入的行！"

    # 3) 会话级快照：正式库在整个会话内没变
    start = session_start_snapshots()
    assert start, "隔离层必须记录会话前的正式库快照"
    for path_text, before in start.items():
        after = take_snapshot(Path(path_text))
        assert snapshot_changes(before, after) == [], f"{path_text} 在会话内发生了变化"


def test_snapshot_helper_is_reusable_for_reporting() -> None:
    """快照对象能给出可读结论（用于人工核对，不依赖正式库内容）。"""
    snapshot = _snapshot()
    described = snapshot.describe()
    assert "generation_tasks" not in described  # describe() 只给概览，不展开每张表
    assert replace(snapshot, row_counts={}).describe().endswith("行数不可用")
