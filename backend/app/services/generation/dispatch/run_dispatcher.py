"""GenerationRunDispatch 的至少一次 Celery 发布器。"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.core.db_sync import sync_session_maker
from app.models.generation_run_dispatches import GenerationRunDispatch


class GenerationRunDispatchDispatcher:
    """发布已提交的 Run 级投递事件，并以固定 work_id 支撑安全重试。"""

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session] = sync_session_maker,
        enqueue: Callable[[str, str, str], object] | None = None,
    ) -> None:
        """注入数据库与 broker 适配器，便于验证失败重试语义。"""
        self._session_maker = session_maker
        if enqueue is None:
            from app.tasks.execute_task import enqueue_task_execution

            def _enqueue_task(task_id: str, work_id: str, source: str) -> object:
                """将持久化事件投递给 Celery，并保留预分配 work_id。"""
                return enqueue_task_execution(task_id, work_id=work_id, source=source)

            enqueue = _enqueue_task
        self._enqueue = enqueue

    def dispatch_pending(self, *, limit: int = 100) -> int:
        """发送 pending 或投递 lease 已过期的事件，broker 调用不持有数据库锁。"""
        if limit <= 0:
            return 0
        now = datetime.now(UTC).replace(tzinfo=None)
        with self._session_maker() as db:
            work_ids = list(
                db.scalars(
                    select(GenerationRunDispatch.work_id)
                    .where(
                        or_(
                            GenerationRunDispatch.status == "pending",
                            (GenerationRunDispatch.status == "publishing")
                            & (GenerationRunDispatch.delivery_lease_expires_at <= now),
                        )
                    )
                    .order_by(GenerationRunDispatch.created_at, GenerationRunDispatch.work_id)
                    .limit(limit)
                )
            )
        return sum(1 for work_id in work_ids if self._dispatch_one(work_id))

    def _dispatch_one(self, work_id: str) -> bool:
        """短事务认领事件，Broker 成功后再独立确认 published 状态。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        with self._session_maker() as db:
            row = db.scalar(select(GenerationRunDispatch).where(GenerationRunDispatch.work_id == work_id).with_for_update())
            if row is None or row.status not in {"pending", "publishing"}:
                return False
            if row.status == "publishing" and row.delivery_lease_expires_at and row.delivery_lease_expires_at > now:
                return False
            row.status = "publishing"
            row.attempts += 1
            row.delivery_lease_expires_at = now + timedelta(seconds=60)
            db.commit()
            task_id, source = row.task_id, row.source
        try:
            self._enqueue(task_id, work_id, source)
        except Exception as exc:  # noqa: BLE001
            with self._session_maker() as db:
                db.execute(
                    update(GenerationRunDispatch)
                    .where(GenerationRunDispatch.work_id == work_id, GenerationRunDispatch.status == "publishing")
                    .values(status="pending", delivery_lease_expires_at=None, error=f"{type(exc).__name__}: {exc}"[:4096])
                )
                db.commit()
            return False
        with self._session_maker() as db:
            db.execute(
                update(GenerationRunDispatch)
                .where(GenerationRunDispatch.work_id == work_id, GenerationRunDispatch.status == "publishing")
                .values(status="published", enqueued_at=now, delivery_lease_expires_at=None, error=None)
            )
            db.commit()
        return True


__all__ = ["GenerationRunDispatchDispatcher"]
