"""DreamAPI HTTP adapters：使用 MockTransport 覆盖异步提交与结果轮询。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.contracts.image_generation import ImageGenerationInput, InputImageRef
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.dreamapi.images import DreamAPIImageApiAdapter, _build_image_request
from app.core.integrations.dreamapi.video import DreamAPIVideoApiAdapter, _build_video_request
from app.core.integrations.image_capabilities import resolve_image_capability
from app.core.integrations.video_capabilities import resolve_video_capability


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        timeout = kwargs.get("timeout", 60.0)
        return real_client(transport=transport, timeout=timeout)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    monkeypatch.setattr("app.core.integrations.dreamapi.common.POLL_INTERVAL_S", 0)


@pytest.mark.asyncio
async def test_dreamapi_seedream_image_submits_polls_and_parses_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    responses = [
        {"code": 0, "data": {"taskId": "image-task"}},
        {
            "code": 0,
            "data": {
                "task": {"taskId": "image-task", "status": 3},
                "images": [{"imageUrl": "https://cdn.example.com/image.png"}],
            },
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=responses.pop(0))

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    config = ProviderConfig(provider="dreamapi", api_key="test-key", base_url="https://api.newportai.com")
    input_ = ImageGenerationInput(
        prompt="storybook fox",
        model="seedream-5.0-pro",
        images=[InputImageRef(image_url="https://cdn.example.com/reference.png")],
        size="1.5K",
        seed=17,
    )

    result = await DreamAPIImageApiAdapter().generate(cfg=config, inp=input_, timeout_s=30)

    assert [request.url.path for request in requests] == [
        "/api/async/seedream",
        "/api/getAsyncResult",
    ]
    assert requests[0].headers["authorization"] == "Bearer test-key"
    body = json.loads(requests[0].content.decode())
    assert body == {
        "model": "seedream-5.0-pro",
        "prompt": "storybook fox",
        "image": ["https://cdn.example.com/reference.png"],
        "size": "1.5K",
        "seed": 17,
    }
    assert json.loads(requests[1].content.decode()) == {"taskId": "image-task"}
    assert result.provider == "dreamapi"
    assert result.provider_task_id == "image-task"
    assert result.images[0].url == "https://cdn.example.com/image.png"


@pytest.mark.asyncio
async def test_dreamapi_image_adapter_resolves_video_reference_size_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    responses = [
        {"code": 0, "data": {"taskId": "image-task"}},
        {
            "code": 0,
            "data": {
                "task": {"taskId": "image-task", "status": 3},
                "images": [{"imageUrl": "https://cdn.example.com/frame.png"}],
            },
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=responses.pop(0))

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    await DreamAPIImageApiAdapter().generate(
        cfg=ProviderConfig(provider="dreamapi", api_key="test-key", base_url="https://api.newportai.com"),
        inp=ImageGenerationInput(
            prompt="story frame",
            model="seedream-5.0-lite",
            target_ratio="16:9",
            resolution_profile="high",
            purpose="video_reference",
        ),
        timeout_s=30,
    )

    assert json.loads(requests[0].content.decode())["size"] == "3072x1728"


@pytest.mark.asyncio
async def test_dreamapi_dreamvideo_image_to_video_submits_and_polls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    responses = [
        {"code": 0, "data": {"taskId": "video-task"}},
        {
            "code": 0,
            "data": {
                "task": {"taskId": "video-task", "status": 3},
                "videos": [{"videoUrl": "https://cdn.example.com/video.mp4"}],
            },
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=responses.pop(0))

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    config = ProviderConfig(provider="dreamapi", api_key="test-key", base_url="https://api.newportai.com")
    input_ = VideoGenerationInput(
        prompt="camera slowly pushes in",
        model="dreamvideo-3.0",
        ratio="16:9",
        seconds=3,
        seed=42,
        first_frame_base64="https://cdn.example.com/first.png",
        last_frame_base64="https://cdn.example.com/last.png",
    )

    result = await DreamAPIVideoApiAdapter().generate(cfg=config, input_=input_, timeout_s=30)

    assert [request.url.path for request in requests] == [
        "/api/async/dreamvideo_3.0/image_to_video",
        "/api/getAsyncResult",
    ]
    assert requests[0].headers["authorization"] == "Bearer test-key"
    body = json.loads(requests[0].content.decode())
    assert body == {
        "prompt": "camera slowly pushes in",
        "images": [
            "https://cdn.example.com/first.png",
            "https://cdn.example.com/last.png",
        ],
        "duration": 3,
        "aspectRatio": "16:9",
        "seed": 42,
    }
    assert result.provider == "dreamapi"
    assert result.provider_task_id == "video-task"
    assert result.url == "https://cdn.example.com/video.mp4"


@pytest.mark.parametrize(
    ("model", "images", "expected_path", "expected_body"),
    [
        (
            "seedream-4.0",
            [],
            "/api/async/seedream",
            {"model": "seedream-4.0", "prompt": "test prompt"},
        ),
        (
            "seedream-4.5",
            ["https://cdn.example.com/ref.png"],
            "/api/async/seedream",
            {
                "model": "seedream-4.5",
                "prompt": "test prompt",
                "image": ["https://cdn.example.com/ref.png"],
            },
        ),
        (
            "seedream-5.0-lite",
            [],
            "/api/async/seedream",
            {"model": "seedream-5.0-lite", "prompt": "test prompt"},
        ),
        (
            "seedream-5.0-pro",
            [],
            "/api/async/seedream",
            {"model": "seedream-5.0-pro", "prompt": "test prompt"},
        ),
        (
            "flux",
            [],
            "/api/async/flux_text2image",
            {"prompt": "test prompt", "width": 1024, "height": 1024, "num": 1},
        ),
        (
            "flux",
            ["https://cdn.example.com/ref.png"],
            "/api/async/flux_image2image",
            {
                "prompt": "test prompt",
                "width": 1024,
                "height": 1024,
                "num": 1,
                "imageUrl": "https://cdn.example.com/ref.png",
            },
        ),
        (
            "dreamimage-2.0",
            ["https://cdn.example.com/ref.png"],
            "/api/async/dreamimage_2.0",
            {"image": "https://cdn.example.com/ref.png", "prompt": "test prompt"},
        ),
        (
            "nano-banana-2",
            [],
            "/api/async/google_gemini_image",
            {"model": "gemini-3.1-flash-image-preview", "text": "test prompt"},
        ),
        (
            "nano-banana-pro",
            ["https://cdn.example.com/ref.png"],
            "/api/async/google_gemini_image",
            {
                "model": "gemini-3-pro-image-preview",
                "text": "test prompt",
                "images": ["https://cdn.example.com/ref.png"],
            },
        ),
        (
            "gpt-image-2",
            [],
            "/api/async/gpt_image",
            {"prompt": "test prompt", "width": 1024, "height": 1024, "quality": "low", "n": 1},
        ),
        (
            "gpt-image-2.5-flare-text-to-image",
            [],
            "/api/async/gpt_image_2.5/flare/text_to_image",
            {"prompt": "test prompt", "width": 1024, "height": 1024, "quality": "low", "n": 1},
        ),
        (
            "gpt-image-2.5-flare-image-to-image",
            ["https://cdn.example.com/ref.png"],
            "/api/async/gpt_image_2.5/flare/image_to_image",
            {
                "prompt": "test prompt",
                "width": 1024,
                "height": 1024,
                "quality": "low",
                "n": 1,
                "images": ["https://cdn.example.com/ref.png"],
            },
        ),
        (
            "gpt-image-2.5-sunburst-text-to-image",
            [],
            "/api/async/gpt_image_2.5/sunburst/text_to_image",
            {"prompt": "test prompt", "width": 1024, "height": 1024, "quality": "low", "n": 1},
        ),
        (
            "gpt-image-2.5-sunburst-image-to-image",
            ["https://cdn.example.com/ref.png"],
            "/api/async/gpt_image_2.5/sunburst/image_to_image",
            {
                "prompt": "test prompt",
                "width": 1024,
                "height": 1024,
                "quality": "low",
                "n": 1,
                "images": ["https://cdn.example.com/ref.png"],
            },
        ),
        (
            "colorize",
            ["https://cdn.example.com/source.png"],
            "/api/async/colorize",
            {"url": "https://cdn.example.com/source.png"},
        ),
        (
            "enhance",
            ["https://cdn.example.com/source.png"],
            "/api/async/enhance",
            {"imageUrl": "https://cdn.example.com/source.png"},
        ),
        (
            "remove-background",
            ["https://cdn.example.com/source.png"],
            "/api/async/remove_background",
            {"url": "https://cdn.example.com/source.png"},
        ),
        (
            "swap-face",
            ["https://cdn.example.com/target.png", "https://cdn.example.com/face.png"],
            "/api/async/swap_face",
            {
                "url": "https://cdn.example.com/target.png",
                "faceImgUrl": "https://cdn.example.com/face.png",
            },
        ),
        (
            "virtual-try-on",
            ["https://cdn.example.com/model.png", "https://cdn.example.com/outfit.png"],
            "/api/async/tryon_clothes",
            {
                "modelImage": "https://cdn.example.com/model.png",
                "overallClothes": "https://cdn.example.com/outfit.png",
            },
        ),
        (
            "virtual-try-on",
            [
                "https://cdn.example.com/model.png",
                "https://cdn.example.com/top.png",
                "https://cdn.example.com/bottom.png",
            ],
            "/api/async/tryon_clothes",
            {
                "modelImage": "https://cdn.example.com/model.png",
                "upperClothes": "https://cdn.example.com/top.png",
                "lowerClothes": "https://cdn.example.com/bottom.png",
            },
        ),
    ],
)
def test_dreamapi_image_modes_build_documented_requests(
    model: str,
    images: list[str],
    expected_path: str,
    expected_body: dict[str, object],
) -> None:
    input_ = ImageGenerationInput(
        prompt="test prompt",
        model=model,
        images=[InputImageRef(image_url=image) for image in images],
    )

    endpoint, body = _build_image_request(input_)

    assert endpoint == expected_path
    assert body == expected_body


@pytest.mark.parametrize(
    ("model", "images", "expected_path", "expected_body"),
    [
        (
            "dreamvideo-3.0",
            [],
            "/api/async/dreamvideo_3.0/text_to_video",
            {"prompt": "test motion", "duration": 5, "aspectRatio": "16:9"},
        ),
        (
            "wan2.1",
            [],
            "/api/async/wan/text_to_video/2.1",
            {"prompt": "test motion", "resolution": "480p"},
        ),
        (
            "wan2.1",
            ["https://cdn.example.com/first.png"],
            "/api/async/wan/image_to_video/2.1",
            {
                "prompt": "test motion",
                "image": "https://cdn.example.com/first.png",
                "resolution": "480p",
            },
        ),
        (
            "wan2.1",
            ["https://cdn.example.com/first.png", "https://cdn.example.com/last.png"],
            "/api/async/wan/head_tail_to_video/2.1",
            {
                "prompt": "test motion",
                "firstImage": "https://cdn.example.com/first.png",
                "lastImage": "https://cdn.example.com/last.png",
            },
        ),
        (
            "seedance-2.0",
            ["https://cdn.example.com/first.png", "https://cdn.example.com/last.png"],
            "/api/async/seedance_2.0",
            {
                "model": "seedance-2.0",
                "prompt": "test motion",
                "resolution": "480p",
                "duration": 5,
                "ratio": "16:9",
                "imageUrl": "https://cdn.example.com/first.png",
                "endImageUrl": "https://cdn.example.com/last.png",
            },
        ),
        (
            "seedance-2.0-mini",
            [],
            "/api/async/seedance_2.0",
            {
                "model": "seedance-2.0-mini",
                "prompt": "test motion",
                "resolution": "480p",
                "duration": 5,
                "ratio": "16:9",
            },
        ),
        (
            "seedance-2.5",
            [],
            "/api/async/seedance_2.5",
            {
                "model": "seedance-2.5",
                "prompt": "test motion",
                "resolution": "480p",
                "duration": 5,
                "ratio": "16:9",
            },
        ),
        (
            "seedance-2.5",
            ["https://cdn.example.com/first.png", "https://cdn.example.com/last.png"],
            "/api/async/seedance_2.5",
            {
                "model": "seedance-2.5",
                "prompt": "test motion",
                "resolution": "480p",
                "duration": 5,
                "ratio": "adaptive",
                "imageUrl": "https://cdn.example.com/first.png",
                "endImageUrl": "https://cdn.example.com/last.png",
            },
        ),
    ],
)
def test_dreamapi_video_modes_build_documented_requests(
    model: str,
    images: list[str],
    expected_path: str,
    expected_body: dict[str, object],
) -> None:
    frames = images + [None, None]
    input_ = VideoGenerationInput(
        prompt="test motion",
        model=model,
        ratio="16:9",
        seconds=5,
        first_frame_base64=frames[0],
        last_frame_base64=frames[1],
    )

    endpoint, body = _build_video_request(input_, image_urls=images)

    assert endpoint == expected_path
    assert body == expected_body


def test_dreamapi_dreamvideo_rejects_zero_seed() -> None:
    input_ = VideoGenerationInput(
        prompt="test motion",
        model="dreamvideo-3.0",
        ratio="16:9",
        seed=0,
    )

    with pytest.raises(ValueError, match="seed must be -1 or a positive integer"):
        _build_video_request(input_)


def test_dreamapi_unknown_dreamvideo_variant_is_not_silently_routed() -> None:
    input_ = VideoGenerationInput(
        prompt="test motion",
        model="dreamvideo-3.0-fast",
        ratio="16:9",
    )

    with pytest.raises(ValueError, match="Unsupported DreamAPI video model"):
        _build_video_request(input_)


def test_dreamapi_image_capabilities_match_single_output_and_seed_support() -> None:
    seedream = resolve_image_capability(provider="dreamapi", model="seedream-5.0-lite")
    nano_banana = resolve_image_capability(provider="dreamapi", model="nano-banana-2")
    dreamimage = resolve_image_capability(provider="dreamapi", model="dreamimage-2.0")
    try_on = resolve_image_capability(provider="dreamapi", model="virtual-try-on")

    assert seedream.max_n == 1
    assert seedream.supports_seed
    assert nano_banana.max_n == 1
    assert not nano_banana.supports_seed
    assert dreamimage.max_n == 1
    assert try_on.max_n == 1


@pytest.mark.parametrize(
    ("model", "minimum", "maximum", "allowed_ratios"),
    [
        ("dreamvideo-3.0", 3, 15, {"16:9", "4:3", "1:1", "3:4", "9:16"}),
        ("seedance-2.0", 4, 15, {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}),
        ("seedance-2.0-mini", 4, 15, {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}),
        ("seedance-2.5", 4, 30, {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}),
    ],
)
def test_dreamapi_video_capabilities_match_documented_ranges(
    model: str,
    minimum: int,
    maximum: int,
    allowed_ratios: set[str],
) -> None:
    capability = resolve_video_capability(provider="dreamapi", model=model)
    assert capability.min_seconds == minimum
    assert capability.max_seconds == maximum
    assert capability.allowed_ratios == allowed_ratios


def test_dreamapi_video_capabilities_reject_unsupported_seed_for_wan() -> None:
    assert not resolve_video_capability(provider="dreamapi", model="wan2.1").supports_seed


@pytest.mark.parametrize(
    ("model", "size", "message"),
    [
        ("flux", "1616x1024", "1600"),
        ("flux", "1025x1024", "multiple of 16"),
        ("seedream-4.5", "1024x1024", "minimum pixel"),
        ("gpt-image-2.5-flare-text-to-image", "1024x512", "minimum pixel"),
        ("virtual-try-on", "1024x1200", "1,200,000"),
    ],
)
def test_dreamapi_image_modes_reject_sizes_the_upstream_api_cannot_accept(
    model: str,
    size: str,
    message: str,
) -> None:
    input_ = ImageGenerationInput(
        prompt="test prompt",
        model=model,
        size=size,
        images=(
            [
                InputImageRef(image_url="https://cdn.example.com/model.png"),
                InputImageRef(image_url="https://cdn.example.com/outfit.png"),
            ]
            if model == "virtual-try-on"
            else []
        ),
    )

    with pytest.raises(ValueError, match=message):
        _build_image_request(input_)


def test_dreamapi_try_on_only_overrides_upstream_dimensions_when_size_is_explicit() -> None:
    input_ = ImageGenerationInput(
        prompt="test prompt",
        model="virtual-try-on",
        images=[
            InputImageRef(image_url="https://cdn.example.com/model.png"),
            InputImageRef(image_url="https://cdn.example.com/outfit.png"),
        ],
        size="768x1024",
    )

    _, body = _build_image_request(input_)

    assert body["width"] == 768
    assert body["height"] == 1024
    assert "enableShoes" not in body


def test_dreamapi_outpainting_is_rejected_without_per_edge_contract_fields() -> None:
    input_ = ImageGenerationInput(prompt="extend image", model="outpainting")

    with pytest.raises(ValueError, match="no per-edge outPaintSize"):
        _build_image_request(input_)


def test_dreamapi_unknown_flux_variant_is_not_silently_routed_to_flux() -> None:
    input_ = ImageGenerationInput(prompt="test prompt", model="flux-unlisted-variant")

    with pytest.raises(ValueError, match="Unsupported DreamAPI image model"):
        _build_image_request(input_)


@pytest.mark.asyncio
async def test_dreamapi_image_adapter_uploads_base64_reference_before_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/file/v1/get_policy":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "host": "https://dreamface-resource.oss-cn-hangzhou.aliyuncs.com",
                        "key": "ref.png",
                        "OSSAccessKeyId": "oss-id",
                        "policy": "oss-policy",
                        "signature": "oss-signature",
                        "reqId": "policy-req",
                    },
                },
            )
        if request.url.host == "dreamface-resource.oss-cn-hangzhou.aliyuncs.com":
            return httpx.Response(200, json={"data": {"reqId": "uploaded-req"}})
        if request.url.path == "/api/file/v1/policy_upload_finish":
            return httpx.Response(200, json={"code": 0, "data": {"url": "https://cdn.example.com/ref.png"}})
        if request.url.path == "/api/async/seedream":
            return httpx.Response(200, json={"code": 0, "data": {"taskId": "image-task"}})
        if request.url.path == "/api/getAsyncResult":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "task": {"taskId": "image-task", "status": 3},
                        "images": [{"imageUrl": "https://cdn.example.com/result.png"}],
                    },
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await DreamAPIImageApiAdapter().generate(
        cfg=ProviderConfig(provider="dreamapi", api_key="test-key", base_url="https://api.newportai.com"),
        inp=ImageGenerationInput(
            prompt="edit this",
            model="seedream-5.0-pro",
            images=[InputImageRef(image_url="data:image/png;base64,aGVsbG8=")],
        ),
        timeout_s=30,
    )

    assert [request.url.path for request in requests] == [
        "/api/file/v1/get_policy",
        "/",
        "/api/file/v1/policy_upload_finish",
        "/api/async/seedream",
        "/api/getAsyncResult",
    ]
    oss_request = requests[1]
    assert "authorization" not in oss_request.headers
    assert b"test-key" not in oss_request.content
    assert json.loads(requests[3].content.decode())["image"] == ["https://cdn.example.com/ref.png"]
    assert result.images[0].url == "https://cdn.example.com/result.png"


@pytest.mark.asyncio
async def test_dreamapi_video_adapter_uploads_base64_frame_before_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/file/v1/get_policy":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "host": "https://dreamface-resource.oss-cn-hangzhou.aliyuncs.com",
                        "key": "frame.jpg",
                        "OSSAccessKeyId": "oss-id",
                        "policy": "oss-policy",
                        "signature": "oss-signature",
                        "reqId": "policy-req",
                    },
                },
            )
        if request.url.host == "dreamface-resource.oss-cn-hangzhou.aliyuncs.com":
            return httpx.Response(200, json={"data": {"reqId": "uploaded-req"}})
        if request.url.path == "/api/file/v1/policy_upload_finish":
            return httpx.Response(200, json={"code": 0, "data": {"url": "https://cdn.example.com/frame.jpg"}})
        if request.url.path == "/api/async/dreamvideo_3.0/image_to_video":
            return httpx.Response(200, json={"code": 0, "data": {"taskId": "video-task"}})
        if request.url.path == "/api/getAsyncResult":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "task": {"taskId": "video-task", "status": 3},
                        "videos": [{"videoUrl": "https://cdn.example.com/result.mp4"}],
                    },
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await DreamAPIVideoApiAdapter().generate(
        cfg=ProviderConfig(provider="dreamapi", api_key="test-key", base_url="https://api.newportai.com"),
        input_=VideoGenerationInput(
            prompt="animate frame",
            model="dreamvideo-3.0",
            ratio="16:9",
            first_frame_base64="data:image/jpeg;base64,aGVsbG8=",
        ),
        timeout_s=30,
    )

    assert [request.url.path for request in requests] == [
        "/api/file/v1/get_policy",
        "/",
        "/api/file/v1/policy_upload_finish",
        "/api/async/dreamvideo_3.0/image_to_video",
        "/api/getAsyncResult",
    ]
    oss_request = requests[1]
    assert "authorization" not in oss_request.headers
    assert b"test-key" not in oss_request.content
    assert json.loads(requests[3].content.decode())["images"] == ["https://cdn.example.com/frame.jpg"]
    assert result.url == "https://cdn.example.com/result.mp4"
