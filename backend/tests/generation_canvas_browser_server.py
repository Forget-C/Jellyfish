"""生成画布真实页面的隔离 HTTP 后端，无章节、场次或模型配置。"""
import asyncio
import os
from pathlib import Path
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
    if os.environ.get('CANVAS_BROWSER_MEDIA_STORAGE'):
        from app.core import storage
        media_dir = Path(os.environ['CANVAS_BROWSER_MEDIA_STORAGE'])
        media_dir.mkdir(parents=True, exist_ok=True)
        async def upload_file(*, key, data, **kwargs):
            """只替换外部对象存储 I/O，保留真实文件路由及服务。"""
            (media_dir / Path(key).name).write_bytes(data.read())
        async def download_file(*, key):
            return (media_dir / Path(key).name).read_bytes()
        storage.upload_file = upload_file
        storage.download_file = download_file
    asyncio.run(prepare())
    app.dependency_overrides[get_db] = database
    # A proxied canvas event stream can outlive the browser during test teardown.
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('CANVAS_BROWSER_PORT', '8271')),
                timeout_graceful_shutdown=5)
