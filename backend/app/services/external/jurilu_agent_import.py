"""巨日禄 分镜提示词导入 — 独立模块。

两步流程:
  1. GET getScriptPage → 获取 scriptId 列表（普通 JSON：``data.records``）
  2. POST getStoryboardPage/{page}/{size} → 获取每条分镜的 prompt
     **注意（2026-09-20 真实验收踩到）**：第二步的记录是 **msgpack** 序列化后
     base64 塞在 ``data.payload``（``data.enc == "msgpack"``），不是 ``data.records``。
     只认 JSON 的解析器会「解析出 0 条」，看着像接口拒绝，其实是有数据没识别。
     解码用同目录的 ``msgpack_lite``（纯标准库，零第三方依赖）。

不 import Streamlit，不 import db，不写文件，不保存 Cookie / Authorization。
"""

from __future__ import annotations

import base64
import html as _html
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlparse

from app.services.external import msgpack_lite

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

JURILU_AGENT_PLATFORM_NAME = "巨日禄"

DEFAULT_JURILU_AGENT_LIST_URL = (
    "https://video.jurilu.com/project_management/project_page/snippets/material_list"
)

_SCRIPT_PAGE_PATH = "/api/video/v1/video-script/getScriptPage"
_STORYBOARD_PAGE_PATH = "/api/video/v1/video-storyboard/getStoryboardPage"
_DEFAULT_PAGE_SIZE = 10
_DEFAULT_STORYBOARD_SIZE = 100

#: 翻页安全上限：接口自报总数 / 短页 / 空页都能正常收尾，这个只是防死循环。
_MAX_STORYBOARD_PAGES = 200

# 上游 ``data.enc`` 里认识的编码（不认识的只如实报出来，绝不猜）
SUPPORTED_PAYLOAD_ENCODINGS = frozenset({"msgpack", "msgpack5"})

_COOKIE_ENV_KEY = "JURILU_COOKIE"
_URL_ENV_KEY = "JURILU_AGENT_LIST_URL"
_AUTH_ENV_KEY = "JURILU_AUTHORIZATION"

# ---------------------------------------------------------------------------
# Cookie / Authorization / URL
# ---------------------------------------------------------------------------


def get_configured_cookie() -> str:
    return str(os.environ.get(_COOKIE_ENV_KEY, "")).strip()


def get_configured_authorization() -> str:
    return str(os.environ.get(_AUTH_ENV_KEY, "")).strip()


def get_configured_agent_list_url() -> str:
    value = str(os.environ.get(_URL_ENV_KEY, "")).strip()
    return value or DEFAULT_JURILU_AGENT_LIST_URL


def resolve_cookie(input_cookie: str = "") -> str:
    if input_cookie and input_cookie.strip():
        return input_cookie.strip()
    return get_configured_cookie()


#: 页面上的中文标签 → 内部模式（用户/旧前端可能直接传中文，静默降级成 auto 是最危险的坑）。
_AUTH_MODE_LABELS: dict[str, str] = {
    "自动": "auto",
    "不发送": "none",
    "不发送（仅 cookie）": "none",
    "不发送(仅 cookie)": "none",
    "仅cookie": "none",
    "仅 cookie": "none",
    "原样发送": "raw",
    "bearer": "bearer",
    "bearer 发送": "bearer",
}


def looks_like_full_cookie(value: str) -> bool:
    """判断一个值是不是**整串浏览器 Cookie**（而不是单个 Authorization 值）。

    为什么必须拦：用户从浏览器复制的「完整 Cookie」第一项就叫 ``Authorization=<jwt>``，
    整串里必然带分号分隔的其它 Cookie。把它当 HTTP ``Authorization`` 头发出去，
    上游只会回 401（真实踩过）。这种情况一律忽略该值，只用 ``Cookie`` 头。
    """
    text = str(value or "").strip()
    if not text:
        return False
    return text.startswith("Authorization=") or ";" in text or "\n" in text


def resolve_authorization(input_auth: str = "", mode: str = "auto") -> Tuple[str, str]:
    """解析本次要发送的 Authorization 值。

    返回 ``(值, 模式说明)``；模式说明会进 diagnostics（``auth_header_mode``），
    额外情况（整串 Cookie 被忽略、未知模式）用 ``auth_note`` 形式一并返回给调用方记录。
    """
    raw_mode = str(mode or "auto").strip()
    normalized = _AUTH_MODE_LABELS.get(raw_mode.lower(), raw_mode.lower())
    if normalized not in ("none", "raw", "bearer", "auto"):
        # 未知取值：**不**静默按 auto 原样发送，退回「不发送」并说明（fail-safe）
        return "", f"unknown:{raw_mode or 'empty'}"
    mode = normalized
    if mode == "none":
        return "", "none"
    auth = (input_auth or "").strip()
    if not auth:
        # auto 不再读环境兜底（那颗雷会凭空加一个 Authorization 头）；只有显式 raw/bearer 才读
        if mode in ("raw", "bearer"):
            auth = get_configured_authorization()
        if not auth:
            return "", "none"
    if looks_like_full_cookie(auth):
        # 整串 Cookie：忽略 Authorization 头，只用 Cookie 头（用户口径）
        return "", "ignored_full_cookie"
    if mode == "bearer":
        if not auth.lower().startswith("bearer "):
            auth = f"Bearer {auth}"
        return auth, "bearer"
    return auth, "raw"


def resolve_agent_list_url(input_url: str = "") -> str:
    if input_url and input_url.strip():
        return input_url.strip()
    return get_configured_agent_list_url()


# ---------------------------------------------------------------------------
# URL 提取 + 请求构造
# ---------------------------------------------------------------------------


def extract_project_clip_from_url(url: str) -> Tuple[str, str]:
    parsed = urlparse(str(url or ""))
    qs = parse_qs(parsed.query)
    pid = (qs.get("projectId") or [""])[0]
    cid = (qs.get("clipId") or [""])[0]
    return pid, cid


def _api_base(source_url: str, override: str, path: str) -> str:
    if override and override.strip():
        return override.strip().rstrip("/")
    parsed = urlparse(str(source_url or "").strip())
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def build_get_script_page_request(
    source_url: str,
    api_url_override: str = "",
    page_no: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
) -> Tuple[str, str]:
    base = _api_base(source_url, api_url_override, _SCRIPT_PAGE_PATH)
    pid, cid = extract_project_clip_from_url(source_url)
    qs = urlencode({"pageNo": str(page_no), "pageSize": str(page_size),
                     "projectId": pid or "", "clipId": cid or ""})
    return (f"{base}?{qs}", "GET")


def build_storyboard_page_request(
    source_url: str,
    script_id: str,
    clip_id: str = "",
    project_id: str = "",
    api_url_override: str = "",
    page: int = 1,
    size: int = _DEFAULT_STORYBOARD_SIZE,
) -> Tuple[str, str, dict]:
    base = _api_base(source_url, api_url_override, _STORYBOARD_PAGE_PATH)
    api_url = f"{base}/{page}/{size}"
    pid, cid = extract_project_clip_from_url(source_url)
    body = {
        "scriptId": int(script_id),
        "clipId": int(clip_id or cid or "0"),
        "projectId": int(project_id or pid or "0"),
    }
    return (api_url, "POST", body)


# ---------------------------------------------------------------------------
# 脚本组（scriptId 分组）：默认不跨 scriptId 合并
# ---------------------------------------------------------------------------

# 第一步 ``getScriptPage`` 的字段名没有对外文档，真实响应里到底叫什么没人知道。
# 因此标题 / 时间一律**多候选兜底**，并把**实际命中的字段名**报出去
# （``title_source`` / ``created_source`` / ``updated_source``），下一轮就能对上真实字段；
# 一个都没命中就留空字符串 —— **不许编造时间**。
SCRIPT_ID_KEYS: Tuple[str, ...] = ("id", "scriptId", "script_id", "videoScriptId", "scriptid")
SCRIPT_TITLE_KEYS: Tuple[str, ...] = (
    "title",
    "name",
    "scriptTitle",
    "scriptName",
    "script_title",
    "episodeTitle",
    "videoScriptTitle",
)
SCRIPT_CREATED_AT_KEYS: Tuple[str, ...] = (
    "createdAt",
    "createTime",
    "created_at",
    "gmtCreate",
    "created",
    "createDate",
)
SCRIPT_UPDATED_AT_KEYS: Tuple[str, ...] = (
    "updateTime",
    "updatedAt",
    "updated_at",
    "modifyTime",
    "gmtModified",
    "lastModified",
    "updateDate",
)

# ``raw_keys`` 里连**字段名**都不该出现的键：凭证类字段名同样是线索，不该外泄。
_SENSITIVE_KEY_MARKERS: Tuple[str, ...] = (
    "cookie",
    "authorization",
    "token",
    "secret",
    "password",
    "passwd",
    "credential",
    "session",
    "sign",
    "apikey",
    "api_key",
)

# 采样记录的截断长度（只用于让用户肉眼确认「正文 / 序号 / 提示词」解析正确）
_PROMPT_HEAD_CHARS = 60
_SUMMARY_HEAD_CHARS = 40
_MAX_SAMPLE_RECORDS = 3

# 「疑似同一脚本的不同版本」的判定阈值：标题归一化后相同，或分镜正文**集合重合度**
# 达到这个比例。只在有证据时才给版本提示，证据不足一律不给（不瞎猜）。
_SAME_SCRIPT_OVERLAP_THRESHOLD = 0.5

_TITLE_NOISE_RE = re.compile(r"[\s\-_·、,，.。:：;；()（）\[\]【】<>《》\"'`]+")

# ---------------------------------------------------------------------------
# JSON / HTML 解析工具
# ---------------------------------------------------------------------------


def _safe_json_dumps(value: object, limit: int = 3000) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, indent=2)
    except TypeError:
        text = str(value)
    return text[:limit] + ("..." if len(text) > limit else "")


def _first_present_text(data: dict, keys: List[str]) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, (str, int, float)):
            text = str(value).strip()
            if text:
                return text
    return ""


def _first_present_tags(data: dict) -> List[str]:
    for key in ["tags", "labels", "tagList", "categories"]:
        value = data.get(key)
        if isinstance(value, list):
            tags = []
            for item in value:
                if isinstance(item, dict):
                    text = _first_present_text(item, ["name", "title", "label", "value"])
                else:
                    text = str(item).strip()
                if text:
                    tags.append(text)
            return tags
        if isinstance(value, str) and value.strip():
            return [part.strip() for part in re.split(r"[,，、\s]+", value) if part.strip()]
    return []


def _json_candidates_from_html(text: str) -> List[Any]:
    candidates: List[Any] = []
    source = str(text or "")
    stripped = source.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, (dict, list)):
                candidates.append(parsed)
        except json.JSONDecodeError:
            pass
    script_patterns = [
        r"<script[^>]+id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>",
        r"<script[^>]+type=[\"']application/json[\"'][^>]*>(.*?)</script>",
    ]
    for pattern in script_patterns:
        for match in re.finditer(pattern, source, flags=re.IGNORECASE | re.DOTALL):
            raw = _html.unescape(match.group(1).strip())
            if not raw:
                continue
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, (dict, list)):
                candidates.append(parsed)
    for marker in ["window.__INITIAL_STATE__", "window.__NUXT__", "window.__APOLLO_STATE__"]:
        idx = source.find(marker)
        if idx < 0:
            continue
        brace_idx = source.find("{", idx)
        if brace_idx < 0:
            continue
        depth = 0
        in_string = False
        escape = False
        end_idx = -1
        for pos in range(brace_idx, min(len(source), brace_idx + 1_500_000)):
            ch = source[pos]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end_idx = pos + 1
                    break
        if end_idx > brace_idx:
            raw = source[brace_idx:end_idx]
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, (dict, list)):
                candidates.append(parsed)
    return candidates


# ---------------------------------------------------------------------------
# 网络抓取
# ---------------------------------------------------------------------------


def fetch_agent_platform_with_cookie(
    agent_list_url: str,
    cookie_text: str,
    method: str = "GET",
    json_body: Optional[dict] = None,
    authorization: str = "",
    referer: str = "",
) -> dict:
    # 早退分支（URL 缺失 / 域名不对 / 没凭证）+ 成功 + 三类异常，共 8 个 return；
    # 拆小函数会把「头怎么拼、事实怎么取证」拆散，得不偿失。
    # pylint: disable=too-many-return-statements
    clean_url = str(agent_list_url or "").strip()
    clean_cookie = str(cookie_text or "").strip()
    clean_auth = str(authorization or "").strip()
    clean_referer = str(referer or "").strip()
    method = (method or "GET").upper()

    if not clean_url:
        return {"ok": False, "error_type": "页面结构变化", "error": "缺少请求 URL。"}

    parsed_url = urlparse(clean_url)
    if parsed_url.scheme not in {"http", "https"}:
        return {"ok": False, "error_type": "页面结构变化", "error": "URL 必须是 http(s)。"}

    host = parsed_url.netloc
    if ":" in host:
        host = host.rsplit(":", 1)[0]
    host = host.lower()
    if not (host == "jurilu.com" or host.endswith(".jurilu.com")):
        return {"ok": False, "error_type": "页面结构变化", "error": "只支持巨日禄域名。"}

    if not clean_cookie and not clean_auth:
        return {"ok": False, "error_type": "cookie 失效", "error": "请先配置 Cookie 或 Authorization。"}

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": f"{parsed_url.scheme}://{host}",
        "Accept-Encoding": "gzip, deflate",
    }
    if clean_cookie:
        headers["Cookie"] = clean_cookie
    if clean_auth:
        headers["Authorization"] = clean_auth
    if clean_referer:
        headers["Referer"] = clean_referer

    body_bytes: Optional[bytes] = None
    if method == "POST":
        headers["Content-Type"] = "application/json"
        if json_body:
            body_bytes = json.dumps(json_body, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(clean_url, data=body_bytes, headers=headers, method=method)
    facts = _request_facts(headers, clean_cookie)
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
            return {
                "ok": True, "url": clean_url, "method": method,
                "status": getattr(response, "status", 0),
                "content_type": response.headers.get("Content-Type", ""),
                "elapsed_ms": int((time.time() - started) * 1000),
                "text": body,
                "fetched_at": datetime.now().isoformat(timespec="seconds"),
                "request_facts": facts,
            }
    except urllib.error.HTTPError as exc:
        error_type = "cookie 失效" if exc.code in {401, 403} else "网络失败"
        try:
            resp_body = exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            resp_body = ""
        return _error_result(clean_url, method, exc.code, error_type, f"HTTP {exc.code}",
                             int((time.time() - started) * 1000), bool(clean_cookie),
                             bool(clean_auth), bool(clean_referer), resp_body,
                             request_facts=facts)
    except urllib.error.URLError as exc:
        return _error_result(clean_url, method, None, "网络失败",
                             f"{type(exc.reason).__name__}: {exc.reason}",
                             int((time.time() - started) * 1000), bool(clean_cookie),
                             bool(clean_auth), bool(clean_referer), "",
                             request_facts=facts)
    except Exception as exc:
        return _error_result(clean_url, method, None, "网络失败",
                             f"{type(exc).__name__}: {exc}",
                             int((time.time() - started) * 1000), bool(clean_cookie),
                             bool(clean_auth), bool(clean_referer), "",
                             request_facts=facts)


def cookie_has_authorization_item(cookie_text: str) -> bool:
    """整串 Cookie 里是否有一个**名为 Authorization** 的项。

    只回布尔值：项名可以报，项值绝不能外泄。
    """
    for part in str(cookie_text or "").split(";"):
        name = part.split("=", 1)[0].strip()
        if name.lower() == "authorization":
            return True
    return False


def _request_facts(headers: Dict[str, str], cookie_text: str) -> Dict[str, Any]:
    """真实的**请求头形状**取证：只有头名与布尔值，绝不含头值。

    401 排查时用户要的七件事（URL / 方法 / 状态 / 头名 / 是否带 Cookie /
    Cookie 里是否有 Authorization 项 / 是否错发了 HTTP Authorization 头）里，
    后三件由这里给出，前几件由调用方补齐。
    """
    names = sorted({str(key).lower() for key in headers})
    return {
        "request_header_names": names,
        "sent_cookie_header": "cookie" in names,
        "sent_authorization_header": "authorization" in names,
        "cookie_has_authorization_item": cookie_has_authorization_item(cookie_text),
    }


def _error_result(url, method, status, error_type, error, elapsed_ms,
                  has_cookie, has_auth, has_referer, response_preview="",
                  request_facts: Optional[dict] = None) -> dict:
    payload = {
        "ok": False, "url": url, "method": method, "status": status,
        "error_type": error_type, "error": error, "elapsed_ms": elapsed_ms,
        "has_cookie": has_cookie, "has_auth": has_auth, "has_referer": has_referer,
        "response_preview": _sanitize(response_preview),
    }
    if request_facts:
        # 既有嵌套形状（供两步流程/服务层取用），也摊平一份便于直接看
        payload["request_facts"] = request_facts
        payload.update(request_facts)
    return payload


def _sanitize(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"eyJ[A-Za-z0-9_-]{30,}", "<JWT>", text)
    return cleaned[:500]


# ---------------------------------------------------------------------------
# 两步导入：getScriptPage → getStoryboardPage
# ---------------------------------------------------------------------------


def _payload_total(text: str) -> Optional[int]:
    """响应里如果自报了「一共多少条」，把它读出来（读不到返回 ``None``，不猜）。

    真实形状未知，所以多候选兜底：``total`` / ``totalCount`` / ``total_count`` /
    ``recordsTotal`` / ``totalNum`` / ``count``。只在**持有 records 的那一层**里找，
    避免把某些字段的计数误当总数。
    """
    for _encoding, obj in _decoded_candidates(text):
        containers: List[dict] = []
        if isinstance(obj, dict):
            data = obj.get("data")
            if isinstance(data, dict):
                containers.append(data)
            containers.append(obj)
        for container in containers:
            if not isinstance(container.get("records"), list):
                continue
            for key in ("total", "totalCount", "total_count", "recordsTotal", "totalNum"):
                value = container.get(key)
                if isinstance(value, bool):
                    continue
                if isinstance(value, int):
                    return value
                if isinstance(value, str) and value.strip().isdigit():
                    return int(value.strip())
    return None


def _record_identity(record: dict) -> str:
    """去重用的记录标识（翻页时同一页被重复返回也不能重复计数）。"""
    for key in ("agent_id", "sbid"):
        value = str(record.get(key) or "").strip()
        if value:
            return f"{key}:{value}:{record.get('seqNum') or ''}"
    return f"raw:{record.get('raw_data') or ''}"


def fetch_script_storyboards(
    source_url: str,
    script_id: str,
    cookie_text: str,
    authorization: str = "",
    referer: str = "",
    api_url_override: str = "",
    clip_id: str = "",
    project_id: str = "",
    size: int = _DEFAULT_STORYBOARD_SIZE,
) -> dict:
    """翻页取某个 scriptId 的**全部**分镜 —— 不做任何数量截断。

    为什么必须翻页：第二步是 ``getStoryboardPage/{page}/{size}``，默认一页 100 条。
    真实三组是 41/37/31（一页够），但只要某一组超过一页，只取第一页就会**静默丢数据**，
    而「整组导入」是用户口径。翻页会多打几次免费接口，这是允许的。

    停止条件（任一命中）：
      * 响应自报总数且已取满；
      * 拿到空页；
      * 拿到的条数少于 ``size``（短页 = 最后一页，老接口没有 total 时靠这条）；
      * 某一页没有带来任何新记录（接口忽略分页参数时不能死循环）；
      * 达到安全上限 ``_MAX_STORYBOARD_PAGES``。

    Returns:
        ``{"records": [...], "pages_fetched": int, "total_reported": int|None,
           "attempts": [...], "warnings": [...], "request_facts": [...]}``
    """
    records: List[dict] = []
    seen: set = set()
    attempts: List[dict] = []
    warnings: List[str] = []
    request_facts: List[dict] = []
    pages_fetched = 0
    total_reported: Optional[int] = None
    page = 1

    while page <= _MAX_STORYBOARD_PAGES:
        try:
            sb_url, sb_method, sb_body = build_storyboard_page_request(
                source_url, script_id=script_id, clip_id=clip_id, project_id=project_id,
                api_url_override=api_url_override, page=page, size=size,
            )
        except (TypeError, ValueError) as exc:
            # scriptId 不是数字时上游 URL 都拼不出来：如实记一条，不许把整条链路炸掉
            attempts.append({
                "script_id": script_id, "page": page, "status": None,
                "error": f"无法构造分镜请求（scriptId 需为数字）：{exc}",
            })
            pages_fetched += 1
            warnings.append(f"scriptId={script_id} 无法构造分镜请求：{exc}")
            break
        sb_result = fetch_agent_platform_with_cookie(
            sb_url, cookie_text, method=sb_method, json_body=sb_body,
            authorization=authorization, referer=referer,
        )
        pages_fetched += 1
        # 逐步留证：第二步是最容易「静默 0 条」的地方，没证据就只能猜。
        # 只留状态码 / 错误串 / 脱敏后的响应片段（_sanitize 会把 JWT 换成 <JWT>）。
        attempt = {
            "script_id": script_id,
            "page": page,
            "url": sb_url,
            "status": sb_result.get("status"),
            "error": str(sb_result.get("error") or "")[:160],
            "body_preview": _sanitize(
                str(sb_result.get("text") or sb_result.get("response_preview") or "")
            )[:300],
        }
        attempts.append(attempt)
        if not sb_result.get("ok"):
            warnings.append(f"scriptId={script_id} 第 {page} 页分镜接口失败: {sb_result.get('error')}")
            request_facts.append(sb_result.get("request_facts") or {})
            break

        text = str(sb_result.get("text") or "")
        page_records = _extract_records_from_response(text)
        if total_reported is None:
            total_reported = _payload_total(text)
        fresh = _extract_storyboard_records(
            text, script_id,
            script_title="", script_index=0,
        )
        # 只保留这一页里**新增**的记录（接口忽略分页参数时不能重复计数）
        new_here: List[dict] = []
        for record in fresh:
            key = _record_identity(record)
            if key in seen:
                continue
            seen.add(key)
            new_here.append(record)
        records.extend(new_here)
        attempt["parsed_count"] = len(page_records)
        attempt["parsed_new_records"] = len(new_here)
        attempt["total_reported"] = total_reported
        if not fresh:
            # 解析出 0 条时把「响应到底长什么样」留下来：
            # 是接口真 0 条，还是有数据但解析器没识别（例如 msgpack 载荷）。
            attempt["payload_shape"] = describe_payload_shape(text)
            break
        if total_reported is not None and len(records) >= total_reported:
            break
        if len(fresh) < size:
            break
        if not new_here:
            warnings.append(
                f"scriptId={script_id} 第 {page} 页没有新增记录（疑似接口忽略分页参数），已提前停止翻页"
            )
            break
        page += 1
    else:
        warnings.append(
            f"scriptId={script_id} 翻页达到上限 {_MAX_STORYBOARD_PAGES} 页，可能仍有未取到的分镜"
        )

    return {
        "records": records,
        "pages_fetched": pages_fetched,
        "total_reported": total_reported,
        "attempts": attempts,
        "warnings": warnings,
        "request_facts": request_facts,
    }


def fetch_all_storyboards(
    source_url: str,
    cookie_text: str,
    authorization: str = "",
    referer: str = "",
    api_url_override: str = "",
    storyboard_size: int = _DEFAULT_STORYBOARD_SIZE,
) -> dict:
    """两步导入流程（第二步**逐页取全**）。

    Returns:
        {"ok": True/False, "scripts": [...], "storyboards": [...],
         "warnings": [...], "diagnostics": {...},
         "storyboard_pages": {script_id: 页数}, "storyboard_totals": {script_id: 自报总数}}
    """
    diag: Dict[str, Any] = {}
    warnings: List[str] = []

    # Step 1: getScriptPage → script IDs
    script_url, _ = build_get_script_page_request(source_url, api_url_override=api_url_override)
    diag["getScriptPage_url"] = script_url

    script_result = fetch_agent_platform_with_cookie(
        script_url, cookie_text, method="GET",
        authorization=authorization, referer=referer,
    )
    diag["script_status"] = script_result.get("status")
    diag["script_request_facts"] = script_result.get("request_facts") or {}
    if not script_result.get("ok"):
        return {"ok": False, "scripts": [], "storyboards": [],
                "warnings": [f"获取脚本列表失败: {script_result.get('error')}"],
                "diagnostics": diag}

    scripts = _extract_records_from_response(script_result.get("text", ""))
    diag["script_records_count"] = len(scripts)

    if not scripts:
        return {"ok": False, "scripts": [], "storyboards": [],
                "warnings": ["未获取到脚本记录。"],
                "diagnostics": diag}

    # Step 2: getStoryboardPage（逐页）for each script
    pid, cid = extract_project_clip_from_url(source_url)
    all_storyboards: List[dict] = []
    fetched_script_ids: List[str] = []
    sb_counts: Dict[str, int] = {}
    sb_pages: Dict[str, int] = {}
    sb_totals: Dict[str, Optional[int]] = {}

    for idx, script in enumerate(scripts, start=1):
        # 字段名多候选兜底：id 就叫 id 的假设上一轮赌对了，标题叫什么没人知道
        #（title / name / scriptTitle / scriptName …），取不到就留空，不编造。
        sid = pick_script_id(script)
        if not sid:
            continue
        fetched_script_ids.append(sid)
        script_title = pick_script_title(script)
        script_index = idx

        fetched = fetch_script_storyboards(
            source_url, script_id=sid, cookie_text=cookie_text,
            authorization=authorization, referer=referer,
            api_url_override=api_url_override, clip_id=cid, project_id=pid,
            size=storyboard_size,
        )
        diag.setdefault("storyboard_attempts", []).extend(fetched["attempts"])
        diag.setdefault("storyboard_request_facts", []).extend(fetched["request_facts"])
        diag.setdefault("storyboard_urls", []).extend(
            url for url in (attempt.get("url") for attempt in fetched["attempts"]) if url
        )
        warnings.extend(fetched["warnings"])

        sbs: List[dict] = []
        for record in fetched["records"]:
            # 标题 / 段号在这里补：翻页函数不认识第一步的脚本记录
            ep = f"EP{script_index:02d}" if script_index else ""
            sbid = str(record.get("sbid") or "")
            title_part = f"｜{script_title}" if script_title else ""
            display_name = (
                f"{ep}{title_part}｜分镜 {sbid}" if ep or title_part else f"分镜 {sbid}"
            )
            record["agent_name"] = display_name
            record["source_script_title"] = script_title
            record["source_script_index"] = script_index
            record["episode_hint"] = ep
            sbs.append(record)
        sb_counts[sid] = len(sbs)
        sb_pages[sid] = fetched["pages_fetched"]
        sb_totals[sid] = fetched["total_reported"]
        all_storyboards.extend(sbs)

    # 排序：script_index → seqNum
    all_storyboards.sort(key=lambda r: (r.get("source_script_index", 0), int(r.get("seqNum", 0) or 0)))

    diag["fetched_script_ids"] = fetched_script_ids
    diag["storyboard_page_size"] = storyboard_size
    diag["storyboard_records_count"] = len(all_storyboards)
    diag["parsed_prompts_count_by_script"] = sb_counts
    # 「整组取全」的证据：每组翻了几页、接口自报多少条
    diag["storyboard_pages_by_script"] = sb_pages
    diag["storyboard_totals_by_script"] = sb_totals

    if not all_storyboards:
        return {"ok": False, "scripts": scripts, "storyboards": [],
                "warnings": warnings + ["已获取 scriptId，但未解析到分镜。"],
                "diagnostics": diag,
                "storyboard_pages": sb_pages, "storyboard_totals": sb_totals}

    return {"ok": True, "scripts": scripts, "storyboards": all_storyboards,
            "warnings": warnings, "diagnostics": diag,
            "storyboard_pages": sb_pages, "storyboard_totals": sb_totals}


def _records_from_object(obj: Any) -> List[dict]:
    """从一个 JSON 对象里取 records[]（``data.records`` 优先，其次顶层 ``records``）。"""
    if not isinstance(obj, dict):
        return []
    data = obj.get("data")
    if isinstance(data, dict):
        recs = data.get("records")
        if isinstance(recs, list):
            return [r for r in recs if isinstance(r, dict)]
    recs = obj.get("records")
    if isinstance(recs, list):
        return [r for r in recs if isinstance(r, dict)]
    return []


def decode_encoded_payload(obj: Any) -> Tuple[Optional[str], Optional[Any]]:
    """识别 ``data.enc``/``data.payload`` 这类**编码载荷**并解码。

    返回 ``(编码名, 解码后的对象)``；不是编码载荷就返回 ``(None, None)``。

    真实形状（第二步 getStoryboardPage）::

        {"code":0,"message":"success",
         "data":{"enc":"msgpack","payload":"i6dyZWNvcmRz3AAp..."}}

    解码后是 ``{"records": [...]}``，与第一步的 JSON 形状一致。
    目前支持 ``msgpack``；未知编码**不解码也不猜**（由调用方如实报出来）。
    """
    if not isinstance(obj, dict):
        return (None, None)
    data = obj.get("data")
    if not isinstance(data, dict):
        return (None, None)
    enc = str(data.get("enc") or "").strip().lower()
    payload = data.get("payload")
    if not enc or not isinstance(payload, str) or not payload:
        return (None, None)
    if enc not in SUPPORTED_PAYLOAD_ENCODINGS:
        return (enc, None)
    try:
        # 上游的 base64 可能省略补位，补齐后再解
        raw = base64.b64decode(payload + "=" * (-len(payload) % 4))
        return (enc, msgpack_lite.loads(raw))
    except Exception:  # noqa: BLE001 —— 解不开就当没解，由 describe_payload_shape 报出来
        return (enc, None)


def _decoded_candidates(text: str) -> List[Tuple[str, Any]]:
    """把响应文本里所有「能看懂的对象」列出来：原样 JSON + 编码载荷解码后的对象。"""
    out: List[Tuple[str, Any]] = []
    for candidate in _json_candidates_from_html(text):
        if not isinstance(candidate, dict):
            continue
        out.append(("json", candidate))
        enc, decoded = decode_encoded_payload(candidate)
        if enc and decoded is not None:
            out.append((enc, decoded))
            # 有些上游会再包一层：data.payload 解出来还是 {"data": {...}}
            enc2, decoded2 = decode_encoded_payload(decoded)
            if enc2 and decoded2 is not None:
                out.append((enc2, decoded2))
    return out


def _extract_records_from_response(text: str) -> List[dict]:
    """从响应里提取 records[]：先按普通 JSON 找，再按编码载荷（msgpack）找。"""
    for _encoding, obj in _decoded_candidates(text):
        recs = _records_from_object(obj)
        if recs:
            return recs
    return []


def _record_shape(info: Dict[str, Any], encoding: str, obj: Any) -> None:
    if encoding not in info["encodings"]:
        info["encodings"].append(encoding)
    recs = _records_from_object(obj)
    if recs:
        info["record_counts"][encoding] = len(recs)
        info["record_keys"][encoding] = sorted(
            str(key) for key in recs[0].keys()
        )[:24]


def describe_payload_shape(text: str) -> dict:
    """诊断用：这次响应到底长什么样（编码 / 记录条数 / 字段名）。

    只输出**字段名与计数**，不含任何正文与凭证 —— 用于回答
    「是接口返回 0 条，还是接口有数据但解析器没识别」。
    """
    info: Dict[str, Any] = {
        "encodings": [],
        "declared_encodings": [],
        # 「不认识这种编码」与「认识但解不开」要分开：后者才是我们的 bug
        "unsupported_encodings": [],
        "decode_errors": [],
        "record_counts": {},
        "record_keys": {},
    }
    for candidate in _json_candidates_from_html(text):
        if not isinstance(candidate, dict):
            continue
        _record_shape(info, "json", candidate)
        encoding, decoded = decode_encoded_payload(candidate)
        if not encoding:
            continue
        if encoding not in info["declared_encodings"]:
            info["declared_encodings"].append(encoding)
        if decoded is None:
            # 上游说它是这种编码，但我们没解开 —— 必须如实报出来，不能装作 0 条
            bucket = (
                "decode_errors"
                if encoding in SUPPORTED_PAYLOAD_ENCODINGS
                else "unsupported_encodings"
            )
            if encoding not in info[bucket]:
                info[bucket].append(encoding)
            continue
        _record_shape(info, encoding, decoded)
        encoding2, decoded2 = decode_encoded_payload(decoded)
        if encoding2 and decoded2 is not None:
            _record_shape(info, encoding2, decoded2)
    raw = str(text or "").strip()
    info["raw_length"] = len(raw)
    info["raw_head"] = raw[:80]
    return info


def _extract_storyboard_records(
    text: str, script_id: str,
    script_title: str = "", script_index: int = 0,
) -> List[dict]:
    """从 getStoryboardPage 响应提取分镜记录并标准化。"""
    records = _extract_records_from_response(text)
    result: List[dict] = []
    for rec in records:
        prompt_text = str(rec.get("prompt", "")).strip()
        if not prompt_text:
            continue
        ep = f"EP{script_index:02d}" if script_index else ""
        sbid = str(rec.get("sbid", ""))
        title_part = f"｜{script_title}" if script_title else ""
        display_name = f"{ep}{title_part}｜分镜 {sbid}" if ep or title_part else f"分镜 {sbid}"
        result.append({
            "agent_id": str(rec.get("id", "")),
            "agent_name": display_name,
            "prompt_text": prompt_text,
            "shot_summary": str(rec.get("description", "")),
            "shot_id": str(rec.get("id", "")),
            "sbid": sbid,
            "seqNum": str(rec.get("seqNum", "")),
            "modelName": str(rec.get("modelName", "")),
            "aspectRatio": str(rec.get("aspectRatio", "")),
            "duration": str(rec.get("duration", "")),
            "resolution": str(rec.get("resolution", "")),
            "amount": str(rec.get("amount", "")),
            "originalText": str(rec.get("originalText", "")),
            "characters": rec.get("characters", ""),
            "scriptId": script_id,
            "source_script_id": script_id,
            "source_script_title": script_title,
            "source_script_index": script_index,
            "episode_hint": ep,
            "source_platform": JURILU_AGENT_PLATFORM_NAME,
            "source_url": "",
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "raw_data": _safe_json_dumps(rec),
            "parse_status": "已识别",
        })
    return result


# ---------------------------------------------------------------------------
# 脚本组：第一步记录 + 已解析分镜 → 「一个 scriptId 一组」
# ---------------------------------------------------------------------------


def _scalar_text(value: Any) -> str:
    """把标量转成去空白的字符串；bool / 容器一律当取不到（不许把 True 当时间戳）。"""
    if isinstance(value, bool):
        return ""
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    return ""


def pick_field(record: Any, keys: Tuple[str, ...]) -> Tuple[str, str]:
    """按候选键顺序取第一个非空标量，返回 ``(值, 命中的字段名)``。"""
    if not isinstance(record, dict):
        return ("", "")
    for key in keys:
        text = _scalar_text(record.get(key))
        if text:
            return (text, key)
    return ("", "")


def pick_script_id(record: Any) -> str:
    return pick_field(record, SCRIPT_ID_KEYS)[0]


def pick_script_title(record: Any) -> str:
    return pick_field(record, SCRIPT_TITLE_KEYS)[0]


def is_sensitive_key(name: Any) -> bool:
    """字段名是否属于凭证类（这类名字不进 ``raw_keys``）。"""
    lowered = str(name or "").strip().lower()
    return any(marker in lowered for marker in _SENSITIVE_KEY_MARKERS)


def record_key_names(record: Any) -> List[str]:
    """第一步记录的字段名列表 —— **只有名字，永远不含值**。"""
    if not isinstance(record, dict):
        return []
    return [str(key) for key in record if not is_sensitive_key(key)]


def _head(text: Any, limit: int) -> str:
    return str(text or "")[:limit]


def _seq_sort_key(row: dict) -> Tuple[int, int, str]:
    seq = str(row.get("seqNum") or "").strip()
    if seq.lstrip("-").isdigit():
        return (0, int(seq), "")
    return (1, 0, seq)


def _script_metrics(rows: List[dict]) -> Dict[str, Any]:
    """用**该组已解析出来的分镜**算条数与序号范围（不拿接口声称的数字顶替）。"""
    seq_field = ""
    if any(str(row.get("seqNum") or "").strip() for row in rows):
        seq_field = "seqNum"
    elif any(str(row.get("sbid") or "").strip() for row in rows):
        seq_field = "sbid"
    values = [str(row.get(seq_field) or "").strip() for row in rows] if seq_field else []
    values = [value for value in values if value]
    seq_min = seq_max = ""
    if values:
        if all(value.lstrip("-").isdigit() for value in values):
            seq_min = min(values, key=int)
            seq_max = max(values, key=int)
        else:
            seq_min, seq_max = min(values), max(values)
    return {
        "record_count": len(rows),
        "seq_min": seq_min,
        "seq_max": seq_max,
        "seq_field": seq_field,
    }


def _sample_records(rows: List[dict]) -> List[dict]:
    """最多 3 条采样：让用户肉眼确认正文 / 序号 / 提示词解析正确。

    ``prompt_head`` 只截前 60 字，``summary_head`` 只截前 40 字。
    """
    samples: List[dict] = []
    for row in sorted(rows, key=_seq_sort_key)[:_MAX_SAMPLE_RECORDS]:
        prompt = str(row.get("prompt_text") or "")
        samples.append({
            "seq": str(row.get("seqNum") or ""),
            "sbid": str(row.get("sbid") or ""),
            "prompt_head": _head(prompt, _PROMPT_HEAD_CHARS),
            "prompt_length": len(prompt),
            "summary_head": _head(row.get("shot_summary"), _SUMMARY_HEAD_CHARS),
        })
    return samples


def build_script_groups(
    scripts: Optional[List[dict]],
    storyboards: Optional[List[dict]],
    pages_by_script: Optional[Dict[str, int]] = None,
) -> List[dict]:
    """按 scriptId 分组成「脚本组」：**永远一组一条，默认不合并**。

    用户口径（2026-09-20）：一次「获取整集提示词」抓到的多个 scriptId 是
    **不同的脚本**（或同一脚本的不同版本），第二步返回的分镜条数（41 / 37 / 31）
    不能当成同一集的连续镜头。所以这里按 scriptId 切组，
    条数 / 序号范围只用**该组已解析出来的分镜**计算（**不截断**）。

    Args:
        pages_by_script: 每组实际翻了几页（``fetch_all_storyboards`` 的取证），
            原样写进 ``pages_fetched``，让「整组取全」这件事可核对。

    Returns:
        每组一条，字段见契约：``script_id`` / ``title`` / ``title_source`` /
        ``created_at`` / ``updated_at`` / ``record_count`` / ``seq_min`` / ``seq_max`` /
        ``seq_field`` / ``pages_fetched`` / ``sample_records`` / ``raw_keys`` /
        ``facts`` / ``likely_newest`` / ``version_reasons`` / ``version_hint``。
    """
    pages_by_script = pages_by_script or {}
    groups: List[dict] = []
    seen: Dict[str, int] = {}
    rows_by_sid: Dict[str, List[dict]] = {}
    for row in storyboards or []:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("source_script_id") or "").strip()
        if sid:
            rows_by_sid.setdefault(sid, []).append(row)

    def _append(sid: str, record: Any, title_fallback: str = "") -> None:
        record = record if isinstance(record, dict) else {}
        title, title_source = pick_field(record, SCRIPT_TITLE_KEYS)
        if not title and title_fallback:
            # 标题来自分镜记录的 source_script_title（第一步没列这个 scriptId 时的兜底）；
            # 此时 title_source 留空，避免谎报命中字段。
            title = title_fallback
        created, created_source = pick_field(record, SCRIPT_CREATED_AT_KEYS)
        updated, updated_source = pick_field(record, SCRIPT_UPDATED_AT_KEYS)
        rows = rows_by_sid.get(sid, [])
        metrics = _script_metrics(rows)
        groups.append({
            "script_id": sid,
            "title": title,
            "title_source": title_source,
            "created_at": created,
            "created_source": created_source,
            "updated_at": updated,
            "updated_source": updated_source,
            **metrics,
            "pages_fetched": int(pages_by_script.get(sid, 0) or 0),
            "sample_records": _sample_records(rows),
            "raw_keys": record_key_names(record),
            "facts": [],
            "likely_newest": False,
            "version_reasons": [],
            "version_hint": "",
        })

    for script in scripts or []:
        if not isinstance(script, dict):
            continue
        sid = pick_script_id(script)
        if not sid or sid in seen:
            continue
        seen[sid] = len(groups)
        _append(sid, script)

    # 第一步没列出来、但第二步确实返回了分镜的 scriptId 也要成组：**不丢数据**。
    for sid in sorted(rows_by_sid):
        if sid in seen:
            continue
        seen[sid] = len(groups)
        fallback = ""
        for row in rows_by_sid[sid]:
            fallback = str(row.get("source_script_title") or "").strip()
            if fallback:
                break
        _append(sid, {}, title_fallback=fallback)

    annotate_script_versions(groups, storyboards)
    return groups


def _parse_timestamp(value: str) -> Optional[datetime]:
    """把上游时间戳解析成 ``datetime`` 以便比较；解析不了返回 ``None``。

    支持 ``2026-09-19 10:00:00`` / ISO（含 ``T`` 与 ``Z``）/ 纯数字（秒或毫秒）。
    带时区的值统一去掉时区后按**字面量**比较 —— 同一接口返回，格式一致。
    """
    text = str(value or "").strip()
    if not text:
        return None
    if text.isdigit():
        number = int(text)
        if number > 10 ** 12:  # 毫秒
            number //= 1000
        try:
            return datetime.fromtimestamp(number)
        except (OverflowError, OSError, ValueError):
            return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00").replace("/", "-"))
    except ValueError:
        parsed = None
    if parsed is None:
        for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y%m%d%H%M%S"):
            try:
                parsed = datetime.strptime(text, pattern)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    return parsed.replace(tzinfo=None)


def _normalize_title(title: Any) -> str:
    """标题归一化：去空白与常见标点后小写（「第 1 集」== 「第1集」）。"""
    return _TITLE_NOISE_RE.sub("", str(title or "").strip().lower())


def _prompt_signatures(storyboards: Optional[List[dict]]) -> Dict[str, set]:
    signatures: Dict[str, set] = {}
    for row in storyboards or []:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("source_script_id") or "").strip()
        prompt = str(row.get("prompt_text") or "").strip()
        if sid and prompt:
            signatures.setdefault(sid, set()).add(prompt)
    return signatures


def _pair_evidence(left: dict, right: dict, sigs: Dict[str, set]) -> List[Dict[str, Any]]:
    """两组之间**指向同一脚本**的可复核证据；没有证据就返回空列表。

    只返回事实本身（标题 / 重合度），**不带对方 id** —— id 要由调用方按
    「站在哪一组的角度」补上（否则会写成「与 2933351 标题相同」出现在 2933351 自己身上）。
    """
    evidence: List[Dict[str, Any]] = []
    left_title = str(left.get("title") or "").strip()
    right_title = str(right.get("title") or "").strip()
    normalized = _normalize_title(left_title)
    if normalized and normalized == _normalize_title(right_title):
        evidence.append({
            "kind": "title",
            "left_title": left_title,
            "right_title": right_title,
            "normalized": normalized,
        })
    left_sig = sigs.get(left["script_id"], set())
    right_sig = sigs.get(right["script_id"], set())
    if left_sig and right_sig:
        intersection = len(left_sig & right_sig)
        union = len(left_sig | right_sig)
        if union:
            overlap = intersection / union
            if overlap >= _SAME_SCRIPT_OVERLAP_THRESHOLD:
                evidence.append({
                    "kind": "overlap",
                    "percent": int(round(overlap * 100)),
                    "intersection": intersection,
                    "union": union,
                })
    return evidence


def _format_evidence(item: Dict[str, Any], other_id: str) -> str:
    """把一条事实写成「站在本组角度」的中文依据（可复核：带具体数字）。"""
    if item["kind"] == "title":
        if item["left_title"] == item["right_title"]:
            return f"与 {other_id} 标题归一化后相同（{item['left_title']}）"
        return (
            f"与 {other_id} 标题归一化后相同"
            f"（「{item['left_title']}」/「{item['right_title']}」）"
        )
    return (
        f"与 {other_id} 分镜正文重合度 {item['percent']}%"
        f"（{item['intersection']} 条完全相同 / 合计 {item['union']} 条）"
    )


def _compact_evidence(item: Dict[str, Any]) -> str:
    """同一事实的短句版（给 ``version_hint`` 用，读起来像一句话）。"""
    if item["kind"] == "title":
        return "标题相同"
    return f"内容重合度 {item['percent']}%"


def _baseline_facts(group: Dict[str, Any]) -> List[str]:
    """每组的**客观事实**（与版本判断无关，也可单独渲染）。"""
    facts = [f"记录数 {group.get('record_count', 0)}"]
    if group.get("seq_field"):
        facts.append(
            f"巨日禄序号范围 {group.get('seq_min')}–{group.get('seq_max')}"
            f"（字段 {group.get('seq_field')}）"
        )
    if group.get("pages_fetched"):
        facts.append(f"分镜接口共取 {group['pages_fetched']} 页（整组取全，未截断）")
    if group.get("updated_at"):
        facts.append(
            f"更新时间 {group.get('updated_source') or 'updatedAt'}={group['updated_at']}"
        )
    if group.get("created_at"):
        facts.append(
            f"创建时间 {group.get('created_source') or 'createdAt'}={group['created_at']}"
        )
    if not group.get("updated_at") and not group.get("created_at"):
        facts.append("未取到创建 / 更新时间字段（无时间戳，无法判断先后）")
    return facts


def _timestamp_decision(
    members: List[int], groups: List[dict]
) -> Tuple[Optional[int], str, str]:
    """只在**真实拿到可比较的时间戳**时判断先后。

    用户口径（2026-09-21）：「没有可靠时间证据时不要标记『最新版本』，只能陈述客观信息。」
    因此这里**不再**用「scriptId 更大所以更新」这类推测；判不出来就返回
    ``(None, "", 原因)``，由调用方改成中立陈述。

    判定要求（全部满足才给出结论）：
      * 每一个成员组都有可解析的时间戳（拿不到就没有可比性）；
      * 最大时间戳**不并列**（并列 = 分不出先后）。

    Returns:
        ``(最晚的那一组下标 或 None, 判定依据, 判不出来的原因)``
    """
    timed: List[Tuple[int, datetime, str, str]] = []
    for index in members:
        group = groups[index]
        stamp = str(group.get("updated_at") or "").strip()
        field = str(group.get("updated_source") or "") or "updated_at"
        if not stamp:
            stamp = str(group.get("created_at") or "").strip()
            field = str(group.get("created_source") or "") or "created_at"
        parsed = _parse_timestamp(stamp)
        if stamp and parsed is not None:
            timed.append((index, parsed, field, stamp))
    if not timed:
        return (None, "", "无时间戳")
    if len(timed) < len(members):
        return (None, "", "只有部分组有时间戳")
    if len({item[1] for item in timed}) == 1:
        return (None, "", "各组时间戳完全相同")
    timed.sort(key=lambda item: (item[1], item[0]))
    if timed[-2][1] == timed[-1][1]:
        return (None, "", "最新时间戳并列（多组相同）")
    index, _parsed, field, stamp = timed[-1]
    return (
        index,
        f"{groups[index]['script_id']} 的 {field}={stamp} 最晚（可比较的时间戳里最新）",
        "",
    )


def annotate_script_versions(
    groups: List[dict],
    storyboards: Optional[List[dict]] = None,
) -> None:
    """就地填 ``facts`` / ``likely_newest`` / ``version_reasons`` / ``version_hint``。

    **客观 vs 判断分开**：

    * ``facts``：客观信息逐条（记录数 / 序号范围 / 翻了几页 / 时间戳字段与值 /
      与其它组的标题是否相同、正文重合度多少）—— 任何情况下都给。
    * ``version_reasons``：只在**确实按时间戳判出先后**时给出结论；
      没有时间证据时这里只保留客观事实，不写「最可能是最新版」这类判断。
    * ``likely_newest``：**只有**真实拿到可比较的时间戳、且能分出先后时才为 true，
      并且依据里写明是哪个字段、什么值。**id 大小一律不作为依据。**
    * ``version_hint``：同一脚本多版本的中立陈述（含「请你确认」），无证据时为空串。

    成团（= 疑似同一脚本的不同版本）的证据：标题归一化后相同，或分镜正文集合
    重合度 >= 50%（Jaccard）。证据不足一律 ``likely_newest=False`` / 空列表 / 空串。
    """
    if not groups:
        return
    signatures = _prompt_signatures(storyboards)
    for group in groups:
        group["facts"] = _baseline_facts(group)

    parent = list(range(len(groups)))

    def _find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    evidence: Dict[Tuple[int, int], List[Dict[str, Any]]] = {}
    for i, left in enumerate(groups):
        for j in range(i + 1, len(groups)):
            items = _pair_evidence(left, groups[j], signatures)
            if not items:
                continue
            evidence[(i, j)] = items
            root_i, root_j = _find(i), _find(j)
            if root_i != root_j:
                parent[max(root_i, root_j)] = min(root_i, root_j)

    clusters: Dict[int, List[int]] = {}
    for index in range(len(groups)):
        clusters.setdefault(_find(index), []).append(index)

    for members in clusters.values():
        if len(members) < 2:
            continue
        winner, decisive, no_claim = _timestamp_decision(members, groups)
        for index in members:
            group = groups[index]
            facts: List[str] = []
            short: List[str] = []
            by_other: Dict[str, List[str]] = {}
            for (i, j), items in evidence.items():
                if index not in (i, j):
                    continue
                other = str(groups[j if index == i else i]["script_id"])
                for item in items:
                    text = _format_evidence(item, other)
                    if text not in facts:
                        facts.append(text)
                    by_other.setdefault(other, []).append(_compact_evidence(item))
            for other, briefs in by_other.items():
                short.append(f"与 {other} " + "、".join(dict.fromkeys(briefs)))
            group["facts"] = group["facts"] + facts
            others = _other_ids(members, groups, index)

            if index == winner:
                group["likely_newest"] = True
                group["version_reasons"] = facts + [
                    decisive,
                    "仍需用户确认：本轮只给线索，不自动选择脚本组",
                ]
                group["version_hint"] = (
                    f"疑似与 {others} 为同一脚本的不同版本；{decisive}。仍需用户确认"
                )
                continue

            group["version_reasons"] = facts
            if winner is None:
                # 没有可靠时间证据：只陈述客观信息，绝不写「最新版本」
                group["version_hint"] = (
                    f"{'、'.join(short)}；{no_claim}，无法判断先后，请你确认"
                )
                continue
            group["version_hint"] = (
                f"疑似与 {others} 为同一脚本的不同版本；{decisive}。仍需用户确认"
            )


def _other_ids(members: List[int], groups: List[dict], index: int) -> str:
    return "/".join(str(groups[i]["script_id"]) for i in members if i != index)


# ---------------------------------------------------------------------------
# parse_agent_platform_response — kept for backward compat
# ---------------------------------------------------------------------------


def _walk_json_dicts(value: object, limit: int = 2000) -> List[dict]:
    found: List[dict] = []
    def walk(node: object) -> None:
        if len(found) >= limit:
            return
        if isinstance(node, dict):
            found.append(node)
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)
    walk(value)
    return found


def _agent_from_json_object(obj: dict, source_url: str, fetched_at: str) -> Optional[dict]:
    name = _first_present_text(obj, ["title", "agent_name", "agentName", "name", "templateName", "roleName", "botName"])
    agent_id = _first_present_text(obj, ["id", "uid", "agent_id", "agentId", "templateId", "materialId", "snippetId"])
    prompt_text = _first_present_text(obj, ["scriptContent", "prompt_text", "promptText", "prompt", "systemPrompt", "templatePrompt", "instruction", "instructions", "content"])
    description = _first_present_text(obj, ["description", "desc", "summary", "intro", "remark"])
    tags = _first_present_tags(obj)
    has_agent_signal = bool(name or prompt_text) and any(k in obj for k in ["title", "scriptContent", "agent_name", "agentName", "name", "prompt_text", "promptText", "prompt", "systemPrompt", "templatePrompt", "instruction", "instructions"])
    if not has_agent_signal:
        return None
    return {"agent_name": name or f"未命名 Agent {agent_id}".strip(), "agent_id": agent_id, "prompt_text": prompt_text, "description": description, "tags": tags, "source_platform": JURILU_AGENT_PLATFORM_NAME, "source_url": source_url, "fetched_at": fetched_at, "raw_data": _safe_json_dumps(obj), "parse_status": "已识别" if prompt_text else "未识别提示词字段"}


def parse_agent_platform_response(fetch_result: dict) -> dict:
    """解析单次 fetch 响应（getScriptPage 或其他 JSON API）。"""
    if not fetch_result.get("ok"):
        return {"agents": [], "warnings": [fetch_result.get("error_type", "抓取失败")],
                "debug": fetch_result}
    text = str(fetch_result.get("text") or "")
    source_url = str(fetch_result.get("url") or "")
    fetched_at = str(fetch_result.get("fetched_at") or datetime.now().isoformat(timespec="seconds"))
    records = _extract_records_from_response(text)
    agents: List[dict] = []
    for rec in records:
        name = str(rec.get("title", rec.get("name", "")))
        sid = str(rec.get("id", ""))
        prompt = str(rec.get("scriptContent", rec.get("prompt", "")))
        agents.append({
            "agent_id": sid, "agent_name": name or f"脚本 {sid}",
            "prompt_text": prompt,
            "description": "", "tags": [],
            "source_platform": JURILU_AGENT_PLATFORM_NAME,
            "source_url": source_url, "fetched_at": fetched_at,
            "raw_data": _safe_json_dumps(rec),
            "parse_status": "已识别" if prompt else "无脚本内容",
        })
    warnings = []
    if not agents:
        warnings.append("未识别到条目。")
    return {
        "agents": agents, "warnings": warnings,
        "debug": {
            "url": source_url, "method": fetch_result.get("method", ""),
            "status": fetch_result.get("status", ""),
            "content_type": fetch_result.get("content_type", ""),
            "elapsed_ms": fetch_result.get("elapsed_ms", ""),
            "records_count": len(records),
            "parsed_prompts_count": len(agents),
            "raw_preview": text[:3000],
        },
    }


# ---------------------------------------------------------------------------
# 标准化输出
# ---------------------------------------------------------------------------


def normalize_external_agent_prompts(agents: List[dict]) -> List[dict]:
    """把抓到的分镜标准化成条目（**一条都不丢**，不做任何数量截断）。

    ``script_id`` / ``seq`` / ``sbid`` 一并带出来：统一预览要能逐行显示
    「脚本组 + 巨日禄序号」，配对时也靠 ``seq`` 做「编号优先」匹配。
    """
    entries: List[dict] = []
    for index, agent in enumerate(agents, start=1):
        prompt_text = str(agent.get("prompt_text") or "").strip()
        if not prompt_text:
            continue
        agent_name = str(agent.get("agent_name") or "").strip() or f"Agent {index}"
        entries.append({
            "shot_label": agent_name,
            "description": str(agent.get("shot_summary") or agent.get("description") or agent_name).strip(),
            "final_prompt": prompt_text,
            "model": str(agent.get("modelName") or f"{JURILU_AGENT_PLATFORM_NAME} Agent"),
            "duration": str(agent.get("duration") or "5"),
            "size": str(agent.get("aspectRatio") or "9:16"),
            "resolution": str(agent.get("resolution") or "720p"),
            "agent_name": agent_name,
            "agent_id": str(agent.get("agent_id") or ""),
            "script_id": str(agent.get("source_script_id") or agent.get("scriptId") or ""),
            "seq": str(agent.get("seqNum") or ""),
            "sbid": str(agent.get("sbid") or ""),
            "source_platform": JURILU_AGENT_PLATFORM_NAME,
            "source_url": str(agent.get("source_url") or ""),
            "fetched_at": str(agent.get("fetched_at") or ""),
            "raw_data": str(agent.get("raw_data") or ""),
        })
    return entries
