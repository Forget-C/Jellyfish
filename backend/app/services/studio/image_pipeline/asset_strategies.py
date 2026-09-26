"""按 ``asset_type`` 分流的**唯一一张表**：提示词模板 / 画幅 / 结果类型标签 / 出图通道。

用户口径（2026-09 拍板，最高优先级）：

| 类型 | 生成结果 | 结果类型标签（机器可读 / 中文） | 画幅 | 出图通道 |
|---|---|---|---|---|
| ``character`` | 人物参考图 / 角色设定图（左面部大特写 + 右全身三视图；进「人物参考图库」，用户选一张定版） | ``characterReference`` / 「人物参考图」 | **固定 16:9** | 上游出图服务 |
| ``scene`` | 场景资产图 | ``sceneAssetImage`` / 「场景资产图」 | 默认 **16:9** | 上游出图服务 |
| ``prop`` | 道具资产图 | ``propAssetImage`` / 「道具资产图」 | 默认 **1:1** | 上游出图服务 |
| ``costume`` | 服装设定图 | ``costumeDesignImage`` / 「服装设定图」 | 自己的既有口径 | **Jellyfish APIMart 图片通道** |

画幅为什么按类型分开（需求清单第 2 条）：此前所有资产共用一个比例，
道具也被渲染成 16:9 横图。现在人物 / 场景 / 道具各有自己的口径，
**唯一事实来源**是 :data:`ASSET_TYPE_ASPECT_RATIOS`。

**通道为什么必须分流**（不是可选项）：上游出图服务（人物及场景生产项目）的契约只接受
``character`` / ``scene`` / ``prop``（见 :data:`external_image_client.SERVICE_ASSET_TYPES`），
把服装当人物或场景发给它会被它拒绝 —— 那正是「套用人物参考图或场景模板」。
所以服装走 Jellyfish **自己**的 APIMart 图片通道（与「使用已有参考图重新生成」同一条通道、
同一套 provider 解析与守卫），并且**如实回报**本次用的是哪条通道。

硬约束（都在这一个模块里落地，不要在别处再写第二份分流）：

1. **这是唯一的分流表**：``/studio/image-pipeline/submit``（含 stage / 画幅解析 / **通道**）与
   ``/studio/image-pipeline/reference-regenerate`` 都从这里取策略，不许各写一套；
2. **人物参考图固定 16:9**：:data:`CHARACTER_REFERENCE_RATIO` 是**写死**的常量 ——
   它是「人物参考图（设定图）」的**图片口径**，**不是项目最终视频画幅**
   （``project.default_video_ratio`` / 镜头 override 是分镜与成片的口径，
   绝不能泄漏进人物参考图的出图请求）；调用方显式传了别的比例时**一律忽略**并
   **如实回报**（警告里带原值），不静默改口；
3. **``characterReference`` 人物专用**：场景 / 道具 / 服装的结果一律用各自的标签，
   请求体与响应里都不许出现 ``characterReference``（有测试钉住）；
4. **「按定版参考图批量出图」只对人物开放**（:attr:`AssetImageStrategy.batch_reference_allowed`）：
   场景 / 道具 / 服装走到这条路时**明确忽略并如实回报**，绝不静默按人物处理。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.types import PromptCategory
from app.services.studio.image_pipeline import external_image_client as client

#: 人物参考图（设定图）的固定画幅。
#:
#: **这是人物参考图的画幅，不是项目最终视频画幅** —— 项目 ``default_video_ratio`` /
#: 镜头 ``override_video_ratio`` 属于分镜与成片口径，二者不能混用（混用的后果是
#: 「项目是竖屏 → 人物参考图也变成 9:16」，而人物参考图库要求统一 16:9）。
CHARACTER_REFERENCE_RATIO = "16:9"

#: 人物参考图画幅的说明（进响应/日志，供排障与页面文案使用）
CHARACTER_REFERENCE_RATIO_NOTE = (
    "16:9 是人物参考图（设定图）的画幅，不是项目最终视频画幅；"
    "项目 default_video_ratio / 镜头视频比例都不会影响它"
)

#: 结果类型标签：**人物专用**（场景/道具/服装绝不能用它）
KIND_CHARACTER_REFERENCE = "characterReference"
KIND_SCENE_ASSET_IMAGE = "sceneAssetImage"
KIND_PROP_ASSET_IMAGE = "propAssetImage"
KIND_COSTUME_DESIGN_IMAGE = "costumeDesignImage"

#: 提示词模板名（每个类型一份；用于审计/测试断言「分流到了哪套模板」）
TEMPLATE_CHARACTER_REFERENCE_SHEET = "character_reference_sheet"
TEMPLATE_SCENE_ASSET_IMAGE = "scene_asset_image"
TEMPLATE_PROP_ASSET_IMAGE = "prop_asset_image"
TEMPLATE_COSTUME_DESIGN_IMAGE = "costume_design_image"

#: 画幅来源（进响应的 ``aspect_ratio_source``）
RATIO_SOURCE_CHARACTER_FIXED = "character_reference_fixed"
RATIO_SOURCE_REQUEST = "request"
RATIO_SOURCE_DEFAULT = "default"
#: 画幅来自**类型映射**（需求清单第 2 条：人物 16:9 / 场景 16:9 / 道具 1:1）
RATIO_SOURCE_ASSET_TYPE_DEFAULT = "asset_type_default"

#: **类型 → 画幅**的权威映射（唯一事实来源，别处不许再写第二份）。
#:
#: 需求清单第 2 条的原始问题：「画面比例被统一成一个值，所有资产共用一个比例」。
#: 这里的口径：
#:
#: | 类型 | 画幅 | 说明 |
#: |---|---|---|
#: | ``character`` | 16:9 | 人物参考图 / 角色设定图，**写死**（见 :data:`CHARACTER_REFERENCE_RATIO`） |
#: | ``scene`` | 16:9 | 场景资产图，横版建立镜头口径 |
#: | ``prop`` | 1:1 | 道具资产图，方图单体展示口径 |
#:
#: ``costume`` 不在表内：服装**没有**本清单给出的画幅口径，沿用管线既有默认
#: （不替用户拍板）。
#:
#: 「放在表里」的含义是**该类型的默认画幅**：调用方没显式给比例时用它，
#: 显式给了仍然以调用方为准（人物的写死口径除外 —— 它连显式传入也不采纳）。
ASSET_TYPE_ASPECT_RATIOS: dict[str, str] = {
    "character": "16:9",
    "scene": "16:9",
    "prop": "1:1",
}

#: 场景画幅的说明（进响应，供页面标注「本次会用什么画幅、为什么」）
SCENE_RATIO_NOTE = "16:9 是场景资产图的横版建立镜头口径（空间结构看得全）"
#: 道具画幅的说明
PROP_RATIO_NOTE = "1:1 是道具资产图的方图口径（单体完整入画、干净背景）"


def aspect_ratio_for(asset_type: str) -> str | None:
    """该资产类型的**默认画幅**；表里没有该类型时返回 ``None``（不替用户拍板）。"""
    return ASSET_TYPE_ASPECT_RATIOS.get(str(asset_type or "").strip().lower())

# ---------------------------------------------------------------------------
# 出图通道（机器可读 + 中文说明）
# ---------------------------------------------------------------------------
#
# 通道只有两条，取值只有这三个（``mixed`` 只用在"一次请求同时用了两条通道"的汇总上）：
#   vendor_service  上游出图服务（人物及场景生产项目，POST /api/service/asset-image-tasks）
#   apimart         Jellyfish 自己的 APIMart 图片通道（POST {base_url}/images/generations）
#   mixed           本次请求**逐项**用了上面两条（不是第三条通道）
CHANNEL_VENDOR_SERVICE = "vendor_service"
CHANNEL_APIMART = "apimart"
CHANNEL_MIXED = "mixed"

#: 通道的中文名（进响应，页面直接展示「本次用的是哪条通道」）
CHANNEL_LABELS: dict[str, str] = {
    CHANNEL_VENDOR_SERVICE: "上游出图服务",
    CHANNEL_APIMART: "Jellyfish APIMart 图片通道",
    CHANNEL_MIXED: "混合（逐项分流）",
}

#: 真实存在、会产生费用的出图通道（``mixed`` 不在其中：它是汇总口径，不是通道）
REAL_CHANNELS: tuple[str, ...] = (CHANNEL_VENDOR_SERVICE, CHANNEL_APIMART)


def channel_label(channel: str) -> str:
    """通道的中文名（认不出来原样返回，不编造）。"""
    key = str(channel or "").strip()
    return CHANNEL_LABELS.get(key, key)


@dataclass(frozen=True, slots=True)
class AssetImageStrategy:
    """一个资产类型的出图口径（模板 / 画幅 / 结果类型标签）。"""

    asset_type: str
    asset_zh: str
    prompt_slot: PromptCategory
    prompt_template: str
    result_kind: str
    result_label: str
    #: 写死的画幅（人物 = 16:9）；为 None 时按调用方口径 → 类型映射 → 兜底默认
    fixed_aspect_ratio: str | None = None
    #: 该类型的**默认画幅**（来自 :data:`ASSET_TYPE_ASPECT_RATIOS`）；调用方没给比例时用它。
    #: 与 ``fixed_aspect_ratio`` 的区别：这个**允许**调用方显式覆盖，那个不允许。
    default_aspect_ratio: str | None = None
    #: 注册表里没有该类型的槽位规格时的动作姿态兜底。
    #: 道具的正式槽位（``prop_image_front`` / ``prop_image_other``）已补进
    #: ``llm_orchestration.registry``，这条只在注册表异常时才用得上（保留以防 import 环/降级）。
    default_view_hint: str = ""
    #: 「按定版参考图批量出图」是否对该类型开放（只有人物 True）
    batch_reference_allowed: bool = False
    #: 上游服务契约里的 generation_type（服装不在其契约内 → 空串）
    generation_type: str = ""
    #: 画幅说明（人物 / 场景 / 道具各自的口径说明；服装为空）
    ratio_note: str = ""
    #: 出图通道（:data:`CHANNEL_VENDOR_SERVICE` / :data:`CHANNEL_APIMART`）—— 必填口径，
    #: 调用方按它决定"这一项发给谁"，不许自己按类型再写一套 if。
    channel: str = CHANNEL_VENDOR_SERVICE

    @property
    def channel_label(self) -> str:
        """本次用的通道中文名（进响应/日志）。"""
        return channel_label(self.channel)

    @property
    def uses_vendor_service(self) -> bool:
        """是否走上游出图服务（服装走 False）。"""
        return self.channel == CHANNEL_VENDOR_SERVICE

    @property
    def aspect_ratio(self) -> str:
        """该类型**不传画幅**时使用的值：写死口径 → 类型映射 → 管线默认。"""
        return self.fixed_aspect_ratio or self.default_aspect_ratio or DEFAULT_ASPECT_RATIO

    def to_read(self) -> dict[str, Any]:
        """给接口用的只读口径（新增字段，供前端标注「本次会生成什么」。）"""
        return {
            "asset_type": self.asset_type,
            "asset_zh": self.asset_zh,
            "prompt_slot": str(self.prompt_slot.value),
            "prompt_template": self.prompt_template,
            "result_kind": self.result_kind,
            "result_label": self.result_label,
            "aspect_ratio": self.aspect_ratio,
            "aspect_ratio_fixed": self.fixed_aspect_ratio is not None,
            "aspect_ratio_note": self.ratio_note,
            "batch_reference_allowed": self.batch_reference_allowed,
            "generation_type": self.generation_type,
            "channel": self.channel,
            "channel_label": self.channel_label,
        }


#: 与管线既有的默认画幅保持同值（``image_pipeline.DEFAULT_ASPECT_RATIO``）：
#: 这里复写一份常量只是为了避免 import 环（image_pipeline 反过来要 import 本模块）。
DEFAULT_ASPECT_RATIO = "16:9"


STRATEGIES: dict[str, AssetImageStrategy] = {
    "character": AssetImageStrategy(
        asset_type="character",
        asset_zh="角色",
        prompt_slot=PromptCategory.character_image_front,
        prompt_template=TEMPLATE_CHARACTER_REFERENCE_SHEET,
        result_kind=KIND_CHARACTER_REFERENCE,
        result_label="人物参考图",
        # 人物参考图固定 16:9（见模块 docstring 第 2 条：**不是**项目最终视频画幅）
        fixed_aspect_ratio=CHARACTER_REFERENCE_RATIO,
        batch_reference_allowed=True,
        generation_type=client.DEFAULT_GENERATION_TYPE.get("character", ""),
        ratio_note=CHARACTER_REFERENCE_RATIO_NOTE,
    ),
    "scene": AssetImageStrategy(
        asset_type="scene",
        asset_zh="场景",
        prompt_slot=PromptCategory.scene_image_front,
        prompt_template=TEMPLATE_SCENE_ASSET_IMAGE,
        result_kind=KIND_SCENE_ASSET_IMAGE,
        result_label="场景资产图",
        # 场景默认 16:9（需求清单第 2 条）；调用方显式给了比例仍然以调用方为准
        default_aspect_ratio=ASSET_TYPE_ASPECT_RATIOS["scene"],
        ratio_note=SCENE_RATIO_NOTE,
        generation_type=client.DEFAULT_GENERATION_TYPE.get("scene", ""),
    ),
    "prop": AssetImageStrategy(
        asset_type="prop",
        asset_zh="道具",
        prompt_slot=PromptCategory.prop_image_front,
        prompt_template=TEMPLATE_PROP_ASSET_IMAGE,
        result_kind=KIND_PROP_ASSET_IMAGE,
        result_label="道具资产图",
        # 道具默认 **1:1 方图**（需求清单第 2 条）——此前它跟场景/人物一起落到 16:9，
        # 正是"所有资产共用一个比例"这条问题在道具上的具体表现。
        default_aspect_ratio=ASSET_TYPE_ASPECT_RATIOS["prop"],
        ratio_note=PROP_RATIO_NOTE,
        # 道具的**正式槽位**已在注册表里（prompt_slot 指到的就是它）；
        # default_view_hint 只是注册表异常时的降级兜底，正常路径不会用到。
        default_view_hint="道具正面展示，干净背景",
        generation_type=client.DEFAULT_GENERATION_TYPE.get("prop", ""),
    ),
    "costume": AssetImageStrategy(
        asset_type="costume",
        asset_zh="服装",
        prompt_slot=PromptCategory.costume_image_front,
        prompt_template=TEMPLATE_COSTUME_DESIGN_IMAGE,
        result_kind=KIND_COSTUME_DESIGN_IMAGE,
        result_label="服装设定图",
        # 服装不在上游服务端点契约内 → 没有 generation_type（本表不编一个出来）
        generation_type="",
        # 通道分流：服装走 Jellyfish 自己的 APIMart 图片通道（上游服务契约里没有 costume）。
        # 这一条**不是**"降级"，而是唯一正确的通道；把服装发给上游会被对端拒绝，
        # 按人物/场景模板处理更是错上加错。
        channel=CHANNEL_APIMART,
    ),
}

#: 本表覆盖的资产类型（顺序稳定，便于响应/测试断言）
SUPPORTED_ASSET_TYPES: tuple[str, ...] = ("character", "scene", "prop", "costume")

#: 人物专属的结果类型标签 —— 别的类型一律不许用它（有测试钉住）
CHARACTER_ONLY_KINDS: frozenset[str] = frozenset({KIND_CHARACTER_REFERENCE})

#: 兼容：资产类型 → 提示词槽位（既有调用方用的是 image_pipeline.SLOT_BY_ASSET_TYPE）
SLOT_BY_ASSET_TYPE: dict[str, PromptCategory] = {
    key: item.prompt_slot for key, item in STRATEGIES.items()
}

#: 兼容：资产类型 → 上游 generation_type
GENERATION_TYPE_BY_ASSET_TYPE: dict[str, str] = {
    key: item.generation_type for key, item in STRATEGIES.items() if item.generation_type
}


def strategy_for(asset_type: str) -> AssetImageStrategy:
    """取该资产类型的出图口径；不认识的类型**明确报错**（不猜、不按人物处理）。"""
    key = str(asset_type or "").strip().lower()
    strategy = STRATEGIES.get(key)
    if strategy is None:
        raise ValueError(
            f"不支持的 asset_type「{asset_type or '空'}」：按类型分流只覆盖 "
            f"{list(SUPPORTED_ASSET_TYPES)}（不认识的类型会被明确拒绝，不会按人物处理）。"
        )
    return strategy


def supports_batch_reference(asset_type: str) -> bool:
    """该类型是否允许「按定版参考图批量出图」（**只有人物**）。"""
    return strategy_for(asset_type).batch_reference_allowed


def channel_for(asset_type: str) -> str:
    """该资产类型该走哪条出图通道（**唯一**口径；不认识的类型明确报错）。"""
    return strategy_for(asset_type).channel


def describe_channel_for(asset_type: str) -> str:
    """该类型本次会走哪条通道的**中文人话说明**（进响应，不静默分流）。

    服装这一条必须说清"为什么不是上游服务"：上游契约只接受 character/scene/prop，
    把服装按人物/场景发过去正是要避免的"套模板"。
    """
    strategy = strategy_for(asset_type)
    if strategy.channel == CHANNEL_APIMART:
        return (
            f"{strategy.result_label}（{strategy.asset_type}）走 {strategy.channel_label}："
            "上游出图服务（人物及场景生产项目）的契约只接受 character/scene/prop，"
            "服装不在其内，所以本次**不发给上游服务**，也**不会**按人物参考图或场景模板处理；"
            "用的是 Jellyfish 自己的 APIMart 图片通道（参考图重生成同一条通道），只按服装提示词直出。"
        )
    return (
        f"{strategy.result_label}（{strategy.asset_type}）走 {strategy.channel_label}"
        f"（POST /api/service/asset-image-tasks），用该类型自己的模板 "
        f"{strategy.prompt_template}。"
    )


def describe_mixed_channels(asset_types: list[str]) -> str:
    """一次请求里同时出现多条通道时的中文说明（逐项分流，不是"一条通道全包"）。"""
    used: list[str] = []
    for asset_type in asset_types:
        channel = channel_for(asset_type)
        if channel not in used:
            used.append(channel)
    labels = "、".join(channel_label(item) for item in used)
    return (
        f"本次请求同时用到 {len(used)} 条出图通道（{labels}）：**逐项按 asset_type** 选通道与模板，"
        "上游服务只接收 character/scene/prop，服装只走 APIMart 图片通道。"
    )


def is_character_only_kind(kind: str) -> bool:
    """这个结果类型标签是不是人物专属（``characterReference``）。"""
    return str(kind or "").strip() in CHARACTER_ONLY_KINDS


@dataclass(frozen=True, slots=True)
class AspectRatioResolution:
    """一次画幅解析的结论（值 + 来源 + 需要如实回报的警告）。"""

    ratio: str
    source: str
    warning: str = ""


def resolve_aspect_ratio(asset_type: str, requested: str) -> AspectRatioResolution:
    """按类型解析画幅（**唯一**入口，两条出图链路共用）。

    - **人物**：固定 :data:`CHARACTER_REFERENCE_RATIO`（16:9，写死）。调用方传了别的值
      也**不会被采用**，而是给出一条中文警告如实说明被忽略的原值；
    - **场景 / 道具**：调用方传了就用它的（``request``）；没传就用**该类型的**默认画幅
      （``asset_type_default``：场景 16:9、道具 1:1），**不读**项目/镜头的视频比例；
    - **服装**：没有本清单给出的画幅口径 → 调用方传了用它，没传用管线默认（``default``）。

    ``aspect_ratio_source`` 如实回报本次画幅是从哪来的 —— 页面据此说清
    "为什么会是这个比例"，避免"所有资产共用一个比例"这种问题再次静默发生。
    """
    strategy = strategy_for(asset_type)
    clean = str(requested or "").strip()

    if strategy.fixed_aspect_ratio:
        # 人物参考图：写死 16:9，绝不跟随项目 default_video_ratio / 镜头视频比例
        warning = ""
        if clean and clean != strategy.fixed_aspect_ratio:
            warning = (
                f"{strategy.result_label}固定 {strategy.fixed_aspect_ratio}"
                f"（{strategy.ratio_note}）；本次已忽略传入的「{clean}」。"
            )
        return AspectRatioResolution(
            ratio=strategy.fixed_aspect_ratio,
            source=RATIO_SOURCE_CHARACTER_FIXED,
            warning=warning,
        )

    if clean:
        return AspectRatioResolution(ratio=clean, source=RATIO_SOURCE_REQUEST)
    if strategy.default_aspect_ratio:
        return AspectRatioResolution(ratio=strategy.default_aspect_ratio, source=RATIO_SOURCE_ASSET_TYPE_DEFAULT)
    return AspectRatioResolution(ratio=strategy.aspect_ratio, source=RATIO_SOURCE_DEFAULT)


def describe_batch_reference_refusal(asset_type: str) -> str:
    """「参考图批量」对非人物类型的**中文说明**（明确忽略 + 如实回报，不静默）。"""
    strategy = strategy_for(asset_type)
    return (
        f"「按定版参考图批量出图」只对**人物**开放（人物参考图固定 {CHARACTER_REFERENCE_RATIO}，"
        f"用来选一张进「人物参考图库」）；{strategy.result_label}按提示词直接生成，"
        "本次不会带上参考图，也没有按人物口径处理。"
    )


__all__ = [
    "ASSET_TYPE_ASPECT_RATIOS",
    "CHANNEL_APIMART",
    "CHANNEL_LABELS",
    "CHANNEL_MIXED",
    "CHANNEL_VENDOR_SERVICE",
    "CHARACTER_ONLY_KINDS",
    "CHARACTER_REFERENCE_RATIO",
    "CHARACTER_REFERENCE_RATIO_NOTE",
    "DEFAULT_ASPECT_RATIO",
    "GENERATION_TYPE_BY_ASSET_TYPE",
    "KIND_CHARACTER_REFERENCE",
    "KIND_COSTUME_DESIGN_IMAGE",
    "KIND_PROP_ASSET_IMAGE",
    "KIND_SCENE_ASSET_IMAGE",
    "PROP_RATIO_NOTE",
    "RATIO_SOURCE_ASSET_TYPE_DEFAULT",
    "RATIO_SOURCE_CHARACTER_FIXED",
    "RATIO_SOURCE_DEFAULT",
    "RATIO_SOURCE_REQUEST",
    "REAL_CHANNELS",
    "SCENE_RATIO_NOTE",
    "SLOT_BY_ASSET_TYPE",
    "STRATEGIES",
    "SUPPORTED_ASSET_TYPES",
    "AssetImageStrategy",
    "AspectRatioResolution",
    "aspect_ratio_for",
    "channel_for",
    "channel_label",
    "describe_batch_reference_refusal",
    "describe_channel_for",
    "describe_mixed_channels",
    "is_character_only_kind",
    "resolve_aspect_ratio",
    "strategy_for",
    "supports_batch_reference",
]
