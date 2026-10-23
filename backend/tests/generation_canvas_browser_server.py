"""生成画布真实页面的隔离 HTTP 后端，无章节、场次或模型配置。"""
import asyncio
import os
import uvicorn
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Project

engine = create_async_engine('sqlite+aiosqlite:///' + os.environ['CANVAS_BROWSER_DATABASE'])
sessions = async_sessionmaker(engine, expire_on_commit=False)


async def database():
    """请求内事务确保刷新只能读到已提交的保存。"""
    async with sessions.begin() as db:
        yield db


async def prepare():
    """仅在临时文件库准备两个空项目。"""
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id='canvas-project', name='独立画布项目', style='真人都市'))
        db.add(Project(id='other-project', name='其他项目', style='真人都市'))


if __name__ == '__main__':
    asyncio.run(prepare())
    app.dependency_overrides[get_db] = database
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8271')))
