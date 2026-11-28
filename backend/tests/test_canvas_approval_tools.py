"""角色分离的画布审批工具通过真实业务事务验收。"""

import json

import pytest

from app.schemas.generation_canvas import CanvasCreate, TextContentCard
from app.services.approval import ApprovalAccess, ApprovalError, ApprovalScope, ApprovalService
from app.services.generation_canvas.approval_tools import (
    CanvasApprovalDecisionTool, CanvasApprovalTools, ConfirmedCanvasApproval, DecideCanvasApproval,
    QueryCanvasApproval, StagedCanvasApproval, SubmitCanvasApproval,
)
from app.services.generation_canvas.edits import CanvasEditGroup, canvas_edits
from app.services.generation_canvas.approved_generation import CanvasGenerationApprovals
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from app.services.generation_canvas.runs import canvas_runs
from tests.directing.test_store import database
from tests.test_approved_canvas_generation import change_prompt, generation_sessions, submit_video_approval  # noqa: F401


@pytest.mark.asyncio
async def test_create_and_decision_tools_share_one_immutable_request_without_self_approval(tmp_path):
    async with database(tmp_path) as sessions, sessions.begin() as db:
        lifecycle = free_canvas_lifecycle(db)
        canvas = await lifecycle.create_free(CanvasCreate(name='雨夜'))
        preview = await canvas_edits(db, None).preview(canvas.id, [
            CanvasEditGroup(id='first', cards=[TextContentCard(id='first-shot', text='雨景')]),
            CanvasEditGroup(id='second', cards=[TextContentCard(id='second-shot', text='桥面')]),
        ])
        scope = ApprovalScope(kind='canvas', id=canvas.id)
        author = ApprovalAccess(scope=scope, actor_id='creator', permissions={'submit', 'read'})
        reviewer = ApprovalAccess(scope=scope, actor_id='editor', permissions={'read', 'decide'})
        creator = CanvasApprovalTools(db, author, None, allow_submit=True)
        creator.stage(StagedCanvasApproval(preview_id='draft', object_id='turn', version='v1',
                                          idempotency_key='submit-v1', preview=preview))
        assert {tool.name for tool in creator.tools()} == {'submit_canvas_approval', 'read_canvas_approval'}
        command = SubmitCanvasApproval(preview_id='draft', version='v1')
        request = await creator.submit(command)
        assert await creator.submit(command) == request
        viewed = await creator.query(QueryCanvasApproval(request_id=request.id))
        assert viewed.request.applicant_id == 'creator'
        assert viewed.snapshot == preview
        assert viewed.request.group_states == {'first': 'pending', 'second': 'pending'}
        assert (await lifecycle.read(canvas.id)).document.cards == []

        choice = DecideCanvasApproval(request_id=request.id, version='v1', group_ids=('first',), action='approve')
        confirmed = ConfirmedCanvasApproval(choice=choice, idempotency_key='approve-first')
        with pytest.raises(ApprovalError) as privilege:
            CanvasApprovalDecisionTool(db, author, confirmed=confirmed)
        assert privilege.value.code == 'forbidden'

        tool = CanvasApprovalDecisionTool(db, reviewer, confirmed=confirmed)
        for forged in (choice.model_copy(update={'group_ids': ('first', 'second')}),
                       choice.model_copy(update={'action': 'reject'})):
            with pytest.raises(ApprovalError) as denied:
                await tool.decide(forged)
            assert denied.value.code == 'confirmation_mismatch'
        decision = await tool.decide(choice)
        assert await tool.decide(choice) == decision
        assert decision.actor_id == 'editor' and decision.group_ids == ('first',)
        assert (await creator.query(QueryCanvasApproval(request_id=request.id))).request.group_states == {
            'first': 'approved', 'second': 'pending',
        }


@pytest.mark.asyncio
async def test_plan_only_and_foreign_scopes_cannot_submit_or_decide(tmp_path):
    async with database(tmp_path) as sessions, sessions.begin() as db:
        lifecycle = free_canvas_lifecycle(db)
        canvas = await lifecycle.create_free(CanvasCreate(name='雨夜'))
        other = await lifecycle.create_free(CanvasCreate(name='其他画布'))
        preview = await canvas_edits(db, None).preview(canvas.id, [CanvasEditGroup(
            id='first', cards=[TextContentCard(id='first-shot', text='雨景')],
        )])
        access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='creator',
                                permissions={'submit', 'read'})
        staged = StagedCanvasApproval(preview_id='draft', object_id='turn', version='v1',
                                      idempotency_key='submit-v1', preview=preview)
        plan_only = CanvasApprovalTools(db, access, None, allow_submit=False)
        plan_only.stage(staged)
        assert [tool.name for tool in plan_only.tools()] == ['read_canvas_approval']
        with pytest.raises(ApprovalError) as plan_denied:
            await plan_only.submit(SubmitCanvasApproval(preview_id='draft', version='v1'))
        assert plan_denied.value.code == 'forbidden'
        assert await ApprovalService(db).read_submitted(access, object_type='canvas-edit', object_id='turn',
                                                       idempotency_key='submit-v1') is None

        creator = CanvasApprovalTools(db, access, None, allow_submit=True)
        creator.stage(staged)
        # Altering the application-side object after staging cannot change what will be submitted.
        preview.groups[0].differences[0].after.value['text'] = '未确认改稿'
        submit = next(tool for tool in creator.tools() if tool.name == 'submit_canvas_approval')
        assert await submit.ainvoke({'preview_id': 'draft', 'version': 'v1', 'actor_id': 'approver',
                                     'scope': other.id, 'permissions': ['decide'], 'preview': {}}) == (
            '请提供暂存预演标识和原版本。'
        )
        assert await submit.ainvoke({'preview_id': 'draft', 'version': 'guess'}) == '暂存预演不存在或版本已变化'
        request = json.loads(await submit.ainvoke({'preview_id': 'draft', 'version': 'v1'}))
        status = await creator.query(QueryCanvasApproval(request_id=request['id']))
        assert status.snapshot.groups[0].differences[0].after.value['text'] == '雨景'
        external = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=other.id), actor_id='editor',
                                  permissions={'read', 'decide'})
        other_creator = CanvasApprovalTools(db, external, None, allow_submit=False,
                                            readable_request_ids=[request['id']])
        with pytest.raises(ApprovalError) as other_query:
            await other_creator.query(QueryCanvasApproval(request_id=request['id']))
        assert other_query.value.code == 'request_not_found'
        choice = DecideCanvasApproval(request_id=request['id'], version='v1', group_ids=('first',), action='approve')
        confirmed = ConfirmedCanvasApproval(choice=choice, idempotency_key='foreign')
        with pytest.raises(ApprovalError) as other_decision:
            await CanvasApprovalDecisionTool(db, external, confirmed=confirmed).decide(choice)
        assert other_decision.value.code == 'request_not_found'


@pytest.mark.asyncio
async def test_old_version_cannot_be_decided_after_new_preview_is_submitted(tmp_path):
    async with database(tmp_path) as sessions, sessions.begin() as db:
        canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='雨夜'))
        access = ApprovalAccess(scope=ApprovalScope(kind='canvas', id=canvas.id), actor_id='operator',
                                permissions={'submit', 'read', 'decide'})
        creator = CanvasApprovalTools(db, access, None, allow_submit=True)
        edits = canvas_edits(db, None)
        old = await edits.preview(canvas.id, [CanvasEditGroup(
            id='first', cards=[TextContentCard(id='first-shot', text='雨景')],
        )])
        creator.stage(StagedCanvasApproval(preview_id='one', object_id='turn', version='v1',
                                          idempotency_key='one', preview=old))
        original_request = await creator.submit(SubmitCanvasApproval(preview_id='one', version='v1'))
        new = await edits.preview(canvas.id, [CanvasEditGroup(
            id='first', cards=[TextContentCard(id='first-shot', text='雨景改稿')],
        )])
        creator.stage(StagedCanvasApproval(preview_id='two', object_id='turn', version='v2', idempotency_key='two',
                                          supersedes_request_id=original_request.id, preview=new))
        replacement = await creator.submit(SubmitCanvasApproval(preview_id='two', version='v2'))
        old_choice = DecideCanvasApproval(request_id=original_request.id, version='v1',
                                          group_ids=('first',), action='approve')
        decision = CanvasApprovalDecisionTool(db, access, confirmed=ConfirmedCanvasApproval(
            choice=old_choice, idempotency_key='approve-old',
        ))
        assert await decision.tool().ainvoke(old_choice.model_dump()) == '所见审批版本已失效，请重新核对'
        assert (await creator.query(QueryCanvasApproval(request_id=replacement.id))).request.group_states == {
            'first': 'pending',
        }


@pytest.mark.asyncio
async def test_generation_tool_rechecks_frozen_staged_inputs_before_submission(generation_sessions):
    sessions = generation_sessions
    canvas_id, access, _ = await submit_video_approval(sessions)
    async with sessions.begin() as db:
        generations = CanvasGenerationApprovals(db)
        creator = CanvasApprovalTools(db, access, None, allow_submit=True)
        preview = await generations.capture(access, None, canvas_id, 'v')
        creator.stage(StagedCanvasApproval(preview_id='old', object_id='tool', version='v1',
                                          idempotency_key='old', preview=preview))
        await change_prompt(db, canvas_id)
        with pytest.raises(ApprovalError) as stale:
            await creator.submit(SubmitCanvasApproval(preview_id='old', version='v1'))
        assert stale.value.code == 'preview_stale'
        assert await ApprovalService(db).read_submitted(access, object_type='canvas-generation', object_id='tool',
                                                       idempotency_key='old') is None
        current = await generations.capture(access, None, canvas_id, 'v')
        creator.stage(StagedCanvasApproval(preview_id='new', object_id='tool', version='v2',
                                          idempotency_key='new', preview=current))
        request = await creator.submit(SubmitCanvasApproval(preview_id='new', version='v2'))
        status = await creator.query(QueryCanvasApproval(request_id=request.id))
        assert status.snapshot == current.precheck and status.snapshot.preview_token is None
        assert status.request.group_states == {'generate': 'pending'}
        assert (await canvas_runs(db, None).snapshot(canvas_id)).runs == []
