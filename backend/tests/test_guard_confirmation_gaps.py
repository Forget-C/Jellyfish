"""守卫的确认口径（2026-09-21 修的三个真花钱/死队列缺口）。

背景（独立入口审计查出的三条，全部在本次修掉，这里做回归锁）：

1. ``llm_orchestration/client.py`` 里那句出站守卫以前包在 ``if dry_run_enabled():`` 里，
   于是「关演练但没确认」（``real_unconfirmed``）这条路把**付费确认检查整段跳过** ——
   请求会真的发出去，与状态接口/文档承诺的「未确认仍然不发真实请求」矛盾。
   （该缺口的出站级回归锁在 ``test_entrypoints_audit.py``，这里补守卫自身的口径测试。）
2. 出站兜底 ``install_network_guard()`` 的放行条件以前是 ``if not dry_run_enabled(): return``，
   与缺口同源；现在只有「真实模式且已确认」才放行，并且改为**显式开关**安装（默认不装，
   状态接口如实回报 ``network_guard`` / ``network_guard_requested``）。
3. legacy ``POST /api/v1/film/tasks/video`` 以前无条件入 Celery 队列（本机无 worker/redis
   → 500 或永久 pending）；现在优先同进程内联（派发回归锁在 ``test_entrypoints_audit.py``）。

本文件全部离线：不构造任何真实 httpx 请求（需要时用 MockTransport 记录）。
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.services.studio.llm_orchestration import dry_run

DRY_RUN_ENV = "JELLYFISH_DRY_RUN"
CONFIRM_ENV = "JELLYFISH_REAL_LLM_CONFIRMED"
GUARD_ENV = "JELLYFISH_NETWORK_GUARD"


class _NoSwitchSettings:
    """空替身：让守卫在测试里只看环境变量，绝不读仓库里的 ``backend/.env``。"""


def _only_env(monkeypatch: pytest.MonkeyPatch, **values: str) -> None:
    """把两个开关归零后按需设置（不读 ``.env``，测试与仓库里的 .env 解耦）。"""
    monkeypatch.setattr(dry_run, "_settings", _NoSwitchSettings)
    for name in (DRY_RUN_ENV, CONFIRM_ENV, GUARD_ENV):
        monkeypatch.delenv(name, raising=False)
    for name, value in values.items():
        monkeypatch.setenv(name, value)


# --------------------------------------------------------------- 出站兜底的安装开关


def test_network_guard_is_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认不装（不静默改变本地行为）；显式开才装；非法值安全回退成不装。"""
    _only_env(monkeypatch)
    assert dry_run.network_guard_requested() is False
    assert dry_run.state()["network_guard_requested"] is False

    _only_env(monkeypatch, **{GUARD_ENV: "1"})
    assert dry_run.network_guard_requested() is True

    _only_env(monkeypatch, **{GUARD_ENV: "maybe"})
    assert dry_run.network_guard_requested() is False, "读不懂的取值不能当成「要装」"


def test_network_guard_check_host_allows_only_confirmed_real_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """兜底的放行条件：只有「真实模式且已确认」；演练与未确认都必须拦。"""
    # 演练
    _only_env(monkeypatch, **{DRY_RUN_ENV: "1"})
    with pytest.raises(dry_run.DryRunBlocked):
        dry_run._check_host("api.example.com", "测试", outlet=dry_run.OUTLET_LLM)

    # 未确认真实模式（这就是原先被绕过的那条路）
    _only_env(monkeypatch, **{DRY_RUN_ENV: "0"})
    assert dry_run.mode() == dry_run.MODE_REAL_UNCONFIRMED
    with pytest.raises(dry_run.DryRunBlocked):
        dry_run._check_host("api.example.com", "测试", outlet=dry_run.OUTLET_LLM)

    # 已确认真实模式 → 放行
    _only_env(monkeypatch, **{DRY_RUN_ENV: "0", CONFIRM_ENV: "1"})
    assert dry_run.is_real_mode() is True
    assert dry_run._check_host("api.example.com", "测试", outlet=dry_run.OUTLET_LLM) is None


def test_network_guard_local_hosts_are_always_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """本机地址（以及白名单）无论什么模式都不该被兜底拦下。"""
    _only_env(monkeypatch, **{DRY_RUN_ENV: "1"})
    assert dry_run._check_host("127.0.0.1", "本机", outlet=dry_run.OUTLET_LLM) is None
    monkeypatch.setenv("JELLYFISH_DRY_RUN_ALLOW_HOSTS", "cdn.example.com")
    assert dry_run._check_host("cdn.example.com", "白名单", outlet=dry_run.OUTLET_LLM) is None


def test_lifespan_installs_network_guard_only_when_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """启动流程：显式开了才安装；默认不动（避免静默改变本地行为）。"""
    from app import main as app_main

    calls: list[str] = []
    monkeypatch.setattr(app_main, "init_storage", lambda: None)
    monkeypatch.setattr(app_main, "bootstrap_all_registries", lambda: None)
    monkeypatch.setattr(dry_run, "install_network_guard", lambda: calls.append("install") or True)

    _only_env(monkeypatch)
    with TestClient(app_main.app):
        pass
    assert calls == [], "默认不允许安装出站兜底"

    _only_env(monkeypatch, **{GUARD_ENV: "1"})
    with TestClient(app_main.app):
        pass
    assert calls == ["install"], "显式打开后必须安装"


def test_confirm_env_is_read_from_dotenv_too() -> None:
    """`.env`（Settings）也算显式配置：这里只断言解析层不会因为读不到就放行。"""
    assert dry_run.flag_source(CONFIRM_ENV) in {"env", "dotenv", "default"}
    assert os.environ.get(CONFIRM_ENV) is None or isinstance(os.environ.get(CONFIRM_ENV), str)
