"""提交前的参考图「上游到底取不取得到」预检（真实故障 A 的落地修复）。

真实故障（验收第 6 项）：真实提交首帧生成，上游 APIMart 建了任务
（``task_01M2Z2…``）后直接 failed，错误原文「无法获取输入媒体 URL（404/410）」，cost=0。
根因已证实：**传给上游的参考图地址只在本机可读**（本机/相对路径，或 ACL 没生效的
OSS 对象），匿名访问公网返回 404；而上游是**匿名抓取**这张图的 → 任务必然失败。
也就是说：钱虽然没花成，但这一次提交本来就是注定失败的，应该在提交前就拦下来。

本模块只做一件事：在**真正提交之前**，对每一张要发出去的参考图做一次**匿名 HTTP 探活**，
把「哪张图 / 哪个资产 / 实际状态码 / 该怎么修」结构化地带回给调用方；
不通过的**不提交**，并明确告知「没有产生任何付费调用」。

三条硬约束：

1. **匿名口径**：探活不携带任何项目凭据（不给 Authorization / Cookie），
   与上游匿名抓图的处境一致；否则会出现「我们能取到、上游取不到」的假阳性。
2. **不外泄内部标识**：给用户看的文案只带**可读名**（资产名 / 帧角色），
   不带 ``file_id``、不带本机绝对路径（前端有 ``maskInternalIds.ts`` 的同款规范）。
3. **探活本身不出站就算了**：DRY_RUN（演练）下**一次都不探**（由调用方跳过，见
   ``routes/studio/image_pipeline.py``），与 ``dry_run`` 守卫同口径：演练模式不触网。

与既有实现的分工（不重复造判定）：

- ``app/utils/files.py:resolve_vendor_image_ref`` 回答「这个引用**形态上**供应商能不能用」
  （http(s) / asset:// / data URL / 本地路径）；
- 本模块回答「这个 http(s) 地址**现在**匿名取得到吗」（真实 HTTP 状态码）。
- 两者都通过才算可用：形态不对的直接判不可达（不发请求），形态对的再做探活。

**出口只有两个，探活实现只有一份**：

- 提交前：:func:`preflight_references` / :func:`preflight_or_raise`（形态判定 + 探活，
  不通过就不提交）；
- 上传/落库后：:func:`verify_uploaded_url_reachable`（同一个 :func:`probe_reference_url`，
  只报告不阻断）。

也就是说：**探活只有一个实现**，别再在别处写第二份 HEAD/GET 探测。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Sequence

import httpx
from fastapi import HTTPException

from app.core import storage
from app.services.studio.llm_orchestration import dry_run

# 提交前预检被拦下时用的 HTTP 状态码：不是参数错误，而是"当前状态不支持这次提交"
# （参考图当前不可达），与 ``paid_outlet_guard`` 的 409 口径一致。
BLOCKED_STATUS_CODE = 409
UNREACHABLE_ERROR_CODE = "reference_image_unreachable"

# 探活超时（秒）：上游抓图自己也有超时，探活不该比一次真实提交更慢。
PROBE_TIMEOUT_SECONDS = 5.0
# 先 HEAD（省流量），HEAD 拿不到 2xx/3xx 时回退 GET 复核一次（有些对象存储/网关对
# HEAD 返回 403/405，但匿名 GET 是 200 —— 只信 HEAD 会把能用的图误判成不可用）。
PROBE_METHODS: tuple[str, ...] = ("HEAD", "GET")
PROBE_USER_AGENT = "Jellyfish-ReferencePreflight/1.0 (anonymous reachability probe)"

# 引用形态（与 ``resolve_vendor_image_ref`` 的 kind 语义对齐但不复用其字符串，
# 这里多两个只在本模块出现的形态：link_local / data_url 的判死由形态决定）。
KIND_PUBLIC = "public"
KIND_DATA_URL = "data_url"
#: data URL 且**该上游接受内嵌 base64**（openai / volcengine 这类适配器自己解码，不需要外网抓取）
KIND_DATA_URL_INLINE = "data_url_inline"
KIND_LOCAL_PATH = "local_path"
KIND_LOOPBACK = "loopback"
KIND_EMPTY = "empty"
KIND_REACHABLE = "reachable"
KIND_UNREACHABLE = "unreachable"
KIND_DRY_RUN_SKIPPED = "dry_run_skipped"

# 本机 / 内网主机名（这些地址在**别人的**服务器上一定取不到）
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0", "testserver"}

_HOW_TO_FIX_CODE: dict[str, str] = {
    "not_public": (
        "这不是公网地址（本机 / 项目内相对路径），上游取不到。"
        "请重新上传这张图让它生成公网（OSS）可读地址，"
        "或把已有的公网图片用 POST /api/v1/studio/files/external 登记成素材后重新设为该资产的定版图。"
    ),
    "loopback": (
        "参考图指向本机地址，只有这台机器能打开。"
        "请改用它对应的公网（OSS）地址：重新上传一次，或把该资产的定版图换成公网地址的素材。"
    ),
    "data_url": (
        "参考图是内嵌的 base64 data URL，多数上游只接受 http(s):// 图片地址，取不到这张图。"
        "请先把该图片上传到公网（OSS）再提交。"
    ),
    "not_found": (
        "该地址匿名访问返回「对象不存在」。请重新上传以生成公网可读地址，或刷新该资产的 OSS 地址后重试；"
        "若确认对象已上传，请检查 bucket 的公共读策略（ACL public-read）以及 s3_public_base_url 是否指向该 bucket。"
    ),
    "denied": (
        "该地址匿名访问被拒绝：对象不是公开可读的。"
        "请为该对象设置公开读（ACL public-read）或给 bucket 配置公共读策略，"
        "并确认 s3_public_base_url 指向的是这个 bucket 的公网域名后重试。"
    ),
    "server_error": "对象存储/图床返回服务端错误，当前取不到这张图。请稍后重试；持续失败请检查存储服务状态。",
    "unverified": "匿名探活没有完成，无法确认上游能否取到这张图。请确认该地址在公网可访问后重试。",
}


@dataclass(slots=True)
class ReferenceCandidate:
    """一张**即将发给上游**的参考图（或参考音频）。

    ``label`` 必须是可读名（如「场景「会议室」的定版参考图」「首帧参考图」），
    这是它进入任何用户可见文案的唯一身份 —— 不要放 ``file_id``。

    ``allow_data_url``：该上游是否**接受内嵌 base64**（``vendor_accepts_data_url``）。
    接受时 data URL 不算不可达（上游自己解码，不需要外网抓取）；不接受时必须拦下
    —— 那正是「本地文件 → data URL → 上游 404/400」的坑。
    """

    label: str
    url: str
    role: str = ""
    allow_data_url: bool = False


@dataclass(slots=True)
class ReferenceProbeResult:
    """单张参考图的探活结论。"""

    label: str = ""
    role: str = ""
    #: 真正会发给上游的地址（**内部**用；本地路径一律不外泄，见 display_url）
    url: str = ""
    #: 可展示地址：只有公网 http(s) 地址才会填（本地/相对/data URL 留空）
    display_url: str = ""
    kind: str = KIND_EMPTY
    reachable: bool = False
    http_status: int | None = None
    method: str = ""
    reason: str = ""
    how_to_fix: str = ""
    how_to_fix_code: str = ""

    def to_read(self) -> dict[str, Any]:
        """给用户看的结构（**不含** file_id / 本机路径）。"""
        return {
            "asset": self.label,
            "role": self.role,
            "url": self.display_url,
            "kind": self.kind,
            "result": "reachable" if self.reachable else "unreachable",
            "http_status": self.http_status,
            "probe_method": self.method,
            # 与 probe_method 同值：``method`` 是上传/adopt 响应里的字段名，
            # ``probe_method`` 是既有预检报告沿用的名字，两个都留着免得破坏既有消费方。
            "method": self.method,
            "reason": self.reason,
            "how_to_fix": self.how_to_fix,
            "how_to_fix_code": self.how_to_fix_code,
        }


@dataclass(slots=True)
class PreflightReport:
    """一批参考图的预检结论。"""

    results: list[ReferenceProbeResult] = field(default_factory=list)

    @property
    def failures(self) -> list[ReferenceProbeResult]:
        return [item for item in self.results if not item.reachable]

    @property
    def checked(self) -> int:
        """真的做了探活（或按形态判死）的张数，不含空引用与演练跳过。"""
        return len(
            [
                item
                for item in self.results
                if item.kind not in {KIND_EMPTY, KIND_DRY_RUN_SKIPPED}
            ]
        )

    @property
    def reachable_count(self) -> int:
        """**真的检查过且可达**的张数（空引用与演练跳过不算）。"""
        return len(
            [
                item
                for item in self.results
                if item.reachable and item.kind not in {KIND_EMPTY, KIND_DRY_RUN_SKIPPED}
            ]
        )

    @property
    def blocked(self) -> bool:
        return bool(self.failures)

    def to_read(self) -> dict[str, Any]:
        return {
            "checked_count": self.checked,
            "reachable_count": self.reachable_count,
            "unreachable_count": len(self.failures),
            "unreachable": [item.to_read() for item in self.failures],
            "paid_call_made": False,
        }


class ReferencePreflightBlocked(HTTPException):
    """预检未通过 → 不提交（自带结构化明细，走项目统一错误信封的 ``meta.error``）。"""

    def __init__(self, report: PreflightReport, *, detail_hint: str = "") -> None:
        self.report = report
        super().__init__(status_code=BLOCKED_STATUS_CODE, detail=build_blocked_detail(report, hint=detail_hint))


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _is_http_url(value: str) -> bool:
    lowered = value.lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def _is_private_ipv4(host: str) -> bool:
    """是否属于 RFC1918 / 环回 / 链路本地网段（别人的服务器一定取不到）。"""
    parts = host.split(".")
    if len(parts) != 4 or not all(part.isdigit() for part in parts):
        return False
    first, second = int(parts[0]), int(parts[1])
    if first in {0, 10, 127}:
        return True
    if first == 192 and second == 168:
        return True
    if first == 169 and second == 254:
        return True
    if first == 172 and 16 <= second <= 31:
        return True
    return False


def is_loopback_or_private_url(url: str) -> bool:
    """地址是否指向本机 / 内网（别人的服务器一定取不到）。"""
    if not _is_http_url(url):
        return False
    try:
        host = (httpx.URL(url).host or "").strip().strip("[]").lower()
    except Exception:  # noqa: BLE001 - 解析不了就交给探活阶段如实报错
        return False
    if not host:
        return False
    return (
        host in _LOOPBACK_HOSTS
        or host.endswith(".local")
        or host.endswith(".internal")
        or _is_private_ipv4(host)
    )


def _classify_ref(url: str) -> tuple[str, str, str]:
    """只按**形态**判定（不发请求）→ ``(kind, reason, how_to_fix_code)``。

    形态不对的直接判死：这类地址上游 100% 取不到，不该再花一次真实调用去试。
    """
    text = _normalize_text(url)
    if not text:
        return KIND_EMPTY, "", ""
    if text.lower().startswith("data:"):
        return KIND_DATA_URL, "参考图是内嵌的 base64 data URL，上游取不到它。", "data_url"
    if not _is_http_url(text):
        return (
            KIND_LOCAL_PATH,
            "参考图是本机 / 项目内相对路径（公网匿名访问取不到），这正是「本机可读、上游 404」的成因。",
            "not_public",
        )
    if is_loopback_or_private_url(text):
        host = httpx.URL(text).host or ""
        return (
            KIND_LOOPBACK,
            f"参考图指向本机 / 内网地址（{host}），只有这台机器能打开，上游取不到。",
            "loopback",
        )
    return KIND_PUBLIC, "", ""


def _status_fix_code(status: int) -> str:
    if status in {401, 403}:
        return "denied"
    if status in {404, 410}:
        return "not_found"
    if status >= 500:
        return "server_error"
    return "unverified"


def _status_reason(status: int, label: str) -> str:
    """探活失败 → 给用户看的原因（带真实状态码；标签原样嵌进括号，避免多层引号）。"""
    if status in {404, 410}:
        return f"匿名访问该参考图（{label}）的地址返回 HTTP {status}：这个对象不存在，或没有公开读权限。"
    if status in {401, 403}:
        return f"匿名访问该参考图（{label}）的地址返回 HTTP {status}：对象不是公开可读的，上游会被拒绝。"
    if status >= 500:
        return f"匿名访问该参考图（{label}）的地址返回 HTTP {status}：对象存储/图床当前异常。"
    return f"匿名访问该参考图（{label}）的地址返回 HTTP {status}：这不是一个可匿名读取的图片地址。"


async def _probe_public_url(
    result: ReferenceProbeResult,
    url: str,
    *,
    timeout: float,
    transport: httpx.AsyncBaseTransport | None,
) -> ReferenceProbeResult:
    """对形态正确的 http(s) 地址做匿名探活，并把结论写回 ``result``。"""
    headers = {"User-Agent": PROBE_USER_AGENT, "Accept": "image/*,*/*;q=0.8"}
    last_status: int | None = None
    last_error = ""
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            transport=transport,
            follow_redirects=True,
        ) as client:
            for method in PROBE_METHODS:
                request_headers = dict(headers)
                if method == "GET":
                    # 只取 1 字节：探活不需要下载整张图
                    request_headers["Range"] = "bytes=0-0"
                try:
                    response = await client.request(method, url, headers=request_headers)
                except httpx.HTTPError as exc:
                    last_error = f"{exc.__class__.__name__}: {exc}"
                    continue
                last_status = int(response.status_code)
                result.http_status = last_status
                result.method = method
                if 200 <= last_status < 400:
                    result.reachable = True
                    result.kind = KIND_REACHABLE
                    result.reason = ""
                    result.how_to_fix = ""
                    result.how_to_fix_code = ""
                    return result
    except dry_run.DryRunBlocked:
        # 演练模式装着出站兜底：这是「未探活」，不是「不可达」——不能把正常配置说成故障。
        result.kind = KIND_DRY_RUN_SKIPPED
        result.reachable = True
        result.reason = "演练模式（DRY_RUN）下未做匿名探活。"
        result.how_to_fix = ""
        result.how_to_fix_code = ""
        return result

    result.reachable = False
    result.kind = KIND_UNREACHABLE
    if last_status is not None:
        fix_code = _status_fix_code(last_status)
        result.reason = _status_reason(last_status, result.label)
    else:
        fix_code = "unverified"
        result.reason = (
            f"匿名探活「{result.label}」的地址没有完成（{last_error or '未知网络错误'}），"
            "无法确认上游能否取到这张图。"
        )
    result.how_to_fix_code = fix_code
    result.how_to_fix = _HOW_TO_FIX_CODE.get(fix_code, _HOW_TO_FIX_CODE["unverified"])
    return result


async def probe_reference_url(
    url: str,
    *,
    label: str = "参考图",
    role: str = "",
    allow_data_url: bool = False,
    timeout: float = PROBE_TIMEOUT_SECONDS,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ReferenceProbeResult:
    """对**一张**参考图做匿名可达性探活。

    先 ``HEAD``（省流量），HEAD 拿不到 2xx/3xx 时回退 ``GET``（带 ``Range: bytes=0-0``）
    复核一次 —— 有些存储/网关对 HEAD 返回 403/405，但匿名 GET 是 200，只信 HEAD 会误杀。
    跟随重定向（``follow_redirects=True``），因为上游也会跟。

    形态不对（相对路径 / 本机内网地址 / 上游不吃的 data URL）**不发请求**直接判死并给出修法。
    演练模式下的出站兜底会抛 ``DryRunBlocked``：那会被如实转成「未探活」，不当成"不可达"。
    """
    clean = _normalize_text(url)
    kind, reason, fix_code = _classify_ref(clean)
    result = ReferenceProbeResult(
        label=label,
        role=role,
        url=clean,
        kind=kind,
        reason=reason,
        how_to_fix=_HOW_TO_FIX_CODE.get(fix_code, ""),
        how_to_fix_code=fix_code,
    )
    if kind == KIND_EMPTY:
        # 空引用不是"不可达"：调用方本就把「没有参考图」当纯文本出图处理（另有 warning）
        result.reachable = True
        return result
    if kind == KIND_DATA_URL and allow_data_url:
        # 上游接受内嵌 base64：它自己解码，不需要外网抓取 → 不算不可达。
        result.reachable = True
        result.kind = KIND_DATA_URL_INLINE
        result.reason = "参考图是内嵌 base64（data URL）：当前上游按内嵌解析，不需要外网抓取。"
        result.how_to_fix = ""
        result.how_to_fix_code = ""
        return result
    if kind != KIND_PUBLIC:
        result.reachable = False
        return result

    result.display_url = clean
    return await _probe_public_url(result, clean, timeout=timeout, transport=transport)


async def preflight_references(
    candidates: Iterable[ReferenceCandidate],
    *,
    timeout: float = PROBE_TIMEOUT_SECONDS,
    transport: httpx.AsyncBaseTransport | None = None,
    probe: Callable[..., Awaitable[ReferenceProbeResult]] | None = None,
) -> PreflightReport:
    """逐张探活（顺序执行：参考图通常只有 1–4 张，不值得并发）。"""
    runner = probe or probe_reference_url
    report = PreflightReport()
    for candidate in candidates:
        report.results.append(
            await runner(
                candidate.url,
                label=candidate.label,
                role=candidate.role,
                allow_data_url=candidate.allow_data_url,
                timeout=timeout,
                transport=transport,
            )
        )
    return report


def build_blocked_detail(report: PreflightReport, *, hint: str = "") -> dict[str, Any]:
    """预检未通过 → 结构化中文错误（页面直接可读，不含内部标识）。"""
    failures = report.failures
    names = "、".join(sorted({item.label for item in failures if item.label}))
    message = (
        f"提交前预检未通过：{len(failures)} 张参考图上游（匿名）取不到"
        + (f"（{names}）" if names else "")
        + "，本次没有提交生成请求，也没有产生任何付费调用。"
    )
    detail: dict[str, Any] = {
        "code": UNREACHABLE_ERROR_CODE,
        "message": message,
        "unreachable_count": len(failures),
        "checked_count": report.checked,
        "unreachable": [item.to_read() for item in failures],
        "how_to_fix": (
            "重新上传这些参考图以生成公网可读（匿名 200）的地址，"
            "或刷新对应资产的 OSS 地址后重试。"
        ),
        "paid_call_made": False,
    }
    if hint:
        detail["hint"] = hint
    return detail


async def preflight_or_raise(
    candidates: Sequence[ReferenceCandidate],
    *,
    timeout: float = PROBE_TIMEOUT_SECONDS,
    transport: httpx.AsyncBaseTransport | None = None,
    hint: str = "",
    probe: Callable[..., Awaitable[ReferenceProbeResult]] | None = None,
) -> PreflightReport:
    """生产入口：探活 → 有不可达就抛 :class:`ReferencePreflightBlocked`（不提交）。"""
    report = await preflight_references(candidates, timeout=timeout, transport=transport, probe=probe)
    if report.blocked:
        raise ReferencePreflightBlocked(report, detail_hint=hint)
    return report


# ---------------------------------------------------------------------------
# 上传 / 落库 **之后**的匿名可达性验证（全项目唯一实现）
# ---------------------------------------------------------------------------

#: 没有拿到可验证的地址时 ``probe["result"]`` 的取值（不是"不可达"，是"没有地址"）。
PROBE_RESULT_NO_URL = "no_url"


@dataclass(slots=True)
class UploadReachability:
    """一个**已经上传/落库完成**的地址的匿名可达性结论（只报告，不阻断）。"""

    url: str = ""
    #: True=匿名公网可达；False=不可达（已如实告警）；None=未验证（演练模式 / 没有地址）
    reachable: bool | None = None
    #: 探活明细（``ReferenceProbeResult.to_read()`` 的同结构）：
    #: result / http_status / method（= probe_method）/ kind / reason / how_to_fix / how_to_fix_code
    probe: dict[str, Any] = field(default_factory=dict)
    #: 给用户看的中文告警（含修法；不可达时为一条，可用时为空）
    warnings: list[str] = field(default_factory=list)

    @property
    def skipped(self) -> bool:
        return self.reachable is None

    def to_read(self) -> dict[str, Any]:
        """给接口/日志用的结构（**不含** file_id 与本机绝对路径）。"""
        return {
            "url": self.url,
            "url_reachable": self.reachable,
            "probe": dict(self.probe),
            "warnings": list(self.warnings),
        }


def _unreachable_warning(outcome: ReferenceProbeResult, label: str) -> str:
    """不可达时给用户看的一句话：结论 + 真实状态码 + 原因 + 修法（可操作）。"""
    return (
        f"已入库，但「{label}」的地址**匿名公网访问不可达**"
        + (f"（HTTP {outcome.http_status}）" if outcome.http_status else "")
        + f"：{outcome.reason} {outcome.how_to_fix}"
        + "（这条地址当参考图交给上游时会被上游拒绝。）"
    )


async def verify_uploaded_url_reachable(
    url: str,
    *,
    label: str,
    probe: Callable[..., Awaitable[ReferenceProbeResult]] | None = None,
    timeout: float = PROBE_TIMEOUT_SECONDS,
) -> UploadReachability:
    """**上传/落库之后**再匿名验证一次这个地址上游取不取得到（故障 A 的收尾动作）。

    为什么必须有这一步：对象存储写入成功 ≠ 这个对象**匿名可读**。2026-09-19 真实验收里，
    本机可读、匿名访问 404 的地址被当成公网地址交给了上游 → 上游任务失败
    （原文「无法获取输入媒体 URL（404/410）」）。把验证放在**上传之后**，
    用户当场就能看到「已入库，但这个地址匿名取不到」以及怎么修，而不是等下一次提交才炸。

    这是**唯一**的「上传后验证」出口（``adopt`` 与 ``POST /studio/files/upload`` 都走它），
    探活实现复用 :func:`probe_reference_url`，不在别处再写一份 HEAD/GET 探测。

    返回 :class:`UploadReachability`：

    - ``reachable=True/False``：真的探过，结论是可达 / 不可达；
    - ``reachable=None``：**未验证** —— 演练模式（一个字节都不出站）或压根没拿到地址
      （此时 ``probe["result"] == PROBE_RESULT_NO_URL``，并给出"公网基址缺失"的修法）；
    - 验证永远**不阻断**上传/采纳本身：图已经存下来了，这里只如实报告 + 给修法；
    - ``label`` 必须是**可读名**（文件名 / 资产名），不要传 ``file_id``：它会进入用户可见文案。
    """
    clean = _normalize_text(url)

    if dry_run.dry_run_enabled():
        return UploadReachability(
            url=clean,
            reachable=None,
            probe={
                "result": "skipped",
                "reason": "[DRY_RUN] 演练模式未做匿名可达性验证。",
            },
            warnings=[],
        )

    if not clean:
        # 上传之后连一个地址都没有（典型：S3 驱动没配 s3_public_base_url，见 storage）。
        # 这不是"探活失败"，但上游一定取不到，必须如实说清楚 + 给修法。
        return UploadReachability(
            url="",
            reachable=None,
            probe={"result": PROBE_RESULT_NO_URL, "reason": storage.PUBLIC_BASE_MISSING_REASON},
            warnings=[storage.PUBLIC_BASE_MISSING_REASON],
        )

    runner = probe or probe_reference_url
    outcome = await runner(clean, label=label, timeout=timeout)
    warnings: list[str] = []
    if not outcome.reachable:
        warnings.append(_unreachable_warning(outcome, label))
    return UploadReachability(
        url=clean,
        reachable=bool(outcome.reachable),
        probe=outcome.to_read(),
        warnings=warnings,
    )


__all__ = [
    "BLOCKED_STATUS_CODE",
    "KIND_DATA_URL",
    "KIND_DATA_URL_INLINE",
    "KIND_DRY_RUN_SKIPPED",
    "KIND_EMPTY",
    "KIND_LOCAL_PATH",
    "KIND_LOOPBACK",
    "KIND_PUBLIC",
    "KIND_REACHABLE",
    "KIND_UNREACHABLE",
    "PROBE_RESULT_NO_URL",
    "PROBE_TIMEOUT_SECONDS",
    "UNREACHABLE_ERROR_CODE",
    "PreflightReport",
    "ReferenceCandidate",
    "ReferencePreflightBlocked",
    "ReferenceProbeResult",
    "UploadReachability",
    "build_blocked_detail",
    "is_loopback_or_private_url",
    "preflight_or_raise",
    "preflight_references",
    "probe_reference_url",
    "verify_uploaded_url_reachable",
]
