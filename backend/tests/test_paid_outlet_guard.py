"""付费出口守卫（legacy 路径 + 新链路统一闸门）测试。

覆盖三件事：
1. 出口映射与状态判定；
2. legacy 出口在 DRY_RUN 下确实被拦（返回 409，且不产生任务行 / 不构造大模型）；
3. 任务执行入口的兜底：被拦任务直接标记 failed，不会真花钱。
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_db
from app.main import app
from app.services import paid_outlet_guard as guard
from app.services.studio.llm_orchestration import dry_run


@pytest.fixture(autouse=True)
def _clean_guard_state():
    """每个用例前后都回到「默认 DRY_RUN」，避免相互污染。"""
    dry_run.clear_audit_log()
    yield
    dry_run.clear_audit_log()


def _override_db():
    class _FakeDB:
        async def commit(self) -> None:
            return None

        def add(self, _obj: object) -> None:  # pragma: no cover - 被拦时走不到
            return None

    async def _get_db() -> AsyncGenerator[None, None]:
        yield _FakeDB()

    return _get_db


# --------------------------------------------------------------------------
# 出口映射
# --------------------------------------------------------------------------


def test_task_kind_mapping_covers_paid_outlets_only() -> None:
    assert guard.outlet_for_task_kind("image_generation") == guard.OUTLET_IMAGE
    assert guard.outlet_for_task_kind("video_generation") == guard.OUTLET_VIDEO
    # 不需要外部付费的任务类型一律不拦（否则会把整套流程堵死）
    for kind in ("script_divide", "script_extract", "shot_frame_prompt", "", None):
        assert guard.outlet_for_task_kind(kind) is None


def test_require_outlet_blocks_by_default_and_records_audit() -> None:
    assert dry_run.dry_run_enabled() is True  # 默认即安全

    with pytest.raises(Exception) as caught:
        guard.require_outlet("测试出口", outlet=guard.OUTLET_IMAGE)

    assert getattr(caught.value, "status_code", None) == guard.BLOCKED_STATUS_CODE
    assert "[DRY_RUN]" in str(caught.value.detail)
    actions = [item["action"] for item in dry_run.audit_log()]
    assert "blocked" in actions


def test_require_outlet_passes_when_explicitly_confirmed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.setenv(dry_run.CONFIRM_ENV, "1")

    guard.require_outlet("测试出口", outlet=guard.OUTLET_VIDEO)  # 不抛即通过

    assert [item["action"] for item in dry_run.audit_log()] == ["allowed_real"]


def test_require_outlet_requires_confirmation_even_when_dry_run_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.delenv(dry_run.CONFIRM_ENV, raising=False)

    with pytest.raises(Exception) as caught:
        guard.require_outlet("测试出口", outlet=guard.OUTLET_LLM)

    assert getattr(caught.value, "status_code", None) == guard.BLOCKED_STATUS_CODE
    assert "缺少用户确认" in str(caught.value.detail)


# --------------------------------------------------------------------------
# legacy 出口：HTTP 层面确实被拦
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/v1/script-processing/divide", {"script_text": "第一场：夜，外景。"}),
        ("/api/v1/script-processing/extract", {"shots": []}),
        ("/api/v1/script-processing/optimize-script", {"script_text": "第一场。"}),
        ("/api/v1/script-processing/simplify-script", {"script_text": "第一场。"}),
    ],
)
def test_legacy_script_processing_llm_endpoints_are_guarded(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    payload: dict,
) -> None:
    """legacy 同步接口会真实调用大模型，必须在 DRY_RUN 下被拦（此前完全没有闸门）。"""
    built: list[str] = []

    # 真调用的唯一路径是构造 ChatOpenAI；这里打桩记录，证明「连构造都没发生」。
    async def _explode(*_args: object, **_kwargs: object) -> object:
        built.append("built")
        raise AssertionError("被守卫拦截时不应构造大模型")

    monkeypatch.setattr("app.services.llm.resolver.build_default_text_llm", _explode)
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(path, json=payload)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == guard.BLOCKED_STATUS_CODE
    assert built == []


def test_script_processing_router_guards_every_route() -> None:
    """router 级守卫必须覆盖整个文件，而不是只挂一两条路由。"""
    from app.api.v1.routes import script_processing as module

    assert module.router.dependencies, "script-processing router 必须挂守卫"
    guarded = 0
    for route in module.router.routes:
        for dependency in route.dependencies:
            if dependency.dependency is guard.require_llm_outlet:
                guarded += 1
    assert guarded == len(module.router.routes) > 0


def test_legacy_video_task_route_is_guarded(client: TestClient) -> None:
    app.dependency_overrides[get_db] = _override_db()
    try:
        response = client.post(
            "/api/v1/film/tasks/video",
            json={
                "shot_id": "shot-1",
                "reference_mode": "first",
                "prompt": "一段视频提示词",
                "images": [],
                "ratio": "9:16",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == guard.BLOCKED_STATUS_CODE
    assert "[DRY_RUN]" in response.json()["message"]
    assert "已拦截「出视频」出口" in response.json()["message"]


@pytest.mark.asyncio
async def test_studio_image_task_creation_is_guarded() -> None:
    """studio 出图建任务入口在写任何任务行之前就被拦。"""
    from app.services.studio.image_task_runner import create_image_task_and_link

    with pytest.raises(Exception) as caught:
        await create_image_task_and_link(
            db=None,  # type: ignore[arg-type]  # 被拦时不会碰 DB
            model_id=None,
            relation_type="character",
            relation_entity_id="char-1",
            prompt="一段图片提示词",
        )

    assert getattr(caught.value, "status_code", None) == guard.BLOCKED_STATUS_CODE
    assert "已拦截「出图」出口" in str(caught.value.detail)


@pytest.mark.asyncio
async def test_worker_llm_construction_is_guarded() -> None:
    """worker 侧构造大模型同样过闸门（异步任务回放也不放过）。"""
    from app.services.llm.runtime import build_default_text_llm_sync

    with pytest.raises(Exception) as caught:
        build_default_text_llm_sync(None, thinking=False)  # type: ignore[arg-type]

    assert getattr(caught.value, "status_code", None) == guard.BLOCKED_STATUS_CODE
    assert "已拦截「大模型」出口" in str(caught.value.detail)


# --------------------------------------------------------------------------
# 任务执行入口兜底
# --------------------------------------------------------------------------


def _temp_task_db(monkeypatch: pytest.MonkeyPatch):
    """造一个临时 sqlite + 同步会话工厂，替换掉 execute_task 用的真实库。"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, sessionmaker

    import app.models.llm  # noqa: F401  # 注册元数据
    import app.models.studio  # noqa: F401
    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401
    import app.tasks.execute_task as execute_task  # noqa: PLC0415
    from app.core.db import Base

    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, class_=Session, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(execute_task, "sync_session_maker", maker)
    return execute_task, maker


def test_run_task_celery_backstop_marks_blocked_task_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    """执行入口兜底：绕过接口层建出来的出视频任务，也不能真花钱。"""
    from app.models.task import GenerationTask
    from app.services.worker.task_registry import task_executor_registry

    execute_task, maker = _temp_task_db(monkeypatch)

    with maker() as db:
        db.add(
            GenerationTask(
                id="task-guard-1",
                mode="async_polling",
                task_kind="video_generation",
                status="pending",
                progress=0,
                payload={},
                error="",
            )
        )
        db.commit()

    ran: list[str] = []

    class _SpyExecutor:
        def run(self, task_id: str) -> None:  # pragma: no cover - 不应被调用
            ran.append(task_id)

    monkeypatch.setattr(task_executor_registry, "resolve", lambda _kind: _SpyExecutor())

    execute_task.run_task_celery("task-guard-1")

    with maker() as db:
        row = db.get(GenerationTask, "task-guard-1")
        assert row is not None
        assert row.status == "failed"
        assert "[DRY_RUN]" in (row.error or "")

    assert ran == [], "被守卫拦截的任务不应进入执行器"


def test_run_task_celery_backstop_lets_unpaid_task_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """对照组：不产生外部费用的任务类型照常执行（守卫不能把流程堵死）。"""
    from app.models.task import GenerationTask
    from app.services.worker.task_registry import task_executor_registry

    execute_task, maker = _temp_task_db(monkeypatch)

    with maker() as db:
        db.add(
            GenerationTask(
                id="task-plain-1",
                mode="async_polling",
                task_kind="script_divide",
                status="pending",
                progress=0,
                payload={},
                error="",
            )
        )
        db.commit()

    ran: list[str] = []

    class _SpyExecutor:
        def run(self, task_id: str) -> None:
            ran.append(task_id)

    monkeypatch.setattr(task_executor_registry, "resolve", lambda _kind: _SpyExecutor())

    execute_task.run_task_celery("task-plain-1")

    assert ran == ["task-plain-1"]


def test_task_kind_block_reason_allows_non_paid_kinds() -> None:
    assert guard.task_kind_block_reason("script_divide") is None


def test_blocked_envelope_shape() -> None:
    exc = dry_run.DryRunBlocked("测试", outlet=dry_run.OUTLET_IMAGE)
    payload = guard.blocked_payload(exc)
    assert payload["code"] == guard.BLOCKED_ERROR_CODE
    assert payload["outlet"] == dry_run.OUTLET_IMAGE
    assert payload["outlet_label"] == "出图"
    assert payload["guard"]["dry_run"] is True
    assert "api_key" not in str(payload)


# --------------------------------------------------------------------------
# 出口白名单（JELLYFISH_ALLOWED_OUTLETS）：按出口授权，而不是只有"整体开关"
# --------------------------------------------------------------------------


def test_allowed_outlets_defaults_to_no_extra_restriction() -> None:
    """未设置白名单 → 行为与加这个功能之前完全一致（真实模式下四个出口都放行）。"""
    assert dry_run.allowed_outlets() is None
    assert dry_run.outlet_allowed(dry_run.OUTLET_LLM) is False  # 演练模式下仍然全禁


def test_allowed_outlets_restricts_image_video_oss_but_keeps_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``=llm``：文本模型放行，出图 / 出视频 / 上传三个出口**在代码层面**被拦。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.setenv(dry_run.CONFIRM_ENV, "1")
    monkeypatch.setenv(dry_run.ALLOWED_OUTLETS_ENV, "llm")

    assert dry_run.is_real_mode() is True
    assert dry_run.allowed_outlets() == ("llm",)
    states = {item["outlet"]: item for item in dry_run.outlet_states()}
    assert states[dry_run.OUTLET_LLM]["allowed"] is True
    for outlet in (dry_run.OUTLET_IMAGE, dry_run.OUTLET_VIDEO, dry_run.OUTLET_OSS):
        assert states[outlet]["allowed"] is False
        assert states[outlet]["reason"] == dry_run.BLOCKED_REASON_OUTLET_NOT_ALLOWED
        assert "白名单" in states[outlet]["reason_text"]

    # 真发起时抛的是"出口不在白名单"，不是"演练模式"
    with pytest.raises(dry_run.OutletNotAllowed) as caught:
        dry_run.assert_outbound_allowed("上传验收图", outlet=dry_run.OUTLET_OSS)
    assert caught.value.reason_code == dry_run.BLOCKED_REASON_OUTLET_NOT_ALLOWED
    assert caught.value.outlet == dry_run.OUTLET_OSS
    payload = guard.blocked_payload(caught.value)
    assert payload["reason"] == dry_run.BLOCKED_REASON_OUTLET_NOT_ALLOWED
    assert payload["paid_call_made"] is False
    assert payload["reason_text"] and "白名单" in payload["reason_text"]
    # 文本模型出口仍然畅通（真实模式 + 在白名单里）
    dry_run.assert_outbound_allowed("整章剧本分析", outlet=dry_run.OUTLET_LLM)


def test_allowed_outlets_explicit_none_blocks_every_outlet(monkeypatch: pytest.MonkeyPatch) -> None:
    """显式写 ``none`` = 四个出口全禁（"临时全停"用；空值等同未设置，与守卫其余口径一致）。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.setenv(dry_run.CONFIRM_ENV, "1")
    monkeypatch.setenv(dry_run.ALLOWED_OUTLETS_ENV, "none")

    assert dry_run.allowed_outlets() == ()
    for outlet in dry_run.OUTLETS:
        assert dry_run.outlet_allowed(outlet) is False

    # 空值 = 未设置（fail-safe，不会误放开，也不会误全禁）
    monkeypatch.setenv(dry_run.ALLOWED_OUTLETS_ENV, "")
    assert dry_run.allowed_outlets() is None


def test_allowed_outlets_accepts_chinese_comma_and_spaces(monkeypatch: pytest.MonkeyPatch) -> None:
    """白名单写法容错：中文逗号、空格、大小写都不影响判定（读不懂则按未设置处理）。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.setenv(dry_run.CONFIRM_ENV, "1")
    monkeypatch.setenv(dry_run.ALLOWED_OUTLETS_ENV, " LLM，image ")

    assert dry_run.allowed_outlets() == ("llm", "image")
    assert dry_run.outlet_allowed("IMAGE") is True
    assert dry_run.outlet_allowed(dry_run.OUTLET_VIDEO) is False


def test_mode_details_reports_allowed_outlets(monkeypatch: pytest.MonkeyPatch) -> None:
    """/orchestration/status 必须能如实回报"按出口授权"的状态（验收时靠它取证）。"""
    monkeypatch.setenv(dry_run.ALLOWED_OUTLETS_ENV, "llm")
    details = dry_run.mode_details()
    assert details["allowed_outlets"] == ["llm"]
    assert details["allowed_outlets_env"] == dry_run.ALLOWED_OUTLETS_ENV
    assert details["allowed_outlets_source"] == dry_run.SOURCE_ENV
    assert [item["outlet"] for item in details["outlets"]] == list(dry_run.OUTLETS)


def test_outlet_not_allowed_is_still_caught_as_blocked_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """新异常必须落在既有"被拦异常"判定里，否则既有路由会把它当 500。"""
    monkeypatch.setenv(dry_run.DRY_RUN_ENV, "0")
    monkeypatch.setenv(dry_run.CONFIRM_ENV, "1")
    monkeypatch.setenv(dry_run.ALLOWED_OUTLETS_ENV, "llm")
    exc = dry_run.OutletNotAllowed("上传", outlet=dry_run.OUTLET_OSS)
    assert guard.is_blocked_exception(exc) is True
    assert isinstance(exc, dry_run.RealCallNotConfirmed)
