"""获批生成保留原请求和任务，实际供应商提交只有一次。"""

import asyncio
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.bootstrap import bootstrap_all_registries
from app.core import storage
from app.models.llm import Model, Provider
from app.schemas.generation_canvas import CanvasCreate, CanvasPrecheckRequest, CanvasRunSubmit, CanvasSave
from app.services.approval import ApprovalAccess, ApprovalScope, ApprovalService
from app.services.generation_canvas.approved_generation import (
    CanvasGenerationApprovals, advance_approved_canvas_generations, begin_approved_provider_submission,
)
from app.services.generation_canvas.edits import canvas_edits
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from app.services.generation_canvas.runs import canvas_runs
from app.services.task_service import TaskService
from app.task_worker import TaskWorker, WorkerLimits
from tests.directing.test_store import database
from tests.services.test_task_mysql import isolated_database_url


@pytest_asyncio.fixture
async def generation_sessions(request, tmp_path, monkeypatch):
    bootstrap_all_registries()

    async def upload(**kwargs):
        return None

    async def list_files(**kwargs):
        return [], None

    monkeypatch.setattr(storage, 'upload_file', upload)
    monkeypatch.setattr(storage, 'get_file_info', upload)
    monkeypatch.setattr(storage, 'delete_file', upload)
    monkeypatch.setattr(storage, 'list_files_page', list_files)
    if getattr(request, 'param', None) == 'mysql':
        engine = create_async_engine(isolated_database_url(), isolation_level='READ COMMITTED')
        try:
            yield async_sessionmaker(engine, expire_on_commit=False)
        finally:
            await engine.dispose()
    else:
        async with database(tmp_path) as sessions:
            yield sessions


async def submit_video_approval(sessions):
    async with sessions.begin() as db:
        suffix = uuid4().hex
        provider = Provider(id=suffix, provider_key='openai', name=suffix,
                            base_url='https://mock-provider.test', api_key='isolated-test')
        db.add(provider)
        await db.flush()
        model_id = 'video-' + suffix
        db.add(Model(id=model_id, name='test-video', category='video', provider_id=provider.id))
        canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='雨夜镜头'))
        document = canvas.document.model_dump(mode='json')
        document['cards'] = [{'id': 'v', 'type': 'model.video', 'model_id': model_id,
                              'config': {'ratio': '16:9', 'seconds': 5},
                              'prompt': {'segments': [{'kind': 'text', 'id': 'body', 'text': '镜头缓缓推近'}]}}]
        await canvas_edits(db, None).save(canvas.id, CanvasSave(
            request_id='edit', expected_revision=canvas.revision, document=document,
        ))
        access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='user',
                                permissions={'submit', 'read', 'decide'})
        request = await CanvasGenerationApprovals(db).submit(access, None, canvas.id, 'v', object_id='proposal',
                                                                version='v1', idempotency_key='submit')
        snapshot = await CanvasGenerationApprovals(db).read_snapshot(access, request.id)
        assert snapshot.input.text == '镜头缓缓推近' and snapshot.preview_token is None
    return canvas.id, access, request


async def decide(sessions, access, request):
    async with sessions.begin() as db:
        return await ApprovalService(db).decide(access, request.id, version='v1', group_ids=('generate',),
                                                action='approve', idempotency_key='approve-one')


async def observe_receipt(sessions, client, access, decision_id, *, state):
    worker = TaskWorker(sessions, client=client)
    running = asyncio.create_task(worker.run())
    try:
        async with asyncio.timeout(3):
            while True:
                async with sessions() as db:
                    status = await CanvasGenerationApprovals(db).read_receipt(access, decision_id)
                if status.state == state:
                    return status
                await asyncio.sleep(0.02)
    finally:
        worker.stopping.set()
        await running


@pytest.mark.asyncio
@pytest.mark.parametrize('generation_sessions', ['sqlite', 'mysql'], indirect=True)
async def test_restarted_worker_tracks_original_task_after_provider_response_lost(generation_sessions):
    sessions = generation_sessions
    canvas_id, access, request = await submit_video_approval(sessions)
    calls = []

    async def provider(req):
        calls.append((req.method, req.url.path))
        if req.method == 'POST':
            raise httpx.ReadTimeout('accepted, but reply disappeared', request=req)
        if req.url.path.endswith('/content'):
            return httpx.Response(200, headers={'content-type': 'video/mp4'}, content=b'controlled-video')
        return httpx.Response(200, json={'status': 'completed'})

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        idle = TaskWorker(sessions, client=client, limits=WorkerLimits(submit=0))
        try:
            async with sessions.begin() as db:
                assert (await canvas_runs(db, None).snapshot(canvas_id)).runs == []
            decision = await decide(sessions, access, request)
            await idle.tick()
        finally:
            idle.text_pool.shutdown()
        async with sessions() as db:
            original = await CanvasGenerationApprovals(db).read_receipt(access, decision.id)
            assert original.state == 'admitted'
            assert await canvas_runs(db, None).read_receipt(canvas_id, original.generation_request_id) == original.admission

        running = TaskWorker(sessions, client=client)
        try:
            await running.tick()
            await asyncio.gather(*running.jobs.values())
        finally:
            running.text_pool.shutdown()
        status = await observe_receipt(sessions, client, access, decision.id, state='unknown')
        assert status.admission == original.admission
        assert status.run.nodes[0].task_id == original.admission.task_ids[0]
        assert [method for method, _ in calls] == ['POST']

        trusted = ApprovalAccess(scope=access.scope, actor_id='provider-reconciler', permissions={'read'}, source='service')
        async with sessions.begin() as db:
            await CanvasGenerationApprovals(db).record_provider_id(trusted, decision.id, 'remote-video')
        # MySQL stores the due time at second precision. Let the real worker
        # reach that time instead of assuming its first tick can poll the task.
        receipt = await observe_receipt(sessions, client, access, decision.id, state='succeeded')
    assert receipt.admission == original.admission
    assert receipt.run.nodes[0].outputs[0].file_id
    assert calls == [('POST', '/videos'), ('GET', '/videos/remote-video'), ('GET', '/videos/remote-video/content')]


async def change_prompt(db, canvas_id):
    canvas = await free_canvas_lifecycle(db).read(canvas_id)
    document = canvas.document.model_dump(mode='json')
    document['cards'][0]['prompt']['segments'][0]['text'] = '新的独立创作参考'
    await canvas_edits(db, None).save(canvas_id, CanvasSave(
        request_id='edit-after-confirmation', expected_revision=canvas.revision, document=document,
    ))


@pytest.mark.asyncio
@pytest.mark.parametrize('existing_admission', [True, False])
async def test_replay_original_admission_precedes_new_precheck(generation_sessions, existing_admission):
    sessions = generation_sessions
    canvas_id, access, request = await submit_video_approval(sessions)
    decision = await decide(sessions, access, request)
    initial = None
    async with sessions.begin() as db:
        pending = await CanvasGenerationApprovals(db).read_receipt(access, decision.id)
        assert pending.state == 'pending'
        if existing_admission:
            precheck = await canvas_generation_inputs(db, None).precheck(canvas_id, CanvasPrecheckRequest(card_id='v'))
            initial = await canvas_runs(db, None).submit(canvas_id, CanvasRunSubmit(
                request_id=pending.generation_request_id, preview_token=precheck.preview_token,
            ))
        await change_prompt(db, canvas_id)
        approvals = CanvasGenerationApprovals(db)
        assert await approvals.submit(access, None, canvas_id, 'v', object_id='proposal', version='v1',
                                      idempotency_key='submit') == request
        assert (await approvals.read_snapshot(access, request.id)).input.text == '镜头缓缓推近'
    await advance_approved_canvas_generations(sessions)
    await advance_approved_canvas_generations(sessions)
    async with sessions.begin() as db:
        actual = await CanvasGenerationApprovals(db).read_receipt(access, decision.id)
        assert actual.generation_request_id == pending.generation_request_id
        assert actual.admission == initial
        runs = (await canvas_runs(db, None).snapshot(canvas_id)).runs
        if existing_admission:
            assert actual.state == 'admitted' and len(runs) == 1
            assert actual.run.nodes[0].basis['input']['text'] == '镜头缓缓推近'
        else:
            assert actual.state == 'conflict' and runs == []
            assert actual.diagnostic.code == 'GENERATION_BASIS_CHANGED'


@pytest.mark.asyncio
async def test_crash_after_durable_send_marker_does_not_resubmit(generation_sessions):
    sessions = generation_sessions
    _, access, request = await submit_video_approval(sessions)
    decision = await decide(sessions, access, request)
    await advance_approved_canvas_generations(sessions)
    async with sessions.begin() as db:
        accepted = await CanvasGenerationApprovals(db).read_receipt(access, decision.id)
        task_id = accepted.admission.task_ids[0]
        assert await TaskService(db).claim(task_id, worker_id='crashed-worker')
        assert await begin_approved_provider_submission(db, task_id, worker_id='crashed-worker')

    requests = []

    def provider(req):
        requests.append(req.url.path)
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        recovered = await observe_receipt(sessions, client, access, decision.id, state='unknown')
    assert recovered.admission == accepted.admission
    assert recovered.run.nodes[0].error_code == 'submission_unknown'
    assert requests == []
