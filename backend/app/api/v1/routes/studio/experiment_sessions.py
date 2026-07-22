"""实验室会话与用户可见消息历史接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import GenerationTask, GenerationTaskStatus
from app.schemas.common import ApiResponse, created_response, empty_response, success_response
from app.schemas.studio.experiment_sessions import (
    ExperimentMessageCreate,
    ExperimentMessageRead,
    ExperimentMessageUpdate,
    ExperimentSessionCreate,
    ExperimentSessionRead,
    ExperimentSessionUpdate,
    LabType,
)
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages

router = APIRouter()

# TODO(P2-authorization): 用户体系落地后，为本路由统一注入 current_user，
# 并将每个 session_id 查询收敛为 owner_id 过滤，避免仅在单个端点补鉴权。
# TODO(P2-audit): 会话删除和清空历史需要记录操作者、目标会话、原因与时间。


async def _serialize_experiment_session(session: ExperimentSession, db: AsyncSession) -> ExperimentSessionRead:
    """补充会话列表所需的最近消息摘要与运行中任务标识。"""
    latest_message = await db.scalar(
        select(ExperimentMessage)
        .where(ExperimentMessage.session_id == session.id)
        .order_by(ExperimentMessage.sequence.desc())
        .limit(1)
    )
    running_task = await db.scalar(
        select(ExperimentMessage.id)
        .join(GenerationTask, GenerationTask.id == ExperimentMessage.task_id)
        .where(
            ExperimentMessage.session_id == session.id,
            GenerationTask.status.in_([
                GenerationTaskStatus.pending,
                GenerationTaskStatus.running,
                GenerationTaskStatus.streaming,
            ]),
        )
        .limit(1)
    )
    preview = latest_message.content.strip()[:80] if latest_message and latest_message.content else None
    return ExperimentSessionRead.model_validate(session).model_copy(
        update={
            "last_message_preview": preview,
            "has_running_task": running_task is not None,
        }
    )


@router.post("", response_model=ApiResponse[ExperimentSessionRead], status_code=status.HTTP_201_CREATED)
async def create_experiment_session(body: ExperimentSessionCreate, db: AsyncSession = Depends(get_db)) -> ApiResponse[ExperimentSessionRead]:
    """创建仅用于展示历史的新实验会话。"""
    session = ExperimentSession(id=str(uuid.uuid4()), lab_type=body.lab_type, title=body.title.strip())
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return created_response(ExperimentSessionRead.model_validate(session))


@router.get("", response_model=ApiResponse[list[ExperimentSessionRead]])
async def list_experiment_sessions(lab_type: LabType = Query(...), db: AsyncSession = Depends(get_db)) -> ApiResponse[list[ExperimentSessionRead]]:
    """按实验室类型读取最近更新的会话列表。"""
    rows = (await db.execute(select(ExperimentSession).where(ExperimentSession.lab_type == lab_type).order_by(ExperimentSession.updated_at.desc()))).scalars().all()
    return success_response([await _serialize_experiment_session(row, db) for row in rows])


@router.patch("/{session_id}", response_model=ApiResponse[ExperimentSessionRead])
async def update_experiment_session(session_id: str, body: ExperimentSessionUpdate, db: AsyncSession = Depends(get_db)) -> ApiResponse[ExperimentSessionRead]:
    """更新会话标题。"""
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Experiment session not found")
    session.title = body.title.strip()
    await db.commit()
    await db.refresh(session)
    return success_response(ExperimentSessionRead.model_validate(session))


@router.get("/{session_id}/messages", response_model=ApiResponse[list[ExperimentMessageRead]])
async def list_experiment_messages(session_id: str, db: AsyncSession = Depends(get_db), page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)) -> ApiResponse[list[ExperimentMessageRead]]:
    """分页读取一个会话的用户可见消息历史。"""
    if await db.get(ExperimentSession, session_id) is None:
        raise HTTPException(status_code=404, detail="Experiment session not found")
    rows = (await db.execute(select(ExperimentMessage).where(ExperimentMessage.session_id == session_id).order_by(ExperimentMessage.sequence.desc()).offset((page - 1) * page_size).limit(page_size))).scalars().all()
    rows.reverse()
    return success_response([ExperimentMessageRead.model_validate(row) for row in rows])


@router.post("/{session_id}/messages", response_model=ApiResponse[ExperimentMessageRead], status_code=status.HTTP_201_CREATED)
async def create_experiment_message(session_id: str, body: ExperimentMessageCreate, db: AsyncSession = Depends(get_db)) -> ApiResponse[ExperimentMessageRead]:
    """追加一条用户可见消息；该数据不会传入模型上下文。"""
    if await db.get(ExperimentSession, session_id) is None:
        raise HTTPException(status_code=404, detail="Experiment session not found")
    items = await append_experiment_messages(
        db,
        session_id=session_id,
        drafts=[ExperimentMessageDraft(**body.model_dump())],
    )
    item = items[0]
    session = await db.get(ExperimentSession, session_id)
    if session is not None:
        session.updated_at = func.now()
    await db.commit()
    await db.refresh(item)
    return created_response(ExperimentMessageRead.model_validate(item))


@router.patch("/messages/{message_id}", response_model=ApiResponse[ExperimentMessageRead])
async def update_experiment_message(message_id: str, body: ExperimentMessageUpdate, db: AsyncSession = Depends(get_db)) -> ApiResponse[ExperimentMessageRead]:
    """更新异步任务消息的状态、展示文本或结果快照。"""
    item = await db.get(ExperimentMessage, message_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Experiment message not found")
    if body.content is not None:
        item.content = body.content
    if body.status is not None:
        item.status = body.status
    if body.payload is not None:
        item.payload = body.payload
    await db.commit()
    await db.refresh(item)
    return success_response(ExperimentMessageRead.model_validate(item))


@router.delete("/{session_id}", response_model=ApiResponse[None])
async def delete_experiment_session(session_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[None]:
    """删除尚未关联任务消息的会话，避免运行任务失去历史归属。

    P2 接入审计后，应在提交成功的同一事务中记录删除事件。
    """
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Experiment session not found")
    has_task = (await db.execute(select(ExperimentMessage.id).join(GenerationTask, GenerationTask.id == ExperimentMessage.task_id).where(ExperimentMessage.session_id == session_id, GenerationTask.status.in_([GenerationTaskStatus.pending, GenerationTaskStatus.running, GenerationTaskStatus.streaming])).limit(1))).scalar_one_or_none()
    if has_task:
        raise HTTPException(status_code=409, detail="Session with generation tasks cannot be deleted")
    await db.delete(session)
    await db.commit()
    return empty_response()


@router.delete("/{session_id}/messages", response_model=ApiResponse[None])
async def clear_experiment_messages(session_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[None]:
    """清空不含生成任务的会话历史，避免运行任务失去展示归属。

    P2 的保留策略落地前维持物理删除；后续归档策略不能影响运行中任务保护。
    """
    if await db.get(ExperimentSession, session_id) is None:
        raise HTTPException(status_code=404, detail="Experiment session not found")
    has_task = (await db.execute(select(ExperimentMessage.id).join(GenerationTask, GenerationTask.id == ExperimentMessage.task_id).where(ExperimentMessage.session_id == session_id, GenerationTask.status.in_([GenerationTaskStatus.pending, GenerationTaskStatus.running, GenerationTaskStatus.streaming])).limit(1))).scalar_one_or_none()
    if has_task:
        raise HTTPException(status_code=409, detail="Session with generation tasks cannot be cleared")
    rows = (await db.execute(select(ExperimentMessage).where(ExperimentMessage.session_id == session_id))).scalars().all()
    for row in rows:
        await db.delete(row)
    await db.commit()
    return empty_response()
