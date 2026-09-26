"""legacy 出视频入口 ``POST /api/v1/film/tasks/video`` 的**提交前可达性预检**（故障 A）。

真实故障 A（验收第 6 项）：上游 APIMart 建了视频任务后立刻 failed，错误原文
「无法获取输入媒体 URL（404/410）」—— 传给上游的首帧参考图地址只在本机可读，
匿名访问公网 404，上游抓不到图。

直提出视频端点（``/studio/image-pipeline/video-submit``）在提交前已经逐张探活参考图，
但 **legacy 入口没有**：它只有形态级校验（``validate_legacy_video_input`` /
``_assert_frames_vendor_acceptable``，只判断"这个地址形状能不能给上游"），
于是本机相对路径 / 内网地址 / 404 的对象照样被当成可用参考图发出去。

本文件锁住 legacy 入口现在的口径：

1. 预检发生在**建任务 / 写 generation_tasks 之前**，用的是**同一套**实现
   （``video_submit.video_media_candidates`` + ``reference_preflight.preflight_or_raise``，
   由 ``video_submit.preflight_video_input_media`` 这个共用入口串起来）；
2. 不可达 → 409 + 结构化中文错误（``meta.error``：哪张图 / 真实状态码 / 怎么修 /
   ``paid_call_made: false``），**不建任务、不写库、不给上游出网**；
3. DRY_RUN 下**一次都不探活**（任何出网即 AssertionError），行为与改动前一致；
4. 可达时行为不变（照旧 201 + 建任务）；
5. 用户可见文案里不出现 ``file_id`` / 本机绝对路径 / 凭证。

全部不联网：探活一律注入 ``httpx.MockTransport``；上游调用不涉及（任务只创建、不执行，
``enqueue_task_execution`` 被打桩）。
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from app.api.v1.routes.film import generated_video as route
from app.api.v1.routes.film.video_request import VideoGenerationTaskRequest
from app.core.task_manager import SqlAlchemyTaskStore
from app.models.task import GenerationTask
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV
from tests.llm_orchestration_fixtures import build_session

FRAME_URL = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/test_scene.png"
LOCAL_RELATIVE = "jellyfish/acceptance/files/test_scene.png"
PRIVATE_URL = "http://192.168.1.10:8000/static/frames/first.png"
AUDIO_URL = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/voice.mp3"

#: 真实实现（注入 stub 时用它，避免在自己的 stub 里再查到 stub 造成递归）
_REAL_PROBE = reference_preflight.probe_reference_url

#: 凭证 / 内部标识样本：它们出现在 run_args 里（会真的发给上游），但**绝不允许**出现在响应里
SECRET_FILE_ID = "file-secret-deadbeef1234"
SECRET_API_KEY = "sk-legacy-secret-should-never-leak"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认演练模式（与项目默认口径一致）；要跑真实分支的用例自己改成 0 + 1。"""
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)


class _SpyStore(SqlAlchemyTaskStore):
    """真实写库实现 + 调用计数（用来证明"写库层没被调用"）。"""

    calls: list[dict[str, Any]] = []

    async def create(self, payload: dict[str, Any], mode: Any, task_kind: str) -> Any:  # type: ignore[override]
        type(self).calls.append({"mode": mode, "task_kind": task_kind})
        return await super().create(payload, mode, task_kind)


def _run_args(
    *,
    frame: str | None = FRAME_URL,
    audio: list[str] | None = None,
    provider: str = "apimart",
    file_id: str = SECRET_FILE_ID,
) -> dict[str, Any]:
    """legacy 路径真实的 run_args 形状（frame 字段是历史命名，值可能是公网地址或 data URL）。"""
    payload: dict[str, Any] = {
        "prompt": "主角转身看向门口",
        "model": "seedance-2.0-mini",
        "ratio": "16:9",
        "seconds": 5,
    }
    if frame is not None:
        payload["first_frame_base64"] = frame
    if audio is not None:
        payload["audio_urls"] = audio
    return {
        "shot_id": "shot-1",
        "provider": provider,
        "api_key": SECRET_API_KEY,
        "base_url": "https://api.apimart.test",
        "images": [file_id],
        "input": payload,
    }


def _patch_route(
    monkeypatch: pytest.MonkeyPatch,
    run_args: dict[str, Any],
    *,
    probe: Any | None = None,
    with_audio: bool = False,
) -> dict[str, list[Any]]:
    """按既有方式打桩路由依赖；返回调用记录（派发 / 状态标记）。"""
    seen: dict[str, list[Any]] = {"enqueued": [], "spawned": [], "marked": [], "probed": []}

    async def _build_run_args(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return run_args

    async def _mark_shot_generating(_db: Any, *, shot_id: str) -> None:
        seen["marked"].append(shot_id)

    def _enqueue(task_id: str) -> Any:
        # 任务只创建、不派发（本文件不执行任何出视频链路，更不会真实调用上游）
        seen["enqueued"].append(task_id)
        raise AssertionError("预检未通过时不得派发任务；可达时也只记录不派发")

    async def _attach(_db: Any, *, shot_id: str, input_payload: dict[str, Any], provider: str, model: str | None) -> list[str]:
        if with_audio:
            input_payload["audio_urls"] = [AUDIO_URL]
        return []

    monkeypatch.setattr(route, "build_run_args", _build_run_args)
    monkeypatch.setattr(route, "mark_shot_generating", _mark_shot_generating)
    monkeypatch.setattr(route, "attach_shot_audio_to_video_input", _attach)
    monkeypatch.setattr(route, "SqlAlchemyTaskStore", _SpyStore)
    if probe is not None:
        monkeypatch.setattr(reference_preflight, "probe_reference_url", probe)
    return seen


def _probe_with(status: int, *, seen_requests: list[str] | None = None) -> Any:
    """把探活接到 MockTransport 上（不联网），并把真实请求 URL 记下来。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if seen_requests is not None:
            seen_requests.append(str(request.url))
        return httpx.Response(status)

    async def _probe(url: str, *, label: str = "", role: str = "", **_kwargs: Any) -> Any:
        return await _REAL_PROBE(url, label=label, role=role, transport=httpx.MockTransport(handler))

    return _probe


def _probe_never_called(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover - 触发即失败
    """连探活入口都不允许被调用（用于"没有媒体可探"与 DRY_RUN 两种情形）。"""
    raise AssertionError("不应该调用探活入口")


def _probe_that_must_not_send_any_request() -> Any:
    """允许"按形态判死"（那是本地判断），但**任何真实 HTTP 出网**都直接失败。"""

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 触发即失败
        raise AssertionError(f"不应该有任何出网探测：{request.url}")

    async def _probe(url: str, *, label: str = "", role: str = "", **_kwargs: Any) -> Any:
        return await _REAL_PROBE(url, label=label, role=role, transport=httpx.MockTransport(handler))

    return _probe


async def _count_tasks(db: Any) -> int:
    return int((await db.execute(select(func.count()).select_from(GenerationTask))).scalar() or 0)


async def _call(db: Any, *, reference_mode: str = "first") -> Any:
    return await route.create_video_generation_task(
        body=VideoGenerationTaskRequest(
            shot_id="shot-1",
            reference_mode=reference_mode,
            prompt="主角转身看向门口",
            images=[],
            ratio="16:9",
        ),
        db=db,
    )


async def _error_body(response: Any) -> dict[str, Any]:
    assert isinstance(response, JSONResponse), f"期望结构化 JSON 响应，实际是 {type(response)}"
    import json

    return json.loads(response.body.decode("utf-8"))


# ---------------------------------------------------------------------------
# 1) 不可达 → 409 + 结构化中文错误 + 不建任务 / 不写库 / 不出网
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_spy() -> None:
    _SpyStore.calls = []


@pytest.mark.asyncio
async def test_local_relative_path_is_rejected_before_task_creation(monkeypatch: pytest.MonkeyPatch) -> None:
    """本机相对路径：形态级判定就拦下（一个探测请求都不发）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    requests: list[str] = []
    seen = _patch_route(
        monkeypatch,
        _run_args(frame=LOCAL_RELATIVE),
        probe=_probe_with(200, seen_requests=requests),
    )

    db, engine = await build_session()
    async with db:
        response = await _call(db)
        rows = await _count_tasks(db)

    body = await _error_body(response)
    error = body["meta"]["error"]
    assert response.status_code == 409
    assert body["code"] == 409
    assert error["code"] == reference_preflight.UNREACHABLE_ERROR_CODE
    assert error["paid_call_made"] is False
    assert error["unreachable"][0]["kind"] == reference_preflight.KIND_LOCAL_PATH
    assert error["unreachable"][0]["asset"] == "首帧参考图"
    assert "重新上传" in error["unreachable"][0]["how_to_fix"]
    # 不建任务 / 不写库 / 不派发
    assert rows == 0, "被拒绝时 generation_tasks 不允许新增任何行"
    assert _SpyStore.calls == [], "被拒绝时不允许调用写库层"
    assert seen["enqueued"] == [] and seen["marked"] == []
    # 形态不对的地址连探活请求都不该发
    assert requests == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_public_object_returning_404_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """公网地址但对象 404：这是故障 A 里上游看到的那张图，必须提前拦下并带上真实状态码。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    seen = _patch_route(monkeypatch, _run_args(frame=FRAME_URL), probe=_probe_with(404))

    db, engine = await build_session()
    async with db:
        response = await _call(db)
        rows = await _count_tasks(db)

    body = await _error_body(response)
    error = body["meta"]["error"]
    assert response.status_code == 409
    assert error["code"] == reference_preflight.UNREACHABLE_ERROR_CODE
    assert error["paid_call_made"] is False
    assert error["unreachable"][0]["http_status"] == 404
    assert error["unreachable"][0]["result"] == "unreachable"
    assert "404" in error["unreachable"][0]["reason"]
    assert error["checked_count"] == 1
    assert error["unreachable_count"] == 1
    assert rows == 0
    assert _SpyStore.calls == []
    assert seen["enqueued"] == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_private_and_loopback_url_is_rejected_without_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """内网地址：别人的服务器一定取不到，不发探测请求直接判死。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    requests: list[str] = []
    _patch_route(monkeypatch, _run_args(frame=PRIVATE_URL), probe=_probe_with(200, seen_requests=requests))

    db, engine = await build_session()
    async with db:
        response = await _call(db)
        rows = await _count_tasks(db)

    body = await _error_body(response)
    error = body["meta"]["error"]
    assert response.status_code == 409
    assert error["unreachable"][0]["kind"] == reference_preflight.KIND_LOOPBACK
    assert "192.168.1.10" in error["unreachable"][0]["reason"]
    assert requests == []
    assert rows == 0
    assert _SpyStore.calls == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_unreachable_reference_audio_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """参考音频也是"输入媒体 URL"：上游取不到同样会让任务 failed，必须一起探活。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    _patch_route(
        monkeypatch,
        _run_args(frame=FRAME_URL, audio=[AUDIO_URL]),
        probe=_probe_with(403),
        with_audio=True,
    )

    db, engine = await build_session()
    async with db:
        response = await _call(db)
        rows = await _count_tasks(db)

    body = await _error_body(response)
    error = body["meta"]["error"]
    assert response.status_code == 409
    assert error["unreachable_count"] == 2
    labels = {item["asset"] for item in error["unreachable"]}
    assert labels == {"首帧参考图", "参考音频 1"}
    assert rows == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_error_text_has_no_file_id_no_absolute_path_no_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    """用户可见文案只带可读名：不带 file_id、不带本机绝对路径、不带凭证。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    _patch_route(monkeypatch, _run_args(frame=LOCAL_RELATIVE), probe=_probe_that_must_not_send_any_request())

    db, engine = await build_session()
    async with db:
        response = await _call(db)

    body = await _error_body(response)
    text = str(body)
    assert SECRET_FILE_ID not in text, "响应里不允许出现 file_id"
    assert SECRET_API_KEY not in text, "响应里不允许出现凭证"
    assert "/Users/" not in text, "响应里不允许出现本机绝对路径"
    assert LOCAL_RELATIVE not in text, "本机相对路径不外泄（只给可读名与修法）"
    assert "file_id" not in text
    # 但必须把"是哪张图 / 为什么 / 怎么修"说清楚
    assert "首帧参考图" in text
    assert "没有提交" in body["message"]
    assert "付费调用" in body["message"]
    await engine.dispose()


# ---------------------------------------------------------------------------
# 2) 可达 → 行为不变（照旧建任务）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reachable_reference_still_creates_the_task(monkeypatch: pytest.MonkeyPatch) -> None:
    """全部可达时照旧建任务（预检不改变正常行为）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    seen = _patch_route(monkeypatch, _run_args(frame=FRAME_URL), probe=_probe_with(200))

    def _enqueue_only(task_id: str) -> Any:
        seen["enqueued"].append(task_id)
        return object()

    def _inline_spawn(task_id: str, **_kwargs: Any) -> bool:
        seen["spawned"].append(task_id)
        return True  # 有运行中的事件循环 → 同进程内联执行（2026-09-21 起的默认派发）

    monkeypatch.setattr(route, "enqueue_task_execution", _enqueue_only)
    monkeypatch.setattr(route, "spawn_inline_task_execution", _inline_spawn)

    db, engine = await build_session()
    async with db:
        response = await _call(db)
        rows = await _count_tasks(db)

    assert response.code == 201
    assert response.data is not None and response.data.task_id
    assert rows == 1, "可达时必须照旧建 1 条 generation_tasks"
    assert len(_SpyStore.calls) == 1
    # 派发口径：优先同进程内联（本机没有 worker）；只有拿不到事件循环才退回队列
    assert seen["spawned"] == [response.data.task_id]
    assert seen["enqueued"] == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_text_only_without_media_skips_probe_and_creates_task(monkeypatch: pytest.MonkeyPatch) -> None:
    """没有任何要发的媒体时不探活（没有参考图就没有可达性问题）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    seen = _patch_route(monkeypatch, _run_args(frame=None), probe=_probe_never_called)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda task_id: seen["enqueued"].append(task_id))

    db, engine = await build_session()
    async with db:
        response = await _call(db, reference_mode="text_only")
        rows = await _count_tasks(db)

    assert response.code == 201
    assert rows == 1
    assert seen["probed"] == []
    await engine.dispose()


# ---------------------------------------------------------------------------
# 3) DRY_RUN：一次都不探活（任何出网即失败）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dry_run_never_probes(monkeypatch: pytest.MonkeyPatch) -> None:
    """演练模式不触网：即使参考图是本机相对路径，也不探活（口径与 dry_run 守卫一致）。"""
    probed: list[Any] = []

    async def _boom(*args: Any, **kwargs: Any) -> Any:  # pragma: no cover - 触发即失败
        probed.append((args, kwargs))
        raise AssertionError("DRY_RUN 下不允许任何探活 / 出网")

    seen = _patch_route(monkeypatch, _run_args(frame=LOCAL_RELATIVE), probe=_boom)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda task_id: seen["enqueued"].append(task_id))

    db, engine = await build_session()
    async with db:
        response = await _call(db)
        rows = await _count_tasks(db)

    assert probed == [], "DRY_RUN 下不应做任何可达性探活"
    # 行为与改动前一致：守卫（require_video_outlet）在 HTTP 依赖层负责拦下真实付费出口；
    # 这里直接调路由函数，DRY_RUN 不改建任务的行为，只是不探活。
    assert response.code == 201
    assert rows == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_dry_run_never_probes_even_for_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _boom(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover - 触发即失败
        raise AssertionError("DRY_RUN 下不允许任何探活 / 出网")

    seen = _patch_route(monkeypatch, _run_args(frame=FRAME_URL, audio=[AUDIO_URL]), probe=_boom, with_audio=True)
    monkeypatch.setattr(route, "enqueue_task_execution", lambda task_id: seen["enqueued"].append(task_id))

    db, engine = await build_session()
    async with db:
        response = await _call(db)

    assert response.code == 201
    await engine.dispose()


# ---------------------------------------------------------------------------
# 4) 复用而不是复制：legacy 与直提出视频走的是同一个共用入口
# ---------------------------------------------------------------------------


def test_candidates_come_from_the_shared_extractor() -> None:
    """候选抽取与直提出视频是**同一份**：首/尾/关键帧 + 参考音频，空值忽略。"""
    from app.services.studio.image_pipeline.video_submit import video_media_candidates

    candidates = video_media_candidates(
        {
            "first_frame_base64": FRAME_URL,
            "last_frame_base64": "",
            "key_frame_base64": "data:image/png;base64,AAAA",
            "audio_urls": [AUDIO_URL, "  "],
        },
        allow_data_url=False,
    )

    assert [(item.label, item.role) for item in candidates] == [
        ("首帧参考图", "first_frame"),
        ("关键帧参考图", "key_frame"),
        ("参考音频 1", "audio"),
    ]


@pytest.mark.asyncio
async def test_shared_entry_skips_when_no_media() -> None:
    from app.services.studio.image_pipeline.video_submit import preflight_video_input_media

    called: list[Any] = []

    async def _preflight(candidates: Any, **_kwargs: Any) -> Any:  # pragma: no cover - 触发即失败
        called.append(candidates)
        raise AssertionError("没有媒体时不应调用探活")

    assert await preflight_video_input_media({"prompt": "p"}, provider="apimart", preflight=_preflight) is None
    assert called == []
