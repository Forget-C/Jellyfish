"""独立项目画布及同事务保存回执；运行和布局不属于编辑文档。"""
from typing import Any
from sqlalchemy import ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.models.base import TimestampMixin


class GenerationCanvas(Base, TimestampMixin):
    """当前文档，revision 只由完整文档 CAS 保存推进。"""
    __tablename__ = 'generation_canvases'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    card_types: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)


class CanvasSaveReceipt(Base):
    """保存效果和原回执一起提交；重放不受后续编辑影响。"""
    __tablename__ = 'generation_canvas_save_receipts'
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
