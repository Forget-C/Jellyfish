"""视频提交端点的**第二层可达性复核**（故障 A 在出视频这条路上的落点）。

真实故障 A：提交首帧生成，上游 APIMart 建了任务后立刻 failed，错误原文
「无法获取输入媒体 URL（404/410）」—— 传给上游的首帧参考图地址只在本机可读，
匿名访问公网 404，上游抓不到图。

本文件锁住：

1. ``submit_video`` 在**真正发请求之前**逐张探活本次要发出去的帧参考图 / 参考音频；
2. 不可达 → 抛结构化 409，**任务工厂一个都没建**（不产生任何费用）；
3. ``data URL`` 按上游能力判定：APIMart 不吃 → 拦下；openai/volcengine 自己解码 → 放行；
4. DRY_RUN 下一次都不探活（不触网）。

全部不联网：探活注入 stub，任务工厂注入假实现。
"""

from __future__ import annotations

import httpx
import pytest

from app.schemas.studio.image_pipeline import (
    VideoSubmitPlanRead,
    VideoSubmitPlanRequest,
)
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline import video_submit as video_submit_module
from app.services.studio.image_pipeline.video_submit import (
    MIN_VIDEO_SECONDS,
    PINNED_VIDEO_MODEL,
    PINNED_VIDEO_RESOLUTION,
    submit_video,
    video_media_candidates,
)
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV
from tests.llm_orchestration_fixtures import build_session

FRAME_URL = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/test_scene.png"

#: 真实实现（注入 stub 时用，避免在自己的 stub 里再查到 stub 造成递归）
_REAL_PROBE = reference_preflight.probe_reference_url


async def _plan(_db, *, body):  # type: ignore[no-untyped-def]
    return VideoSubmitPlanRead(
        shot_id=body.shot_id,
        provider="apimart",
        model_name=PINNED_VIDEO_MODEL,
        resolution=PINNED_VIDEO_RESOLUTION,
        seconds=MIN_VIDEO_SECONDS,
        ratio="16:9",
    )


def _run_args_with(frame_url: str = FRAME_URL, *, audio: list[str] | None = None):  # type: ignore[no-untyped-def]
    async def _build(_db, **_kwargs):  # type: ignore[no-untyped-def]
        payload: dict = {
            "prompt": "p",
            "ratio": "16:9",
            "model": PINNED_VIDEO_MODEL,
            "seconds": MIN_VIDEO_SECONDS,
            "first_frame_base64": frame_url,
        }
        if audio is not None:
            payload["audio_urls"] = audio
        return {
            "provider": "apimart",
            "api_key": "secret",
            "base_url": "https://api.apimart.test",
            "input": payload,
        }

    return _build


@pytest.fixture(autouse=True)
def _real_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setattr(video_submit_module, "build_video_submit_plan", _plan)


# ---------------------------------------------------------------------------
# 候选抽取
# ---------------------------------------------------------------------------


def test_video_media_candidates_labels_and_roles() -> None:
    candidates = video_media_candidates(
        {
            "first_frame_base64": FRAME_URL,
            "key_frame_base64": "",
            "audio_urls": ["https://cdn.example.com/a.mp3"],
        },
        allow_data_url=False,
    )

    assert [(item.label, item.role) for item in candidates] == [
        ("首帧参考图", "first_frame"),
        ("参考音频 1", "audio"),
    ]
    assert all(item.allow_data_url is False for item in candidates)


def test_video_media_candidates_ignore_empty_values() -> None:
    assert video_media_candidates({"first_frame_base64": "  ", "last_frame_base64": None}) == []


# ---------------------------------------------------------------------------
# 提交：不可达 → 拦下、不建任务、不花钱
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_video_blocks_when_first_frame_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    created: list[str] = []
    probed: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    async def _probe(url, *, label="", role="", **_kwargs):  # type: ignore[no-untyped-def]
        probed.append((label, role))
        return await _REAL_PROBE(
            url, label=label, role=role, transport=httpx.MockTransport(handler)
        )

    monkeypatch.setattr(reference_preflight, "probe_reference_url", _probe)

    def _factory(**_kwargs):  # pragma: no cover - 触发即失败
        created.append("task")
        raise AssertionError("参考图不可达时不得创建生成任务")

    db, engine = await build_session()
    async with db:
        with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
            await submit_video(
                db,
                body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p"),
                run_args_builder=_run_args_with(),
                task_factory=_factory,
                preflight=reference_preflight.preflight_or_raise,
            )

    assert created == []
    assert probed == [("首帧参考图", "first_frame")]
    detail = exc_info.value.detail
    assert detail["code"] == reference_preflight.UNREACHABLE_ERROR_CODE
    assert detail["paid_call_made"] is False
    assert detail["unreachable"][0]["http_status"] == 404
    assert "没有提交" in detail["message"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_blocks_when_audio_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    """参考音频也是"输入媒体 URL"：同样要探活（上游取不到就会任务失败）。"""
    created: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200) if request.url.path.endswith(".png") else httpx.Response(403)

    async def _probe(url, *, label="", role="", **_kwargs):  # type: ignore[no-untyped-def]
        return await _REAL_PROBE(
            url, label=label, role=role, transport=httpx.MockTransport(handler)
        )

    monkeypatch.setattr(reference_preflight, "probe_reference_url", _probe)

    db, engine = await build_session()
    async with db:
        with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
            await submit_video(
                db,
                body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p"),
                run_args_builder=_run_args_with(audio=["https://cdn.example.com/voice.mp3"]),
                task_factory=lambda **_kwargs: created.append("task"),
                preflight=reference_preflight.preflight_or_raise,
            )

    assert created == []
    assert "参考音频 1" in str(exc_info.value.detail["unreachable"])
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_passes_when_everything_reachable(monkeypatch: pytest.MonkeyPatch) -> None:
    """可达时照旧提交（预检不改变正常行为）。"""
    seen: list[str] = []

    class _FakeResult:
        provider = "apimart"
        status = "succeeded"
        provider_task_id = "pt-1"
        url = "https://cdn.example.com/v.mp4"

    class _FakeTask:
        def __init__(self, *, provider_config, input_):  # type: ignore[no-untyped-def]
            self.input_ = input_

        async def run(self) -> None:
            seen.append("run")

        async def get_result(self):  # type: ignore[no-untyped-def]
            return _FakeResult()

        async def status(self):  # type: ignore[no-untyped-def]
            return {}

    async def _probe(url, *, label="", role="", **_kwargs):  # type: ignore[no-untyped-def]
        return await _REAL_PROBE(
            url,
            label=label,
            role=role,
            transport=httpx.MockTransport(lambda _request: httpx.Response(200)),
        )

    monkeypatch.setattr(reference_preflight, "probe_reference_url", _probe)

    db, engine = await build_session()
    async with db:
        result = await submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p"),
            run_args_builder=_run_args_with(),
            task_factory=lambda **kwargs: _FakeTask(**kwargs),
            preflight=reference_preflight.preflight_or_raise,
        )

    assert seen == ["run"]
    assert result.status == "succeeded"
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_blocks_data_url_for_apimart() -> None:
    """APIMart 只接受 http(s):// / asset://：base64 参考图必须拦下（不花一次冤枉钱）。"""
    created: list[str] = []

    db, engine = await build_session()
    async with db:
        with pytest.raises(reference_preflight.ReferencePreflightBlocked) as exc_info:
            await submit_video(
                db,
                body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p"),
                run_args_builder=_run_args_with("data:image/png;base64,AAAA"),
                task_factory=lambda **_kwargs: created.append("task"),
                preflight=reference_preflight.preflight_or_raise,
            )

    assert created == []
    assert exc_info.value.detail["unreachable"][0]["kind"] == reference_preflight.KIND_DATA_URL
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_allows_data_url_for_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    """openai / volcengine 自己解码 base64 → 不算不可达（不能误杀）。"""
    seen: list[str] = []

    async def _build(_db, **_kwargs):  # type: ignore[no-untyped-def]
        return {
            "provider": "openai",
            "api_key": "secret",
            "base_url": "https://api.openai.test",
            "input": {
                "prompt": "p",
                "ratio": "16:9",
                "model": PINNED_VIDEO_MODEL,
                "seconds": MIN_VIDEO_SECONDS,
                "first_frame_base64": "data:image/png;base64,AAAA",
            },
        }

    class _FakeResult:
        provider = "openai"
        status = "succeeded"
        provider_task_id = "pt-2"
        url = "https://cdn.example.com/v2.mp4"

    class _FakeTask:
        def __init__(self, **_kwargs) -> None:  # type: ignore[no-untyped-def]
            pass

        async def run(self) -> None:
            seen.append("run")

        async def get_result(self):  # type: ignore[no-untyped-def]
            return _FakeResult()

        async def status(self):  # type: ignore[no-untyped-def]
            return {}

    db, engine = await build_session()
    async with db:
        result = await submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p"),
            run_args_builder=_build,
            task_factory=lambda **kwargs: _FakeTask(**kwargs),
            preflight=reference_preflight.preflight_or_raise,
        )

    assert seen == ["run"]
    assert result.status == "succeeded"
    await engine.dispose()


@pytest.mark.asyncio
async def test_submit_video_skips_preflight_under_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)
    called: list[object] = []

    async def _preflight(candidates, **_kwargs):  # type: ignore[no-untyped-def]
        called.append(candidates)
        raise AssertionError("DRY_RUN 下不应探活")

    db, engine = await build_session()
    async with db:
        result = await submit_video(
            db,
            body=VideoSubmitPlanRequest(shot_id="shot-1", reference_mode="first", prompt="p"),
            run_args_builder=_run_args_with(),
            preflight=_preflight,
        )

    assert called == []
    assert result.status == "dry_run"
    await engine.dispose()
