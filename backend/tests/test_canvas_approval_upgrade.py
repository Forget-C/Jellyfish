"""升级样本覆盖旧审批交互、原画布及其运行回执。"""

from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from app.api.v1.routes.studio.generation_canvases import router
from app.dependencies import get_db
from app.models.canvas_assistant import (
    CanvasAssistantEvent, CanvasAssistantGeneration, CanvasAssistantQueuedMessage, CanvasAssistantSession, CanvasAssistantTurn,
)
from app.models.studio import FileItem
from app.schemas.generation_canvas import CanvasCreate, CanvasPrecheckRequest, CanvasRunSubmit, CanvasSave, TextContentCard
from app.services.approval import ApprovalAccess, ApprovalScope
from app.services.generation_canvas.approved_edits import CanvasEditApprovals
from app.services.generation_canvas.approval_upgrade import expire_legacy_canvas_approvals, legacy_generation_request_id
from app.services.generation_canvas.edits import CanvasEditGroup, canvas_edits
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from app.services.generation_canvas.runs import canvas_runs
from app.services.task_service import TaskService, utcnow
from app.task_worker import TaskWorker
from tests.test_approved_canvas_generation import generation_sessions, submit_video_approval  # noqa: F401


def proposal(first_state='applied'):
    edit = {'card_id': 'caption', 'card_name': '镜头说明', 'before': '原稿', 'after': '雨景',
            'target': {'kind': 'card_text'}}
    return {**edit, 'state': 'pending', 'groups': [
        {'id': 'first', 'title': '第一镜', 'state': first_state, 'edits': [edit]},
        {'id': 'second', 'title': '第二镜', 'state': 'pending', 'edits': [{**edit, 'after': '晴天'}]},
    ]}


async def execute_upgrade(sessions):
    async with sessions.begin() as db:
        await db.run_sync(lambda session: expire_legacy_canvas_approvals(session.connection()))


@pytest.mark.asyncio
@pytest.mark.parametrize('generation_sessions', ['sqlite', 'mysql'], indirect=True)
async def test_upgrade_expires_held_old_proposal_and_preserves_history(generation_sessions):
    sessions = generation_sessions
    async with sessions.begin() as db:
        canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='雨夜'))
        file_id = uuid4().hex
        db.add(FileItem(id=file_id, type='image', name='角色参考', storage_key='test/' + file_id))
        await db.flush()
        document = canvas.document.model_dump(mode='json')
        document.update(cards=[
            {'id': 'caption', 'type': 'content.text', 'text': '雨景'},
            {'id': 'reference', 'type': 'content.image', 'file_id': file_id},
            {'id': 'editor', 'type': 'model.text', 'input_bindings': [
                {'id': 'saved-binding', 'input_port': 'text', 'source': {
                    'canvas_id': canvas.id, 'card_id': 'caption', 'port_id': 'text', 'position': 0,
                }},
            ]},
        ], edges=[{'id': 'saved-edge', 'source_card': 'caption', 'source_port': 'text',
                  'target_card': 'editor', 'target_port': 'text'}],
            input_order={'editor': {'text': ['saved-edge']}})
        edits = canvas_edits(db, None)
        await edits.save(canvas.id, CanvasSave(request_id='already-written', expected_revision=canvas.revision,
                                               document=document))
        current = await free_canvas_lifecycle(db).read(canvas.id)
        access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='artist',
                                permissions={'submit', 'read'})
        fresh = await CanvasEditApprovals(db).submit(access, None, await edits.preview(canvas.id, [
            CanvasEditGroup(id='new', cards=[TextContentCard(id='new-card', text='新协议')]),
        ]), object_id='new-turn', version='v1', idempotency_key='fresh')
        session = CanvasAssistantSession(canvas_id=canvas.id, sequence=2, event_cursor=2, pending_token='old-lease',
            pending_request={'command': {'request_id': 'running-turn', 'text': '后来一轮'}}, pending_checkpoint=b'old-in-flight')
        db.add(session)
        await db.flush()
        attachments = [{'file_id': file_id, 'observation': 'image', 'name': '角色参考'}]
        layout = {'state': 'waiting', 'before': {'caption': {'x': 10, 'y': 40}},
                  'group_membership': {'caption': None}}
        db.add(CanvasAssistantTurn(canvas_id=canvas.id, request_id='old-turn', model_id='assistant-model', sequence=1,
            text='采用选择的镜头', reply='原正文 **保留**', proposal=proposal(), attachments=attachments, layout=layout,
            proposal_receipt={'_applied_at': {'first': current.revision}}, approval_checkpoint=b'old-approval'))
        db.add(CanvasAssistantTurn(canvas_id=canvas.id, request_id='new-turn', model_id='assistant-model', sequence=2,
            text='这是新协议', reply='新待审建议', proposal=proposal('pending'), approval_requests={'edit': fresh.id}))
        db.add(CanvasAssistantQueuedMessage(canvas_id=canvas.id, request_id='admitted', position=1, state='admitted',
            turn_id='running-turn', request_digest='digest', command={'text': '后来一轮'}))
        db.add(CanvasAssistantQueuedMessage(canvas_id=canvas.id, request_id='queued', position=2, state='queued',
            request_digest='digest', command={'text': '尚未开始的普通消息'}))
        for cursor, source, stages in ((1, 'old-turn', proposal('pending')), (2, 'new-turn', proposal('pending'))):
            db.add(CanvasAssistantEvent(canvas_id=canvas.id, cursor=cursor, source_id=source, kind='proposal.created',
                payload={'request_id': source, 'model_id': 'assistant-model', 'sequence': cursor, 'text': '建议',
                         'reply': '原正文 **保留**', 'proposal': stages, 'attachments': attachments,
                         'layout': layout if source == 'old-turn' else None}))
    await execute_upgrade(sessions)
    await execute_upgrade(sessions)

    app = FastAPI()
    app.include_router(router, prefix='/canvases')

    async def transaction():
        async with sessions.begin() as db:
            yield db

    app.dependency_overrides[get_db] = transaction
    base = f'/canvases/{canvas.id}/assistant'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post(base + '/proposals/old-turn', json={'action': 'approve',
            'expected_revision': current.revision, 'group_ids': ['second'], 'decision_id': 'old-screen'})
        assert response.status_code == 409
        assert '已失效' in response.json()['detail']
        old_layout = await client.post(base + '/layout/old-turn', json={'action': 'claim'})
        assert old_layout.status_code == 409 and '已失效' in old_layout.json()['detail']
        history = (await client.get(base)).json()['data']
        old, new = history['turns']
        assert old['reply'] == '原正文 **保留**' and old['attachments'][0]['file_id'] == attachments[0]['file_id']
        assert [group['state'] for group in old['proposal']['groups']] == ['applied', 'superseded']
        assert old['layout']['state'] == 'stale'
        assert new['proposal']['state'] == 'pending'
        assert history['pending_request'] is None
        assert [entry['request_id'] for entry in history['queue']] == ['queued']
        replay = (await client.get(base + '/events?after=0')).json()['data']
        assert not any(group['state'] == 'pending' for event in replay if event['turn_id'] == 'old-turn'
                       for group in event['payload']['proposal']['groups'])
        delta = (await client.get(base + '/events?after=2')).json()['data']
        assert [event['type'] for event in delta].count('proposal.superseded') == 1
        assert [event['type'] for event in delta].count('layout.updated') == 1
        assert [event['type'] for event in delta].count('queue.removed') == 1
    async with sessions() as db:
        assert await free_canvas_lifecycle(db).read(canvas.id) == current
        migrated = await db.get(CanvasAssistantTurn, (canvas.id, 'old-turn'))
        assert migrated.approval_checkpoint is None
        assert migrated.proposal_receipt == {'_applied_at': {'first': current.revision}}


@pytest.mark.asyncio
@pytest.mark.parametrize('generation_sessions', ['sqlite', 'mysql'], indirect=True)
async def test_upgrade_keeps_accepted_and_unknown_tasks_and_never_admits_remaining_versions(generation_sessions):
    sessions = generation_sessions
    canvas_id, _, new_request = await submit_video_approval(sessions)
    source_id = 'legacy-generate'
    async with sessions.begin() as db:
        current = await free_canvas_lifecycle(db).read(canvas_id)
        db.add(CanvasAssistantSession(canvas_id=canvas_id, sequence=3, event_cursor=3,
            pending_token='fresh', pending_checkpoint=b'new-protocol', pending_request={
                'approval_protocol': 2, 'command': {'request_id': 'resumable-new-turn'},
            }))
        await db.flush()
        db.add_all([
            CanvasAssistantTurn(canvas_id=canvas_id, request_id=source_id, model_id='assistant-model', sequence=1,
                text='生成三版', reply='原生成回复'),
            CanvasAssistantTurn(canvas_id=canvas_id, request_id='new-generation', model_id='assistant-model',
                sequence=2, text='生成一版', reply='新协议回复', approval_requests={'generation': new_request.id}),
            CanvasAssistantTurn(canvas_id=canvas_id, request_id='not-admitted', model_id='assistant-model',
                sequence=3, text='生成一版', reply='旧等待受理'),
        ])
        await db.flush()
        db.add_all([
            CanvasAssistantGeneration(canvas_id=canvas_id, source_id=source_id, card_id='v', requested_count=3,
                state='reapproval_required', expected_revision=current.revision, input_approval={'pending': {'revision': 1}},
                review_state='waiting', review_request='成片审看', created_at=utcnow()),
            CanvasAssistantGeneration(canvas_id=canvas_id, source_id='not-admitted', card_id='v', requested_count=1,
                state='queued', expected_revision=current.revision, created_at=utcnow()),
        ])
        tasks = TaskService(db)
        runs = canvas_runs(db, None)

        async def accept(version):
            preview = await canvas_generation_inputs(db, None).precheck(canvas_id, CanvasPrecheckRequest(card_id='v'))
            return await runs.submit(canvas_id, CanvasRunSubmit(
                request_id=legacy_generation_request_id(source_id, version), preview_token=preview.preview_token,
            ))

        accepted = await accept(1)
        known_task = accepted.task_ids[0]
        assert await tasks.claim(known_task, worker_id='old-worker')
        await tasks.record_submission(known_task, provider_task_id='old-provider-id')
        file_id = uuid4().hex
        db.add(FileItem(id=file_id, type='video', name='原产物', storage_key='test/' + file_id))
        await db.flush()
        await tasks.add_output(known_task, ordinal=0, file_id=file_id)
        await tasks.finish(known_task)

        unknown = await accept(2)
        unknown_task = unknown.task_ids[0]
        assert await tasks.claim(unknown_task, worker_id='old-worker')
        db.add(CanvasAssistantEvent(canvas_id=canvas_id, cursor=1, source_id=source_id, kind='execution.blocked',
            payload={'request_id': source_id, 'model_id': 'assistant-model', 'sequence': 1, 'text': '生成三版',
                     'reply': '原生成回复', 'generation': {'state': 'reapproval_required', 'card_id': 'v',
                                                          'requested_count': 3}}))

    await execute_upgrade(sessions)
    await execute_upgrade(sessions)
    calls = []

    def provider(req):
        calls.append((req.method, req.url.path))
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as transport:
        worker = TaskWorker(sessions, client=transport)
        try:
            await worker.tick()
            await worker.tick()
        finally:
            worker.text_pool.shutdown()
    assert calls == []

    from app.services.generation_canvas.assistant_generation import read_generation
    async with sessions.begin() as db:
        runs = canvas_runs(db, None)
        assert await runs.read_receipt(canvas_id, accepted.request_id) == accepted
        assert await runs.read_receipt(canvas_id, unknown.request_id) == unknown
        assert await runs.read_receipt(canvas_id, legacy_generation_request_id(source_id, 3)) is None
        assert await runs.read_receipt(canvas_id, legacy_generation_request_id('not-admitted', 1)) is None
        completed = await runs.read_task_run(canvas_id, known_task)
        assert completed.nodes[0].outputs[0].file_id == file_id
        tracking = await runs.read_task_run(canvas_id, unknown_task)
        assert (tracking.nodes[0].status, tracking.nodes[0].stage) == ('running', 'submission_unknown')
        visible = await read_generation(db, canvas_id, source_id)
        assert visible.requested_count == 3
        assert [(item.request_id, item.state) for item in visible.versions] == [
            (accepted.request_id, 'succeeded'), (unknown.request_id, 'unknown'),
        ]
        assert visible.changed_input is None and visible.review.state == 'stopped'
        unsubmitted = await read_generation(db, canvas_id, 'not-admitted')
        assert unsubmitted.state == 'stopped' and unsubmitted.versions == []
        session = await db.get(CanvasAssistantSession, canvas_id)
        assert session.pending_checkpoint == b'new-protocol'
