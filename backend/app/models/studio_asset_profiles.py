"""第 2 步「资产准备」的**持久化结构**：章节资产资料 + 生成记录。

为什么要专用表（用户 2026-09 明示）
====================================

改造前，整章结构化资产清单只活在**进程内缓存**里，章节资料则塞在
``shot_extracted_candidates.payload.chapter_overlay`` 这个"借用"的 JSON 列上。
带来三个正式使用不可接受的后果：

1. **付费结果会丢**：后端一重启，缓存没了，确认动作只能让用户**再花一次钱**重新分析；
2. **重新提取会清空**：``/script-processing/extract`` 会 ``replace_for_shot`` 删掉该镜头的
   候选行再重建，挂在候选行上的 overlay 随之消失 —— 人工改过的资料一起没了；
3. **没有变更信号**：剧本改了也无从判断"库里这份资料是哪一版剧本生成的"。

所以这里落两张表（**数据库是事实来源，进程内缓存降级为纯性能优化**）：

``chapter_asset_profiles``（一章一资产一行，**按项目 + 章节隔离**）
    资产类型 / 规范名称 / 别名 / 结构化画像 / 人工修改 / 用户补充 /
    剧本片段与分镜依据 / 已关联的真实资产 ID / 剧本来源签名 / 生成状态与时间。

``chapter_asset_profile_runs``（一次"整章分析"一行）
    内容签名（``cache_key``）、来源摘要、生成方式（是否真的调了模型 / 是否演练）、
    运行元信息，以及技术详情（原始候选聚合、别名合并过程、被丢弃的模型条目）。
    ``cache_key`` 与当前"章节原文 + 分镜 + 附加要求"算出来的签名不一致时，
    这份清单就被标记为**内容已变化，建议重新分析** —— 由用户决定是否覆盖。

边界（与既有约定一致，一个字都没放松）
======================================

- 本表里的资料**只属于该项目 + 该章节**；场景/道具/服装是全局资产，
  更新它们的通用资料仍必须走 ``global_asset_updates`` 的差异预览 + 显式确认；
- 本表**不存**图片、不存定版标记、不存人工提示词（``image_prompts``）；
  确认流程连图片表都不碰，所以"顺手确认把定版图换掉"在结构上不可能发生。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin

#: 记录状态（页面与技术详情都用这一套口径）
STATUS_GENERATED = "generated"
STATUS_CONFIRMED = "confirmed"
STATUS_PENDING_CHANGE = "pending_change"
STATUS_MISSING_IN_LATEST = "missing_in_latest"

#: 生成记录状态
RUN_STATUS_GENERATED = "generated"
RUN_STATUS_STALE = "stale"

STATUS_LABELS: dict[str, str] = {
    STATUS_GENERATED: "已生成（待确认）",
    STATUS_CONFIRMED: "已确认（已关联真实资产）",
    STATUS_PENDING_CHANGE: "内容已变化，待你决定覆盖 / 合并 / 保留",
    STATUS_MISSING_IN_LATEST: "最近一次分析没有提到它（已保留，未删除）",
    RUN_STATUS_GENERATED: "已生成",
    RUN_STATUS_STALE: "内容已变化，建议重新分析",
}


class ChapterAssetProfileRun(Base, TimestampMixin):
    """一次「整章结构化资产清单」生成记录（章节级）。

    存在的意义：**判断"库里这份清单是不是当前剧本那一版"**，并如实记录
    这次清单是真实调了模型、还是演练占位；两者都不需要再去问模型。
    """

    __tablename__ = "chapter_asset_profile_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="生成记录自增 ID")
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属项目 ID（隔离维度之一）",
    )
    chapter_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属章节 ID（隔离维度之二）",
    )
    cache_key: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="",
        index=True,
        comment="内容签名：章节原文 + 分镜 + 附加要求的 sha256；与当前签名不一致即「内容已变化」",
    )
    source_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="",
        comment="剧本/分镜来源摘要的 sha256（与 cache_key 同源，单独留一份便于阅读）",
    )
    source_summary: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="来源摘要：剧本字数、分镜数、分镜序号列表、章节标题",
    )
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=RUN_STATUS_GENERATED,
        index=True,
        comment="generated=当前剧本这一版；stale=剧本/分镜已变化，建议重新分析",
    )
    item_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="本次清单资产条数")
    llm_called: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, comment="本次是否真的调用了文本模型（演练模式为 False）"
    )
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="本次是否为演练模式")
    extra_instructions: Mapped[str] = mapped_column(
        String(512), nullable=False, default="", comment="本次附加要求（参与内容签名）"
    )
    meta: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict, comment="运行元信息（模型名/耗时/是否演练；不含任何密钥）"
    )
    technical: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict, comment="技术详情：候选聚合、别名合并过程、被丢弃条目、提示词摘要"
    )
    warnings: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list, comment="本次的如实警告")
    generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="本次生成时间"
    )
    stale_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="检测到内容变化的时间"
    )
    stale_reason: Mapped[str] = mapped_column(
        String(255), nullable=False, default="", comment="内容变化的中文说明（给用户看）"
    )

    __table_args__ = (
        Index("ix_chapter_asset_profile_runs_chapter_status", "chapter_id", "status"),
    )


class ChapterAssetProfile(Base, TimestampMixin):
    """**一章一个资产一行**的章节资产资料（按项目 + 章节隔离的持久化载体）。

    字段语义（"模型写的" 与 "人写的" 刻意分开存，谁也不覆盖谁）：

    - ``profile``：模型产出（或演练占位）的结构化画像 —— **章节范围**，
      含本章特有的时间/天气/光线/状态/场合等字段；
    - ``manual_overrides``：**人工修改**（字段级覆盖）；
    - ``user_notes``：**用户补充**（自由文本条目）；
    - 最终生效画像 = ``profile`` ⊕ ``manual_overrides``（见
      :func:`app.services.studio.chapter_asset_record_store.effective_profile`）；
    - ``pending_*``：新一次分析的结果，**只在行已被确认或人工改过时**才写入；
      由用户显式选择 覆盖 / 合并 / 保留之后才生效 —— 重新提取不会静默冲掉人工成果。
    """

    __tablename__ = "chapter_asset_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="资料行自增 ID")
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属项目 ID（隔离维度之一）",
    )
    chapter_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属章节 ID（隔离维度之二）",
    )
    asset_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="资产类型：character/scene/prop/costume",
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="规范名称（模型确认过的写法）")
    name_key: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="归一化名称（去空格/大小写/标点），用于唯一约束与匹配"
    )
    aliases: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, comment="别名（同一资产的不同写法，合并后保留全部来源）"
    )
    profile: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict, comment="结构化画像（模型产出；章节范围，含本章特有字段）"
    )
    manual_overrides: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict, comment="人工修改（字段级覆盖，模型数据永不覆盖它）"
    )
    user_notes: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, comment="用户补充（自由文本条目，按时间追加）"
    )
    shot_refs: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, comment="分镜依据：镜头 id / 序号 / 标题 / 命中的别名 / 原文摘录"
    )
    evidence: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, comment="剧本片段依据（含是否能在原文逐字找到 grounded）"
    )
    merge_sources: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, comment="别名合并过程：每个来源条目的原始名称 / 字段 / 依据"
    )
    plot_identity: Mapped[str] = mapped_column(
        Text, nullable=False, default="", comment="本章剧情身份（这一章里它是什么）"
    )
    temporary_notes: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, comment="本章特有的临时补充（时间天气/状态/场合等）"
    )
    asset_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True, comment="已关联的真实资产 ID（角色/场景/道具/服装通用）"
    )
    link_action: Mapped[str] = mapped_column(
        String(32), nullable=False, default="", comment="最近一次确认动作：create_new / link_existing"
    )
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=STATUS_GENERATED,
        index=True,
        comment="generated / confirmed / pending_change / missing_in_latest",
    )
    source_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, default="", comment="这份资料对应的剧本/分镜签名"
    )
    source_summary: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict, comment="剧本/分镜来源摘要（字数、分镜数、命中的镜头序号）"
    )
    pending_profile: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict, comment="新一次分析的结构化画像（待用户决定覆盖/合并/保留）"
    )
    pending_aliases: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list, comment="新一次分析的别名")
    pending_shot_refs: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list, comment="新一次分析的分镜依据")
    pending_evidence: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list, comment="新一次分析的剧本依据")
    pending_source_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, default="", comment="新一次分析的剧本/分镜签名"
    )
    pending_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="新一次分析发现变化的时间"
    )
    generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="这份资料最近一次来自模型的时间"
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="最近一次确认（建/绑资产）时间"
    )
    manual_edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="最近一次人工修改时间（非空即视为受保护，重新分析不覆盖）"
    )
    run_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("chapter_asset_profile_runs.id", ondelete="SET NULL"),
        nullable=True,
        comment="最近一次生成它的分析记录 ID",
    )

    __table_args__ = (
        UniqueConstraint("chapter_id", "asset_type", "name_key", name="uq_chapter_asset_profile_key"),
        Index("ix_chapter_asset_profiles_chapter_status", "chapter_id", "status"),
    )


__all__ = [
    "STATUS_CONFIRMED",
    "STATUS_GENERATED",
    "STATUS_LABELS",
    "STATUS_MISSING_IN_LATEST",
    "STATUS_PENDING_CHANGE",
    "RUN_STATUS_GENERATED",
    "RUN_STATUS_STALE",
    "ChapterAssetProfile",
    "ChapterAssetProfileRun",
]
