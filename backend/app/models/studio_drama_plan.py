"""「广告剧情流程」的**草稿表**：``drama_plan_drafts``（一章一行）。

它存在的原因（与 ``shot_video_prompt_drafts`` 同一类问题）
========================================================

流程是：填商品卖点（免费）→ 点「生成剧情方案」（**真实付费，一次模型调用**）→
人工编辑 → 显式确认 → 落成正式章节/分镜/资产。

如果没有这张表，付费产出的方案只活在浏览器内存里：刷新 / 切走 / 中断就全丢，
用户已经付过费的结果无法恢复（``shot_video_prompt_drafts`` 正是为同一个坑落的表）。
草稿落库后：刷新能恢复、中断能续跑、失败能单独重试。

与正式产物的边界（硬约束）
==========================

- 本表**只放草稿**，确认之前**不落任何正式行**（项目/章节/资产/分镜只有一套正式产物）；
- 写正式产物只有一条路：``POST /studio/chapters/{id}/drama-plan/confirm``（materialize）；
- 人工编辑直接改 ``plan`` JSON 列，不改任何正式列。

对「未开始不落行」先例的**唯一有意偏离**
========================================

``shot_video_prompt_drafts`` 的做法是"没有行 = 未开始"。本表做不到，因为
**保存 brief 是免费的、且必须持久**（用户填一半就要能存下来、刷新还在），
所以行由 brief 保存创建，而"有没有生成过""生成中""失败"由 ``status`` 表达：

- ``""``（空串）= 行有了（brief 已保存）但**从未生成过**；
- ``running`` = 生成中，带租约；
- ``ok`` = 已生成，``plan`` 里有归一化后的草稿；
- ``failed`` = 生成失败，``error`` 里有原因。

租约（``claim_token`` / ``claim_expires_at``）沿用既有做法：防的正是
"重复点击 = 重复付费"，到期自动可抢，避免进程被杀后永久卡住。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import DramaPlanDraftStatus


class DramaPlanDraft(Base, TimestampMixin):
    """一章一份的剧情方案草稿（主键 = ``chapter_id``，与章节 1:1）。"""

    __tablename__ = "drama_plan_drafts"

    chapter_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        primary_key=True,
        comment="章节 ID（一章一份方案；与 chapters.id 共享主键）",
    )
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属项目 ID（冗余，便于按项目一次查出全部集的方案）",
    )
    brief: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="用户输入的商品与导演要求（DramaBrief）；保存 brief **永不触发模型调用**",
    )
    plan: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="模型产物归一化后的草稿（DramaPlan）；**只有生成成功才写**，演练与失败都不写",
    )
    status: Mapped[DramaPlanDraftStatus] = mapped_column(
        String(16),
        nullable=False,
        default=DramaPlanDraftStatus.none,
        comment='草稿状态：""（未生成）/ running（生成中，带租约）/ ok / failed',
    )
    error: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        comment="失败原因（供页面展示与重试定位；空 = 没有失败）",
    )
    model: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        default="",
        comment="本次生成使用的模型名（便于对账费用）",
    )
    meta: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="运行元信息（latency_ms / warnings / dry_run / llm_called 等；不含任何密钥）",
    )
    claim_token: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="当前「生成中」租约的持有者令牌（空 = 没有进行中的生成）",
    )
    claim_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="租约到期时间；到期后允许重新抢占（避免中断后永久卡住）",
    )

    chapter: Mapped["Chapter"] = relationship()
    project: Mapped["Project"] = relationship()

    __table_args__ = (
        Index("ix_drama_plan_drafts_status", "status"),
    )


__all__ = ["DramaPlanDraft"]
