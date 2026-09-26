"""「广告剧情流程」的请求 / 响应 DTO。

为什么单独一个文件而不是塞进 ``schemas/studio/llm_orchestration.py``：
那条链路上的三个预览服务（实体提取 / 图片提示词 / 视频提示词）共用一套
「输入 → 预览 → meta」形状；剧情方案则是**一次调用产出一整份结构化草稿**，
字段量与嵌套层级都不同，混在一起会让两边都难读。

边界（与全量方案一致）
======================

- ``DramaBrief`` 是**用户输入**：免费保存，永不触发模型调用；
- ``DramaPlanDraft`` 是**模型产物的归一化结果**：只存 ``drama_plan_drafts.plan`` 草稿列，
  确认之前不落任何正式行；
- 落正式产物只有 ``confirm`` 一条路（见 ``drama_plan_materialize``）。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

#: 默认镜头数（与「典型 6 镜」的用户口径一致；``generate`` 会把它写进提示词）
DEFAULT_SHOT_COUNT = 6


class DramaBrief(BaseModel):
    """商品与导演要求（用户填写）。"""

    model_config = ConfigDict(extra="forbid")

    product_name: str = Field("", description="商品名称（同时用作自动建章节时的标题）")
    product_description: str = Field("", description="商品外观描述（会作为商品资产的外观描述）")
    selling_points: list[str] = Field(default_factory=list, description="卖点列表")
    target_audience: str = Field("", description="目标人群")
    genre: str = Field("", description="题材（与项目 style 对齐，缺省沿用项目）")
    tone: str = Field("", description="调性（例如：一本正经地荒诞 / 温情 / 爽感）")
    duration_seconds: int = Field(0, description="整片目标时长（秒），0 = 由镜头数与档位推算")
    shot_count: int = Field(DEFAULT_SHOT_COUNT, description="期望镜头数")
    brand_voice: str = Field("", description="品牌调性 / 品牌规则")
    mandatory_elements: list[str] = Field(default_factory=list, description="必须出现的内容")
    forbidden_elements: list[str] = Field(default_factory=list, description="禁止出现的内容")
    director_notes: str = Field("", description="导演备注（本次的额外要求）")


class DramaPlanDialogueDraft(BaseModel):
    """一句台词（对应正式产物 ``shot_dialog_lines`` 的一行）。"""

    model_config = ConfigDict(extra="forbid")

    speaker: str = Field("", description="说话角色名（必须出现在 characters 里）")
    text: str = Field("", description="台词内容")
    mode: str = Field("DIALOGUE", description="DIALOGUE / VOICE_OVER / OFF_SCREEN / PHONE")


class DramaPlanShotDraft(BaseModel):
    """一个镜头（对应正式产物 ``shots`` + ``shot_details`` + ``shot_dialog_lines``）。"""

    model_config = ConfigDict(extra="forbid")

    index: int = Field(1, description="镜头序号（章节内唯一）")
    title: str = Field("", description="镜头标题")
    characters: list[str] = Field(
        default_factory=list, description="本镜出场角色名（必须出现在 characters 里；决定建哪些镜头↔角色关联）"
    )
    script_excerpt: str = Field("", description="剧本摘录（写进 shots.script_excerpt）")
    description: str = Field("", description="镜头整体描述（写进 shot_details.description）")
    duration: int = Field(0, description="时长（秒，已归一到允许档位）")
    camera_shot: str = Field("", description="景别 code（ECU/CU/MCU/MS/MLS/LS/ELS）")
    angle: str = Field("", description="机位 code（EYE_LEVEL/HIGH_ANGLE/...）")
    movement: str = Field("", description="运镜 code（STATIC/PAN/...）")
    action_beats: list[str] = Field(default_factory=list, description="动作拍点（按时间顺序）")
    dialogue: list[DramaPlanDialogueDraft] = Field(default_factory=list, description="本镜台词")
    product_present: bool = Field(False, description="本镜是否出现商品（决定是否建 shot 档关联行）")


class DramaPlanNamedAssetDraft(BaseModel):
    """角色 / 场景 / 商品共用的草稿形状。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="名称（正式产物里是 name 列）")
    profile: dict[str, str] = Field(default_factory=dict, description="结构化资料（键见 asset_profiles）")
    shot_indexes: list[int] = Field(default_factory=list, description="出现在哪些镜头（仅草稿信息）")


class DramaPlanProductDraft(DramaPlanNamedAssetDraft):
    """商品草稿（比角色/场景多一个外观描述，直接落 products.description）。"""

    description: str = Field("", description="商品外观描述")


class DramaPlanDraft(BaseModel):
    """模型产物归一化后的完整草稿。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field("", description="标题（落 chapters.title）")
    logline: str = Field("", description="一句话主线（落 chapters.summary）")
    selling_points: list[str] = Field(default_factory=list, description="被剧情化后的卖点")
    characters: list[DramaPlanNamedAssetDraft] = Field(default_factory=list)
    scenes: list[DramaPlanNamedAssetDraft] = Field(default_factory=list)
    product: DramaPlanProductDraft | None = Field(None, description="商品（缺省 = 本次没有商品）")
    shots: list[DramaPlanShotDraft] = Field(default_factory=list)
    climax: str = Field("", description="结尾反转 / 高潮")
    warnings: list[str] = Field(default_factory=list, description="归一化过程中的如实警告")


class DramaPlanRead(BaseModel):
    """草稿读取（``GET`` 与 ``generate`` 共用同一形状）。"""

    model_config = ConfigDict(extra="forbid")

    chapter_id: str = ""
    project_id: str = ""
    has_draft: bool = Field(False, description="是否已保存过 brief（即草稿行是否存在）")
    status: str = Field("", description='""（未生成）/ running / ok / failed')
    brief: DramaBrief = Field(default_factory=DramaBrief)
    plan: DramaPlanDraft | None = Field(None, description="归一化后的草稿；未生成过则为 null")
    error: str = Field("", description="失败原因")
    model: str = Field("", description="本次生成使用的模型名")
    meta: dict[str, Any] = Field(default_factory=dict, description="运行元信息（不含任何密钥）")
    claim_expires_at: str = Field("", description="生成中租约的到期时间（ISO 串，空 = 无租约）")
    updated_at: str = Field("", description="草稿行最后更新时间（ISO 串）")
    note: str = Field("", description="边界说明")


class DramaPlanConfirmRead(BaseModel):
    """确认落库结果（materialize）。"""

    model_config = ConfigDict(extra="forbid")

    chapter_id: str = ""
    shots_created: int = 0
    dialog_lines_created: int = 0
    characters_created: int = 0
    scenes_created: int = 0
    product_created: bool = False
    shot_product_links: int = Field(0, description="带商品的镜头数（用于「至少一半镜头」核对）")
    shot_character_links: int = 0
    warnings: list[str] = Field(default_factory=list)
    note: str = Field("", description="边界说明（由服务层填，路由同时放进 meta）")


__all__ = [
    "DEFAULT_SHOT_COUNT",
    "DramaBrief",
    "DramaPlanConfirmRead",
    "DramaPlanDialogueDraft",
    "DramaPlanDraft",
    "DramaPlanNamedAssetDraft",
    "DramaPlanProductDraft",
    "DramaPlanRead",
    "DramaPlanShotDraft",
]
