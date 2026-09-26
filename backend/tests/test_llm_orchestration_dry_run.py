"""DRY_RUN 守卫测试：默认开启、显式关闸需二次确认、出站兜底、服务层不触网。"""

from __future__ import annotations

import httpx
import pytest

from app.schemas.studio.llm_orchestration import EntityExtractionPreviewRequest
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.dry_run import (
    CONFIRM_ENV,
    DRY_RUN_ENV,
    DryRunBlocked,
    RealCallNotConfirmed,
    allow_real_llm_call,
    assert_llm_outbound_allowed,
    clear_audit_log,
    dry_run_enabled,
    install_network_guard,
    network_guard_installed,
    real_call_confirmed,
    uninstall_network_guard,
)
from app.services.studio.llm_orchestration.entity_extraction import preview_entity_extraction
from tests.llm_orchestration_fixtures import build_session


@pytest.fixture(autouse=True)
def _restore_guard_state() -> None:
    clear_audit_log()
    yield
    uninstall_network_guard()
    clear_audit_log()


def test_dry_run_is_on_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(DRY_RUN_ENV, raising=False)
    monkeypatch.delenv(CONFIRM_ENV, raising=False)

    assert dry_run_enabled() is True
    assert real_call_confirmed() is False
    assert allow_real_llm_call() is False


def test_unparsable_flag_falls_back_to_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "maybe")
    assert dry_run_enabled() is True


def test_disabling_dry_run_alone_is_not_enough(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)

    assert dry_run_enabled() is False
    assert allow_real_llm_call() is False
    with pytest.raises(RealCallNotConfirmed):
        assert_llm_outbound_allowed("unit-test")


def test_disabling_dry_run_with_confirmation_allows_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    assert allow_real_llm_call() is True
    assert_llm_outbound_allowed("unit-test")  # 不抛异常
    assert any(item["action"] == "allowed_real" for item in dry_run.audit_log())


def test_guard_blocks_and_records(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")

    with pytest.raises(DryRunBlocked):
        assert_llm_outbound_allowed("unit-test")

    assert any(item["action"] == "blocked" for item in dry_run.audit_log())


@pytest.mark.asyncio
async def test_network_guard_blocks_external_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    assert install_network_guard() is True
    assert network_guard_installed() is True

    async with httpx.AsyncClient() as client:
        with pytest.raises(DryRunBlocked):
            await client.get("https://api.deepseek.com/v1/models")

    assert any(item["action"] == "blocked_network" for item in dry_run.audit_log())


@pytest.mark.asyncio
async def test_network_guard_allows_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    install_network_guard()
    try:
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"ok": True}))
        async with httpx.AsyncClient(transport=transport) as client:
            response = await client.get("http://127.0.0.1:4173/health")
        assert response.status_code == 200
    finally:
        uninstall_network_guard()


@pytest.mark.asyncio
async def test_entity_extraction_dry_run_makes_no_http_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """DRY_RUN 开启时：服务返回占位结果，且 httpx 一个请求都没发。"""
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    calls: list[str] = []

    async def _forbidden_post(self, url, *args, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(str(url))
        raise AssertionError("DRY_RUN 下不允许发起真实 HTTP 请求")

    monkeypatch.setattr(httpx.AsyncClient, "post", _forbidden_post, raising=True)

    db, engine = await build_session()
    async with db:
        result = await preview_entity_extraction(
            db,
            body=EntityExtractionPreviewRequest(
                chapter_text="将军府庭院内，姜岁欢握紧拐杖。",
                candidate_names=["姜岁欢", "将军府庭院", "拐杖"],
            ),
        )

    assert calls == []
    assert result.meta.dry_run is True
    assert result.meta.llm_called is False
    assert result.meta.latency_ms is None
    assert result.meta.dry_run_reason
    # 占位结果结构完整、内容明确标注
    assert [item.name for item in result.items] == ["姜岁欢", "将军府庭院", "拐杖"]
    assert all(item.confidence == 0.0 for item in result.items)
    assert any("DRY_RUN" in warning for warning in result.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_entity_extraction_dry_run_does_not_fabricate_without_candidates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")

    db, engine = await build_session()
    async with db:
        result = await preview_entity_extraction(
            db,
            body=EntityExtractionPreviewRequest(chapter_text="将军府庭院内，姜岁欢握紧拐杖。"),
        )

    assert result.items == []
    assert any("不编造任何实体草稿" in warning for warning in result.warnings)
    await engine.dispose()
