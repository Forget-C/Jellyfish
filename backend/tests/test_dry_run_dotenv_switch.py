"""`backend/.env` 打开/关闭守卫开关的测试（用户拍板：`.env` 必须真的生效）。

覆盖的产品要求：
1. `.env` 里的两个开关**真的生效**（pydantic-settings 读进 ``Settings``），
   且**进程环境变量优先于 `.env`**；
2. 默认仍然是演练：两处都没有 → ``dry_run_enabled() is True``、四个出口 ``allowed=false``；
3. fail-safe 不丢：任何读不到 / 读不懂 / 抛异常 → 当演练处理；
4. `.env` 打开真实模式时后端启动要打**醒目中文 warning**，状态接口与
   ``dry_run.state()`` 也要能看出开关来源（新增 ``source`` 等字段，既有字段只增不删）。

本文件**不做任何真实网络 / 付费调用**：
- `.env` 分支用「临时文件 + ``Settings(_env_file=...)``」或 ``Settings`` 替身注入，
  只读解析结果与只读状态接口；
- 验证启动告警时进入 ``TestClient(app)``（会跑 lifespan），但把 ``init_storage``
  与 ``bootstrap_all_registries`` 换成空实现——真跑 ``init_storage`` 会向对象存储发
  HeadBucket 探测请求（那就是真实出网了，本任务明令禁止）。
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV

STATUS_URL = "/api/v1/studio/llm/orchestration/status"

# 既有字段清单：新增字段是加法，这些一个都不能丢（见任务要求 2）。
LEGACY_STATUS_FIELDS = (
    "guard",
    "guard_status_text",
    "paid_outlet_guards",
    "dry_run_audit",
    "outlet_states",
    "enable_steps",
    "restore_steps",
    "mode",
    "mode_label",
    "mode_description",
    "is_real_mode",
    "restart_required_on_change",
    "how_to_enable",
    "how_to_restore",
    "mode_doc",
)
LEGACY_GUARD_FIELDS = (
    "dry_run",
    "real_call_confirmed",
    "env",
    "confirm_env",
    "network_guard",
    "outlets",
    "blocked_count",
    "mode",
    "mode_label",
    "blocked_reason",
)
NEW_SOURCE_FIELDS = (
    "source",
    "source_label",
    "dry_run_source",
    "real_call_confirmed_source",
    "dotenv_real_mode",
)


@pytest.fixture(autouse=True)
def _clean_audit() -> None:
    """每个用例前后清审计日志，避免相互污染。"""
    dry_run.clear_audit_log()
    yield
    dry_run.clear_audit_log()


class _SettingsStub:
    """``Settings`` 替身：只提供守卫要读的两个属性。"""

    def __init__(self, dry_run_value: str | None, confirm_value: str | None) -> None:
        self.jellyfish_dry_run = dry_run_value
        self.jellyfish_real_llm_confirmed = confirm_value


def _inject_settings(monkeypatch: pytest.MonkeyPatch, settings: object) -> None:
    """把守卫读 ``Settings`` 的入口换成给定对象；并清掉进程环境变量这一侧。"""
    monkeypatch.delenv(DRY_RUN_ENV, raising=False)
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    monkeypatch.setattr(dry_run, "_settings", lambda: settings)


# --------------------------------------------------------------------------
# 1. 真·`.env` 文件：pydantic-settings 读得到，守卫也认
# --------------------------------------------------------------------------


def test_dotenv_file_really_takes_effect(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """临时 `.env` 文件（真 pydantic-settings 解析）两个都设 → 真实模式，来源 dotenv。"""
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"{DRY_RUN_ENV}=0\n{CONFIRM_ENV}=1\n",
        encoding="utf-8",
    )
    parsed = Settings(_env_file=str(env_file))
    assert parsed.jellyfish_dry_run == "0"
    assert parsed.jellyfish_real_llm_confirmed == "1"

    _inject_settings(monkeypatch, parsed)

    assert dry_run.dry_run_enabled() is False
    assert dry_run.real_call_confirmed() is True
    assert dry_run.mode() == dry_run.MODE_REAL
    assert dry_run.source() == dry_run.SOURCE_DOTENV == "dotenv"
    assert dry_run.source_label() == "backend/.env"
    assert dry_run.state()["source"] == "dotenv"
    assert dry_run.is_dotenv_real_mode() is True
    assert all(item["allowed"] is True for item in dry_run.outlet_states())


def test_dotenv_stub_only_sets_one_switch_stays_unconfirmed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`.env` 只写了 ``DRY_RUN=0``、没写确认 → 真实模式（未确认），仍然拦截。"""
    _inject_settings(monkeypatch, _SettingsStub("0", None))

    assert dry_run.mode() == dry_run.MODE_REAL_UNCONFIRMED
    assert dry_run.source() == "dotenv"
    assert dry_run.blocked_reason_code() == "real_call_not_confirmed"
    assert all(item["allowed"] is False for item in dry_run.outlet_states())
    assert dry_run.startup_warning() is None  # 没确认就不是真实模式，不告警


def test_dotenv_dry_run_value_keeps_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env` 里写着 ``DRY_RUN=1`` → 演练模式（不会误开）。"""
    _inject_settings(monkeypatch, _SettingsStub("1", "1"))

    assert dry_run.dry_run_enabled() is True
    assert dry_run.mode() == dry_run.MODE_DRY_RUN
    assert dry_run.source() == "dotenv"
    assert all(item["allowed"] is False for item in dry_run.outlet_states())


def test_dotenv_unparsable_value_is_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env` 里写了读不懂的 ``maybe`` → 当演练处理（fail-safe）。"""
    _inject_settings(monkeypatch, _SettingsStub("maybe", "1"))

    assert dry_run.flag_text(DRY_RUN_ENV) == ""
    assert dry_run.dry_run_enabled() is True
    assert dry_run.mode() == dry_run.MODE_DRY_RUN
    assert all(item["allowed"] is False for item in dry_run.outlet_states())


def test_defaults_stay_dry_run_without_dotenv(monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env` 与进程环境变量都没有 → 默认演练、来源 default。"""
    _inject_settings(monkeypatch, _SettingsStub(None, None))

    assert dry_run.dry_run_enabled() is True
    assert dry_run.real_call_confirmed() is False
    assert dry_run.source() == "default"
    assert dry_run.state()["source"] == "default"
    assert all(item["allowed"] is False for item in dry_run.outlet_states())
    assert all(item["reason"] == "dry_run" for item in dry_run.outlet_states())


# --------------------------------------------------------------------------
# 2. 优先级：进程环境变量 > backend/.env（两个方向都测）
# --------------------------------------------------------------------------


def test_env_overrides_dotenv_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env` 说演练（1），环境变量说真实（0）→ 以环境变量为准：真实模式，来源 env。"""
    _inject_settings(monkeypatch, _SettingsStub("1", "0"))
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    assert dry_run.mode() == dry_run.MODE_REAL
    assert dry_run.source() == "env"
    assert dry_run.flag_raw(DRY_RUN_ENV) == "0"
    assert dry_run.is_dotenv_real_mode() is False
    assert all(item["allowed"] is True for item in dry_run.outlet_states())


def test_env_overrides_dotenv_real(monkeypatch: pytest.MonkeyPatch) -> None:
    """反向：`.env` 说真实（0/1），环境变量说演练（1）→ 以环境变量为准：演练模式。"""
    _inject_settings(monkeypatch, _SettingsStub("0", "1"))
    monkeypatch.setenv(DRY_RUN_ENV, "1")

    assert dry_run.dry_run_enabled() is True
    assert dry_run.mode() == dry_run.MODE_DRY_RUN
    assert dry_run.source() == "env"
    assert dry_run.flag_raw(DRY_RUN_ENV) == "1"
    assert dry_run.is_dotenv_real_mode() is False
    assert dry_run.startup_warning() is None
    assert all(item["allowed"] is False for item in dry_run.outlet_states())


def test_env_unparsable_still_wins_over_dotenv(monkeypatch: pytest.MonkeyPatch) -> None:
    """环境变量存在就算它优先；值读不懂 → 归一化成「未设置」→ 演练（而不是回退 .env）。"""
    _inject_settings(monkeypatch, _SettingsStub("0", "1"))
    monkeypatch.setenv(DRY_RUN_ENV, "maybe")

    assert dry_run.flag_source(DRY_RUN_ENV) == "env"
    assert dry_run.dry_run_enabled() is True
    assert dry_run.mode() == dry_run.MODE_DRY_RUN


# --------------------------------------------------------------------------
# 3. `.env` 打开的启动告警 + 状态字段
# --------------------------------------------------------------------------


def test_startup_warning_names_dotenv_and_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env` 打开真实模式 → 醒目中文告警，且点名是哪两个键、怎么关回去。"""
    _inject_settings(monkeypatch, _SettingsStub("0", "1"))

    warning = dry_run.startup_warning()

    assert warning is not None
    assert "检测到由 backend/.env 打开的真实付费模式" in warning
    assert f"{DRY_RUN_ENV}=0" in warning
    assert f"{CONFIRM_ENV}=1" in warning
    assert "真实计费" in warning
    assert "CI/测试环境请用演练模式" in warning
    assert f"export {DRY_RUN_ENV}=1" in warning
    assert dry_run.dotenv_keys() == [DRY_RUN_ENV, CONFIRM_ENV]
    assert dry_run.mode_details()["startup_warning"] == warning


def test_env_open_real_mode_has_no_dotenv_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    """环境变量打开真实模式 → 不打 .env 告警（那是显式 export，不需要提醒）。"""
    _inject_settings(monkeypatch, _SettingsStub(None, None))
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    assert dry_run.mode() == dry_run.MODE_REAL
    assert dry_run.startup_warning() is None
    assert dry_run.mode_details()["dotenv_real_mode"] is False


def test_lifespan_logs_dotenv_warning_without_touching_network(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """后端启动（lifespan）真的会把告警打到日志里；存储初始化被替换，绝不真实出网。"""
    from app import main as main_module

    _inject_settings(monkeypatch, _SettingsStub("0", "1"))
    # 真跑 init_storage 会向对象存储发 HeadBucket 探测（真实出网），这里换成空实现。
    monkeypatch.setattr(main_module, "init_storage", lambda: None)
    monkeypatch.setattr(main_module, "bootstrap_all_registries", lambda: None)

    with caplog.at_level(logging.WARNING, logger="app.main"):
        with TestClient(main_module.app):
            pass

    messages = [record.getMessage() for record in caplog.records]
    assert any("检测到由 backend/.env 打开的真实付费模式" in text for text in messages)


def test_lifespan_stays_quiet_in_dry_run(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """默认演练时启动**不**打这条告警（避免噪声）。"""
    from app import main as main_module

    _inject_settings(monkeypatch, _SettingsStub(None, None))
    monkeypatch.setattr(main_module, "init_storage", lambda: None)
    monkeypatch.setattr(main_module, "bootstrap_all_registries", lambda: None)

    with caplog.at_level(logging.WARNING, logger="app.main"):
        with TestClient(main_module.app):
            pass

    messages = [record.getMessage() for record in caplog.records]
    assert not any("真实付费模式" in text for text in messages)


def test_status_route_exposes_source_and_keeps_legacy_fields(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`.env` 打开真实模式时状态接口：新增来源字段都在，既有字段一个都没丢。"""
    _inject_settings(monkeypatch, _SettingsStub("0", "1"))

    data = client.get(STATUS_URL).json()["data"]

    # 既有字段（老前端在用）
    for key in LEGACY_STATUS_FIELDS:
        assert key in data, key
    for key in LEGACY_GUARD_FIELDS:
        assert key in data["guard"], key
    assert data["guard"]["dry_run"] is False
    assert data["guard"]["real_call_confirmed"] is True
    assert data["guard_status_text"]
    assert data["outlet_states"] and [item["outlet"] for item in data["outlet_states"]] == [
        "llm",
        "image",
        "video",
        "oss",
    ]
    assert data["enable_steps"] and data["paid_outlet_guards"]["task_kinds"]

    # 新增字段：开关来源 + .env 告警（顶层 + guard + real_run_mode 三处口径一致）
    for key in ("switch_source", "switch_source_label", "dotenv_real_mode", "startup_warning"):
        assert key in data, key
    assert data["switch_source"] == "dotenv"
    assert data["switch_source_label"] == "backend/.env"
    assert data["dotenv_real_mode"] is True
    assert "检测到由 backend/.env 打开的真实付费模式" in data["startup_warning"]
    for key in NEW_SOURCE_FIELDS:
        assert key in data["guard"], f"guard.{key}"
        assert key in data["real_run_mode"], f"real_run_mode.{key}"
    assert data["guard"]["source"] == "dotenv"
    assert data["guard"]["dotenv_real_mode"] is True
    assert data["real_run_mode"]["source"] == "dotenv"
    assert data["mode"] == "real"


def test_status_route_default_source_is_default(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """两处都没写时状态接口报 default，且四个出口全部不放行。"""
    _inject_settings(monkeypatch, _SettingsStub(None, None))

    data = client.get(STATUS_URL).json()["data"]

    assert data["switch_source"] == "default"
    assert data["switch_source_label"] == "默认值（两处都没设置）"
    assert data["dotenv_real_mode"] is False
    assert data["startup_warning"] is None
    assert data["mode"] == "dry_run"
    assert all(item["allowed"] is False for item in data["outlet_states"])
    assert all(item["reason"] == "dry_run" for item in data["outlet_states"])
    for key in NEW_SOURCE_FIELDS:
        assert key in data["guard"], key
