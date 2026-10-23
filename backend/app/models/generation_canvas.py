"""独立项目画布及同事务保存回执；运行和布局不属于编辑文档。"""
from typing import Any
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
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


class CanvasEventHead(Base):
    """独立提交序列互斥行；所有事件写入及一致快照先锁此行。"""
    __tablename__ = 'generation_canvas_event_heads'
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True)
    cursor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CanvasRun(Base, TimestampMixin):
    """运行只记录生命周期，不给整次执行计算成功等级。"""
    __tablename__ = 'generation_canvas_runs'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), index=True)
    lifecycle: Mapped[str] = mapped_column(String(16), nullable=False, default='active')
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    scope: Mapped[list] = mapped_column(JSON, nullable=False)


class CanvasRunNode(Base):
    """固定依据及累计成果；秘密路由保存在服务端私有快照与 Task 输入中。"""
    __tablename__ = 'generation_canvas_run_nodes'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey('generation_canvas_runs.id', ondelete='CASCADE'), index=True)
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), index=True)
    card_id: Mapped[str] = mapped_column(String(64), nullable=False)
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    execution_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default='queued')
    stage: Mapped[str] = mapped_column(String(64), nullable=False, default='queued')
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False, default='')
    basis: Mapped[dict] = mapped_column(JSON, nullable=False)
    basis_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    outputs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    result_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_output_updated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class CanvasScopeOccupancy(Base):
    """执行节点原子占用，直到真实终态才释放。"""
    __tablename__ = 'generation_canvas_occupancies'
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True)
    card_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    node_id: Mapped[str] = mapped_column(ForeignKey('generation_canvas_run_nodes.id', ondelete='CASCADE'))


class CanvasResultSet(Base):
    """完整成功结果独立于编辑文档，保留实际模型与输入来源。"""
    __tablename__ = 'generation_canvas_result_sets'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), index=True)
    node_id: Mapped[str] = mapped_column(ForeignKey('generation_canvas_run_nodes.id', ondelete='CASCADE'))
    card_id: Mapped[str] = mapped_column(String(64), nullable=False)
    basis_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    basis: Mapped[dict] = mapped_column(JSON, nullable=False)
    outputs: Mapped[list] = mapped_column(JSON, nullable=False)


class CanvasCurrentOutput(Base):
    """当前成功成果的指向；有效性按实际使用依据核实。"""
    __tablename__ = 'generation_canvas_current_outputs'
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True)
    card_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    result_set_id: Mapped[str] = mapped_column(ForeignKey('generation_canvas_result_sets.id', ondelete='CASCADE'))


class CanvasPreview(Base):
    """短期预检凭据只绑定摘要，不携带公开的供应商秘密。"""
    __tablename__ = 'generation_canvas_previews'
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), index=True)
    card_id: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default='single')
    card_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    basis_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[Any] = mapped_column(DateTime, nullable=False)


class CanvasRunReceipt(Base):
    """受理运行与原回执一起提交；原身份重放先于当前修订检查。"""
    __tablename__ = 'generation_canvas_run_receipts'
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response: Mapped[dict] = mapped_column(JSON, nullable=False)


class CanvasEvent(Base):
    """画布内提交顺序由 head 锁序列化，不能使用全局自增 ID 代替。"""
    __tablename__ = 'generation_canvas_events'
    canvas_id: Mapped[str] = mapped_column(ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True)
    cursor: Mapped[int] = mapped_column(Integer, primary_key=True)
    envelope: Mapped[dict] = mapped_column(JSON, nullable=False)
