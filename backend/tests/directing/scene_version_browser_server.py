"""为退役路由回归启动隔离的真实 API。"""

import asyncio
import os

import uvicorn
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Chapter, Project
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


if __name__ == '__main__':
    asyncio.run(prepare())
    app.dependency_overrides[get_db] = request_db
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['SCENE_BROWSER_TEST_PORT']), log_level='warning')
