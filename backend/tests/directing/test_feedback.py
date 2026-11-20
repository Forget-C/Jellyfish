"""阶段五固定采用、局部返工归因与经验隔离的真实事务回归。"""
from copy import deepcopy

import pytest
from sqlalchemy import func, select

from app.models.task import Task
from app.services.directing.feedback import FeedbackService
from app.services.directing.store import RevisionConflict
from tests.directing.samples import note
from tests.directing.test_store import database, frozen, output, setup_story


async def prepared(db):
    """构造固定真实采用，不调用外部模型。"""
    _, sid, _, pid, prompts = await setup_story(db)
    service = FeedbackService(db, 'p1')
    await output(db, prompts[0])
    take = await service.register_take(prompt_revision_id=prompts[0], task_id='task1', output_ordinal=0)
    cut = await frozen(service, sid, 'cut', {'items': [{'kind': 'media', 'id': 'a', 'take_id': take.id,
        'media_range': {'source_in_ms': 1000, 'source_out_ms': 7000}, 'timeline_start_ms': 0}]})
    return service, sid, pid, take, cut


def review(cid):
    """整体判断有来源，声音保持待后期。"""
    return {'cut_revision_id': cid, 'verdict': 'pass', 'overall': note('本场意图成立'), 'established': note('反应成立'),
        'missing_coverage': {'state': 'none', 'reason': '已逐项查看'}, 'usable_ranges': [], 'awaiting_evidence': {},
        'sound_status': 'pending_postproduction', 'sound_observation': {}, 'issues': []}


def repair(cid):
    """只修复末尾一秒，提供来源和可观察验收条件。"""
    return {'cut_revision_id': cid, 'item_id': 'a', 'problem_range': {'source_in_ms': 6000, 'source_out_ms': 7000},
        'symptom': note('纸张消失'), 'root_cause_hypothesis': note('可能动作过多'), 'retained_ranges': [],
        'preferred_fix': 'reshoot', 'alternative_fix': note('也可剪去末尾'), 'needs_new_media': True,
        'primary_change': note('缩短时长'), 'acceptance': note('借条保持可见')}


@pytest.mark.asyncio
async def test_review_active_cut_and_workspace(tmp_path):
    """草稿不改变验收，替换确认后旧结论失效且旧页面确认被拒绝。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sid, _, take, cut = await prepared(db)
            accepted = await frozen(service, sid, 'cut_review', review(cut.id))
            feedback = await service.feedback(sid)
            assert feedback.current_review_id == accepted.id
            assert feedback.reviews[-1].content.verdict == 'pass'
            assert feedback.reviews[-1].content.sound_status == 'pending_postproduction'
            changed = deepcopy(cut.payload)
            changed['items'][0]['media_range']['source_out_ms'] = 6000
            draft = await service.save_revision(sid, kind='cut', payload=changed, parent_id=cut.id)
            assert (await service.feedback(sid)).active_cut_revision_id == cut.id
            stale = await service.save_revision(sid, kind='cut_review', payload=review(cut.id))
            assert (await service.feedback(sid)).current_review_id == accepted.id
            await service.confirm_revision(draft.id, expected_version=1, actor_id='author')
            assert (await service.feedback(sid)).active_cut_revision_id == draft.id
            assert (await service.feedback(sid)).current_review_id is None
            with pytest.raises(RevisionConflict, match='采用版本'):
                await service.confirm_revision(stale.id, expected_version=1, actor_id='author')
            assert len((await service.workspace(sid)).takes) == 1
            assert len((await service.ledger(sid)).feedback.reviews) == 2


@pytest.mark.asyncio
async def test_review_fake_pass_and_bounds(tmp_path):
    """缺口、空剪辑和越过采用范围的证据不能通过；跨项目读取拒绝。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sid, _, take, cut = await prepared(db)
            data = review(cut.id)
            data['missing_coverage'] = note('缺反应')
            with pytest.raises(ValueError):
                await service.save_revision(sid, kind='cut_review', payload=data)
            data = review(cut.id)
            data['usable_ranges'] = [{'take_id': take.id, 'media_range': {'source_in_ms': 0, 'source_out_ms': 2000}}]
            with pytest.raises(ValueError, match='采用区间'):
                await service.save_revision(sid, kind='cut_review', payload=data)
            empty = await frozen(service, sid, 'cut', {'items': []})
            with pytest.raises(ValueError, match='空剪辑'):
                await service.save_revision(sid, kind='cut_review', payload=review(empty.id))
            with pytest.raises(ValueError, match='project'):
                await FeedbackService(db, 'p2').feedback(sid)


@pytest.mark.asyncio
async def test_real_change_attribution_and_retained_ranges(tmp_path):
    """两项实际变化不能伪称单变量，记录返工不提交模型或改粗剪。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sid, pid, take, cut = await prepared(db)
            data = repair(cut.id)
            data['retained_ranges'] = [{'take_id': take.id, 'media_range': {'source_in_ms': 1000, 'source_out_ms': 6000}}]
            original = await frozen(service, sid, 'repair', data)
            from app.core.contracts.directing.feedback import RepairPlanRequest
            partial = await service.prepare_repair_plan(sid, original.id, RepairPlanRequest(coverage_item_ids=['c1'], action_scope='仅补纸张末尾动作', duration_ms=3000))
            assert partial.confirmed_at is None and len(partial.payload['units']) == 1
            assert [item['id'] for item in partial.payload['units'][0]['coverage']] == ['c1']
            assert (await service.feedback(sid)).repairs[0].prepared_plan_ids == [partial.id]
            plan = deepcopy((await service.revision(pid)).payload)
            plan['units'][0]['duration_ms'] += 1000
            plan['units'][0]['parameters'] = {'seed': 42}
            new = await frozen(service, sid, 'plan', plan)
            prompt = await frozen(service, sid, 'prompt', {**(await service.revision(take.prompt_revision_id)).payload, 'plan_revision_id': new.id})
            await output(db, prompt.id, 'task2', 'video2')
            after = await service.register_take(prompt_revision_id=prompt.id, task_id='task2', output_ordinal=0)
            data.update(result_plan_revision_id=new.id, result_unit_id=after.unit_id, result_take_id=after.id,
                result_range={'source_in_ms': 0, 'source_out_ms': 2000}, comparison=note('不能单独归因'), attribution='single_variable')
            with pytest.raises(ValueError, match='单变量'):
                await service.save_revision(sid, kind='repair', payload=data, parent_id=original.id)
            data['attribution'] = 'multiple_variables'
            await frozen(service, sid, 'repair', data)
            assert (await service.feedback(sid)).repairs[-1].changed_factors == ['duration_ms', 'parameters.seed']
            assert await db.scalar(select(func.count()).select_from(Task)) == 2
            assert (await service.active_cut(sid)).id == cut.id
            data['retained_ranges'][0]['media_range']['source_out_ms'] = 6500
            with pytest.raises(ValueError, match='重叠'):
                await service.save_revision(sid, kind='repair', payload=data)


@pytest.mark.asyncio
async def test_knowledge_requires_human_confirmation(tmp_path):
    """有来源的 P/O/C 仍是项目候选，转为风格也只创建草稿。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sid, _, take, cut = await prepared(db)
            diagnosis = await frozen(service, sid, 'repair', repair(cut.id))
            data = {'category': 'O', 'role': 'prompt', 'claim': note('当前条件宜拆短动作'), 'conditions': '本项目借条动作',
                'recommendation': '保留好区间，局部补拍', 'counterexamples': note('尚有失败样例'), 'exceptions': {},
                'confidence': 'tentative', 'review_on': '2026-10-01', 'evidence_revision_ids': [diagnosis.id], 'evidence_take_ids': [take.id]}
            candidate = await service.save_revision(sid, kind='knowledge', payload=data)
            with pytest.raises(ValueError, match='confirmed'):
                await service.propose_style(sid, candidate.id)
            await service.confirm_revision(candidate.id, expected_version=1, actor_id='author')
            assert await service.list_styles() == []
            style = await service.propose_style(sid, candidate.id)
            assert style.confirmed_at is None
            assert style.payload['rules'][0]['sequence_ids'] == [sid]
            assert style.payload['rules'][0]['status'] == 'candidate'


def test_nested_changes_are_not_one_variable():
    """同一摄影栏目同时改构图和运动，必须记录两个因素。"""
    from app.services.directing.feedback_rules import semantic_changes
    assert semantic_changes({'id': 'old', 'composition': '双人', 'movement': '固定', 'sources': ['a']},
        {'id': 'new', 'composition': '单人', 'movement': '推近', 'sources': ['b']}, 'camera') == ['camera.composition', 'camera.movement']


@pytest.mark.asyncio
async def test_repair_cannot_lose_retained_range_or_implicitly_request_media(tmp_path):
    """结果剪辑丢失好区间时拒绝归档，纯剪辑返工不能隐式准备补拍。"""
    from app.core.contracts.directing.feedback import RepairPlanRequest
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sid, _, take, cut = await prepared(db)
            data = repair(cut.id)
            data['needs_new_media'] = False
            data['retained_ranges'] = [{'take_id': take.id, 'media_range': {'source_in_ms': 1000, 'source_out_ms': 6000}}]
            row = await frozen(service, sid, 'repair', data)
            with pytest.raises(ValueError, match='新素材'):
                await service.prepare_repair_plan(sid, row.id, RepairPlanRequest(coverage_item_ids=['c1'], action_scope='不应提交', duration_ms=3000))
            shortened = deepcopy(cut.payload)
            shortened['items'][0]['media_range']['source_in_ms'] = 3000
            replacement = await frozen(service, sid, 'cut', shortened)
            data['result_cut_revision_id'] = replacement.id
            with pytest.raises(ValueError, match='保留'):
                await service.save_revision(sid, kind='repair', payload=data)
            # Restoring the full retained range is a valid explicit trim result.
            shortened['items'][0]['media_range'] = {'source_in_ms': 1000, 'source_out_ms': 6000}
            result = await frozen(service, sid, 'cut', shortened)
            data['result_cut_revision_id'] = result.id
            saved = await frozen(service, sid, 'repair', data)
            assert saved.payload['retained_ranges'][0]['media_range']['source_in_ms'] == 1000
