"""过期 GenerationRun 的恢复与重新调度服务。"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.generation_runs import GenerationRun
from app.models.generation_run_dispatches import GenerationRunDispatch
from app.services.generation.runtime.run_repository import GenerationRunRepository


class GenerationRunReaper:
    """回收失去 heartbeat 的 Run，并返回需要重新投递的任务标识。"""

    def __init__(self, db: AsyncSession) -> None:
        """绑定一次恢复批处理所使用的事务。"""
        self._db = db
        self._runs = GenerationRunRepository(db)

    async def reap_expired(self, *, limit: int) -> int:
        """同事务回收 Run 并写入 pending 事件，提交后由 dispatcher 发布。"""
        run_ids = await self._runs.requeue_expired(limit=limit)
        created = 0
        for run_id in run_ids:
            run = await self._db.get(GenerationRun, run_id)
            if run is None:
                continue
            await self._db.refresh(run)
            self._db.add(
                GenerationRunDispatch(
                    work_id=uuid4().hex,
                    task_id=run.task_id,
                    generation_run_id=run.id,
                    lease_epoch=run.lease_epoch,
                    source="reaper",
                    status="pending",
                )
            )
            created += 1
        await self._db.flush()
        return created


__all__ = ["GenerationRunReaper"]
