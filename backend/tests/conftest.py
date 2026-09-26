"""Pytest 共享 fixture：FastAPI 应用与 TestClient，以及**数据库隔离**。

⚠️ 顺序纪律（不要调整本文件顶部的结构）
--------------------------------------
``app/core/db.py:52`` 的 ``engine = _build_engine()`` 是**模块导入时**用
``settings.database_url`` 建的，而 ``settings``（``app/config.py``）会读
``backend/.env`` —— 本仓库那份 ``.env`` 里的 ``DATABASE_URL`` 指向**正式库**。
因此 ``install_session_database()`` 必须在**任何 ``app.*`` 导入之前**执行：
它就是本文件里第一个可执行语句（见下面第 1 步）。晚一步，engine 就绑到正式库上了。

隔离与防回归的完整口径见 ``tests/_db_isolation.py`` 与 ``tests/_prod_db_snapshot.py``。
"""

from __future__ import annotations

import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 1) 数据库隔离：必须在任何 app.* 导入之前执行（否则 engine 会绑到 .env 里的正式库）
# ---------------------------------------------------------------------------
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import pytest  # noqa: E402

from tests._db_isolation import (  # noqa: E402
    NonTestDatabaseError,
    assert_engine_is_isolated,
    current_session_database,
    finish_session_database,
    install_session_database,
    session_notices,
)

_REFUSE_BANNER = "=" * 72

try:
    SESSION_DATABASE = install_session_database()
except NonTestDatabaseError as _refusal:
    # 拒绝发生在收集/执行之前：一条测试都不跑，也不会去连任何库。
    # 提示：pytest 会把这里显示成「ImportError while loading conftest」，
    # 但那**不是** conftest 写错了，而是隔离层主动拒绝启动（退出码 4）。
    pytest.exit(
        f"\n{_REFUSE_BANNER}\n拒绝启动后端测试（数据库隔离保护）\n{_REFUSE_BANNER}\n"
        f"（这是隔离层的主动拒绝，不是 conftest 导入出错。）\n{_refusal}\n",
        returncode=pytest.ExitCode.USAGE_ERROR,
    )
    raise

import asyncio  # noqa: E402
import inspect  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

try:
    from app.main import app  # type: ignore
except Exception:  # noqa: BLE001
    # 测试环境里有些可选依赖（例如 langgraph）可能未安装。
    # 不要让整个测试套件在导入 conftest 时直接失败；仅在需要 client 的测试里跳过。
    app = None


DRY_RUN_ENV = "JELLYFISH_DRY_RUN"
CONFIRM_ENV = "JELLYFISH_REAL_LLM_CONFIRMED"


class _NoSwitchSettings:
    """``Settings`` 替身：等价于 ``backend/.env`` 里**没写**这两个开关。"""

    jellyfish_dry_run: str | None = None
    jellyfish_real_llm_confirmed: str | None = None


@pytest.fixture(autouse=True)
def _force_dry_run_in_tests(monkeypatch: pytest.MonkeyPatch) -> None:
    """测试环境一律「两处都没写开关」，保证整个测试套件默认是**演练模式**。

    为什么必须有这一条：守卫现在也认 ``backend/.env``（pydantic-settings 读进
    ``Settings``）。如果本机 / CI 缓存里正好有一份打开了真实模式的 ``.env``，
    整套测试就会在**真实模式**下跑——那是会花钱的。这里把两个来源都钉死：

    - 进程环境变量：``delenv``；
    - ``backend/.env``：把守卫读 ``Settings`` 的唯一入口 :func:`dry_run._settings`
      换成「什么都没有」的替身。

    需要测环境变量 / ``.env`` 的用例，在自己用例体内 monkeypatch 覆盖回来即可：
    用例体内的 monkeypatch 在夹具之后生效，优先级更高。
    """
    monkeypatch.delenv(DRY_RUN_ENV, raising=False)
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    try:
        from app.services.studio.llm_orchestration import dry_run
    except Exception:  # noqa: BLE001 - 可选依赖缺失时不影响不需要守卫的用例
        return
    monkeypatch.setattr(dry_run, "_settings", lambda: _NoSwitchSettings())


@pytest.fixture(scope="session")
def session_database():
    """本会话的临时测试库（隔离层在 conftest 顶层就已建好，这里是只读入口）。"""
    return SESSION_DATABASE


@pytest.fixture
def client() -> TestClient:
    """FastAPI 应用 TestClient，用于集成测试。"""
    if app is None:
        pytest.skip("FastAPI app 依赖未满足（例如缺少 langgraph），跳过需要 client 的集成测试。")
    return TestClient(app)


def pytest_configure(config: pytest.Config) -> None:
    """为轻量测试环境补齐 asyncio marker，并复核「应用实际连的库」是否被隔离。"""
    config.addinivalue_line("markers", "asyncio: mark test as asyncio coroutine")
    try:
        assert_engine_is_isolated()
    except NonTestDatabaseError as exc:
        pytest.exit(
            f"\n{_REFUSE_BANNER}\n拒绝启动后端测试（数据库隔离复核失败）\n{_REFUSE_BANNER}\n{exc}\n",
            returncode=pytest.ExitCode.USAGE_ERROR,
        )
    _announce_isolation(config)


def _announce_isolation(config: pytest.Config) -> None:
    """把「本会话用的是哪个库」打到真实终端（走 terminalreporter，绕开输出捕获）。"""
    session = current_session_database()
    if session is None:
        line = "数据库隔离：未安装（异常情况，请检查 tests/conftest.py 顶部）"
    elif session.escape_hatch:
        line = f"数据库隔离：⚠️ 已关闭（逃生口），实际库 = {session.url}"
    else:
        line = f"数据库隔离：本会话临时库 = {session.db_path}"
    reporter = config.pluginmanager.get_plugin("terminalreporter")
    for text in [line, *session_notices()]:
        if reporter is not None:
            reporter.write_line(text, bold=text is line)
        else:  # pragma: no cover - 极少数环境没有 terminal 插件时退化为普通打印
            print(text)



def pytest_report_header(config: pytest.Config) -> list[str]:
    """把本会话实际使用的库打进测试头（跑 ``-q`` 时不会显示，属正常）。"""
    session = current_session_database()
    if session is None:
        return ["数据库隔离：未安装（异常情况，请检查 tests/conftest.py 顶部）"]
    if session.escape_hatch:
        return [f"数据库隔离：⚠️ 已关闭（逃生口），实际库 = {session.url}"]
    return [f"数据库隔离：本会话临时库 = {session.db_path}"]


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """会话结束：比对正式库快照（变了就大声报错 + 非零退出码），并清理临时库。"""
    finish_session_database(session)


@pytest.hookimpl(tryfirst=True)
def pytest_pyfunc_call(pyfuncitem: pytest.Function) -> bool | None:
    """在未安装 pytest-asyncio 的环境中兜底执行 async 测试。"""

    if not inspect.iscoroutinefunction(pyfuncitem.obj):
        return None

    funcargs = {
        arg: pyfuncitem.funcargs[arg]
        for arg in pyfuncitem._fixtureinfo.argnames
        if arg in pyfuncitem.funcargs
    }
    asyncio.run(pyfuncitem.obj(**funcargs))
    return True
