"""固定批次、重复点击、逐项失败和独立取消的离线事务回归。"""
from copy import deepcopy

import pytest
from sqlalchemy import func, select

from app.core.contracts.directing.batch import BatchPrepare
from app.models.directing import DirectingRevision
from app.models.task import Task
from app.services.directing.batch import BatchService
from app.services.directing.store import RevisionConflict
from app.services.task_service import TaskService
from tests.directing.test_store import database, frozen
from tests.directing.test_production import prepare


async def pair(db, reference_origin=None):
    """同一确认计划的两个单元各自编译、审稿，不调用模型。"""
    base, sequence_id, plan_id, prompt_id, review_id = await prepare(db, reference_origin=reference_origin)
    prompt = await base.compile_unit(sequence_id, plan_id, 'u2')
    packet = deepcopy((await base.revision(review_id)).payload)
    packet['occurrences'][0].update(prompt_revision_id=prompt.id, unit_id='u2', coverage_item_id='c3', shot_id='s2')
    review = await frozen(base, sequence_id, 'review', packet)
    return BatchService(db, 'p1'), sequence_id, BatchPrepare(items=[
        {'prompt_revision_id': prompt_id, 'review_revision_id': review_id},
        {'prompt_revision_id': prompt.id, 'review_revision_id': review.id}])


@pytest.mark.asyncio
async def test_batch_preflight_replay_and_independent_cancel(tmp_path):
    """预检不创建任务；同批重放复用两项，取消一项不影响另一项且不改剪辑。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, selection = await pair(db)
            batch = await service.prepare_batch(sequence_id, selection)
            assert [row.status for row in batch.items] == ['ready', 'ready']
            assert await db.scalar(select(func.count()).select_from(Task)) == 0
            accepted = await service.submit_batch(sequence_id, batch.id, expected_version=batch.version)
            assert [row.status for row in accepted.items] == ['queued', 'queued']
            replay = await service.submit_batch(sequence_id, batch.id, expected_version=batch.version)
            assert [row.task_id for row in replay.items] == [row.task_id for row in accepted.items]
            assert await db.scalar(select(func.count()).select_from(Task)) == 2
            await TaskService(db).request_cancel(accepted.items[0].task_id, reason='取消单项')
            refreshed = await service.read_batch(sequence_id, batch.id)
            assert refreshed.items[0].status == 'cancelled' and refreshed.items[1].status == 'queued'
            assert not await db.scalar(select(DirectingRevision.id).where(DirectingRevision.kind == 'cut'))


@pytest.mark.asyncio
async def test_batch_rechecks_each_item_and_preserves_other_acceptance(tmp_path, monkeypatch):
    """预检后某项失效或内部异常，不回滚另一项受理，也不在重放时偷偷重试。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, selection = await pair(db)
            batch = await service.prepare_batch(sequence_id, selection)
            original = service.prepare_shoot

            async def changed(sequence_id, *, prompt_id, review_id):
                """让第二项在真正受理时失败，第一项仍走完整任务提交。"""
                if prompt_id == selection.items[1].prompt_revision_id:
                    raise RuntimeError('private diagnostic must not be exposed')
                return await original(sequence_id, prompt_id=prompt_id, review_id=review_id)

            monkeypatch.setattr(service, 'prepare_shoot', changed)
            accepted = await service.submit_batch(sequence_id, batch.id, expected_version=1)
            assert accepted.items[0].task_id and accepted.items[1].status == 'blocked'
            assert 'private' not in accepted.items[1].error
            assert await db.scalar(select(func.count()).select_from(Task)) == 1
            monkeypatch.setattr(service, 'prepare_shoot', original)
            replay = await service.submit_batch(sequence_id, batch.id, expected_version=1)
            assert replay.items[1].task_id is None
            assert await db.scalar(select(func.count()).select_from(Task)) == 1


@pytest.mark.asyncio
async def test_batch_scope_versions_and_blocked_preflight(tmp_path):
    """项目边界、旧确认版本和未通过审稿在外部执行之前被拒绝。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, selection = await pair(db)
            packet = deepcopy((await service.revision(selection.items[1].review_revision_id)).payload)
            packet['rows'][0]['verdict'] = 'revise'
            pending = await frozen(service, sequence_id, 'review', packet)
            selection.items[1].review_revision_id = pending.id
            batch = await service.prepare_batch(sequence_id, selection)
            assert [row.status for row in batch.items] == ['ready', 'blocked']
            with pytest.raises(ValueError):
                await BatchService(db, 'p2').read_batch(sequence_id, batch.id)
            with pytest.raises(RevisionConflict):
                await service.submit_batch(sequence_id, batch.id, expected_version=9)
            accepted = await service.submit_batch(sequence_id, batch.id, expected_version=1)
            assert accepted.items[0].task_id and not accepted.items[1].task_id


@pytest.mark.asyncio
async def test_regroup_derives_plan_preserves_references_and_versioned_dependencies(tmp_path):
    """重组保留历史计划的实际依赖身份；组合保留范围，不覆盖旧计划或自动生成任务。"""
    from app.core.contracts.directing.workspace import RegroupRequest
    from tests.directing.samples import plan_sample

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, selection = await pair(db)
            prompt = await service.revision(selection.items[0].prompt_revision_id)
            old = await service.revision(prompt.payload['plan_revision_id'])
            payload = plan_sample(old.payload['design_revision_id'])
            payload['units'][1]['dependencies'] = [{'plan_revision_id': old.id, 'unit_id': 'u1'}]
            original = await frozen(service, sequence_id, 'plan', payload)
            original_payload = deepcopy(original.payload)
            split = await service.regroup_units(sequence_id, RegroupRequest(plan_revision_id=original.id, unit_ids=['u1'], operation='split'))
            units = split.payload['units']
            assert split.parent_id == original.id and split.confirmed_at is None
            assert len(units) == 3 and units[2]['dependencies'] == original_payload['units'][1]['dependencies']
            assert (await service.revision(original.id)).payload == original_payload
            split = await service.confirm_revision(split.id, expected_version=split.version, actor_id='author')
            merged = await service.regroup_units(sequence_id, RegroupRequest(plan_revision_id=split.id, unit_ids=[units[0]['id'], units[1]['id']], operation='merge'))
            assert len(merged.payload['units']) == 2
            assert len(merged.payload['units'][0]['coverage']) == 2
            assert merged.payload['units'][1]['dependencies'] == original_payload['units'][1]['dependencies']
            assert await db.scalar(select(func.count()).select_from(Task)) == 0


@pytest.mark.asyncio
async def test_batch_rolls_back_only_failed_item_after_task_creation(tmp_path, monkeypatch):
    """某项已插入任务后发生异常，保存点只回滚该项，不留下幽灵任务或撤回其他项。"""
    from app.models.directing import DirectingAction
    from app.services.generation.submission.submitter import GenerationSubmitter

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, selection = await pair(db)
            batch = await service.prepare_batch(sequence_id, selection)
            original = GenerationSubmitter.submit_async
            calls = 0

            async def fail_after_insert(submitter, session, command):
                """第二次真实事务提交封装插入后失败，不调用任何供应商。"""
                nonlocal calls
                accepted = await original(submitter, session, command)
                calls += 1
                if calls == 2:
                    raise RuntimeError('failed after inserting task')
                return accepted

            monkeypatch.setattr(GenerationSubmitter, 'submit_async', fail_after_insert)
            accepted = await service.submit_batch(sequence_id, batch.id, expected_version=1)
            assert accepted.items[0].task_id and accepted.items[1].task_id is None
            assert accepted.items[1].status == 'blocked'
            assert await db.scalar(select(func.count()).select_from(Task)) == 1
            assert await db.scalar(select(func.count()).select_from(DirectingAction).where(DirectingAction.action == 'execute')) == 1


@pytest.mark.asyncio
async def test_batch_keeps_fixed_source_after_asset_deletion_and_rechecks_files(tmp_path):
    """批量 HTTP 预检读取固定计划；来源失效不改历史，文件失效仍阻止受理。"""
    from datetime import datetime, timezone
    from sqlalchemy import delete
    from app.models.studio import FileItem, FileUsage, Scene, SceneImage, ProjectSceneLink
    from tests.directing.test_api import client_for

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Scene(id='fixed-source', project_id='p1', name='选择时场所', style='真人都市'))
            await db.flush()
            db.add_all([ProjectSceneLink(project_id='p1', scene_id='fixed-source'),
                        SceneImage(id=990, scene_id='fixed-source', file_id='image1')])
            await db.flush()
            _, sequence_id, selection = await pair(db, reference_origin={'kind': 'scene', 'id': 'fixed-source', 'name': '选择时场所'})
        path = f'/api/v1/studio/projects/p1/directing/sequences/{sequence_id}'
        frozen_plans = (await client.get(path)).json()['data']['plans']
        async with sessions.begin() as db:
            await db.execute(delete(ProjectSceneLink).where(ProjectSceneLink.scene_id == 'fixed-source'))
            await db.execute(delete(SceneImage).where(SceneImage.scene_id == 'fixed-source'))
            await db.execute(delete(Scene).where(Scene.id == 'fixed-source'))
        prepared = await client.post(path + '/batches/prepare', json=selection.model_dump(mode='json'))
        assert prepared.status_code == 200, prepared.text
        assert [row['status'] for row in prepared.json()['data']['items']] == ['ready', 'ready']
        accepted = await client.post(path + '/batches/' + prepared.json()['data']['id'] + '/submit', json={'expected_version': 1})
        assert accepted.status_code == 200, accepted.text
        assert [row['status'] for row in accepted.json()['data']['items']] == ['queued', 'queued']
        for field in ['deleted_at', 'delete_requested_at']:
            async with sessions.begin() as db:
                setattr(await db.get(FileItem, 'image1'), field, datetime.now(timezone.utc))
            blocked = await client.post(path + '/batches/prepare', json=selection.model_dump(mode='json'))
            assert blocked.status_code == 200, blocked.text
            assert [row['status'] for row in blocked.json()['data']['items']] == ['blocked', 'blocked']
            async with sessions.begin() as db:
                setattr(await db.get(FileItem, 'image1'), field, None)
        async with sessions.begin() as db:
            await db.execute(delete(FileUsage).where(FileUsage.file_id == 'image1'))
            db.add(FileUsage(file_id='image1', project_id='p2', usage_kind='upload', source_ref='private'))
        blocked = await client.post(path + '/batches/prepare', json=selection.model_dump(mode='json'))
        assert [row['status'] for row in blocked.json()['data']['items']] == ['blocked', 'blocked']
        assert (await client.get(path)).json()['data']['plans'] == frozen_plans
