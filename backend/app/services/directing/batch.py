"""固定批量范围、逐项预检与受理；复用单元任务，不创建第二套运行状态机。"""
import logging
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, update

from app.core.contracts.directing.batch import BatchPrepare, BatchRead, BatchItemRead
from app.core.contracts.directing.production import Prompt, ProductionPlan
from app.models.directing import DirectingBatch, DirectingBatchItem
from app.models.task import Task
from app.services.directing.production import ProductionService
from app.services.directing.store import RevisionConflict

logger = logging.getLogger(__name__)


class BatchService(ProductionService):
    """每批只包含用户预检过的固定版本，每项仍是一条独立通用任务。"""

    async def _batch(self, sequence_id: str, batch_id: str, *, lock: bool = False):
        """先核对场次项目归属，再读取或锁定批次，避免跨项目身份泄漏。"""
        await self.sequence(sequence_id)
        query = select(DirectingBatch).where(DirectingBatch.id == batch_id, DirectingBatch.sequence_id == sequence_id)
        if lock:
            query = query.with_for_update()
        row = await self.db.scalar(query.execution_options(populate_existing=True))
        if row is None:
            raise ValueError('批次不属于当前场次')
        return row

    async def _items(self, batch_id: str):
        """固定预检时的选择顺序，不随计划或任务列表刷新改变。"""
        return list(await self.db.scalars(select(DirectingBatchItem).where(DirectingBatchItem.batch_id == batch_id)
            .order_by(DirectingBatchItem.ordinal)))

    async def prepare_batch(self, sequence_id: str, body: BatchPrepare) -> BatchRead:
        """保存固定选择与逐项预检结果，不创建任务或访问模型。"""
        await self.current_sequence(sequence_id)
        await self.sequence(sequence_id)
        identities = set()
        for item in body.items:
            prompt = await self.revision(item.prompt_revision_id, kind='prompt', sequence_id=sequence_id)
            await self.revision(item.review_revision_id, kind='review', sequence_id=sequence_id)
            content = Prompt.model_validate(prompt.payload)
            identity = (content.plan_revision_id, content.unit_id)
            if identity in identities:
                raise ValueError('同一计划单元在一批中只能选择一个提示词版本')
            identities.add(identity)
        batch = DirectingBatch(id=uuid4().hex, sequence_id=sequence_id, version=1, status='prepared')
        async with self.db.begin_nested():
            self.db.add(batch)
            await self.db.flush()
            for ordinal, item in enumerate(body.items):
                error = None
                try:
                    await self.prepare_shoot(sequence_id, prompt_id=item.prompt_revision_id, review_id=item.review_revision_id)
                except (ValueError, HTTPException) as cause:
                    error = str(cause.detail) if isinstance(cause, HTTPException) else str(cause)
                self.db.add(DirectingBatchItem(batch_id=batch.id, ordinal=ordinal,
                    prompt_revision_id=item.prompt_revision_id, review_revision_id=item.review_revision_id, error=error))
            await self.db.flush()
        return await self.read_batch(sequence_id, batch.id)

    async def read_batch(self, sequence_id: str, batch_id: str) -> BatchRead:
        """从任务系统读取当前进度；不会把预检结果当作执行成功。"""
        batch = await self._batch(sequence_id, batch_id)
        items = []
        for item in await self._items(batch.id):
            prompt = Prompt.model_validate((await self.revision(item.prompt_revision_id)).payload)
            plan = ProductionPlan.model_validate((await self.revision(prompt.plan_revision_id)).payload)
            unit = self._unit(plan, prompt.unit_id)
            task = await self.db.get(Task, item.task_id) if item.task_id else None
            items.append(BatchItemRead(ordinal=item.ordinal, prompt_revision_id=item.prompt_revision_id,
                review_revision_id=item.review_revision_id, plan_revision_id=prompt.plan_revision_id,
                unit_id=unit.id, model_id=unit.model_id, duration_ms=unit.duration_ms, ratio=unit.ratio,
                task_id=item.task_id, progress=task.progress if task else None, status=task.status if task else 'blocked' if item.error else 'ready',
                error=task.error_message if task else item.error))
        return BatchRead(id=batch.id, sequence_id=sequence_id, version=batch.version, status=batch.status,
            created_at=batch.created_at, items=items)

    async def list_batches(self, sequence_id: str) -> list[BatchRead]:
        """刷新后恢复全部本场批次，历史任务不混入当前选择。"""
        await self.sequence(sequence_id)
        ids = list(await self.db.scalars(select(DirectingBatch.id).where(DirectingBatch.sequence_id == sequence_id)
            .order_by(DirectingBatch.created_at, DirectingBatch.id)))
        return [await self.read_batch(sequence_id, batch_id) for batch_id in ids]

    async def submit_batch(self, sequence_id: str, batch_id: str, *, expected_version: int) -> BatchRead:
        """一次显式受理，每项独立 savepoint；重放同批返回原任务，不自动重试失败项。"""
        await self.current_sequence(sequence_id)
        batch = await self._batch(sequence_id, batch_id, lock=True)
        if batch.status == 'submitted':
            return await self.read_batch(sequence_id, batch_id)
        claimed = await self.db.execute(update(DirectingBatch).where(DirectingBatch.id == batch_id,
            DirectingBatch.version == expected_version, DirectingBatch.status == 'prepared')
            .values(status='submitted', version=DirectingBatch.version + 1))
        if claimed.rowcount != 1:
            raise RevisionConflict('批次版本已变化，请刷新')
        for item in await self._items(batch_id):
            # 预检失败的项未被授权执行；修正后必须建立新的预检选择。
            if item.error:
                continue
            try:
                task = await self.shoot(sequence_id, prompt_id=item.prompt_revision_id,
                    review_id=item.review_revision_id, request_id=f'batch:{batch_id}:{item.ordinal}')
                item.task_id = task.id
            except (ValueError, HTTPException) as cause:
                item.error = str(cause.detail) if isinstance(cause, HTTPException) else str(cause)
            except Exception as cause:
                logger.error('batch item acceptance failed: batch=%s ordinal=%s error=%s', batch_id, item.ordinal, type(cause).__name__)
                item.error = '本项受理失败，请检查服务状态后重新预检；其他项不受影响'
            await self.db.flush()
        return await self.read_batch(sequence_id, batch_id)
