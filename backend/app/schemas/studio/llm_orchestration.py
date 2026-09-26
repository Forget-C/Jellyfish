"""LLM 编排层（P1）的请求/响应模型。

设计约定：
- 所有响应都只是**预览**：不落库、不自动建资产；
- ``meta`` 里如实标注本次是 DRY_RUN 占位还是真实 LLM 调用；
- 任何字段都不包含 api_key（见 ``LlmTargetRead``）。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.types import PromptCategory
from app.schemas.studio.shots import ShotPromptCameraInfo, ShotVideoPromptPackRead

EntityTypeLiteral = Literal["character", "scene", "prop"]
FrameModeLiteral = Literal["single_frame", "first_last_frame"]


# ---------------------------------------------------------------------------
# 公共
# ---------------------------------------------------------------------------


class LlmTargetRead(BaseModel):
    """本次调用使用的文本模型目标（**不含 api_key**）。"""

    provider_id: str = Field("", description="供应商 ID")
    provider_name: str = Field("", description="供应商名称")
    model_id: str = Field("", description="模型 ID")
    model_name: str = Field("", description="模型名称")
    base_url: str = Field("", description="Base URL")
    timeout_seconds: int = Field(0, description="超时（秒）")
    api_key_configured: bool = Field(False, description="是否已配置 api_key（不返回内容）")


class LlmRunMeta(BaseModel):
    """一次编排运行的可观测信息。"""

    dry_run: bool = Field(..., description="是否处于 DRY_RUN（true 表示未触网）")
    llm_called: bool = Field(..., description="是否真实调用了 LLM")
    target: LlmTargetRead | None = Field(None, description="文本模型目标")
    latency_ms: int | None = Field(None, description="真实调用耗时（ms）；DRY_RUN 时为 null")
    raw_output_chars: int = Field(0, description="模型原始输出字符数")
    json_repairs: list[str] = Field(default_factory=list, description="JSON 抢救/修复动作")
    json_parse_error: str | None = Field(None, description="JSON 解析失败原因（失败路径）")
    dry_run_reason: str | None = Field(None, description="DRY_RUN 拦截原因")


class EntityProfileInput(BaseModel):
    """调用方传入的实体画像（画像卡输入）。"""

    name: str = Field(..., min_length=1, description="实体名称")
    entity_type: str = Field("character", description="实体类型")
    profile: str = Field("", description="实体画像描述")
    base_prompt: str = Field("", description="已有资产基础提示词（可空）")
    image_prompt: str = Field("", description="已有资产图片提示词（可空）")
    profile_source: str = Field(
        "",
        description=(
            "画像资料的来源（由装载方如实填写，供前端说明「这段描述是从哪来的」）："
            "asset_description=资产描述；candidate_profile=候选结构化资料；"
            "request=调用方直接传入；none=没有任何资料"
        ),
    )


class EntityProfileCardRead(BaseModel):
    """确定性生成的画像卡（同一实体在所有槽位共用，保证一致性）。"""

    name: str
    entity_type: str
    source: Literal["request", "project"]
    profile: str = Field("", description="画像描述")
    canonical_subject: str = Field("", description="用于所有槽位的统一主体描述")
    profile_source: str = Field("", description="画像资料的来源（见 EntityProfileInput.profile_source）")
    has_structured_profile: bool = Field(
        False,
        description="这段画像是否含有可出图的具体资料（false = 只剩空话兜底，不允许保存提示词）",
    )


# ---------------------------------------------------------------------------
# 4.1 实体提取
# ---------------------------------------------------------------------------


class EntityExtractionPreviewRequest(BaseModel):
    """实体提取预览请求。

    ``chapter_id`` 与 ``chapter_text`` 至少给一个；同时给出时以 ``chapter_text`` 为准。
    """

    chapter_id: str | None = Field(None, description="章节 ID（从 DB 读取原文）")
    chapter_text: str | None = Field(None, description="直接传入的剧本/章节文本")
    candidate_names: list[str] = Field(
        default_factory=list,
        description="候选实体名白名单；非空时不在名单内的实体视为幻觉并丢弃",
    )
    max_items: int = Field(40, ge=1, le=200, description="最多返回条数")
    extra_instructions: str = Field("", description="附加要求（可选）")


class EntityDraftItemRead(BaseModel):
    """实体清单草稿项（仅预览，不建实体）。"""

    name: str
    aliases: list[str] = Field(default_factory=list)
    entity_type: EntityTypeLiteral
    profile: str = ""
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    grounded: bool = Field(True, description="名称/别名是否能在原文中找到")
    merged_from: list[str] = Field(default_factory=list, description="被合并进来的原始名称")


class DroppedEntityRead(BaseModel):
    """被确定性后校验丢弃的条目。"""

    name: str = ""
    entity_type: str = ""
    reason: str = ""
    raw: dict[str, Any] = Field(default_factory=dict, description="模型原始条目")


class EntityExtractionPreviewRead(BaseModel):
    """实体提取预览结果（草稿，不落库）。"""

    chapter_id: str | None = None
    source_chars: int = 0
    items: list[EntityDraftItemRead] = Field(default_factory=list)
    dropped: list[DroppedEntityRead] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    meta: LlmRunMeta
    note: str = Field(
        "仅为草稿预览，未创建任何实体；人工确认后走 /studio/entities 现有接口创建。",
        description="边界说明",
    )


# ---------------------------------------------------------------------------
# 4.2 图片提示词生成
# ---------------------------------------------------------------------------


class ImagePromptPreviewRequest(BaseModel):
    """图片提示词预览请求。

    ``shot_id`` 与 ``shot_text`` 至少给一个；``entity_profiles`` 为空时按
    ``project_id``（或镜头所属项目）自动装载实体画像。
    """

    shot_id: str | None = Field(None, description="镜头 ID（用于装载镜头文本与项目实体）")
    shot_text: str | None = Field(None, description="直接传入的镜头文本")
    project_id: str | None = Field(None, description="项目 ID（用于装载实体画像）")
    chapter_id: str | None = Field(
        None,
        description=(
            "章节 ID（资产级常用）：装载实体画像时只读**本章**的章节资料（overlay）。"
            "场景/道具/服装是全局资产，本章的剧情身份、出场依据、临时补充按章节隔离保存，"
            "给上 chapter_id 才不会串到别的章节。"
        ),
    )
    entity_profiles: list[EntityProfileInput] = Field(default_factory=list, description="实体画像（覆盖自动装载）")
    entity_names: list[str] = Field(
        default_factory=list,
        description=(
            "只保留这些名称的实体（在自动装载的画像卡上过滤）。"
            "页面「逐资产生成」用它把一次请求收窄到一个资产，"
            "同时仍然享受 chapter_id 的章节资料加载。"
        ),
    )
    categories: list[PromptCategory] | None = Field(
        None,
        description="需要生成的槽位类别；为空时生成全部默认槽位",
    )
    style_hint: str = Field("", description="风格提示")
    negative_prompt: str = Field("", description="全局负面提示词")
    extra_instructions: str = Field("", description="附加要求（可选）")


class ImagePromptSlotRead(BaseModel):
    """单个槽位的图片提示词。"""

    category: PromptCategory
    label: str = ""
    entity_name: str | None = None
    layers: dict[str, str] = Field(default_factory=dict, description="分层结构：主体/动作/环境/镜头/风格/画质")
    prompt: str = Field("", description="拼接后的完整提示词")
    negative_prompt: str = Field("", description="该槽位的负面提示词")
    design_brief: str = Field(
        "",
        description=(
            "该槽位的**设计口径**（只读，新）：这一段提示词必须写出的具体维度。"
            "服装槽位为「服装设计口径（必须逐项写出）：穿着人物、身份时代、款式、颜色、材质、配饰、使用场合」"
            "（由 asset_profiles 的结构化字段表生成，模型与页面读同一份）；"
            "人物 / 场景 / 道具的既有口径已在各自槽位规则里，本字段为空"
        ),
    )
    warnings: list[str] = Field(default_factory=list)
    #: 这段内容能不能被保存成"提示词已就绪"。后端质量拦截的**同一份判定**，
    #: 前端只负责展示与禁用按钮，不自己重写一套规则。
    savable: bool = Field(True, description="是否通过后端质量拦截（false 时禁止保存 / 批量出图）")
    quality_issues: list[dict[str, Any]] = Field(
        default_factory=list,
        description="未通过的原因（结构化中文：code / message / fix / status_code）",
    )
    structured_source: str = Field(
        "",
        description=(
            "该槽位主体描述的资料来源：asset_description（资产描述）/ candidate_profile（候选结构化资料）"
            "/ request（调用方传入）/ none（没有任何资料，只剩空话兜底）"
        ),
    )


class ImagePromptPreviewRead(BaseModel):
    """图片提示词预览结果（不落库）。"""

    shot_id: str | None = None
    project_id: str | None = None
    shot_text_chars: int = 0
    slots: list[ImagePromptSlotRead] = Field(default_factory=list)
    entity_cards: list[EntityProfileCardRead] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    meta: LlmRunMeta
    note: str = Field("仅为提示词预览，未写入提示词模板表，也未提交任何出图任务。", description="边界说明")


# ---------------------------------------------------------------------------
# 4.3 视频提示词生成
# ---------------------------------------------------------------------------


class VideoPromptPreviewRequest(BaseModel):
    """视频提示词预览请求。"""

    shot_id: str | None = Field(None, description="镜头 ID（用于装载上下文包）")
    shot_text: str | None = Field(None, description="直接传入的镜头文本")
    first_frame_image_ref: str | None = Field(None, description="首帧图引用（URL/文件 ID）")
    last_frame_image_ref: str | None = Field(None, description="尾帧图引用（URL/文件 ID）")
    camera_movement: str | None = Field(None, description="运镜词；会被归一化到标准词库")
    duration_seconds: int | None = Field(None, ge=1, le=60, description="期望时长（秒）")
    frame_mode: FrameModeLiteral | None = Field(None, description="帧模式；给尾帧引用时默认 first_last_frame")
    project_id: str | None = Field(None, description="项目 ID")
    entity_profiles: list[EntityProfileInput] = Field(default_factory=list, description="实体画像（可选）")
    style_hint: str = Field("", description="风格提示")
    negative_prompt: str = Field("", description="全局负面提示词")
    extra_instructions: str = Field("", description="附加要求（可选）")


class CameraMovementResolvedRead(BaseModel):
    """归一化后的运镜词。"""

    key: str = Field("", description="标准运镜词 key")
    label: str = Field("", description="标准中文写法")
    en: str = Field("", description="写进提示词的英文表达")
    enum_code: str | None = Field(None, description="对应 CameraMovement 枚举值；null 表示 DB 无对应值")
    db_note: str = Field("", description="写回 shots 时的注意事项")
    source: Literal["vocab", "fallback"] = Field("vocab", description="来自词库还是兜底")


class VideoPromptPreviewRead(BaseModel):
    """视频提示词预览结果；``pack`` 与 shot_video_prompt_pack 的结构对齐。"""

    shot_id: str | None = None
    title: str = ""
    script_excerpt: str = Field("", description="镜头文本摘录")
    action_beats: list[str] = Field(default_factory=list)
    dialogue_summary: str = ""
    camera: ShotPromptCameraInfo = Field(default_factory=ShotPromptCameraInfo, description="镜头语言（含标准运镜词）")
    camera_movement: CameraMovementResolvedRead = Field(default_factory=CameraMovementResolvedRead)
    frame_mode: FrameModeLiteral = "single_frame"
    duration_seconds: int = 5
    subject_action: str = ""
    expression_mood: str = ""
    atmosphere: str = ""
    first_frame_image_ref: str | None = None
    last_frame_image_ref: str | None = None
    first_frame_handling: str = ""
    last_frame_handling: str = ""
    final_prompt: str = ""
    negative_prompt: str = ""
    visual_style: str = ""
    style: str = ""
    pack: ShotVideoPromptPackRead | None = Field(None, description="镜头上下文包（仅 shot_id 可解析时填写）")
    warnings: list[str] = Field(default_factory=list)
    meta: LlmRunMeta
    note: str = Field("仅为视频提示词预览，未提交任何视频生成任务。", description="边界说明")


# ---------------------------------------------------------------------------
# P2 资产绑定预览
# ---------------------------------------------------------------------------

BindingSlotLiteral = Literal["characters", "scene", "props", "costumes"]
BindingAgreementLiteral = Literal["both", "llm_only", "conflict", "heuristic_only"]
BindingTierLiteral = Literal["auto", "review", "discard"]


class AssetBindingPreviewRequest(BaseModel):
    """P2 资产绑定预览请求。"""

    project_id: str = Field(..., min_length=1, description="项目 ID")
    episode_id: str = Field("", description="集数标识（仅用于提示词）")
    shot_ids: list[str] = Field(default_factory=list, description="指定镜头；为空表示整个项目")
    batch_size: int = Field(8, ge=1, le=20, description="每批镜头数")
    max_shots: int = Field(40, ge=1, le=200, description="本次最多处理的镜头数")
    include_heuristic: bool = Field(True, description="是否计算启发式第二意见用于对账")
    extra_instructions: str = Field("", description="附加要求（可选）")


class BindingCandidateRead(BaseModel):
    """候选资产（asset_id 只能从这里选）。"""

    asset_id: str
    asset_type: str = Field(..., description="character / scene / prop / costume")
    name: str
    aliases: list[str] = Field(default_factory=list)
    description: str = ""


class BindingSuggestionRead(BaseModel):
    """单条绑定建议（**仅供人工确认，本接口不写库**）。"""

    slot: BindingSlotLiteral
    asset_id: str
    asset_type: str
    asset_name: str = ""
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    reason: str = ""
    agreement: BindingAgreementLiteral = Field("llm_only", description="与启发式/已有绑定的对账结果")
    tier: BindingTierLiteral = Field("review", description="auto=默认勾选 / review=人工复核 / discard=折叠")
    already_bound: bool = Field(False, description="该镜头是否已绑定此资产")
    confirm_endpoint: str = Field("", description="人工确认时调用的现有写库端点（本接口不调用）")


class BindingDroppedRead(BaseModel):
    """被后校验丢弃的绑定条目。"""

    shot_id: str = ""
    slot: str = ""
    asset_id: str = ""
    reason: str = ""


class BindingUnmatchedRead(BaseModel):
    """镜头里出现但候选清单没有的实体（只展示，不自动建资产）。"""

    shot_id: str = ""
    name: str = ""
    guessed_type: str = ""
    evidence: str = ""


class AssetBindingShotRead(BaseModel):
    """单个镜头的绑定预览。"""

    shot_id: str
    index: int = 0
    title: str = ""
    script_excerpt: str = ""
    suggestions: list[BindingSuggestionRead] = Field(default_factory=list)
    heuristic_suggestions: dict[str, list[str]] = Field(default_factory=dict, description="启发式第二意见")
    bound: dict[str, list[str]] = Field(default_factory=dict, description="当前已绑定的资产 ID")
    warnings: list[str] = Field(default_factory=list)


class AssetBindingPreviewRead(BaseModel):
    """P2 资产绑定预览结果。"""

    project_id: str
    catalog: list[BindingCandidateRead] = Field(default_factory=list)
    shots: list[AssetBindingShotRead] = Field(default_factory=list)
    dropped: list[BindingDroppedRead] = Field(default_factory=list)
    unmatched_names: list[BindingUnmatchedRead] = Field(default_factory=list)
    parse_warnings: list[str] = Field(default_factory=list)
    batch_count: int = 0
    batch_size: int = 0
    tier_summary: dict[str, int] = Field(default_factory=dict, description="auto/review/discard 计数")
    errors: list[str] = Field(default_factory=list, description="按批次的失败明细（不中断其他批次）")
    cost_note: str = ""
    meta: LlmRunMeta
    note: str = Field(
        "仅为绑定建议预览，未写入任何关联表；确认后请调用 suggestions[].confirm_endpoint 指向的现有端点。",
        description="边界说明",
    )
