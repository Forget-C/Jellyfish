"""用户可见的 8 个生成入口 —— **独立审计**测试（只读断言 + stub，零真实出网）。

本文件是「入口审计」任务的产物，不改任何 app 代码、不改既有测试。它锁住的是
**接口契约层**的事实（既有测试更多锁服务层事实），防止后续改动把这些事实悄悄改掉：

1. 被守卫拦下的入口，返回体必须同时给全：
   机器可读 ``code`` / ``reason`` + 中文 ``message`` / ``reason_text`` /
   ``hint`` / ``how_to_enable`` / ``enable_steps``，且 ``data`` 必须为 ``null``；
2. ``dry_run``（演练模式）与 ``real_call_not_confirmed``（真实模式已开但没确认）
   必须是**两个不同的 reason**，不能混成一条；
3. 付费出口名与 ``GenerationTask.task_kind`` 的映射（``image_generation`` → image、
   ``video_generation`` → video）必须稳定；
4. DRY_RUN 占位产物必须带**不可达域名 / [DRY_RUN] 前缀**这类一眼可辨的标记，
   不允许出现「看起来像真结果的占位」；
5. 参考图预检的负例（本机相对路径）必须在**任何出站之前**判死并抛 409，
   且明确告知 ``paid_call_made=false``；
6. legacy ``POST /api/v1/film/tasks/video`` 的真实分支会**走到 Celery 队列**
   （``enqueue_task_execution``）—— 本机没有 worker，这是「事后必然永久 pending」的风险点，
   用被 patch 掉的 enqueue 记录器把它钉成可回归的事实。

**零出网保证**：所有外部依赖（文本大模型、APIMart、OSS、Celery broker）都在用例里
被替换成 stub / MockTransport / 记录器；DRY_RUN 默认开启（见 tests/conftest.py）。
"""

from __future__ import annotations

import inspect
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.services import paid_outlet_guard as guard
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV

LEGACY_VIDEO_URL = "/api/v1/film/tasks/video"
LEGACY_LLM_URL = "/api/v1/script-processing/divide"
SHOT_FRAME_PROMPTS_URL = "/api/v1/film/tasks/shot-frame-prompts"
STATUS_URL = "/api/v1/studio/llm/orchestration/status"

_SHOT_ID = "audit-shot-1"

#: 这些中文说明字段必须在拦截体里非空（否则页面说不出「为什么被拦 + 怎么开」）。
_REQUIRED_TEXT_FIELDS = ("message", "reason_text", "outlet_label", "hint", "how_to_enable")


class _NoSwitchSettings:
    """``Settings`` 替身：等价于 ``backend/.env`` 里没写这两个开关。"""

    jellyfish_dry_run: str | None = None
    jellyfish_real_llm_confirmed: str | None = None


@pytest.fixture(autouse=True)
def _isolate_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """每个用例前后都回到「两处都没写开关」的默认演练态，并清审计日志。"""
    monkeypatch.delenv(DRY_RUN_ENV, raising=False)
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    monkeypatch.setattr(dry_run, "_settings", _NoSwitchSettings)
    dry_run.clear_audit_log()
    yield
    dry_run.clear_audit_log()


def _seed_audit_shot() -> None:
    """在当前测试库里种一个审计用镜头（只写测试库；文件库不存在则跳过）。

    ``mark_shot_generating`` 找不到镜头会抛 ``ValueError``，所以真实分支用例
    需要一个真实存在的镜头行。这里只写**测试库**（``DATABASE_URL`` 指向的临时库），
    绝不碰验收库 ``/tmp/jellyfish_accept/accept.db``。
    """
    import sqlite3
    from pathlib import Path

    from app.config import settings

    url = str(settings.database_url or "")
    marker = "sqlite+aiosqlite:///"
    if not url.startswith(marker):  # pragma: no cover - 只在非 sqlite 环境跳过
        pytest.skip("审计用例需要 sqlite 测试库")
    path = Path(url[len(marker) :])
    if not path.is_file() or ":memory:" in str(path):  # pragma: no cover
        pytest.skip("审计用例需要一个已初始化的临时测试库（见 scripts/init_test_db.py）")

    conn = sqlite3.connect(path)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, description, style, visual_style, seed, unify_style,"
            " progress, start_mode, stats) VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("audit-project", "审计项目", "", "真人古装", "现实", 1, 0, 0, "script", "{}"),
        )
        conn.execute(
            "INSERT OR IGNORE INTO chapters (id, project_id, \"index\", title, summary, raw_text, condensed_text,"
            " storyboard_count, status) VALUES (?,?,?,?,?,?,?,?,?)",
            ("audit-chapter", "audit-project", 1, "审计章节", "", "审计剧本正文。", "审计剧本正文。", 0, "draft"),
        )
        conn.execute(
            "INSERT OR IGNORE INTO shots (id, chapter_id, \"index\", title, thumbnail, status, skip_extraction,"
            " script_excerpt) VALUES (?,?,?,?,?,?,?,?)",
            (_SHOT_ID, "audit-chapter", 1, "审计镜头", "", "draft", 0, "审计镜头剧本摘录。"),
        )
        conn.commit()
    finally:
        conn.close()


def _seed_audit_character() -> str:
    """在当前测试库里种一个审计用角色（只写测试库）。

    为什么需要：出图提交路由**只有真的有可提交资产**时才会走到付费出口守卫；
    没有资产时它会正常返回 200（"没有可提交的资产"），根本碰不到拦截逻辑。
    """
    import sqlite3
    from pathlib import Path as _Path

    from app.config import settings

    url = str(settings.database_url or "")
    marker = "sqlite+aiosqlite:///"
    if not url.startswith(marker):  # pragma: no cover - 只在非 sqlite 环境跳过
        pytest.skip("审计用例需要 sqlite 测试库")
    path = _Path(url[len(marker) :])
    if not path.is_file() or ":memory:" in str(path):  # pragma: no cover
        pytest.skip("审计用例需要一个已初始化的临时测试库（见 scripts/init_test_db.py）")

    character_id = "audit-character"
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO characters (id, project_id, name, description, image_prompts, style,"
            " visual_style) VALUES (?,?,?,?,?,?,?)",
            (character_id, "audit-project", "审计角色", "", "{}", "真人古装", "现实"),
        )
        conn.commit()
    finally:
        conn.close()
    return character_id


def _force_real_mode(monkeypatch: pytest.MonkeyPatch, *, confirm: bool) -> None:
    """打开真实模式开关；``confirm=False`` 时缺付费确认（另一条拦截原因）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    if confirm:
        monkeypatch.setenv(CONFIRM_ENV, "1")
    else:
        monkeypatch.delenv(CONFIRM_ENV, raising=False)
    monkeypatch.setattr(dry_run, "_settings", _NoSwitchSettings)


def _blocked_error(body: dict[str, Any]) -> dict[str, Any]:
    """从统一信封里取出 ``meta.error``（拦截明细）。"""
    meta = body.get("meta") or {}
    error = meta.get("error")
    assert isinstance(error, dict), f"拦截体缺少 meta.error：{body}"
    return error


# ---------------------------------------------------------------------------
# 1. 演练模式：被守卫拦下的入口必须给全中文原因与开启方式
# ---------------------------------------------------------------------------


def test_legacy_video_entrypoint_blocked_envelope_is_complete(client: TestClient) -> None:
    """``POST /api/v1/film/tasks/video`` 在演练模式下 409，且说明齐全、不建任务行。"""
    resp = client.post(LEGACY_VIDEO_URL, json={"shot_id": _SHOT_ID, "reference_mode": "first", "ratio": "16:9"})
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == 409
    assert body["data"] is None, "被守卫拦下时不允许返回任何 data"

    error = _blocked_error(body)
    assert error["code"] == guard.BLOCKED_ERROR_CODE
    assert error["reason"] == dry_run.BLOCKED_REASON_DRY_RUN
    assert error["outlet"] == guard.OUTLET_VIDEO
    assert error["mode"] == dry_run.MODE_DRY_RUN
    for field in _REQUIRED_TEXT_FIELDS:
        assert str(error.get(field) or "").strip(), f"拦截体缺少中文说明字段 {field}"
    assert isinstance(error.get("enable_steps"), list) and error["enable_steps"], "缺少分步开启说明"
    assert DRY_RUN_ENV in error["how_to_enable"] and CONFIRM_ENV in error["how_to_enable"]


def test_legacy_llm_router_blocked_envelope_is_complete(client: TestClient) -> None:
    """``/api/v1/script-processing/*`` 是 router 级守卫：409 且 outlet=llm。"""
    resp = client.post(LEGACY_LLM_URL, json={"chapter_id": "whatever"})
    assert resp.status_code == 409, resp.text
    error = _blocked_error(resp.json())
    assert error["reason"] == dry_run.BLOCKED_REASON_DRY_RUN
    assert error["outlet"] == guard.OUTLET_LLM
    for field in _REQUIRED_TEXT_FIELDS:
        assert str(error.get(field) or "").strip(), f"拦截体缺少中文说明字段 {field}"


def test_blocked_reason_distinguishes_unconfirmed_from_dry_run(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实模式已开但缺确认 → 必须是 ``real_call_not_confirmed``，不是 ``dry_run``。"""
    _force_real_mode(monkeypatch, confirm=False)
    resp = client.post(LEGACY_VIDEO_URL, json={"shot_id": _SHOT_ID, "reference_mode": "first", "ratio": "16:9"})
    assert resp.status_code == 409, resp.text
    error = _blocked_error(resp.json())
    assert error["reason"] == dry_run.BLOCKED_REASON_NOT_CONFIRMED
    assert CONFIRM_ENV in str(error["message"]), "缺确认时必须在文案里点名要设置哪个变量"
    assert error["mode"] == dry_run.MODE_REAL_UNCONFIRMED
    assert resp.json()["data"] is None


def test_status_endpoint_reports_mode_and_switch_source(client: TestClient) -> None:
    """状态接口必须如实回显模式与「开关写在哪」，且给中文开启步骤。"""
    resp = client.get(STATUS_URL)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["mode"] == dry_run.MODE_DRY_RUN
    assert data["is_real_mode"] is False
    assert data["switch_source"] in {dry_run.SOURCE_ENV, dry_run.SOURCE_DOTENV, dry_run.SOURCE_DEFAULT}
    assert data["enable_steps"] and data["restore_steps"] and data["how_to_enable"]
    assert {item["outlet"] for item in data["outlet_states"]} == set(dry_run.OUTLETS)
    assert all(item["allowed"] is False for item in data["outlet_states"]), "演练模式下四个出口都不许放行"


# ---------------------------------------------------------------------------
# 2. 出口映射：页面调的端点 / 任务类型到底对应哪个付费出口
# ---------------------------------------------------------------------------


def test_paid_task_kind_outlet_mapping_is_stable() -> None:
    """``GenerationTask.task_kind`` → 付费出口的映射（任务执行层兜底靠它）。"""
    assert guard.outlet_for_task_kind("image_generation") == guard.OUTLET_IMAGE
    assert guard.outlet_for_task_kind("video_generation") == guard.OUTLET_VIDEO
    # 不产生外部费用的任务类型不能被误判成付费出口
    assert guard.outlet_for_task_kind("shot_frame_prompt") is None
    assert guard.outlet_for_task_kind("") is None


def test_legacy_video_route_carries_the_video_outlet_dependency() -> None:
    """legacy 视频路由必须挂着视频出口守卫依赖（依赖式，任何方法都先过闸）。"""
    source = inspect.getsource(
        __import__("app.api.v1.routes.film.generated_video", fromlist=["x"])
    )
    assert "create_video_generation_task" in source
    # 路由装饰器上必须出现 require_video_outlet -- 这是真实模式下唯一放行入口
    decorator_region = source.split("async def create_video_generation_task", 1)[0].rsplit("@router.post", 1)[-1]
    assert "require_video_outlet" in decorator_region, "legacy 视频路由丢了视频出口守卫依赖"


def test_dry_run_placeholders_are_visibly_fake() -> None:
    """DRY_RUN 占位产物必须一眼可辨：不可达域名 + 明显前缀，不许伪装成真地址。"""
    image_url = dry_run.fake_image_url("asset-1", 2)
    oss_url = dry_run.fake_oss_url("outputs/a/b.png")
    task_id = dry_run.fake_task_id("image", "asset-1")
    for url in (image_url, oss_url):
        assert ".invalid" in url, f"占位地址必须用不可达域名，实际：{url}"
    assert image_url.startswith("https://dry-run.invalid/")
    assert task_id.startswith("dryrun_")


# ---------------------------------------------------------------------------
# 3. 真实模式的付费出口判定（只判守卫，不发请求）
# ---------------------------------------------------------------------------


def test_real_mode_allows_outlet_only_with_both_switches(monkeypatch: pytest.MonkeyPatch) -> None:
    """真实模式必须两个开关同时满足才放行；放行时 outlet 名与调用方声明一致。"""
    _force_real_mode(monkeypatch, confirm=True)
    assert dry_run.is_real_mode() is True
    # 放行 = 不抛异常；这里只是判定层，不会发出任何请求
    dry_run.assert_outbound_allowed("审计：只判定不发请求", outlet=dry_run.OUTLET_VIDEO)
    dry_run.assert_outbound_allowed("审计：只判定不发请求", outlet=dry_run.OUTLET_LLM)
    dry_run.assert_outbound_allowed("审计：只判定不发请求", outlet=dry_run.OUTLET_IMAGE)
    assert dry_run.allow_real_call() is True


# ---------------------------------------------------------------------------
# 4. 参考图预检负例：本机相对路径 → 409，且一个字节都不出站
# ---------------------------------------------------------------------------


def _forbidden_transport() -> httpx.MockTransport:
    """任何出站都立刻失败 —— 用来证明「预检负例根本没发请求」。"""

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 触发即失败
        raise AssertionError(f"预检负例不应该发出任何请求：{request.method} {request.url}")

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_local_relative_path_reference_is_rejected_without_any_request() -> None:
    """本机相对路径参考图：形态级判死 → 409 + ``paid_call_made=false`` + 零出站。"""
    with pytest.raises(reference_preflight.ReferencePreflightBlocked) as excinfo:
        await reference_preflight.preflight_or_raise(
            [
                reference_preflight.ReferenceCandidate(
                    label="角色「审计角色」的定版图",
                    url="outputs/assets/characters/local_only.png",
                    role="first",
                )
            ],
            transport=_forbidden_transport(),
        )
    exc = excinfo.value
    assert exc.status_code == reference_preflight.BLOCKED_STATUS_CODE == 409
    detail = exc.detail
    assert detail["code"] == reference_preflight.UNREACHABLE_ERROR_CODE
    assert detail["paid_call_made"] is False, "必须明确告诉用户「没有产生任何付费调用」"
    assert detail["unreachable_count"] == 1
    assert "没有提交生成请求" in detail["message"]
    # 文案必须带可读名，不能泄露内部标识 / 本机绝对路径
    item = detail["unreachable"][0]
    assert item["asset"] == "角色「审计角色」的定版图"
    assert item["kind"] == reference_preflight.KIND_LOCAL_PATH
    assert item["url"] == "", "本地路径不允许出现在给用户看的地址字段里"
    assert item["how_to_fix"] and item["how_to_fix_code"] == "not_public"


@pytest.mark.asyncio
async def test_loopback_reference_is_rejected_without_any_request() -> None:
    """指向 127.0.0.1 的参考图同样在形态阶段判死（上游一定取不到）。"""
    with pytest.raises(reference_preflight.ReferencePreflightBlocked) as excinfo:
        await reference_preflight.preflight_or_raise(
            [
                reference_preflight.ReferenceCandidate(
                    label="镜头的首帧参考图",
                    url="http://127.0.0.1:8000/files/local.png",
                    role="first",
                )
            ],
            transport=_forbidden_transport(),
        )
    item = excinfo.value.detail["unreachable"][0]
    assert item["kind"] == reference_preflight.KIND_LOOPBACK
    assert item["how_to_fix_code"] == "loopback"


@pytest.mark.asyncio
async def test_dry_run_upload_reachability_check_never_probes() -> None:
    """演练模式下的「上传后可达性验证」必须如实报「未验证」，而不是「不可达」。"""
    outcome = await reference_preflight.verify_uploaded_url_reachable(
        "https://example.invalid/whatever.png",
        label="审计素材.png",
    )
    assert outcome.reachable is None, "未验证 ≠ 不可达"
    assert outcome.skipped is True
    assert "DRY_RUN" in str(outcome.probe.get("reason") or "")
    assert outcome.warnings == []


# ---------------------------------------------------------------------------
# 5. legacy 视频真实分支会进 Celery 队列（本机无 worker → 必然永久 pending）
# ---------------------------------------------------------------------------


def test_legacy_video_real_branch_dispatches_inline_not_to_celery(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实模式下 legacy 视频端点改成**同进程内联执行**，不再无条件进 Celery 队列。

    背景（审计结论，2026-09-21 修）：这条路径以前在建任务并 commit 之后**无条件**
    ``enqueue_task_execution``；本机既没有 broker 也没有 worker，于是真实模式下要么
    因 `.delay()` 连不上 redis 而 500（还留一条悬挂的 pending 行），要么永久 pending。
    现在与「AI 首帧提示词」那条一致：优先内联，只有拿不到运行中的事件循环才退回队列。
    """
    from app.api.v1.routes.film import generated_video as route

    enqueued: list[str] = []
    spawned: list[str] = []

    async def _fake_build_run_args(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        # 故意不带 input 段：跳过供应商入参预检与参考图探活（本用例只关心派发路径）
        return {"provider": "apimart", "input": None, "model": "seedance-2.0-mini"}

    def _fake_enqueue(task_id: str) -> None:
        enqueued.append(task_id)

    def _fake_spawn(task_id: str, **_kwargs: Any) -> bool:
        spawned.append(task_id)
        return True  # 有运行中的事件循环 → 内联执行

    monkeypatch.setattr(route, "build_run_args", _fake_build_run_args)
    monkeypatch.setattr(route, "enqueue_task_execution", _fake_enqueue)
    monkeypatch.setattr(route, "spawn_inline_task_execution", _fake_spawn)
    _force_real_mode(monkeypatch, confirm=True)
    _seed_audit_shot()

    resp = client.post(LEGACY_VIDEO_URL, json={"shot_id": _SHOT_ID, "reference_mode": "text_only", "ratio": "16:9"})
    assert resp.status_code == 201, resp.text
    task_id = resp.json()["data"]["task_id"]
    assert spawned == [task_id], "真实分支必须优先内联派发"
    assert enqueued == [], "有事件循环时不允许再无条件入队（本机没有 worker）"


def test_legacy_video_falls_back_to_celery_without_event_loop(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """拿不到运行中的事件循环（同步脚本调用）时才退回队列 —— 行为保持可预期。"""
    from app.api.v1.routes.film import generated_video as route

    enqueued: list[str] = []

    async def _fake_build_run_args(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"provider": "apimart", "input": None, "model": "seedance-2.0-mini"}

    def _fake_enqueue(task_id: str) -> None:
        enqueued.append(task_id)

    monkeypatch.setattr(route, "build_run_args", _fake_build_run_args)
    monkeypatch.setattr(route, "enqueue_task_execution", _fake_enqueue)
    monkeypatch.setattr(route, "spawn_inline_task_execution", lambda *_a, **_k: False)
    _force_real_mode(monkeypatch, confirm=True)
    _seed_audit_shot()

    resp = client.post(LEGACY_VIDEO_URL, json={"shot_id": _SHOT_ID, "reference_mode": "text_only", "ratio": "16:9"})
    assert resp.status_code == 201, resp.text
    assert enqueued == [resp.json()["data"]["task_id"]]



def test_shot_frame_prompts_route_prefers_in_process_inline_execution() -> None:
    """``/film/tasks/shot-frame-prompts`` 必须优先同进程内联；队列只是无事件循环时的退路。"""
    source = inspect.getsource(__import__("app.api.v1.routes.film.tasks_images", fromlist=["x"]))
    assert "spawn_inline_task_execution" in source, "「AI 首帧」必须走同进程内联，不能再依赖不存在的 worker"
    inline_at = source.index("spawn_inline_task_execution")
    enqueue_at = source.index("enqueue_task_execution(task_record.id)")
    assert inline_at < enqueue_at, "内联调度必须排在队列退路之前"
    assert "if not scheduled:" in source, "只有在拿不到运行中的事件循环时才允许退回队列"


# ---------------------------------------------------------------------------
# 6. 【审计发现的缺口】real_unconfirmed 下 studio LLM 编排路径仍会真实出网
#
# 这三条用例把审计结论钉成可回归的事实。它们**不产生任何真实请求**：
# 出站用 ``httpx.MockTransport`` 截住，只断言"到底有没有走到出站这一步"。
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_outlet_refuses_outbound_under_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """基准：演练模式下 ``call_text_llm`` 必须在构造请求前被守卫拦下（零出站）。"""
    from app.services.studio.llm_orchestration import client as llm_client

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 触发即失败
        calls.append(str(request.url))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    monkeypatch.delenv(DRY_RUN_ENV, raising=False)
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    with pytest.raises(dry_run.DryRunBlocked):
        await llm_client.call_text_llm(
            "审计：不应该出站",
            target=llm_client.TextLLMTarget(
                provider_id="audit-provider",
                provider_name="audit",
                model_id="audit-model-id",
                model_name="audit-model",
                base_url="https://audit.example.invalid/v1",
                api_key="audit-key",
                timeout_seconds=1,
            ),
            transport=httpx.MockTransport(handler),
        )
    assert calls == [], "演练模式下不允许出现任何出站"


@pytest.mark.asyncio
async def test_llm_outlet_refuses_outbound_when_mode_is_real_unconfirmed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``real_unconfirmed``（DRY_RUN=0 且未确认）下 LLM 出口必须被拦，零出站。

    这是审计查出并已在 2026-09-21 修掉的真花钱缺口：``client.py`` 里那句守卫以前包在
    ``if dry_run_enabled():`` 里，于是「关演练但没确认」这条路把**付费确认检查整段跳过**，
    请求会真的发出去 —— 与状态接口/文档承诺的「未确认仍然不发真实请求」相矛盾。
    本用例是它的回归锁：只要再被短路，这里就会因为真的出站而失败。
    """
    from app.services.studio.llm_orchestration import client as llm_client

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 触发即失败
        calls.append(str(request.url))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    _force_real_mode(monkeypatch, confirm=False)  # DRY_RUN=0，但 CONFIRM 未设置
    assert dry_run.dry_run_enabled() is False
    assert dry_run.real_call_confirmed() is False
    assert dry_run.mode() == dry_run.MODE_REAL_UNCONFIRMED

    with pytest.raises(dry_run.RealCallNotConfirmed):
        await llm_client.call_text_llm(
            "审计：未确认模式不应该出站",
            target=llm_client.TextLLMTarget(
                provider_id="audit-provider",
                provider_name="audit",
                model_id="audit-model-id",
                model_name="audit-model",
                base_url="https://audit.example.invalid/v1",
                api_key="audit-key",
                timeout_seconds=1,
            ),
            transport=httpx.MockTransport(handler),
        )
    assert calls == [], "未确认的真实模式不允许出现任何出站"


def test_image_and_video_outlets_are_asserted_unconditionally() -> None:
    """对照组：image / video 出口的断言是**无条件**的（所以 real_unconfirmed 会拦住）。

    这解释了为什么同一个缺口只出现在 studio LLM 编排链路：出图与出视频的适配层
    直接调 ``assert_outbound_allowed``，没有 ``if dry_run_enabled()`` 这层短路。
    """
    apimart = inspect.getsource(__import__("app.core.integrations.apimart.images", fromlist=["x"]))
    video_submit = inspect.getsource(
        __import__("app.services.studio.image_pipeline.video_submit", fromlist=["x"])
    )
    frame_submit = inspect.getsource(
        __import__("app.services.studio.image_pipeline.frame_submit", fromlist=["x"])
    )
    external = inspect.getsource(
        __import__("app.services.studio.image_pipeline.external_image_client", fromlist=["x"])
    )
    for name, source in (
        ("apimart/images.py", apimart),
        ("video_submit.py", video_submit),
        ("frame_submit.py", frame_submit),
        ("external_image_client.py", external),
    ):
        assert "assert_outbound_allowed" in source, f"{name} 丢了付费出口断言"


def test_submit_route_catches_unconfirmed_rejection_as_structured_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``/studio/image-pipeline/submit`` 必须把「真实模式未确认」转成结构化 409（**回归锁**）。

    历史：路由的 ``except`` 列表里没有 ``RealCallNotConfirmed``，未确认模式会穿透成
    500「Internal server error」，结构化 409 与中文 ``how_to_enable`` 全丢。
    这条用例原先就是**复现该缺口**的（断言源码里"没有"这个 except）；缺口已在
    2026-09 修掉（路由显式接住并转 409），所以现在反过来锁住"必须接住"：
    谁把 ``except`` 去掉，这里就会因为拿到 500 而失败。

    只走**判定层**：守卫在发请求之前就抛异常，所以一个字节都不出站、零付费。
    """
    source = inspect.getsource(
        __import__("app.api.v1.routes.studio.image_pipeline", fromlist=["x"])
    )
    submit_body = source.split("async def submit_image_plan")[1].split("@router.")[0]
    assert "except dry_run.DryRunBlocked" in submit_body, "submit 至少要接住演练模式的拦截"
    assert "RealCallNotConfirmed" in submit_body, (
        "回归：submit 没接 RealCallNotConfirmed，未确认模式又会变成 500 而不是结构化 409"
    )

    _seed_audit_shot()
    character_id = _seed_audit_character()
    _force_real_mode(monkeypatch, confirm=False)  # DRY_RUN=0 且未确认 → 必须拦
    assert dry_run.mode() == dry_run.MODE_REAL_UNCONFIRMED

    response = client.post(
        "/api/v1/studio/image-pipeline/submit",
        json={
            "project_id": "audit-project",
            "asset_type": "character",
            "asset_ids": [character_id],
            "stage": "character_sheet",
        },
    )
    assert response.status_code == 409, f"未确认模式必须结构化 409，实际 {response.status_code}：{response.text[:200]}"
    error = _blocked_error(response.json())
    assert error["code"] == guard.BLOCKED_ERROR_CODE
    assert error["reason"] == dry_run.BLOCKED_REASON_NOT_CONFIRMED
    assert error["paid_call_made"] is False, "被拦 = 没有发起任何真实请求"
    assert error["how_to_enable"], "必须给中文「怎么才允许真实调用」"
    assert response.json()["data"] is None

