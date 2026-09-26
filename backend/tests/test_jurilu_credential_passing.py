"""巨日禄抓取的**凭证传递口径**测试。

背景（真实踩过）：用户从浏览器复制的「完整 Cookie」**第一项就叫 `Authorization=<jwt>`**。
它是 Cookie 里的一项，只能整串放进 `Cookie:` 请求头，**不能**被拆出来当成 HTTP `Authorization:` 头。
上一轮真实验收因为把 jwt 同时填进了 Authorization 框（授权方式=自动 → 解析成 raw）而拿到上游 401。

这组用例把口径钉死：
1. 完整 Cookie 只出现在 `Cookie` 头里，且原样（分号、`Authorization=` 项都在）；
2. 授权方式 `none`（「不发送，仅 Cookie」）时不加 `Authorization` 头；
3. Authorization 框为空时**不读**任何配置兜底值（否则会凭空多一个头）；
4. 授权方式 `bearer` 时才加 `Authorization: Bearer …`；
5. 401 的错误结果里带脱敏诊断（阶段/状态/是否带 Cookie/是否带 Authorization/授权模式），不含凭证内容。
"""

from __future__ import annotations

import urllib.error
import urllib.request

from app.services.external import jurilu_agent_import as jurilu

COOKIE = "Authorization=abc.def.ghi; ph_phc_demo=1; other=2"
URL = "https://video.jurilu.com/project_management/project_page/snippets/material_list?projectId=163260&clipId=3277394"


class _Captured(Exception):
    """捕获请求头后中断真实网络调用。"""

    def __init__(self, request: urllib.request.Request) -> None:
        self.request = request
        super().__init__("captured")


class _FakeHeaders:
    def get(self, key, default=""):  # noqa: ANN001, ANN202
        return "application/json" if key.lower() == "content-type" else default


class _FakeResponse:
    """最小可用的 urlopen 返回值：让两步流程走完而完全不出网。"""

    def __init__(self, body: str, status: int = 200) -> None:
        self._body = body.encode("utf-8")
        self.status = status
        self.headers = _FakeHeaders()

    def read(self) -> bytes:
        return self._body

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, *args):  # noqa: ANN002, ANN204
        return False


def _capture(monkeypatch) -> list[urllib.request.Request]:
    seen: list[urllib.request.Request] = []

    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        seen.append(request)
        raise _Captured(request)

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", fake_urlopen)
    return seen


def _headers(request: urllib.request.Request) -> dict[str, str]:
    return {str(k).lower(): str(v) for k, v in request.header_items()}


def test_full_cookie_only_goes_to_cookie_header(monkeypatch) -> None:
    """完整 Cookie（含 Authorization= 项）原样走 Cookie 头；授权方式 none 时不加 Authorization 头。"""
    seen = _capture(monkeypatch)
    # 与页面一致：先按授权方式解析（none = 不发送，仅 Cookie），再带 headers 抓取
    resolved, mode = jurilu.resolve_authorization("", "none")
    assert (resolved, mode) == ("", "none")
    result = jurilu.fetch_agent_platform_with_cookie(URL, COOKIE, authorization=resolved, referer=URL)
    assert result["ok"] is False  # 被捕获中断
    assert len(seen) == 1
    headers = _headers(seen[0])
    assert headers.get("cookie") == COOKIE, "整串 Cookie 必须原样放在 Cookie 头"
    assert "authorization" not in headers, "用户名没填 Authorization 框时不该出现 Authorization 头"
    assert "Authorization=" in headers["cookie"], "Cookie 里的 Authorization= 项必须原样保留"
    assert headers.get("referer") == URL


def test_authorization_box_is_ignored_when_mode_none(monkeypatch) -> None:
    """授权方式 = 不发送（仅 Cookie）：即使 Authorization 框里有值也不发头。"""
    seen = _capture(monkeypatch)
    resolved, mode = jurilu.resolve_authorization("abc.def", "none")
    assert (resolved, mode) == ("", "none")
    jurilu.fetch_agent_platform_with_cookie(URL, COOKIE, authorization=resolved)
    headers = _headers(seen[0])
    assert "authorization" not in headers
    assert headers["cookie"] == COOKIE


def test_mode_none_never_uses_configured_fallback(monkeypatch) -> None:
    """授权方式 = 不发送（仅 Cookie）：即使配置里有 Authorization 兜底值也不能发头。"""
    monkeypatch.setattr(jurilu, "get_configured_authorization", lambda: "configured.token.value")
    resolved, mode = jurilu.resolve_authorization("", "none")
    assert (resolved, mode) == ("", "none"), "mode=none 必须直接返回空，不读配置兜底"
    seen = _capture(monkeypatch)
    jurilu.fetch_agent_platform_with_cookie(URL, COOKIE, authorization=resolved)
    headers = _headers(seen[0])
    assert "authorization" not in headers
    assert headers["cookie"] == COOKIE


def test_bearer_mode_prefixes_authorization_header(monkeypatch) -> None:
    """只有显式选择 bearer 时才加 Authorization 头，并补 Bearer 前缀。"""
    seen = _capture(monkeypatch)
    resolved, mode = jurilu.resolve_authorization("abc.def", "bearer")
    assert mode == "bearer"
    jurilu.fetch_agent_platform_with_cookie(URL, COOKIE, authorization=resolved)
    headers = _headers(seen[0])
    assert headers.get("authorization") == "Bearer abc.def"
    assert headers["cookie"] == COOKIE


def test_cookie_like_authorization_value_is_rejected() -> None:
    """Authorization 框被粘进**整串 Cookie** 时：忽略该值，只走 Cookie 头（用户口径）。"""
    resolved, mode = jurilu.resolve_authorization("Authorization=abc.def; ph_phc_demo=1", "auto")
    assert (resolved, mode) == ("", "ignored_full_cookie")
    resolved2, mode2 = jurilu.resolve_authorization("a=1; b=2", "raw")
    assert (resolved2, mode2) == ("", "ignored_full_cookie")
    assert jurilu.looks_like_full_cookie("Authorization=abc") is True
    assert jurilu.looks_like_full_cookie("abc.def.ghi") is False


def test_unknown_auth_mode_does_not_silently_send_raw() -> None:
    """未知授权模式（含中文标签写错）不得静默按 auto 原样发送。"""
    resolved, mode = jurilu.resolve_authorization("abc.def", "仅Cookie")
    assert (resolved, mode) == ("", "none"), "中文「仅Cookie」应映射成 none"
    resolved2, mode2 = jurilu.resolve_authorization("abc.def", "whatever")
    assert resolved2 == "", "未知模式必须 fail-safe 成不发送"
    assert mode2.startswith("unknown:")


def test_401_diagnostics_are_redacted(monkeypatch) -> None:
    """401 结果带脱敏诊断：只有布尔与状态，不含 Cookie / Authorization 内容。"""

    def raise_401(request, timeout=None):  # noqa: ANN001, ANN202
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", raise_401)
    result = jurilu.fetch_agent_platform_with_cookie(URL, COOKIE, authorization="")
    assert result["ok"] is False
    assert result["status"] == 401
    assert result["error_type"] == "cookie 失效"
    assert result["has_cookie"] is True
    assert result["has_auth"] is False
    assert result["has_referer"] is False
    # 任何字段都不能回显凭证内容
    blob = repr(result)
    assert "abc.def.ghi" not in blob
    assert "ph_phc_demo" not in blob


def test_error_result_reports_request_header_shape_only(monkeypatch) -> None:
    """401 时要能报出「请求头形状」：只有头名与布尔，绝无头值。

    对应用户要求的脱敏信息：请求头名称 / 是否带 Cookie /
    Cookie 里是否有名为 Authorization 的项 / 是否错发了 HTTP Authorization 头。
    """
    _capture(monkeypatch)
    # 仅 Cookie（授权方式 none，Authorization 框为空）
    only_cookie = jurilu.fetch_agent_platform_with_cookie(URL, COOKIE, authorization="")
    facts = only_cookie["request_facts"]
    assert facts["request_header_names"] == [
        "accept", "accept-encoding", "cookie", "origin", "user-agent",
    ]
    assert facts["sent_cookie_header"] is True
    assert facts["sent_authorization_header"] is False
    assert facts["cookie_has_authorization_item"] is True

    # 额外带 Authorization 时也要如实标出来
    with_auth = jurilu.fetch_agent_platform_with_cookie(URL, COOKIE, authorization="abc.def")
    facts2 = with_auth["request_facts"]
    assert facts2["sent_authorization_header"] is True
    assert "authorization" in facts2["request_header_names"]

    # 没有 Authorization 项的普通 Cookie
    plain = jurilu.fetch_agent_platform_with_cookie(URL, "a=1; b=2", authorization="")
    assert plain["request_facts"]["cookie_has_authorization_item"] is False

    # 头值一个字都不能出现
    for payload in (only_cookie, with_auth, plain):
        blob = repr(payload)
        assert "abc.def.ghi" not in blob
        assert "ph_phc_demo" not in blob


def test_storyboards_diagnostics_carry_request_facts(monkeypatch) -> None:
    """两步抓取失败时，diagnostics 里要带上第一步的请求头形状。"""

    def raise_401(request, timeout=None):  # noqa: ANN001, ANN202
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", raise_401)
    result = jurilu.fetch_all_storyboards(
        source_url=URL, cookie_text=COOKIE, authorization="", referer=URL,
    )
    assert result["ok"] is False
    diag = result["diagnostics"]
    assert diag["script_status"] == 401
    facts = diag["script_request_facts"]
    assert facts["sent_cookie_header"] is True
    assert facts["sent_authorization_header"] is False
    assert facts["cookie_has_authorization_item"] is True
    assert "referer" in facts["request_header_names"]
    assert "abc.def.ghi" not in repr(diag)


def test_fetch_entries_flattens_request_shape_into_diagnostics(monkeypatch) -> None:
    """服务层要把请求头形状摊平成前端可直接渲染的脱敏字段。"""
    import pytest

    from app.services.external import jurilu_import_service as service

    def raise_401(request, timeout=None):  # noqa: ANN001, ANN202
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", raise_401)
    with pytest.raises(service.JuriluImportError) as excinfo:
        service.fetch_entries(url=URL, cookie=COOKIE, auth_mode="none", referer="")
    diag = excinfo.value.diagnostics
    assert diag["has_cookie"] is True
    assert diag["has_auth"] is False
    assert diag["has_referer"] is False
    assert diag["sent_cookie_header"] is True
    assert diag["sent_authorization_header"] is False
    assert diag["cookie_has_authorization_item"] is True
    assert "cookie" in diag["request_header_names"]
    assert "abc.def.ghi" not in repr(diag)


def test_storyboard_attempts_are_recorded_when_zero_records(monkeypatch) -> None:
    """第一步 200、第二步解析出 0 条时，必须留下可诊断的证据。

    真实踩过：getScriptPage 返回 200 并拿到 3 个 scriptId，但三个
    getStoryboardPage 全部解析出 0 条，只看汇总根本分不清是「401」还是
    「返回体结构变了」——没有状态码和响应片段就只能猜。
    """
    bodies = {
        "getScriptPage": '{"code":0,"data":{"records":[{"id":2936083,"title":"第1集"}]}}',
        "getStoryboardPage": '{"code":401,"msg":"token invalid","data":null}',
    }

    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        url = request.full_url
        for key, body in bodies.items():
            if key in url:
                return _FakeResponse(body)
        return _FakeResponse("{}")

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", fake_urlopen)
    result = jurilu.fetch_all_storyboards(
        source_url=URL, cookie_text=COOKIE, authorization="", referer=URL,
    )
    assert result["ok"] is False, "解析不出分镜就不能算成功"
    diag = result["diagnostics"]
    assert diag["script_status"] == 200
    assert diag["script_records_count"] == 1
    attempts = diag["storyboard_attempts"]
    assert len(attempts) == 1
    assert attempts[0]["script_id"] == "2936083"
    assert attempts[0]["status"] == 200
    assert "token invalid" in attempts[0]["body_preview"]
    # 仍然不许回显凭证
    assert "abc.def.ghi" not in repr(diag)


def test_storyboard_attempts_record_http_error_status(monkeypatch) -> None:
    """第二步直接 HTTP 断言时，状态码要如实写进证据里。"""

    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        url = request.full_url
        if "getScriptPage" in url:
            return _FakeResponse('{"code":0,"data":{"records":[{"id":7,"title":"T"}]}}')
        raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", fake_urlopen)
    result = jurilu.fetch_all_storyboards(
        source_url=URL, cookie_text=COOKIE, authorization="", referer=URL,
    )
    attempts = result["diagnostics"]["storyboard_attempts"]
    assert attempts[0]["status"] == 401
    assert attempts[0]["error"] == "HTTP 401"
    assert any("分镜接口失败" in w for w in result["warnings"])


def test_gateway_error_logs_redacted_diagnostics(caplog) -> None:
    """失败诊断要落服务端日志（排查第二步 0 条只能靠它），但绝不含凭证值。"""
    import json
    import logging as _logging

    from app.api.v1.routes.studio import jurilu_import as route
    from app.services.external import jurilu_import_service as service

    exc = service.JuriluImportError(
        "分镜导入失败（未解析到分镜，或接口拒绝）",
        diagnostics={
            "getScriptPage_url": "https://video.jurilu.com/api/video/v1/video-script/getScriptPage",
            "script_status": 200,
            "request_header_names": ["cookie", "referer"],
            "sent_cookie_header": True,
            "sent_authorization_header": False,
            "cookie_has_authorization_item": True,
            "storyboard_attempts": [{"script_id": "1", "status": 401, "error": "HTTP 401"}],
        },
        warnings=["scriptId=1 分镜接口失败: HTTP 401"],
    )
    with caplog.at_level(_logging.WARNING, logger="app.api.v1.routes.studio.jurilu_import"):
        resp = route._gateway_error(exc)

    assert resp.status_code == 502
    payload = json.loads(resp.body.decode("utf-8"))
    assert payload["meta"]["diagnostics"]["script_status"] == 200
    assert payload["meta"]["warnings"] == ["scriptId=1 分镜接口失败: HTTP 401"]

    logged = caplog.text
    assert "jurilu 导入失败" in logged
    assert "storyboard_attempts" in logged and "HTTP 401" in logged
    # 日志里不许出现任何凭证片段
    assert "abc.def.ghi" not in logged
    assert "ph_phc" not in logged
