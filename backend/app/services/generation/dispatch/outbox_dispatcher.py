"""GenerationDispatchOutbox 的可靠 Celery 投递器。

提交事务只写入 outbox；本模块由 Beat 轮询未投递记录并发送执行消息。投递
成功前不会标记记录，因而 broker 暂时不可用时下个周期仍可重试。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.db_sync import sync_session_maker
from app.models.generation_artifacts import GenerationDispatchOutbox

logger = logging.getLogger(__name__)

DEFAULT_DISPATCH_BATCH_SIZE = 100


class GenerationOutboxDispatcher:
    """将已提交的生成任务可靠投递给 Celery。

    每条记录在数据库锁内完成“投递成功后标记”的转换。重复 Beat 触发会读取到
    已标记记录并跳过；投递异常仅累计诊断信息，不会丢失待投递记录。
    """

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session] = sync_session_maker,
        enqueue: Callable[[str], object] | None = None,
    ) -> None:
        self._session_maker = session_maker
        if enqueue is None:
            # 延迟导入避免 Celery task 模块与 dispatcher 形成导入环。
            from app.tasks.execute_task import enqueue_task_execution

            enqueue = enqueue_task_execution
        self._enqueue = enqueue

    def dispatch_pending(self, *, limit: int = DEFAULT_DISPATCH_BATCH_SIZE) -> int:
        """投递一批未完成 outbox，并返回本轮成功投递数量。"""
        if limit <= 0:
            return 0
        with self._session_maker() as db:
            outbox_ids = list(
                db.scalars(
                    select(GenerationDispatchOutbox.id)
                    .where(GenerationDispatchOutbox.dispatched_at.is_(None))
                    .order_by(GenerationDispatchOutbox.created_at, GenerationDispatchOutbox.id)
                    .limit(limit)
                )
            )
        return sum(1 for outbox_id in outbox_ids if self._dispatch_one(outbox_id))

    def _dispatch_one(self, outbox_id: int) -> bool:
        """在行锁内投递单条记录，确保并发 dispatcher 不会重复标记。"""
        with self._session_maker() as db:
            row = db.scalar(
                select(GenerationDispatchOutbox)
                .where(GenerationDispatchOutbox.id == outbox_id)
                .with_for_update()
            )
            if row is None or row.dispatched_at is not None:
                return False
            try:
                self._enqueue(row.task_id)
            except Exception as exc:  # noqa: BLE001
                row.attempts += 1
                row.last_error = self._format_error(exc)
                db.commit()
                logger.warning(
                    "generation outbox dispatch failed: outbox_id=%s task_id=%s attempts=%s",
                    row.id,
                    row.task_id,
                    row.attempts,
                    exc_info=True,
                )
                return False

            row.attempts += 1
            row.dispatched_at = datetime.now(timezone.utc).isoformat()
            row.last_error = None
            db.commit()
            return True

    @staticmethod
    def _format_error(exc: Exception) -> str:
        """生成可审计且受长度约束的投递错误文本。"""
        return f"{type(exc).__name__}: {exc}"[:4096]
