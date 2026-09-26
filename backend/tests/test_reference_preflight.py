"""提交前的参考图可达性预检（``image_pipeline/reference_preflight.py``）。

真实故障 A：传给上游的参考图地址只在本机可读（匿名访问公网 404），上游抓不到图 →
任务 failed（原文「无法获取输入媒体 URL（404/410）」）。这个文件锁住三件事：

1. 形态不对的引用（本机 / 相对路径、上游不吃的 data URL、内网地址）**不发请求**就拦下；
2. 形态对但匿名 4xx/5xx 的地址**带真实状态码 + 修法**拦下（HEAD 失败要回退 GET 复核）；
3. 被拦下时**没有任何付费调用**，且给用户看的文案里**不出现 file_id / 本机绝对路径**。

全部不联网：所有探活都注入 ``httpx.MockTransport`` 或直接注入 stub probe。
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from app.services.studio.image_pipeline import reference_preflight as preflight
from app.services.studio.llm_orchestration.dry_run import DryRunBlocked

OSS_URL = "https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/test_scene.png"


def _forbidden_transport() -> httpx.MockTransport:
    """任何用到它的请求都说明「本来不该发请求」。"""

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 触发即失败
        raise AssertionError(f"这张参考图不该发探活请求：{request.method} {request.url}")

    return httpx.MockTransport(handler)


# ---------------------------------------------------------------------------
# 1) 形态判定：不发请求就判死
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_relative_local_path_is_blocked_without_any_request() -> None:
    """本机/相对路径：上游一定取不到，探活都不该发。"""
    result = await preflight.probe_reference_url(
        "jellyfish/acceptance/files/test_scene.png",
        label="场景「会议室」的定版垫图",
        transport=_forbidden_transport(),
    )

    assert result.reachable is False
    assert result.kind == preflight.KIND_LOCAL_PATH
    assert "本机" in result.reason
    assert result.http_status is None
    assert "重新上传" in result.how_to_fix
    # 本机路径绝不能出现在可展示字段里
    assert result.to_read()["url"] == ""


@pytest.mark.asyncio
async def test_data_url_blocked_when_vendor_cannot_inline_it() -> None:
    """上游只吃 http(s)（如 APIMart）时，data URL 是取不到的 → 拦下并让用户先上传公网。"""
    result = await preflight.probe_reference_url(
        "data:image/png;base64,AAAA",
        label="首帧参考图",
        allow_data_url=False,
        transport=_forbidden_transport(),
    )

    assert result.reachable is False
    assert result.kind == preflight.KIND_DATA_URL
    assert "base64" in result.reason
    assert "上传" in result.how_to_fix
    assert result.to_read()["url"] == ""


@pytest.mark.asyncio
async def test_data_url_allowed_when_vendor_inlines_base64() -> None:
    """openai / volcengine 这类适配器自己解码 base64，不需要外网抓取 → 不算不可达。"""
    result = await preflight.probe_reference_url(
        "data:image/png;base64,AAAA",
        label="首帧参考图",
        allow_data_url=True,
        transport=_forbidden_transport(),
    )

    assert result.reachable is True
    assert result.kind == preflight.KIND_DATA_URL_INLINE
    assert result.to_read()["url"] == ""


@pytest.mark.asyncio
async def test_loopback_and_private_hosts_are_blocked() -> None:
    for url in (
        "http://127.0.0.1:8000/files/a.png",
        "http://localhost:8000/files/a.png",
        "http://192.168.1.9/oss/a.png",
        "http://10.0.0.5/a.png",
        "http://172.20.3.4/a.png",
    ):
        result = await preflight.probe_reference_url(url, label="参考图", transport=_forbidden_transport())
        assert result.reachable is False, url
        assert result.kind == preflight.KIND_LOOPBACK, url
        assert "本机" in result.reason or "内网" in result.reason, url


def test_is_loopback_or_private_url_keeps_public_hosts_public() -> None:
    assert preflight.is_loopback_or_private_url("https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/a.png") is False
    assert preflight.is_loopback_or_private_url("https://172.15.0.1/a.png") is False  # 172.15 不在私网段
    assert preflight.is_loopback_or_private_url("not-a-url") is False


# ---------------------------------------------------------------------------
# 2) 真探活：HEAD / 回退 GET
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_head_200_is_reachable() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.method)
        return httpx.Response(200)

    result = await preflight.probe_reference_url(OSS_URL, label="参考图", transport=httpx.MockTransport(handler))

    assert result.reachable is True
    assert result.kind == preflight.KIND_REACHABLE
    assert result.http_status == 200
    assert seen == ["HEAD"]


@pytest.mark.asyncio
async def test_head_404_falls_back_to_get_and_reports_status() -> None:
    """上游拿不到图 → 拦下，并带上真实状态码 + 修法（故障 A 的主路径）。"""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.method)
        return httpx.Response(404)

    result = await preflight.probe_reference_url(
        OSS_URL,
        label="场景「测试场地」的定版垫图",
        transport=httpx.MockTransport(handler),
    )

    assert seen == ["HEAD", "GET"]
    assert result.reachable is False
    assert result.http_status == 404
    assert "404" in result.reason
    assert "重新上传" in result.how_to_fix
    assert result.to_read()["http_status"] == 404
    assert result.to_read()["url"] == OSS_URL


@pytest.mark.asyncio
async def test_head_403_but_get_200_counts_as_reachable() -> None:
    """有些存储/网关对 HEAD 返回 403，但匿名 GET 是 200：只信 HEAD 会误杀。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            return httpx.Response(403)
        return httpx.Response(206)

    result = await preflight.probe_reference_url(OSS_URL, label="参考图", transport=httpx.MockTransport(handler))

    assert result.reachable is True
    assert result.method == "GET"
    assert result.http_status == 206


@pytest.mark.asyncio
async def test_head_405_but_get_200_counts_as_reachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(405) if request.method == "HEAD" else httpx.Response(200)

    result = await preflight.probe_reference_url(OSS_URL, label="参考图", transport=httpx.MockTransport(handler))

    assert result.reachable is True


@pytest.mark.asyncio
async def test_anonymous_headers_only_and_redirects_followed() -> None:
    """探活必须匿名（不带任何凭据），并且跟随重定向（上游也会跟）。"""
    seen: list[tuple[str, dict[str, str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((str(request.url), dict(request.headers)))
        if request.url.path.endswith("/old.png"):
            return httpx.Response(302, headers={"Location": "https://cdn.example.com/new.png"})
        return httpx.Response(200)

    result = await preflight.probe_reference_url(
        "https://oss.example.com/old.png",
        label="参考图",
        transport=httpx.MockTransport(handler),
    )

    assert result.reachable is True
    assert [url for url, _ in seen] == ["https://oss.example.com/old.png", "https://cdn.example.com/new.png"]
    for _url, headers in seen:
        assert "authorization" not in {key.lower() for key in headers}
        assert "cookie" not in {key.lower() for key in headers}
        assert headers["user-agent"] == preflight.PROBE_USER_AGENT


@pytest.mark.asyncio
async def test_transport_error_is_reported_as_unverified() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    result = await preflight.probe_reference_url(OSS_URL, label="参考图", transport=httpx.MockTransport(handler))

    assert result.reachable is False
    assert result.http_status is None
    assert "没有完成" in result.reason
    assert result.how_to_fix


@pytest.mark.asyncio
async def test_dry_run_network_guard_is_not_reported_as_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    """演练模式的出站兜底会抛 DryRunBlocked：那是「未探活」，不是「不可达」。"""

    def _blocked(*_args, **_kwargs):
        raise DryRunBlocked("DRY_RUN 下禁止出站", outlet="oss")

    monkeypatch.setattr(httpx.AsyncClient, "request", _blocked)

    result = await preflight.probe_reference_url(OSS_URL, label="参考图")

    assert result.reachable is True
    assert result.kind == preflight.KIND_DRY_RUN_SKIPPED
    assert "演练" in result.reason


# ---------------------------------------------------------------------------
# 3) 报告与结构化错误：不提交、不花钱、不泄漏内部标识
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preflight_references_report_shape() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200) if request.url.path.endswith("ok.png") else httpx.Response(410)

    report = await preflight.preflight_references(
        [
            preflight.ReferenceCandidate(label="角色「林晓」的定版垫图", url="https://cdn.example.com/ok.png"),
            preflight.ReferenceCandidate(label="场景「会议室」的定版垫图", url="https://cdn.example.com/gone.png"),
            preflight.ReferenceCandidate(label="没有垫图", url=""),
        ],
        transport=httpx.MockTransport(handler),
    )

    assert report.checked == 2  # 空引用不算"检查过"
    assert report.reachable_count == 1
    assert report.blocked is True
    read = report.to_read()
    assert read["checked_count"] == 2
    assert read["unreachable_count"] == 1
    assert read["paid_call_made"] is False
    assert read["unreachable"][0]["asset"] == "场景「会议室」的定版垫图"
    assert read["unreachable"][0]["http_status"] == 410
    assert read["unreachable"][0]["how_to_fix"]


@pytest.mark.asyncio
async def test_preflight_or_raise_blocks_with_structured_chinese_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with pytest.raises(preflight.ReferencePreflightBlocked) as exc_info:
        await preflight.preflight_or_raise(
            [
                preflight.ReferenceCandidate(
                    label="道具「玉佩」的定版垫图",
                    url="https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/test_scene.png",
                )
            ],
            transport=httpx.MockTransport(handler),
            hint="出图提交",
        )

    exc = exc_info.value
    assert isinstance(exc, HTTPException)
    assert exc.status_code == 409
    detail = exc.detail
    assert detail["code"] == preflight.UNREACHABLE_ERROR_CODE
    assert detail["paid_call_made"] is False
    assert detail["unreachable_count"] == 1
    assert "没有提交" in detail["message"]
    assert "404" in detail["unreachable"][0]["reason"]
    assert "重新上传" in detail["how_to_fix"]
    assert detail["hint"] == "出图提交"
    # 页面文案里不许出现内部标识
    text = str(detail)
    assert "file_id" not in text
    assert "/Users/" not in text


@pytest.mark.asyncio
async def test_preflight_does_not_raise_when_everything_is_reachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200)

    report = await preflight.preflight_or_raise(
        [preflight.ReferenceCandidate(label="参考图", url="https://cdn.example.com/a.png")],
        transport=httpx.MockTransport(handler),
    )

    assert report.blocked is False
    assert report.checked == 1


@pytest.mark.asyncio
async def test_preflight_skips_empty_reference_without_request() -> None:
    report = await preflight.preflight_references(
        [preflight.ReferenceCandidate(label="没有垫图", url="   ")],
        transport=_forbidden_transport(),
    )

    assert report.blocked is False
    assert report.checked == 0


def test_probe_defaults_are_bounded() -> None:
    """探活必须有超时上限，不能比一次真实提交还慢。"""
    assert 0 < preflight.PROBE_TIMEOUT_SECONDS <= 10
    assert preflight.PROBE_METHODS == ("HEAD", "GET")
    assert preflight.BLOCKED_STATUS_CODE == 409
