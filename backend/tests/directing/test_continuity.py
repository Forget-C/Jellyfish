"""实际落幅依赖、局部替换影响和排队后失效的离线验收。"""
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from app.core.contracts.directing.continuity import CutFrameRequest, SeamReviewRequest
from app.core.contracts.directing.production import ProductionPlan
from app.models.directing import Take
from app.models.task import Task
from app.services.directing.continuity import ContinuityService
from app.services.directing.production import ProductionService
from tests.directing.test_store import database, frozen, output
from tests.directing.test_production import prepare


async def story(db, monkeypatch):
    """三个真实素材项使用隔离文件归档替身，整个业务链仍走正式事务服务。"""
    monkeypatch.setattr('app.core.storage.download_file', AsyncMock(return_value=b'local-video'))
    monkeypatch.setattr('app.core.storage.upload_file', AsyncMock())
    monkeypatch.setattr('app.services.directing.media.extract_boundary_frame', lambda content, start, end, edge: (b'\x89PNG\r\n\x1a\nimage', start if edge == 'start' else end - 1))
    base, sequence_id, plan_id, first_prompt, _ = await prepare(db)
    second_prompt = (await base.compile_unit(sequence_id, plan_id, 'u2')).id
    takes = []
    for index, prompt in enumerate([first_prompt, second_prompt, first_prompt]):
        await output(db, prompt, f'output-{index}')
        takes.append(await base.register_take(prompt_revision_id=prompt, task_id=f'output-{index}', output_ordinal=0))
    cut = await frozen(base, sequence_id, 'cut', {'items': [
        {'kind': 'media', 'id': identity, 'take_id': take.id, 'timeline_start_ms': index * 2000,
         'media_range': {'source_in_ms': 1000, 'source_out_ms': 3000}}
        for index, (identity, take) in enumerate(zip(['a', 'b', 'c'], takes))]})
    service = ContinuityService(db, 'p1')
    frames = {}
    for identity, edge in [('a', 'end'), ('b', 'start'), ('b', 'end'), ('c', 'start'), ('c', 'end')]:
        frames[identity + edge] = await service.extract_cut_frame(sequence_id, CutFrameRequest(cut_revision_id=cut.id, item_id=identity, edge=edge))
    return service, sequence_id, plan_id, cut, frames


async def dependent_plan(service, sequence_id, plan_id, frames):
    """两个单元分别依赖 a、c 落幅，以验证替换 a 不影响 c 的使用方。"""
    data = deepcopy((await service.revision(plan_id)).payload)
    for unit, frame in zip(data['units'], [frames['aend'], frames['cend']]):
        unit['references'] = [{'id': 'actual-frame', 'file_id': frame.file_id, 'media_kind': 'image',
            'purpose': 'continuity', 'participant_ids': [], 'ordinal': 0, 'input_role': 'first_frame',
            'source': {'kind': 'human', 'reference': 'author', 'version': '1'}}]
        unit['dependencies'] = [{'plan_revision_id': frame.plan_revision_id, 'unit_id': frame.unit_id,
            'frame_id': frame.id, 'reference_id': 'actual-frame'}]
    return await frozen(service, sequence_id, 'plan', data)


@pytest.mark.asyncio
async def test_actual_frames_seams_and_local_replacement(tmp_path, monkeypatch):
    """确认新采用后，只 a 的使用单元及 a/b 接缝待复核；b/c 和历史版本保持原样。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, cut, frames = await story(db, monkeypatch)
            plan = await dependent_plan(service, sequence_id, plan_id, frames)
            assert frames['aend'].at_ms == 2999 and frames['bstart'].at_ms == 1000
            for left, right in [('a', 'b'), ('b', 'c')]:
                await service.review_seam(sequence_id, SeamReviewRequest(cut_revision_id=cut.id,
                    left_frame_id=frames[left + 'end'].id, right_frame_id=frames[right + 'start'].id,
                    verdict='pass', rationale='人工确认朝向和纸张位置衔接'))
            state = await service.continuity(sequence_id)
            assert [row.status for row in state.seams] == ['pass', 'pass']
            assert [row.status for row in state.units] == ['ready', 'ready']
            before_tasks = await db.scalar(select(func.count()).select_from(Task))
            replacement = deepcopy(cut.payload)
            replacement['items'][0]['media_range'] = {'source_in_ms': 4000, 'source_out_ms': 6000}
            draft = await service.save_revision(sequence_id, kind='cut', payload=replacement, parent_id=cut.id)
            assert (await service.continuity(sequence_id)).active_cut_revision_id == cut.id
            await service.confirm_revision(draft.id, expected_version=1, actor_id='author')
            state = await service.continuity(sequence_id)
            assert [row.status for row in state.seams] == ['pending', 'pass']
            assert [row.status for row in state.units] == ['blocked', 'ready']
            assert (await service.revision(cut.id)).payload['items'][0]['media_range']['source_in_ms'] == 1000
            assert await db.scalar(select(func.count()).select_from(Task)) == before_tasks
            assert await db.scalar(select(func.count()).select_from(Take)) == 3
            units = ProductionPlan.model_validate(plan.payload).units
            with pytest.raises(ValueError, match='区间已变化'):
                await ProductionService(db, 'p1').validate_unit(sequence_id, plan.id, units[0].id)
            await ProductionService(db, 'p1').validate_unit(sequence_id, plan.id, units[1].id)
            with pytest.raises(ValueError, match='版本已变化'):
                await service.review_seam(sequence_id, SeamReviewRequest(cut_revision_id=cut.id,
                    left_frame_id=frames['aend'].id, right_frame_id=frames['bstart'].id, verdict='pass', rationale='旧页面'))


@pytest.mark.asyncio
async def test_pending_and_forged_dependency_cannot_execute(tmp_path, monkeypatch):
    """缺证据可保存待准备计划；伪造来源、入幅冒充落幅和未发送图片均拒绝。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, cut, frames = await story(db, monkeypatch)
            pending = deepcopy((await service.revision(plan_id)).payload)
            pending['units'][0]['dependencies'] = [{'plan_revision_id': plan_id, 'unit_id': 'u2'}]
            plan = await frozen(service, sequence_id, 'plan', pending)
            with pytest.raises(ValueError, match='尚未选择实际落幅'):
                await ProductionService(db, 'p1').compile_unit(sequence_id, plan.id, 'u1')
            valid = await dependent_plan(service, sequence_id, plan_id, frames)
            for field, value in [('unit_id', 'u2'), ('frame_id', frames['bstart'].id), ('reference_id', 'missing')]:
                invalid = deepcopy(valid.payload)
                invalid['units'][0]['dependencies'][0][field] = value
                with pytest.raises(ValueError, match='不一致|明确绑定'):
                    await service.save_revision(sequence_id, kind='plan', payload=invalid)
            with pytest.raises(ValueError, match='project'):
                await ContinuityService(db, 'p2').cut_frame(sequence_id, frames['aend'].id)
            with pytest.raises(ValueError, match='相邻'):
                await service.review_seam(sequence_id, SeamReviewRequest(cut_revision_id=cut.id,
                    left_frame_id=frames['aend'].id, right_frame_id=frames['cstart'].id, verdict='pass', rationale='隔了一项'))


@pytest.mark.asyncio
async def test_queued_dependency_rechecked_before_provider_submission(tmp_path, monkeypatch):
    """预检受理后替换上游，Worker 不发送失效请求，也不生成整场重拍任务。"""
    from app.core.contracts.directing.common import ROLES
    from app.services.task_service import TaskService
    from app.task_worker import TaskWorker

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, cut, frames = await story(db, monkeypatch)
            plan = await dependent_plan(service, sequence_id, plan_id, frames)
            production = ProductionService(db, 'p1')
            prompt = await production.compile_unit(sequence_id, plan.id, 'u1')
            review = await frozen(service, sequence_id, 'review', {
                'mode': 'formal', 'roles': list(ROLES), 'context': {},
                'occurrences': [{'id': 'o1', 'prompt_revision_id': prompt.id, 'plan_revision_id': plan.id,
                    'unit_id': 'u1', 'coverage_item_id': 'c1', 'shot_id': 's1', 'local_number': 1}],
                'rows': [{'role': role, 'occurrence_id': 'o1', 'verdict': 'pass', 'rationale': '离线固定审稿', 'findings': []} for role in ROLES]})
            task = await production.shoot(sequence_id, prompt_id=prompt.id, review_id=review.id, request_id='before-change')
            task_id = task.id
            await TaskService(db).claim(task_id, worker_id='worker')
            changed = deepcopy(cut.payload)
            changed['items'][0]['media_range'] = {'source_in_ms': 3000, 'source_out_ms': 5000}
            await frozen(service, sequence_id, 'cut', changed)
            before = await db.scalar(select(func.count()).select_from(Task))
        monkeypatch.setattr('app.task_worker.build_media_input', AsyncMock(return_value=None))
        submit = AsyncMock(side_effect=AssertionError('must not call provider'))
        monkeypatch.setattr('app.task_worker.MediaProvider.submit', submit)
        worker = TaskWorker(sessions)
        try:
            await worker._execute(task_id)
        finally:
            worker.text_pool.shutdown(wait=True)
        submit.assert_not_awaited()
        async with sessions() as db:
            result = await db.get(Task, task_id)
            assert result.status == 'failed' and '区间已变化' in result.error_message
            assert await db.scalar(select(func.count()).select_from(Task)) == before


@pytest.mark.asyncio
async def test_preview_and_gap_are_not_actual_seams(tmp_path, monkeypatch):
    """计划卡不提供证据，时间线留白不能伪装为相邻接缝。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, cut, frames = await story(db, monkeypatch)
            data = deepcopy(cut.payload)
            data['items'][1] = {'kind': 'planned', 'id': 'preview',
                'design_revision_id': (await service.revision(plan_id)).payload['design_revision_id'],
                'shot_id': 's1', 'estimated_duration_ms': 2000, 'timeline_start_ms': 2000}
            preview = await frozen(service, sequence_id, 'cut', data)
            assert (await service.continuity(sequence_id)).seams == []
            with pytest.raises(ValueError, match='真实视频'):
                await service.extract_cut_frame(sequence_id, CutFrameRequest(cut_revision_id=preview.id, item_id='preview', edge='end'))
            data = deepcopy(cut.payload)
            for item in data['items'][1:]:
                item['timeline_start_ms'] += 1000
            await frozen(service, sequence_id, 'cut', data)
            state = await service.continuity(sequence_id)
            assert [(seam.left_item_id, seam.right_item_id) for seam in state.seams] == [('b', 'c')]
