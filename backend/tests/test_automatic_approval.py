"""普通后端入口的自动授权、逐组复核和迟到结果验收。"""

import asyncio

import pytest
from sqlalchemy import text

from app.services.approval import ApprovalAccess, ApprovalError, ApprovalScope, ApprovalService, ApprovalSubmission
from tests.directing.test_store import database


def authorities():
    scope = ApprovalScope(kind='canvas', id='canvas-1')
    return (
        ApprovalAccess(scope=scope, actor_id='creator', permissions={'submit'}),
        ApprovalAccess(scope=scope, actor_id='user', permissions={'read', 'decide'}),
        ApprovalAccess(scope=scope, actor_id='user', permissions={'read', 'decide'}, source='automatic'),
    )


@pytest.mark.asyncio
async def test_automatic_signs_only_reviewed_authorized_groups(tmp_path):
    from app.services.automatic_approval import (
        ApprovalEffect, AutomaticApprovalBasis, AutomaticApprovalService, AutomaticReviewVerdict,
    )

    submitter, human, automatic = authorities()
    edit = ApprovalEffect(kind='edit', target_id='model')
    delete = ApprovalEffect(kind='delete_card', target_id='old')
    release = ApprovalEffect(kind='release_binding', target_id='model', binding_id='selected')
    generate = ApprovalEffect(kind='generate', target_id='video', count=1)
    groups = {'ready': edit, 'manual': edit, 'outside': edit, 'delete': delete, 'release': release, 'generate': generate}

    class Policy:
        async def load_basis(self, db, request, group_id, *, lock):
            effect = groups[group_id]
            return AutomaticApprovalBasis(
                authority_revision='grant-1', actor_id='user', user_request='更新内容',
                effects=(effect,), allowed_effects=frozenset({effect}) if group_id != 'outside' else frozenset(),
            )

    reviewed = []

    async def review(evidence):
        reviewed.append(evidence.group_id)
        return AutomaticReviewVerdict(
            decision='manual' if evidence.group_id == 'manual' else 'approve', reason='已核对当前改动',
        )

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            request = await ApprovalService(db).submit(submitter, ApprovalSubmission(
                object_type='proposal', object_id='turn', version='v1',
                group_ids=tuple(groups), snapshot_ref='canvas-snapshot-v1',
            ), idempotency_key='submit')
            with pytest.raises(ApprovalError, match='独立复核'):
                await ApprovalService(db).decide(automatic, request.id, version='v1', group_ids=('delete',),
                                                 action='approve', idempotency_key='bypass')
        service = AutomaticApprovalService(sessions, Policy(), review)
        results = await service.approve(automatic, request.id, version='v1', group_ids=tuple(groups))
        assert [result.status for result in results] == [
            'approved', 'manual_required', 'not_authorized', 'not_authorized', 'not_authorized', 'not_authorized',
        ]
        assert reviewed == ['ready', 'manual']
        assert results[0].decision.group_ids == ('ready',)
        replay = await service.approve(automatic, request.id, version='v1', group_ids=('ready',))
        assert replay[0].decision == results[0].decision and reviewed == ['ready', 'manual']
        async with sessions.begin() as db:
            approvals = ApprovalService(db)
            manual = await approvals.decide(human, request.id, version='v1', group_ids=('manual',),
                                            action='approve', idempotency_key='manual')
            assert manual.source == 'human'
            assert await approvals.list_decisions(human, request.id) == (results[0].decision, manual)
            assert (await approvals.read(human, request.id)).group_states['generate'] == 'pending'


@pytest.mark.asyncio
@pytest.mark.parametrize('changed', ['grant', 'regrant', 'manual', 'version', 'automatic'])
async def test_late_independent_review_cannot_authorize_changed_scope(tmp_path, changed):
    from app.services.automatic_approval import (
        ApprovalEffect, AutomaticApprovalBasis, AutomaticApprovalService, AutomaticReviewVerdict,
    )

    submitter, human, automatic = authorities()
    effect = ApprovalEffect(kind='edit', target_id='selected')
    start_review, finish_review = asyncio.Event(), asyncio.Event()
    reviews = 0

    class Policy:
        async def load_basis(self, db, request, group_id, *, lock):
            # SQLite 的写锁确保撤权和最后一次授权检查串行。
            if lock:
                await db.execute(text('UPDATE test_canvas_grant SET revision = revision'))
            enabled, revision = (await db.execute(text('SELECT enabled, revision FROM test_canvas_grant'))).one()
            if not enabled:
                return None
            return AutomaticApprovalBasis(
                authority_revision=str(revision), actor_id='user', user_request='调整镜头',
                effects=(effect,), allowed_effects=frozenset({effect}),
            )

    async def review(evidence):
        nonlocal reviews
        assert evidence.group_id == 'shot'
        reviews += 1
        if reviews == 1:
            start_review.set()
            await finish_review.wait()
        return AutomaticReviewVerdict(decision='approve', reason='按旧授权核对')

    async with database(tmp_path) as sessions:
        command = ApprovalSubmission(object_type='proposal', object_id='turn', version='v1',
                                     group_ids=('shot',), snapshot_ref='snapshot-v1')
        async with sessions.begin() as db:
            await db.execute(text('CREATE TABLE test_canvas_grant (revision INTEGER, enabled INTEGER)'))
            await db.execute(text('INSERT INTO test_canvas_grant VALUES (1, 1)'))
            request = await ApprovalService(db).submit(submitter, command, idempotency_key='submit')
        service = AutomaticApprovalService(sessions, Policy(), review)
        pending = asyncio.create_task(service.approve(automatic, request.id, version='v1', group_ids=('shot',)))
        try:
            await asyncio.wait_for(start_review.wait(), timeout=3)
            first_decision = None
            if changed == 'automatic':
                [competing] = await service.approve(automatic, request.id, version='v1', group_ids=('shot',))
                first_decision = competing.decision
                assert first_decision and competing.status == 'approved'
            elif changed in {'grant', 'regrant'}:
                async with sessions.begin() as db:
                    await db.execute(text('UPDATE test_canvas_grant SET enabled = 0, revision = 2'))
                if changed == 'regrant':
                    async with sessions.begin() as db:
                        await db.execute(text('UPDATE test_canvas_grant SET enabled = 1, revision = 3'))
            else:
                async with sessions.begin() as db:
                    approvals = ApprovalService(db)
                    if changed == 'manual':
                        await approvals.decide(human, request.id, version='v1', group_ids=('shot',),
                                               action='reject', idempotency_key='reject')
                    else:
                        await approvals.submit(submitter, command.model_copy(update={
                            'version': 'v2', 'snapshot_ref': 'snapshot-v2', 'supersedes_request_id': request.id,
                        }), idempotency_key='replace')
            finish_review.set()
            [result] = await pending
            assert result.status == ('approved' if first_decision else 'stale')
            assert result.decision == first_decision
            async with sessions() as db:
                decisions = await ApprovalService(db).list_decisions(human, request.id)
                expected_sources = {'manual': ['human'], 'automatic': ['automatic']}
                assert [decision.source for decision in decisions] == expected_sources.get(changed, [])
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize(('kind', 'instruction', 'argument', 'approved'), [
    ('delete_card', '删除 video', None, True),
    ('delete_card', '不要删除 video', None, False),
    ('delete_card', '删除 other', None, False),
    ('release_binding', '解除首帧引用', 'first', True),
    ('release_binding', '解除首帧引用', 'other', False),
    ('generate', '请生成一版', 1, True),
    ('generate', '请生成一版', 2, False),
    ('generate', '可以生成一版吗？', 1, False),
])
async def test_sensitive_canvas_effects_require_matching_user_words(tmp_path, kind, instruction, argument, approved):
    from app.schemas.generation_canvas import CanvasDocument
    from app.services.automatic_approval import (
        ApprovalEffect, AutomaticApprovalBasis, AutomaticApprovalService, AutomaticReviewVerdict,
    )
    from app.services.generation_canvas.assistant_approval import explicit_canvas_effects

    submitter, _, automatic = authorities()
    effect = ApprovalEffect(kind=kind, target_id='video',
                            binding_id=argument if kind == 'release_binding' else None,
                            count=argument if kind == 'generate' else None)
    document = CanvasDocument.model_validate({'id': 'canvas-1', 'name': '镜头', 'cards': [
        {'type': 'model.video', 'id': 'video'},
    ]})
    selection = {'scope': 'selection', 'target_card_ids': ['video'], 'cards': [
        {'id': 'video', 'name': '当前镜头', 'input_bindings': [{'id': 'first', 'input_port': 'first_frame'}]},
    ]}

    class Policy:
        async def load_basis(self, db, request, group_id, *, lock):
            return AutomaticApprovalBasis(
                authority_revision='grant-1', actor_id='user', user_request=instruction, effects=(effect,),
                allowed_effects=frozenset({effect}),
                explicit_effects=explicit_canvas_effects(instruction, selection, document, (effect,)),
            )

    async def review(_evidence):
        return AutomaticReviewVerdict(decision='approve', reason='明确匹配')

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            request = await ApprovalService(db).submit(submitter, ApprovalSubmission(
                object_type='proposal', object_id='turn', version='v1', group_ids=('action',), snapshot_ref='snap',
            ), idempotency_key='submit')
        service = AutomaticApprovalService(sessions, Policy(), review)
        [result] = await service.approve(automatic, request.id, version='v1', group_ids=('action',))
        assert result.status == ('approved' if approved else 'not_authorized')
        assert bool(result.decision) is approved
