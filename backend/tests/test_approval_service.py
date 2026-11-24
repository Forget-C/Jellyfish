"""普通后端业务方通过独立审批服务保存和读取决定。"""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.schemas.generation_canvas import CanvasCreate, TextContentCard
from app.services.approval import ApprovalAccess, ApprovalError, ApprovalScope, ApprovalService, ApprovalSubmission
from app.services.generation_canvas.edits import CanvasEditGroup, CanvasEditPreview, canvas_edits
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from tests.directing.test_store import database
from tests.services.test_task_mysql import isolated_database_url


@pytest.mark.asyncio
async def test_versioned_request_and_group_decision_survive_a_new_transaction(tmp_path):
    scope = ApprovalScope(kind='workspace', id='warehouse')
    applicant = ApprovalAccess(scope=scope, actor_id='warehouse-clerk', permissions={'submit'})
    reviewer = ApprovalAccess(scope=scope, actor_id='warehouse-manager', permissions={'decide'})
    consumer = ApprovalAccess(scope=scope, actor_id='inventory-worker', permissions={'read'}, source='service')
    # The business component owns the immutable display snapshot.
    snapshots = {'transfer-v1': {'zone-a': 4, 'zone-b': 6}}
    command = ApprovalSubmission(object_type='stock-transfer', object_id='transfer-42', version='v1',
                                 group_ids=('zone-a', 'zone-b'), snapshot_ref='transfer-v1')
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            request = await ApprovalService(db).submit(applicant, command, idempotency_key='submit-transfer')
        async with sessions.begin() as db:
            decision = await ApprovalService(db).decide(
                reviewer, request.id, version='v1', group_ids=('zone-a',), action='approve', idempotency_key='decide-a',
            )
        async with sessions() as db:
            service = ApprovalService(db)
            current = await service.read(consumer, request.id)
            assert snapshots[current.snapshot_ref] == {'zone-a': 4, 'zone-b': 6}
            assert current.applicant_id == 'warehouse-clerk'
            assert current.group_states == {'zone-a': 'approved', 'zone-b': 'pending'}
            assert await service.read_decision(consumer, decision.id) == decision
            assert decision.actor_id == 'warehouse-manager'
            assert (decision.version, decision.group_ids, decision.source) == ('v1', ('zone-a',), 'human')


@pytest.mark.asyncio
async def test_supersession_blocks_old_commands_and_preserves_exact_replay(tmp_path):
    access = ApprovalAccess(scope=ApprovalScope(kind='workspace', id='warehouse'), actor_id='manager',
                            permissions={'read', 'submit', 'decide'})
    command = ApprovalSubmission(object_type='stock-transfer', object_id='transfer', version='v1',
                                 group_ids=('zone-a', 'zone-b', 'zone-c'), snapshot_ref='transfer-v1')
    async with database(tmp_path) as sessions, sessions.begin() as db:
        service = ApprovalService(db)
        first = await service.submit(access, command, idempotency_key='submit-v1')
        decision = await service.decide(access, first.id, version='v1', group_ids=('zone-b', 'zone-a'),
                                        action='approve', idempotency_key='approve')
        replacement = command.model_copy(update={'version': 'v2', 'snapshot_ref': 'transfer-v2',
                                                 'supersedes_request_id': first.id})
        second = await service.submit(access, replacement, idempotency_key='submit-v2')
        assert second.id != first.id
        assert await service.submit(access, command, idempotency_key='submit-v1') == first
        assert await service.decide(access, first.id, version='v1', group_ids=('zone-a', 'zone-b'),
                                    action='approve', idempotency_key='approve') == decision
        with pytest.raises(ApprovalError) as reused:
            await service.decide(access, second.id, version='v2', group_ids=('zone-b', 'zone-a'),
                                 action='approve', idempotency_key='approve')
        assert reused.value.code == 'idempotency_conflict'
        with pytest.raises(ApprovalError) as expired:
            await service.decide(access, first.id, version='v1', group_ids=('zone-c',),
                                 action='approve', idempotency_key='approve-old')
        assert expired.value.code == 'superseded'
        with pytest.raises(ApprovalError) as competing:
            await service.submit(access, replacement.model_copy(update={'version': 'v3'}), idempotency_key='submit-v3')
        assert competing.value.code == 'version_conflict'
        assert not (await service.read(access, first.id)).active
        assert (await service.read(access, second.id)).group_states == dict.fromkeys(command.group_ids, 'pending')
        assert await service.list_decisions(access, first.id) == (decision,)


@pytest.mark.asyncio
async def test_applicant_and_different_resource_cannot_decide(tmp_path):
    scope = ApprovalScope(kind='workspace', id='warehouse')
    applicant = ApprovalAccess(scope=scope, actor_id='clerk', permissions={'submit'})
    manager = ApprovalAccess(scope=scope, actor_id='manager', permissions={'read', 'decide'})
    foreign = ApprovalAccess(scope=ApprovalScope(kind='workspace', id='Warehouse'), actor_id='other-manager',
                             permissions={'read', 'decide'})
    async with database(tmp_path) as sessions, sessions.begin() as db:
        service = ApprovalService(db)
        request = await service.submit(applicant, ApprovalSubmission(
            object_type='stock-transfer', object_id='transfer', version='v1', snapshot_ref='v1',
            group_ids=('zone-a', 'zone-b'),
        ), idempotency_key='submit')
        for access, error in ((applicant, 'forbidden'), (foreign, 'request_not_found')):
            with pytest.raises(ApprovalError) as denied:
                await service.decide(access, request.id, version='v1', group_ids=('zone-b',),
                                     action='reject', idempotency_key='try-reject')
            assert denied.value.code == error
            with pytest.raises(ApprovalError, match='审批') as unreadable:
                await service.read(access, request.id)
            assert unreadable.value.code == error
        for groups in ((), ('missing',), ('zone-b', 'zone-b')):
            with pytest.raises(ApprovalError) as invalid:
                await service.decide(manager, request.id, version='v1', group_ids=groups,
                                     action='approve', idempotency_key='invalid')
            assert invalid.value.code == 'invalid_groups'
        rejected = await service.decide(manager, request.id, version='v1', group_ids=('zone-b',),
                                        action='reject', idempotency_key='reject-b')
        with pytest.raises(ApprovalError) as hidden:
            await service.read_decision(foreign, rejected.id)
        assert hidden.value.code == 'decision_not_found'
        with pytest.raises(ApprovalError) as settled:
            await service.decide(manager, request.id, version='v1', group_ids=('zone-a', 'zone-b'),
                                 action='approve', idempotency_key='approve-both')
        assert settled.value.code == 'already_decided'
        assert (await service.read(manager, request.id)).group_states == {'zone-a': 'pending', 'zone-b': 'rejected'}


@pytest.mark.asyncio
async def test_business_reads_exact_canvas_preview_and_decides_independent_groups(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='雨夜'))
            preview = await canvas_edits(db, None).preview(canvas.id, [
                CanvasEditGroup(id='first', cards=[TextContentCard(id='street', text='湿路反光')]),
                CanvasEditGroup(id='second', cards=[TextContentCard(id='bridge', text='桥面全景')]),
            ])
            scope = ApprovalScope(kind='canvas', id=canvas.id)
            applicant = ApprovalAccess(scope=scope, actor_id='creator', permissions={'submit'})
            reviewer = ApprovalAccess(scope=scope, actor_id='editor', permissions={'read', 'decide'})
            snapshot = tmp_path / 'canvas-preview-v1.json'
            snapshot.write_text(preview.model_dump_json())
            request = await ApprovalService(db).submit(applicant, ApprovalSubmission(
                object_type='canvas-edits', object_id='proposal', version='v1', group_ids=('first', 'second'),
                snapshot_ref=snapshot.name,
            ), idempotency_key='request-preview')
        async with sessions.begin() as db:
            service = ApprovalService(db)
            status = await service.read(reviewer, request.id)
            actual = CanvasEditPreview.model_validate_json((tmp_path / status.snapshot_ref).read_text())
            assert actual == preview
            assert actual.groups[0].differences[0].after.value['text'] == '湿路反光'
            await service.decide(reviewer, status.id, version=status.version, group_ids=('first',),
                                 action='approve', idempotency_key='approve-first')
            await service.decide(reviewer, status.id, version=status.version, group_ids=('second',),
                                 action='reject', idempotency_key='reject-second')
            assert (await service.read(reviewer, request.id)).group_states == {'first': 'approved', 'second': 'rejected'}
            assert {d.action: d.group_ids for d in await service.list_decisions(reviewer, request.id)} == {
                'approve': ('first',), 'reject': ('second',),
            }
            assert (await free_canvas_lifecycle(db).read(canvas.id)).document.cards == []


@pytest.mark.asyncio
async def test_mysql_concurrent_replay_and_version_supersession():
    engine = create_async_engine(isolated_database_url(), isolation_level='READ COMMITTED')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    access = ApprovalAccess(scope=ApprovalScope(kind='test', id=uuid4().hex), actor_id='manager',
                            permissions={'read', 'submit', 'decide'})
    first = ApprovalSubmission(object_type='stock-transfer', object_id='transfer', version='v1',
                               group_ids=('zone-a', 'zone-b'), snapshot_ref='v1')

    async def submit(command, key):
        try:
            async with sessions.begin() as db:
                return await ApprovalService(db).submit(access, command, idempotency_key=key)
        except ApprovalError as error:
            return error

    async def decide(request):
        async with sessions.begin() as db:
            return await ApprovalService(db).decide(access, request.id, version='v1', group_ids=('zone-a',),
                                                    action='approve', idempotency_key='approve')

    try:
        request, retried = await asyncio.gather(submit(first, 'submit-v1'), submit(first, 'submit-v1'))
        assert request == retried
        decision, repeated = await asyncio.gather(decide(request), decide(request))
        assert decision == repeated
        results = await asyncio.gather(*(
            submit(first.model_copy(update={'version': version, 'snapshot_ref': version,
                                            'supersedes_request_id': request.id}), version)
            for version in ('v2', 'v3')
        ))
        errors = [result.code for result in results if isinstance(result, ApprovalError)]
        assert errors == ['version_conflict']
        assert await decide(request) == decision
        async with sessions() as db:
            service = ApprovalService(db)
            assert await service.list_decisions(access, request.id) == (decision,)
            with pytest.raises(ApprovalError) as expired:
                await service.decide(access, request.id, version='v1', group_ids=('zone-b',),
                                     action='approve', idempotency_key='approve-old')
            assert expired.value.code == 'superseded'
    finally:
        await engine.dispose()
