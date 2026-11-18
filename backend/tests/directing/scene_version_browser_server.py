"""为退役路由与历史交付保护回归启动隔离的真实 API。"""

import asyncio
import os

import uvicorn
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.contracts.directing.scene_version import EditableSceneDesign, SceneVersionContent, SceneVersionSource
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.directing import SceneDeliveryRecord, SceneDeliveryUse, SceneVersionRecord
from app.models.studio import Chapter, FileItem, FileUsage, Project
from app.models.types import FileUsageKind
from app.services.directing.store import DirectingStore


PROJECT_ID = 'canvas-project'
CHAPTER_ID = 'canvas-chapter'
engine = create_async_engine('sqlite+aiosqlite:///' + os.environ['SCENE_BROWSER_TEST_DATABASE'])
sessions = async_sessionmaker(engine, expire_on_commit=False)


async def request_db():
    """每个浏览器请求使用独立测试事务。"""
    async with sessions.begin() as db:
        yield db


async def prepare():
    """建立项目、章节和没有现行画布的场次。"""
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id=PROJECT_ID, name='画布验收', style='真人都市'))
        await db.flush()
        db.add(Chapter(id=CHAPTER_ID, project_id=PROJECT_ID, index=1,
                       title='旧信', raw_text='他把旧信放在桌上，她缓缓抬头。'))
        await db.flush()
        await DirectingStore(db, PROJECT_ID).create_sequence(chapter_id=CHAPTER_ID, title='旧信重逢', position=0)


@app.post('/browser-test/legacy-delivery/{sequence_id}')
async def seed_legacy_delivery(sequence_id: str):
    """直接准备历史交付和唯一的文件保护引用。"""
    async with sessions.begin() as db:
        sequence = await DirectingStore(db, PROJECT_ID).sequence(sequence_id)
        basis = SceneVersionSource(source=sequence.source, start=sequence.source_start,
                                   end=sequence.source_end, text=sequence.source_text)
        content = SceneVersionContent(basis=basis, design=EditableSceneDesign(sources=[basis.source]))
        version = SceneVersionRecord(id='legacy-version', sequence_id=sequence.id, title='旧版交付甲',
            revision=1, create_request_id='legacy-version', source_bases=[basis.model_dump(mode='json')],
            content=content.model_dump(mode='json'))
        file = FileItem(id='legacy-delivery-file', type='video', name='历史交付素材',
                        storage_key='files/legacy-delivery.mp4')
        db.add_all([version, file])
        await db.flush()
        delivery = SceneDeliveryRecord(id='legacy-delivery', sequence_id=sequence.id, version_id=version.id,
            request_id='legacy-delivery', revision=version.revision, version_title=version.title, content=version.content)
        db.add(delivery)
        await db.flush()
        db.add_all([
            SceneDeliveryUse(sequence_id=sequence.id, delivery_id=delivery.id),
            FileUsage(file_id=file.id, project_id=PROJECT_ID, chapter_id=sequence.chapter_id,
                      usage_kind=FileUsageKind.directing_reference, source_ref=f'scene-delivery:{delivery.id}'),
        ])
        return {'data': {'delivery_id': delivery.id, 'version_id': version.id, 'file_id': file.id}}


if __name__ == '__main__':
    asyncio.run(prepare())
    app.dependency_overrides[get_db] = request_db
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['SCENE_BROWSER_TEST_PORT']), log_level='warning')
