"""后端测试的数据库隔离层：**默认只允许使用本会话新建的临时测试库**。

要解决的问题
------------
``app/core/db.py`` 是**模块导入时**用 ``settings.database_url`` 建 async engine 的，
而 ``settings``（``app/config.py``）会读 ``backend/.env``。本仓库的 ``.env`` 里
``DATABASE_URL`` 指向**正式库**，于是「跑一遍 pytest」就会在没人察觉的情况下把测试
数据写进正式库（历史上真的发生过：8 行 ``generation_tasks``）。

本模块的口径（按优先级）
------------------------
1. **默认隔离（不需要任何人手动设环境变量）**：无论 ``.env`` 里写了什么，都在
   ``tests/conftest.py`` 顶层（**早于任何 ``app.*`` 导入**）用 ``tempfile.mkdtemp()``
   新建一个全新临时库 ``test_jellyfish.db``，把 ``DATABASE_URL`` 指过去，并复用
   ``scripts/init_test_db.py`` 的初始化逻辑建表 + 写假供应商/模型种子。进程环境变量
   优先于 ``.env``（见 ``app/config.py`` 注释），所以 ``.env`` 里的正式库 URL 被
   **显式覆盖**。手动设的 ``DATABASE_URL`` 若本身就是合法的测试库（系统临时目录 /
   ``:memory:``），会被忽略并打印提示，测试仍跑在本次新建的临时库上（保证「全新」）。
2. **硬拒绝（fail-fast）**：校验「最终生效的数据库路径」。命中下列任一条 → 拒绝
   启动整次测试（抛 :class:`NonTestDatabaseError`，由 conftest 转成 ``pytest.exit``）：
   是正式库路径 / 文件名是 ``jellyfish.db`` / 落在仓库工作树内 / 不在系统临时目录里 /
   不是 sqlite（既不是临时库也不是 ``:memory:``）。
3. **逃生口**：``JELLYFISH_ALLOW_NON_TEST_DB=1`` 显式设置时才放行非测试库。
   它**只用于特殊排查**（会连非测试库、可能写真数据），任何脚本与文档的推荐跑法里
   **都不许**出现它。

正式库绝不被本模块写入：本模块只做「读 ``.env``」「建临时库」「读临时库」。
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from tests._prod_db_snapshot import (
    DatabaseSnapshot,
    format_change_report,
    rows_digest,
    snapshot_changes,
    snapshot_degradations,
    take_snapshot,
)
from tests.selfcheck_db import _path_from_database_url as _sqlite_path_from_url

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent

#: 进程环境变量名（与 ``app/config.py`` 里 ``database_url`` 的大小写无关）。
DB_URL_ENV = "DATABASE_URL"
#: 危险逃生口：只用于特殊排查，不得出现在推荐跑法里。
ALLOW_NON_TEST_ENV = "JELLYFISH_ALLOW_NON_TEST_DB"
#: 正式库文件名：任何目录下都不允许当作测试库。
PRODUCTION_DB_NAME = "jellyfish.db"

#: 本会话临时库的文件名（故意不叫 ``jellyfish.db``，避免撞上正式库命名规则）。
SESSION_DB_FILENAME = "test_jellyfish.db"
#: 本会话临时目录前缀，便于人工辨认与清理。
SESSION_TMP_PREFIX = "jellyfish_pytest_db_"

#: 硬编码兜底的正式库/工作区库位置 —— 即使 ``.env`` 被改，也认这些路径是禁区。
#: （正式库由 ``.env`` 的 ``DATABASE_URL`` 指向；``backend/jellyfish.db`` 是本仓库
#: 工作区里的那份历史库，同样不允许被测试写入。）
FIXED_GUARDED_PATHS: tuple[Path, ...] = (
    Path("/Users/apple/Documents/Jellyfish/backend/jellyfish.db"),
    BACKEND_ROOT / PRODUCTION_DB_NAME,
)

_HOW_TO_RUN = (
    "怎么跑才对：直接执行 `cd backend && .venv/bin/python -m pytest tests/ -q` 即可 —— "
    "隔离层会自动建一个全新临时库，不需要你设置任何环境变量。\n"
    "如果你手动设了 DATABASE_URL，请删掉它再跑。"
)


class NonTestDatabaseError(RuntimeError):
    """最终生效的数据库不是「测试库」——拒绝启动测试。"""


@dataclass(frozen=True)
class ParsedDatabaseUrl:
    """``DATABASE_URL`` 的解析结果。"""

    kind: str  # "sqlite_file" / "sqlite_memory" / "other" / "empty"
    raw: str
    path: Path | None = None


@dataclass(frozen=True)
class SessionDatabase:
    """本会话实际生效的数据库。"""

    url: str
    db_path: Path | None
    tmpdir: Path | None
    escape_hatch: bool
    #: 是否真的把 ``DATABASE_URL`` 覆盖成了本会话临时库
    isolation_active: bool


_SESSION: SessionDatabase | None = None
_START_SNAPSHOTS: dict[str, DatabaseSnapshot] = {}
_FINISHED = False
#: 会话启动时要打到终端的信息（conftest 用 terminalreporter 输出，避免被 -q 吞掉）
_notices: list[str] = []


# --------------------------------------------------------------------------- 基础工具


def _emit(text: str) -> None:
    """写**真实** stderr（绕开 pytest 的输出捕获），保证警告一定看得见。"""
    stream = getattr(sys, "__stderr__", None) or sys.stderr
    print(text, file=stream, flush=True)


def _real(path: Path) -> Path:
    """规范化路径（处理 macOS 的 ``/var`` → ``/private/var`` 软链）。"""
    return Path(os.path.realpath(str(path)))


def escape_hatch_enabled() -> bool:
    """逃生口是否**显式**打开（只有 ``1/true/yes/on`` 这类真值才算）。"""
    raw = str(os.environ.get(ALLOW_NON_TEST_ENV) or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def parse_database_url(url: str) -> ParsedDatabaseUrl:
    """解析 ``DATABASE_URL``（复用 ``tests/selfcheck_db.py`` 的 sqlite 路径规则）。"""
    text = str(url or "").strip()
    if not text:
        return ParsedDatabaseUrl(kind="empty", raw=text)
    scheme = text.split("://", 1)[0].lower()
    if not scheme.startswith("sqlite"):
        return ParsedDatabaseUrl(kind="other", raw=text)
    if ":memory:" in text:
        return ParsedDatabaseUrl(kind="sqlite_memory", raw=text)
    path = _sqlite_path_from_url(text, BACKEND_ROOT)
    if path is None:
        return ParsedDatabaseUrl(kind="other", raw=text)
    return ParsedDatabaseUrl(kind="sqlite_file", raw=text, path=path)


def parse_database_candidate(candidate: str | Path) -> ParsedDatabaseUrl:
    """把「URL 或裸文件路径」统一解析成同一种结构。

    校验函数既要能判 ``sqlite+aiosqlite:///…`` 这样的 URL，也要能判
    ``Path("/x/y.db")`` / ``"/x/y.db"`` 这样的裸路径（调用方常常只有路径）。
    """
    if isinstance(candidate, Path):
        return ParsedDatabaseUrl(kind="sqlite_file", raw=str(candidate), path=Path(candidate))
    text = str(candidate).strip()
    if not text:
        return ParsedDatabaseUrl(kind="empty", raw=text)
    if "://" in text:
        return parse_database_url(text)
    return ParsedDatabaseUrl(kind="sqlite_file", raw=text, path=Path(text))


def system_temp_roots() -> tuple[Path, ...]:
    """系统临时目录集合（测试库允许落在这里）。

    注意 macOS：``tempfile.gettempdir()`` 是 ``/var/folders/.../T``，而 ``/tmp`` 是
    指向 ``/private/tmp`` 的软链 —— 两者都算「系统临时目录」，所以这里按真实路径收齐。
    """
    roots: list[Path] = [_real(Path(tempfile.gettempdir()))]
    for extra in ("/tmp", "/var/tmp"):
        candidate = Path(extra)
        if candidate.exists():
            roots.append(_real(candidate))
    unique: list[Path] = []
    for root in roots:
        if root not in unique:
            unique.append(root)
    return tuple(unique)


def guarded_db_paths() -> tuple[Path, ...]:
    """所有「绝对不允许被测试写入」的库路径（按 :func:`_real` 去重）。"""
    candidates: list[Path] = []
    env_url = dotenv_database_url()
    if env_url:
        parsed = parse_database_url(env_url)
        if parsed.kind == "sqlite_file" and parsed.path is not None:
            candidates.append(parsed.path)
    candidates.extend(FIXED_GUARDED_PATHS)

    seen: list[Path] = []
    for item in candidates:
        real = _real(item)
        if real not in seen:
            seen.append(real)
    return tuple(seen)


def dotenv_database_url() -> str | None:
    """从 ``backend/.env`` 里读出 ``DATABASE_URL``（**不导入** ``app.config``）。

    故意不用 ``app.config.settings``：那会在隔离完成前就把 Settings 冻结住，
    正是我们要避免的时序问题。
    """
    env_file = BACKEND_ROOT / ".env"
    if not env_file.is_file():
        return None
    try:
        from dotenv import dotenv_values

        value = dotenv_values(str(env_file)).get(DB_URL_ENV)
        if value is not None and str(value).strip():
            return str(value).strip()
    except Exception:  # noqa: BLE001 - 缺 python-dotenv 时走下面的朴素解析
        pass
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key_name = key.strip()
            if key_name.startswith("export "):
                key_name = key_name[len("export ") :].strip()
            if key_name != DB_URL_ENV:
                continue
            return value.split(" #", 1)[0].strip().strip("'\"") or None
    except OSError:
        return None
    return None


def effective_database_url() -> str:
    """按「进程环境变量 → ``.env`` → 代码默认值」解析最终生效的 URL。

    这个顺序与 ``app/config.py`` 里 pydantic-settings 的行为一致（环境变量优先）。
    """
    from_env = str(os.environ.get(DB_URL_ENV) or "").strip()
    if from_env:
        return from_env
    from_dotenv = dotenv_database_url()
    if from_dotenv:
        return from_dotenv
    return "sqlite+aiosqlite:///./jellyfish.db"


# --------------------------------------------------------------------------- 硬拒绝


def _refusal_reason(  # pylint: disable=too-many-return-statements
    candidate: ParsedDatabaseUrl, *, role: str
) -> str | None:
    """判定「这个最终生效的库为什么不能用来跑测试」；测试库返回 ``None``。

    这是**纯判定**函数（只读文件系统元信息，不写任何东西），单独可测。
    """
    if candidate.kind == "empty":
        return f"{role}是空值：无法确认它是测试库。"
    if candidate.kind == "other":
        return (
            f"{role}不是 SQLite 测试库：{candidate.raw}\n"
            "本仓库的测试只允许跑在「全新临时 SQLite 库」或 `:memory:` 上。"
        )
    if candidate.kind == "sqlite_memory":
        return None
    assert candidate.path is not None
    path = candidate.path
    real = _real(path)

    guarded = guarded_db_paths()
    if real in guarded:
        return (
            f"{role}就是正式库/工作区库：{real}\n"
            "正式库绝不允许被测试写入（哪怕只是「新建一个同名库」）。"
        )
    if real.name == PRODUCTION_DB_NAME:
        return (
            f"{role}的文件名是 {PRODUCTION_DB_NAME}（正式库命名）：{real}\n"
            "任何叫这个文件名的库都一律拒绝，改用临时库名（例如 test_jellyfish.db）。"
        )
    if real == _real(REPO_ROOT) or _real(REPO_ROOT) in real.parents:
        return (
            f"{role}落在仓库工作树内：{real}\n"
            "测试库必须放在系统临时目录里，不能写进仓库。"
        )
    temp_roots = system_temp_roots()
    if not any(real == root or root in real.parents for root in temp_roots):
        joined = "、".join(str(root) for root in temp_roots)
        return (
            f"{role}不在任何系统临时目录（{joined}）里：{real}\n"
            "无法确认它是「本次测试用完就丢」的临时库，因此拒绝。"
        )
    return None


def assert_test_database(candidate: str | Path, *, role: str = "最终生效的数据库") -> None:
    """硬拒绝入口：不是测试库就抛 :class:`NonTestDatabaseError`（中文说清原因）。"""
    if escape_hatch_enabled():
        return
    parsed = parse_database_candidate(candidate)
    reason = _refusal_reason(parsed, role=role)
    if reason is not None:
        raise NonTestDatabaseError(
            "拒绝启动后端测试：检测到最终生效的数据库不是测试库。\n"
            f"{reason}\n"
            f"{_HOW_TO_RUN}\n"
            f"（危险逃生口 {ALLOW_NON_TEST_ENV}=1 只用于特殊排查，绝不要写进脚本或文档。）"
        )


def assert_session_database_target(
    db_path: Path, session_tmpdir: Path, *, role: str = "本会话临时测试库"
) -> None:
    """最严的一条：库必须**就在本会话新建的临时目录里**（否则拒绝）。

    这是「路径不在本会话创建的临时目录里 → 拒绝」那条规则的落点：只要求「在临时
    目录里」还不够 —— ``/tmp/别人留下的库.db`` 也满足它，但可能是一份有数据的旧库。
    必须是隔离层这次亲手新建的那个目录。
    """
    if escape_hatch_enabled():
        return
    real = _real(Path(db_path))
    root = _real(Path(session_tmpdir))
    if root not in real.parents:
        raise NonTestDatabaseError(
            "拒绝启动后端测试：本会话临时库不在隔离层刚创建的临时目录里。\n"
            f"    临时库路径    ：{real}\n"
            f"    本会话临时目录：{root}\n"
            f"{_HOW_TO_RUN}"
        )
    assert_test_database(real, role=role)


# --------------------------------------------------------------------------------- 会话


def current_session_database() -> SessionDatabase | None:
    """本会话的数据库信息；未安装隔离时返回 ``None``。"""
    return _SESSION


def session_notices() -> list[str]:
    """会话启动信息（隔离层在 conftest 导入阶段记下的，由 conftest 打到终端）。"""
    return list(_notices)


def session_start_snapshots() -> dict[str, DatabaseSnapshot]:
    """会话开始前记录的正式库/工作区库快照（供回归测试复核）。"""
    return dict(_START_SNAPSHOTS)


def _take_start_snapshots() -> None:
    """记录所有被保护库的会话前快照（只读）。"""
    for path in guarded_db_paths():
        if path.exists():
            _START_SNAPSHOTS[str(path)] = take_snapshot(path)


def _load_init_test_db_module():  # noqa: ANN202 - 返回脚本模块或 None
    """按文件路径加载 ``scripts/init_test_db.py``（``scripts/`` 不是包）。"""
    script = BACKEND_ROOT / "scripts" / "init_test_db.py"
    if not script.is_file():
        return None
    spec = importlib.util.spec_from_file_location("jellyfish_init_test_db_for_pytest", script)
    if spec is None or spec.loader is None:  # pragma: no cover - 环境异常
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_schema_only(url: str) -> None:
    """兜底建表（拿不到初始化脚本时用它，只建表、不写种子）。"""
    from sqlalchemy.ext.asyncio import create_async_engine

    # 只为副作用导入（注册全部 ORM 模型），因此必须显式忽略 unused-import
    import app.models  # noqa: F401  # pylint: disable=unused-import
    from app.core.db import Base

    async def _run() -> None:
        engine = create_async_engine(url)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        finally:
            await engine.dispose()

    asyncio.run(_run())


def _initialize_temp_database(url: str) -> None:
    """建表 + 写假供应商/模型种子，复用 ``scripts/init_test_db.py`` 的初始化逻辑。"""
    try:
        module = _load_init_test_db_module()
        if module is not None:
            asyncio.run(module.init(url))
            return
    except Exception as exc:  # noqa: BLE001 - 兜底只建表，保证测试仍可跑
        _emit(f"[数据库隔离] 初始化脚本不可用（{exc.__class__.__name__}: {exc}），改为只建表。")
    _create_schema_only(url)


def install_session_database() -> SessionDatabase:
    """安装会话级隔离（幂等）。

    **必须在任何 ``app.*`` 导入之前调用**：``app/core/db.py`` 第 52 行的 engine 是
    模块导入时用 ``settings.database_url`` 建的，晚一步就绑到正式库上了。
    """
    global _SESSION  # noqa: PLW0603 - 会话级单例
    if _SESSION is not None:
        return _SESSION

    if escape_hatch_enabled():
        url = effective_database_url()
        assert_test_database(url)  # 逃生口开着 → 这里直接放行
        _SESSION = SessionDatabase(
            url=url, db_path=None, tmpdir=None, escape_hatch=True, isolation_active=False
        )
        hatched = (
            "\n" + "!" * 72 + f"\n!! {ALLOW_NON_TEST_ENV}=1 已开启：本次测试**没有**数据库隔离！\n"
            f"!! 实际连的是：{url}\n"
            "!! 这一档只用于特殊排查，可能把数据写进非测试库。\n" + "!" * 72
        )
        _notices.append(hatched)
        _emit(hatched)
        _take_start_snapshots()
        return _SESSION

    explicit = str(os.environ.get(DB_URL_ENV) or "").strip()
    if explicit:
        # 进程环境变量里显式给了 DATABASE_URL：只允许是「测试库」，否则直接拒绝。
        assert_test_database(explicit, role="进程环境变量里显式设置的 DATABASE_URL")
        _notices.append(
            f"[数据库隔离] 忽略手动设置的 DATABASE_URL（{explicit}）；"
            "本次测试改用隔离层新建的临时库（保证是全新库）。"
        )

    tmpdir = Path(tempfile.mkdtemp(prefix=SESSION_TMP_PREFIX))
    db_path = tmpdir / SESSION_DB_FILENAME
    url = f"sqlite+aiosqlite:///{db_path}"
    # 会话前快照要在任何测试动作之前取（只读，不碰正式库）。
    _take_start_snapshots()
    # 进程环境变量优先于 .env（app/config.py），这一行就是「显式覆盖正式库 URL」。
    os.environ[DB_URL_ENV] = url
    _initialize_temp_database(url)

    session = SessionDatabase(
        url=url, db_path=db_path, tmpdir=tmpdir, escape_hatch=False, isolation_active=True
    )
    # 自检：本会话最终生效的路径必须通过硬拒绝校验（写错就当场炸，而不是等测试跑完）。
    assert_session_database_target(db_path, tmpdir)
    _SESSION = session

    _notices.append(
        f"[数据库隔离] 本会话测试库：{db_path}\n"
        "[数据库隔离] 已用进程环境变量覆盖 DATABASE_URL（.env 里的正式库 URL 不参与本次测试）\n"
        "[数据库隔离] 被保护的正式库/工作区库："
        f"{'、'.join(str(p) for p in guarded_db_paths())}"
    )
    return session


def assert_engine_is_isolated() -> None:
    """复核「应用实际用的引擎」是不是本会话临时库（最终生效路径的权威校验）。

    在 ``pytest_configure`` 里调用：此时 ``app.core.db`` 已经导入，``engine.url``
    就是应用真正会连的库。只要它不等于本会话临时库，说明隔离被绕过（或隔离安装晚于
    引擎创建）→ 直接拒绝启动整次测试。
    """
    session = _SESSION
    if session is None:
        raise NonTestDatabaseError("数据库隔离层没有安装（tests/conftest.py 顶层未执行）。")
    if session.escape_hatch:
        return

    try:
        from app.core.db import engine
    except Exception as exc:  # noqa: BLE001 - 可选依赖缺失时无法复核引擎
        _emit(f"[数据库隔离] 无法导入 app.core.db 复核引擎（{exc.__class__.__name__}: {exc}）。")
        return

    actual_url = str(engine.url)
    actual = parse_database_url(actual_url)
    if actual.kind != "sqlite_file" or actual.path is None:
        raise NonTestDatabaseError(
            "拒绝启动后端测试：应用实际使用的数据库不是 SQLite 文件测试库。\n"
            f"    引擎 URL：{actual_url}\n{_HOW_TO_RUN}"
        )
    if _real(actual.path) != _real(session.db_path or Path("/nonexistent")):
        raise NonTestDatabaseError(
            "拒绝启动后端测试：应用实际连的库不是本会话的临时测试库（隔离失效）。\n"
            f"    引擎实际连的库：{actual.path}\n"
            f"    本会话临时库  ：{session.db_path}\n"
            f"{_HOW_TO_RUN}"
        )
    if str(os.environ.get(DB_URL_ENV) or "") != session.url:
        raise NonTestDatabaseError(
            "拒绝启动后端测试：进程环境变量 DATABASE_URL 被改动过，隔离不再可信。\n"
            f"    当前值  ：{os.environ.get(DB_URL_ENV)}\n"
            f"    期望值  ：{session.url}\n"
            f"{_HOW_TO_RUN}"
        )


def compare_guarded_databases(
    start_snapshots: dict[str, DatabaseSnapshot] | None = None,
) -> list[str]:
    """把每个被保护库的「会话前快照」与**现在**再比一次，返回发生变化的库路径。

    只读，不改任何全局状态（方便回归测试直接注入自己的快照集合）。
    """
    start = _START_SNAPSHOTS if start_snapshots is None else start_snapshots
    changed: list[str] = []
    for path_text, before in start.items():
        after = take_snapshot(Path(path_text))
        changes = snapshot_changes(before, after)
        _emit(
            f"[数据库防回归] {path_text}｜会话前 {rows_digest(before)}"
            f"｜会话后 {rows_digest(after)}"
        )
        if changes:
            changed.append(path_text)
            _emit(
                "\n" + "=" * 72 + "\n"
                "⚠️  严重告警：测试期间正式库/工作区库发生了变化！\n"
                "    测试用例只允许写临时库；请立刻排查是谁改了下面这个库。\n"
                + "=" * 72 + "\n"
                + format_change_report(path_text, changes)
            )
        for note in snapshot_degradations(before, after):
            _emit(f"[数据库防回归] 提示：{note}")
        if not changes:
            _emit(f"[数据库防回归] ✓ {path_text} 会话前后一致（哈希与业务表行数均未变）。")
    if not start:
        _emit("[数据库防回归] 提示：没有可保护的库文件，本次未做快照比对。")
    return changed


def cleanup_session_database() -> None:
    """删除本会话的临时库目录（测试过程产生的数据只留在系统临时目录里）。"""
    tmpdir = _SESSION.tmpdir if _SESSION else None
    if tmpdir is None:
        return
    shutil.rmtree(tmpdir, ignore_errors=True)
    _emit(f"[数据库隔离] 已清理本会话临时库目录：{tmpdir}")


def finish_session_database(
    session,  # noqa: ANN001 - pytest.Session
    *,
    start_snapshots: dict[str, DatabaseSnapshot] | None = None,
    cleanup: bool = True,
) -> bool:
    """会话结束：对比正式库快照并按需把整次运行置为非零码；清理临时库。

    返回「是否有被保护的库发生了变化」，便于测试直接断言（不改动真实会话时用
    ``cleanup=False``）。
    """
    global _FINISHED  # noqa: PLW0603
    if _FINISHED:
        return False
    _FINISHED = True

    changed = compare_guarded_databases(start_snapshots)

    if changed:
        _emit("⚠️  因为被保护的库快照发生了变化，本次测试运行被置为**失败**（非零退出码）。")
        import pytest

        session.exitstatus = pytest.ExitCode.TESTS_FAILED

    if cleanup and not (_SESSION and _SESSION.escape_hatch):
        cleanup_session_database()
    return bool(changed)


__all__ = [
    "ALLOW_NON_TEST_ENV",
    "DB_URL_ENV",
    "FIXED_GUARDED_PATHS",
    "NonTestDatabaseError",
    "ParsedDatabaseUrl",
    "SessionDatabase",
    "assert_engine_is_isolated",
    "assert_session_database_target",
    "assert_test_database",
    "cleanup_session_database",
    "compare_guarded_databases",
    "current_session_database",
    "dotenv_database_url",
    "effective_database_url",
    "escape_hatch_enabled",
    "finish_session_database",
    "guarded_db_paths",
    "install_session_database",
    "parse_database_candidate",
    "parse_database_url",
    "session_notices",
    "session_start_snapshots",
    "system_temp_roots",
]
