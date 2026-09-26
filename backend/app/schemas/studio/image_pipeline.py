"""P3 出图管线（出图服务 HTTP 对接 / 提示词包导出）的请求与响应模型。

约定：
- 所有 preview 接口**不触网**；
- 所有 submit 接口默认走 DRY_RUN，返回 ``dry_run: true`` 的占位结果；
- 任何字段都不包含 provider 的 api_key。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AssetTypeLiteral = Literal["character", "scene", "prop", "costume"]
StageLiteral = Literal["character_sheet", "reference_batch"]
PackageFormatLiteral = Literal["json", "text", "markdown"]


# ---------------------------------------------------------------------------
# 公共
# ---------------------------------------------------------------------------


class ReferenceImageRead(BaseModel):
    """定版参考图解析结果（默认主流程按提示词直接生成，不需要它）。"""

    asset_id: str
    asset_type: str
    file_id: str = ""
    url: str = Field("", description="对象存储公共地址（OSS URL 优先）")
    view_angle: str = ""
    quality_level: str = ""
    is_primary: bool = Field(False, description="是否为人工定版主图")
    resolved_from: str = Field("", description="is_primary / fallback")
    warnings: list[str] = Field(default_factory=list)


class SubmissionTargetRead(BaseModel):
    """一个待提交给出图服务的单资产单图任务（预览用）。"""

    source_task_id: str = Field(..., description="幂等键；同资产同提示词重复提交不会重复出图")
    source_asset_id: str
    asset_type: str
    name: str = ""
    prompt: str = ""
    stage: str = ""
    negative_prompt: str = ""
    style_tags: list[str] = Field(default_factory=list)
    reference_image: str = Field(
        "",
        description=(
            "随请求一起发出的**已有参考图**地址（定版主图）。为空＝纯提示词生成，"
            "这正是默认主流程的常态（按提示词直接生成参考图，不需要已有图）"
        ),
    )
    generation_type: str = ""
    aspect_ratio: str = ""
    image_model: str = ""
    object_key_template: str = ""
    prompt_source: str = Field(
        "template",
        description="提示词来源：request（调用方显式传）/ saved（已保存的 image_prompts）/ template（确定性模板）",
    )
    result_kind: str = Field(
        "",
        description=(
            "本类型的结果类型标签（新，机器可读）：characterReference（**仅人物**）/ "
            "sceneAssetImage / propAssetImage / costumeDesignImage"
        ),
    )
    result_label: str = Field(
        "", description="结果类型的中文标签（新）：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图"
    )
    aspect_ratio_source: str = Field(
        "",
        description=(
            "本类型画幅的来源（新）：character_reference_fixed（人物参考图写死 16:9）/ "
            "request（调用方传入）/ asset_type_default（类型映射：场景 16:9、道具 1:1）/ "
            "default（管线默认）"
        ),
    )
    prompt_template: str = Field("", description="本类型使用的提示词模板名（新，审计用）")
    channel: str = Field(
        "",
        description=(
            "本项使用的出图通道（新，机器可读，由 asset_type 分流决定）："
            "vendor_service＝上游出图服务（人物/场景/道具）；"
            "apimart＝Jellyfish 自己的 APIMart 图片通道（服装不在上游契约内，走这条）"
        ),
    )
    channel_label: str = Field("", description="本项出图通道的中文名（新）：上游出图服务 / Jellyfish APIMart 图片通道")
    generation_basis: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "本次生成依据（新，只读）：项目风格 / 该资产的结构化资料（按项目 + 章节持久化保存）/ "
            "剧本片段与出场分镜 / 资料来自哪里。页面「生成依据」面板直接读它，"
            "所以在**还没生成**的时候也能看到这份资产到底有什么资料 —— 不依赖先花一次模型调用。"
        ),
    )
    warnings: list[str] = Field(default_factory=list)


class ImageTaskResultRead(BaseModel):
    """一次出图提交的结果。

    字段口径（故障 B 的归一化，2026-09-19 真实验收）：

    - ``status`` 保留**上游原文**（``partial_failed`` 这类真话必须让用户看到），
      旧的 ``ok`` / ``message`` 字段一个都没删，只增不减；
    - ``outcome`` 是**归一化口径**（新字段，调用方只需认这一组取值）：
      ``ok`` / ``partial_failed``（图片已生成但 OSS / 落库没完成）/ ``running`` /
      ``failed`` / ``dry_run`` / ``unknown``；
    - ``ok`` 不再对 ``partial_failed`` 恒为 true —— 部分失败必须能被调用方识别；
    - ``error_message`` / ``detail.error_message`` 优先装**上游真正的原因**
      （``detail.error_message``），不再被笼统的 ``message`` 盖掉。
    """

    source_task_id: str
    source_asset_id: str
    asset_type: str = ""
    stage: str = ""
    service_task_id: str = ""
    status: str = Field("", description="上游原文状态（如 queued / completed / partial_failed）")
    outcome: str = Field(
        "",
        description=(
            "归一化口径（新）：ok / partial_failed / running / failed / dry_run / unknown；"
            "partial_failed = 图片已生成但 OSS 上传或落库没完成，绝不能当成功"
        ),
    )
    ok: bool = True
    dry_run: bool = False
    image_url: str = Field("", description="出图服务的本地/临时地址（非长期资产）")
    oss_url: str = Field("", description="长期资产地址；DRY_RUN 下为空")
    oss_ready: bool = Field(False, description="是否拿到了可用作长期资产的地址（新，布尔）")
    result_kind: str = Field(
        "",
        description=(
            "结果类型标签（新，机器可读，由 asset_type 分流决定）：characterReference（**仅人物**）/ "
            "sceneAssetImage / propAssetImage / costumeDesignImage"
        ),
    )
    result_label: str = Field("", description="结果类型的中文标签（新）：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图")
    aspect_ratio: str = Field(
        "",
        description=(
            "本次结果使用的画幅（新）：人物 / 场景 16:9、道具 1:1"
            "（人物参考图固定 16:9，不是项目最终视频画幅）"
        ),
    )
    aspect_ratio_source: str = Field(
        "",
        description=(
            "画幅来源（新）：character_reference_fixed / request / asset_type_default / default"
        ),
    )
    channel: str = Field(
        "",
        description=(
            "本项实际使用的出图通道（新，如实回报，不静默）："
            "vendor_service（上游出图服务）/ apimart（Jellyfish APIMart 图片通道）"
        ),
    )
    channel_label: str = Field("", description="本项出图通道的中文名（新）")
    message: str = Field("", description="可展示的一句话说明（失败时优先装真实原因）")
    error_message: str = Field("", description="失败/部分失败的真实原因（新，优先取上游 error_message）")
    http_status: int | None = Field(None, description="上游报错时的 HTTP 状态码（新；取不到为空）")
    detail: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "结构化明细（新）：error_message（上游原文）、http_status、oss_url、local_path、"
            "images 等；页面优先读这里的 error_message"
        ),
    )


class ImageServiceStatusRead(BaseModel):
    """出图服务对接状态。"""

    base_url: str
    configured_env: str
    guard: dict[str, Any]
    service_asset_types: list[str]
    generation_types: dict[str, str]
    channels: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "资产类型 → 出图通道（新）：character/scene/prop＝vendor_service（上游出图服务），"
            "costume＝apimart（Jellyfish 自己的 APIMart 图片通道）。"
            "页面据此说明「服装为什么不在上游服务里」"
        ),
    )
    channel_notes: list[str] = Field(
        default_factory=list, description="通道分流的中文说明（新）"
    )
    probe: dict[str, Any] | None = Field(None, description="真实健康探测结果；DRY_RUN 下为 null")
    probe_skipped_reason: str = Field("", description="未探测的原因")


# ---------------------------------------------------------------------------
# 请求
# ---------------------------------------------------------------------------


class PromptOverride(BaseModel):
    """调用方用 P1 生成的逐槽位提示词覆盖确定性提示词。"""

    asset_id: str
    prompt: str


class ImageSubmitItemRequest(BaseModel):
    """**混合批量**的一项：一个资产类型 + 要出图的资产 ID（新）。

    为什么要有它：一次提交里可以同时含 character / scene / prop / costume，
    后端会**逐项**按 ``asset_type`` 选通道与模板（人物/场景/道具 → 上游出图服务；
    服装 → Jellyfish APIMart 图片通道）。**不传 items 时仍是旧的单类型形态**
    （顶层 ``asset_type`` + ``asset_ids``），既有调用方一个字都不用改。

    每项只声明"生成什么类型的哪些资产"；``stage`` / 画幅 / 负面提示词 / 图片模型 /
    attempt 等公共参数由请求顶层给出（避免同一批里出现互相矛盾的公共参数）。
    """

    asset_type: AssetTypeLiteral = Field(..., description="character / scene / prop / costume")
    asset_ids: list[str] = Field(default_factory=list, description="为空表示项目内该类型全部资产")
    prompt_overrides: list[PromptOverride] = Field(
        default_factory=list, description="该项的逐资产提示词覆盖（用 P1 生成的提示词）"
    )


class ImageChannelPlanRead(BaseModel):
    """一个资产类型分组的**通道与模板口径**（新，页面直接展示「这一组发给了谁」）。"""

    asset_type: str
    asset_ids: list[str] = Field(default_factory=list)
    channel: str = Field("", description="vendor_service / apimart")
    channel_label: str = ""
    channel_note: str = Field("", description="中文说明：本次用的是哪条通道、为什么")
    result_kind: str = ""
    result_label: str = ""
    prompt_template: str = ""
    target_count: int = Field(0, description="本组的提交目标数（整数）")
    warnings: list[str] = Field(default_factory=list)


class ImagePlanPreviewRequest(BaseModel):
    """出图提交计划预览请求（不触网）。"""

    project_id: str = Field(..., min_length=1)
    asset_type: AssetTypeLiteral = Field(
        "character",
        description=(
            "单类型形态的资产类型。**四类都支持**：人物/场景/道具走上游出图服务，"
            "服装走 Jellyfish 自己的 APIMart 图片通道（上游契约里没有 costume）。"
            "传了 items 时本字段被忽略。"
        ),
    )
    items: list[ImageSubmitItemRequest] = Field(
        default_factory=list,
        description=(
            "**混合批量**（新，可选）：一次提交里逐项声明资产类型与资产，后端逐项按 asset_type 选通道与模板。"
            "为空时按旧的单类型形态处理（asset_type + asset_ids）"
        ),
    )
    stage: StageLiteral = Field(
        "character_sheet",
        description=(
            "character_sheet＝不随请求带参考图；reference_batch＝随请求带上已定版的参考图"
            "（两者都是按提示词直接生成参考图，不需要已有图；**参考图只对人物开放**）"
        ),
    )
    asset_ids: list[str] = Field(default_factory=list, description="为空表示项目内该类型全部资产")
    prompt_overrides: list[PromptOverride] = Field(default_factory=list, description="用 P1 生成的提示词覆盖")
    use_primary_reference: bool = Field(
        True, description="reference_batch 阶段是否把定版主图作为参考图随请求发出"
    )
    aspect_ratio: str = Field("", description="出图比例，如 16:9")
    image_model: str = Field("", description="图片模型选项（留空=默认 image2 → provider 模型 gpt-image-2）")
    negative_prompt: str = Field("", description="全局负面提示词")
    chapter_id: str = Field(
        "",
        description=(
            "章节 ID（可选，新）：给了就按**该章**装配 generation_basis（章节资产资料的隔离维度）；"
            "留空则不装配生成依据，其它行为完全不变"
        ),
    )


class ImageSubmitRequest(ImagePlanPreviewRequest):
    """出图提交请求（受 DRY_RUN 守卫）。"""

    wait_seconds: float = Field(0.0, ge=0.0, le=120.0, description="有界等待产物秒数；0 表示不等")
    attempt: int = Field(
        0,
        ge=0,
        le=99,
        description=(
            "尝试序号（新，可选，默认 0 = 首轮）。**重试失败项时把这个数 +1**："
            "幂等键 source_task_id 会把非 0 的序号混进哈希，于是拿到一个**新的**键，"
            "上游才会真的重新出图（改动前只哈希 项目+类型+资产+提示词前 8 位，"
            "同一资产同一提示词重试永远被上游按既有失败任务去重 → 重试无效）。"
            "**同一序号重复提交＝同一个幂等键**：上游按既有任务返回，不会并发重复下单"
            "（页面侧的「在途」闸门继续负责拦住同一轮里的连点）。"
            "本次实际使用的幂等键会逐条回显在结果的 source_task_id 上"
        ),
    )


class ImagePlanPreviewRead(BaseModel):
    """出图提交计划预览。"""

    project_id: str
    asset_type: str = Field(..., description="单类型形态的类型；混合批量（items）时为 mixed")
    stage: str
    channel: str = Field(
        "",
        description=(
            "本次请求按 asset_type 分流后会**涉及**的出图通道（新）：vendor_service / apimart；"
            "一次请求同时涉及两条时为 mixed（逐项分流，不是第三条通道）。"
            "逐条目标自己的通道在 targets[].channel，整数计数在 summary.by_channel"
        ),
    )
    channel_label: str = Field("", description="本次通道的中文名（新）")
    channel_notes: list[str] = Field(
        default_factory=list,
        description="通道分流的中文说明（新）：哪一类走哪条通道、为什么（服装不在上游契约内）",
    )
    groups: list[ImageChannelPlanRead] = Field(
        default_factory=list, description="逐类型分组的通道/模板口径（新，混合批量时逐组一条）"
    )
    targets: list[SubmissionTargetRead] = Field(default_factory=list)
    references: list[ReferenceImageRead] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    strategy: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "本次按 asset_type 分流的出图口径（新）：result_kind / result_label / aspect_ratio / "
            "aspect_ratio_fixed / aspect_ratio_note / prompt_template / batch_reference_allowed / channel"
        ),
    )
    dry_run: bool = Field(True, description="当前守卫状态；preview 永远不触网")
    note: str = Field(
        "仅为提交计划预览，未调用出图服务；确认后走 POST /image-pipeline/submit。",
        description="边界说明",
    )


class ImageSubmitRead(BaseModel):
    """出图提交结果。"""

    project_id: str
    asset_type: str = Field(..., description="单类型形态的类型；混合批量（items）时为 mixed")
    stage: str
    channel: str = Field(
        "",
        description=(
            "本次请求按 asset_type 分流后会**涉及**的出图通道（新）：vendor_service / apimart / "
            "mixed（同时涉及两条）。**实际产出的**每条结果各自带 channel，"
            "整数计数在 summary.by_channel —— 混批时以逐条结果为准"
        ),
    )
    channel_label: str = Field("", description="本次通道的中文名（新）")
    channel_notes: list[str] = Field(default_factory=list, description="通道分流的中文说明（新）")
    groups: list[ImageChannelPlanRead] = Field(
        default_factory=list, description="逐类型分组的通道/模板口径（新）"
    )
    results: list[ImageTaskResultRead] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    outcome: str = Field(
        "",
        description=(
            "本次提交的整体归一化口径（新）：ok（全部成功）/ partial_failed（有成功也有失败，"
            "或存在图片已生成但 OSS 未就绪）/ failed（全部失败）/ running（还有未完成）/ "
            "dry_run / empty"
        ),
    )
    warnings: list[str] = Field(default_factory=list)
    guard_status: str = ""
    note: str = Field(
        "DRY_RUN 下为占位结果；真实模式下结果由出图服务上传 OSS，"
        "oss_url 才是长期资产地址（image_url 仅为本地/临时地址）。"
        "summary 里的 ok_count / failed_count / oss_ready_count / by_channel 是整数计数，"
        "outcome=partial_failed 表示「图片已生成但 OSS 未就绪」，不是成功。",
        description="边界说明",
    )


class AdoptImageRequest(BaseModel):
    """把生成出来的图片采纳进资产图片槽位（断点③：刷新后仍在）。"""

    entity_type: str = Field(..., description="资产类型：character / scene / prop / costume / actor")
    entity_id: str = Field(..., min_length=1, description="资产 ID")
    url: str = Field(..., min_length=1, description="生成图片的可访问地址（不能是 DRY_RUN 占位地址）")
    image_id: int | None = Field(None, description="目标图片槽位 ID；为空则复用该资产第一个槽位，没有就新建")
    set_primary: bool = Field(
        False,
        description=(
            "是否同时设为定版主图。**默认 false**（改动前默认 true）：不传就不会设版——"
            "因为不传 image_id 时复用的是第一个槽位，而它常常就是当前定版那一行，"
            "旧默认值会让「再采纳一次」静默把定版图换掉"
        ),
    )
    confirm_replace_primary: bool = Field(
        False,
        description=(
            "显式确认替换定版图。该资产**已有定版图**（is_primary 且已绑图）而本次会顶掉它时"
            "必须传 true，否则返回结构化 409（meta.error 里带将被替换那张图的只读摘要）；"
            "没有定版图 / 不碰定版那一行时可以一直不传"
        ),
    )
    name: str = Field("", description="入库文件名（可空）")


class AdoptImageRead(BaseModel):
    """采纳结果。"""

    entity_type: str
    entity_id: str
    image_id: int
    file_id: str
    url: str = Field(..., description="落库后可访问地址（资产页与实际使用的就是这个）")
    source_url: str = Field("", description="采纳时传入的来源地址，仅供溯源")
    is_primary: bool = False
    name: str = ""
    url_reachable: bool | None = Field(
        None,
        description=(
            "落库地址是否**匿名公网可达**（新）：true=上游/浏览器都能匿名取到这张图；"
            "false=不可达（本机地址或对象未公开读，后续当参考图交给上游会被 404 拒绝）；"
            "null=未验证（演练模式，或驱动没有产出可验证的公网地址）"
        ),
    )
    url_probe: dict[str, Any] = Field(
        default_factory=dict,
        description="可达性验证明细（新）：http_status / probe_method / reason / how_to_fix",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="采纳过程中的如实提醒（新）：例如「已入库但匿名访问不可达」及其修法",
    )
    replaced_primary: dict[str, Any] | None = Field(
        None,
        description=(
            "本次采纳**顶掉了哪张旧定版图**（新）：image_id（槽位 id）/ file_name（文件名）/ "
            "url_is_public（是否 OSS 公网地址）。没有替换过旧定版时为 null；"
            "摘要里不含 file_id、不含凭证、不含本机绝对路径"
        ),
    )
    note: str = Field(
        "已写入 files 与对应图片槽位；刷新资产页即可看到，并可作为后续出图的参考图使用。",
        description="边界说明",
    )


# ---------------------------------------------------------------------------
# 「使用已有参考图重新生成」（可选返工流程；默认主流程仍是 /submit 按提示词直接生成）
# ---------------------------------------------------------------------------


class ReferenceRegenerateRequest(BaseModel):
    """「使用已有参考图重新生成」请求（**可选返工**，不是默认主流程）。

    默认主流程是按提示词**直接生成参考图**（``POST /image-pipeline/submit``，不传参考图也
    照样出图）。本请求只在「该资产已经有参考图、且用户明确要保一致性」时才用：它走
    Jellyfish 自己的 APIMart 图片通道，把公网可用的参考图真的传进请求。
    """

    project_id: str = Field(..., min_length=1)
    asset_type: AssetTypeLiteral = Field(
        "character",
        description="character / scene / prop / costume（本端点不经过上游服务端点，所以 costume 也可用）",
    )
    asset_id: str = Field(..., min_length=1, description="资产 ID")
    prompt: str = Field("", description="留空则用该资产**已保存**的图片提示词（image_prompts 槽位）")
    reference_image_id: int | None = Field(
        None,
        description="已有参考图的槽位 id（图片行 ID）。与 reference_url 二选一；都不传则用该资产的定版/首选图",
    )
    reference_url: str = Field(
        "",
        description="显式指定已有参考图的公网地址（http/https）。与 reference_image_id 二选一",
    )
    target_ratio: str = Field(
        "",
        description=(
            "画幅比例（APIMart 只支持 1:1 / 3:4 / 16:9）。**人物参考图固定 16:9**："
            "人物传别的值会被忽略并如实回报（16:9 是人物参考图/设定图的画幅，不是项目最终视频画幅）；"
            "场景/道具/服装按各自既有口径，留空=16:9 默认"
        ),
    )
    resolution_profile: Literal["standard", "high"] = Field("standard", description="输出分辨率档位")
    model_id: str | None = Field(None, description="图片模型 ID；留空用 DB 的默认图片模型（必须是 APIMart 供应商）")
    attempt: int = Field(
        0,
        ge=0,
        le=99,
        description=(
            "尝试序号（语义与 POST /submit 的 attempt 一致）：同一序号＝同一轮，"
            "**重复点击不会重复付费**（同一轮直接复用上一次结果）；要真的再生成一次请 +1"
        ),
    )
    timeout_seconds: float = Field(600.0, ge=1.0, le=3600.0, description="同步等待的墙钟上限")


class ReferenceRegenerateRead(BaseModel):
    """「使用已有参考图重新生成」结果。

    ``results`` / ``summary`` / ``outcome`` / ``warnings`` / ``guard_status`` 与默认主流程
    （``ImageSubmitRead``）**同名同形**，前端可以复用同一套结果卡片。
    """

    project_id: str
    asset_type: str
    asset_id: str
    asset_name: str = ""
    prompt: str = ""
    prompt_source: str = Field("", description="request（请求里传的）/ saved（该资产已保存的提示词）")
    reference_image_id: int | None = Field(None, description="用到的参考图槽位 id（按资产首选图解析时为空）")
    reference_url: str = Field("", description="**真正送进请求**的公网参考图地址（会进 image_urls）")
    reference_label: str = Field("", description="参考图的可读名（页面文案用这个；不含 file_id）")
    reference_source: str = Field(
        "",
        description="参考图来源：slot（指定槽位）/ explicit_url（显式地址）/ asset_primary（该资产定版图）/ asset_fallback",
    )
    attempt: int = 0
    deduplicated: bool = Field(
        False, description="同一轮（同一 source_task_id）重复点击 → 直接复用上一轮结果，没有再次调用供应商、没有再次计费"
    )
    source_task_id: str = Field("", description="本次（或复用的上一轮）的幂等键")
    provider: str = ""
    model_id: str = ""
    model_name: str = ""
    base_url: str = ""
    api_key_configured: bool = False
    result_kind: str = Field(
        "",
        description=(
            "本次结果类型标签（新，机器可读，按 asset_type 分流）：characterReference（**仅人物**）/ "
            "sceneAssetImage / propAssetImage / costumeDesignImage"
        ),
    )
    result_label: str = Field("", description="本次结果类型的中文标签（新）：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图")
    aspect_ratio: str = Field(
        "", description="本次使用的画幅（新）：人物/场景 16:9、道具 1:1（人物参考图固定 16:9，不是项目最终视频画幅）"
    )
    aspect_ratio_source: str = Field(
        "",
        description=(
            "画幅来源（新）：character_reference_fixed / request / asset_type_default / default"
        ),
    )
    prompt_template: str = Field("", description="本次使用的提示词模板名（新，审计用）")
    results: list[ImageTaskResultRead] = Field(default_factory=list, description="与默认主流程同形的单条出图结果")
    summary: dict[str, Any] = Field(default_factory=dict)
    outcome: str = ""
    warnings: list[str] = Field(default_factory=list)
    guard_status: str = ""
    paid_call_made: bool = Field(
        False, description="本次是否真的发出了供应商调用（演练 / 被拦 / 复用上一轮时为 false）"
    )
    note: str = Field(
        "这是可选的返工流程（用已有参考图重生成）。默认主流程是按提示词直接生成参考图"
        "（POST /studio/image-pipeline/submit），不需要参考图。"
        "结果地址是供应商返回的临时地址；要长期保存请走「采纳」落库。",
        description="边界说明",
    )


class ImageTaskQueryRead(BaseModel):
    """出图任务查询结果（回读 OSS 地址）。"""

    service_task_id: str
    status: str = ""
    oss_url: str = ""
    local_path: str = ""
    images: list[dict[str, Any]] = Field(default_factory=list)
    error_message: str = ""
    dry_run: bool = False


# ---------------------------------------------------------------------------
# 提示词包导出
# ---------------------------------------------------------------------------


class PromptPackageRequest(BaseModel):
    """提示词包导出请求（只读，不落库、不出图）。"""

    project_id: str = Field(..., min_length=1)
    shot_ids: list[str] = Field(default_factory=list, description="为空表示项目内全部镜头（上限见 max_shots）")
    max_shots: int = Field(20, ge=1, le=100)
    include_image_prompts: bool = Field(True)
    include_video_prompts: bool = Field(True)
    include_bindings: bool = Field(True)
    format: PackageFormatLiteral = Field("json", description="同时返回 json；text/markdown 为附带的渲染结果")


class PromptPackageShotRead(BaseModel):
    """单个镜头的提示词包条目。"""

    shot_id: str
    index: int = 0
    title: str = ""
    script_excerpt: str = ""
    bound_assets: dict[str, list[str]] = Field(default_factory=dict, description="已绑定资产（按槽位）")
    image_prompts: list[dict[str, Any]] = Field(default_factory=list, description="逐槽位图片提示词")
    video_prompt: dict[str, Any] | None = Field(None, description="视频提示词（含首尾帧与运镜）")
    references: list[ReferenceImageRead] = Field(default_factory=list, description="可作参考图的定版资产")
    warnings: list[str] = Field(default_factory=list)


class PromptPackageRead(BaseModel):
    """提示词包导出结果。"""

    project_id: str
    shots: list[PromptPackageShotRead] = Field(default_factory=list)
    rendered_text: str = ""
    rendered_markdown: str = ""
    warnings: list[str] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    note: str = Field("仅为提示词包预览，未写入任何表、未提交任何出图/出视频任务。", description="边界说明")


# ---------------------------------------------------------------------------
# 直提出视频
# ---------------------------------------------------------------------------


class VideoSubmitPlanRequest(BaseModel):
    """直提出视频的计划预览请求（不触网、不建任务）。"""

    shot_id: str = Field(..., min_length=1)
    reference_mode: str = Field(
        "first",
        description="参考图模式，对齐既有契约：first / last / key / first_last / first_last_key / text_only",
    )
    prompt: str = Field("", description="留空则由 P1 视频提示词服务生成")
    images: list[str] = Field(default_factory=list, description="显式参考图；为空则按 mode 解析")
    ratio: str = Field("", description="视频比例")
    duration_seconds: int | None = Field(None, ge=1, le=60)
    generate_audio: bool | None = Field(
        None,
        description="是否让模型自带音频（供应商开关，seedance 默认 true）。"
        "设为 false 时模型不会自己生成音频，便于验证参考音频是否被采用。",
    )


class VideoSubmitRequest(VideoSubmitPlanRequest):
    """直提出视频（受 DRY_RUN 守卫；默认被拦截）。"""

    timeout_seconds: float = Field(120.0, ge=1.0, le=3600.0, description="同步等待的墙钟上限")


class VideoPlanFrameRead(BaseModel):
    """本次视频请求**实际使用**的一个参考帧。

    注意区分：绑定资产图片只是生成这些帧的**上游素材**，真正发给视频模型的是这里的 file_id。
    """

    role: str = Field("", description="参考模式里的位置：first / last / key")
    frame_type: str = Field("", description="shot_frame_images.frame_type")
    file_id: str = ""
    url: str = Field("", description="可用于展示/预检的地址（公网优先，其次 files 下载路由）")
    usable: bool = Field(
        False,
        description=(
            "**供应商口径**是否可用：只有能变成 http(s):// / asset:// 引用（或该供应商接受的形态）"
            "才算 true。本地相对地址只能变成本机 data URL，对 APIMart 属于不可用"
        ),
    )
    ref_kind: str = Field(
        "missing",
        description="引用形态：public（公网）/ local_data_url（本地，只能变 data URL）/ missing / not_found / unreadable",
    )
    reason: str = Field("", description="不可用时的具体原因（可直接展示给用户）")


class VideoAudioPlanRead(BaseModel):
    """本次请求的**参考音频**准入结论（可审计）。

    术语（别和"最终成片的音轨"混为一谈）：

    - **参考音频**：作为**输入**进供应商请求（``audio_urls``）。本字段回答的正是
      "本次请求会不会带它、带的是哪个地址、没带是为什么"；
    - **最终成片的音轨**：成片里那条轨，来自供应商侧 ``generate_audio``（模型自己生成）；
      把已生成的音频混流/回贴成成片音轨是**另一条路径**，当前未实现。

    准入口径：只有**公网 http(s)** 或 **``asset://``** 才允许进入请求；本机相对路径 /
    内网地址 / 供应商不接受的 data URL 在计划层就被排除（带 ``excluded_reason``）。
    """

    included: bool = Field(False, description="本次请求是否真的会携带参考音频（会进 audio_urls）")
    file_id: str = Field("", description="绑定的音频 file_id（未绑定时为空）")
    url: str = Field(
        "",
        description="**真正会进请求**的地址（公网 http(s) / asset:// / 供应商接受的 data URL）；未携带时为空",
    )
    declared_url: str = Field(
        "",
        description="绑定解析出的原始地址（可能是本机/内网/data URL，仅供技术详情，不会发给供应商）",
    )
    excluded_reason: str = Field(
        "",
        description="未携带时的原因：未绑定 / 本机相对路径 / 内网地址 / 供应商不吃 data URL / 供应商不接受参考音频…",
    )
    reason_code: str = Field(
        "",
        description=(
            "机器可读原因码：not_bound / opt_out / file_missing / vendor_unsupported / no_address / "
            "local_path / private_address / data_url_rejected；已携带时为空"
        ),
    )
    how_to_fix: str = Field("", description="未携带时的补救办法（可操作）")
    state: str = Field(
        "",
        description=(
            "准入状态：public_url / asset_ref / data_url_inline（以上三者=携带）/ not_bound / opt_out / "
            "file_missing / vendor_unsupported / no_address / local_path / private_address / data_url_rejected"
        ),
    )
    vendor_supports_reference_audio: bool = Field(
        False, description="当前供应商/模型是否声明接受参考音频（seedance 2.0 系列为 true）"
    )
    note: str = Field("", description="术语澄清：参考音频（输入）≠ 最终成片音轨（输出侧 generate_audio）")


class VideoSubmitPlanRead(BaseModel):
    """直提出视频的计划预览。"""

    shot_id: str
    provider: str = ""
    model_id: str = ""
    model_name: str = ""
    base_url: str = ""
    api_key_configured: bool = False
    reference_mode: str = ""
    reference_image_count: int = 0
    prompt: str = ""
    prompt_source: str = Field("", description="request / llm_orchestration")
    ratio: str = ""
    seconds: int | None = None
    resolution: str = Field("", description="分辨率档位；固定策略默认 480p")
    required_frame_types: list[str] = Field(
        default_factory=list, description="当前参考模式要求的帧类型（first/last/key）"
    )
    frames: list[VideoPlanFrameRead] = Field(
        default_factory=list, description="本次请求实际使用的参考帧（file_id 级）"
    )
    missing_frame_types: list[str] = Field(
        default_factory=list, description="当前模式下**槽位没有 file_id** 的帧类型；非空时不允许真实生成"
    )
    unusable_frame_types: list[str] = Field(
        default_factory=list,
        description=(
            "有 file_id 但**供应商取不到**的帧类型（例如本地地址只能变 data URL，而 APIMart 只收 "
            "http(s):// / asset://）；与 missing 一样会阻止生成，需在前端区分提示"
        ),
    )
    generation_blocked: bool = Field(
        False, description="是否被参考帧拦截（缺帧或帧供应商不可用；页面据此禁用真实生成）"
    )
    blocked_reason: str = ""
    audio_file_id: str = Field("", description="本次请求携带的音频 file_id（空表示未携带）")
    audio_url: str = Field("", description="音频地址（仅公网地址会被发送给供应商）")
    audio_opt_out: bool = Field(False, description="本镜是否明确标记无需声音")
    audio_state: str = Field("", description="bound（已绑且可用）/ bound_not_public / missing / opt_out")
    audio: VideoAudioPlanRead = Field(
        default_factory=VideoAudioPlanRead,
        description=(
            "参考音频审计（只增字段）：included / file_id / url / excluded_reason —— "
            "本次请求是否携带音频、带的是哪个地址、没带是为什么"
        ),
    )
    model_pinned: bool = Field(True, description="是否命中固定模型策略（seedance-2.0-mini）")
    provider_supported: bool = Field(True, description="provider 是否在既有的 openai/volcengine/apimart 白名单内")
    warnings: list[str] = Field(default_factory=list)
    guard_status: str = ""
    note: str = "仅为提交计划预览，未创建任何生成任务、未调用任何视频 provider。"


class VideoSubmitRead(BaseModel):
    """直提出视频结果。"""

    shot_id: str
    provider: str = ""
    status: str = ""
    provider_task_id: str = ""
    url: str = Field("", description="视频地址（临时地址，长期资产需落 OSS）")
    file_persisted: bool = Field(False, description="本次调用是否已把视频落库（直接提交路径不落库）")
    elapsed_ms: int = 0
    error: str = ""
    warnings: list[str] = Field(default_factory=list)
    guard_status: str = ""
    note: str = (
        "直接提交路径不写库：结果地址仅在本响应中返回。"
        "需要长期资产请把该地址接入既有落库流程（files / shot.generated_video_file_id）。"
    )


# ---------------------------------------------------------------------------
# 镜头分镜帧（关键帧 / 首帧 / 尾帧）出图 —— 同进程内联执行
# ---------------------------------------------------------------------------

FrameTypeLiteral = Literal["first", "key", "last"]


class FrameSubmitPlanRequest(BaseModel):
    """关键帧出图的计划请求（不触网、不写库）。"""

    shot_id: str = Field(..., min_length=1)
    frame_type: FrameTypeLiteral = Field(
        "key",
        description="first | key | last，与 shot_frame_images.frame_type 一致",
    )
    prompt: str = Field(
        "",
        description="留空则用镜头里**已保存**的该帧提示词（shot_details.first/key/last_frame_prompt）",
    )
    images: list[str] = Field(
        default_factory=list,
        description="显式参考图 file_id 列表；留空则用该镜头绑定资产（角色/场景/道具/服装）的定版图",
    )
    target_ratio: str = Field("", description="留空则按 镜头 override_video_ratio → 项目默认 → 16:9 解析")
    resolution_profile: Literal["standard", "high"] = "standard"
    model_id: str | None = None


class FrameSubmitRequest(FrameSubmitPlanRequest):
    """关键帧出图提交（受 DRY_RUN 守卫；同进程内联执行）。"""

    timeout_seconds: float = Field(900.0, ge=1.0, le=3600.0, description="同步等待的墙钟上限")


class FrameSubmitPlanRead(BaseModel):
    """关键帧出图计划：提示词来源、参考图、画幅、供应商，**都不触网**。"""

    shot_id: str
    frame_type: str
    prompt: str = ""
    prompt_source: str = Field(
        "", description="saved（镜头已保存的帧提示词）/ request（调用方显式传入）/ empty（两者都没有）"
    )
    reference_file_ids: list[str] = Field(default_factory=list, description="实际会送出的参考图 file_id")
    reference_labels: list[str] = Field(
        default_factory=list,
        description=(
            "与 reference_file_ids 一一对应的**可读名**（新）：例如「角色「林晓」的定版图」/"
            "「显式指定的参考图 1」。页面文案只用这个，不要把 file_id 显示给用户。"
        ),
    )
    reference_count: int = 0
    target_ratio: str = ""
    target_ratio_source: str = Field("", description="shot / project / default")
    resolution_profile: str = "standard"
    provider: str = ""
    model_id: str = ""
    model_name: str = ""
    base_url: str = ""
    api_key_configured: bool = False
    image_slot_id: int | None = Field(None, description="shot_frame_images 行 ID（不存在时为空，提交时会创建）")
    warnings: list[str] = Field(default_factory=list)
    guard_status: str = ""
    dry_run: bool = True
    note: str = "仅为计划预览，未创建任何生成任务、未调用任何图片 provider。"


class FrameSubmitRead(BaseModel):
    """关键帧出图结果（同进程内联执行后的真实产物与落库情况）。"""

    shot_id: str
    frame_type: str
    status: str = Field("", description="dry_run / succeeded / failed / timeout / blocked / rejected_before_submit")
    dry_run: bool = False
    task_id: str = Field("", description="Jellyfish 内部任务 ID（任务中心可见）")
    provider: str = ""
    provider_task_id: str = ""
    image_url: str = Field("", description="本次生成的图片地址（OSS/公网优先，可能为供应商临时地址）")
    file_id: str = Field("", description="落库后的 files.id；未落库为空")
    image_slot_id: int | None = None
    prompt: str = ""
    prompt_source: str = ""
    reference_file_ids: list[str] = Field(default_factory=list)
    provider_notes: list[str] = Field(
        default_factory=list,
        description="供应商/适配层的如实说明（例如垫片回传「参考图未透传」）",
    )
    elapsed_ms: int = 0
    error: str = ""
    warnings: list[str] = Field(default_factory=list)
    guard_status: str = ""
    note: str = (
        "本接口在同进程内联执行一次图片生成（不走 Celery 队列）；"
        "成功后结果会写进 shot_frame_images.file_id + file_usages，刷新后仍在。"
    )
