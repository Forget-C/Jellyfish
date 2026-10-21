"""DreamAPI Storage uploads stay server-side and keep the API key off OSS."""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.contracts.provider import ProviderConfig
from app.core.integrations.dreamapi.storage import image_ref_to_public_url
from app.core.integrations.dreamapi import storage as dreamapi_storage


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        timeout = kwargs.get("timeout", 60.0)
        return real_client(transport=transport, timeout=timeout)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_data_url_upload_uses_dreamapi_policy_oss_then_finish_without_key_on_oss(
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
                        "host": "https://dreamface-resource-aigc.oss-us-east-1.aliyuncs.com",
                        "key": "dreamapi/reference.png",
                        "OSSAccessKeyId": "oss-access-id",
                        "policy": "oss-policy",
                        "signature": "oss-signature",
                        "callback": "oss-callback",
                        "reqId": "policy-req",
                    },
                },
            )
        if request.url.host == "dreamface-resource-aigc.oss-us-east-1.aliyuncs.com":
            return httpx.Response(200, json={"data": {"reqId": "uploaded-req"}})
        if request.url.path == "/api/file/v1/policy_upload_finish":
            return httpx.Response(
                200,
                json={"code": 0, "data": {"url": "https://cdn.example.com/reference.png"}},
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    config = ProviderConfig(provider="dreamapi", api_key="test-secret", base_url="https://api.newportai.com")

    url = await image_ref_to_public_url(
        cfg=config,
        image_ref="data:image/png;base64,aGVsbG8=",
        timeout_s=30,
    )

    assert url == "https://cdn.example.com/reference.png"
    assert [request.url.path for request in requests] == [
        "/api/file/v1/get_policy",
        "/",
        "/api/file/v1/policy_upload_finish",
    ]
    assert requests[0].headers["authorization"] == "Bearer test-secret"
    assert json.loads(requests[0].content.decode()) == {"scene": "Dream-CN"}
    oss_request = requests[1]
    assert "authorization" not in oss_request.headers
    assert b"test-secret" not in oss_request.content
    multipart = oss_request.content.decode("latin-1")
    assert 'name="key"' in multipart
    assert 'name="OSSAccessKeyId"' in multipart
    assert 'name="file"' in multipart
    assert multipart.index('name="file"') > multipart.index('name="signature"')
    assert "image/png" in multipart
    assert b"hello" in oss_request.content
    assert requests[2].headers["authorization"] == "Bearer test-secret"
    assert json.loads(requests[2].content.decode()) == {"reqId": "uploaded-req"}


@pytest.mark.asyncio
async def test_remote_https_image_is_passed_through_without_upload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"public URL should not upload: {request.url}")

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))

    url = await image_ref_to_public_url(
        cfg=ProviderConfig(provider="dreamapi", api_key="test-secret"),
        image_ref="https://cdn.example.com/reference.webp",
        timeout_s=30,
    )

    assert url == "https://cdn.example.com/reference.webp"


@pytest.mark.asyncio
async def test_unsafe_storage_policy_host_is_rejected_before_oss_upload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "host": "http://127.0.0.1:9000/upload",
                    "key": "reference.png",
                    "accessId": "oss-access-id",
                    "policy": "oss-policy",
                    "signature": "oss-signature",
                    "reqId": "policy-req",
                },
            },
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))

    with pytest.raises(ValueError, match="unsafe DreamAPI storage host"):
        await image_ref_to_public_url(
            cfg=ProviderConfig(provider="dreamapi", api_key="test-secret"),
            image_ref="data:image/png;base64,aGVsbG8=",
            timeout_s=30,
        )

    assert [request.url.path for request in requests] == ["/api/file/v1/get_policy"]


def test_oversized_base64_is_rejected_before_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dreamapi_storage, "_MAX_UPLOAD_BYTES", 2)

    with pytest.raises(ValueError, match="30 MB upload limit"):
        dreamapi_storage._parse_image_reference("data:image/png;base64,aGVsbG8=")
