"""参考音频「准入口径收口」的回归测试（本轮只到**请求计划层**，不做真实付费调用）。

要收口的问题：同一个"这条音频到底会不会进供应商请求"的问题，此前有**两份**判断：

- 计划层 ``describe_plan_audio`` 用 ``is_public_storage_key``（只问"前缀是不是 http/https/asset://"）
  → 内网地址 ``http://192.168.1.9/voice.mp3`` 会被判成"可用"；
- 提交层 ``attach_shot_audio_to_video_input`` 用 ``startswith("http")``
  → ``asset://`` 被判成"本地地址、不携带"，而供应商协议里 ``asset://`` 是**合法**的参考音频地址。

现在两处都走 ``video_audio_input.classify_audio_input``（唯一纯函数），本文件锁住：

1. **准入规则**：公网 http(s) / ``asset://`` → 携带；本机相对路径 / 内网地址（127. / 10. /
   172.16-31. / 192.168. / 169.254. / localhost / *.local）→ 排除并给原因；
   data URL 按**供应商能力**判定；未绑定 → 明确「未绑定」；
2. **计划审计**：计划预览响应里能看出 ``audio.included`` / ``file_id`` / ``url`` / ``excluded_reason``；
3. **真实请求体**：注入 ``httpx.MockTransport`` 捕获**真发出去**的请求体
   （走真实 ``build_run_args`` + 真实 ``VideoGenerationTask``），断言 ``audio_urls``
   在公网 / asset:// 场景**有**该值，在本机相对路径场景**没有**该值；
4. ``asset://`` 不做匿名探活（供应商私有素材通道，我们探不了），避免"计划说能带、提交说不可达"。

**不联网、不花钱**：上游 HTTP 全部被 MockTransport 拦下；DRY_RUN 默认开启，只有本文件里
显式打开真实模式的两个用例会走到"发请求"这一步，而它们的 transport 仍是 MockTransport。

**仍未验证的部分**（不要谎报）："供应商真实接受参考音频并据此影响生成结果"需要一次真实付费
出视频才能证明，本轮没有做；本文件证明的只是"我们这边会不会把哪个地址放进请求"。
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.schemas.studio.image_pipeline import VideoSubmitPlanRequest
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.llm_orchestration.dry_run import CONFIRM_ENV, DRY_RUN_ENV
from app.services.studio.video_audio_input import classify_audio_input
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

SHOT_ID = "shot-1"
AUDIO_FILE_ID = "file-audio-1"

PUBLIC_AUDIO = "https://cdn.example.com/voice/acceptance_voice.mp3"
LOCAL_AUDIO_KEY = "files/acceptance_voice.mp3"
ASSET_AUDIO = "asset://project-1/voice-asset-1"
PRIVATE_AUDIO = "http://192.168.1.9:8000/static/voice.mp3"
LOOPBACK_AUDIO = "http://127.0.0.1:8000/files/voice.mp3"
DATA_AUDIO = "data:audio/mpeg;base64,QUFBQQ=="
#: MockTransport 里供应商返回的成片地址（不触网）
MOCK_VIDEO_URL = "https://cdn.example.com/v.mp4"

#: 内网 / 本机地址一律不许进请求（别人的服务器一定取不到）
PRIVATE_URLS = [
    PRIVATE_AUDIO,
    LOOPBACK_AUDIO,
    "http://10.1.2.3/voice.mp3",
    "http://172.20.3.4/voice.mp3",
    "http://169.254.10.10/voice.mp3",
    "http://studio.local/voice.mp3",
    "http://localhost:8000/voice.mp3",
]


# ---------------------------------------------------------------------------
# 脚手架：本地存储口径（与 test_vendor_frame_usability 同一套做法）
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _no_real_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """**任何真实出网都不允许**（本轮一次都不出网、不花钱）。

    做法是在**真实传输层**（``httpx.AsyncHTTPTransport`` / ``HTTPTransport``）上装闸：
    真的要走 socket 的请求一律 AssertionError；而 ``httpx.MockTransport`` 自己重写了
    ``handle_async_request``，不经过这里 —— 所以需要用 MockTransport 捕获请求体的用例
    照常工作，没打桩的调用则会立刻炸出来。这样"不出网"是被逼出来的，不靠自觉。
    """

    async def _async_boom(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover - 触发即失败
        raise AssertionError("本轮不允许任何真实出网（所有上游必须走 MockTransport）")

    def _sync_boom(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover - 触发即失败
        raise AssertionError("本轮不允许任何真实出网（所有上游必须走 MockTransport）")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _async_boom)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _sync_boom)


@pytest.fixture(autouse=True)
def _local_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    """把存储钉成"本地驱动 + 无公网基址"，并让相对 key 解析成本机回放地址。

    为什么要显式钉两件事：

    1. 本机 ``backend/.env`` 里有真的 OSS 配置，相对 key 会（正确地）解析成公网地址
       —— 那样"本机相对路径被排除"的用例前提就不成立了；
    2. 不钉就会真的去 HEAD 对象存储（**真实出网**）。本轮要求"一次都不出网"，
       所以这里把 ``get_file_info`` 换成本地回放地址（与 local 驱动的真实行为一致）。
    """
    from app.config import settings
    from app.core.storage import StoredFileInfo

    monkeypatch.setattr(settings, "storage_driver", "local", raising=False)
    monkeypatch.setattr(settings, "s3_bucket_name", None, raising=False)
    monkeypatch.setattr(settings, "s3_public_base_url", "", raising=False)
    monkeypatch.setattr(settings, "local_storage_base_url", "", raising=False)

    async def _fake_get_file_info(*, key: str) -> StoredFileInfo:
        return StoredFileInfo(key=key, url=f"/files/{key.lstrip('/')}", size=1024)

    monkeypatch.setattr("app.core.storage.get_file_info", _fake_get_file_info)


@pytest.mark.asyncio
async def test_no_real_outbound_guard_is_effective() -> None:
    """证明"本轮不出网"这道闸真的有效：真实客户端的请求在传输层就被拦下（连 DNS 都不做）。

    没有这条自检，"我们没出网"就只是口头承诺 —— 闸失效时用例必须红。
    """
    async with httpx.AsyncClient(timeout=1.0) as client:
        with pytest.raises(AssertionError):
            await client.get("https://example.invalid/should-never-be-reached")


async def _seed(db: Any, *, audio_key: str | None = PUBLIC_AUDIO, opt_out: bool = False) -> None:
    """种一个镜头（text_only 计划不需要帧）+ 可选的声音绑定 + 视频模型配置。"""
    from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
    from app.models.studio import FileItem, ShotDetail

    await seed_project_chapter_shot(db)
    db.add(
        ShotDetail(
            id=SHOT_ID,
            camera_shot="MS",
            angle="EYE_LEVEL",
            movement="STATIC",
            duration=5,
            audio_file_id=AUDIO_FILE_ID if audio_key else None,
            audio_opt_out=opt_out,
        )
    )
    if audio_key:
        db.add(FileItem(id=AUDIO_FILE_ID, type="audio", name="验收配音", storage_key=audio_key))
    db.add(Provider(id="prov-1", name="APIMart", base_url="https://api.apimart.test", api_key="k"))
    db.add(
        Model(
            id="model-mini",
            name="seedance-2.0-mini",
            category=ModelCategoryKey.video,
            provider_id="prov-1",
        )
    )
    db.add(ModelSettings(id=1, default_video_model_id="model-mini"))
    await db.flush()


async def _plan(db: Any, **overrides: Any) -> Any:
    from app.services.studio.image_pipeline import video_submit

    body = {
        "shot_id": SHOT_ID,
        "reference_mode": "text_only",
        "ratio": "16:9",
        "prompt": "主角推门而入（本轮只验证请求入参，不做出网调用）",
    }
    body.update(overrides)
    return await video_submit.build_video_submit_plan(db, body=VideoSubmitPlanRequest(**body))


# ---------------------------------------------------------------------------
# 1) 准入规则：唯一纯函数
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "expected_state", "expected_included"),
    [
        (PUBLIC_AUDIO, "public_url", True),
        ("http://cdn.example.com/voice.mp3", "public_url", True),
        (ASSET_AUDIO, "asset_ref", True),
        (LOCAL_AUDIO_KEY, "local_path", False),
        ("/files/files/acceptance_voice.mp3", "local_path", False),
        ("voice.mp3", "local_path", False),
        *[(item, "private_address", False) for item in PRIVATE_URLS],
    ],
)
def test_classify_audio_input_shape_rules(
    url: str, expected_state: str, expected_included: bool
) -> None:
    """形态判定：只有公网 http(s) 与 asset:// 才携带；本机相对路径 / 内网地址一律排除。"""
    admission = classify_audio_input(
        file_id=AUDIO_FILE_ID,
        url=url,
        provider="apimart",
        model="seedance-2.0-mini",
        label="验收配音",
    )
    assert admission.state == expected_state
    assert admission.included is expected_included
    if expected_included:
        assert admission.url == url  # 会进请求的地址就是它
        assert admission.excluded_reason == ""
    else:
        assert admission.url == ""  # 不携带 → 不进请求
        assert admission.declared_url == url  # 但原始地址仍可审计
        assert admission.excluded_reason  # 必须给原因，不许静默丢弃
        assert admission.how_to_fix  # 且给可操作的修法


def test_classify_audio_input_not_bound_says_not_bound() -> None:
    """未绑定 → 原因就写「未绑定」（页面据此显示，不用自己拼字符串）。"""
    admission = classify_audio_input(
        file_id="", url="", provider="apimart", model="seedance-2.0-mini"
    )
    assert admission.included is False
    assert admission.state == "not_bound"
    assert "未绑定" in admission.excluded_reason
    assert admission.file_id == ""


def test_classify_audio_input_opt_out_is_not_noise() -> None:
    """明确标记「无需声音」→ 它是表态，不是漏绑。"""
    admission = classify_audio_input(
        file_id="", url="", provider="apimart", model="seedance-2.0-mini", opt_out=True
    )
    assert admission.included is False
    assert admission.state == "opt_out"
    assert admission.opt_out is True
    assert "无需声音" in admission.excluded_reason


def test_classify_audio_input_vendor_without_reference_audio() -> None:
    """供应商不支持参考音频时不携带，但原因要说清是"供应商不吃"。"""
    admission = classify_audio_input(
        file_id=AUDIO_FILE_ID,
        url=PUBLIC_AUDIO,
        provider="openai",
        model="sora-2",
        label="验收配音",
    )
    assert admission.included is False
    assert admission.state == "vendor_unsupported"
    assert "不接受参考音频" in admission.excluded_reason


@pytest.mark.parametrize(
    ("provider", "expected_included", "expected_state"),
    [("apimart", False, "data_url_rejected"), ("openai", True, "data_url_inline")],
)
def test_classify_audio_input_data_url_follows_vendor_capability(
    provider: str, expected_included: bool, expected_state: str
) -> None:
    """data URL 按**供应商能力**判定：APIMart 不吃 → 排除；供应商自己解码 base64 → 携带。

    "自己解码 base64"这一支用能力表注册的模型来验证（openai/volcengine 的适配器确实
    接受 data URL，但它们默认不声明参考音频输入）—— 这里只验证**代码路径**，
    不代表对某个真实供应商能力的声明。
    """
    from app.core.integrations.video_capabilities import (
        VideoModelCapability,
        register_video_model_capability,
    )

    model = "sora-2"
    if provider != "apimart":
        model = "ref-audio-inline-model"
        register_video_model_capability(
            provider="openai",
            model_prefix=model,
            capability=VideoModelCapability(
                supports_generate_audio=True, min_seconds=1, supports_audio_input=True
            ),
        )
    admission = classify_audio_input(
        file_id=AUDIO_FILE_ID,
        url=DATA_AUDIO,
        provider=provider,
        model=model,
    )
    assert admission.included is expected_included
    assert admission.state == expected_state
    if not expected_included:
        assert "data URL" in admission.excluded_reason


def test_classify_audio_input_file_missing() -> None:
    """绑了 file_id 但素材库查不到 → 明确说"查不到"，不能假装能带。"""
    admission = classify_audio_input(
        file_id="file-gone",
        url=PUBLIC_AUDIO,
        provider="apimart",
        model="seedance-2.0-mini",
        file_found=False,
    )
    assert admission.included is False
    assert admission.state == "file_missing"
    assert "查不到" in admission.excluded_reason


# ---------------------------------------------------------------------------
# 2) 计划审计：included / file_id / url / excluded_reason
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_plan_audio_audit_public_url_is_included() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=PUBLIC_AUDIO)
        plan = await _plan(db)

        assert plan.audio.included is True
        assert plan.audio.file_id == AUDIO_FILE_ID
        assert plan.audio.url == PUBLIC_AUDIO
        assert plan.audio.excluded_reason == ""
        assert plan.audio.state == "public_url"
        assert plan.audio.vendor_supports_reference_audio is True
        # 术语澄清必须随计划一起下发：参考音频（输入）≠ 最终成片音轨（输出侧）
        assert "参考音频" in plan.audio.note
        assert "最终成片的音轨" in plan.audio.note
        # 既有字段保持兼容
        assert plan.audio_state == "bound"
        assert plan.audio_url == PUBLIC_AUDIO
        assert plan.audio_file_id == AUDIO_FILE_ID
    await engine.dispose()


@pytest.mark.asyncio
async def test_plan_audio_audit_asset_ref_is_included() -> None:
    """``asset://`` 是协议里的合法参考音频地址 → 计划必须说"携带"（旧提交端曾判成不可用）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=ASSET_AUDIO)
        plan = await _plan(db)

        assert plan.audio.included is True
        assert plan.audio.url == ASSET_AUDIO
        assert plan.audio.state == "asset_ref"
        assert plan.audio_state == "bound"
    await engine.dispose()


@pytest.mark.asyncio
async def test_plan_audio_audit_local_relative_path_is_excluded_with_reason() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=LOCAL_AUDIO_KEY)
        plan = await _plan(db)

        assert plan.audio.included is False
        assert plan.audio.file_id == AUDIO_FILE_ID  # 已绑定这件事必须如实说
        assert plan.audio.url == ""
        assert plan.audio.state == "local_path"
        assert "本地/相对地址" in plan.audio.excluded_reason
        assert plan.audio.declared_url.startswith("/files/")
        assert plan.audio_state == "bound_not_public"
        assert plan.audio_url == ""
        assert any("本地/相对地址" in item for item in plan.warnings)
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("audio_key", [PRIVATE_AUDIO, LOOPBACK_AUDIO])
async def test_plan_audio_audit_private_address_is_excluded(audio_key: str) -> None:
    """内网地址即使以 http:// 开头也不进请求（旧计划层会把它当公网地址）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=audio_key)
        plan = await _plan(db)

        assert plan.audio.included is False
        assert plan.audio.state == "private_address"
        assert "内网" in plan.audio.excluded_reason
        assert plan.audio_state == "bound_not_public"
        assert plan.audio_url == ""
    await engine.dispose()


@pytest.mark.asyncio
async def test_plan_audio_audit_not_bound_and_opt_out() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=None)
        plan = await _plan(db)
        assert plan.audio.included is False
        assert plan.audio.state == "not_bound"
        assert "未绑定" in plan.audio.excluded_reason
        assert plan.audio_state == "missing"
    await engine.dispose()

    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=None, opt_out=True)
        plan = await _plan(db)
        assert plan.audio.included is False
        assert plan.audio.state == "opt_out"
        assert plan.audio_state == "opt_out"
    await engine.dispose()


# ---------------------------------------------------------------------------
# 3) 探活口径一致：asset:// 不做匿名探活（供应商私有素材通道）
# ---------------------------------------------------------------------------


def test_asset_ref_is_not_probed_but_other_media_still_is() -> None:
    """``asset://`` 不探活；公网地址与 data URL 照旧探活（data URL 由能力表判定）。"""
    from app.services.studio.image_pipeline.video_submit import video_media_candidates

    candidates = video_media_candidates(
        {
            "first_frame_base64": "asset://project-1/frame-1",
            "audio_urls": [ASSET_AUDIO, PUBLIC_AUDIO, DATA_AUDIO],
        },
        allow_data_url=False,
    )
    assert [(item.label, item.url) for item in candidates] == [
        ("参考音频 2", PUBLIC_AUDIO),
        ("参考音频 3", DATA_AUDIO),
    ]

    # 公网语音仍然会探活；本地相对路径也会（形态判定直接拦下，不发请求）
    local = video_media_candidates({"audio_urls": [LOCAL_AUDIO_KEY]})
    assert [item.url for item in local] == [LOCAL_AUDIO_KEY]


# ---------------------------------------------------------------------------
# 3.2) 与官方协议（SIX_STEP_ACCEPTANCE.md:128）的对账
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audio_urls_capped_at_three_like_the_official_contract() -> None:
    """官方口径「最多 3 条」：接线层截断到 3（适配器层还有一道 ``[:3]``）。"""
    from app.services.studio.video_audio_input import attach_shot_audio_to_video_input

    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=PUBLIC_AUDIO)
        payload = {"audio_urls": [f"https://cdn.example.com/{i}.mp3" for i in range(4)]}
        await attach_shot_audio_to_video_input(
            db, shot_id=SHOT_ID, input_payload=payload, provider="apimart", model="seedance-2.0-mini"
        )
    assert len(payload["audio_urls"]) == 3
    await engine.dispose()


@pytest.mark.asyncio
async def test_frame_conflict_warning_does_not_overclaim() -> None:
    """首尾帧与参考音频互斥：给提示 + 适配器改写，但**不许**暗示"参考音频因此生效"。

    口径来源：``SIX_STEP_ACCEPTANCE.md`` 第 128 行（与首尾帧图片互斥）与第 199 行的更正段落
    （"参考音频是否被采用"未证实）—— 提示文案必须与后者一致，不能写成"为让参考音频生效"。
    """
    from app.services.studio.video_audio_input import attach_shot_audio_to_video_input

    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=PUBLIC_AUDIO)
        payload = {
            "first_frame_base64": "https://cdn.example.com/first.png",
            "last_frame_base64": "https://cdn.example.com/last.png",
        }
        warnings = await attach_shot_audio_to_video_input(
            db, shot_id=SHOT_ID, input_payload=payload, provider="apimart", model="seedance-2.0-mini"
        )
    joined = " ".join(warnings)
    assert payload["audio_urls"] == [PUBLIC_AUDIO]
    assert "首尾帧图片时参考音频不可用" in joined  # 官方警告原意保留
    assert "为让参考音频生效" not in joined  # 不夸大：是否被采用尚无证据
    assert "尚无" in joined or "无真实证据" in joined
    await engine.dispose()


# ---------------------------------------------------------------------------
# 3.5) legacy 预览端点：同一份判定 + 同一份审计字段
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_legacy_preview_reports_same_audio_audit() -> None:
    """``POST /film/tasks/video/preview-prompt`` 也给出 ``audio`` 审计（与直提路径同一实现）。

    这条路径以前完全没有音频结论，页面上"能不能带参考音频"只能靠猜。
    """
    from app.api.v1.routes.film import generated_video as legacy_route
    from app.api.v1.routes.film.video_request import VideoGenerationTaskRequest

    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=PUBLIC_AUDIO)
        response = await legacy_route.preview_video_generation_prompt(
            body=VideoGenerationTaskRequest(
                shot_id=SHOT_ID,
                reference_mode="text_only",
                prompt="主角推门而入",
                images=[],
                ratio="16:9",
            ),
            db=db,
        )

    data = response.data
    assert data is not None and data.audio is not None
    assert data.audio.included is True
    assert data.audio.file_id == AUDIO_FILE_ID
    assert data.audio.url == PUBLIC_AUDIO
    assert any("参考音频" in item for item in data.audio_warnings)
    await engine.dispose()


# ---------------------------------------------------------------------------
# 4) 传输层证据：捕获**真发出去**的请求体
# ---------------------------------------------------------------------------


class _Transport:
    """一个 MockTransport：既当供应商，又当探活目标，并记录所有出站请求。"""

    def __init__(self) -> None:
        self.bodies: list[dict[str, Any]] = []
        self.probes: list[str] = []
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/videos/generations"):
            self.bodies.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(200, json={"data": [{"task_id": "task-mock-1"}]})
        if "/tasks/" in url:
            return httpx.Response(
                200,
                json={
                    "data": {
                        "status": "completed",
                        "result": {"videos": [{"url": "https://cdn.example.com/v.mp4"}]},
                    }
                },
            )
        # 其余都是参考媒体探活（HEAD/GET）
        self.probes.append(url)
        return httpx.Response(200)


@pytest.fixture
def _capture(monkeypatch: pytest.MonkeyPatch) -> _Transport:
    """把 httpx.AsyncClient 整个换成一个记录用的 MockTransport 客户端。

    这样"发给供应商的请求体"与"探活请求"都真的会经过我们的 transport —— 断言的是
    **实际构造出来的 HTTP 请求**，而不是某个中间变量的形状。
    """
    captured = _Transport()
    real_client = httpx.AsyncClient

    def factory(**kwargs: Any) -> httpx.AsyncClient:
        timeout = kwargs.get("timeout", 60.0)
        return real_client(transport=captured.transport, timeout=timeout)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return captured


@pytest.fixture
def _real_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """显式打开"允许真实提交"，但 transport 仍是 MockTransport（不触网、不花钱）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")


async def _submit(db: Any) -> Any:
    from app.services.studio.image_pipeline import video_submit

    return await video_submit.submit_video(
        db,
        body=VideoSubmitPlanRequest(
            shot_id=SHOT_ID,
            reference_mode="text_only",
            ratio="16:9",
            prompt="主角推门而入（MockTransport 捕获，不出网）",
        ),
        preflight=reference_preflight.preflight_or_raise,
    )


@pytest.mark.asyncio
async def test_request_body_carries_public_audio_url(
    _capture: _Transport, _real_mode: None
) -> None:
    """公网地址 → 真发出去的请求体里 ``audio_urls`` **有**该值，且探活探的就是它。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=PUBLIC_AUDIO)
        result = await _submit(db)

    assert result.url == MOCK_VIDEO_URL  # 真跑完了 MockTransport 的创建+轮询
    assert len(_capture.bodies) == 1
    body = _capture.bodies[0]
    assert body["audio_urls"] == [PUBLIC_AUDIO]
    assert body["model"] == "seedance-2.0-mini"
    # 追溯字段绝不发给供应商
    assert "audio_source_file_id" not in body
    assert "audio_base64" not in body
    # 探活确实做了（匿名 HEAD 那个公网地址）
    assert any(item.startswith(PUBLIC_AUDIO) for item in _capture.probes)
    await engine.dispose()


@pytest.mark.asyncio
async def test_request_body_omits_local_relative_audio(
    _capture: _Transport, _real_mode: None
) -> None:
    """本机相对路径 → 请求体里**没有** ``audio_urls``，但计划里给出排除原因。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=LOCAL_AUDIO_KEY)
        plan = await _plan(db)
        result = await _submit(db)

    assert result.url == MOCK_VIDEO_URL  # 真跑完了 MockTransport 的创建+轮询
    assert len(_capture.bodies) == 1
    body = _capture.bodies[0]
    assert "audio_urls" not in body
    # 没有音频可探 → 一次探活请求都不发
    assert _capture.probes == []
    # 计划层必须**在提交之前**就说清为什么（不是等失败才说）
    assert plan.audio.included is False
    assert plan.audio.state == "local_path"
    assert plan.audio.excluded_reason
    await engine.dispose()


@pytest.mark.asyncio
async def test_request_body_carries_asset_ref_audio_and_skips_probe(
    _capture: _Transport, _real_mode: None
) -> None:
    """``asset://`` → 请求体里带该值；它是供应商私有素材通道，我们这边不探活。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=ASSET_AUDIO)
        result = await _submit(db)

    assert result.url == MOCK_VIDEO_URL
    assert _capture.bodies[0]["audio_urls"] == [ASSET_AUDIO]
    assert _capture.probes == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_request_body_omits_private_address_audio(
    _capture: _Transport, _real_mode: None
) -> None:
    """内网地址 → 不进请求体（这正是"本机可读、供应商 404"那一类故障的源头）。"""
    db, engine = await build_session()
    async with db:
        await _seed(db, audio_key=PRIVATE_AUDIO)
        result = await _submit(db)

    assert result.url == MOCK_VIDEO_URL
    assert "audio_urls" not in _capture.bodies[0]
    assert _capture.probes == []
    await engine.dispose()
