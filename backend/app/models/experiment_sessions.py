"""实验室面向用户的会话与消息持久化模型。"""

from __future__ import annotations

from sqlalchemy import JSON, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin


class ExperimentSession(Base, TimestampMixin):
    """承载单一实验室类型的用户可见历史，不参与模型上下文拼接。

    当前系统没有用户和权限领域，因此会话暂为全局数据。后续接入身份体系时，
    需通过独立迁移增加 ``owner_id``、索引和外键，不能复用 ``lab_type`` 代替归属。
    """

    __tablename__ = "experiment_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="会话 ID")
    lab_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True, comment="实验室类型：text/image/video")
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="新会话", comment="用户可见会话标题")
    message_sequence: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
        comment="会话内已分配的最大消息序号",
    )

    # TODO(P2-ownership): 接入用户领域后增加 owner_id，并创建 (owner_id, lab_type, updated_at) 索引。
    # TODO(P2-retention): 归档状态与过期时间应在独立迁移中增加，避免改变当前删除语义。
    __table_args__ = (Index("ix_experiment_sessions_lab_updated", "lab_type", "updated_at"),)


class ExperimentMessage(Base, TimestampMixin):
    """保存会话展示消息、异步任务状态和生成结果快照。"""

    __tablename__ = "experiment_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="消息 ID")
    session_id: Mapped[str] = mapped_column(
        ForeignKey("experiment_sessions.id", ondelete="CASCADE"), nullable=False, index=True, comment="所属会话 ID"
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, comment="会话内消息顺序，从 1 单调递增")
    role: Mapped[str] = mapped_column(String(16), nullable=False, comment="展示角色：user/assistant/task")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="展示文本")
    status: Mapped[str | None] = mapped_column(String(16), nullable=True, comment="异步任务状态")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="实验室特定展示数据")
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True, comment="关联异步任务 ID")

    __table_args__ = (
        Index("ix_experiment_messages_session_created", "session_id", "created_at"),
        Index("ux_experiment_messages_session_sequence", "session_id", "sequence", unique=True),
    )


__all__ = ["ExperimentSession", "ExperimentMessage"]
