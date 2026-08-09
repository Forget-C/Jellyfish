"""CAS 导入台账（import ledger）ORM 模型。

用途：为 EpisodePackage 导入提供**持久化幂等**支撑。每次成功导入写入一行，记录
``(project_id, episode_id, idempotency_key, payload_hash, chapter_id)``，用于：
- 同 project + idempotency_key + 相同 payload_hash → 视为重放，返回既有 chapter，不重复建章节；
- 同 project + idempotency_key + 不同 payload_hash → 冲突失败；
- 同 project + episode_id 已在另一 key 下导入 → 保守拒绝。

边界说明：这是 CAS 边界模块自有的**记账表**，不是平行的 Project/Shot/Asset 业务系统；
它复用 Jellyfish 的 ``Base`` 与既有 ``projects`` / ``chapters`` 表，不复制任何业务实体。
表结构由 `backend/sql/009-add-cas-import-ledger.sql` 迁移创建（经用户批准）。
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin


class CasImportLedger(Base, TimestampMixin):
    """一次 EpisodePackage 导入的持久化记账行。"""

    __tablename__ = "cas_import_ledger"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="台账行 ID（UUID）")
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属项目 ID",
    )
    episode_id: Mapped[str] = mapped_column(String(255), nullable=False, comment="CAS Episode ID")
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False, comment="幂等键")
    payload_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="EpisodePackage 规范化序列化的 SHA-256 十六进制"
    )
    chapter_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="导入产生的 Chapter ID（章节被删除时置空）",
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="imported", comment="导入状态（imported）"
    )
    schema_version: Mapped[str] = mapped_column(
        String(16), nullable=False, default="", comment="EpisodePackage 契约版本"
    )

    __table_args__ = (
        # 同一项目内，一个幂等键唯一 → 支撑重放/冲突判定
        UniqueConstraint("project_id", "idempotency_key", name="uq_cas_import_project_key"),
        # 同一项目内，一个 episode 只导入一次 → 保守拒绝跨 key 重复导入
        UniqueConstraint("project_id", "episode_id", name="uq_cas_import_project_episode"),
        Index("ix_cas_import_payload_hash", "payload_hash"),
    )


__all__ = ["CasImportLedger"]
