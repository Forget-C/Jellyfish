"""LLM 编排层的 DRY_RUN 守卫（轻量版）。

背景：
- Jellyfish 后端此前没有任何一处真实调用大模型；本模块引入的 LLM 调用是第一条
  会产生**真实费用**的出口，必须默认关闸。
- 参照中控台 ``web/api/services/dry_run.py`` 的思路，但只保留本项目需要的最小面：
  一个 llm 出口 + 一层 httpx 出站兜底。

两层防护（与中控台一致的设计意图）：
  A. 显式守卫：``assert_llm_outbound_allowed()`` 在真正发 HTTP 之前调用。
     DRY_RUN 开启 → 抛 ``DryRunBlocked``，一行网络请求都不会发出去。
  B. 出站兜底：``install_network_guard()`` 给 ``httpx`` 的 send 打补丁，
     把非本机出站全部掐断。防的是"后来新写的路径忘了调 A"。

放行条件（必须同时满足，缺一不可）：
  1. ``JELLYFISH_DRY_RUN`` 被**显式**设为假值（0/false/no/off）；
  2. ``JELLYFISH_REAL_LLM_CONFIRMED=1``，即用户明确确认过要真实付费。

未设置 ``JELLYFISH_DRY_RUN`` 时按**开启**处理（默认安全）。

**本地怎么切到真实模式（不需要改代码、不需要翻源码）**：
设置上面两个开关 → **重启后端进程** → 用状态接口确认。具体命令、验证方法与
「怎么关回演练」见 :func:`enable_steps` / :func:`restore_steps`，以及仓库文档
``docs/real-run-mode.md``；前端顶部角标与 ``GET /api/v1/studio/llm/orchestration/status``
也会把同样的步骤回显出来，被守卫拦住时错误体里带 ``how_to_enable``。

开关写在哪里都生效，按下面的**优先级**解析（十二要素口径，进程环境变量优先）：

1. **进程环境变量**（``os.environ``：``export`` / 启动脚本 / 容器 env）——最高优先级；
2. **``backend/.env``**（pydantic-settings 读进 ``Settings``）——与 1 同等有效，优先级更低；
3. 两处都没写 → **默认值**（``JELLYFISH_DRY_RUN`` 视为开启、确认变量视为未确认）。

解析**只在本模块一处**（:func:`flag_raw` / :func:`flag_source`），其它地方一律复用，
避免出现两套口径。fail-safe：取值读不懂（例如 ``JELLYFISH_DRY_RUN=maybe``）、
``Settings`` 读不到、读取过程抛任何异常 → 一律按「未设置」处理；
而「未设置」对 DRY_RUN 意味着**演练**、对确认变量意味着**未确认**，两个方向都不放行。

若真实模式是**由 ``backend/.env`` 打开**的（而不是进程环境变量），后端启动时会打一条
醒目中文告警（:func:`startup_warning`），状态接口的 ``source`` / ``source_label`` 字段
也会如实标出开关来源，避免「.env 悄悄开出去」这条最隐蔽的路。
"""

from __future__ import annotations

import os
import threading
from typing import Any

DRY_RUN_ENV = "JELLYFISH_DRY_RUN"
CONFIRM_ENV = "JELLYFISH_REAL_LLM_CONFIRMED"

_TRUTHY = {"1", "true", "yes", "on", "y", "enable", "enabled"}
_FALSEY = {"0", "false", "no", "off", "n", "disable", "disabled"}

# 开关取值的规范化结果（对外只暴露这三个，避免各处自己写 if 判断）。
TRUE = "true"
FALSE = "false"
UNSET = ""  # 未设置，或取值读不懂（fail-safe 都按「未设置」处理）

# 开关来源：给状态接口与启动告警用，取值与 ``docs/real-run-mode.md`` 的措辞一致。
SOURCE_ENV = "env"  # 进程环境变量（优先级最高）
SOURCE_DOTENV = "dotenv"  # backend/.env（经 pydantic-settings 读进 Settings）
SOURCE_DEFAULT = "default"  # 两处都没写，用默认值（演练 / 未确认）

_SOURCE_LABELS: dict[str, str] = {
    SOURCE_ENV: "进程环境变量",
    SOURCE_DOTENV: "backend/.env",
    SOURCE_DEFAULT: "默认值（两处都没设置）",
}

# LLM 结果只用于预览，绝不落库；这里显式声明出口清单，便于以后扩展时对账。
LLM_OUTLET = "llm"

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0", "testserver"}

# 付费/有外部副作用的出口清单（P1 只用 llm；P3 补齐 image / video / oss）。
OUTLET_LLM = "llm"
OUTLET_IMAGE = "image"
OUTLET_VIDEO = "video"
OUTLET_OSS = "oss"
OUTLETS: tuple[str, ...] = (OUTLET_LLM, OUTLET_IMAGE, OUTLET_VIDEO, OUTLET_OSS)

# DRY_RUN 占位产物：用不可达的 .invalid 域名，绝不做真实请求。
FAKE_IMAGE_BASE_URL = "https://dry-run.invalid/assets"
FAKE_OSS_BASE_URL = "https://dry-run.invalid/oss"
FAKE_VIDEO_URL = "https://dry-run.invalid/videos/dry_run.mp4"

_OUTLET_LABELS: dict[str, str] = {
    OUTLET_LLM: "大模型",
    OUTLET_IMAGE: "出图",
    OUTLET_VIDEO: "出视频",
    OUTLET_OSS: "对象存储上传",
}

# --------------------------------------------------------------------------
# 模式标识（机器可读 + 中文文案）
#
# 三种模式，前端的角标、状态接口、拦截错误体都用这里的取值，避免各处自己造词：
#   dry_run           演练模式：不发任何真实请求（默认）
#   real_unconfirmed  真实模式已开、但没确认：仍然不发真实请求（缺 CONFIRM_ENV）
#   real              真实模式：允许真实调用（会花钱，成本确认/限额/去重仍然生效）
# --------------------------------------------------------------------------

MODE_DRY_RUN = "dry_run"
MODE_REAL_UNCONFIRMED = "real_unconfirmed"
MODE_REAL = "real"

_MODE_LABELS: dict[str, str] = {
    MODE_DRY_RUN: "演练模式",
    MODE_REAL_UNCONFIRMED: "真实模式（未确认）",
    MODE_REAL: "真实模式",
}

# 拦截原因（机器可读）：必须区分「演练模式所以不发真实请求」与「真实模式已开但没确认」。
BLOCKED_REASON_DRY_RUN = "dry_run"
#: 真实模式已开，但该出口不在**本次授权的出口白名单**里（见 ``ALLOWED_OUTLETS_ENV``）
BLOCKED_REASON_OUTLET_NOT_ALLOWED = "outlet_not_allowed"
BLOCKED_REASON_NOT_CONFIRMED = "real_call_not_confirmed"

_BLOCKED_REASON_TEXTS: dict[str, str] = {
    BLOCKED_REASON_DRY_RUN: f"当前是演练模式（{DRY_RUN_ENV} 未显式设为 0）：不会发起真实请求，也不会产生费用。",
    BLOCKED_REASON_OUTLET_NOT_ALLOWED: (
        "真实模式已开，但本次授权的**出口白名单**没有把这个出口列进去：不会发起真实请求。"
    ),
    BLOCKED_REASON_NOT_CONFIRMED: (
        f"真实模式开关已开，但缺少付费确认（{CONFIRM_ENV} 不是 1）：仍然不会发起真实请求。"
    ),
}


def outlet_label(outlet: str) -> str:
    """出口的中文名，用于给用户看的提示语。"""
    return _OUTLET_LABELS.get(outlet, outlet)


class DryRunBlocked(RuntimeError):
    """DRY_RUN 拦截到付费出口。

    除了给用户看的 ``str(exc)``，还带机器可读的 ``reason_code`` 与「怎么开真实模式」的
    中文步骤（``how_to_enable`` / ``enable_steps``），供接口与前端直接渲染。
    """

    #: 机器可读的拦截原因：
    reason_code = BLOCKED_REASON_DRY_RUN

    def __init__(self, detail: str = "", outlet: str = OUTLET_LLM) -> None:
        label = _OUTLET_LABELS.get(outlet, outlet)
        message = f"[DRY_RUN] 已拦截「{label}」出口，未发起任何真实请求"
        if detail:
            message += f"：{detail}"
        message += f"。要放开请显式设置 {DRY_RUN_ENV}=0 且 {CONFIRM_ENV}=1。"
        self.detail = detail
        self.outlet = outlet
        super().__init__(message)

    @property
    def how_to_enable(self) -> str:
        """中文「怎么开真实模式」的单段说明。"""
        return how_to_enable_text()

    @property
    def enable_steps(self) -> list[str]:
        """中文「怎么开真实模式」的分步说明。"""
        return enable_steps()


class RealCallNotConfirmed(RuntimeError):
    """DRY_RUN 已被关闭，但没有拿到用户确认，仍然拒绝真实调用。"""

    reason_code = BLOCKED_REASON_NOT_CONFIRMED

    def __init__(self, detail: str = "", outlet: str = OUTLET_LLM) -> None:
        label = _OUTLET_LABELS.get(outlet, outlet)
        message = (
            f"已关闭 {DRY_RUN_ENV} 但缺少用户确认：真实「{label}」调用会产生费用，"
            f"请显式设置 {CONFIRM_ENV}=1 后再试"
        )
        if detail:
            message += f"（{detail}）"
        self.detail = detail
        self.outlet = outlet
        super().__init__(message)

    @property
    def how_to_enable(self) -> str:
        """中文「怎么开真实模式」的单段说明（少一个确认变量）。"""
        return how_to_enable_text()

    @property
    def enable_steps(self) -> list[str]:
        """中文「怎么开真实模式」的分步说明（少一个确认变量）。"""
        return enable_steps()


class OutletNotAllowed(RealCallNotConfirmed):
    """真实模式已开，但**这个出口不在白名单里**（``JELLYFISH_ALLOWED_OUTLETS``）。

    为什么需要它：两个开关只能表达"整体开/关"，没法表达"只允许文本模型、不许出图/出视频/上传"
    这种**按出口授权**。验收（用户只授权 5 次文本调用，不授权出图/视频/OSS 写入）就需要它：
    白名单设成 ``llm`` 之后，图片 / 视频 / OSS 三个出口在**代码层面**就被挡住，
    不依赖"记得别点那个按钮"。

    直接继承 :class:`RealCallNotConfirmed`：既有的 ``except RealCallNotConfirmed`` /
    ``isinstance(..., (DryRunBlocked, RealCallNotConfirmed))`` 站点无需逐个改动，
    而机器可读的 ``reason_code`` 与中文说明由本类覆盖，不会与"没确认"混淆。
    """

    reason_code = BLOCKED_REASON_OUTLET_NOT_ALLOWED

    def __init__(self, detail: str = "", outlet: str = OUTLET_LLM) -> None:
        label = _OUTLET_LABELS.get(outlet, outlet)
        message = (
            f"真实模式已开，但「{label}」出口不在本次授权的出口白名单里"
            f"（{ALLOWED_OUTLETS_ENV}）：未发起任何真实请求"
        )
        if detail:
            message += f"（{detail}）"
        # 显式调用父类初始化（保持"子类"这一事实在构造链上也是真的），再覆盖面向用户的那句话
        super().__init__(detail, outlet=outlet)
        self.args = (message,)
        self.detail = detail
        self.outlet = outlet

    @property
    def reason_text(self) -> str:
        """这个出口被拦的中文说明（白名单没列它）。"""
        return _BLOCKED_REASON_TEXTS[BLOCKED_REASON_OUTLET_NOT_ALLOWED]

    @property
    def how_to_enable(self) -> str:
        """中文「怎么放开这个出口」：说明要显式加进白名单。"""
        return (
            f"在启动后端的终端（或 backend/.env）里把 {ALLOWED_OUTLETS_ENV} 显式设成包含该出口的值"
            f"（例如 {ALLOWED_OUTLETS_ENV}=llm,image），然后重启后端进程；"
            f"当前白名单：{allowed_outlets() if allowed_outlets() is not None else '未设置（等于不额外限制）'}。"
        )


# --------------------------------------------------------------------------
# 开关
# --------------------------------------------------------------------------


# --------------------------------------------------------------------------
# 开关解析（**唯一**一处口径，其它地方一律复用）
#
# 两个来源都生效，优先级：进程环境变量 > backend/.env > 默认值。
# fail-safe：读不到 / 读不懂 / 抛异常 → 一律按「未设置」处理。
# --------------------------------------------------------------------------


def _settings() -> Any:
    """``Settings`` 单例（``backend/.env`` 的载体）。

    延迟导入，避免 ``app.config`` 与守卫之间的导入环；测试可以 monkeypatch
    本函数注入自己的 ``Settings``（例如指向临时 ``.env`` 文件）。
    """
    from app.config import settings

    return settings


def _env_raw(name: str) -> str:
    """进程环境变量里的原始取值；未设置或空串 → 空串。"""
    return (os.environ.get(name) or "").strip()


def _dotenv_raw(name: str) -> str:
    """``backend/.env`` 里的原始取值；读不到或抛异常 → 空串（fail-safe）。"""
    try:
        raw = getattr(_settings(), name.lower(), None)
    except Exception:  # noqa: BLE001 - 读不到配置绝不放行真实调用
        return ""
    if raw is None:
        return ""
    return str(raw).strip()


def _normalize(raw: str) -> str:
    """原始取值 → :data:`TRUE` / :data:`FALSE` / :data:`UNSET`。

    无法识别的取值（例如 ``maybe``）一律返回 :data:`UNSET`：
    对 DRY_RUN 意味着**演练**，对确认变量意味着**未确认**，两个方向都不放行。
    """
    value = (raw or "").strip().lower()
    if not value:
        return UNSET
    if value in _FALSEY:
        return FALSE
    if value in _TRUTHY:
        return TRUE
    return UNSET


def flag_raw(name: str) -> str:
    """按优先级取开关的原始取值：进程环境变量 → ``backend/.env`` → 空串。

    环境变量存在但为空串时视为「没设」，继续看 ``.env``（空值不构成显式设置）。
    """
    return _env_raw(name) or _dotenv_raw(name)


def flag_source(name: str) -> str:
    """开关来源：``env`` / ``dotenv`` / ``default``（见模块顶部说明）。"""
    if _env_raw(name):
        return SOURCE_ENV
    if _dotenv_raw(name):
        return SOURCE_DOTENV
    return SOURCE_DEFAULT


def flag_text(name: str) -> str:
    """开关取值的规范化结果（:data:`TRUE` / :data:`FALSE` / :data:`UNSET`）。"""
    return _normalize(flag_raw(name))


def source() -> str:
    """当前「开关来源」：两个开关里**优先级最高**的那个来源。

    - 只要有一个来自进程环境变量 → ``env``；
    - 否则只要有一个来自 ``backend/.env`` → ``dotenv``；
    - 两个都没设置 → ``default``。
    """
    sources = {flag_source(DRY_RUN_ENV), flag_source(CONFIRM_ENV)}
    if SOURCE_ENV in sources:
        return SOURCE_ENV
    if SOURCE_DOTENV in sources:
        return SOURCE_DOTENV
    return SOURCE_DEFAULT


def source_label() -> str:
    """开关来源的中文名（进程环境变量 / backend/.env / 默认值）。"""
    return _SOURCE_LABELS.get(source(), source())


def dotenv_keys() -> list[str]:
    """真正生效且**来自 backend/.env** 的开关名（启动告警里点名用）。"""
    return [name for name in (DRY_RUN_ENV, CONFIRM_ENV) if flag_source(name) == SOURCE_DOTENV]


def dry_run_enabled() -> bool:
    """DRY_RUN 是否开启。

    默认开启；只有**显式**读到假值（``0/false/no/off``...）才关闭；
    取值读不懂、读不到、抛异常都按开启处理。每次实时解析，方便测试中途切换。
    """
    return flag_text(DRY_RUN_ENV) != FALSE


def real_call_confirmed() -> bool:
    """用户是否明确确认过可以真实调用（默认否；读不懂一律按未确认）。"""
    return flag_text(CONFIRM_ENV) == TRUE


def allow_real_llm_call() -> bool:
    """真实调用是否被允许：必须显式关闸 + 明确确认。"""
    return (not dry_run_enabled()) and real_call_confirmed()


# 出口无关的通用别名（P3 的 image / video / oss 出口复用同一套闸门）。
allow_real_call = allow_real_llm_call


def blocked_reason(detail: str = "") -> str | None:
    """返回被拦截的原因描述；允许真实调用时返回 None。"""
    if dry_run_enabled():
        raw = flag_raw(DRY_RUN_ENV) or "未设置/默认开启"
        return f"DRY_RUN 开启（{DRY_RUN_ENV}={raw}，来源：{source_label()}）：{detail}".strip("：")
    if not real_call_confirmed():
        return f"未确认真实调用（需要 {CONFIRM_ENV}=1）：{detail}".strip("：")
    return None


# --------------------------------------------------------------------------
# 模式标识 / 中文操作步骤（前端角标与拦截错误体共用）
# --------------------------------------------------------------------------

#: 守护进程每次都实时读环境变量，但**外部改不了已启动进程的环境**，所以切换必须重启。
RESTART_REQUIRED = True

_START_COMMAND = "cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
_VERIFY_COMMAND = "curl -s http://localhost:8000/api/v1/studio/llm/orchestration/status"
_DOC_PATH = "docs/real-run-mode.md"


def mode() -> str:
    """当前模式：``dry_run`` / ``real_unconfirmed`` / ``real``。"""
    if dry_run_enabled():
        return MODE_DRY_RUN
    if not real_call_confirmed():
        return MODE_REAL_UNCONFIRMED
    return MODE_REAL


def mode_label() -> str:
    """当前模式的中文名（演练模式 / 真实模式（未确认） / 真实模式）。"""
    return _MODE_LABELS.get(mode(), mode())


def mode_description() -> str:
    """当前模式的中文一句话说明：会不会发真实请求、会不会花钱。"""
    current = mode()
    if current == MODE_DRY_RUN:
        return f"当前不发任何真实请求，也不会产生费用（{DRY_RUN_ENV} 未显式设为 0）。"
    if current == MODE_REAL_UNCONFIRMED:
        return f"真实模式开关已开，但 {CONFIRM_ENV} 不是 1：仍然不发真实请求，不产生费用。"
    return "真实模式已开：会发起真实付费调用，仍受成本确认、批量上限与去重幂等约束。"


def is_real_mode() -> bool:
    """真实模式是否**真的**放行（两个条件都满足）。"""
    return mode() == MODE_REAL


def is_dry_run_mode() -> bool:
    """是否处于演练模式（默认值）。"""
    return mode() == MODE_DRY_RUN


def is_dotenv_real_mode() -> bool:
    """真实模式是否**由 backend/.env** 打开（而不是进程环境变量）。

    触发启动告警的唯一条件：真实模式已放行，且它的开关是从 ``.env`` 读到的。
    这是最隐蔽的一条路——``.env`` 通常被 gitignore，改它不进代码评审，
    进程启动参数里也看不出痕迹。
    """
    return is_real_mode() and source() == SOURCE_DOTENV


def startup_warning() -> str | None:
    """后端启动时该打的中文告警；不需要告警时返回 ``None``。

    只有「真实模式由 backend/.env 打开」才告警：进程环境变量打开真实模式的人
    是显式 ``export`` 的，本来就知道自己干了什么；``.env`` 则可能被前人留下、
    被复制粘贴带进来，需要当面说清。
    """
    if not is_dotenv_real_mode():
        return None
    keys = "、".join(dotenv_keys()) or "—"
    return "\n".join(
        [
            "!" * 78,
            "【告警】检测到由 backend/.env 打开的真实付费模式：",
            f"    {DRY_RUN_ENV}=0 且 {CONFIRM_ENV}=1（来自 backend/.env 的键：{keys}）。",
            "    真实模式下大模型按 token、出图按张、出视频按次真实计费，请求会真的发出去。",
            "    请确认这是你要的；CI/测试环境请用演练模式。",
            f"    关回演练：把 backend/.env 里这两个键改回 {DRY_RUN_ENV}=1（或删掉）后重启；",
            f"    也可以直接用进程环境变量覆盖（进程环境变量优先）：export {DRY_RUN_ENV}=1。",
            f"    详见 {_DOC_PATH}。",
            "!" * 78,
        ]
    )


def enable_steps() -> list[str]:
    """「怎么开真实模式」的分步中文说明（照做即可，不需要改代码；纯文本，前端直接渲染）。"""
    return [
        f"第 1 步｜设置两个开关。二选一，都生效，但**进程环境变量优先于 backend/.env**："
        f"① 在启动后端的那个终端里 export {DRY_RUN_ENV}=0 与 export {CONFIRM_ENV}=1；"
        f"② 或把这两行写进 backend/.env（写进 .env 也能生效，但后端启动时会打真实付费告警）。",
        f"第 2 步｜重启后端进程（外部改不了已启动进程的环境变量，必须重启）：{_START_COMMAND}。",
        f"第 3 步｜验证当前模式：执行 {_VERIFY_COMMAND}，确认 data.mode 为 \"real\"、"
        f"data.guard.real_call_confirmed 为 true、data.switch_source 为 \"env\" 或 \"dotenv\"；"
        f"页面顶部角标应显示「真实模式」。",
        f"第 4 步｜恢复演练：unset {DRY_RUN_ENV} {CONFIRM_ENV}（如果 .env 里也写了，一并删掉或改成 1）"
        f"后重启进程，角标回到「演练模式」。完整说明见 {_DOC_PATH}。",
    ]


def how_to_enable_text() -> str:
    """「怎么开真实模式」的单段中文说明（塞进错误体用）。"""
    return (
        f"开启真实模式：export {DRY_RUN_ENV}=0 且 export {CONFIRM_ENV}=1（写进 backend/.env 同样生效，"
        f"但进程环境变量优先），然后重启后端进程；用 {_VERIFY_COMMAND} 确认 data.mode=\"real\"。"
        f"详见 {_DOC_PATH}。"
    )


def restore_steps() -> list[str]:
    """「怎么关回演练」的分步中文说明。"""
    return [
        f"第 1 步｜在启动后端的终端里 unset {DRY_RUN_ENV} {CONFIRM_ENV}"
        f"（或显式 export {DRY_RUN_ENV}=1）；并检查 backend/.env 里是否写了这两个键，"
        f"写了就一并删掉或把 {DRY_RUN_ENV} 改回 1。",
        "第 2 步｜重启后端进程。",
        f"第 3 步｜验证：执行 {_VERIFY_COMMAND}，确认 data.mode 为 \"dry_run\"、"
        f"data.guard.dry_run 为 true；页面角标应显示「演练模式」。",
    ]


def how_to_restore_text() -> str:
    """「怎么关回演练」的单段中文说明。"""
    return (
        f"恢复演练模式：unset {DRY_RUN_ENV} {CONFIRM_ENV}（或 {DRY_RUN_ENV}=1）、"
        f"并清掉 backend/.env 里可能写着的这两个键，然后重启后端进程；未设置时默认就是演练模式。"
    )


def allowed_outlets() -> tuple[str, ...] | None:
    """**出口白名单**：只有列出的出口允许真实调用。

    - 未设置（默认）→ ``None``：不额外限制（与加这个功能之前完全一致）；
    - 显式设置 → 元组；写成 ``none`` / ``off`` / ``0`` 表示**四个出口全部禁止**；
    - 空值 / 读不懂 → 按"未设置"处理（fail-safe：与守卫其余部分同口径 —— 空值一律等同未设置，
      不会因为写法怪就误放开出口；要全禁请显式写 ``none``）。
    """
    if flag_source(ALLOWED_OUTLETS_ENV) == SOURCE_DEFAULT:
        return None
    raw = str(flag_raw(ALLOWED_OUTLETS_ENV) or "").strip().replace("，", ",")
    if not raw:
        return None
    if raw.lower() in {"none", "off", "0"}:
        return ()
    return tuple(item.strip().lower() for item in raw.split(",") if item.strip())


def outlet_allowed(outlet: str) -> bool:
    """这个出口**现在**是否允许真实调用（真实模式 + 白名单两条都要满足）。"""
    if not is_real_mode():
        return False
    allowed = allowed_outlets()
    if allowed is None:
        return True
    return str(outlet or "").strip().lower() in allowed


def outlet_blocked_reason_code(outlet: str) -> str | None:
    """单个出口被拦的机器可读原因；允许时返回 ``None``。"""
    if not is_real_mode():
        return blocked_reason_code()
    if outlet_allowed(outlet):
        return None
    return BLOCKED_REASON_OUTLET_NOT_ALLOWED


def blocked_reason_code() -> str | None:
    """被拦截原因的机器可读代号；允许真实调用时返回 ``None``。

    与 :func:`blocked_reason`（给人看的中文）配对使用：
    前端据此把「演练模式所以不发」和「真实模式已开但没确认」分开提示。
    拦截原因只由两个开关决定，与出口无关，因此四个出口共用同一代号。
    """
    current = mode()
    if current == MODE_REAL:
        return None
    if current == MODE_DRY_RUN:
        return BLOCKED_REASON_DRY_RUN
    return BLOCKED_REASON_NOT_CONFIRMED


def blocked_reason_text() -> str | None:
    """被拦截原因的中文说明；允许真实调用时返回 ``None``。"""
    code = blocked_reason_code()
    if code is None:
        return None
    return _BLOCKED_REASON_TEXTS[code]


def outlet_state(outlet: str) -> dict[str, Any]:
    """单个出口的放行状态（前端逐出口渲染用）。

    判定顺序：真实模式 → 出口白名单。所以"只允许文本模型"时，图片/视频/OSS 三个出口
    会如实显示 ``allowed=false, reason="outlet_not_allowed"``，而不是笼统地说"演练模式"。
    """
    code = outlet_blocked_reason_code(outlet)
    allowed = code is None
    reason_text = "允许真实调用（会产生真实费用）。" if allowed else _BLOCKED_REASON_TEXTS[code]
    return {
        "outlet": outlet,
        "label": outlet_label(outlet),
        "allowed": allowed,
        "reason": code,
        "reason_text": reason_text,
        "dry_run": dry_run_enabled(),
        "real_call_confirmed": real_call_confirmed(),
    }


def outlet_states() -> list[dict[str, Any]]:
    """四个出口（llm / image / video / oss）各自的放行状态。"""
    return [outlet_state(outlet) for outlet in OUTLETS]


def mode_details() -> dict[str, Any]:
    """模式 + 出口状态 + 中文开启/恢复步骤的完整快照（状态接口与前端共用）。

    既有字段保持向后兼容，只做加法；新增的字段用于「开关到底写在哪」这件事：
    ``source``（``env``/``dotenv``/``default``）、``source_label``、``dry_run_source``、
    ``real_call_confirmed_source``、``dotenv_real_mode``、``startup_warning``。
    """
    return {
        "mode": mode(),
        "mode_label": mode_label(),
        "mode_description": mode_description(),
        "is_real_mode": is_real_mode(),
        "dry_run": dry_run_enabled(),
        "real_call_confirmed": real_call_confirmed(),
        "env": DRY_RUN_ENV,
        "confirm_env": CONFIRM_ENV,
        "restart_required_on_change": RESTART_REQUIRED,
        # --- 新增：开关来源（进程环境变量 / backend/.env / 默认值） ---
        "source": source(),
        "source_label": source_label(),
        "dry_run_source": flag_source(DRY_RUN_ENV),
        "real_call_confirmed_source": flag_source(CONFIRM_ENV),
        "dotenv_real_mode": is_dotenv_real_mode(),
        "startup_warning": startup_warning(),
        "outlets": outlet_states(),
        #: 出口白名单（``None`` = 未设置，等于不额外限制）
        "allowed_outlets": (list(allowed_outlets()) if allowed_outlets() is not None else None),
        "allowed_outlets_env": ALLOWED_OUTLETS_ENV,
        "allowed_outlets_source": flag_source(ALLOWED_OUTLETS_ENV),
        "enable_steps": enable_steps(),
        "how_to_enable": how_to_enable_text(),
        "restore_steps": restore_steps(),
        "how_to_restore": how_to_restore_text(),
        "doc": _DOC_PATH,
    }


def assert_outbound_allowed(detail: str = "", *, outlet: str = OUTLET_LLM) -> None:
    """真实发 HTTP / 上传对象存储前的最后一道检查。"""
    if dry_run_enabled():
        _record("blocked", detail, target=outlet)
        raise DryRunBlocked(detail, outlet=outlet)
    if not real_call_confirmed():
        _record("blocked_unconfirmed", detail, target=outlet)
        raise RealCallNotConfirmed(detail, outlet=outlet)
    if not outlet_allowed(outlet):
        # 真实模式已开，但这个出口不在白名单里：同样**一行请求都不发**
        _record("blocked_outlet_not_allowed", detail, target=outlet)
        raise OutletNotAllowed(detail, outlet=outlet)
    _record("allowed_real", detail, target=outlet)


def assert_llm_outbound_allowed(detail: str = "") -> None:
    """llm 出口的守卫（P1 兼容入口）。"""
    assert_outbound_allowed(detail, outlet=OUTLET_LLM)


def fake_task_id(prefix: str, seed: str = "") -> str:
    """DRY_RUN 占位 task_id：可复现，方便前端轮询链路测试。"""
    suffix = "".join(ch for ch in (seed or "000000")[:8] if ch.isalnum()) or "000000"
    return f"dryrun_{prefix}_{suffix}"


def fake_image_url(asset_id: str, index: int = 1) -> str:
    """DRY_RUN 占位图片地址（不可达域名，仅作占位）。"""
    return f"{FAKE_IMAGE_BASE_URL}/{asset_id or 'asset'}_{index}.png"


def fake_oss_url(object_key: str) -> str:
    """DRY_RUN 占位 OSS 地址。"""
    return f"{FAKE_OSS_BASE_URL}/{str(object_key or '').lstrip('/')}"


# --------------------------------------------------------------------------
# 审计（供测试与排查使用）
# --------------------------------------------------------------------------

_audit_lock = threading.Lock()
_audit_log: list[dict[str, Any]] = []


def _record(action: str, detail: str = "", target: str = "") -> None:
    with _audit_lock:
        _audit_log.append({"action": action, "detail": detail, "target": target})
        if len(_audit_log) > 200:
            del _audit_log[:-200]


def audit_log() -> list[dict[str, Any]]:
    """返回被记录过的事件快照（拦截 / 放行 / 兜底触发）。"""
    with _audit_lock:
        return list(_audit_log)


def clear_audit_log() -> None:
    with _audit_lock:
        _audit_log.clear()


def state() -> dict[str, Any]:
    """守卫状态快照，便于健康检查与排查。

    既有字段（``dry_run`` / ``real_call_confirmed`` / ``env`` / ``confirm_env`` /
    ``network_guard`` / ``outlets`` / ``blocked_count``）保持向后兼容，只做加法：
    新增 ``mode`` / ``mode_label`` / ``blocked_reason``，以及开关来源字段
    ``source``（``env`` / ``dotenv`` / ``default``）/ ``source_label`` /
    ``dry_run_source`` / ``real_call_confirmed_source`` / ``dotenv_real_mode``。
    """
    return {
        "dry_run": dry_run_enabled(),
        "real_call_confirmed": real_call_confirmed(),
        "env": DRY_RUN_ENV,
        "confirm_env": CONFIRM_ENV,
        "network_guard": network_guard_installed(),
        "network_guard_requested": network_guard_requested(),
        "outlets": list(OUTLETS),
        "blocked_count": len([x for x in audit_log() if x["action"].startswith("blocked")]),
        # --- 新增（前端角标 / 拦截错误体共用同一套口径） ---
        "mode": mode(),
        "mode_label": mode_label(),
        "blocked_reason": blocked_reason_code(),
        # --- 新增（开关来源：进程环境变量 / backend/.env / 默认值） ---
        "source": source(),
        "source_label": source_label(),
        "dry_run_source": flag_source(DRY_RUN_ENV),
        "real_call_confirmed_source": flag_source(CONFIRM_ENV),
        "dotenv_real_mode": is_dotenv_real_mode(),
    }


# --------------------------------------------------------------------------
# httpx 出站兜底
# --------------------------------------------------------------------------

_guard_lock = threading.Lock()
_guard_state: dict[str, Any] = {"installed": False, "patched": {}}


#: 出站兜底的**显式开关**（进程环境变量或 ``backend/.env``）：``JELLYFISH_NETWORK_GUARD=1``。
#:
#: 为什么是显式开关而不是默认安装（2026-09-21 的决定，写清楚免得后人误解）：
#: 兜底一旦装上，**演练模式与「未确认的真实模式」下所有外部 httpx 主机都会被拦**，
#: 这会顺带影响「采纳历史生成图」这类**只读**外部读取的本地用法。所以默认不装，
#: 需要更强防护的环境（CI、演示环境、多人共用的机器）显式打开；测试里按需直接调用
#: :func:`install_network_guard`。状态接口会如实回报是否已装（``guard.network_guard``）。
NETWORK_GUARD_ENV = "JELLYFISH_NETWORK_GUARD"

#: **出口白名单**（进程环境变量或 ``backend/.env``）：``JELLYFISH_ALLOWED_OUTLETS=llm``。
#:
#: 存在的理由：两个开关只能"整体开/关"，表达不了"只授权文本模型、不授权出图/出视频/上传"。
#: 验收时设成 ``llm`` 之后，图片 / 视频 / OSS 三个出口在代码层面直接被拦（409
#: ``outlet_not_allowed``），不依赖操作者的自觉。未设置 = 不额外限制（默认行为不变）。
ALLOWED_OUTLETS_ENV = "JELLYFISH_ALLOWED_OUTLETS"


def network_guard_requested() -> bool:
    """本次进程是否**显式要求**安装出站兜底（默认否）。"""
    return flag_source(NETWORK_GUARD_ENV) != "default" and flag_text(NETWORK_GUARD_ENV) == TRUE


def network_guard_installed() -> bool:
    return bool(_guard_state["installed"])


def extra_allowed_hosts() -> set[str]:
    """额外白名单：``JELLYFISH_DRY_RUN_ALLOW_HOSTS``，逗号分隔。"""
    raw = os.environ.get("JELLYFISH_DRY_RUN_ALLOW_HOSTS") or ""
    extra = {item.strip().lower() for item in raw.split(",") if item.strip()}
    return _LOOPBACK_HOSTS | extra


def _check_host(host: str, detail: str = "", outlet: str = OUTLET_LLM) -> None:
    # 只有「真实模式且已确认」（is_real_mode）才放行外部主机。
    # 以前这里是 `if not dry_run_enabled(): return` —— 「关演练但没确认」(real_unconfirmed)
    # 这条路会**绕过兜底**，与 call_text_llm 里那个缺口同源（那份已修）。
    if is_real_mode():
        return
    normalized = (host or "").strip().strip("[]").lower()
    if not normalized or normalized in extra_allowed_hosts():
        return
    _record("blocked_network", detail or f"host={normalized}", target=normalized)
    raise DryRunBlocked(f"尝试访问外部主机 {normalized}（DRY_RUN 下禁止出站）", outlet=outlet)


def install_network_guard() -> bool:
    """给 httpx 打补丁：**非真实模式（演练 / 未确认）**下掐断非本机出站。幂等。

    按需安装：生产默认**不装**，显式设置 ``JELLYFISH_NETWORK_GUARD=1`` 后由 `main.py`
    的 lifespan 安装（测试里可直接调用）。装上后只放行「真实模式且已确认」的进程，
    以及本机地址与 ``JELLYFISH_DRY_RUN_ALLOW_HOSTS`` 白名单。
    """
    with _guard_lock:
        if _guard_state["installed"]:
            return False

        import httpx  # 主依赖已有

        patched: dict[str, Any] = {}

        original_client_send = httpx.Client.send

        def guarded_client_send(self, request, *args, **kwargs):  # type: ignore[no-untyped-def]
            url = getattr(request, "url", "")
            _check_host(getattr(getattr(request, "url", None), "host", ""), f"httpx.Client.send {url}")
            return original_client_send(self, request, *args, **kwargs)

        httpx.Client.send = guarded_client_send  # type: ignore[assignment]
        patched["httpx.Client.send"] = original_client_send

        original_async_send = httpx.AsyncClient.send

        async def guarded_async_send(self, request, *args, **kwargs):  # type: ignore[no-untyped-def]
            url = getattr(request, "url", "")
            _check_host(getattr(getattr(request, "url", None), "host", ""), f"httpx.AsyncClient.send {url}")
            return await original_async_send(self, request, *args, **kwargs)

        httpx.AsyncClient.send = guarded_async_send  # type: ignore[assignment]
        patched["httpx.AsyncClient.send"] = original_async_send

        _guard_state["patched"] = patched
        _guard_state["installed"] = True
        _record("guard_installed", "httpx")
        return True


def uninstall_network_guard() -> bool:
    """卸载出站兜底（测试用）。"""
    with _guard_lock:
        if not _guard_state["installed"]:
            return False
        import httpx

        patched = dict(_guard_state["patched"])
        if "httpx.Client.send" in patched:
            httpx.Client.send = patched["httpx.Client.send"]  # type: ignore[assignment]
        if "httpx.AsyncClient.send" in patched:
            httpx.AsyncClient.send = patched["httpx.AsyncClient.send"]  # type: ignore[assignment]
        _guard_state["patched"] = {}
        _guard_state["installed"] = False
        return True


def short_status() -> str:
    """一句话守卫状态（任务行 / 预览体里的 ``guard_status`` / ``dry_run_reason``）。

    默认（两处都没设置）时输出**逐字不变**，避免动到既有验收记录与前端文案；
    只有当开关被显式写在某处时才追加来源后缀，让「.env 悄悄开出去」也看得见。
    """
    if dry_run_enabled():
        text = f"DRY_RUN=开（{DRY_RUN_ENV}，未发起真实调用）"
    elif not real_call_confirmed():
        text = f"DRY_RUN=关但未确认（{CONFIRM_ENV} 未设置，仍会拒绝真实调用）"
    else:
        text = "DRY_RUN=关且已确认（真实付费链路）"
    if source() == SOURCE_DEFAULT:
        return text
    suffix = f"｜开关来源：{source_label()}"
    if is_dotenv_real_mode():
        suffix += "（真实付费模式，请确认这是你要的）"
    return text + suffix
