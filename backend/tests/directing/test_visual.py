"""验证图复用生成管线，但产物不会自动进入生产计划或剪辑。"""
import pytest
from sqlalchemy import select, func
from app.models.llm import Model, Provider
from app.models.studio import FileUsage
from app.models.directing import DirectingRevision, Take
from app.core.contracts.directing.workspace import VisualRequest
from app.services.directing.production import ProductionService
from app.services.generation.media_execution import deliver_media
from app.services.task_service import TaskService
from tests.directing.test_store import database, frozen
from tests.directing.samples import design_sample


@pytest.mark.asyncio
async def test_visual_candidate_has_design_source_without_auto_adoption(tmp_path):
    """成功图片关联本项目和设计任务，旧设计与全局资产不被改写。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='OpenAI', base_url='https://example.invalid/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='image-model', name='gpt-image-1', category='image', provider_id='provider'))
            await db.flush()
            service = ProductionService(db, 'p1')
            sequence = await service.create_sequence(chapter_id='ch1', title='shop', position=0)
            design = await frozen(service, sequence.id, 'design', design_sample())
            task = await service.generate_visual(sequence.id, VisualRequest(design_revision_id=design.id,
                model_id='image-model', prompt='检查两个人物的左右关系', purpose='composition'))
            assert task.project_id == 'p1'
            assert task.target_id == design.id and task.target_type == 'directing_image'
            assert task.id in (await service.workspace(sequence.id)).task_ids
            tasks = TaskService(db)
            await tasks.claim(task.id, worker_id='test')
            await tasks.add_output(task.id, ordinal=0, file_id='image1')
            await tasks.finish(task.id, deliver=deliver_media)
            assert (await service.read_task(task.id)).image_file_ids == ['image1']
            assert await db.scalar(select(FileUsage.file_id).where(FileUsage.source_ref == 'image-task:' + task.id)) == 'image1'
            assert await db.scalar(select(func.count()).select_from(Take)) == 0
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == 1
            with pytest.raises(ValueError):
                await ProductionService(db, 'p2').generate_visual(sequence.id, VisualRequest(
                    design_revision_id=design.id, model_id='image-model', prompt='test', purpose='composition'))


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['character', 'scene', 'prop'])
async def test_scene_asset_creation_is_project_scoped(tmp_path, kind):
    """按需创建只产生资产身份，不自动修改场次设计，其他项目不能读取。"""
    from app.core.contracts.directing.workspace import AssetCreateRequest

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ProductionService(db, 'p1')
            sequence = await service.create_sequence(chapter_id='ch1', title='shop', position=0)
            assets = await service.create_asset(sequence.id, AssetCreateRequest(kind=kind, name='稳定设定', description='灰色'))
            assert len(assets) == 1 and assets[0].kind == kind
            assert not await ProductionService(db, 'p2').assets()
            assert not (await service.workspace(sequence.id)).designs
