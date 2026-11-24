"""审批成功后的真实画布恢复与回执。"""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.schemas.generation_canvas import CanvasCreate, CanvasSave, TextContentCard
from app.services.approval import ApprovalAccess, ApprovalScope, ApprovalService
from app.services.generation_canvas.approved_edits import CanvasEditApprovals, advance_approved_canvas_edits
from app.services.generation_canvas.edits import CanvasEditGroup, canvas_edits
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from app.task_worker import TaskWorker
from tests.directing.test_store import database
from tests.services.test_task_mysql import isolated_database_url


@pytest.mark.asyncio
async def test_worker_restarts_after_approval_and_recovers_original_receipt(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            lifecycle = free_canvas_lifecycle(db)
            canvas = await lifecycle.create_free(CanvasCreate(name='雨夜'))
            plan = await canvas_edits(db, None).preview(canvas.id, [
                CanvasEditGroup(id='first', cards=[TextContentCard(id='first-shot', text='门外雨景')]),
                CanvasEditGroup(id='second', cards=[TextContentCard(id='second-shot', text='桥面远景')]),
            ])
            access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='operator',
                                    permissions={'submit', 'read', 'decide'})
            request = await CanvasEditApprovals(db).submit(access, None, plan, object_id='proposal', version='v1',
                                                            idempotency_key='submit')
        async with sessions.begin() as db:
            approval = ApprovalService(db)
            decision = await approval.decide(access, request.id, version='v1', group_ids=('first',),
                                             action='approve', idempotency_key='approve-first')
            assert not await CanvasEditApprovals(db).read_receipts(access, decision.id)

        worker = TaskWorker(sessions)
        try:
            await worker.tick()
        finally:
            worker.text_pool.shutdown()
        async with sessions() as db:
            edits = CanvasEditApprovals(db)
            assert await edits.read_snapshot(access, request.id) == plan
            result, = await edits.read_receipts(access, decision.id)
            assert result.group_id == 'first' and result.state == 'applied'

        restarted_worker = TaskWorker(sessions)
        try:
            await restarted_worker.tick()
        finally:
            restarted_worker.text_pool.shutdown()
        async with sessions() as db:
            approval = ApprovalService(db)
            status = await approval.read(access, request.id)
            assert status.group_states == {'first': 'approved', 'second': 'pending'}
            stored = await free_canvas_lifecycle(db).read(canvas.id)
            assert [card.id for card in stored.document.cards] == ['first-shot']
            assert stored.revision == canvas.revision + 1
            assert await CanvasEditApprovals(db).read_receipts(access, decision.id) == (result,)


@pytest.mark.asyncio
async def test_stale_source_keeps_original_decision_and_other_approved_group_executes(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            lifecycle = free_canvas_lifecycle(db)
            canvas = await lifecycle.create_free(CanvasCreate(name='海边'))
            edits = canvas_edits(db, None)
            initial = await edits.preview(canvas.id, [CanvasEditGroup(id='source', cards=[
                TextContentCard(id='source', text='阴天'), TextContentCard(id='shot', text='旧版'),
            ])])
            await edits.submit(initial, request_id='create-source')
            plan = await edits.preview(canvas.id, [
                CanvasEditGroup(id='based-on-source', source_card_ids=('source',),
                                cards=[TextContentCard(id='shot', text='阴天外景')]),
                CanvasEditGroup(id='independent', cards=[TextContentCard(id='other', text='室内')]),
            ])
            access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='operator',
                                    permissions={'submit', 'read', 'decide'})
            request = await CanvasEditApprovals(db).submit(access, None, plan, object_id='proposal', version='v1',
                                                            idempotency_key='submit')
            decision = await ApprovalService(db).decide(access, request.id, version='v1',
                group_ids=('based-on-source', 'independent'), action='approve', idempotency_key='approve')
            current = await lifecycle.read(canvas.id)
            current.document.cards[0].text = '晴天'
            await edits.save(canvas.id, CanvasSave(request_id='editor', expected_revision=current.revision,
                                                   document=current.document.model_dump(mode='json')))
        await advance_approved_canvas_edits(sessions)
        await advance_approved_canvas_edits(sessions)
        async with sessions.begin() as db:
            approvals = CanvasEditApprovals(db)
            stale, applied = await approvals.read_receipts(access, decision.id)
            assert (stale.state, applied.state) == ('conflict', 'applied')
            difference, = stale.result.conflicts
            assert difference.difference.path == ('cards', 'source')
            assert difference.difference.before.value['text'] == '阴天'
            assert difference.current.value['text'] == '晴天'
            assert (await ApprovalService(db).read(access, request.id)).group_states['based-on-source'] == 'approved'
            stored = await free_canvas_lifecycle(db).read(canvas.id)
            assert {card.id: card.text for card in stored.document.cards} == {
                'source': '晴天', 'shot': '旧版', 'other': '室内',
            }
            updated = await canvas_edits(db, None).preview(canvas.id, [CanvasEditGroup(
                id='based-on-source', source_card_ids=('source',), cards=[TextContentCard(id='shot', text='晴天外景')],
            )])
            replacement = await approvals.submit(access, None, updated, object_id='proposal', version='v2',
                supersedes_request_id=request.id, idempotency_key='submit-v2')
            confirmed = await ApprovalService(db).decide(access, replacement.id, version='v2',
                group_ids=('based-on-source',), action='approve', idempotency_key='approve-v2')
        await advance_approved_canvas_edits(sessions)
        async with sessions() as db:
            assert (await CanvasEditApprovals(db).read_receipts(access, confirmed.id))[0].state == 'applied'
            assert (await CanvasEditApprovals(db).read_receipts(access, decision.id))[0] == stale


@pytest.mark.asyncio
async def test_deleted_canvas_keeps_approved_fact_and_records_failure(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            lifecycle = free_canvas_lifecycle(db)
            canvas = await lifecycle.create_free(CanvasCreate(name='旧稿'))
            plan = await canvas_edits(db, None).preview(canvas.id, [
                CanvasEditGroup(id='draft', cards=[TextContentCard(id='shot', text='雨景')]),
            ])
            access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='operator',
                                    permissions={'submit', 'read', 'decide'})
            request = await CanvasEditApprovals(db).submit(access, None, plan, object_id='proposal', version='v1',
                                                            idempotency_key='submit')
            decision = await ApprovalService(db).decide(access, request.id, version='v1', group_ids=('draft',),
                                                        action='approve', idempotency_key='approve')
            await lifecycle.delete(canvas.id, expected_revision=canvas.revision)
        await advance_approved_canvas_edits(sessions)
        async with sessions() as db:
            receipt, = await CanvasEditApprovals(db).read_receipts(access, decision.id)
            assert receipt.state == 'failed' and receipt.diagnostic.code == 'CANVAS_NOT_FOUND'
            assert (await ApprovalService(db).read(access, request.id)).group_states == {'draft': 'approved'}


@pytest.mark.asyncio
async def test_mysql_concurrent_workers_execute_group_at_most_once():
    engine = create_async_engine(isolated_database_url(), isolation_level='READ COMMITTED')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions.begin() as db:
            canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='重放实验'))
            plan = await canvas_edits(db, None).preview(canvas.id, [
                CanvasEditGroup(id='first', cards=[TextContentCard(id=uuid4().hex, text='门外雨景')]),
                CanvasEditGroup(id='second', cards=[TextContentCard(id=uuid4().hex, text='桥面远景')]),
            ])
            access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='operator',
                                    permissions={'submit', 'read', 'decide'})
            request = await CanvasEditApprovals(db).submit(access, None, plan, object_id='proposal', version='v1',
                                                            idempotency_key='submit')
            decision = await ApprovalService(db).decide(access, request.id, version='v1', group_ids=('first',),
                                                        action='approve', idempotency_key='approve')
        await asyncio.gather(advance_approved_canvas_edits(sessions), advance_approved_canvas_edits(sessions))
        async with sessions() as db:
            lifecycle = free_canvas_lifecycle(db)
            assert (await lifecycle.read(canvas.id)).revision == canvas.revision + 1
            result, = await CanvasEditApprovals(db).read_receipts(access, decision.id)
            assert result.group_id == 'first' and result.state == 'applied'
            assert (await ApprovalService(db).read(access, request.id)).group_states['second'] == 'pending'
        await advance_approved_canvas_edits(sessions)
        async with sessions() as db:
            assert await CanvasEditApprovals(db).read_receipts(access, decision.id) == (result,)
    finally:
        await engine.dispose()
